import { createPublicClient, defineChain, http, parseAbi, type Abi, type Address, type PublicClient } from "viem";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_LASNA_RPC ?? "https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
});

export const RPC = {
  base: import.meta.env.VITE_BASE_RPC ?? "https://sepolia.base.org",
  unichain: import.meta.env.VITE_UNICHAIN_RPC ?? "https://sepolia.unichain.org",
  lasna: import.meta.env.VITE_LASNA_RPC ?? "https://lasna-rpc.rnk.dev/",
};

export const chains = { base: baseSepolia, unichain: unichainSepolia, lasna } as const;
export type ChainKey = keyof typeof chains;
export type TxChain = "base" | "unichain";

export const CHAIN_META: Record<ChainKey, { name: string; short: string; role: string; contract: string }> = {
  base: { name: "Base Sepolia", short: "Base", role: "Collateral", contract: "CollateralVault" },
  lasna: { name: "Reactive Lasna", short: "Lasna", role: "Ledger", contract: "ClearingHouse" },
  unichain: { name: "Unichain Sepolia", short: "Unichain", role: "Credit", contract: "CreditMarket" },
};

export const pub: Record<ChainKey, PublicClient> = {
  base: createPublicClient({ chain: baseSepolia, transport: http(RPC.base, { retryCount: 2 }) }) as PublicClient,
  unichain: createPublicClient({ chain: unichainSepolia, transport: http(RPC.unichain, { retryCount: 2 }) }) as PublicClient,
  lasna: createPublicClient({ chain: lasna, transport: http(RPC.lasna, { retryCount: 2 }) }) as PublicClient,
};

export const explorer = {
  tx: {
    base: "https://sepolia.basescan.org/tx/",
    unichain: "https://sepolia.uniscan.xyz/tx/",
    lasna: "https://lasna.reactscan.net/tx/",
  } as Record<ChainKey, string>,
  address: {
    base: "https://sepolia.basescan.org/address/",
    unichain: "https://sepolia.uniscan.xyz/address/",
    lasna: "https://lasna.reactscan.net/address/",
  } as Record<ChainKey, string>,
};

export type Deployments = {
  deployer: Address;
  lasna: { chainId: number; clearingHouse: Address; fromBlock: number };
  base: { chainId: number; vault: Address; feed: Address; weth: Address; callbackProxy: Address; fromBlock: number };
  unichain: { chainId: number; market: Address; usdc: Address; callbackProxy: Address; fromBlock: number };
};

export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "error MintCapExceeded(uint256 requested, uint256 cap)",
]);

export const vaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function requestWithdraw(uint256 amount) returns (uint256)",
  "function collateralOf(address user) view returns (uint256)",
  "function pendingOf(address user) view returns (uint256)",
  "function freeCollateralOf(address user) view returns (uint256)",
  "event Deposited(address indexed user, uint256 amount, uint256 collateral, uint256 pending)",
  "event WithdrawRequested(address indexed user, uint256 indexed reqId, uint256 amount, uint256 collateral, uint256 pending)",
  "event WithdrawSettled(address indexed user, uint256 indexed reqId, bool released, uint256 collateral, uint256 pending)",
  "event Seized(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount, uint256 collateral, uint256 pending)",
  "error ZeroAmount()",
  "error InsufficientFreeCollateral(uint256 requested, uint256 free)",
]);

export const feedAbi = parseAbi([
  "function setPrice(uint256 newPrice)",
  "function price() view returns (uint256)",
  "function owner() view returns (address)",
  "event PriceUpdated(uint256 price, uint256 timestamp)",
  "error NotOwner()",
]);

export const marketAbi = parseAbi([
  "function borrow(uint256 amount)",
  "function repay(address user, uint256 amount)",
  "function liquidate(address user, uint256 amount) returns (uint256)",
  "function debtOf(address user) view returns (uint256)",
  "function limitOf(address user) view returns (uint256)",
  "function liquidatable(address user) view returns (bool)",
  "function availableCredit(address user) view returns (uint256)",
  "function shieldOf(address user) view returns (uint256)",
  "function totalShield() view returns (uint256)",
  "function fundShield(uint256 amount)",
  "function withdrawShield(uint256 amount)",
  "event DebtUpdated(address indexed user, int256 change, uint256 debt)",
  "event LimitApplied(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable, uint256 debt)",
  "event Liquidated(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 repaid, uint256 debt)",
  "event ShieldUpdated(address indexed user, uint256 shield)",
  "event Protected(address indexed user, uint64 indexed seq, uint256 repaid, uint256 debt, uint256 shieldLeft)",
  "error ZeroAmount()",
  "error AccountLiquidatable()",
  "error CreditLimitExceeded(uint256 requested, uint256 available)",
  "error NotLiquidatable()",
  "error InsufficientLiquidity(uint256 requested, uint256 available)",
  "error TokenTransferFailed()",
  "error ShieldTooSmall(uint256 requested, uint256 shield)",
]);

export const chAbi = parseAbi([
  "function price() view returns (uint256)",
  "function ltvBps() view returns (uint256)",
  "function ltBps() view returns (uint256)",
  "function protectBps() view returns (uint256)",
  // Seven fields on purpose: the upgraded contract appends `shield`, which viem ignores here.
  "function accounts(address user) view returns (uint256 collateral, uint256 pending, uint256 debt, uint256 limit, uint64 seq, bool liquidatable, bool tracked)",
  "event Reacted(uint8 indexed kind, address indexed user, uint256 originChainId, uint256 originTxHash, uint256 originBlock)",
  "event SyncSent(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable)",
  "event WithdrawDecision(address indexed user, uint256 indexed reqId, bool release, uint256 debt, uint256 limitAfter)",
  "event SeizeSent(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount)",
  "event ProtectionSent(address indexed user, uint64 indexed seq, uint256 debt, uint256 limit, uint256 shield)",
]);

export const KIND_NAMES = ["deposit", "withdrawal request", "withdrawal", "seizure", "price update", "debt change", "limit", "liquidation", "shield"];

export const COLL = 18;
export const DEBT = 6;
export const PRICE = 8;

/** Public RPCs cap eth_getLogs ranges (sepolia.base.org: 200 blocks), so every log query is windowed. */
export const MAX_LOG_RANGE = 150n;

export async function getLogsWindowed(
  chain: ChainKey,
  params: { address: Address; abi: Abi; eventName?: string; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<any[]> {
  const windows: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= toBlock; from += MAX_LOG_RANGE) {
    const end = from + MAX_LOG_RANGE - 1n;
    windows.push([from, end < toBlock ? end : toBlock]);
  }
  const parts = await Promise.all(
    windows.map(([from, to]) => (pub[chain] as any).getContractEvents({ ...params, fromBlock: from, toBlock: to })),
  );
  return parts.flat();
}

/** Turns contract reverts and wallet errors into sentences a borrower can act on. */
export function explainError(e: unknown): { message: string; cancelled: boolean } {
  const err = e as any;
  const text: string = String(err?.shortMessage ?? err?.message ?? e);
  if (err?.code === 4001 || /user rejected|denied|rejected the request/i.test(text)) {
    return { message: "Cancelled in your wallet.", cancelled: true };
  }
  const name: string | undefined = err?.walk?.((x: any) => x?.data?.errorName)?.data?.errorName ?? err?.data?.errorName;
  const args: any[] = err?.walk?.((x: any) => x?.data?.args)?.data?.args ?? [];
  switch (name) {
    case "CreditLimitExceeded":
      return { message: `That is more than your available credit (${fmt(args[1], DEBT)} USDC).`, cancelled: false };
    case "AccountLiquidatable":
      return { message: "Your account is flagged for liquidation. Repay or add collateral first.", cancelled: false };
    case "NotLiquidatable":
      return { message: "This account is healthy, so it cannot be liquidated.", cancelled: false };
    case "InsufficientLiquidity":
      return { message: `The market only has ${fmt(args[1], DEBT)} USDC to lend right now.`, cancelled: false };
    case "InsufficientFreeCollateral":
      return { message: `You can withdraw at most ${fmt(args[1], COLL, 4)} WETH right now.`, cancelled: false };
    case "ShieldTooSmall":
      return { message: `Your shield only holds ${fmt(args[1], DEBT)} USDC.`, cancelled: false };
    case "ZeroAmount":
      return { message: "Enter an amount above zero.", cancelled: false };
    case "NotOwner":
      return { message: "Only the deployer can move the test oracle.", cancelled: false };
    case "MintCapExceeded":
      return { message: "Test tokens have a per-request cap. Ask for a smaller amount.", cancelled: false };
  }
  if (/insufficient funds/i.test(text)) return { message: "Not enough ETH in your wallet for gas on this chain.", cancelled: false };
  return { message: text.split("\n")[0], cancelled: false };
}

export function fmt(v: bigint | undefined, decimals: number, shown = 2) {
  if (v === undefined) return "–";
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, shown);
  return `${neg ? "−" : ""}${whole}${shown > 0 ? "." + frac : ""}`;
}

export function toNum(v: bigint, decimals: number) {
  return Number(v) / 10 ** decimals;
}

export function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
