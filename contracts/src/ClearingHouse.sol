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
        Liquidated,
        Shield
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
        uint256 shield;
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
    /// Accounts re-checked per transaction after a price update. The first batch runs inside react(); each
    /// further batch runs in a callback this contract sends to itself on Reactive, a fresh transaction with
    /// its own gas budget, so the number of accounts is not bounded by one transaction's 900k gas cap.
    uint256 public constant BATCH = 8;
    uint64 public constant CALLBACK_GAS = 400_000;
    uint64 public constant CONTINUE_GAS = 700_000;

    uint256 internal immutable T_DEPOSITED = uint256(IVaultEvents.Deposited.selector);
    uint256 internal immutable T_WITHDRAW_REQUESTED = uint256(IVaultEvents.WithdrawRequested.selector);
    uint256 internal immutable T_WITHDRAW_SETTLED = uint256(IVaultEvents.WithdrawSettled.selector);
    uint256 internal immutable T_SEIZED = uint256(IVaultEvents.Seized.selector);
    uint256 internal immutable T_PRICE = uint256(IPriceFeedEvents.PriceUpdated.selector);
    uint256 internal immutable T_DEBT = uint256(IMarketEvents.DebtUpdated.selector);
    uint256 internal immutable T_LIMIT_APPLIED = uint256(IMarketEvents.LimitApplied.selector);
    uint256 internal immutable T_LIQUIDATED = uint256(IMarketEvents.Liquidated.selector);
    uint256 internal immutable T_SHIELD = uint256(IMarketEvents.ShieldUpdated.selector);

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
    /// Shield repays kick in once debt exceeds this share of collateral value: after the borrow limit
    /// (ltvBps), before the liquidation threshold (ltBps).
    uint256 public protectBps = 7_500;

    mapping(address => Account) public accounts;
    mapping(uint256 => Withdrawal) public withdrawals;
    mapping(address => uint256[]) internal awaiting;
    address[] public users;

    /// Each price update starts a new re-check pass; `repriceCursor` is the next account it has not reached.
    uint256 public repriceEpoch;
    uint256 public repriceCursor;

    event Reacted(
        Kind indexed kind, address indexed user, uint256 originChainId, uint256 originTxHash, uint256 originBlock
    );
    event SyncSent(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable);
    event WithdrawDecision(address indexed user, uint256 indexed reqId, bool release, uint256 debt, uint256 limitAfter);
    event SeizeSent(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount);
    event ProtectionSent(address indexed user, uint64 indexed seq, uint256 debt, uint256 limit, uint256 shield);
    event PriceSynced(uint256 price);
    event RepriceBatch(uint256 indexed epoch, uint256 from, uint256 to, uint256 total);
    event Configured(
        uint256 baseChainId, address vault, address feed, uint256 unichainChainId, address market, uint256 price
    );
    event RiskParamsUpdated(
        uint256 ltvBps, uint256 ltBps, uint256 bonusBps, uint256 minIncreaseBps, uint256 protectBps
    );

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
        _subscribe(unichainChainId_, market_, T_SHIELD);
    }

    function setRiskParams(uint256 ltv, uint256 lt, uint256 bonus, uint256 minIncrease, uint256 protect)
        external
        onlyOwner
    {
        if (ltv == 0 || ltv >= protect || protect >= lt || lt >= 10_000 || bonus > 2_000) {
            revert InvalidParams();
        }
        ltvBps = ltv;
        ltBps = lt;
        bonusBps = bonus;
        minIncreaseBps = minIncrease;
        protectBps = protect;
        emit RiskParamsUpdated(ltv, lt, bonus, minIncrease, protect);
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
            else if (t == T_SHIELD) _onShield(log_);
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

    /// True when debt is above the protection trigger and above the limit, and the user has a shield.
    function needsProtection(address user) public view returns (bool) {
        Account storage a = accounts[user];
        return a.shield > 0 && a.debt > limitFor(_free(a)) && a.debt * 10_000 > valueOf(a.collateral) * protectBps;
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
        // A newer price supersedes any pass still running: start again from the first account.
        uint256 epoch = ++repriceEpoch;
        repriceCursor = 0;
        _repriceBatch(epoch);
    }

    /// Continues a price update's re-check with the next batch of accounts. Reached through the callback
    /// this contract sends to itself on Reactive. It is open to anyone because it can only do work the
    /// ledger owes anyway: the next unprocessed batch of the current pass, once. A call for an older pass,
    /// or after the pass has finished, does nothing. The first argument is overwritten by Reactive.
    function continueReprice(address, uint256 epoch) external {
        if (epoch != repriceEpoch) return;
        _repriceBatch(epoch);
    }

    function _repriceBatch(uint256 epoch) internal {
        uint256 n = users.length;
        uint256 from = repriceCursor;
        if (from >= n) return;
        uint256 to = from + BATCH < n ? from + BATCH : n;
        repriceCursor = to;
        emit RepriceBatch(epoch, from, to, n);
        for (uint256 i = from; i < to; i++) {
            _sync(users[i], 0, false);
        }
        if (to < n) {
            _request(
                block.chainid, address(this), abi.encodeCall(this.continueReprice, (address(0), epoch)), CONTINUE_GAS
            );
        }
    }

    function _onDebt(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        (, uint256 d) = abi.decode(log_.data, (int256, uint256));
        _mark(Kind.Debt, user, log_);
        Account storage a = accounts[user];
        a.debt = d;
        // Re-evaluate on every debt change: a borrow made against a stale (higher) limit after a price
        // drop can make the account unhealthy or push it past the protection trigger. _sync only sends
        // a callback when the flag, the limit or the protection decision actually changes.
        if (a.tracked) _sync(user, 0, false);
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

    function _onShield(LogRecord calldata log_) internal {
        address user = _addr(log_.topic1);
        uint256 s = abi.decode(log_.data, (uint256));
        _mark(Kind.Shield, user, log_);
        Account storage a = accounts[user];
        a.shield = s;
        // A shield funded while already past the trigger protects the account right away.
        if (a.tracked) _sync(user, 0, false);
    }

    function _sync(address user, uint256 reqId, bool force) internal {
        Account storage a = accounts[user];
        uint256 newLimit = limitFor(_free(a));
        bool liq = isUnhealthy(user);
        bool protect = needsProtection(user);
        uint256 old = a.limit;

        bool send = force || protect || liq != a.liquidatable || newLimit < old;
        if (!send && newLimit > old) {
            send = old == 0 || (newLimit - old) * 10_000 >= old * minIncreaseBps;
        }
        if (!send) return;

        a.limit = newLimit;
        a.liquidatable = liq;
        _sendSync(user, ++a.seq, reqId, protect);
    }

    /// Split out of _sync to stay within the legacy pipeline's stack limit.
    function _sendSync(address user, uint64 seq, uint256 reqId, bool protect) internal {
        Account storage a = accounts[user];
        // forge-lint: disable-next-line(reentrancy-events)
        emit SyncSent(user, seq, reqId, a.limit, a.liquidatable);
        // forge-lint: disable-next-line(reentrancy-events)
        if (protect) emit ProtectionSent(user, seq, a.debt, a.limit, a.shield);
        _request(
            unichainChainId,
            market,
            abi.encodeCall(ICreditMarket.sync, (address(0), user, a.limit, a.liquidatable, seq, reqId, protect))
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

    /// Every depositor is tracked; there is no account cap (price updates re-check accounts in batches).
    function _track(address user) internal returns (bool) {
        Account storage a = accounts[user];
        if (a.tracked) return true;
        a.tracked = true;
        users.push(user);
        return true;
    }

    function _request(uint256 chainId, address recipient, bytes memory payload) internal {
        _request(chainId, recipient, payload, CALLBACK_GAS);
    }

    function _request(uint256 chainId, address recipient, bytes memory payload, uint64 gasLimit) internal {
        // forge-lint: disable-start(calls-loop)
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: chainId, recipient: recipient, gasLimit: gasLimit, payload: payload
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
