// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractCallback} from "reactive-lib/base/AbstractCallback.sol";
import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {IERC20Min, IVaultEvents, ICollateralVault} from "./interfaces/ILien.sol";

contract CollateralVault is AbstractCallback, IVaultEvents, ICollateralVault {
    struct Withdrawal {
        address user;
        uint256 amount;
        bool open;
    }

    IERC20Min public immutable asset;
    address public owner;

    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public pendingOf;
    mapping(uint256 => Withdrawal) public withdrawals;
    mapping(uint256 => bool) public liquidationSettled;
    uint256 public nextReqId;

    error NotOwner();
    error ZeroAmount();
    error InsufficientFreeCollateral(uint256 requested, uint256 free);
    error NotRequester();
    error NotOpen();
    error TokenTransferFailed();

    constructor(IPayable callbackProxy_, address clearingHouse_, IERC20Min asset_)
        payable
        AbstractCallback(callbackProxy_, clearingHouse_)
    {
        asset = asset_;
        owner = msg.sender;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 c = collateralOf[msg.sender] + amount;
        collateralOf[msg.sender] = c;
        emit Deposited(msg.sender, amount, c, pendingOf[msg.sender]);
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function requestWithdraw(uint256 amount) external returns (uint256 reqId) {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeCollateralOf(msg.sender);
        if (amount > free) revert InsufficientFreeCollateral(amount, free);
        uint256 p = pendingOf[msg.sender] + amount;
        pendingOf[msg.sender] = p;
        reqId = ++nextReqId;
        withdrawals[reqId] = Withdrawal(msg.sender, amount, true);
        emit WithdrawRequested(msg.sender, reqId, amount, collateralOf[msg.sender], p);
    }

    function cancelWithdraw(uint256 reqId) external {
        Withdrawal storage w = withdrawals[reqId];
        if (w.user != msg.sender) revert NotRequester();
        if (!w.open) revert NotOpen();
        _close(reqId, false);
    }

    function settleWithdraw(address rvm, uint256 reqId, bool release)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        if (!withdrawals[reqId].open) {
            emit SettlementIgnored(reqId, 1);
            return;
        }
        _close(reqId, release);
    }

    function seize(address rvm, address user, address liquidator, uint256 liqId, uint256 amount)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        if (liquidationSettled[liqId]) {
            emit SettlementIgnored(liqId, 2);
            return;
        }
        liquidationSettled[liqId] = true;
        uint256 c = collateralOf[user];
        if (amount > c) amount = c;
        c -= amount;
        collateralOf[user] = c;
        emit Seized(user, liquidator, liqId, amount, c, pendingOf[user]);
        if (amount > 0 && !asset.transfer(liquidator, amount)) revert TokenTransferFailed();
    }

    function freeCollateralOf(address user) public view returns (uint256) {
        uint256 c = collateralOf[user];
        uint256 p = pendingOf[user];
        return c > p ? c - p : 0;
    }

    function coverDebt() external {
        if (msg.sender != owner) revert NotOwner();
        _coverDebt();
    }

    function withdrawGas(address payable to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _pay(to, amount);
    }

    function _close(uint256 reqId, bool release) internal {
        Withdrawal storage w = withdrawals[reqId];
        w.open = false;
        address user = w.user;
        uint256 amount = w.amount;
        uint256 p = pendingOf[user] - amount;
        pendingOf[user] = p;
        uint256 c = collateralOf[user];
        bool released = release && c >= amount;
        if (released) {
            c -= amount;
            collateralOf[user] = c;
        }
        emit WithdrawSettled(user, reqId, released, c, p);
        if (released && !asset.transfer(user, amount)) revert TokenTransferFailed();
    }
}
