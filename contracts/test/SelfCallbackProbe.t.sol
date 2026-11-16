// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {SelfCallbackProbe} from "../src/probes/SelfCallbackProbe.sol";
import {MockSystem} from "./utils/MockSystem.sol";

contract SelfCallbackProbeTest is Test {
    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;
    MockSystem internal sys;
    SelfCallbackProbe internal probe;

    function setUp() public {
        MockSystem impl = new MockSystem();
        vm.etch(SYSTEM_ADDR, address(impl).code);
        sys = MockSystem(payable(SYSTEM_ADDR));
        probe = new SelfCallbackProbe{value: 1 ether}();
        probe.start(84532, address(0xBEEF));
    }

    function _log() internal pure returns (IReactive.LogRecord memory r) {
        r.chainId = 84532;
        r.contractAddress = address(0xBEEF);
    }

    function test_subscribesToMintsToItself() public view {
        (uint256 chainId, address target, uint256 topic0) = sys.subs(0);
        assertEq(chainId, 84532);
        assertEq(target, address(0xBEEF));
        assertEq(topic0, uint256(keccak256("Transfer(address,address,uint256)")));
    }

    function test_reactRequestsFourSelfCallbacksThatDecodeAndRun() public {
        vm.recordLogs();
        vm.prank(SYSTEM_ADDR);
        probe.react(_log());
        assertEq(sys.callbacksCount(), 4);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 delivered;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != SYSTEM_ADDR || logs[i].topics[0] != MockSystem.CallbackRequested.selector) continue;
            (uint256 chainId, address recipient, uint64 gasLimit, bytes memory payload) =
                abi.decode(logs[i].data, (uint256, address, uint64, bytes));
            assertEq(chainId, block.chainid);
            assertEq(recipient, address(probe));
            // Deliver it the way the network would: from the system contract, with the requested gas.
            vm.prank(SYSTEM_ADDR);
            (bool ok,) = recipient.call{gas: gasLimit}(payload);
            assertTrue(ok);
            delivered++;
        }
        assertEq(delivered, 4);
        // The 300k delivery chained one more request.
        assertEq(sys.callbacksCount(), 5);
    }

    function test_onlySystemCanReact() public {
        vm.expectRevert();
        probe.react(_log());
    }

    function test_outsiderPingCannotSpendFunds() public {
        probe.ping(address(0), 1, 300_000, true);
        assertEq(sys.callbacksCount(), 0);
    }

    function test_pokeAndWithdraw() public {
        probe.poke();
        assertEq(sys.callbacksCount(), 1);
        uint256 before = address(this).balance;
        probe.withdraw();
        assertEq(address(this).balance, before + 1 ether);
        assertEq(address(probe).balance, 0);
    }

    receive() external payable {}
}
