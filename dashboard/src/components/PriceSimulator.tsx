import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { COLL, DEBT, PRICE, fmt } from "../lib/chain";
import type { Position } from "../lib/data";
import { outcomeAt, priceAtBps, type Outcome } from "../lib/risk";

const CENT = 10n ** BigInt(PRICE - 2); // slider works in whole cents
const toCents = (p: bigint) => Number(p / CENT);
const fromCents = (c: number) => BigInt(Math.round(c)) * CENT;
const usd = (p: bigint) => `$${fmt(p, PRICE)}`;
const healthText = (h: number) => (Number.isFinite(h) ? h.toFixed(2) : "No debt");
const PRESETS = [-10, -20, -30, -40];

/**
 * "What if WETH moves?" Drag the oracle price and see what the ledger would decide: the new credit
 * limit, whether the shield steps in and how much it repays, and whether the account can be liquidated.
 * Runs locally with the same integer maths as the contracts; nothing is sent.
 */
export function PriceSimulator({ p: real, shieldSupported }: { p?: Position; shieldSupported: boolean }) {
  const now = real?.price ?? 0n;
  // null follows the live oracle price; a number is a price the person picked.
  const [cents, setCents] = useState<number | null>(null);
  // An account with no debt has nothing at stake, so it starts on a clearly labelled example loan.
  const [mode, setMode] = useState<"auto" | "real" | "example">("auto");
  const hasDebt = !!real && real.debt > 0n;
  const example = mode === "example" || (mode === "auto" && !hasDebt);
  const value = cents ?? toCents(now);
  const price = fromCents(value);

  const p = useMemo(() => {
    if (!real || !example) return real;
    const limitNow = outcomeAt(real, real.price).limit;
    const debt = (limitNow * 90n) / 100n; // borrowed to 90% of the limit: 63% loan-to-value
    return { ...real, debt, shield: shieldSupported ? (debt * 30n) / 100n : 0n };
  }, [real, example, shieldSupported]);

  const range = useMemo(() => {
    if (!p || p.price === 0n) return undefined;
    const liq = priceAtBps(p, p.ltBps);
    const nowC = toCents(p.price);
    const lo = Math.max(1, Math.floor(Math.min(nowC * 0.3, liq ? toCents(liq) * 0.8 : Infinity)));
    const hi = Math.ceil(Math.max(nowC * 1.5, liq ? toCents(liq) * 1.2 : 0));
    return { lo, hi };
  }, [p]);

  if (!p || !range) return null;

  if (p.collateral === 0n)
    return (
      <Shell>
        <p className="px-5 py-8 text-muted sm:px-8">This account has no collateral yet. Deposit WETH to see how price moves would change it.</p>
      </Shell>
    );

  const o = outcomeAt(p, price);
  const shield = shieldSupported ? (p.shield ?? 0n) : 0n;
  const free = p.collateral - p.pending;
  const marks = {
    liq: priceAtBps(p, p.ltBps),
    protect: shield > 0n ? priceAtBps(p, p.protectBps ?? 7_500n) : undefined,
    cap: p.debt > 0n && free > 0n ? priceAtBps({ ...p, collateral: free }, p.ltvBps) : undefined,
  };
  const pct = (x: bigint | undefined) => (x === undefined ? undefined : Math.min(100, Math.max(0, ((toCents(x) - range.lo) / (range.hi - range.lo)) * 100)));
  const change = now > 0n ? (Number(price - now) / Number(now)) * 100 : 0;

  // Hard-stop zones along the track, low to high price.
  const stops: [string, number][] = [];
  const liqP = pct(marks.liq) ?? 0;
  const protP = pct(marks.protect) ?? liqP;
  const capP = pct(marks.cap) ?? liqP;
  stops.push(["var(--danger)", liqP]);
  if (marks.protect !== undefined) stops.push(["var(--caution)", Math.max(liqP, protP)]);
  stops.push(["var(--faint)", Math.max(liqP, protP, capP)]);
  stops.push(["var(--safe)", 100]);
  let from = 0;
  const gradient = stops.map(([c, to]) => {
    const seg = `color-mix(in srgb, ${c} 28%, transparent) ${from}% ${to}%`;
    from = to;
    return seg;
  });

  return (
    <Shell
      aside={
        <div className="flex items-center gap-4">
          {cents !== null && (
            <button type="button" onClick={() => setCents(null)} className="hidden underline-offset-4 hover:text-ink hover:underline sm:inline">
              back to live price
            </button>
          )}
          <div className="flex border border-line" role="radiogroup" aria-label="Which position to test">
            {(["real", "example"] as const).map((m) => {
              const on = (m === "example") === example;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMode(m)}
                  className={cn("whitespace-nowrap border-r border-line px-2.5 py-1 last:border-r-0", on ? "bg-ink text-paper" : "hover:text-ink")}
                >
                  {m === "real" ? <><span className="sm:hidden">real</span><span className="hidden sm:inline">this account</span></> : <><span className="sm:hidden">example</span><span className="hidden sm:inline">example loan</span></>}
                </button>
              );
            })}
          </div>
        </div>
      }
    >
      {example && (
        <p className="border-b border-line bg-white/[0.02] px-5 py-2.5 text-sm text-muted sm:px-8">
          Example: this account's collateral with ${fmt(p.debt, DEBT)} borrowed{shield > 0n ? ` and a $${fmt(shield, DEBT)} shield` : ""}.{" "}
          {hasDebt ? "Switch to this account to test the real loan." : "This account has no debt, so a real price move would change nothing."}
        </p>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 px-5 pb-6 pt-8 sm:px-8">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <label htmlFor="sim-price" className="text-sm text-muted">
              WETH price
            </label>
            <span className="text-4xl font-semibold tracking-[-0.04em] tabular-nums">{usd(price)}</span>
            <span className={cn("font-mono text-xs", change < 0 ? "text-danger" : change > 0 ? "text-safe" : "text-faint")}>
              {change === 0 ? "live" : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs ${usd(now)}`}
            </span>
          </div>

          <div className="relative mt-6 h-10">
            <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 border border-line" style={{ background: `linear-gradient(90deg, ${gradient.join(", ")})` }} aria-hidden />
            <Tick at={pct(now)} className="bg-ink/70" />
            <Tick at={pct(marks.liq)} className="bg-danger" />
            {marks.protect !== undefined && <Tick at={pct(marks.protect)} className="bg-caution" />}
            <input
              id="sim-price"
              type="range"
              className="sim-range absolute inset-0 w-full"
              min={range.lo}
              max={range.hi}
              step={1}
              value={Math.min(range.hi, Math.max(range.lo, value))}
              onChange={(e) => setCents(Number(e.target.value))}
              aria-valuetext={`${usd(price)}. ${sentence(o, shield > 0n).title}`}
            />
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
            <Legend swatch="bg-ink/70" label={`now ${usd(now)}`} />
            {marks.liq !== undefined && <Legend swatch="bg-danger" label={`liquidation below ${usd(marks.liq)}`} />}
            {marks.protect !== undefined && <Legend swatch="bg-caution" label={`shield steps in below ${usd(marks.protect)}`} />}
          </ul>

          <div className="mt-6 flex flex-wrap border border-line" role="group" aria-label="Price presets">
            {PRESETS.map((d) => {
              const target = toCents(now) * (1 + d / 100);
              const on = cents !== null && Math.abs(value - target) < 1;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCents(Math.round(target))}
                  aria-pressed={on}
                  className={cn("flex-1 border-r border-line px-3 py-2.5 font-mono text-xs transition-colors last:border-r-0", on ? "bg-ink text-paper" : "text-muted hover:bg-white/[0.04] hover:text-ink")}
                >
                  {d}%
                </button>
              );
            })}
          </div>
        </div>

        <Verdict o={o} hasShield={shield > 0n} shieldWouldAct={shieldSupported && shield === 0n && outcomeAt({ ...p, shield: p.debt }, price).protects} />
      </div>

      <dl className="grid grid-cols-2 border-t border-line md:grid-cols-4">
        <Figure label="Collateral value" value={`$${fmt(o.value, DEBT)}`} sub={`${fmt(p.collateral, COLL, 4)} WETH`} />
        <Figure label="Credit limit" value={`$${fmt(o.limit, DEBT)}`} sub={`${Number(p.ltvBps) / 100}% of free collateral`} edge />
        <Figure label="Debt" value={`$${fmt(o.debtAfter, DEBT)}`} sub={o.repaid > 0n ? `was $${fmt(p.debt, DEBT)}` : "unchanged"} edge />
        <Figure
          label="Health"
          value={o.protects ? `${healthText(o.health)} → ${healthText(o.healthAfter)}` : healthText(o.health)}
          sub={o.protects ? "before and after the shield" : "below 1.00 can be liquidated"}
          edge
          tone={o.liquidatable ? "text-danger" : o.protects ? "text-caution" : undefined}
        />
      </dl>
    </Shell>
  );
}

function Shell({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id="simulator" aria-labelledby="sim-title" className="border-t border-line">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-xs text-faint sm:px-8">
        <h3 id="sim-title" className="whitespace-nowrap font-mono text-xs font-normal">
          <span className="text-chain-lasna">/</span> what if WETH moves
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function sentence(o: Outcome, hasShield: boolean) {
  if (o.liquidatable)
    return o.repaid > 0n
      ? { title: "The shield runs out", body: `It repays $${fmt(o.repaid, DEBT)}, but the debt is still past the 80% line. A liquidator can repay up to half and take collateral plus a 5% bonus.`, tone: "danger" as const }
      : { title: "Can be liquidated", body: `${hasShield ? "" : "No shield is set. "}A liquidator can repay up to half the debt on Unichain and take WETH on Base, plus a 5% bonus.`, tone: "danger" as const };
  if (o.protects)
    return { title: "The shield steps in", body: `The ledger repays $${fmt(o.repaid, DEBT)} from your shield in the same callback that sets the new limit. Nobody can liquidate you.`, tone: "caution" as const };
  if (o.zone === "capped") return { title: "Borrowing pauses", body: "Your debt is above the new limit, so you cannot borrow more. You are not at risk of liquidation yet.", tone: "muted" as const };
  return { title: "Nothing to do", body: "Your debt fits within the credit limit at this price.", tone: "safe" as const };
}

function Verdict({ o, hasShield, shieldWouldAct }: { o: Outcome; hasShield: boolean; shieldWouldAct: boolean }) {
  const s = sentence(o, hasShield);
  const color = { danger: "bg-danger", caution: "bg-caution", muted: "bg-faint", safe: "bg-safe" }[s.tone];
  return (
    <div className="relative border-t border-line px-5 py-8 sm:px-8 lg:border-l lg:border-t-0" aria-live="polite">
      <span className={cn("absolute inset-x-0 top-0 h-[2px] transition-colors lg:inset-y-0 lg:left-0 lg:right-auto lg:h-auto lg:w-[2px]", color)} aria-hidden />
      <div className="font-mono text-xs text-faint">the ledger would decide</div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={s.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          <div className="mt-3 text-xl font-semibold tracking-[-0.02em]">{s.title}</div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
        </motion.div>
      </AnimatePresence>
      {shieldWouldAct && <p className="mt-3 text-sm text-caution">With a shield, the ledger would repay part of this loan here instead.</p>}
    </div>
  );
}

function Tick({ at, className }: { at?: number; className: string }) {
  if (at === undefined) return null;
  return <span className={cn("pointer-events-none absolute top-1 bottom-1 w-[2px] -translate-x-1/2", className)} style={{ left: `${at}%` }} aria-hidden />;
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span className={cn("h-3 w-[2px]", swatch)} aria-hidden />
      {label}
    </li>
  );
}

function Figure({ label, value, sub, edge, tone }: { label: string; value: string; sub: string; edge?: boolean; tone?: string }) {
  return (
    <div className={cn("min-w-0 border-line px-5 py-5 sm:px-8 [&:nth-child(n+3)]:border-t md:[&:nth-child(n+3)]:border-t-0", edge && "border-l [&:nth-child(3)]:border-l-0 md:[&:nth-child(3)]:border-l")}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] tabular-nums", tone)}>{value}</dd>
      <dd className="mt-1 truncate font-mono text-[11px] text-faint">{sub}</dd>
    </div>
  );
}
