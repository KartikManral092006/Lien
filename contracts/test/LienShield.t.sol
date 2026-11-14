// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {LienHarness} from "./utils/LienHarness.sol";
import {ClearingHouse} from "../src/ClearingHouse.sol";
import {CreditMarket} from "../src/CreditMarket.sol";

/// Auto-protection: a USDC shield on Unichain repays debt before the account can be liquidated.
contract LienShieldTest is LienHarness {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    /// 1 WETH at $2,000, borrowed to the 1,400 USDC limit.
    function _maxedOut(address u) internal {
        _deposit(u, 1e18);
        _settleAll();
        assertTrue(_borrow(u, 1_400e6));
        _settleAll();
    }

    function _chShield(address u) internal view returns (uint256 s) {
        (,,,,,,, s) = ch.accounts(u);
    }

    function _chDebt(address u) internal view returns (uint256 d) {
        (,, d,,,,,) = ch.accounts(u);
    }

    function test_shieldRepaysInsteadOfLiquidationOnCrash() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        // $1,600: value 1,600, liquidation threshold 1,280, debt 1,400 -> would be liquidatable.
        _setPrice(1_600e8);
        _settleAll();

        assertEq(market.limitOf(alice), 1_120e6);
        assertEq(market.debtOf(alice), 1_120e6, "repaid down to the new limit");
        assertEq(market.shieldOf(alice), 220e6, "280 USDC taken from the shield");
        assertFalse(market.liquidatable(alice));
        assertEq(_chDebt(alice), 1_120e6, "ledger mirrors the repay");
        assertEq(_chShield(alice), 220e6);

        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(market), 100e6);
        vm.expectRevert(CreditMarket.NotLiquidatable.selector);
        market.liquidate(alice, 100e6);
        vm.stopPrank();
    }

    /// The flag and the protection travel in the same callback, so there is no moment in which a
    /// liquidator could act first: right after that one callback the account is already safe.
    function test_noWindowBetweenFlagAndProtection() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        _setPrice(1_600e8);
        assertTrue(_deliverBase(), "price event");
        assertEq(cbQ.length, 1, "one callback carries both the limit and the protection");
        assertTrue(_deliverCallback(0));

        assertFalse(market.liquidatable(alice));
        assertEq(market.debtOf(alice), 1_120e6);
    }

    function test_partialShieldStillFlagsAccount() public {
        _maxedOut(alice);
        _fundShield(alice, 100e6);
        _settleAll();

        _setPrice(1_600e8);
        _settleAll();

        // 100 USDC is not enough to get from 1,400 to 1,120; 1,300 is still above the 1,280 threshold.
        assertEq(market.shieldOf(alice), 0);
        assertEq(market.debtOf(alice), 1_300e6);
        assertTrue(market.liquidatable(alice), "conservative: flagged when the shield falls short");
        assertTrue(ch.isUnhealthy(alice));
    }

    function test_protectionStartsBeforeLiquidationThreshold() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        // $1,850: threshold 1,480 (healthy), trigger 75% = 1,387.5 (crossed), new limit 1,295.
        _setPrice(1_850e8);
        _settleAll();

        assertFalse(ch.isUnhealthy(alice));
        assertEq(market.debtOf(alice), 1_295e6);
        assertEq(market.shieldOf(alice), 395e6);
        assertFalse(market.liquidatable(alice));
    }

    function test_smallMovesDoNotSpendTheShield() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        // $1,950: trigger 1,462.5 not crossed. The limit drops to 1,365 but the shield is untouched.
        _setPrice(1_950e8);
        _settleAll();

        assertEq(market.limitOf(alice), 1_365e6);
        assertEq(market.debtOf(alice), 1_400e6);
        assertEq(market.shieldOf(alice), 500e6);
    }

    function test_fundingShieldRescuesFlaggedAccount() public {
        _maxedOut(alice);
        _setPrice(1_600e8);
        _settleAll();
        assertTrue(market.liquidatable(alice));

        _fundShield(alice, 500e6);
        _settleAll();

        assertFalse(market.liquidatable(alice));
        assertEq(market.debtOf(alice), 1_120e6);
        assertEq(market.shieldOf(alice), 220e6);
    }

    function test_duplicateProtectionSpendsShieldOnce() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        _setPrice(1_600e8);
        _deliverBase();
        _setPrice(1_600e8); // same price again: a second protection is sent before the first lands
        _deliverBase();
        assertEq(cbQ.length, 2);
        _deliverCallback(0);
        _deliverCallback(0);
        _settleAll();

        assertEq(market.debtOf(alice), 1_120e6);
        assertEq(market.shieldOf(alice), 220e6, "repays down to the limit, never a fixed amount twice");
    }

    function test_reorderedProtectionsConvergeToLatestLimit() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        _setPrice(1_600e8);
        _deliverBase();
        _setPrice(1_590e8);
        _deliverBase();
        assertEq(cbQ.length, 2);
        _deliverCallback(1); // newer protection first
        _deliverCallback(0); // older one is stale and ignored
        _settleAll();

        uint256 limit = _valueAt(1_590e8, 1e18) * 7_000 / 10_000; // 1,113
        assertEq(market.debtOf(alice), limit);
        assertEq(market.shieldOf(alice), 500e6 - (1_400e6 - limit));
        assertFalse(market.liquidatable(alice));
    }

    function test_shieldWithdrawnWhileProtectionInFlight() public {
        _maxedOut(alice);
        _fundShield(alice, 500e6);
        _settleAll();

        _setPrice(1_600e8);
        _deliverBase();
        _withdrawShield(alice, 500e6);
        _settleAll();

        assertEq(market.shieldOf(alice), 0);
        assertEq(market.debtOf(alice), 1_400e6);
        assertTrue(market.liquidatable(alice), "no shield left: liquidation stays possible");
    }

    function test_shieldIsNeverLentOut() public {
        _deposit(bob, 10_000e18); // credit far above the market's 10M USDC of liquidity
        _settleAll();
        _fundShield(alice, 500e6);

        uint256 avail = market.availableLiquidity();
        assertEq(avail, usdc.balanceOf(address(market)) - 500e6);
        assertFalse(_borrow(bob, avail + 1), "cannot borrow into the shield");
        assertTrue(_borrow(bob, avail));

        _withdrawShield(alice, 500e6);
        assertEq(usdc.balanceOf(alice), 500e6);
    }

    function test_withdrawShieldChecksBalance() public {
        _fundShield(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CreditMarket.ShieldTooSmall.selector, 101e6, 100e6));
        market.withdrawShield(101e6);
    }

    /// Pre-existing gap fixed alongside the shield: a borrow against a stale limit after a crash.
    function test_borrowAgainstStaleLimitIsFlagged() public {
        _deposit(alice, 1e18);
        _settleAll();

        _setPrice(1_600e8);
        _deliverBase(); // ClearingHouse lowers the limit to 1,120; the callback has not landed yet
        assertTrue(_borrow(alice, 1_400e6), "market still has the old 1,400 limit");
        _settleAll();

        assertTrue(ch.isUnhealthy(alice));
        assertTrue(market.liquidatable(alice), "flagged once the debt reaches the ledger");
    }

    function test_riskParamsKeepTriggerBetweenLtvAndThreshold() public {
        vm.expectRevert(ClearingHouse.InvalidParams.selector);
        ch.setRiskParams(7_000, 8_000, 500, 100, 7_000);
        vm.expectRevert(ClearingHouse.InvalidParams.selector);
        ch.setRiskParams(7_000, 8_000, 500, 100, 8_000);
        ch.setRiskParams(7_000, 8_000, 500, 100, 7_800);
        assertEq(ch.protectBps(), 7_800);
    }

    function test_crashProtectingOneFullBatchFitsReactiveGasCap() public {
        uint256 n = ch.BATCH();
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x3000 + i));
            _deposit(u, 1e18);
            _settleAll();
            _borrow(u, 1_400e6);
            _fundShield(u, 500e6);
        }
        _settleAll();

        uint256 before = sys.callbacksCount();
        _setPrice(1_600e8);
        uint256 gasUsed = _deliverBaseMeasured();
        emit log_named_uint("react() gas for a crash protecting every user", gasUsed);
        assertEq(sys.callbacksCount() - before, n);
        assertLt(gasUsed, 900_000);

        _settleAll();
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x3000 + i));
            assertFalse(market.liquidatable(u));
            assertEq(market.debtOf(u), 1_120e6);
        }
    }

    /// Shielded accounts beyond the first batch are protected by the continuation, never left liquidatable.
    function test_crashProtectsAccountsBeyondTheFirstBatch() public {
        uint256 n = 2 * ch.BATCH() + 5;
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x7000 + i));
            _deposit(u, 1e18);
            _settleAll();
            _borrow(u, 1_400e6);
            _fundShield(u, 500e6);
        }
        _settleAll();

        _setPrice(1_600e8);
        _settleAll();
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x7000 + i));
            assertFalse(market.liquidatable(u));
            assertEq(market.debtOf(u), 1_120e6);
        }
    }
}
