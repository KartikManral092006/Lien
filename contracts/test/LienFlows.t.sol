// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {LienHarness} from "./utils/LienHarness.sol";
import {AbstractPayer} from "reactive-lib/base/AbstractPayer.sol";
import {AbstractCallback} from "reactive-lib/base/AbstractCallback.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {CreditMarket} from "../src/CreditMarket.sol";

contract LienFlowsTest is LienHarness {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function test_configureCreatesNineSubscriptions() public view {
        assertEq(sys.subsCount(), 9);
        assertTrue(ch.configured());
        assertEq(ch.price(), PRICE0);
    }

    function test_configureOnlyOnce() public {
        vm.expectRevert(abi.encodeWithSignature("AlreadyConfigured()"));
        ch.configure(BASE, address(vault), address(feed), UNI, address(market), PRICE0);
    }

    function test_reactOnlySystem() public {
        IReactive.LogRecord memory r;
        vm.expectRevert();
        ch.react(r);
    }

    function test_depositGrantsCreditOnOtherChain() public {
        _deposit(alice, 1e18);
        assertEq(market.limitOf(alice), 0);
        _settleAll();
        assertEq(market.limitOf(alice), 1_400e6);
        (uint256 c,,,,,,,) = ch.accounts(alice);
        assertEq(c, 1e18);
    }

    function test_borrowWithinLimitAndOverLimitReverts() public {
        _deposit(alice, 1e18);
        _settleAll();
        assertTrue(_borrow(alice, 1_000e6));
        assertEq(usdc.balanceOf(alice), 1_000e6);
        assertFalse(_borrow(alice, 401e6));
        assertTrue(_borrow(alice, 400e6));
        _settleAll();
        (,, uint256 d,,,,,) = ch.accounts(alice);
        assertEq(d, 1_400e6);
    }

    function test_withdrawTwoPhaseReleasesWhenSafe() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 700e6);
        _requestWithdraw(alice, 0.4e18);
        assertEq(vault.pendingOf(alice), 0.4e18);
        _settleAll();
        assertEq(vault.collateralOf(alice), 0.6e18);
        assertEq(vault.pendingOf(alice), 0);
        assertEq(weth.balanceOf(alice), 0.4e18);
        assertEq(market.limitOf(alice), 840e6);
    }

    function test_withdrawRejectedImmediatelyWhenDebtTooHigh() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 1_200e6);
        _settleAll();
        _requestWithdraw(alice, 0.4e18);
        _settleAll();
        assertEq(vault.collateralOf(alice), 1e18);
        assertEq(vault.pendingOf(alice), 0);
        assertEq(weth.balanceOf(alice), 0);
        assertEq(market.limitOf(alice), 1_400e6);
    }

    function test_raceBorrowInsideWithdrawWindowIsCaught() public {
        _deposit(alice, 1e18);
        _settleAll();
        _requestWithdraw(alice, 0.5e18);
        assertTrue(_deliverBase());
        assertEq(market.limitOf(alice), 1_400e6);
        assertTrue(_borrow(alice, 1_400e6));
        _settleAll();
        assertEq(vault.collateralOf(alice), 1e18);
        assertEq(vault.pendingOf(alice), 0);
        assertEq(weth.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 1_400e6);
        assertEq(market.limitOf(alice), 1_400e6);
    }

    function test_borrowAfterLimitLoweredIsBlocked() public {
        _deposit(alice, 1e18);
        _settleAll();
        _requestWithdraw(alice, 0.5e18);
        _deliverBase();
        _deliverCallback(0);
        assertEq(market.limitOf(alice), 700e6);
        assertFalse(_borrow(alice, 701e6));
        _settleAll();
        assertEq(weth.balanceOf(alice), 0.5e18);
        assertEq(vault.collateralOf(alice), 0.5e18);
    }

    function test_priceDropFlagsAndCrossChainLiquidation() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 1_400e6);
        _settleAll();
        _setPrice(1_600e8);
        _settleAll();
        assertTrue(market.liquidatable(alice));
        assertEq(market.limitOf(alice), 1_120e6);

        _liquidate(bob, alice, 1_000e6);
        assertEq(market.debtOf(alice), 700e6);
        _settleAll();

        assertEq(weth.balanceOf(bob), 0.459375e18);
        assertEq(vault.collateralOf(alice), 0.540625e18);
        assertTrue(market.liquidatable(alice));
    }

    function test_repayClearsLiquidatableFlag() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 1_400e6);
        _settleAll();
        _setPrice(1_600e8);
        _settleAll();
        assertTrue(market.liquidatable(alice));
        _repay(alice, 200e6);
        _settleAll();
        assertFalse(market.liquidatable(alice));
    }

    function test_liquidatableAccountCannotBorrowOrWithdraw() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 1_400e6);
        _settleAll();
        _setPrice(1_500e8);
        _settleAll();
        assertFalse(_borrow(alice, 1e6));
        _requestWithdraw(alice, 0.01e18);
        _settleAll();
        assertEq(vault.collateralOf(alice), 1e18);
        assertEq(weth.balanceOf(alice), 0);
    }

    function test_cancelThenLateReleaseIsIgnored() public {
        _deposit(alice, 1e18);
        _settleAll();
        uint256 reqId = _requestWithdraw(alice, 0.5e18);
        _deliverBase();
        _cancel(alice, reqId);
        _settleAll();
        assertEq(vault.pendingOf(alice), 0);
        assertEq(vault.collateralOf(alice), 1e18);
        assertEq(market.limitOf(alice), 1_400e6);

        vm.prank(BASE_PROXY);
        vault.settleWithdraw(address(ch), reqId, true);
        assertEq(weth.balanceOf(alice), 0);
        assertEq(vault.collateralOf(alice), 1e18);
    }

    function test_priceIncreaseRaisesLimitButTinyMovesAreBatched() public {
        _deposit(alice, 1e18);
        _settleAll();
        uint256 before = sys.callbacksCount();
        _setPrice(2_010e8);
        _settleAll();
        assertEq(sys.callbacksCount(), before);
        assertEq(market.limitOf(alice), 1_400e6);
        _setPrice(2_100e8);
        _settleAll();
        assertEq(market.limitOf(alice), 1_470e6);
    }

    function test_noAccountCapEveryDepositorGetsCredit() public {
        uint256 n = 5 * ch.BATCH();
        for (uint256 i = 0; i < n; i++) {
            _deposit(address(uint160(0x1000 + i)), 1e18);
        }
        _settleAll();
        assertEq(ch.usersCount(), n);
        assertEq(market.limitOf(address(uint160(0x1000 + n - 1))), 1_400e6);
    }

    /// 27 borrowers at the limit, then a crash: every one is flagged, in batches that each fit the gas cap.
    function test_priceUpdateRechecksEveryAccountInBatches() public {
        uint256 n = 3 * ch.BATCH() + 3;
        _borrowers(0x4000, n, 1_400e6);

        _setPrice(1_600e8);
        uint256 gasUsed = _deliverBaseMeasured();
        emit log_named_uint("react() gas, first batch of a price update", gasUsed);
        assertLt(gasUsed, 900_000);
        assertEq(ch.repriceCursor(), ch.BATCH());

        uint256 batches = 1;
        while (true) {
            (bool found,) = _selfCallbackIndex();
            if (!found) break;
            uint256 g = _deliverSelfCallbackMeasured();
            emit log_named_uint("continuation gas, one further batch", g);
            assertLt(g, 900_000);
            batches++;
        }
        assertEq(batches, 4);
        assertEq(ch.repriceCursor(), n);

        _settleAll();
        for (uint256 i = 0; i < n; i++) {
            assertTrue(market.liquidatable(address(uint160(0x4000 + i))));
        }
    }

    /// A second price arriving mid-pass restarts the re-check; the first pass's continuation does nothing.
    function test_newerPriceRestartsThePass() public {
        uint256 n = 2 * ch.BATCH() + 4;
        _borrowers(0x5000, n, 1_400e6);

        _setPrice(1_600e8);
        _deliverBase(); // first batch flagged, continuation for pass 1 queued
        _setPrice(2_000e8);
        _deliverBase(); // pass 2 starts from the first account
        assertEq(ch.repriceEpoch(), 2);
        assertEq(ch.repriceCursor(), ch.BATCH());

        _settleAll();
        assertEq(ch.repriceCursor(), n);
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x5000 + i));
            assertFalse(market.liquidatable(u));
            assertEq(market.limitOf(u), 1_400e6);
        }
    }

    /// Anyone may call continueReprice, but it only ever runs the next unprocessed batch of the current pass,
    /// so each account is re-checked exactly once per price and a finished or stale pass costs nothing.
    function test_continueRepriceIsSafeForAnyone() public {
        uint256 n = 2 * ch.BATCH() + 4;
        _borrowers(0x6000, n, 1_400e6);
        uint64[] memory seqBefore = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            seqBefore[i] = market.lastSeq(address(uint160(0x6000 + i)));
        }

        _setPrice(1_600e8);
        _deliverBase();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        ch.continueReprice(stranger, 1); // front-runs the contract's own continuation
        _capture();
        _settleAll();

        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x6000 + i));
            assertTrue(market.liquidatable(u));
            assertEq(market.lastSeq(u), seqBefore[i] + 1, "each account synced once per price");
        }

        uint256 before = sys.callbacksCount();
        vm.prank(stranger);
        ch.continueReprice(stranger, 1); // pass finished
        vm.prank(stranger);
        ch.continueReprice(stranger, 0); // stale pass
        assertEq(sys.callbacksCount(), before);
    }

    function _borrowers(uint160 first, uint256 n, uint256 amount) internal {
        for (uint256 i = 0; i < n; i++) {
            address u = address(first + uint160(i));
            _deposit(u, 1e18);
            _settleAll();
            assertTrue(_borrow(u, amount));
        }
        _settleAll();
    }

    function test_callbacksRejectStrangers() public {
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), UNI_PROXY));
        market.sync(address(ch), alice, 1e12, false, 1, 0, false);

        vm.prank(UNI_PROXY);
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(ch)));
        market.sync(bob, alice, 1e12, false, 1, 0, false);

        vm.prank(BASE_PROXY);
        vm.expectRevert(abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(ch)));
        vault.seize(bob, alice, bob, 1, 1e18);
    }

    function test_staleSyncIsIgnored() public {
        vm.prank(UNI_PROXY);
        market.sync(address(ch), alice, 500e6, false, 5, 0, false);
        vm.prank(UNI_PROXY);
        market.sync(address(ch), alice, 900e6, false, 4, 0, false);
        assertEq(market.limitOf(alice), 500e6);
        assertEq(market.lastSeq(alice), 5);
    }

    function test_duplicateSeizeIsIgnored() public {
        _deposit(alice, 1e18);
        vm.prank(BASE_PROXY);
        vault.seize(address(ch), alice, bob, 7, 0.1e18);
        vm.prank(BASE_PROXY);
        vault.seize(address(ch), alice, bob, 7, 0.1e18);
        assertEq(weth.balanceOf(bob), 0.1e18);
    }

    function test_priceUpdateForOneFullBatchFitsReactiveGasCap() public {
        uint256 n = ch.BATCH();
        for (uint256 i = 0; i < n; i++) {
            address u = address(uint160(0x2000 + i));
            _deposit(u, 1e18);
            _settleAll();
            _borrow(u, 1_400e6);
        }
        _settleAll();
        uint256 before = sys.callbacksCount();
        _setPrice(1_600e8);
        uint256 gasUsed = _deliverBaseMeasured();
        emit log_named_uint("react() gas for a price update re-syncing every user", gasUsed);
        assertEq(sys.callbacksCount() - before, n);
        assertLt(gasUsed, 900_000);
    }

    function test_liquidationRequiresFlag() public {
        _deposit(alice, 1e18);
        _settleAll();
        _borrow(alice, 1_000e6);
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(market), 100e6);
        vm.expectRevert(CreditMarket.NotLiquidatable.selector);
        market.liquidate(alice, 100e6);
        vm.stopPrank();
    }
}
