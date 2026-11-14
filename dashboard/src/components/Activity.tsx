import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { CHAIN_META } from "../lib/chain";
import type { Activity as Item } from "../lib/data";
import { RevealHeading } from "./grid";
import { TxLink, chainBg, cx } from "./primitives";

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function Activity({ items, error, who }: { items?: Item[]; error?: boolean; who: Address }) {
  const [mine, setMine] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const list = (items ?? []).filter((i) => !mine || (i.user && i.user.toLowerCase() === who.toLowerCase()));

  return (
    <section className="min-w-0" aria-labelledby="act-h">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-12 sm:px-8 sm:py-16">
        <RevealHeading id="act-h" text="Live on all three chains." className="text-[clamp(2rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]" />
        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-muted">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-[var(--lasna)]" />
          only this account
        </label>
      </header>
      {error && <p className="border-b border-line px-5 py-3 text-sm text-caution sm:px-8">A network is slow to answer. Showing what loaded; it retries every few seconds.</p>}
      <ul className="max-h-[440px] overflow-y-auto" data-lenis-prevent>
        <AnimatePresence initial={false}>
          {list.map((it) => (
            <motion.li
              key={it.key}
              layout
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 40 }}
              className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-4 border-b border-line px-5 py-3.5 text-sm transition-colors hover:bg-white/[0.02] sm:grid-cols-[0.5rem_9rem_1fr_4.5rem_auto] sm:px-8"
            >
              <span className={cx("size-2", chainBg[it.chain])} aria-hidden />
              <span className="hidden font-mono text-xs text-muted sm:block">{CHAIN_META[it.chain].name}</span>
              <span className="min-w-0 truncate">{it.detail}</span>
              <span className="hidden text-right font-mono text-xs text-faint sm:block">{ago(it.ts, now)}</span>
              <TxLink chain={it.chain} hash={it.tx} />
            </motion.li>
          ))}
        </AnimatePresence>
        {items && list.length === 0 && (
          <li className="py-10 text-center text-sm text-muted">{mine ? "This account has no activity in the last few minutes." : "Quiet for the last few minutes. Deposit to start a loop."}</li>
        )}
        {!items && !error && (
          <li className="space-y-2 px-3 py-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse bg-raised" />
            ))}
          </li>
        )}
      </ul>
    </section>
  );
}
