import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { CornerDownLeft, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Abi } from "viem";
import { cn } from "@/lib/utils";
import { explorer, tokenAbi, type Deployments } from "../lib/chain";
import type { useTx } from "../lib/tx";
import { openAction, scrollToId, setPaletteOpen, usePaletteOpen } from "../lib/ui";

type Command = { id: string; group: string; label: string; hint?: string; keywords?: string; run: () => void };
type Lenis = { stop: () => void; start: () => void };
const lenis = () => (window as unknown as { __lenis?: Lenis }).__lenis;

/** ⌘K / Ctrl+K: jump to any section, open any action, get test tokens, or open a contract on its explorer. */
export function CommandPalette({ d, tx, shieldSupported, connected }: { d: Deployments; tx: ReturnType<typeof useTx>; shieldSupported: boolean; connected: boolean }) {
  const open = usePaletteOpen();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const need = (f: () => void) => () => (connected ? f() : openConnectModal?.());
    const go = (id: string, label: string, keywords?: string): Command => ({ id: `go-${id}`, group: "go to", label, keywords, run: () => scrollToId(id) });
    const ext = (url: string) => () => window.open(url, "_blank", "noopener");
    return [
      go("position", "Position", "health collateral debt"),
      go("simulator", "What if WETH moves", "price simulator slider liquidation"),
      go("how", "How it works", "explainer steps"),
      go("settlement", "Settlement, live", "loop timing legs"),
      go("activity", "Activity", "events feed performance"),
      go("contracts", "Contracts", "addresses explorer footer"),
      { id: "a-dep", group: "actions", label: "Deposit WETH on Base", keywords: "collateral", run: () => openAction("deposit") },
      { id: "a-bor", group: "actions", label: "Borrow USDC on Unichain", keywords: "loan credit", run: () => openAction("borrow") },
      { id: "a-rep", group: "actions", label: "Repay USDC", keywords: "debt", run: () => openAction("repay") },
      { id: "a-wd", group: "actions", label: "Withdraw WETH", keywords: "two phase", run: () => openAction("withdraw") },
      ...(shieldSupported ? [{ id: "a-sh", group: "actions", label: "Add to shield", keywords: "protection", run: () => openAction("shield") }] : []),
      {
        id: "t-weth",
        group: "test tokens",
        label: "Get 1 test WETH",
        hint: "Base Sepolia",
        keywords: "faucet mint",
        run: need(() => tx.run("Get test WETH", "base", [{ address: d.base.weth, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, 10n ** 18n] }], { done: "Received 1 test WETH" })),
      },
      {
        id: "t-usdc",
        group: "test tokens",
        label: "Get 1,000 test USDC",
        hint: "Unichain Sepolia",
        keywords: "faucet mint",
        run: need(() => tx.run("Get test USDC", "unichain", [{ address: d.unichain.usdc, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, 1_000n * 10n ** 6n] }], { done: "Received 1,000 test USDC" })),
      },
      connected
        ? { id: "w", group: "wallet", label: "Wallet and account", keywords: "disconnect address", run: () => openAccountModal?.() }
        : { id: "w", group: "wallet", label: "Connect wallet", keywords: "login sign in", run: () => openConnectModal?.() },
      { id: "x-ch", group: "explorers", label: "ClearingHouse", hint: "Reactive Lasna", keywords: "ledger rsc", run: ext(explorer.address.lasna + d.lasna.clearingHouse) },
      { id: "x-v", group: "explorers", label: "CollateralVault", hint: "Base Sepolia", keywords: "vault", run: ext(explorer.address.base + d.base.vault) },
      { id: "x-m", group: "explorers", label: "CreditMarket", hint: "Unichain Sepolia", keywords: "market", run: ext(explorer.address.unichain + d.unichain.market) },
    ];
  }, [connected, d, shieldSupported, tx, openAccountModal, openConnectModal]);

  return <AnimatePresence>{open && <Dialog commands={commands} onClose={() => setPaletteOpen(false)} />}</AnimatePresence>;
}

function Dialog({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const hay = `${c.group} ${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [commands, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    lenis()?.stop();
    input.current?.focus();
    return () => {
      lenis()?.start();
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    // Resume smooth scrolling now: the dialog's exit animation would otherwise delay it past the scroll.
    lenis()?.start();
    onClose();
    window.setTimeout(c.run, 60);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus stays in the search field; arrows move through results
    }
  };

  let lastGroup = "";
  return (
    <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-paper/70 px-4 pt-[12vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[600px] border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-faint" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a section, start an action, get test tokens…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={results[active] ? `${uid}-${results[active].id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint">esc</kbd>
        </div>
        <ul ref={list} id={`${uid}-list`} role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto" data-lenis-prevent>
          {results.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No command matches “{q}”.</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="border-b border-line bg-paper/40 px-4 py-1.5 font-mono text-[11px] text-faint">{c.group}</div>}
                <div
                  id={`${uid}-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cn("relative flex cursor-pointer items-center justify-between gap-4 border-b border-line px-4 py-3 text-sm", i === active ? "bg-white/[0.05] text-ink" : "text-muted")}
                >
                  {i === active && <span className="absolute inset-y-0 left-0 w-[2px] bg-chain-lasna" aria-hidden />}
                  <span className="truncate">{c.label}</span>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-faint">
                    {c.hint}
                    {i === active && <CornerDownLeft className="size-3.5" aria-hidden />}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-4 px-4 py-2 font-mono text-[11px] text-faint">
          <span>↑↓ move</span>
          <span>enter run</span>
          <span>esc close</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
