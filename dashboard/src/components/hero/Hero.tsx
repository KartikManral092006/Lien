import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ScenePoster } from "./ScenePoster";
import { CHAIN_META, PRICE, fmt, type ChainKey } from "../../lib/chain";
import { useHeads, type Summary } from "../../lib/data";
import { Band } from "../grid";
import { Marquee } from "../magicui/marquee";
import { NumberTicker } from "../magicui/number-ticker";
import { chainBg } from "../primitives";

const Scene = lazy(() => import("./Scene"));
const ease = [0.16, 1, 0.3, 1] as const;

/**
 * three.js is the heaviest chunk on the page (~900 KB). It loads only after the page is idle, and only on
 * devices that can draw it smoothly; everyone else keeps the still poster, which matches the scene.
 */
function use3D(reduce: boolean) {
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
    const slowNet = nav.connection?.saveData || /(^|-)2g$/.test(nav.connection?.effectiveType ?? "");
    const weak = (nav.hardwareConcurrency ?? 4) < 4 || (nav.deviceMemory ?? 4) < 4;
    // Phones and tablets keep the poster: the scene costs ~250 KB and seconds of CPU on mobile chips.
    const handheld = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    let webgl = false;
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
    if (slowNet || weak || handheld || !webgl) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setLoad(true), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setLoad(true), 1200);
    return () => window.clearTimeout(id);
  }, [reduce]);
  return load;
}

export function Hero({ summary, price }: { summary?: Summary | null; price?: bigint }) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  // As the hero scrolls away: the headline lifts and fades, the scene turns and recedes.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => (scroll.current = v));
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -140]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, reduce ? 1 : 0]);
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12]);
  const load3D = use3D(reduce);
  const [sceneReady, setSceneReady] = useState(false);

  const enter = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, ease, delay: 0.15 + i * 0.1 },
  });

  return (
    <div ref={ref} id="top" className="pt-14">
      <Band label="cross-chain credit, settled by Reactive" aside={<span className="hidden sm:inline">Base Sepolia / Reactive Lasna / Unichain Sepolia</span>}>
        <motion.div style={{ y: textY, opacity: textOpacity }} className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="border-line px-5 py-14 sm:px-8 sm:py-20 lg:border-r">
            <motion.h1
              initial={reduce ? false : { y: 24 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.9, ease, delay: 0.05 }}
              className="max-w-[14ch] text-[clamp(2.8rem,7.4vw,6rem)] font-semibold leading-[0.95] tracking-[-0.05em]">
              Borrow on Unichain. <span className="text-spectrum animate-gradient-x">Keep collateral on Base.</span>
            </motion.h1>
          </div>
          <div className="flex flex-col justify-end border-t border-line lg:border-t-0">
            <motion.p {...enter(1)} className="px-5 py-8 text-lg leading-relaxed text-muted sm:px-8">
              Your collateral stays on Base and you borrow on Unichain, with no bridge and no wrapped tokens. One ledger on Reactive Network settles both chains in seconds.
            </motion.p>
            <motion.div {...enter(2)} className="grid grid-cols-2 border-t border-line">
              <a href="#position" className="flex h-16 items-center justify-center bg-ink text-sm font-medium text-paper transition-colors hover:bg-white">
                Open your position
              </a>
              <a href="#how" className="flex h-16 items-center justify-center border-l border-line text-sm font-medium transition-colors hover:bg-white/[0.04]">
                How it works
              </a>
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          style={{ scale: sceneScale }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.6, delay: 0.4 }}
          className="relative h-[clamp(320px,48vh,540px)] overflow-hidden border-t border-line bg-[radial-gradient(ellipse_60%_70%_at_50%_55%,rgb(34_211_238/0.10),transparent)]"
          aria-hidden
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,black,transparent)]" />
          <ScenePoster hidden={sceneReady} />
          {load3D && (
            <Suspense fallback={null}>
              <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: sceneReady ? 1 : 0 }} transition={{ duration: 0.9 }}>
                <Scene still={reduce} scroll={scroll} onReady={() => setSceneReady(true)} />
              </motion.div>
            </Suspense>
          )}
        </motion.div>
      </Band>

      <Stats summary={summary} />
      <Ticker summary={summary} price={price} />
    </div>
  );
}

const FLOW_LABEL: Record<string, string> = {
  deposit_to_credit: "Deposit to usable credit",
  withdraw_two_phase: "Safe two-phase withdrawal",
  price_to_limit: "Price drop to new limit",
};

function Stats({ summary }: { summary?: Summary | null }) {
  const flows = summary ? ["deposit_to_credit", "withdraw_two_phase", "price_to_limit"].filter((k) => summary.flows[k]) : [];
  return (
    <Band>
      <dl className="grid grid-cols-2 md:grid-cols-4">
        <Stat i={0} label="Bridges or wrapped tokens" value={<NumberTicker value={0} className="text-ink" />} />
        {flows.map((k, i) => {
          const f = summary!.flows[k];
          return (
            <Stat
              key={k}
              i={i + 1}
              label={FLOW_LABEL[k] ?? k}
              note={`median, ${f.n} testnet runs`}
              value={
                <>
                  <NumberTicker value={Number((f.p50 / 1000).toFixed(1))} decimalPlaces={1} className="text-ink" />
                  <span className="ml-1 text-2xl text-faint">s</span>
                </>
              }
            />
          );
        })}
      </dl>
    </Band>
  );
}

function Stat({ label, value, note, i }: { label: string; value: React.ReactNode; note?: string; i: number }) {
  return (
    <div className={`border-line px-5 py-8 sm:px-8 ${i % 2 === 1 ? "border-l" : ""} ${i >= 2 ? "border-t md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
      <dt className="font-mono text-xs text-faint">{label}</dt>
      <dd className="mt-4 text-[clamp(2.2rem,4vw,3.2rem)] font-semibold leading-none tracking-[-0.04em]">{value}</dd>
      {note && <dd className="mt-2 font-mono text-[11px] text-faint">{note}</dd>}
    </div>
  );
}

/** Live strip: latest blocks on each chain, the test oracle price, and measured speeds. */
function Ticker({ summary, price }: { summary?: Summary | null; price?: bigint }) {
  const { data } = useHeads();
  const items: { key: string; label: string; value: string; chain?: ChainKey }[] = [
    ...(["base", "lasna", "unichain"] as ChainKey[]).map((c) => ({ key: c, label: CHAIN_META[c].name, value: data?.[c] ? `#${data[c]!.number.toLocaleString()}` : "…", chain: c })),
    { key: "px", label: "WETH (test oracle)", value: price !== undefined ? `$${fmt(price, PRICE)}` : "…" },
    ...(summary ? Object.entries(summary.flows).map(([k, f]) => ({ key: k, label: k.replace(/_/g, " "), value: `${(f.p50 / 1000).toFixed(1)}s median` })) : []),
    { key: "b", label: "bridges", value: "0" },
    { key: "l", label: "ledgers", value: "1" },
  ];
  return (
    <Band>
      <div className="relative overflow-hidden py-1 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <Marquee pauseOnHover className="[--duration:42s] [--gap:0rem]" repeat={3}>
          {items.map((it) => (
            <span key={it.key} className="flex items-center gap-3 border-r border-line px-6 py-2.5 font-mono text-xs whitespace-nowrap">
              {it.chain && <span className={`size-1.5 ${chainBg[it.chain]}`} />}
              <span className="text-faint">{it.label}</span>
              <span className="text-ink">{it.value}</span>
            </span>
          ))}
        </Marquee>
      </div>
    </Band>
  );
}
