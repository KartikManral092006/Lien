import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { Abi } from "viem";
import { cn } from "@/lib/utils";
import { tokenAbi, type Deployments } from "../lib/chain";
import type { Position } from "../lib/data";
import type { useTx } from "../lib/tx";
import { openAction } from "../lib/ui";

const KEY = "lien:checklist-hidden";
const readHidden = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

type Step = { title: string; body: string; done: boolean; cta: string; run: () => void };

/**
 * First-run path for someone arriving cold: each step ticks itself off from on-chain state, and the
 * current one carries the button that does it. Disappears once everything is done, or when hidden.
 */
export function Checklist({ d, p, tx, shieldSupported, connected }: { d: Deployments; p?: Position; tx: ReturnType<typeof useTx>; shieldSupported: boolean; connected: boolean }) {
  const { openConnectModal } = useConnectModal();
  const [hidden, setHidden] = useState(readHidden);

  const steps: Step[] = [
    { title: "Connect a wallet", body: "Any EVM wallet. Testnets only.", done: connected, cta: "Connect wallet", run: () => openConnectModal?.() },
    {
      title: "Get test WETH",
      body: "Free from the test token on Base Sepolia.",
      done: !!p && (p.weth > 0n || p.collateral > 0n),
      cta: "Get 1 test WETH",
      run: () => tx.run("Get test WETH", "base", [{ address: d.base.weth, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, 10n ** 18n] }], { done: "Received 1 test WETH" }),
    },
    { title: "Deposit on Base", body: "Your credit limit appears on Unichain seconds later.", done: !!p && p.collateral > 0n, cta: "Deposit WETH", run: () => openAction("deposit") },
    { title: "Borrow on Unichain", body: "Against the WETH that stays on Base.", done: !!p && p.debt > 0n, cta: "Borrow USDC", run: () => openAction("borrow") },
    ...(shieldSupported
      ? [{ title: "Add a shield", body: "USDC that repays your loan before liquidation.", done: !!p && (p.shield ?? 0n) > 0n, cta: "Add to shield", run: () => openAction("shield") }]
      : []),
  ];
  const current = steps.findIndex((s) => !s.done);
  if (hidden || current === -1) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="checklist-title" className="border-b border-line">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-xs text-faint sm:px-8">
        <h3 id="checklist-title" className="font-mono text-xs font-normal">
          <span className="text-chain-lasna">/</span> get started, {doneCount} of {steps.length} done
        </h3>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              /* storage may be blocked; hiding still lasts for this visit */
            }
          }}
          className="inline-flex items-center gap-1.5 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden /> hide
        </button>
      </div>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ["--n" as string]: steps.length }}>
        {steps.map((s, i) => {
          const now = i === current;
          return (
            <li
              key={s.title}
              aria-current={now ? "step" : undefined}
              className={cn(
                "relative flex min-w-0 flex-col border-b border-line px-5 py-4 last:border-b-0 sm:py-5 sm:px-6 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0",
              )}
            >
              {now && <motion.span layoutId="checklist-bar" className="absolute inset-x-0 top-0 h-[2px] bg-chain-lasna" aria-hidden />}
              <div className="flex items-center gap-3">
                <span className={cn("grid size-6 place-items-center border font-mono text-[11px]", s.done ? "border-safe bg-safe text-paper" : now ? "border-chain-lasna text-chain-lasna" : "border-line-strong text-faint")}>
                  {s.done ? <Check className="size-3.5" strokeWidth={3} aria-label="done" /> : i + 1}
                </span>
                <span className={cn("font-medium", s.done ? "text-muted line-through decoration-line-strong" : !now && "text-muted")}>{s.title}</span>
              </div>
              <p className={cn("mt-2 text-sm", now ? "text-muted" : "hidden text-faint sm:block")}>{s.body}</p>
              {now && (
                <button
                  type="button"
                  onClick={s.run}
                  disabled={!!tx.busy}
                  className="mt-4 h-10 self-start bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-white disabled:opacity-40"
                >
                  {tx.busy && i === 1 ? "Waiting for wallet…" : s.cta}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
