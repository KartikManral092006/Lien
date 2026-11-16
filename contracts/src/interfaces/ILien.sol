// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IVaultEvents {
    event Deposited(address indexed user, uint256 amount, uint256 collateral, uint256 pending);
    event WithdrawRequested(
        address indexed user, uint256 indexed reqId, uint256 amount, uint256 collateral, uint256 pending
    );
    event WithdrawSettled(
        address indexed user, uint256 indexed reqId, bool released, uint256 collateral, uint256 pending
    );
    event Seized(
        address indexed user,
        address indexed liquidator,
        uint256 indexed liqId,
        uint256 amount,
        uint256 collateral,
        uint256 pending
    );
    event SettlementIgnored(uint256 indexed ref, uint8 kind);
}

interface IPriceFeedEvents {
    event PriceUpdated(uint256 price, uint256 timestamp);
}

interface IMarketEvents {
    event DebtUpdated(address indexed user, int256 change, uint256 debt);
    event LimitApplied(
        address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable, uint256 debt
    );
    event Liquidated(
        address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 repaid, uint256 debt
    );
    event SyncIgnored(address indexed user, uint64 seq, uint256 reqId);
    event ShieldUpdated(address indexed user, uint256 shield);
    event Protected(address indexed user, uint64 indexed seq, uint256 repaid, uint256 debt, uint256 shieldLeft);
    /// Hands a price update's re-check back to the ClearingHouse for its next batch of accounts.
    event RepriceRelayed(uint256 indexed epoch);
}

interface ICollateralVault {
    function settleWithdraw(address rvm, uint256 reqId, bool release) external;
    function seize(address rvm, address user, address liquidator, uint256 liqId, uint256 amount) external;
}

interface ICreditMarket {
    function sync(address rvm, address user, uint256 limit, bool liquidatable, uint64 seq, uint256 reqId, bool protect)
        external;
    function relayReprice(address rvm, uint256 epoch) external;
}
