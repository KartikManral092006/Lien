import { useSyncExternalStore } from "react";
import { hexToBigInt, parseEventLogs, type Address, type Hex } from "viem";
import { chAbi, getLogsWindowed, marketAbi, pub, vaultAbi, type ChainKey, type Deployments } from "./chain";

/**
 * Follows one user action across chains: origin tx -> ClearingHouse reaction on Lasna -> callback on the
 * destination chain, and again for two-phase withdrawals. Each leg is timed as the browser observes it.
 */

export type Hop = { chain: ChainKey; label: string; tx: Hex; at: number };
export type LoopRun = {
  id: number;
  label: string;
  startedAt: number;
  hops: Hop[];
  status: "running" | "done" | "stalled";
  note?: string;
};

let runs: LoopRun[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let nextId = 1;

function update(id: number, f: (r: LoopRun) => LoopRun) {
  runs = runs.map((r) => (r.id === id ? f(r) : r));
  emit();
}

export function useLoops() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => runs,
  );
}

/**
 * Development-only visual check of the settlement view (`?preview-loop`). Stripped from production
 * builds by the `import.meta.env.DEV` guard at the call site; it never shows sample data to users.
 */
let previewed = false;
export function previewLoop() {
  if (previewed) return; // React StrictMode runs effects twice in development
  previewed = true;
  const id = nextId++;
  const t0 = Date.now();
  const fake = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
  runs = [{ id, label: "Withdraw (preview)", startedAt: t0, hops: [{ chain: "base", label: "Confirmed", tx: fake(1), at: t0 + 900 }], status: "running" as const }, ...runs];
  emit();
  const steps: [number, Hop][] = [
    [2600, { chain: "lasna", label: "Ledger updated", tx: fake(2), at: 0 }],
    [5200, { chain: "unichain", label: "Credit limit applied", tx: fake(3), at: 0 }],
    [7000, { chain: "lasna", label: "Ledger updated", tx: fake(4), at: 0 }],
  ];
  for (const [ms, hop] of steps) setTimeout(() => update(id, (r) => ({ ...r, hops: [...r.hops, { ...hop, at: Date.now() }] })), ms);
  setTimeout(() => {
    update(id, (r) => ({ ...r, hops: [...r.hops, { chain: "base", label: "Collateral released", tx: fake(5), at: Date.now() }], status: "done" }));
  }, 30_000);
}

export type Heads = Record<ChainKey, bigint>;

export async function snapshotHeads(): Promise<Heads> {
  const [base, unichain, lasna] = await Promise.all([pub.base.getBlockNumber(), pub.unichain.getBlockNumber(), pub.lasna.getBlockNumber()]);
  return { base, unichain, lasna };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls bounded log windows until `pick` returns a log or the timeout passes. */
async function waitFor<T>(
  chain: ChainKey,
  params: { address: Address; abi: any; eventName: string; args?: Record<string, unknown> },
  fromBlock: bigint,
  pick: (logs: any[]) => T | undefined,
  timeoutMs = 90_000,
): Promise<T | undefined> {
  const start = Date.now();
  let cursor = fromBlock;
  while (Date.now() - start < timeoutMs) {
    try {
      const head = await pub[chain].getBlockNumber();
      if (head >= cursor) {
        const logs = await getLogsWindowed(chain, params, cursor, head);
        const hit = pick(logs);
        if (hit !== undefined) return hit;
        // Re-read the last few blocks next time in case their logs were not indexed yet.
        cursor = head > cursor + 5n ? head - 5n : cursor;
      }
    } catch {
      // Load-balanced public RPCs occasionally lag or refuse; the next poll retries.
    }
    await sleep(600);
  }
  return undefined;
}

export function trackLoop(
  d: Deployments,
  label: string,
  origin: { chain: ChainKey; tx: Hex; user: Address },
  heads: Heads,
  startedAt: number,
) {
  const id = nextId++;
  runs = [{ id, label, startedAt, hops: [{ chain: origin.chain, label: "Confirmed", tx: origin.tx, at: Date.now() }], status: "running" as const }, ...runs].slice(0, 6);
  emit();
  void follow(d, id, origin, heads);
  return id;
}

async function follow(d: Deployments, id: number, origin: { chain: ChainKey; tx: Hex; user: Address }, heads: Heads) {
  const add = (h: Hop) => update(id, (r) => ({ ...r, hops: [...r.hops, h] }));
  const finish = (status: LoopRun["status"], note?: string) => update(id, (r) => ({ ...r, status, note }));
  const user = origin.user.toLowerCase();

  let pending: { chain: ChainKey; tx: Hex }[] = [{ chain: origin.chain, tx: origin.tx }];
  for (let depth = 0; depth < 4 && pending.length > 0; depth++) {
    const next: { chain: ChainKey; tx: Hex }[] = [];
    for (const src of pending) {
      const want = hexToBigInt(src.tx);
      const reacted = await waitFor(
        "lasna",
        { address: d.lasna.clearingHouse, abi: chAbi, eventName: "Reacted" },
        heads.lasna,
        (logs) => logs.find((l) => l.args.originTxHash === want),
      );
      if (!reacted) return finish("stalled", "No reaction from the ledger yet. Reactive may be busy; it will still settle.");
      add({ chain: "lasna", label: "Ledger updated", tx: reacted.transactionHash, at: Date.now() });

      const receipt = await pub.lasna.getTransactionReceipt({ hash: reacted.transactionHash });
      const logs = receipt.logs;
      const syncs = parseEventLogs({ abi: chAbi, logs, eventName: "SyncSent" }).filter((s) => s.args.user.toLowerCase() === user);
      const protections = parseEventLogs({ abi: chAbi, logs, eventName: "ProtectionSent" }).filter((s) => s.args.user.toLowerCase() === user);
      const decisions = parseEventLogs({ abi: chAbi, logs, eventName: "WithdrawDecision" });
      const seizes = parseEventLogs({ abi: chAbi, logs, eventName: "SeizeSent" });

      const waits: Promise<void>[] = [];
      for (const s of syncs) {
        const protecting = protections.some((p) => p.args.seq === s.args.seq);
        waits.push(
          waitFor(
            "unichain",
            { address: d.unichain.market, abi: marketAbi, eventName: "LimitApplied", args: { user: s.args.user, seq: s.args.seq } },
            heads.unichain,
            (l) => l[0],
          ).then((a) => {
            if (!a) return;
            const label = protecting ? "Shield repaid, limit applied" : a.args.liquidatable ? "Flagged for liquidation" : "Credit limit applied";
            add({ chain: "unichain", label, tx: a.transactionHash, at: Date.now() });
            if (s.args.reqId > 0n) next.push({ chain: "unichain", tx: a.transactionHash }); // withdrawal phase 2
          }),
        );
      }
      for (const w of decisions) {
        waits.push(
          waitFor(
            "base",
            { address: d.base.vault, abi: vaultAbi, eventName: "WithdrawSettled", args: { reqId: w.args.reqId } },
            heads.base,
            (l) => l[0],
          ).then((s) => {
            if (s) add({ chain: "base", label: s.args.released ? "Collateral released" : "Withdrawal rejected", tx: s.transactionHash, at: Date.now() });
          }),
        );
      }
      for (const z of seizes) {
        waits.push(
          waitFor("base", { address: d.base.vault, abi: vaultAbi, eventName: "Seized", args: { liqId: z.args.liqId } }, heads.base, (l) => l[0]).then(
            (s) => {
              if (s) add({ chain: "base", label: "Collateral paid to liquidator", tx: s.transactionHash, at: Date.now() });
            },
          ),
        );
      }
      await Promise.all(waits);
    }
    pending = next;
  }
  finish("done");
}
