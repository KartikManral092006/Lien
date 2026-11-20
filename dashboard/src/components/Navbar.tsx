import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Play, Search } from "lucide-react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CHAIN_META, type ChainKey } from "../lib/chain";
import { useHeads } from "../lib/data";
import { watchRescue } from "../lib/rescueRun";
import { setPaletteOpen } from "../lib/ui";
import { Logo } from "./Logo";
import { Hint, chainBg } from "./primitives";

const LINKS = [
  ["Position", "#position"],
  ["How it works", "#how"],
  ["Settlement", "#settlement"],
  ["Activity", "#activity"],
] as const;

/** A row of bordered cells: logo, links, network status, wallet. */
export function Navbar() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 8));

  return (
    <header className={cn("fixed inset-x-0 top-0 z-40 border-b border-line transition-colors duration-300", solid ? "bg-paper/80 backdrop-blur-xl" : "bg-paper/40 backdrop-blur-sm")}>
      <nav className="mx-auto flex h-14 max-w-[1280px] items-stretch border-x border-line" aria-label="Main">
        <a href="#top" className="flex items-center border-r border-line px-5 sm:px-6" aria-label="Lien, back to top">
          <Logo />
        </a>
        <ul className="hidden flex-1 items-stretch md:flex">
          {LINKS.map(([label, href]) => (
            <li key={href} className="flex border-r border-line">
              <a href={href} className="flex items-center px-5 text-sm text-muted transition-colors hover:bg-white/[0.03] hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-stretch">
          <CommandButton />
          <Networks />
          <WatchRescue />
          <Wallet />
        </div>
      </nav>
    </header>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function CommandButton() {
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      className="flex items-center gap-3 border-l border-line px-4 text-sm text-muted transition-colors hover:bg-white/[0.03] hover:text-ink sm:px-5"
      aria-label="Open command menu"
      aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
    >
      <Search className="size-4" aria-hidden />
      <kbd className="hidden border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint lg:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

function Networks() {
  const { data } = useHeads();
  const order: ChainKey[] = ["base", "lasna", "unichain"];
  const live = order.filter((c) => data?.[c] && Date.now() - data[c]!.ts < 30_000).length;
  const text = order.map((c) => `${CHAIN_META[c].name}: ${data?.[c] ? `block ${data[c]!.number.toLocaleString()}` : "waiting"}`).join("\n");
  return (
    <div className="hidden items-center border-l border-line px-5 sm:flex">
      <Hint text={text}>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-muted no-underline">
          <span className="flex gap-1">
            {order.map((c) => (
              <span key={c} className={cn("size-1.5", data?.[c] ? chainBg[c] : "bg-line-strong")} />
            ))}
          </span>
          {live === 3 ? "3/3 live" : `${live}/3 live`}
        </span>
      </Hint>
    </div>
  );
}

/** The no-wallet way in: jumps to the recorded rescue and plays it from the start. Shown on every screen size. */
function WatchRescue() {
  return (
    <a
      href="#rescue"
      onClick={watchRescue}
      className="group relative flex items-center gap-2 overflow-hidden border-l border-line bg-chain-lasna/10 px-3 text-sm font-medium text-ink transition-colors hover:bg-chain-lasna/20 sm:px-5"
    >
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-chain-base via-chain-lasna to-chain-uni" />
      <Play className="size-3.5 fill-chain-lasna text-chain-lasna transition-transform group-hover:scale-110" aria-hidden />
      <span className="sm:hidden">Rescue</span>
      <span className="hidden sm:inline">Watch a rescue</span>
    </a>
  );
}

function Wallet() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const cls = "flex items-center gap-2 border-l border-line px-5 text-sm font-medium transition-colors";
        if (!mounted) return <div className="w-36 border-l border-line" aria-hidden />;
        if (!account)
          return (
            <button onClick={openConnectModal} className={cn(cls, "bg-ink px-3 text-paper hover:bg-white sm:px-5")}>
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect wallet</span>
            </button>
          );
        if (chain?.unsupported)
          return (
            <button onClick={openChainModal} className={cn(cls, "bg-danger/15 text-danger")}>
              Wrong network
            </button>
          );
        return (
          <button onClick={openAccountModal} className={cn(cls, "hover:bg-white/[0.04]")}>
            <span className="size-1.5 bg-safe" aria-hidden />
            <span className="font-mono text-xs">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
