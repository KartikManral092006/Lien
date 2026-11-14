import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Two rings, one per chain: Base (blue) and Unichain (pink). Where they overlap is the shared ledger on
 * Reactive (cyan): the only place both positions meet.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 28" className={cn("h-7 w-10", className)} aria-hidden>
      <defs>
        <clipPath id={`l-${id}`}>
          <circle cx="14" cy="14" r="10" />
        </clipPath>
      </defs>
      <circle cx="26" cy="14" r="10" fill="var(--lasna)" clipPath={`url(#l-${id})`} opacity="0.95" />
      <circle cx="14" cy="14" r="10" fill="none" stroke="var(--base)" strokeWidth="3" />
      <circle cx="26" cy="14" r="10" fill="none" stroke="var(--unichain)" strokeWidth="3" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[1.35rem] font-semibold tracking-[-0.03em]">Lien</span>
    </span>
  );
}
