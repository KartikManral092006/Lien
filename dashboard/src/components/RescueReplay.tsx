import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { ArrowDown, ArrowUpRight, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CHAIN_META, type ChainKey } from "../lib/chain";
import type { LoopRun } from "../lib/loop";
import { DEMO_VIDEO_URL, RESCUE_RUN, WATCH_RESCUE_EVENT } from "../lib/rescueRun";
import { ChainRail } from "./ChainRail";
import { Num } from "./fx/Num";
import { Band, RevealHeading } from "./grid";
import { Button, TxLink, chainBg, chainText } from "./primitives";

/**
 * A recorded shield rescue, played back so anyone can watch one without a wallet. Every leg is a real
 * transaction from the benchmark (lib/rescueRun.ts). "Paced to read" spreads the legs out so each one can
 * be read; "Real speed" plays them at the gaps the benchmark observed. The clock always shows real time.
 */

const LEGS = RESCUE_RUN.legs;
const REAL_S = LEGS.map((l) => (l.observedAtMs - LEGS[0].observedAtMs) / 1000);
const LEAD = 700; // ms of the borrower's calm state before the price drop lands
const READ_GAPS = [2900, 2900, 2500, 2800];
const OUTRO = 700;
const EASE = [0.16, 1, 0.3, 1] as const;
const RUNS_URL = "https://github.com/KartikManral092006/Lien/blob/main/results/runs.jsonl";

type Speed = "read" | "real";
/** queued: reset to the calm state, waiting for the page to finish scrolling here before playing. */
type Phase = "idle" | "queued" | "playing" | "done";

function scheduleFor(speed: Speed) {
  if (speed === "real") return REAL_S.map((s) => LEAD + s * 1000);
  const out = [LEAD];
  for (const g of READ_GAPS) out.push(out[out.length - 1] + g);
  return out;
}

/** Real seconds since the price drop, interpolated between legs so the clock runs smoothly at any pace. */
function realSeconds(e: number, times: number[]) {
  if (e <= times[0]) return 0;
  for (let i = 1; i < times.length; i++) {
    if (e <= times[i]) return REAL_S[i - 1] + ((e - times[i - 1]) / (times[i] - times[i - 1])) * (REAL_S[i] - REAL_S[i - 1]);
  }
  return REAL_S[REAL_S.length - 1];
}

const WHERE: Record<ChainKey, string> = {
  base: "Base Sepolia · price oracle",
  lasna: "Reactive Lasna · ClearingHouse",
  unichain: "Unichain Sepolia · CreditMarket",
};

export function RescueReplay() {
  const reduce = !!useReducedMotion();
  // Watch the rail, not the whole section: on a phone the section is taller than the screen.
  const railRef = useRef<HTMLDivElement>(null);
  const inView = useInView(railRef, { once: true, amount: 0.8 });
  const [speed, setSpeed] = useState<Speed>("read");
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0); // legs landed so far
  const [runKey, setRunKey] = useState(0);
  const clock = useMotionValue(0);
  const progress = useMotionValue(0);
  const clockText = useTransform(clock, (v) => v.toFixed(1));
  const times = useMemo(() => scheduleFor(speed), [speed]);
  const end = times[times.length - 1] + OUTRO;

  const play = useCallback(
    (s: Speed) => {
      setSpeed(s);
      setStep(0);
      clock.set(0);
      progress.set(0);
      setPhase("playing");
      setRunKey((k) => k + 1);
    },
    [clock, progress],
  );

  // One clock drives everything: the counter, the progress line, and which legs have landed.
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let landed = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const e = now - t0;
      clock.set(realSeconds(e, times));
      progress.set(Math.min(1, e / end));
      let n = 0;
      while (n < times.length && e >= times[n]) n++;
      if (n !== landed) {
        landed = n;
        setStep(n);
      }
      if (e >= end) {
        setPhase("done");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, runKey, times, end, clock, progress]);

  // The navbar button scrolls here (Lenis handles the anchor); show the calm state and start once arrived.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const onWatch = () => {
      clearTimeout(id);
      setPhase("queued");
      setStep(0);
      clock.set(0);
      progress.set(0);
      id = setTimeout(() => play("read"), 1100);
    };
    window.addEventListener(WATCH_RESCUE_EVENT, onWatch);
    return () => {
      clearTimeout(id);
      window.removeEventListener(WATCH_RESCUE_EVENT, onWatch);
    };
  }, [play, clock, progress]);

  // Plays once by itself when it first comes into view; people who ask for less motion press play.
  useEffect(() => {
    if (!inView || phase !== "idle" || reduce) return;
    const id = setTimeout(() => play("read"), 450);
    return () => clearTimeout(id);
  }, [inView, phase, reduce, play]);

  const run: LoopRun = {
    id: runKey,
    label: "Shield rescue",
    startedAt: 0,
    hops: LEGS.slice(0, step).map((l) => ({ chain: l.chain, label: l.title, tx: l.tx, at: 0 })),
    status: step > 0 && step < LEGS.length ? "running" : "done",
  };
  const next = step > 0 && step < LEGS.length ? LEGS[step].chain : undefined;
  const travelMs = next ? Math.max(300, times[step] - times[step - 1] - 120) : undefined;

  const caption =
    phase === "idle"
      ? "Press play to watch a real price crash, and what Lien did about it."
      : step === 0
        ? "The borrower is safe. Watch the price."
        : step < LEGS.length
          ? `${step} of ${LEGS.length} · ${LEGS[step - 1].title}`
          : "Rescued. The loan never became liquidatable.";

  return (
    <Band id="rescue" label="replay · a real shield rescue" aside={<span className="hidden sm:inline">recorded on testnet, {RESCUE_RUN.recordedOn} · no wallet needed</span>}>
      <div>
        <div className="grid border-b border-line lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="px-5 py-12 sm:px-8 sm:py-16">
            <RevealHeading text="Watch Reactive save a loan in 5 seconds." className="max-w-[17ch] text-[clamp(2rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]" />
            <p className="mt-5 max-w-[60ch] text-muted">
              A price crash pushes a loan past its liquidation line. Lien's reactive contract notices on its own and repays part of the loan from the borrower's shield, before anyone can liquidate it.
              This is a recording of a real run on testnet: every step links to its transaction.
            </p>
          </div>
          <div className="flex flex-col justify-end gap-5 border-t border-line px-5 py-8 sm:px-8 lg:border-l lg:border-t-0">
            <div>
              <div className="font-mono text-xs text-faint">seconds since the price drop</div>
              <div className="mt-2 flex items-baseline text-6xl font-semibold tabular-nums tracking-[-0.05em]">
                <motion.span>{clockText}</motion.span>
                <span className="ml-1 text-3xl text-faint">s</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => play(speed)} className="min-w-28">
                {phase === "idle" ? <Play className="size-3.5" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                {phase === "idle" ? "Play" : "Replay"}
              </Button>
              <div role="radiogroup" aria-label="Playback speed" className="flex border border-line-strong">
                {(
                  [
                    ["read", "Paced to read"],
                    ["real", "Real speed"],
                  ] as const
                ).map(([s, label]) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={speed === s}
                    onClick={() => play(s)}
                    className={cn("h-8 px-3 text-xs font-medium transition-colors", speed === s ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div ref={railRef} id="rescue-live" className="relative border-b border-line">
          <motion.div aria-hidden className="absolute inset-x-0 top-0 h-px origin-left bg-[linear-gradient(90deg,var(--base),var(--lasna),var(--unichain))]" style={{ scaleX: progress }} />
          <ChainRail run={run} next={next} travelMs={travelMs} />
          <p className="min-h-11 border-t border-line px-5 py-3 font-mono text-xs text-faint sm:px-8" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={caption}
                className="inline-block"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {caption}
              </motion.span>
            </AnimatePresence>
          </p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_440px] *:min-w-0">
          <ol className="border-line" aria-label="What happened, step by step">
            {LEGS.map((leg, i) => (
              <StepRow key={i} i={i} leg={leg} state={i < step - 1 ? "done" : i === step - 1 ? "current" : "todo"} />
            ))}
          </ol>
          {/* On narrow screens the loan sits above the steps, so it stays in sight while they play. */}
          <div className="order-first border-b border-line lg:order-none lg:border-b-0 lg:border-l">
            <Borrower step={step} />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {phase === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="grid items-center gap-6 border-t border-line bg-safe/[0.05] px-5 py-8 sm:px-8 md:grid-cols-[auto_minmax(0,1fr)]">
                <div>
                  <div className="text-6xl font-semibold leading-none tracking-[-0.05em] text-safe">
                    {RESCUE_RUN.onchainSeconds}
                    <span className="ml-1 text-3xl">s</span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-faint">on-chain, by block timestamps</div>
                </div>
                <div>
                  <p className="max-w-[64ch] text-lg leading-relaxed text-muted">
                    <span className="text-ink">Rescued automatically.</span> The reactive contract saw the crash on Base and repaid the loan on Unichain from the borrower's own shield. No bot, no keeper,
                    no click.
                  </p>
                  <p className="mt-3 font-mono text-[11px] text-faint">
                    {RESCUE_RUN.onchainSeconds} s from the price-drop block on Base to the rescue block on Unichain. The clock reads {REAL_S[REAL_S.length - 1].toFixed(1)} s because it also counts the
                    time our script took to notice each transaction.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-4 border-t border-line px-5 py-5 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11px] text-faint">
            Recorded by benchmark run{" "}
            <a href={RUNS_URL} target="_blank" rel="noreferrer" className="text-muted underline-offset-4 hover:text-ink hover:underline">
              {RESCUE_RUN.runId}
            </a>{" "}
            against the contracts this page uses.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 border border-line-strong bg-white/[0.03] px-3 text-xs font-medium text-ink transition-colors hover:border-white/30 hover:bg-white/[0.07]"
            >
              Watch the 2:43 video
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
            <a href="#position" className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-ink">
              Try it yourself with a wallet
              <ArrowDown className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </Band>
  );
}

function StepRow({ i, leg, state }: { i: number; leg: (typeof LEGS)[number]; state: "done" | "current" | "todo" }) {
  const landed = state !== "todo";
  return (
    <li
      className={cn(
        "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-b border-line px-5 py-5 transition-[opacity,background-color] duration-500 last:border-b-0 sm:px-8",
        state === "todo" && "opacity-35",
        state === "current" && "bg-white/[0.025]",
      )}
    >
      <motion.span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-0.5 origin-top", chainBg[leg.chain])}
        initial={false}
        animate={{ scaleY: state === "current" ? 1 : 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      />
      <span className={cn("pt-0.5 font-mono text-xs transition-colors duration-500", landed ? chainText[leg.chain] : "text-faint")}>{String(i + 1).padStart(2, "0")}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className={cn("font-mono text-[11px] transition-colors duration-500", landed ? chainText[leg.chain] : "text-faint")}>{WHERE[leg.chain]}</span>
          <span className="font-mono text-[11px] tabular-nums text-faint">{i === 0 ? "0.0 s" : `+${REAL_S[i].toFixed(1)} s`}</span>
        </div>
        <div className="mt-1.5 font-medium leading-snug text-ink">{leg.title}</div>
        <p className="mt-1 text-sm leading-relaxed text-muted">{leg.detail}</p>
        <div className="mt-2 h-4">
          {landed && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="inline-flex items-center gap-2">
              <span className="font-mono text-[11px] text-faint">tx</span>
              <TxLink chain={leg.chain} hash={leg.tx} />
              <span className="sr-only">on {CHAIN_META[leg.chain].name}</span>
            </motion.span>
          )}
        </div>
      </div>
    </li>
  );
}

/** The borrower's loan as the replay moves: the bar is collateral value, the fill is debt, the red tick is the liquidation line. */
function Borrower({ step }: { step: number }) {
  const { before, after, ltBps } = RESCUE_RUN;
  const dropped = step >= 1;
  const saved = step >= LEGS.length;
  const price = dropped ? after.price : before.price;
  const value = price * before.collateralWeth;
  const line = (value * ltBps) / 10_000;
  const debt = saved ? after.debt : before.debt;
  const shield = saved ? after.shield : before.shield;
  const health = line / debt;
  const status: "safe" | "risk" | "saved" = !dropped ? "safe" : saved ? "saved" : "risk";
  const scale = before.price * before.collateralWeth;
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const spring = { type: "spring", stiffness: 90, damping: 20 } as const;

  return (
    <div className="px-5 py-8 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-faint">the borrower</span>
        <StatusPill status={status} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Locked 1 WETH on Base, borrowed the maximum on Unichain, and set aside a {before.shield} USDC shield.
      </p>

      <div className="mt-7 flex items-baseline justify-between">
        <span className="text-sm text-muted">WETH price</span>
        <span className="text-3xl font-semibold tracking-[-0.03em]">
          <Num value={price} digits={0} prefix="$" good="up" />
        </span>
      </div>

      <div className="mt-6" aria-hidden>
        <div className="relative h-9">
          {/* full width = collateral value before the drop; the track shrinks when the price falls */}
          <motion.div className="absolute inset-y-0 left-0 border border-line-strong bg-white/[0.03]" initial={false} animate={{ width: pct(value) }} transition={spring} />
          <motion.div
            className="absolute inset-y-[5px] left-[5px]"
            initial={false}
            animate={{ width: `calc(${pct(debt)} - 5px)`, backgroundColor: status === "risk" ? "var(--danger)" : "var(--safe)" }}
            transition={{ width: spring, backgroundColor: { duration: 0.5 } }}
            style={{ opacity: 0.75 }}
          />
          <motion.div className="absolute -inset-y-1.5 w-0.5 bg-danger" initial={false} animate={{ left: pct(line) }} transition={spring}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-danger">liquidation line</span>
          </motion.div>
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
          <span>debt</span>
          <span>collateral value ${value.toLocaleString()}</span>
        </div>
      </div>

      <dl className="mt-7 grid grid-cols-3 border border-line">
        <Stat label="Debt (USDC)">
          <Num value={debt} digits={0} good="down" />
        </Stat>
        <Stat label="Shield (USDC)" className="border-l border-line">
          <Num value={shield} digits={0} />
        </Stat>
        <Stat label="Health" className="border-l border-line">
          <span className={cn("transition-colors duration-500", status === "risk" ? "text-danger" : "text-ink")}>
            <Num value={health} digits={2} good="up" />
          </span>
        </Stat>
      </dl>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-faint">
        Health = liquidation line ÷ debt. Below 1.00, anyone may liquidate the loan. Liquidation line = 80% of collateral value.
      </p>
    </div>
  );
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-3 py-3", className)}>
      <dt className="font-mono text-[10px] text-faint">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-[-0.02em]">{children}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: "safe" | "risk" | "saved" }) {
  const text = status === "safe" ? "Safe" : status === "risk" ? "Past the liquidation line" : "Protected by its shield";
  const tone = status === "risk" ? "border-danger/40 bg-danger/10 text-danger" : "border-safe/40 bg-safe/10 text-safe";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.3, ease: EASE }}
        className={cn("inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[11px]", tone)}
      >
        <span className={cn("dot size-1.5", status === "risk" ? "animate-pulse bg-danger" : "bg-safe")} />
        {text}
      </motion.span>
    </AnimatePresence>
  );
}
