import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CHAIN_META, type ChainKey } from "../lib/chain";
import { useSummary } from "../lib/data";
import { useLoops, type LoopRun } from "../lib/loop";
import { scrollToId } from "../lib/ui";
import { chainBg, chainText } from "./primitives";

/** Which benchmarked flow an action matches, so its legs can be compared with measured medians. */
const FLOW_FOR: Record<string, string> = { Deposit: "deposit_to_credit", Withdraw: "withdraw_two_phase" };
const LINGER_MS = 12_000;
const legName = (bench: string) => {
  const t = bench.split(": ").slice(1).join(": ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

type Leg = { chain: ChainKey; label: string; expected?: number; actual?: number; live: boolean };

/**
 * Follows the latest action from the bottom of the screen while it settles, wherever the person is on the
 * page. Times run from the moment the origin transaction confirmed, so wallet signing time is excluded,
 * and each leg is shown next to its measured testnet median when one exists.
 */
export function LoopDock() {
  const loops = useLoops();
  const run = loops[0];
  const summary = useSummary();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loopInView, setLoopInView] = useState(false);

  const active = !!run && (run.status === "running" || now - run.hops[run.hops.length - 1].at < LINGER_MS);
  useEffect(() => {
    if (!active) return; // the clock stops once the tracker has gone
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active, run]);

  // The full settlement section shows the same thing; step aside while it is on screen.
  useEffect(() => {
    const el = document.getElementById("settlement");
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setLoopInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = active && run && dismissed !== run.id && !loopInView;
  const flow = run ? summary.data?.flows[FLOW_FOR[run.label.split(" ")[0]] ?? ""] : undefined;

  return (
    <AnimatePresence>
      {show && run && (
        <motion.aside
          key={run.id}
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-paper/95 backdrop-blur-xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(560px,calc(100vw-2rem))] sm:border"
          aria-label="Settlement in progress"
        >
          <Body run={run} now={now} legs={legsFor(run, flow?.legs, now)} expectedTotal={flow?.legs ? flow.legs.slice(1).reduce((a, l) => a + l.p50, 0) : undefined} n={flow?.n} onClose={() => setDismissed(run.id)} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function legsFor(run: LoopRun, bench: { name: string; p50: number }[] | undefined, now: number): Leg[] {
  const [origin, ...rest] = run.hops;
  const legs: Leg[] = rest.map((h, i) => ({ chain: h.chain, label: h.label, actual: h.at - (i === 0 ? origin.at : rest[i - 1].at), expected: bench?.[i + 1]?.p50, live: false }));
  const last = run.hops[run.hops.length - 1];
  if (run.status === "running") {
    const nextBench = bench?.[run.hops.length];
    const chain = (nextBench?.name.split(":")[0] as ChainKey | undefined) ?? (last.chain === "lasna" ? "unichain" : "lasna");
    legs.push({ chain: CHAIN_META[chain] ? chain : "lasna", label: nextBench ? legName(nextBench.name) : "Next leg", expected: nextBench?.p50, actual: now - last.at, live: true });
    // Legs that are still to come, when the flow is benchmarked.
    bench?.slice(run.hops.length + 1).forEach((b) => legs.push({ chain: b.name.split(":")[0] as ChainKey, label: legName(b.name), expected: b.p50, live: false }));
  }
  return legs;
}

function Body({ run, now, legs, expectedTotal, n, onClose }: { run: LoopRun; now: number; legs: Leg[]; expectedTotal?: number; n?: number; onClose: () => void }) {
  const origin = run.hops[0];
  const end = run.status === "running" ? now : run.hops[run.hops.length - 1].at;
  const elapsed = end - origin.at;
  const state = run.status === "running" ? "settling" : run.status === "done" ? "settled" : "still settling";
  return (
    <div>
      <div className="flex items-stretch border-b border-line">
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-xs text-faint" role="status">
            <span className={cn("size-1.5", run.status === "running" ? "animate-pulse bg-chain-lasna" : run.status === "done" ? "bg-safe" : "bg-caution")} aria-hidden />
            {run.label.toLowerCase()}, {state}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{secs(elapsed)}</span>
            <span className="font-mono text-[11px] text-faint">
              {expectedTotal ? `across chains, median ${secs(expectedTotal)} (n=${n})` : "across chains, since your transaction confirmed"}
            </span>
          </div>
        </div>
        <button type="button" onClick={() => scrollToId("settlement")} className="hidden border-l border-line px-4 font-mono text-xs text-muted transition-colors hover:bg-white/[0.04] hover:text-ink sm:block">
          details
        </button>
        <button type="button" onClick={onClose} className="border-l border-line px-3 text-faint transition-colors hover:bg-white/[0.04] hover:text-ink" aria-label="Hide settlement tracker">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, legs.length)}, minmax(0, 1fr))` }}>
        {legs.map((l, i) => {
          const pending = l.actual === undefined;
          const slow = l.expected !== undefined && l.actual !== undefined && l.actual > l.expected * 1.5;
          return (
            <li key={i} className={cn("relative min-w-0 border-r border-line px-2 py-2.5 last:border-r-0 sm:px-3")}>
              <span className={cn("absolute inset-x-0 top-0 h-[2px] origin-left", pending ? "bg-line-strong" : chainBg[l.chain], l.live && "animate-pulse")} aria-hidden />
              <div className={cn("truncate font-mono text-[11px]", pending ? "text-faint" : chainText[l.chain])}>{CHAIN_META[l.chain].short}</div>
              <div className="mt-0.5 hidden truncate text-xs text-muted sm:block" title={l.label}>
                {l.label}
              </div>
              <div className="mt-1 whitespace-nowrap font-mono text-[11px] tabular-nums sm:text-xs">
                <span className={cn(l.live ? "text-ink" : slow ? "text-caution" : "text-ink")}>{pending ? "–" : secs(l.actual!)}</span>
                {l.expected !== undefined && <span className="text-faint"> / {secs(l.expected)}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {run.status === "stalled" && <p className="border-t border-line px-4 py-2 text-xs text-caution">{run.note}</p>}
    </div>
  );
}
