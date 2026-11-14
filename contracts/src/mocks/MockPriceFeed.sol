// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPriceFeedEvents} from "../interfaces/ILien.sol";

contract MockPriceFeed is IPriceFeedEvents {
    address public owner;
    uint256 public price;
    uint256 public updatedAt;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroPrice();
    error ZeroAddress();

    constructor(uint256 initialPrice) {
        owner = msg.sender;
        _set(initialPrice);
    }

    function setPrice(uint256 newPrice) external {
        if (msg.sender != owner) revert NotOwner();
        _set(newPrice);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _set(uint256 newPrice) internal {
        if (newPrice == 0) revert ZeroPrice();
        price = newPrice;
        updatedAt = block.timestamp;
        emit PriceUpdated(newPrice, block.timestamp);
    }
}
