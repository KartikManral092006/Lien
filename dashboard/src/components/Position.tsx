import { CheckCircle2, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { COLL, DEBT, PRICE, fmt, toNum } from "../lib/chain";
import { derive, type Position as Pos } from "../lib/data";
import { Num } from "./fx/Num";
import { HealthGauge } from "./HealthGauge";
import { Hint, chainBg } from "./primitives";
import type { ChainKey } from "../lib/chain";

type Rescue = { id: number; amount: bigint };

/**
 * Spots a shield rescue between two reads of the same account: the shield and the debt fall by the same
 * amount at once, which only the protection callback does (a manual repay leaves the shield alone, and
 * removing shield funds leaves the debt alone).
 */
function useRescue(p: Pos | undefined, account: string | undefined) {
  const last = useRef<{ account?: string; shield: bigint; debt: bigint }>();
  const [rescue, setRescue] = useState<Rescue | null>(null);

  useEffect(() => {
    if (!p || p.shield === undefined) return;
    const prev = last.current;
    last.current = { account, shield: p.shield, debt: p.debt };
    if (!prev || prev.account !== account) return;
    const fromShield = prev.shield - p.shield;
    const fromDebt = prev.debt - p.debt;
    // Allow 1% for interest that accrued between the two reads.
    if (fromShield > 0n && fromDebt > 0n && fromDebt * 100n >= fromShield * 99n && fromDebt * 100n <= fromShield * 101n) {
      setRescue({ id: Date.now(), amount: fromShield });
    }
  }, [p, account]);

  // Development-only visual check (`?preview-rescue`), stripped from production builds by the DEV guard.
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("preview-rescue")) return;
    const t = setTimeout(() => setRescue({ id: Date.now(), amount: 53_000_000n }), 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!rescue) return;
    const t = setTimeout(() => setRescue(null), 8000);
    return () => clearTimeout(t);
  }, [rescue]);

  return rescue;
}

/** Open layout: the dial, then four figures on a hairline grid. No box around the whole thing. */
export function Position({ p, shieldSupported, account }: { p?: Pos; shieldSupported: boolean; account?: string }) {
  const m = derive(p);
  const rescue = useRescue(shieldSupported ? p : undefined, account);
  const grid = useRef<HTMLDListElement>(null);
  const debtCell = useRef<HTMLDivElement>(null);
  const shieldCell = useRef<HTMLDivElement>(null);

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">Health</span>
        {m && (
          <span className={cn("inline-flex items-center gap-1.5 text-sm", m.inSync ? "text-muted" : "text-chain-lasna")} role="status">
            {m.inSync ? <CheckCircle2 className="size-4 text-safe" aria-hidden /> : <Loader2 className="size-4 animate-spin" aria-hidden />}
            {m.inSync ? <Hint text="The ClearingHouse on Reactive holds the same collateral, debt and price as Base and Unichain.">Ledger in sync</Hint> : "Settling across chains"}
          </span>
        )}
      </div>

      <AnimatePresence>
        {rescue && (
          <motion.div
            key={rescue.id}
            role="status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="relative mt-4 flex items-center gap-3 overflow-hidden border border-safe/40 bg-safe/[0.07] px-4 py-3 text-sm">
              <motion.span
                aria-hidden
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-safe/20 to-transparent"
                initial={{ left: "-35%" }}
                animate={{ left: "110%" }}
                transition={{ duration: 1.4, ease: "easeInOut", delay: 0.2 }}
              />
              <ShieldCheck className="size-5 shrink-0 text-safe" aria-hidden />
              <span className="relative">
                <span className="font-semibold text-safe">Shield stepped in.</span> Repaid {fmt(rescue.amount, DEBT)} USDC before this account could be liquidated.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mt-4">
        {m && p ? <HealthGauge health={m.health} protectionHealth={m.protectionHealth} zone={m.zone} showProtection={shieldSupported} /> : <div className="mx-auto h-[150px] w-full max-w-[260px] animate-pulse bg-raised" aria-hidden />}
        {rescue && (
          <motion.div
            key={rescue.id}
            aria-hidden
            className="pointer-events-none absolute inset-0 mx-auto max-w-[300px]"
            style={{ background: "radial-gradient(closest-side, rgb(52 211 153 / 0.35), transparent)" }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: [0, 1, 0], scale: [0.7, 1.15, 1.3] }}
            transition={{ duration: 1.6, ease: "easeOut", delay: 1.1 }}
          />
        )}
      </div>

      <dl ref={grid} className="relative mt-10 grid grid-cols-2 border-t border-line">
        <Cell
          chain="base"
          label="Collateral on Base"
          value={p ? <Num value={toNum(p.collateral, COLL)} digits={4} good="up" /> : "–"}
          unit="WETH"
          sub={m ? `≈ $${fmt(m.value, DEBT)}` : undefined}
        />
        <Cell
          cellRef={debtCell}
          chain="unichain"
          label="Debt on Unichain"
          value={p ? <Num value={toNum(p.debt, DEBT)} good="down" /> : "–"}
          unit="USDC"
          sub={p ? `${fmt(p.available, DEBT)} of ${fmt(p.limit, DEBT)} free` : undefined}
          edge
          flash={rescue?.id}
        />
        <Cell
          label="Liquidation price"
          hint="If WETH falls to this price, your account can be liquidated."
          value={m?.liqPrice !== undefined ? <Num value={toNum(m.liqPrice, PRICE)} prefix="$" good="down" /> : "None"}
          sub={p ? `WETH is $${fmt(p.price, PRICE)}` : undefined}
        />
        {shieldSupported ? (
          <Cell
            cellRef={shieldCell}
            label="Shield"
            hint="USDC you set aside on Unichain. If the price falls, Lien repays your loan from it before you can be liquidated."
            value={
              <span className="inline-flex items-center gap-2">
                {p?.shield && p.shield > 0n ? <ShieldCheck className="size-5 text-safe" aria-hidden /> : <ShieldOff className="size-5 text-faint" aria-hidden />}
                {p?.shield !== undefined ? <Num value={toNum(p.shield, DEBT)} /> : "–"}
              </span>
            }
            unit="USDC"
            sub={p?.shield && p.shield > 0n && m?.protectPrice !== undefined ? `Steps in below $${fmt(m.protectPrice, PRICE)}` : "Off. Add one to avoid liquidation."}
            edge
            flash={rescue?.id}
          />
        ) : (
          <Cell label="Being withdrawn" value={p ? fmt(p.pending, COLL, 4) : "–"} unit="WETH" sub="Settles in two steps" edge />
        )}
        {rescue && <FlyingChip key={rescue.id} amount={rescue.amount} grid={grid} from={shieldCell} to={debtCell} />}
      </dl>
    </div>
  );
}

/** The repaid amount travelling from the shield to the debt it pays down, on a short arc. */
function FlyingChip({ amount, grid, from, to }: { amount: bigint; grid: RefObject<HTMLElement>; from: RefObject<HTMLElement>; to: RefObject<HTMLElement> }) {
  const [path, setPath] = useState<{ x: number[]; y: number[] } | null>(null);
  useLayoutEffect(() => {
    const g = grid.current?.getBoundingClientRect();
    const a = from.current?.getBoundingClientRect();
    const b = to.current?.getBoundingClientRect();
    if (!g || !a || !b) return;
    const ax = a.left - g.left + 24;
    const ay = a.top - g.top + a.height / 2;
    const bx = b.left - g.left + 24;
    const by = b.top - g.top + b.height / 2;
    // Bow out to the left of the straight line so the move reads as a transfer, not a slide.
    setPath({ x: [ax, Math.min(ax, bx) - 70, bx], y: [ay, (ay + by) / 2, by] });
  }, [grid, from, to]);
  if (!path) return null;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-20 whitespace-nowrap border border-safe bg-paper px-2.5 py-1 font-mono text-xs font-semibold text-safe"
      style={{ boxShadow: "0 0 24px rgb(52 211 153 / 0.45)" }}
      initial={{ x: path.x[0], y: path.y[0], opacity: 0, scale: 0.6 }}
      animate={{ x: path.x, y: path.y, opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 0.85] }}
      transition={{ duration: 1.5, ease: [0.65, 0, 0.35, 1], times: [0, 0.5, 1], opacity: { times: [0, 0.15, 0.8, 1], duration: 1.5 }, scale: { times: [0, 0.3, 0.8, 1], duration: 1.5 } }}
    >
      −{fmt(amount, DEBT)} USDC
    </motion.div>
  );
}

function Cell({
  label,
  value,
  unit,
  sub,
  chain,
  hint,
  edge,
  flash,
  cellRef,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: string;
  chain?: ChainKey;
  hint?: string;
  edge?: boolean;
  flash?: number;
  cellRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={cellRef} className={cn("relative min-w-0 border-b border-line py-6", edge ? "pl-6" : "pr-6 border-r")}>
      {flash && (
        <motion.span
          key={flash}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-safe/10"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.8, delay: 1.2 }}
        />
      )}
      <dt className="flex items-center gap-2 text-sm text-muted">
        {chain && <span className={cn("size-1.5", chainBg[chain])} aria-hidden />}
        {hint ? <Hint text={hint}>{label}</Hint> : label}
      </dt>
      <dd className="mt-2 truncate text-[1.7rem] font-semibold leading-none tracking-[-0.03em]">
        {value}
        {unit && <span className="ml-1.5 text-sm font-normal tracking-normal text-muted">{unit}</span>}
      </dd>
      {sub && <dd className="mt-2 truncate text-sm text-faint">{sub}</dd>}
    </div>
  );
}
