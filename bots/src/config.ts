import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(ROOT, ".env") });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in ${path.join(ROOT, ".env")} (copy .env.example)`);
  return v;
}

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.LASNA_RPC ?? "https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
});

export type Deployments = {
  deployer: Address;
  lasna: { chainId: number; clearingHouse: Address; fromBlock: number };
  base: { chainId: number; vault: Address; feed: Address; weth: Address; callbackProxy: Address; fromBlock: number };
  unichain: { chainId: number; market: Address; usdc: Address; callbackProxy: Address; fromBlock: number };
};

export function loadDeployments(): Deployments {
  const p = path.join(ROOT, "deployments.json");
  if (!existsSync(p)) throw new Error("deployments.json not found. Run scripts/deploy.sh first.");
  return JSON.parse(readFileSync(p, "utf8"));
}

export const dep = loadDeployments();

export const account = privateKeyToAccount(need("PRIVATE_KEY") as Hex);
const liqKey = process.env.LIQUIDATOR_PRIVATE_KEY;
export const liquidatorAccount = liqKey ? privateKeyToAccount(liqKey as Hex) : account;

const poll = { pollingInterval: 250 };

export const pub = {
  base: createPublicClient({ chain: baseSepolia, transport: http(need("BASE_RPC")), ...poll }),
  unichain: createPublicClient({ chain: unichainSepolia, transport: http(need("UNICHAIN_RPC")), ...poll }),
  lasna: createPublicClient({ chain: lasna, transport: http(need("LASNA_RPC")), ...poll }),
};

export const wallet = {
  base: createWalletClient({ account, chain: baseSepolia, transport: http(need("BASE_RPC")) }),
  unichain: createWalletClient({ account, chain: unichainSepolia, transport: http(need("UNICHAIN_RPC")) }),
};

export const liquidatorWallet = createWalletClient({
  account: liquidatorAccount,
  chain: unichainSepolia,
  transport: http(need("UNICHAIN_RPC")),
});

export const EXPLORER = {
  base: "https://sepolia.basescan.org/tx/",
  unichain: "https://sepolia.uniscan.xyz/tx/",
  lasna: "https://lasna.reactscan.net/tx/",
} as const;

export const COLL_UNIT = 10n ** 18n;
export const DEBT_UNIT = 10n ** 6n;
export const PRICE_UNIT = 10n ** 8n;
