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
    uint256 public totalDebt;
    uint256 public nextLiqId;

    error NotOwner();
    error ZeroAmount();
    error AccountLiquidatable();
    error CreditLimitExceeded(uint256 requested, uint256 available);
    error NotLiquidatable();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error TokenTransferFailed();
    error AmountTooLarge(uint256 amount);

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
        uint256 cash = asset.balanceOf(address(this));
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

    function sync(address rvm, address user, uint256 limit, bool liquidatable_, uint64 seq, uint256 reqId)
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
        liquidatable[user] = liquidatable_;
        emit LimitApplied(user, seq, reqId, limit, liquidatable_, debtOf[user]);
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
