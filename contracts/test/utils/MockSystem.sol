// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";

contract MockSystem {
    struct Sub {
        uint256 chainId;
        address target;
        uint256 topic0;
    }

    event CallbackRequested(uint256 chainId, address recipient, uint64 gasLimit, bytes payload);

    Sub[] public subs;
    uint256 public callbacksCount;

    receive() external payable {}

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function subscribe(uint256 chainId, address target, uint256 topic0, uint256, uint256, uint256) external {
        subs.push(Sub(chainId, target, topic0));
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external {}

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config) external {
        callbacksCount++;
        emit CallbackRequested(config.chainId, config.recipient, config.gasLimit, config.payload);
    }

    function subsCount() external view returns (uint256) {
        return subs.length;
    }
}
