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

export async function pollUntil<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs = 180_000) {
  const start = Date.now();
  for (;;) {
    let v: T | undefined;
    try {
      v = await fn();
    } catch {
      v = undefined;
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
  const b = await client.getBlock({ blockNumber });
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
