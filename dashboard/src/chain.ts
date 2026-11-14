import { createPublicClient, defineChain, http, parseAbi, type Address } from "viem";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_LASNA_RPC ?? "https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
});

export const chains = { base: baseSepolia, unichain: unichainSepolia, lasna } as const;
export type ChainKey = keyof typeof chains;

export const pub = {
  base: createPublicClient({ chain: baseSepolia, transport: http(import.meta.env.VITE_BASE_RPC ?? "https://sepolia.base.org") }),
  unichain: createPublicClient({ chain: unichainSepolia, transport: http(import.meta.env.VITE_UNICHAIN_RPC ?? "https://sepolia.unichain.org") }),
  lasna: createPublicClient({ chain: lasna, transport: http(import.meta.env.VITE_LASNA_RPC ?? "https://lasna-rpc.rnk.dev/") }),
};

export const txUrl: Record<ChainKey, string> = {
  base: "https://sepolia.basescan.org/tx/",
  unichain: "https://sepolia.uniscan.xyz/tx/",
  lasna: "https://lasna.reactscan.net/tx/",
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
]);

export const feedAbi = parseAbi([
  "function setPrice(uint256 newPrice)",
  "function price() view returns (uint256)",
  "function owner() view returns (address)",
  "event PriceUpdated(uint256 price, uint256 timestamp)",
]);

export const marketAbi = parseAbi([
  "function borrow(uint256 amount)",
  "function repay(address user, uint256 amount)",
  "function liquidate(address user, uint256 amount) returns (uint256)",
  "function debtOf(address user) view returns (uint256)",
  "function limitOf(address user) view returns (uint256)",
  "function liquidatable(address user) view returns (bool)",
  "function availableCredit(address user) view returns (uint256)",
  "event DebtUpdated(address indexed user, int256 change, uint256 debt)",
  "event LimitApplied(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable, uint256 debt)",
  "event Liquidated(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 repaid, uint256 debt)",
]);

export const chAbi = parseAbi([
  "function price() view returns (uint256)",
  "function ltvBps() view returns (uint256)",
  "function ltBps() view returns (uint256)",
  "function accounts(address user) view returns (uint256 collateral, uint256 pending, uint256 debt, uint256 limit, uint64 seq, bool liquidatable, bool tracked)",
  "event Reacted(uint8 indexed kind, address indexed user, uint256 originChainId, uint256 originTxHash, uint256 originBlock)",
  "event SyncSent(address indexed user, uint64 indexed seq, uint256 indexed reqId, uint256 limit, bool liquidatable)",
  "event WithdrawDecision(address indexed user, uint256 indexed reqId, bool release, uint256 debt, uint256 limitAfter)",
  "event SeizeSent(address indexed user, address indexed liquidator, uint256 indexed liqId, uint256 amount)",
]);

export const KIND_NAMES = ["Deposit", "WithdrawRequest", "WithdrawSettled", "Seized", "Price", "Debt", "LimitApplied", "Liquidated"];

export function fmt(v: bigint | undefined, decimals: number, shown = 2) {
  if (v === undefined) return "–";
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, shown);
  return `${neg ? "−" : ""}${whole}${shown > 0 ? "." + frac : ""}`;
}

export function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
