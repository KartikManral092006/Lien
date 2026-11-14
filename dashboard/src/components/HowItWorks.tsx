import { Landmark, Scale, Wallet } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { CHAIN_META, type ChainKey } from "../lib/chain";
import { Band, RevealHeading } from "./grid";
import { AnimatedBeam } from "./magicui/animated-beam";
import { chainText } from "./primitives";
import { scrollToY } from "../lib/ui";

const COLOR: Record<ChainKey, string> = { base: "#4C8DFF", lasna: "#22D3EE", unichain: "#FF4FA3" };
const ICON = { base: Landmark, lasna: Scale, unichain: Wallet };
type Leg = { from: ChainKey; to: ChainKey };

const ROUTES: { from: ChainKey; to: ChainKey; curve: number; reverse: boolean }[] = [
  { from: "base", to: "lasna", curve: 60, reverse: false },
  { from: "lasna", to: "unichain", curve: 60, reverse: false },
  { from: "unichain", to: "lasna", curve: -60, reverse: true },
  { from: "lasna", to: "base", curve: -60, reverse: true },
];

const STEPS: { title: string; body: string; decides: string; legs: Leg[] }[] = [
  {
    title: "Deposit on Base, borrow on Unichain",
    body: "Your WETH stays in a vault on Base. The ledger on Reactive sees the deposit and sets your credit limit on Unichain.",
    decides: "limit = collateral × price × 70%",
    legs: [
      { from: "base", to: "lasna" },
      { from: "lasna", to: "unichain" },
    ],
  },
  {
    title: "Withdraw in two safe steps",
    body: "Unichain lowers your limit first and reports your exact debt. Base releases the WETH only if that debt still fits.",
    decides: "release only if debt ≤ new limit",
    legs: [
      { from: "base", to: "lasna" },
      { from: "lasna", to: "unichain" },
      { from: "unichain", to: "lasna" },
      { from: "lasna", to: "base" },
    ],
  },
  {
    title: "A shield steps in before liquidation",
    body: "If WETH falls past 75% of your collateral value, the ledger repays part of your loan from your shield, in the same message that would have flagged you.",
    decides: "repay down to the new limit, from the shield",
    legs: [
      { from: "base", to: "lasna" },
      { from: "lasna", to: "unichain" },
    ],
  },
  {
    title: "Liquidation across chains in one loop",
    body: "Past the 80% threshold, a liquidator repays on Unichain and is paid collateral on Base, plus a 5% bonus. Nobody bridges anything.",
    decides: "seize = repaid ÷ price × 1.05",
    legs: [
      { from: "unichain", to: "lasna" },
      { from: "lasna", to: "base" },
    ],
  },
];

export function HowItWorks() {
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));
  const s = STEPS[step];
  // Keyboard and click access to the scroll story: jump to the scroll position where step i plays.
  const jump = (i: number) => {
    const el = track.current;
    if (reduce || !el) return setStep(i);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const travel = el.offsetHeight - (window.innerHeight - 56);
    scrollToY(top + ((i + 0.5) / STEPS.length) * travel);
  };

  return (
    <Band id="how" label="how it works" aside={<span>{String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}</span>}>
      <div className="border-b border-line px-5 py-12 sm:px-8 sm:py-16">
        <RevealHeading text="One ledger, two chains, no bridge in between." className="max-w-[18ch] text-[clamp(2rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]" />
      </div>

      {/* Scroll track: the panel pins while the four steps play through. */}
      <div ref={track} className={cn("relative", !reduce && "h-[320vh]")}>
        <div className={cn("grid grid-rows-[minmax(170px,1fr)_auto] lg:grid-cols-[minmax(0,420px)_1fr] lg:grid-rows-1", !reduce && "sticky top-14 h-[calc(100svh-3.5rem)]")}>
          <ol className="order-2 border-t border-line lg:order-1 lg:border-r lg:border-t-0">
            {STEPS.map((st, i) => (
              <li key={st.title} className={cn("relative border-b border-line px-5 py-3.5 transition-[opacity,background-color] duration-500 sm:px-8 sm:py-5", i === step ? "bg-white/[0.03]" : "text-muted")}>
                {i === step && <motion.span layoutId="how-bar" className="absolute inset-y-0 left-0 w-[2px] bg-chain-lasna" />}
                <h3>
                  <button type="button" onClick={() => jump(i)} aria-current={i === step ? "step" : undefined} className="flex w-full items-baseline gap-4 text-left">
                    <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-base font-semibold tracking-[-0.02em] sm:text-lg">{st.title}</span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {i === step && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="mt-3 pl-8 leading-relaxed text-muted">{st.body}</p>
                      <p className="mt-3 pl-8 font-mono text-xs text-chain-lasna">ledger decides: {st.decides}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ol>
          <div className="order-1 flex min-h-0 flex-col lg:order-2">
            <Diagram legs={s.legs} stepKey={step} />
            <div className="h-[2px] bg-line">
              <motion.div className="h-full origin-left bg-gradient-to-r from-chain-base via-chain-lasna to-chain-uni" style={{ scaleX: scrollYProgress }} />
            </div>
          </div>
        </div>
      </div>
    </Band>
  );
}

function Diagram({ legs, stepKey }: { legs: Leg[]; stepKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const lasna = useRef<HTMLDivElement>(null);
  const unichain = useRef<HTMLDivElement>(null);
  const refs = { base, lasna, unichain };
  const lit = new Set(legs.flatMap((l) => [l.from, l.to]));

  return (
    <div
      ref={box}
      className="relative flex flex-1 items-center justify-between overflow-hidden bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] bg-[size:48px_48px] px-6 sm:px-16"
    >
      {(["base", "lasna", "unichain"] as ChainKey[]).map((c) => (
        <Node key={c} chain={c} innerRef={refs[c]} lit={lit.has(c)} />
      ))}
      {ROUTES.map((r) => {
        const order = legs.findIndex((l) => l.from === r.from && l.to === r.to);
        const active = order >= 0;
        return (
          <AnimatedBeam
            key={`${r.from}-${r.to}-${active ? stepKey : "idle"}`}
            containerRef={box}
            fromRef={refs[r.from]}
            toRef={refs[r.to]}
            curvature={r.curve}
            reverse={r.reverse}
            duration={active ? 2.2 : 6}
            delay={active ? order * 0.5 : 0}
            pathColor="rgb(148 163 184)"
            pathOpacity={active ? 0.35 : 0.1}
            pathWidth={active ? 2.5 : 1.5}
            gradientStartColor={active ? COLOR[r.from] : "transparent"}
            gradientStopColor={active ? COLOR[r.to] : "transparent"}
          />
        );
      })}
    </div>
  );
}

function Node({ chain, innerRef, lit }: { chain: ChainKey; innerRef: RefObject<HTMLDivElement>; lit: boolean }) {
  const Icon = ICON[chain];
  const center = chain === "lasna";
  return (
    <div className="relative z-10 flex flex-col items-center">
      <div
        ref={innerRef}
        className={cn("grid place-items-center border bg-paper transition-all duration-500", center ? "size-20 sm:size-24" : "size-16 sm:size-20", lit ? "border-transparent" : "border-line-strong")}
        style={lit ? { boxShadow: `0 0 0 1px ${COLOR[chain]}, 0 0 40px -8px ${COLOR[chain]}` } : undefined}
      >
        <Icon className={cn(center ? "size-8" : "size-7", lit ? chainText[chain] : "text-faint")} strokeWidth={1.5} aria-hidden />
      </div>
      <div className="mt-3 text-center">
        <div className={cn("font-mono text-xs", lit ? chainText[chain] : "text-muted")}>
          <span className="sm:hidden">{CHAIN_META[chain].short}</span>
          <span className="hidden sm:inline">{CHAIN_META[chain].name}</span>
        </div>
        <div className="font-mono text-[11px] text-faint">{CHAIN_META[chain].role}</div>
      </div>
    </div>
  );
}
