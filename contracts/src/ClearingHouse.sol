// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "reactive-lib/base/AbstractReactive.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";
import {IVaultEvents, IPriceFeedEvents, IMarketEvents, ICollateralVault, ICreditMarket} from "./interfaces/ILien.sol";

contract ClearingHouse is AbstractReactive {
    enum Kind {
        Deposit,
        WithdrawRequest,
        WithdrawSettled,
        Seized,
        Price,
        Debt,
        LimitApplied,
        Liquidated
    }

    enum Status {
        None,
        AwaitingLimit,
        Released,
        Rejected,
        Closed
    }

    struct Account {
        uint256 collateral;
        uint256 pending;
        uint256 debt;
        uint256 limit;
        uint64 seq;
        bool liquidatable;
        bool tracked;
    }

    struct Withdrawal {
        address user;
        uint256 amount;
        uint64 seq;
        Status status;
    }

    uint256 public constant COLL_UNIT = 1e18;
    uint256 public constant DEBT_UNIT = 1e6;
    uint256 public constant PRICE_UNIT = 1e8;
    uint256 public constant MAX_USERS = 8;
    uint64 public constant CALLBACK_GAS = 400_000;

    uint256 internal immutable T_DEPOSITED = uint256(IVaultEvents.Deposited.selector);
    uint256 internal immutable T_WITHDRAW_REQUESTED = uint256(IVaultEvents.WithdrawRequested.selector);
    uint256 internal immutable T_WITHDRAW_SETTLED = uint256(IVaultEvents.WithdrawSettled.selector);
    uint256 internal immutable T_SEIZED = uint256(IVaultEvents.Seized.selector);
    uint256 internal immutable T_PRICE = uint256(IPriceFeedEvents.PriceUpdated.selector);
    uint256 internal immutable T_DEBT = uint256(IMarketEvents.DebtUpdated.selector);
    uint256 internal immutable T_LIMIT_APPLIED = uint256(IMarketEvents.LimitApplied.selector);
    uint256 internal immutable T_LIQUIDATED = uint256(IMarketEvents.Liquidated.selector);

    address public owner;
    bool public configured;

    uint256 public baseChainId;
    uint256 public unichainChainId;
    address public vault;
    address public feed;
    address public market;

    uint256 public price;
    uint256 public ltvBps = 7_000;
    uint256 public ltBps = 8_000;
    uint256 public bonusBps = 500;
    uint256 public minIncreaseBps = 100;

    mapping(address => Account) public accounts;
    mapping(uint256 => Withdrawal) public withdrawals;
    mapping(address => uint256[]) internal awaiting;
    address[] public users;

    event Reacted(
        Kind indexed kind, address indexed user, uint256 originChainId, uint256 originTxHash, uint256 originBlock
    );
    event SyncSent(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable);
    event WithdrawDecision(address indexed user, uint256 indexed reqId, bool release, uint256 debt, uint256 limitAfter);
    event SeizeSent(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount);
    event UserNotTracked(address indexed user);
    event PriceSynced(uint256 price);
    event Configured(
        uint256 baseChainId, address vault, address feed, uint256 unichainChainId, address market, uint256 price
    );
    event RiskParamsUpdated(uint256 ltvBps, uint256 ltBps, uint256 bonusBps, uint256 minIncreaseBps);

    error NotOwner();
    error AlreadyConfigured();
    error InvalidParams();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() payable {
        owner = msg.sender;
    }

    function configure(
        uint256 baseChainId_,
        address vault_,
        address feed_,
        uint256 unichainChainId_,
        address market_,
        uint256 initialPrice
    ) external onlyOwner {
        if (configured) revert AlreadyConfigured();
        if (initialPrice == 0 || vault_ == address(0) || feed_ == address(0) || market_ == address(0)) {
            revert InvalidParams();
        }
        configured = true;
        baseChainId = baseChainId_;
        vault = vault_;
        feed = feed_;
        unichainChainId = unichainChainId_;
        market = market_;
        price = initialPrice;
        emit Configured(baseChainId_, vault_, feed_, unichainChainId_, market_, initialPrice);

        _subscribe(baseChainId_, vault_, T_DEPOSITED);
        _subscribe(baseChainId_, vault_, T_WITHDRAW_REQUESTED);
        _subscribe(baseChainId_, vault_, T_WITHDRAW_SETTLED);
        _subscribe(baseChainId_, vault_, T_SEIZED);
        _subscribe(baseChainId_, feed_, T_PRICE);
        _subscribe(unichainChainId_, market_, T_DEBT);
        _subscribe(unichainChainId_, market_, T_LIMIT_APPLIED);
        _subscribe(unichainChainId_, market_, T_LIQUIDATED);
    }

    function setRiskParams(uint256 ltv, uint256 lt, uint256 bonus, uint256 minIncrease) external onlyOwner {
        if (ltv == 0 || ltv >= lt || lt >= 10_000 || bonus > 2_000) revert InvalidParams();
        ltvBps = ltv;
        ltBps = lt;
        bonusBps = bonus;
        minIncreaseBps = minIncrease;
        emit RiskParamsUpdated(ltv, lt, bonus, minIncrease);
    }

    function coverDebt() external onlyOwner {
        _coverDebt();
    }

    function withdrawFunds(address payable to, uint256 amount) external onlyOwner {
        _pay(to, amount);
    }

    function react(LogRecord calldata log_) external onlySystem {
        address src = log_.contractAddress;
        uint256 t = log_.topic0;
        if (log_.chainId == baseChainId) {
            if (src == vault) {
                if (t == T_DEPOSITED) _onDeposited(log_);
                else if (t == T_WITHDRAW_REQUESTED) _onWithdrawRequested(log_);
                else if (t == T_WITHDRAW_SETTLED) _onWithdrawSettled(log_);
                else if (t == T_SEIZED) _onSeized(log_);
            } else if (src == feed && t == T_PRICE) {
                _onPrice(log_);
            }
        } else if (log_.chainId == unichainChainId && src == market) {
            if (t == T_DEBT) _onDebt(log_);
            else if (t == T_LIMIT_APPLIED) _onLimitApplied(log_);
            else if (t == T_LIQUIDATED) _onLiquidated(log_);
        }
    }

    function valueOf(uint256 collateralAmount) public view returns (uint256) {
        return collateralAmount * price * DEBT_UNIT / (COLL_UNIT * PRICE_UNIT);
    }

    function limitFor(uint256 collateralAmount) public view returns (uint256) {
        return valueOf(collateralAmount) * ltvBps / 10_000;
    }

    function seizeAmountFor(uint256 repaid) public view returns (uint256) {
        return repaid * COLL_UNIT * PRICE_UNIT * (10_000 + bonusBps) / (price * DEBT_UNIT * 10_000);
    }

    function isUnhealthy(address user) public view returns (bool) {
        Account storage a = accounts[user];
        return a.debt * 10_000 > valueOf(a.collateral) * ltBps;
    }

    function usersCount() external view returns (uint256) {
        return users.length;
    }

    function awaitingOf(address user) external view returns (uint256[] memory) {
        return awaiting[user];
    }

    function _onDeposited(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        (, uint256 c, uint256 p) = abi.decode(log_.data, (uint256, uint256, uint256));
        _mark(Kind.Deposit, user, log_);
        Account storage a = accounts[user];
        a.collateral = c;
        a.pending = p;
        if (_track(user)) _sync(user, 0, false);
    }

    function _onWithdrawRequested(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        uint256 reqId = log_.topic2;
        (uint256 amount, uint256 c, uint256 p) = abi.decode(log_.data, (uint256, uint256, uint256));
        _mark(Kind.WithdrawRequest, user, log_);
        Account storage a = accounts[user];
        a.collateral = c;
        a.pending = p;
        Withdrawal storage w = withdrawals[reqId];
        w.user = user;
        w.amount = amount;

        if (!a.tracked) {
            _decide(reqId, true, a.debt, 0);
            return;
        }

        uint256 limitAfter = limitFor(_free(a));
        if (a.liquidatable || a.debt > limitAfter) {
            _decide(reqId, false, a.debt, limitAfter);
            return;
        }

        w.status = Status.AwaitingLimit;
        _sync(user, reqId, true);
        w.seq = a.seq;
        awaiting[user].push(reqId);
    }

    function _onWithdrawSettled(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        uint256 reqId = log_.topic2;
        (, uint256 c, uint256 p) = abi.decode(log_.data, (bool, uint256, uint256));
        _mark(Kind.WithdrawSettled, user, log_);
        Account storage a = accounts[user];
        a.collateral = c;
        a.pending = p;
        Withdrawal storage w = withdrawals[reqId];
        if (w.status == Status.AwaitingLimit) _dropAwaiting(user, reqId);
        if (w.status != Status.Released && w.status != Status.Rejected) w.status = Status.Closed;
        if (a.tracked) _sync(user, 0, false);
    }

    function _onSeized(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        (, uint256 c, uint256 p) = abi.decode(log_.data, (uint256, uint256, uint256));
        _mark(Kind.Seized, user, log_);
        Account storage a = accounts[user];
        a.collateral = c;
        a.pending = p;
        if (a.tracked) _sync(user, 0, false);
    }

    function _onPrice(LogRecord calldata log_) internal {
        (uint256 newPrice,) = abi.decode(log_.data, (uint256, uint256));
        _mark(Kind.Price, address(0), log_);
        if (newPrice == 0) return;
        price = newPrice;
        emit PriceSynced(newPrice);
        uint256 n = users.length;
        for (uint256 i = 0; i < n; i++) {
            _sync(users[i], 0, false);
        }
    }

    function _onDebt(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        (, uint256 d) = abi.decode(log_.data, (int256, uint256));
        _mark(Kind.Debt, user, log_);
        Account storage a = accounts[user];
        a.debt = d;
        if (a.tracked && a.liquidatable) _sync(user, 0, false);
    }

    function _onLimitApplied(LogRecord calldata log_) internal {
        if (log_.topic2 > type(uint64).max) return;
        address user = _addr(log_.topic1);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 seq = uint64(log_.topic2);
        (,, uint256 d) = abi.decode(log_.data, (uint256, bool, uint256));
        _mark(Kind.LimitApplied, user, log_);
        Account storage a = accounts[user];
        a.debt = d;

        uint256[] storage list = awaiting[user];
        uint256 limitAfter = limitFor(_free(a));
        uint256 i = 0;
        while (i < list.length) {
            uint256 reqId = list[i];
            Withdrawal storage w = withdrawals[reqId];
            if (w.seq <= seq) {
                bool safe = !a.liquidatable && d <= limitAfter;
                _decide(reqId, safe, d, limitAfter);
                list[i] = list[list.length - 1];
                list.pop();
            } else {
                i++;
            }
        }
    }

    function _onLiquidated(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        address liquidator = _addr(log_.topic2);
        uint256 liqId = log_.topic3;
        (uint256 repaid, uint256 d) = abi.decode(log_.data, (uint256, uint256));
        _mark(Kind.Liquidated, user, log_);
        Account storage a = accounts[user];
        a.debt = d;
        a.liquidatable = false;

        uint256 amount = seizeAmountFor(repaid);
        if (amount > a.collateral) amount = a.collateral;
        a.collateral -= amount;

        emit SeizeSent(user, liquidator, liqId, amount);
        _request(
            baseChainId, vault, abi.encodeCall(ICollateralVault.seize, (address(0), user, liquidator, liqId, amount))
        );

        if (a.tracked) _sync(user, 0, false);
    }

    function _sync(address user, uint256 reqId, bool force) internal {
        Account storage a = accounts[user];
        uint256 newLimit = limitFor(_free(a));
        bool liq = isUnhealthy(user);
        uint256 old = a.limit;

        bool send = force || liq != a.liquidatable || newLimit < old;
        if (!send && newLimit > old) {
            send = old == 0 || (newLimit - old) * 10_000 >= old * minIncreaseBps;
        }
        if (!send) return;

        a.limit = newLimit;
        a.liquidatable = liq;
        uint64 seq = ++a.seq;
        // forge-lint: disable-next-line(reentrancy-events)
        emit SyncSent(user, seq, reqId, newLimit, liq);
        _request(
            unichainChainId, market, abi.encodeCall(ICreditMarket.sync, (address(0), user, newLimit, liq, seq, reqId))
        );
    }

    function _decide(uint256 reqId, bool release, uint256 debt, uint256 limitAfter) internal {
        Withdrawal storage w = withdrawals[reqId];
        w.status = release ? Status.Released : Status.Rejected;
        emit WithdrawDecision(w.user, reqId, release, debt, limitAfter);
        _request(baseChainId, vault, abi.encodeCall(ICollateralVault.settleWithdraw, (address(0), reqId, release)));
    }

    function _dropAwaiting(address user, uint256 reqId) internal {
        uint256[] storage list = awaiting[user];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == reqId) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }

    function _track(address user) internal returns (bool) {
        Account storage a = accounts[user];
        if (a.tracked) return true;
        if (users.length >= MAX_USERS) {
            emit UserNotTracked(user);
            return false;
        }
        a.tracked = true;
        users.push(user);
        return true;
    }

    function _request(uint256 chainId, address recipient, bytes memory payload) internal {
        // forge-lint: disable-start(calls-loop)
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: chainId, recipient: recipient, gasLimit: CALLBACK_GAS, payload: payload
            })
        );
        // forge-lint: disable-end(calls-loop)
    }

    function _subscribe(uint256 chainId, address target, uint256 topic0) internal {
        SYSTEM.subscribe(chainId, target, topic0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _mark(Kind kind, address user, LogRecord calldata log_) internal {
        emit Reacted(kind, user, log_.chainId, log_.txHash, log_.blockNumber);
    }

    function _free(Account storage a) internal view returns (uint256) {
        return a.collateral > a.pending ? a.collateral - a.pending : 0;
    }

    function _addr(uint256 topic) internal pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(topic));
    }
}
