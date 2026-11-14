// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {LienHarness} from "./utils/LienHarness.sol";

contract LienFuzzTest is LienHarness {
    address[3] internal actors;
    uint256[] internal openReqs;

    function setUp() public override {
        super.setUp();
        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");
    }

    function testFuzz_randomCrossChainOrderingNeverUndercollateralizes(uint256 seed) public {
        for (uint256 i = 0; i < 60; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address u = actors[(r >> 8) % 3];
            uint256 action = r % 9;

            if (action == 0) {
                _deposit(u, 0.01e18 + (r >> 16) % 2e18);
            } else if (action == 1) {
                uint256 avail = market.availableCredit(u);
                if (avail > 0) _borrow(u, 1 + (r >> 16) % avail);
            } else if (action == 2) {
                uint256 d = market.debtOf(u);
                if (d > 0) _repay(u, 1 + (r >> 16) % d);
            } else if (action == 3) {
                uint256 free = vault.freeCollateralOf(u);
                if (free > 0) openReqs.push(_requestWithdraw(u, 1 + (r >> 16) % free));
            } else if (action == 4) {
                _cancelSome(r);
            } else if (action == 5) {
                _deliverBase();
            } else if (action == 6) {
                _deliverUni();
            } else if (action == 7) {
                if (cbQ.length > 0) _deliverCallback((r >> 16) % cbQ.length);
            } else {
                uint256 avail = market.availableCredit(u);
                if (avail > 0) _borrow(u, avail);
            }
            _checkSolvency();
        }

        _settleAll();
        _checkSolvency();
        _checkNoStuckWithdrawals();
        _checkLimitsNeverExceedCollateral();
    }

    function testFuzz_reverseCallbackOrderStillSafe(uint256 seed) public {
        address u = actors[0];
        _deposit(u, 1e18);
        _settleAll();
        for (uint256 i = 0; i < 6; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 free = vault.freeCollateralOf(u);
            if (free > 0) _requestWithdraw(u, 1 + r % free);
            _deliverBase();
            uint256 avail = market.availableCredit(u);
            if (avail > 0) _borrow(u, avail);
        }
        while (cbQ.length > 0 || _pendingBase() > 0 || _pendingUni() > 0) {
            if (cbQ.length > 0) _deliverCallback(cbQ.length - 1);
            else if (_pendingUni() > 0) _deliverUni();
            else _deliverBase();
            _checkSolvency();
        }
        _checkNoStuckWithdrawals();
    }

    function _cancelSome(uint256 r) internal {
        uint256 n = openReqs.length;
        if (n == 0) return;
        uint256 k = (r >> 16) % n;
        uint256 reqId = openReqs[k];
        openReqs[k] = openReqs[n - 1];
        openReqs.pop();
        (address user,, bool open) = vault.withdrawals(reqId);
        if (open) _cancel(user, reqId);
    }

    function _checkSolvency() internal view {
        uint256 p = feed.price();
        for (uint256 i = 0; i < 3; i++) {
            address u = actors[i];
            uint256 maxDebt = _valueAt(p, vault.collateralOf(u)) * ch.ltvBps() / 10_000;
            assertLe(market.debtOf(u), maxDebt, "debt exceeds collateral-backed credit");
        }
    }

    function _checkNoStuckWithdrawals() internal view {
        uint256 n = vault.nextReqId();
        for (uint256 id = 1; id <= n; id++) {
            (,, bool open) = vault.withdrawals(id);
            assertFalse(open, "withdrawal left open after full settlement");
        }
        for (uint256 i = 0; i < 3; i++) {
            assertEq(vault.pendingOf(actors[i]), 0);
            assertEq(ch.awaitingOf(actors[i]).length, 0);
        }
    }

    function _checkLimitsNeverExceedCollateral() internal view {
        for (uint256 i = 0; i < 3; i++) {
            address u = actors[i];
            assertLe(market.limitOf(u), ch.limitFor(vault.freeCollateralOf(u)));
        }
    }
}
