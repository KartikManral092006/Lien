// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {LienHarness} from "./utils/LienHarness.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {IOwnedPriceFeed, PriceController} from "../src/mocks/PriceController.sol";

/// The testnet price controller: anyone can move the demo oracle, within bounds, and the move flows through
/// the ClearingHouse exactly like an owner's would.
contract LienPriceControllerTest is LienHarness {
    PriceController internal pc;
    address internal alice = makeAddr("alice");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant MIN = 500e8;
    uint256 internal constant MAX = 5_000e8;
    uint256 internal constant MOVE_BPS = 3_000;
    uint256 internal constant COOLDOWN = 60;
    uint256 internal constant PER_DAY = 30;

    function setUp() public override {
        super.setUp();
        pc = new PriceController(IOwnedPriceFeed(address(feed)), 2_000e8, MIN, MAX, MOVE_BPS, COOLDOWN, PER_DAY);
        feed.transferOwnership(address(pc));
        vm.warp(1_000_000);
    }

    function _strangerSets(uint256 p) internal {
        vm.prank(stranger);
        pc.setPrice(p);
        _capture();
    }

    function test_strangersPriceDropTriggersTheShield() public {
        _deposit(alice, 1e18);
        _settleAll();
        assertTrue(_borrow(alice, 1_400e6));
        _fundShield(alice, 500e6);
        _settleAll();

        _strangerSets(1_600e8); // -20%: within the public limit
        _settleAll();

        assertEq(market.debtOf(alice), 1_120e6, "shield repaid down to the new limit");
        assertEq(market.shieldOf(alice), 220e6);
        assertFalse(market.liquidatable(alice));
    }

    function test_strangersPriceDropMakesAnUnshieldedAccountLiquidatable() public {
        _deposit(alice, 1e18);
        _settleAll();
        assertTrue(_borrow(alice, 1_400e6));
        _settleAll();

        _strangerSets(1_600e8);
        _settleAll();

        assertTrue(market.liquidatable(alice));
    }

    function test_publicMoveIsCappedAt30Percent() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PriceController.MoveTooLarge.selector, 2_000e8, 1_399e8, MOVE_BPS));
        pc.setPrice(1_399e8);

        _strangerSets(1_400e8); // exactly -30%
        assertEq(feed.price(), 1_400e8);
    }

    function test_publicMoveStaysInRange() public {
        pc.ownerSetPrice(600e8);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PriceController.OutOfRange.selector, 450e8, MIN, MAX));
        pc.setPrice(450e8); // -25% is allowed, but below the $500 floor
    }

    /// Base Sepolia makes 200 ms blocks, so the cooldown is measured in seconds, never in blocks.
    function test_cooldownIsMeasuredInSecondsNotBlocks() public {
        _strangerSets(1_900e8);

        vm.roll(block.number + 10_000); // many blocks, no time
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PriceController.CoolingDown.selector, block.timestamp + COOLDOWN));
        pc.setPrice(1_800e8);

        vm.warp(block.timestamp + COOLDOWN - 1);
        vm.prank(stranger);
        vm.expectRevert();
        pc.setPrice(1_800e8);

        vm.warp(block.timestamp + 1);
        _strangerSets(1_800e8);
        assertEq(feed.price(), 1_800e8);
    }

    function test_dailyCapBoundsTheClearingHousesSpend() public {
        pc.setLimits(MIN, MAX, MOVE_BPS, 0, 3);
        _strangerSets(1_900e8);
        _strangerSets(2_000e8);
        _strangerSets(1_900e8);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PriceController.DailyLimitReached.selector, 3));
        pc.setPrice(2_000e8);

        vm.warp(block.timestamp + 1 days);
        _strangerSets(2_000e8);
    }

    function test_resetIgnoresTheMoveCapButNotTheThrottle() public {
        pc.ownerSetPrice(1_000e8);
        vm.prank(stranger);
        pc.resetPrice(); // +100%
        assertEq(feed.price(), 2_000e8);

        vm.prank(stranger);
        vm.expectRevert(PriceController.NoChange.selector);
        pc.resetPrice();

        pc.ownerSetPrice(1_500e8);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PriceController.CoolingDown.selector, block.timestamp + COOLDOWN));
        pc.resetPrice();
    }

    function test_ownerIsUnthrottledForTheBots() public {
        pc.ownerSetPrice(900e8);
        pc.ownerSetPrice(3_000e8);
        pc.ownerSetPrice(1_600e8);
        assertEq(feed.price(), 1_600e8);
    }

    function test_onlyOwnerCanAdminister() public {
        vm.startPrank(stranger);
        vm.expectRevert(PriceController.NotOwner.selector);
        pc.ownerSetPrice(1_000e8);
        vm.expectRevert(PriceController.NotOwner.selector);
        pc.setLimits(1, MAX, MOVE_BPS, 0, 1_000);
        vm.expectRevert(PriceController.NotOwner.selector);
        pc.returnFeed(stranger);
        vm.expectRevert(PriceController.NotOwner.selector);
        pc.transferOwnership(stranger);
        vm.stopPrank();
    }

    function test_ownerCanTakeTheOracleBack() public {
        pc.returnFeed(address(this));
        assertEq(feed.owner(), address(this));

        vm.prank(stranger);
        vm.expectRevert(MockPriceFeed.NotOwner.selector);
        pc.setPrice(1_900e8);
    }

    function test_statusReportsNextMoveAndMovesLeft() public {
        (uint256 next, uint256 left) = pc.status();
        assertEq(next, 0);
        assertEq(left, PER_DAY);

        _strangerSets(1_900e8);
        (next, left) = pc.status();
        assertEq(next, block.timestamp + COOLDOWN);
        assertEq(left, PER_DAY - 1);

        vm.warp(block.timestamp + 1 days);
        (next, left) = pc.status();
        assertEq(next, 0);
        assertEq(left, PER_DAY);
    }

    function test_rejectsBadLimits() public {
        IOwnedPriceFeed f = IOwnedPriceFeed(address(feed));
        vm.expectRevert(PriceController.BadLimits.selector);
        new PriceController(f, 2_000e8, 0, MAX, MOVE_BPS, COOLDOWN, PER_DAY);
        vm.expectRevert(PriceController.BadLimits.selector);
        new PriceController(f, 2_000e8, MIN, MAX, 10_000, COOLDOWN, PER_DAY);
        vm.expectRevert(PriceController.BadLimits.selector);
        new PriceController(f, 6_000e8, MIN, MAX, MOVE_BPS, COOLDOWN, PER_DAY);
    }
}
