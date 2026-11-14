import { useQuery } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import {
  chAbi,
  feedAbi,
  getLogsWindowed,
  KIND_NAMES,
  marketAbi,
  pub,
  tokenAbi,
  vaultAbi,
  fmt,
  COLL,
  DEBT,
  PRICE,
  type ChainKey,
  type Deployments,
} from "./chain";

export function useDeployments() {
  return useQuery({
    queryKey: ["deployments"],
    queryFn: async (): Promise<Deployments> => {
      const r = await fetch(`${import.meta.env.BASE_URL}deployments.json`, { cache: "no-store" });
      if (!r.ok) throw new Error("not-deployed");
      return r.json();
    },
    staleTime: Infinity,
    retry: false,
  });
}

export type Position = {
  collateral: bigint;
  pending: bigint;
  free: bigint;
  weth: bigint;
  usdc: bigint;
  price: bigint;
  debt: bigint;
  limit: bigint;
  available: bigint;
  liquidatable: boolean;
  /** undefined when the deployed market predates auto-protection */
  shield?: bigint;
  ledger: { collateral: bigint; pending: bigint; debt: bigint; limit: bigint; seq: bigint; liquidatable: boolean; tracked: boolean; price: bigint };
  ltvBps: bigint;
  ltBps: bigint;
  protectBps?: bigint;
};

async function optional<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

export async function readPosition(d: Deployments, who: Address): Promise<Position> {
  const r = <T,>(chain: ChainKey, address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
    pub[chain].readContract({ address, abi, functionName, args } as any) as Promise<T>;
  const [collateral, pending, free, weth, price, acc, chPrice, ltvBps, ltBps, debt, limit, available, liquidatable, usdc, shield, protectBps] =
    await Promise.all([
      r<bigint>("base", d.base.vault, vaultAbi, "collateralOf", [who]),
      r<bigint>("base", d.base.vault, vaultAbi, "pendingOf", [who]),
      r<bigint>("base", d.base.vault, vaultAbi, "freeCollateralOf", [who]),
      r<bigint>("base", d.base.weth, tokenAbi, "balanceOf", [who]),
      r<bigint>("base", d.base.feed, feedAbi, "price"),
      r<readonly [bigint, bigint, bigint, bigint, bigint | number, boolean, boolean]>("lasna", d.lasna.clearingHouse, chAbi, "accounts", [who]),
      r<bigint>("lasna", d.lasna.clearingHouse, chAbi, "price"),
      r<bigint>("lasna", d.lasna.clearingHouse, chAbi, "ltvBps"),
      r<bigint>("lasna", d.lasna.clearingHouse, chAbi, "ltBps"),
      r<bigint>("unichain", d.unichain.market, marketAbi, "debtOf", [who]),
      r<bigint>("unichain", d.unichain.market, marketAbi, "limitOf", [who]),
      r<bigint>("unichain", d.unichain.market, marketAbi, "availableCredit", [who]),
      r<boolean>("unichain", d.unichain.market, marketAbi, "liquidatable", [who]),
      r<bigint>("unichain", d.unichain.usdc, tokenAbi, "balanceOf", [who]),
      optional(r<bigint>("unichain", d.unichain.market, marketAbi, "shieldOf", [who])),
      optional(r<bigint>("lasna", d.lasna.clearingHouse, chAbi, "protectBps")),
    ]);
  const [c, p, dd, l, s, lq, t] = acc;
  return {
    collateral,
    pending,
    free,
    weth,
    usdc,
    price,
    debt,
    limit,
    available,
    liquidatable,
    shield,
    ledger: { collateral: c, pending: p, debt: dd, limit: l, seq: BigInt(s), liquidatable: lq, tracked: t, price: chPrice },
    ltvBps,
    ltBps,
    protectBps,
  };
}

export function usePosition(d: Deployments | undefined, who: Address | undefined) {
  return useQuery({
    queryKey: ["position", d?.lasna.clearingHouse, who],
    queryFn: () => readPosition(d!, who!),
    enabled: !!d && !!who,
    refetchInterval: 2500,
    placeholderData: (prev) => prev,
  });
}

/** Derived numbers every panel needs. Health = (collateral value × liquidation threshold) / debt. */
export function derive(p: Position | undefined) {
  if (!p) return undefined;
  const value = (p.collateral * p.price * 10n ** BigInt(DEBT)) / (10n ** BigInt(COLL) * 10n ** BigInt(PRICE));
  const health = p.debt > 0n ? Number((value * p.ltBps) / 10_000n) / Number(p.debt) : Infinity;
  const protect = p.protectBps ?? 7_500n;
  // Prices (8 decimals) at which the account hits the liquidation threshold / protection trigger.
  const priceAt = (bps: bigint) =>
    p.debt > 0n && p.collateral > 0n ? (p.debt * 10n ** BigInt(COLL) * 10n ** BigInt(PRICE) * 10_000n) / (p.collateral * 10n ** BigInt(DEBT) * bps) : undefined;
  const protectionHealth = Number(p.ltBps) / Number(protect);
  const zone: "safe" | "protect" | "liquidatable" =
    p.liquidatable || health < 1 ? "liquidatable" : health < protectionHealth ? "protect" : "safe";
  const inSync =
    p.ledger.collateral === p.collateral && p.ledger.pending === p.pending && p.ledger.debt === p.debt && p.ledger.price === p.price;
  return { value, health, protectionHealth, zone, liqPrice: priceAt(p.ltBps), protectPrice: priceAt(protect), inSync };
}

export function useHeads() {
  return useQuery({
    queryKey: ["heads"],
    queryFn: async () => {
      const keys: ChainKey[] = ["base", "lasna", "unichain"];
      const blocks = await Promise.all(keys.map((k) => pub[k].getBlock().catch(() => undefined)));
      return Object.fromEntries(
        keys.map((k, i) => [k, blocks[i] ? { number: blocks[i]!.number, ts: Number(blocks[i]!.timestamp) * 1000 } : undefined]),
      ) as Record<ChainKey, { number: bigint; ts: number } | undefined>;
    },
    refetchInterval: 3000,
    placeholderData: (prev) => prev,
  });
}

export type Activity = {
  key: string;
  chain: ChainKey;
  name: string;
  detail: string;
  tx: string;
  block: bigint;
  ts: number;
  user?: string;
};

const blockTs = new Map<string, number>();
async function tsOf(chain: ChainKey, block: bigint) {
  const k = `${chain}:${block}`;
  const hit = blockTs.get(k);
  if (hit !== undefined) return hit;
  const b = await pub[chain].getBlock({ blockNumber: block });
  const v = Number(b.timestamp) * 1000;
  blockTs.set(k, v);
  return v;
}

export function describe(name: string, a: Record<string, any>): string {
  switch (name) {
    case "Deposited":
      return `Deposited ${fmt(a.amount, COLL, 4)} WETH`;
    case "WithdrawRequested":
      return `Requested withdrawal of ${fmt(a.amount, COLL, 4)} WETH`;
    case "WithdrawSettled":
      return a.released ? "Released withdrawn collateral" : "Rejected withdrawal (debt too high)";
    case "Seized":
      return `Paid ${fmt(a.amount, COLL, 4)} WETH to a liquidator`;
    case "PriceUpdated":
      return `Oracle price set to $${fmt(a.price, PRICE)}`;
    case "DebtUpdated":
      return a.change >= 0n ? `Borrowed ${fmt(a.change, DEBT)} USDC` : `Repaid ${fmt(-(a.change as bigint), DEBT)} USDC`;
    case "LimitApplied":
      return a.liquidatable ? `Credit limit ${fmt(a.limit, DEBT)} USDC, flagged for liquidation` : `Credit limit set to ${fmt(a.limit, DEBT)} USDC`;
    case "Liquidated":
      return `Liquidator repaid ${fmt(a.repaid, DEBT)} USDC`;
    case "ShieldUpdated":
      return `Shield balance ${fmt(a.shield, DEBT)} USDC`;
    case "Protected":
      return `Shield repaid ${fmt(a.repaid, DEBT)} USDC before liquidation`;
    case "Reacted":
      return `Ledger processed a ${KIND_NAMES[Number(a.kind)] ?? "event"} from ${Number(a.originChainId) === 84532 ? "Base" : "Unichain"}`;
    case "SyncSent":
      return `Sent credit limit ${fmt(a.limit, DEBT)} USDC to Unichain`;
    case "ProtectionSent":
      return `Sent shield repay to Unichain`;
    case "WithdrawDecision":
      return a.release ? "Approved withdrawal on Base" : "Rejected withdrawal on Base";
    case "SeizeSent":
      return `Ordered ${fmt(a.amount, COLL, 4)} WETH seizure on Base`;
    default:
      return name;
  }
}

// How far back the activity feed looks, as time. Block times differ per chain and change (Base Sepolia
// moved to 200 ms blocks), so the block range is derived from each chain's measured block time.
const LOOKBACK_MS = 5 * 60_000;
const MAX_LOOKBACK_BLOCKS = 3_000n; // bounds RPC load if a chain's block time is ever misread
const SAMPLE = 200n;
const blockMs = new Map<ChainKey, { ms: number; at: number }>();

/** Average milliseconds per block over the last 200 blocks, from block timestamps; refreshed each minute. */
async function msPerBlock(chain: ChainKey, head: bigint) {
  const hit = blockMs.get(chain);
  if (hit && Date.now() - hit.at < 60_000) return hit.ms;
  const [a, b] = await Promise.all([pub[chain].getBlock({ blockNumber: head }), pub[chain].getBlock({ blockNumber: head > SAMPLE ? head - SAMPLE : 0n })]);
  const blocks = Number(a.number - b.number);
  // Timestamps are whole seconds, so average over many blocks; fall back to 1 s if the sample is degenerate.
  const ms = blocks > 0 && a.timestamp > b.timestamp ? (Number(a.timestamp - b.timestamp) * 1000) / blocks : 1000;
  blockMs.set(chain, { ms, at: Date.now() });
  return ms;
}

async function lookbackBlocks(chain: ChainKey, head: bigint) {
  const n = BigInt(Math.ceil(LOOKBACK_MS / (await msPerBlock(chain, head))));
  return n > MAX_LOOKBACK_BLOCKS ? MAX_LOOKBACK_BLOCKS : n;
}

export function useActivity(d: Deployments | undefined) {
  return useQuery({
    queryKey: ["activity", d?.lasna.clearingHouse],
    enabled: !!d,
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Activity[]> => {
      const dd = d!;
      const sources: { chain: ChainKey; address: Address; abi: Abi; from: number }[] = [
        { chain: "base", address: dd.base.vault, abi: vaultAbi, from: dd.base.fromBlock },
        { chain: "base", address: dd.base.feed, abi: feedAbi, from: dd.base.fromBlock },
        { chain: "unichain", address: dd.unichain.market, abi: marketAbi, from: dd.unichain.fromBlock },
        { chain: "lasna", address: dd.lasna.clearingHouse, abi: chAbi, from: dd.lasna.fromBlock },
      ];
      const keys: ChainKey[] = ["base", "unichain", "lasna"];
      const heads = await Promise.all(keys.map((k) => pub[k].getBlockNumber()));
      const head = Object.fromEntries(keys.map((k, i) => [k, heads[i]])) as Record<ChainKey, bigint>;
      const spans = await Promise.all(keys.map((k) => lookbackBlocks(k, head[k])));
      const span = Object.fromEntries(keys.map((k, i) => [k, spans[i]])) as Record<ChainKey, bigint>;
      const batches = await Promise.all(
        sources.map(async (s) => {
          const lo = head[s.chain] > span[s.chain] ? head[s.chain] - span[s.chain] : 0n;
          const from = lo > BigInt(s.from) ? lo : BigInt(s.from);
          const logs = await getLogsWindowed(s.chain, { address: s.address, abi: s.abi }, from, head[s.chain]);
          return logs.map((l) => ({ ...l, chain: s.chain }));
        }),
      );
      const flat = batches.flat().sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 80);
      const items = await Promise.all(
        flat.map(
          async (l): Promise<Activity> => ({
            key: `${l.chain}:${l.transactionHash}:${l.logIndex}`,
            chain: l.chain,
            name: l.eventName,
            detail: describe(l.eventName, l.args),
            tx: l.transactionHash,
            block: l.blockNumber,
            ts: await tsOf(l.chain, l.blockNumber),
            user: l.args?.user,
          }),
        ),
      );
      return items.sort((a, b) => b.ts - a.ts).slice(0, 50);
    },
  });
}

/** Block-to-block latency from block timestamps (whole seconds on three chains, so about ±1 s). */
export type OnchainStats = { n: number; p50: number; p90: number; p95: number; max: number; legs?: { name: string; p50: number; min: number; max: number }[] };

export type Summary = {
  generatedAt: string;
  flows: Record<
    string,
    { n: number; p50: number; p90: number; p95: number; max: number; failures: number; legs?: { name: string; p50: number; p95: number }[]; onchain?: OnchainStats }
  >;
  race?: { attempts: number; released: number; borrowed: number; both: number; insolvent: number };
};

export function useSummary() {
  return useQuery({
    queryKey: ["summary"],
    queryFn: async (): Promise<Summary | null> => {
      const r = await fetch(`${import.meta.env.BASE_URL}summary.json`, { cache: "no-store" });
      return r.ok ? r.json() : null;
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Detects whether the deployed market supports auto-protection (shields). */
export function useShieldSupport(d: Deployments | undefined) {
  return useQuery({
    queryKey: ["shield-support", d?.unichain.market],
    enabled: !!d,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        await pub.unichain.readContract({ address: d!.unichain.market, abi: marketAbi, functionName: "totalShield" });
        return true;
      } catch {
        return false;
      }
    },
  });
}
