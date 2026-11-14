import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { CHAIN_META, type ChainKey } from "../lib/chain";
import type { LoopRun } from "../lib/loop";

/**
 * The three chains on one line, with the ledger in the middle because every leg passes through it.
 * Each landed leg lights the stretch of rail it crossed; while a leg is outstanding a packet travels
 * toward the chain it is expected on. Positions come from the real hops in `lib/loop.ts`, never a timer.
 */

const POS: Record<ChainKey, number> = { base: 0, lasna: 50, unichain: 100 };
const COLOR: Record<ChainKey, string> = { base: "var(--base)", lasna: "var(--lasna)", unichain: "var(--unichain)" };
const ORDER: ChainKey[] = ["base", "lasna", "unichain"];
const EASE = [0.65, 0, 0.35, 1] as const;

/** Where the next leg should land: the ledger after either end; after the ledger, the credit side, except
 * for the second phase of a withdrawal, which returns to Base to release collateral. */
export function nextChain(run: LoopRun): ChainKey {
  const last = run.hops[run.hops.length - 1].chain;
  if (last !== "lasna") return "lasna";
  return run.hops.length >= 4 ? "base" : "unichain";
}

export function ChainRail({ run }: { run?: LoopRun }) {
  const reduce = useReducedMotion();
  const hops = run?.hops ?? [];
  const last = hops[hops.length - 1];
  const visited = new Set(hops.map((h) => h.chain));
  const target = run?.status === "running" ? nextChain(run) : undefined;

  return (
    <div className="relative px-10 pb-16 pt-12 sm:px-20" aria-hidden>
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-[calc(50%-0.5px)] h-px bg-line-strong" />

        {hops.slice(1).map((h, i) => {
          const from = POS[hops[i].chain];
          const to = POS[h.chain];
          const forward = to >= from;
          return (
            <motion.div
              key={`${i}-${h.tx}`}
              className="absolute top-[calc(50%-1px)] h-[2px]"
              style={{
                left: `${Math.min(from, to)}%`,
                width: `${Math.abs(to - from)}%`,
                transformOrigin: forward ? "left" : "right",
                background: `linear-gradient(${forward ? 90 : 270}deg, ${COLOR[hops[i].chain]}, ${COLOR[h.chain]})`,
                boxShadow: `0 0 14px ${COLOR[h.chain]}`,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, ease: EASE }}
            />
          );
        })}

        {target && last && !reduce && <Packet key={hops.length} from={POS[last.chain]} to={POS[target]} color={COLOR[target]} />}
        {!run && !reduce && <IdlePacket />}

        {ORDER.map((c) => (
          <Node key={c} chain={c} lit={visited.has(c)} target={target === c} arrivals={hops.filter((h) => h.chain === c).length} />
        ))}
      </div>
    </div>
  );
}

function Node({ chain, lit, target, arrivals }: { chain: ChainKey; lit: boolean; target: boolean; arrivals: number }) {
  const color = COLOR[chain];
  return (
    <div className="absolute top-1/2" style={{ left: `${POS[chain]}%` }}>
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        <span
          className={cn("relative z-10 block size-3.5 border transition-[background,box-shadow] duration-500")}
          style={{ borderColor: color, background: lit ? color : "var(--paper)", boxShadow: lit ? `0 0 18px 2px ${color}` : "none" }}
        />
        {/* One ring per leg that lands here; keyed by the count so each arrival plays once. */}
        {arrivals > 0 && (
          <motion.span
            key={arrivals}
            className="absolute inset-0 border"
            style={{ borderColor: color }}
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 4.5, opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        )}
        {target && (
          <motion.span
            className="absolute -inset-1.5 border border-dashed"
            style={{ borderColor: color }}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <div className="absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap text-center">
          <div className="font-mono text-xs" style={{ color: lit || target ? color : "var(--muted)" }}>
            {CHAIN_META[chain].short}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-faint">{CHAIN_META[chain].role.toLowerCase()}</div>
        </div>
      </div>
    </div>
  );
}

/** The bright head with a fading tail, running from the last chain heard from to the one expected next. */
function Packet({ from, to, color }: { from: number; to: number; color: string }) {
  const forward = to >= from;
  return (
    <motion.div
      className="absolute top-1/2 z-20"
      initial={{ left: `${from}%` }}
      animate={{ left: [`${from}%`, `${to}%`] }}
      transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.2, ease: EASE }}
    >
      <Head color={color} forward={forward} />
    </motion.div>
  );
}

/** Before any action: a dimmer packet tracing the deposit route, so the rail explains itself. */
function IdlePacket() {
  return (
    <motion.div
      className="absolute top-1/2 z-20"
      initial={{ left: "0%", opacity: 0 }}
      animate={{ left: ["0%", "50%", "50%", "100%", "100%"], opacity: [0, 0.7, 0.7, 0.7, 0] }}
      transition={{ duration: 5, times: [0, 0.32, 0.46, 0.8, 1], repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" }}
    >
      <Head color="var(--lasna)" forward />
    </motion.div>
  );
}

function Head({ color, forward }: { color: string; forward: boolean }) {
  return (
    <div className="relative -translate-x-1/2 -translate-y-1/2">
      <span
        className="absolute top-[calc(50%-1px)] h-[2px] w-16"
        style={{ [forward ? "right" : "left"]: "50%", background: `linear-gradient(${forward ? 90 : 270}deg, transparent, ${color})` }}
      />
      <span className="relative block size-2.5 bg-ink" style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent), 0 0 20px 5px ${color}` }} />
    </div>
  );
}
