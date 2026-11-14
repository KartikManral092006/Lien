import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spotlight } from "./fx/Spotlight";

/**
 * The boxy grid. The page lives inside one frame with vertical rails; every section is a band whose top
 * rule draws itself in as it scrolls into view, with "+" crosshairs where rules meet the rails.
 */

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto max-w-[1280px] border-x border-line">
      <Spotlight />
      {children}
    </div>
  );
}

function Cross({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 11 11" className={cn("pointer-events-none absolute z-10 size-[11px] text-line-strong", className)} aria-hidden>
      <path d="M5.5 0v11M0 5.5h11" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function Band({ id, children, className, label, aside }: { id?: string; children: ReactNode; className?: string; label?: string; aside?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <section id={id} className={cn("relative", className)} aria-label={label}>
      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px origin-left bg-line-strong"
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: "-10% 0px" }}
        transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
      />
      <Cross className="-left-[6px] -top-[6px]" />
      <Cross className="-right-[6px] -top-[6px]" />
      {label && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-xs text-faint sm:px-8">
          <span>
            <span className="text-chain-lasna">/</span> {label}
          </span>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Heading revealed word by word as it enters the viewport. */
export function RevealHeading({ text, className, as: Tag = "h2", id }: { text: string; className?: string; as?: "h1" | "h2" | "h3"; id?: string }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  const MotionTag = motion[Tag];
  return (
    <MotionTag id={id} className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-15% 0px" }} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom" aria-hidden>
          <motion.span
            className="inline-block"
            variants={{ hidden: reduce ? { y: 0 } : { y: "105%" }, show: { y: 0 } }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </MotionTag>
  );
}

/** Fade-and-rise for blocks that should arrive with their section, once. */
export function Rise({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
