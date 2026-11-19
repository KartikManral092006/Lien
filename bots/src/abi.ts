import { parseAbi } from "viem";

export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const vaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function requestWithdraw(uint256 amount) returns (uint256)",
  "function cancelWithdraw(uint256 reqId)",
  "function collateralOf(address user) view returns (uint256)",
  "function pendingOf(address user) view returns (uint256)",
  "function freeCollateralOf(address user) view returns (uint256)",
  "function withdrawals(uint256 reqId) view returns (address user, uint256 amount, bool open)",
  "event Deposited(address indexed user, uint256 amount, uint256 collateral, uint256 pending)",
  "event WithdrawRequested(address indexed user, uint256 indexed reqId, uint256 amount, uint256 collateral, uint256 pending)",
  "event WithdrawSettled(address indexed user, uint256 indexed reqId, bool released, uint256 collateral, uint256 pending)",
  "event Seized(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount, uint256 collateral, uint256 pending)",
]);

export const feedAbi = parseAbi([
  "function setPrice(uint256 newPrice)",
  "function price() view returns (uint256)",
  "function owner() view returns (address)",
  "event PriceUpdated(uint256 price, uint256 timestamp)",
]);

/** Testnet PriceController: owns the feed; the deployer (bots) uses the unthrottled ownerSetPrice. */
export const priceControllerAbi = parseAbi([
  "function ownerSetPrice(uint256 newPrice)",
  "function status() view returns (uint256 nextMoveAt, uint256 movesLeftToday)",
  "function maxMovesPerDay() view returns (uint256)",
]);

export const marketAbi = parseAbi([
  "event RepriceRelayed(uint256 indexed epoch)",
  "function borrow(uint256 amount)",
  "function repay(address user, uint256 amount)",
  "function liquidate(address user, uint256 amount) returns (uint256)",
  "function debtOf(address user) view returns (uint256)",
  "function limitOf(address user) view returns (uint256)",
  "function liquidatable(address user) view returns (bool)",
  "function availableCredit(address user) view returns (uint256)",
  "function lastSeq(address user) view returns (uint64)",
  "function shieldOf(address user) view returns (uint256)",
  "function totalShield() view returns (uint256)",
  "function fundShield(uint256 amount)",
  "function withdrawShield(uint256 amount)",
  "event DebtUpdated(address indexed user, int256 change, uint256 debt)",
  "event LimitApplied(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable, uint256 debt)",
  "event Liquidated(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 repaid, uint256 debt)",
  "event ShieldUpdated(address indexed user, uint256 shield)",
  "event Protected(address indexed user, uint64 indexed seq, uint256 repaid, uint256 debt, uint256 shieldLeft)",
]);

export const chAbi = parseAbi([
  "function price() view returns (uint256)",
  "function ltvBps() view returns (uint256)",
  "function ltBps() view returns (uint256)",
  "function usersCount() view returns (uint256)",
  "function users(uint256 index) view returns (address)",
  "function repriceEpoch() view returns (uint256)",
  "function repriceCursor() view returns (uint256)",
  "function BATCH() view returns (uint256)",
  "event RepriceBatch(uint256 indexed epoch, uint256 from, uint256 to, uint256 total)",
  "function protectBps() view returns (uint256)",
  "function accounts(address user) view returns (uint256 collateral, uint256 pending, uint256 debt, uint256 limit, uint64 seq, bool liquidatable, bool tracked)",
  "event Reacted(uint8 indexed kind, address indexed user, uint256 originChainId, uint256 originTxHash, uint256 originBlock)",
  "event SyncSent(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable)",
  "event WithdrawDecision(address indexed user, uint256 indexed reqId, bool release, uint256 debt, uint256 limitAfter)",
  "event SeizeSent(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount)",
  "event ProtectionSent(address indexed user, uint64 indexed seq, uint256 debt, uint256 limit, uint256 shield)",
]);

/** Upgraded ClearingHouse appends `shield` to accounts(); kept separate so older deployments still decode. */
export const chShieldAbi = parseAbi([
  "function accounts(address user) view returns (uint256 collateral, uint256 pending, uint256 debt, uint256 limit, uint64 seq, bool liquidatable, bool tracked, uint256 shield)",
]);

export const payableAbi = parseAbi([
  "function debt(address target) view returns (uint256)",
  "function reserves(address target) view returns (uint256)",
]);

export const Kind = {
  Deposit: 0,
  WithdrawRequest: 1,
  WithdrawSettled: 2,
  Seized: 3,
  Price: 4,
  Debt: 5,
  LimitApplied: 6,
  Liquidated: 7,
  Shield: 8,
} as const;
