import * as RTooltip from "@radix-ui/react-tooltip";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { explorer, short, type ChainKey } from "../lib/chain";
import { useScramble } from "./fx/useScramble";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export const chainText: Record<ChainKey, string> = { base: "text-chain-base", lasna: "text-chain-lasna", unichain: "text-chain-uni" };
export const chainBg: Record<ChainKey, string> = { base: "bg-chain-base", lasna: "bg-chain-lasna", unichain: "bg-chain-uni" };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "quiet" | "danger" | "ghost";
  busy?: boolean;
  /** The action this button sent just confirmed: show a check for a moment. */
  done?: boolean;
  size?: "md" | "sm";
};

/**
 * Three states, one button: idle, busy (a light sweeps across while the wallet and chain work), and done
 * (a check draws itself). Labels slide between states instead of swapping in place.
 */
export function Button({ tone = "primary", busy, done, size = "md", className, children, disabled, ...rest }: BtnProps) {
  const state = done ? "done" : busy ? "busy" : "idle";
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "relative inline-flex items-center justify-center gap-2 overflow-hidden font-medium transition-[background,color,box-shadow,transform,border-color] duration-300 active:scale-[0.98]",
        busy ? "cursor-wait" : "disabled:cursor-not-allowed disabled:opacity-40",
        size === "md" ? "h-11 px-5 text-sm" : "h-8 px-3 text-xs",
        done
          ? "border border-safe/50 bg-safe/15 text-safe"
          : [
              tone === "primary" && "bg-ink text-paper hover:bg-white hover:shadow-[0_0_0_4px_rgb(238_242_248/0.08)]",
              tone === "quiet" && "border border-line-strong bg-white/[0.03] text-ink backdrop-blur hover:border-white/30 hover:bg-white/[0.07]",
              tone === "danger" && "border border-danger/30 bg-danger/10 text-danger hover:border-danger/60 hover:bg-danger/15",
              tone === "ghost" && "text-muted hover:bg-white/[0.05] hover:text-ink",
            ]
              .filter(Boolean)
              .join(" "),
        className,
      )}
    >
      {busy && (
        <span aria-hidden className="btn-sweep pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-current to-transparent opacity-20" />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          className="relative inline-flex items-center gap-2"
          initial={{ y: 14, opacity: 0, filter: "blur(4px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: -14, opacity: 0, filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
        >
          {done ? (
            <>
              <DrawnCheck />
              Confirmed
            </>
          ) : (
            <>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {children}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function DrawnCheck() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <motion.path
        d="M3 8.5l3.2 3.2L13 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: [0.65, 0, 0.35, 1], delay: 0.1 }}
      />
    </svg>
  );
}

export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <RTooltip.Root delayDuration={150}>
      <RTooltip.Trigger asChild>
        <span tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4">
          {children}
        </span>
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="z-50 max-w-64 bg-ink px-3 py-2 text-xs leading-relaxed text-paper shadow-lg">
          {text}
          <RTooltip.Arrow className="fill-ink" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/** Explorer link whose hash resolves out of noise when it first appears. */
export function TxLink({ chain, hash, className }: { chain: ChainKey; hash: string; className?: string }) {
  const label = short(hash);
  const shown = useScramble(label);
  return (
    <a
      href={explorer.tx[chain] + hash}
      target="_blank"
      rel="noreferrer"
      aria-label={`Transaction ${label}`}
      title={hash}
      className={cx("font-mono text-xs text-muted underline-offset-4 hover:text-ink hover:underline", className)}
    >
      {shown}
    </a>
  );
}

export function AmountField({
  id,
  label,
  value,
  onChange,
  unit,
  balance,
  balanceLabel = "Available",
  onMax,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  balance?: string;
  balanceLabel?: string;
  onMax?: () => void;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {balance !== undefined && (
          <span className="text-muted">
            {balanceLabel} <span className="text-ink">{balance}</span>
          </span>
        )}
      </div>
      <div
        className={cx(
          "mt-2 flex h-14 items-center border bg-raised px-4 focus-within:border-chain-base",
          error ? "border-danger" : "border-line",
        )}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-faint"
        />
        {onMax && (
          <button type="button" onClick={onMax} className="mr-3 px-2 py-1 text-xs font-semibold text-chain-base hover:bg-chain-base/10">
            Max
          </button>
        )}
        <span className="text-sm font-semibold text-muted">{unit}</span>
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Delta({ label, from, to, tone }: { label: string; from: string; to?: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span>
        {from}
        {to !== undefined && to !== from && (
          <>
            <span className="mx-1.5 text-faint">to</span>
            <span className={cx("font-semibold", tone === "good" && "text-safe", tone === "bad" && "text-danger")}>{to}</span>
          </>
        )}
      </span>
    </div>
  );
}
