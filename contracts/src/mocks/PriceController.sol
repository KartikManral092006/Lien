// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IOwnedPriceFeed {
    function price() external view returns (uint256);
    function setPrice(uint256 newPrice) external;
    function transferOwnership(address newOwner) external;
}

/// @title PriceController (testnet only)
/// @notice Owns the demo oracle and lets anyone move it within bounds, so a visitor can trigger a shield
///         repayment or a liquidation with their own wallet and watch Reactive settle it across chains.
/// @dev Every price move makes the ClearingHouse react on Lasna, which costs it lREACT. The cooldown and the
///      daily cap bound that spend. All timing uses block.timestamp (Base Sepolia makes 200 ms blocks, so
///      block counts are not a usable clock). The owner keeps an unthrottled path for the demo and
///      benchmark bots, and can hand the oracle back at any time.
contract PriceController {
    IOwnedPriceFeed public immutable feed;
    uint256 public immutable defaultPrice;
    address public owner;

    uint256 public minPrice;
    uint256 public maxPrice;
    /// Largest public move, in basis points of the current price.
    uint256 public maxMoveBps;
    /// Seconds between public moves.
    uint256 public cooldown;
    /// Public moves allowed per UTC day.
    uint256 public maxMovesPerDay;

    uint256 public lastMoveAt;
    uint256 public day;
    uint256 public movesToday;

    event PriceMoved(address indexed by, uint256 from, uint256 to);
    event LimitsSet(uint256 minPrice, uint256 maxPrice, uint256 maxMoveBps, uint256 cooldown, uint256 maxMovesPerDay);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error BadLimits();
    error NoChange();
    error OutOfRange(uint256 price, uint256 min, uint256 max);
    error MoveTooLarge(uint256 from, uint256 to, uint256 maxMoveBps);
    error CoolingDown(uint256 nextMoveAt);
    error DailyLimitReached(uint256 maxMovesPerDay);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IOwnedPriceFeed feed_,
        uint256 defaultPrice_,
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxMoveBps_,
        uint256 cooldown_,
        uint256 maxMovesPerDay_
    ) {
        if (address(feed_) == address(0)) revert ZeroAddress();
        feed = feed_;
        owner = msg.sender;
        _setLimits(minPrice_, maxPrice_, maxMoveBps_, cooldown_, maxMovesPerDay_);
        if (defaultPrice_ < minPrice_ || defaultPrice_ > maxPrice_) revert BadLimits();
        defaultPrice = defaultPrice_;
    }

    /// @notice Anyone: move the price by at most maxMoveBps, within [minPrice, maxPrice].
    function setPrice(uint256 newPrice) external {
        uint256 from = feed.price();
        if (newPrice == from) revert NoChange();
        if (newPrice < minPrice || newPrice > maxPrice) revert OutOfRange(newPrice, minPrice, maxPrice);
        uint256 diff = newPrice > from ? newPrice - from : from - newPrice;
        if (diff * 10_000 > from * maxMoveBps) revert MoveTooLarge(from, newPrice, maxMoveBps);
        _throttle();
        _move(from, newPrice);
    }

    /// @notice Anyone: put the price back to its default, however far away it is. Shares the throttle.
    function resetPrice() external {
        uint256 from = feed.price();
        if (from == defaultPrice) revert NoChange();
        _throttle();
        _move(from, defaultPrice);
    }

    /// @notice Owner: any price, no throttle. Used by the demo and benchmark bots.
    function ownerSetPrice(uint256 newPrice) external onlyOwner {
        _move(feed.price(), newPrice);
    }

    function setLimits(
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxMoveBps_,
        uint256 cooldown_,
        uint256 maxMovesPerDay_
    ) external onlyOwner {
        _setLimits(minPrice_, maxPrice_, maxMoveBps_, cooldown_, maxMovesPerDay_);
    }

    /// @notice Owner: give the oracle back (or to a new controller).
    function returnFeed(address to) external onlyOwner {
        feed.transferOwnership(to);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice When the next public move is allowed (0 = now), and how many are left today.
    function status() external view returns (uint256 nextMoveAt, uint256 movesLeftToday) {
        uint256 next = lastMoveAt + cooldown;
        // forge-lint: disable-next-line(block-timestamp)
        nextMoveAt = block.timestamp >= next ? 0 : next;
        // forge-lint: disable-next-line(block-timestamp)
        uint256 used = block.timestamp / 1 days == day ? movesToday : 0;
        movesLeftToday = used >= maxMovesPerDay ? 0 : maxMovesPerDay - used;
    }

    function _throttle() internal {
        // Timestamps on purpose (200 ms blocks on Base); a few seconds of validator drift is harmless here.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastMoveAt != 0 && block.timestamp < lastMoveAt + cooldown) revert CoolingDown(lastMoveAt + cooldown);
        uint256 today = block.timestamp / 1 days;
        // forge-lint: disable-next-line(block-timestamp)
        if (today != day) {
            day = today;
            movesToday = 0;
        }
        if (movesToday >= maxMovesPerDay) revert DailyLimitReached(maxMovesPerDay);
        movesToday += 1;
        lastMoveAt = block.timestamp;
    }

    function _move(uint256 from, uint256 to) internal {
        emit PriceMoved(msg.sender, from, to); // before the call; a failed setPrice reverts both
        feed.setPrice(to);
    }

    function _setLimits(
        uint256 minPrice_,
        uint256 maxPrice_,
        uint256 maxMoveBps_,
        uint256 cooldown_,
        uint256 maxMovesPerDay_
    ) internal {
        if (minPrice_ == 0 || minPrice_ > maxPrice_ || maxMoveBps_ == 0 || maxMoveBps_ >= 10_000) {
            revert BadLimits();
        }
        minPrice = minPrice_;
        maxPrice = maxPrice_;
        maxMoveBps = maxMoveBps_;
        cooldown = cooldown_;
        maxMovesPerDay = maxMovesPerDay_;
        emit LimitsSet(minPrice_, maxPrice_, maxMoveBps_, cooldown_, maxMovesPerDay_);
    }
}
