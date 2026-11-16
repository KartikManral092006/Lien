// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "reactive-lib/base/AbstractCallback.sol";
import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {IERC20Min, IMarketEvents, ICreditMarket} from "./interfaces/ILien.sol";

contract CreditMarket is AbstractCallback, IMarketEvents, ICreditMarket {
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;

    IERC20Min public immutable asset;
    address public owner;

    mapping(address => uint256) public debtOf;
    mapping(address => uint256) public limitOf;
    mapping(address => bool) public liquidatable;
    mapping(address => uint64) public lastSeq;
    /// USDC each borrower set aside to be repaid automatically before they can be liquidated.
    mapping(address => uint256) public shieldOf;
    uint256 public totalDebt;
    uint256 public totalShield;
    uint256 public nextLiqId;

    error NotOwner();
    error ZeroAmount();
    error AccountLiquidatable();
    error CreditLimitExceeded(uint256 requested, uint256 available);
    error NotLiquidatable();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error TokenTransferFailed();
    error AmountTooLarge(uint256 amount);
    error ShieldTooSmall(uint256 requested, uint256 shield);

    constructor(IPayable callbackProxy_, address clearingHouse_, IERC20Min asset_)
        payable
        AbstractCallback(callbackProxy_, clearingHouse_)
    {
        asset = asset_;
        owner = msg.sender;
    }

    function supply(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (liquidatable[msg.sender]) revert AccountLiquidatable();
        uint256 current = debtOf[msg.sender];
        uint256 d = current + amount;
        uint256 lim = limitOf[msg.sender];
        if (d > lim) revert CreditLimitExceeded(amount, lim > current ? lim - current : 0);
        uint256 cash = availableLiquidity();
        if (amount > cash) revert InsufficientLiquidity(amount, cash);
        debtOf[msg.sender] = d;
        totalDebt += amount;
        emit DebtUpdated(msg.sender, _signed(amount), d);
        if (!asset.transfer(msg.sender, amount)) revert TokenTransferFailed();
    }

    function repay(address user, uint256 amount) external {
        uint256 d = debtOf[user];
        if (amount > d) amount = d;
        if (amount == 0) revert ZeroAmount();
        d -= amount;
        debtOf[user] = d;
        totalDebt -= amount;
        emit DebtUpdated(user, -_signed(amount), d);
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function liquidate(address user, uint256 amount) external returns (uint256 liqId) {
        if (!liquidatable[user]) revert NotLiquidatable();
        uint256 d = debtOf[user];
        uint256 maxRepay = d * CLOSE_FACTOR_BPS / 10_000;
        if (maxRepay == 0) maxRepay = d;
        if (amount > maxRepay) amount = maxRepay;
        if (amount == 0) revert ZeroAmount();
        d -= amount;
        debtOf[user] = d;
        totalDebt -= amount;
        liquidatable[user] = false;
        liqId = ++nextLiqId;
        emit Liquidated(user, msg.sender, liqId, amount, d);
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function fundShield(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 s = shieldOf[msg.sender] + amount;
        shieldOf[msg.sender] = s;
        totalShield += amount;
        emit ShieldUpdated(msg.sender, s);
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function withdrawShield(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 s = shieldOf[msg.sender];
        if (amount > s) revert ShieldTooSmall(amount, s);
        s -= amount;
        shieldOf[msg.sender] = s;
        totalShield -= amount;
        emit ShieldUpdated(msg.sender, s);
        if (!asset.transfer(msg.sender, amount)) revert TokenTransferFailed();
    }

    /// Applies the ClearingHouse's view of an account. With `protect`, debt above the new limit is
    /// first repaid from the borrower's shield, in the same call that would flag the account, so a
    /// liquidator can never act between the price drop and the protection.
    function sync(address rvm, address user, uint256 limit, bool liquidatable_, uint64 seq, uint256 reqId, bool protect)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        if (seq <= lastSeq[user]) {
            emit SyncIgnored(user, seq, reqId);
            return;
        }
        lastSeq[user] = seq;
        limitOf[user] = limit;
        if (protect && _protect(user, limit, seq) <= limit) liquidatable_ = false;
        liquidatable[user] = liquidatable_;
        emit LimitApplied(user, seq, reqId, limit, liquidatable_, debtOf[user]);
    }

    /// Repays debt down to `limit` (never a fixed amount), so a duplicate or reordered protect is a no-op.
    function _protect(address user, uint256 limit, uint64 seq) internal returns (uint256 d) {
        d = debtOf[user];
        uint256 s = shieldOf[user];
        if (d <= limit || s == 0) return d;
        uint256 used = d - limit;
        if (used > s) used = s;
        d -= used;
        s -= used;
        debtOf[user] = d;
        shieldOf[user] = s;
        totalDebt -= used;
        totalShield -= used;
        emit Protected(user, seq, used, d, s);
        // Shield first, so the ClearingHouse knows the shield is spent before it re-evaluates the debt.
        emit ShieldUpdated(user, s);
        emit DebtUpdated(user, -_signed(used), d);
    }

    /// Relays a price update's re-check to its next batch: the ClearingHouse subscribes to the event and
    /// re-checks the next accounts in a fresh react(). Lasna does not deliver callbacks a reactive contract
    /// sends to itself, so the continuation takes this round trip through Unichain instead.
    function relayReprice(address rvm, uint256 epoch) external onlyServiceProvider onlyCallbackSender(rvm) {
        emit RepriceRelayed(epoch);
    }

    /// Lendable cash: shields belong to their borrowers and are never lent out.
    function availableLiquidity() public view returns (uint256) {
        uint256 bal = asset.balanceOf(address(this));
        return bal > totalShield ? bal - totalShield : 0;
    }

    function availableCredit(address user) external view returns (uint256) {
        if (liquidatable[user]) return 0;
        uint256 lim = limitOf[user];
        uint256 d = debtOf[user];
        return lim > d ? lim - d : 0;
    }

    function coverDebt() external {
        if (msg.sender != owner) revert NotOwner();
        _coverDebt();
    }

    function withdrawGas(address payable to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _pay(to, amount);
    }

    function _signed(uint256 x) internal pure returns (int256) {
        if (x >> 255 != 0) revert AmountTooLarge(x);
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(x);
    }
}
