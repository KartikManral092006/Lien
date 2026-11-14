import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Abi, Address, Hex, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { EXPLORER, ROOT, pub, wallet } from "./config.js";

export type ChainKey = "base" | "unichain" | "lasna";

export type Leg = {
  name: string;
  chain: ChainKey;
  tx: Hex;
  block: string;
  blockTimeMs: number;
  observedAtMs: number;
};

export type FlowResult = {
  flow: string;
  runId: string;
  startedAtMs: number;
  legs: Leg[];
  totalObservedMs: number;
  totalBlockMs: number;
  ok: boolean;
  note?: string;
  extra?: Record<string, unknown>;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Public RPCs cap eth_getLogs ranges (sepolia.base.org: 200 blocks, and Base Sepolia makes ~5 blocks/s),
// so a fixed "fromBlock -> latest" query starts failing permanently after ~40 s. Scan in bounded windows instead.
const MAX_LOG_RANGE = 150n;
const RESCAN_TAIL = 5n;

export function logScanner<T>(chain: ChainKey, fromBlock: bigint, query: (from: bigint, to: bigint) => Promise<T | undefined>) {
  let cursor = fromBlock;
  return async (): Promise<T | undefined> => {
    const head = await (pub[chain] as PublicClient).getBlockNumber();
    while (cursor <= head) {
      const end = cursor + MAX_LOG_RANGE - 1n;
      const to = end < head ? end : head;
      const hit = await query(cursor, to);
      if (hit !== undefined) return hit;
      if (to < head) {
        cursor = to + 1n;
      } else {
        // Re-read the last few blocks next time in case the node had not indexed their logs yet.
        if (to - RESCAN_TAIL > cursor) cursor = to - RESCAN_TAIL;
        break;
      }
    }
    return undefined;
  };
}

export async function pollUntil<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs = 180_000) {
  const start = Date.now();
  const seen = new Set<string>();
  for (;;) {
    let v: T | undefined;
    try {
      v = await fn();
    } catch (e: any) {
      v = undefined;
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e).slice(0, 200);
      if (!seen.has(msg)) {
        seen.add(msg);
        console.warn(`  [retrying] ${label}: ${msg}`);
      }
    }
    if (v !== undefined) return { value: v, observedAt: Date.now() };
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await sleep(250);
  }
}

const blockTimes = new Map<string, number>();

export async function blockTimeMs(chain: ChainKey, blockNumber: bigint) {
  const key = `${chain}:${blockNumber}`;
  const cached = blockTimes.get(key);
  if (cached !== undefined) return cached;
  const client = pub[chain] as PublicClient;
  // Public RPCs are load-balanced: the node that returned a receipt can be ahead of the node that
  // answers the next getBlock, which then reports BlockNotFound for a block that exists. Retry briefly.
  const { value: b } = await pollUntil(`block ${blockNumber} on ${chain}`, () => client.getBlock({ blockNumber }), 30_000);
  const ms = Number(b.timestamp) * 1000;
  blockTimes.set(key, ms);
  return ms;
}

export async function makeLeg(name: string, chain: ChainKey, tx: Hex, block: bigint, observedAtMs: number): Promise<Leg> {
  return { name, chain, tx, block: block.toString(), blockTimeMs: await blockTimeMs(chain, block), observedAtMs };
}

type WriteArgs = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

export async function send(chain: "base" | "unichain", req: WriteArgs, w?: WalletClient) {
  const client = pub[chain] as PublicClient;
  const signer = w ?? (chain === "base" ? wallet.base : wallet.unichain);
  const sentAt = Date.now();
  const hash: Hex = await (signer as any).writeContract({ ...req, chain: signer.chain, account: signer.account });
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 250 });
  if (receipt.status !== "success") throw new Error(`${req.functionName} reverted: ${EXPLORER[chain]}${hash}`);
  return { hash, receipt, sentAt, minedObservedAt: Date.now() };
}

export async function read<T = any>(chain: ChainKey, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
  const client = pub[chain] as PublicClient;
  return (await client.readContract({ address, abi, functionName, args } as any)) as T;
}

export function finish(flow: string, runId: string, startedAtMs: number, legs: Leg[], extra?: Record<string, unknown>, note?: string): FlowResult {
  const first = legs[0];
  const last = legs[legs.length - 1];
  return {
    flow,
    runId,
    startedAtMs,
    legs,
    totalObservedMs: last.observedAtMs - startedAtMs,
    totalBlockMs: last.blockTimeMs - first.blockTimeMs,
    ok: true,
    note,
    extra,
  };
}

export function appendRun(record: unknown) {
  const dir = path.join(ROOT, "results");
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
}

export function printFlow(r: FlowResult) {
  console.log(`\n${r.flow}  total ${(r.totalObservedMs / 1000).toFixed(2)} s observed, ${(r.totalBlockMs / 1000).toFixed(0)} s by block timestamps`);
  let prev = r.startedAtMs;
  for (const l of r.legs) {
    console.log(`  +${((l.observedAtMs - prev) / 1000).toFixed(2).padStart(6)} s  ${l.chain.padEnd(8)} ${l.name.padEnd(28)} ${EXPLORER[l.chain]}${l.tx}`);
    prev = l.observedAtMs;
  }
  if (r.note) console.log(`  note: ${r.note}`);
}

export function fmtUnits(v: bigint, decimals: number, shown = 4) {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, shown);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function argFlag(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
