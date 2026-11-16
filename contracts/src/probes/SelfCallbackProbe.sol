// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "reactive-lib/base/AbstractReactive.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";

/// Diagnostic only, never part of the protocol. Answers one question on Lasna: are callbacks a reactive
/// contract sends to itself (chainId = block.chainid, recipient = address(this)) delivered, and does the
/// requested gas limit matter? ClearingHouse's batched re-pricing depends on this.
///
/// Trigger: mint any amount of the test WETH on Base Sepolia *to this contract's address*. The subscription
/// filters on that recipient, so ordinary protocol activity never triggers it. Each trigger requests four
/// self-callbacks (150k, 300k, 500k, 700k gas). The 300k one also tries to request a further callback from
/// inside the callback, which is what ClearingHouse.continueReprice does for a third batch.
contract SelfCallbackProbe is AbstractReactive {
    uint256 private constant T_TRANSFER = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 private constant CHAINED_GAS = 200_000;

    address public immutable owner;
    uint256 public rounds;

    event Requested(uint256 indexed round, uint256 gasLimit);
    event Pinged(uint256 indexed round, uint256 gasLimit, address caller, address injected, uint256 gasLeft);
    event Chained(uint256 indexed round, bool ok, bytes reason);

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() payable {
        owner = msg.sender;
    }

    function start(uint256 chainId, address token) external onlyOwner {
        SYSTEM.subscribe(chainId, token, T_TRANSFER, REACTIVE_IGNORE, uint256(uint160(address(this))), REACTIVE_IGNORE);
    }

    function react(LogRecord calldata) external onlySystem {
        uint256 r = ++rounds;
        uint64[4] memory limits = [uint64(150_000), 300_000, 500_000, 700_000];
        // The only external call is to the trusted system contract.
        // forge-lint: disable-start(calls-loop, reentrancy-events)
        for (uint256 i = 0; i < limits.length; i++) {
            _request(limits[i], abi.encodeCall(this.ping, (address(0), r, limits[i], i == 1)));
            emit Requested(r, limits[i]);
        }
        // forge-lint: disable-end(calls-loop, reentrancy-events)
    }

    /// Records who delivered the callback and with how much gas. Only a delivery from the system contract may
    /// chain a further request, so outsiders cannot spend the probe's balance.
    function ping(address injected, uint256 round, uint256 gasLimit, bool chain) external {
        emit Pinged(round, gasLimit, msg.sender, injected, gasleft());
        if (chain && msg.sender == address(SYSTEM)) _tryChain(round);
    }

    /// Same question as the chained ping, asked from an ordinary transaction: can requestCallback be called
    /// outside react()? Answers immediately, without waiting for any delivery.
    function poke() external onlyOwner {
        _tryChain(0);
    }

    function withdraw() external onlyOwner {
        _pay(payable(owner), address(this).balance);
    }

    function _tryChain(uint256 round) internal {
        bytes memory payload = abi.encodeCall(this.ping, (address(0), round, CHAINED_GAS, false));
        // CHAINED_GAS is a small constant; the only external call is to the trusted system contract.
        // forge-lint: disable-start(unsafe-typecast, reentrancy-events)
        try SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: block.chainid, recipient: address(this), gasLimit: uint64(CHAINED_GAS), payload: payload
            })
        ) {
            emit Chained(round, true, "");
        } catch (bytes memory reason) {
            emit Chained(round, false, reason);
        }
        // forge-lint: disable-end(unsafe-typecast, reentrancy-events)
    }

    function _request(uint64 gasLimit, bytes memory payload) internal {
        // forge-lint: disable-start(calls-loop)
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: block.chainid, recipient: address(this), gasLimit: gasLimit, payload: payload
            })
        );
        // forge-lint: disable-end(calls-loop)
    }
}
