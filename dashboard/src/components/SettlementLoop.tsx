import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CHAIN_META } from "../lib/chain";
import { previewLoop, useLoops, type LoopRun } from "../lib/loop";
import { ChainRail, nextChain } from "./ChainRail";
import { Band, RevealHeading } from "./grid";
import { TxLink, chainBg, chainText } from "./primitives";

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Live log of the user's own actions: one cell per leg, filled in as each leg lands. */
export function SettlementLoop() {
  const loops = useLoops();
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview-loop")) previewLoop();
  }, []);
  const run = loops[0];
  const now = useNow(run?.status === "running");
  const state = run ? (run.status === "running" ? "settling" : run.status === "done" ? "settled" : "still settling") : "idle";

  return (
    <Band id="settlement" label="settlement, live" aside={<span>{state}</span>}>
      <div className="grid border-b border-line lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="px-5 py-12 sm:px-8 sm:py-16">
          <RevealHeading text="Watch your action cross three chains." className="max-w-[16ch] text-[clamp(2rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]" />
          <p className="mt-5 max-w-[56ch] text-muted">Base and Unichain never talk to each other. Every action goes through the ledger on Reactive, and each leg is timed here as it lands.</p>
        </div>
        <div className="flex flex-col justify-end border-t border-line px-5 py-8 sm:px-8 lg:border-l lg:border-t-0">
          <div className="font-mono text-xs text-faint">{run ? run.label : "last action"}</div>
          <div className="mt-2 text-6xl font-semibold tracking-[-0.05em]">{run ? secs((run.status === "running" ? now : run.hops[run.hops.length - 1].at) - run.startedAt) : "0.0s"}</div>
        </div>
      </div>

      <div className="border-b border-line">
        <ChainRail run={run} />
        <p className="border-t border-line px-5 py-3 font-mono text-xs text-faint sm:px-8" aria-live="polite">
          {!run
            ? "illustration: the route a deposit takes. Send one to watch yours."
            : run.status === "running"
              ? `in flight to ${CHAIN_META[nextChain(run)].name}, ${run.hops.length} ${run.hops.length === 1 ? "transaction" : "transactions"} landed so far`
              : run.status === "done"
                ? `settled across ${run.hops.length} transactions in ${secs(run.hops[run.hops.length - 1].at - run.startedAt)}`
                : "still settling, Reactive may be busy"}
        </p>
      </div>

      {run ? <Legs run={run} now={now} /> : <Idle />}

      {loops.length > 1 && (
        <div className="flex flex-wrap border-b border-line">
          <span className="border-r border-line px-5 py-3 font-mono text-xs text-faint sm:px-8">earlier</span>
          {loops.slice(1).map((r) => (
            <span key={r.id} className="border-r border-line px-5 py-3 font-mono text-xs">
              {r.label} <span className="text-faint">{secs(r.hops[r.hops.length - 1].at - r.startedAt)}</span>
            </span>
          ))}
        </div>
      )}
    </Band>
  );
}

function Legs({ run, now }: { run: LoopRun; now: number }) {
  const cols = Math.min(Math.max(run.hops.length + (run.status === "running" ? 1 : 0), 3), 5);
  return (
    <ol className="grid border-b border-line sm:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ["--n" as string]: cols }} aria-live="polite">
      <AnimatePresence initial={false}>
        {run.hops.map((h, i) => {
          const prev = i === 0 ? run.startedAt : run.hops[i - 1].at;
          return (
            <motion.li
              key={h.tx + i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="relative border-b border-line px-5 py-6 sm:border-b-0 sm:border-r sm:px-6"
            >
              <motion.span className={cn("absolute inset-x-0 top-0 h-[2px] origin-left", chainBg[h.chain])} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6 }} />
              <div className="flex items-center justify-between font-mono text-xs text-faint">
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span>+{secs(h.at - prev)}</span>
              </div>
              <div className={cn("mt-4 font-mono text-xs", chainText[h.chain])}>{CHAIN_META[h.chain].name}</div>
              <div className="mt-1 font-medium">{h.label}</div>
              <TxLink chain={h.chain} hash={h.tx} className="mt-3 inline-block" />
            </motion.li>
          );
        })}
      </AnimatePresence>
      {run.status === "running" && (
        <li className="flex items-center gap-3 px-5 py-6 font-mono text-xs text-muted sm:px-6">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping bg-chain-lasna opacity-70" />
            <span className="relative inline-flex size-2 bg-chain-lasna" />
          </span>
          waiting for next leg, {secs(now - run.hops[run.hops.length - 1].at)}
        </li>
      )}
      {run.status === "stalled" && <li className="px-5 py-6 text-sm text-caution sm:px-6">{run.note}</li>}
    </ol>
  );
}

function Idle() {
  const slots = [
    ["origin", "Your transaction on Base or Unichain"],
    ["ledger", "The ClearingHouse reacts on Lasna"],
    ["destination", "The callback lands on the other chain"],
  ];
  return (
    <ol className="grid border-b border-line sm:grid-cols-3">
      {slots.map(([k, v], i) => (
        <li key={k} className="border-b border-line px-5 py-6 sm:border-b-0 sm:border-r sm:px-6">
          <div className="font-mono text-xs text-faint">
            {String(i + 1).padStart(2, "0")} / {k}
          </div>
          <div className="mt-4 text-muted">{v}</div>
        </li>
      ))}
    </ol>
  );
}
