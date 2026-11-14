import { CheckCircle2, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLL, DEBT, PRICE, fmt } from "../lib/chain";
import { derive, type Position as Pos } from "../lib/data";
import { HealthGauge } from "./HealthGauge";
import { Hint, chainBg } from "./primitives";
import type { ChainKey } from "../lib/chain";

/** Open layout: the dial, then four figures on a hairline grid. No box around the whole thing. */
export function Position({ p, shieldSupported }: { p?: Pos; shieldSupported: boolean }) {
  const m = derive(p);
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

      <div className="mt-4">
        {m && p ? <HealthGauge health={m.health} protectionHealth={m.protectionHealth} zone={m.zone} showProtection={shieldSupported} /> : <div className="mx-auto h-[150px] w-full max-w-[260px] animate-pulse bg-raised" aria-hidden />}
      </div>

      <dl className="mt-10 grid grid-cols-2 border-t border-line">
        <Cell chain="base" label="Collateral on Base" value={p ? fmt(p.collateral, COLL, 4) : "–"} unit="WETH" sub={m ? `≈ $${fmt(m.value, DEBT)}` : undefined} />
        <Cell chain="unichain" label="Debt on Unichain" value={p ? fmt(p.debt, DEBT) : "–"} unit="USDC" sub={p ? `${fmt(p.available, DEBT)} of ${fmt(p.limit, DEBT)} free` : undefined} edge />
        <Cell
          label="Liquidation price"
          hint="If WETH falls to this price, your account can be liquidated."
          value={m?.liqPrice !== undefined ? `$${fmt(m.liqPrice, PRICE)}` : "None"}
          sub={p ? `WETH is $${fmt(p.price, PRICE)}` : undefined}
        />
        {shieldSupported ? (
          <Cell
            label="Shield"
            hint="USDC you set aside on Unichain. If the price falls, Lien repays your loan from it before you can be liquidated."
            value={
              <span className="inline-flex items-center gap-2">
                {p?.shield && p.shield > 0n ? <ShieldCheck className="size-5 text-safe" aria-hidden /> : <ShieldOff className="size-5 text-faint" aria-hidden />}
                {p?.shield !== undefined ? fmt(p.shield, DEBT) : "–"}
              </span>
            }
            unit="USDC"
            sub={p?.shield && p.shield > 0n && m?.protectPrice !== undefined ? `Steps in below $${fmt(m.protectPrice, PRICE)}` : "Off. Add one to avoid liquidation."}
            edge
          />
        ) : (
          <Cell label="Being withdrawn" value={p ? fmt(p.pending, COLL, 4) : "–"} unit="WETH" sub="Settles in two steps" edge />
        )}
      </dl>
    </div>
  );
}

function Cell({ label, value, unit, sub, chain, hint, edge }: { label: string; value: React.ReactNode; unit?: string; sub?: string; chain?: ChainKey; hint?: string; edge?: boolean }) {
  return (
    <div className={cn("min-w-0 border-b border-line py-6", edge ? "pl-6" : "pr-6 border-r")}>
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
