// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {IERC20Min, IVaultEvents} from "../src/interfaces/ILien.sol";
import {LienHarness} from "./utils/LienHarness.sol";

/// A token whose transfers report failure instead of reverting, as some ERC-20s do.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function balanceOf(address) external pure returns (uint256) {
        return type(uint128).max;
    }
}

/// The guard paths of the two contracts that hold funds: zero amounts, caps, owner checks,
/// failed token transfers, and settlements that arrive after the request already closed.
contract LienGuardsTest is LienHarness {
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    // ---------------------------------------------------------------- CollateralVault

    function test_vaultRejectsZeroAmounts() public {
        vm.startPrank(alice);
        vm.expectRevert(CollateralVault.ZeroAmount.selector);
        vault.deposit(0);
        vm.expectRevert(CollateralVault.ZeroAmount.selector);
        vault.requestWithdraw(0);
        vm.stopPrank();
    }

    function test_withdrawCannotExceedFreeCollateral() public {
        _deposit(alice, 1e18);
        _requestWithdraw(alice, 0.6e18);
        // 0.6 is already pending, so only 0.4 is free.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CollateralVault.InsufficientFreeCollateral.selector, 0.5e18, 0.4e18));
        vault.requestWithdraw(0.5e18);
        assertEq(vault.freeCollateralOf(alice), 0.4e18);
    }

    function test_cancelOnlyByRequesterAndOnlyOnce() public {
        _deposit(alice, 1e18);
        uint256 reqId = _requestWithdraw(alice, 1e18);

        vm.prank(bob);
        vm.expectRevert(CollateralVault.NotRequester.selector);
        vault.cancelWithdraw(reqId);

        _cancel(alice, reqId);
        assertEq(vault.pendingOf(alice), 0);

        vm.prank(alice);
        vm.expectRevert(CollateralVault.NotOpen.selector);
        vault.cancelWithdraw(reqId);
    }

    function test_settlementAfterCancelIsIgnored() public {
        _deposit(alice, 1e18);
        uint256 reqId = _requestWithdraw(alice, 1e18);
        _cancel(alice, reqId);

        vm.expectEmit(address(vault));
        emit IVaultEvents.SettlementIgnored(reqId, 1);
        vm.prank(BASE_PROXY);
        vault.settleWithdraw(address(ch), reqId, true);

        assertEq(weth.balanceOf(alice), 0, "a late release must not pay out");
        assertEq(vault.collateralOf(alice), 1e18);
    }

    function test_releaseAfterSeizureDoesNotOverpay() public {
        _deposit(alice, 1e18);
        uint256 reqId = _requestWithdraw(alice, 1e18);
        // The collateral is seized while the withdrawal is still pending.
        vm.prank(BASE_PROXY);
        vault.seize(address(ch), alice, bob, 1, 1e18);
        assertEq(weth.balanceOf(bob), 1e18);

        vm.prank(BASE_PROXY);
        vault.settleWithdraw(address(ch), reqId, true);
        assertEq(weth.balanceOf(alice), 0, "nothing left to release");
        assertEq(vault.pendingOf(alice), 0, "pending is cleared either way");
        (,, bool open) = vault.withdrawals(reqId);
        assertFalse(open);
    }

    function test_seizeIsCappedAtCollateral() public {
        _deposit(alice, 1e18);
        vm.prank(BASE_PROXY);
        vault.seize(address(ch), alice, bob, 7, 5e18);
        assertEq(weth.balanceOf(bob), 1e18);
        assertEq(vault.collateralOf(alice), 0);

        // A second liquidation of an emptied account seizes nothing and transfers nothing.
        vm.prank(BASE_PROXY);
        vault.seize(address(ch), alice, bob, 8, 1e18);
        assertEq(weth.balanceOf(bob), 1e18);
    }

    function test_vaultOwnerFunctions() public {
        vm.startPrank(alice);
        vm.expectRevert(CollateralVault.NotOwner.selector);
        vault.coverDebt();
        vm.expectRevert(CollateralVault.NotOwner.selector);
        vault.withdrawGas(payable(alice), 0);
        vm.stopPrank();

        vm.deal(address(vault), 1 ether);
        vault.withdrawGas(payable(bob), 0.4 ether);
        assertEq(bob.balance, 0.4 ether);
        assertEq(address(vault).balance, 0.6 ether);
    }

    function test_vaultRevertsWhenTokenReportsFailure() public {
        FalseToken t = new FalseToken();
        CollateralVault v = new CollateralVault(IPayable(payable(BASE_PROXY)), address(ch), IERC20Min(address(t)));
        vm.prank(alice);
        vm.expectRevert(CollateralVault.TokenTransferFailed.selector);
        v.deposit(1e18);
    }

    // ---------------------------------------------------------------- CreditMarket

    function _setLimit(address u, uint256 limit, bool liq, uint64 seq) internal {
        vm.prank(UNI_PROXY);
        market.sync(address(ch), u, limit, liq, seq, 0, false);
    }

    function test_marketRejectsZeroAmounts() public {
        vm.startPrank(alice);
        vm.expectRevert(CreditMarket.ZeroAmount.selector);
        market.supply(0);
        vm.expectRevert(CreditMarket.ZeroAmount.selector);
        market.borrow(0);
        vm.expectRevert(CreditMarket.ZeroAmount.selector);
        market.repay(alice, 1e6); // no debt, so the amount is capped to 0
        vm.expectRevert(CreditMarket.ZeroAmount.selector);
        market.fundShield(0);
        vm.expectRevert(CreditMarket.ZeroAmount.selector);
        market.withdrawShield(0);
        vm.stopPrank();
    }

    function test_borrowRespectsLimitAndFlag() public {
        _setLimit(alice, 1_000e6, false, 1);
        assertTrue(_borrow(alice, 800e6));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditMarket.CreditLimitExceeded.selector, 300e6, 200e6));
        market.borrow(300e6);

        // The limit drops below the debt: nothing more is available.
        _setLimit(alice, 500e6, false, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditMarket.CreditLimitExceeded.selector, 1e6, 0));
        market.borrow(1e6);
        assertEq(market.availableCredit(alice), 0);

        _setLimit(alice, 2_000e6, true, 3);
        vm.prank(alice);
        vm.expectRevert(CreditMarket.AccountLiquidatable.selector);
        market.borrow(1e6);
        assertEq(market.availableCredit(alice), 0);
    }

    function test_borrowCannotExceedLiquidityOrTouchShields() public {
        // Everything but 1,000 USDC is lent out, and alice's 600 USDC shield is not lendable.
        _setLimit(bob, 10_000_000e6, false, 1);
        assertTrue(_borrow(bob, 9_999_000e6));
        _fundShield(alice, 600e6);
        assertEq(market.availableLiquidity(), 1_000e6);

        _setLimit(alice, 5_000e6, false, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditMarket.InsufficientLiquidity.selector, 1_001e6, 1_000e6));
        market.borrow(1_001e6);
    }

    function test_repayIsCappedAtDebt() public {
        _setLimit(alice, 1_000e6, false, 1);
        assertTrue(_borrow(alice, 300e6));
        usdc.mint(alice, 500e6);
        vm.startPrank(alice);
        usdc.approve(address(market), type(uint256).max);
        market.repay(alice, 500e6);
        vm.stopPrank();
        assertEq(market.debtOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 500e6, "only the 300 owed is taken");
    }

    function test_liquidationGuards() public {
        vm.expectRevert(CreditMarket.NotLiquidatable.selector);
        market.liquidate(alice, 1e6);

        _setLimit(alice, 1_000e6, false, 1);
        assertTrue(_borrow(alice, 1_000e6));
        _setLimit(alice, 500e6, true, 2);
        // The close factor caps one liquidation at half the debt.
        _liquidate(bob, alice, 900e6);
        assertEq(market.debtOf(alice), 500e6);
        assertFalse(market.liquidatable(alice), "flag cleared until the ClearingHouse re-checks");
    }

    function test_dustDebtCanBeLiquidatedInFull() public {
        _setLimit(alice, 1_000e6, false, 1);
        assertTrue(_borrow(alice, 1)); // 1 unit: half of it rounds to 0
        _setLimit(alice, 0, true, 2);
        _liquidate(bob, alice, 1);
        assertEq(market.debtOf(alice), 0);
    }

    function test_withdrawShieldCannotExceedShield() public {
        _fundShield(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditMarket.ShieldTooSmall.selector, 101e6, 100e6));
        market.withdrawShield(101e6);
    }

    function test_marketOwnerFunctions() public {
        vm.startPrank(alice);
        vm.expectRevert(CreditMarket.NotOwner.selector);
        market.coverDebt();
        vm.expectRevert(CreditMarket.NotOwner.selector);
        market.withdrawGas(payable(alice), 0);
        vm.stopPrank();

        vm.deal(address(market), 1 ether);
        market.withdrawGas(payable(bob), 1 ether);
        assertEq(bob.balance, 1 ether);
    }

    function test_marketRevertsWhenTokenReportsFailure() public {
        FalseToken t = new FalseToken();
        CreditMarket m = new CreditMarket(IPayable(payable(UNI_PROXY)), address(ch), IERC20Min(address(t)));
        vm.startPrank(alice);
        vm.expectRevert(CreditMarket.TokenTransferFailed.selector);
        m.supply(1e6);
        vm.expectRevert(CreditMarket.TokenTransferFailed.selector);
        m.fundShield(1e6);
        vm.stopPrank();

        vm.prank(UNI_PROXY);
        m.sync(address(ch), alice, 1_000e6, false, 1, 0, false);
        vm.prank(alice);
        vm.expectRevert(CreditMarket.TokenTransferFailed.selector);
        m.borrow(1e6);
    }
}
