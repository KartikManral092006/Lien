import { motion, useReducedMotion } from "motion/react";

const MAX = 2.5; // health shown on the dial runs from 0 to 2.5; anything above pins to the end

/** Semicircular dial. The two ticks mark where protection starts and where liquidation becomes possible. */
export function HealthGauge({
  health,
  protectionHealth,
  zone,
  showProtection,
}: {
  health: number;
  protectionHealth: number;
  zone: "safe" | "protect" | "liquidatable";
  showProtection: boolean;
}) {
  const reduce = useReducedMotion();
  const frac = Math.max(0, Math.min(1, (Number.isFinite(health) ? health : MAX) / MAX));
  const color = zone === "safe" ? "var(--safe)" : zone === "protect" ? "var(--caution)" : "var(--danger)";
  const r = 80;
  const cx = 100;
  const cy = 96;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const tick = (h: number) => {
    const a = Math.PI * (1 - Math.min(1, h / MAX));
    const x1 = cx + (r - 14) * Math.cos(a);
    const y1 = cy - (r - 14) * Math.sin(a);
    const x2 = cx + (r + 8) * Math.cos(a);
    const y2 = cy - (r + 8) * Math.sin(a);
    return { x1, y1, x2, y2 };
  };
  const liq = tick(1);
  const prot = tick(protectionHealth);
  const label = zone === "safe" ? "Safe" : zone === "protect" ? (showProtection ? "Protection zone" : "Close to liquidation") : "Can be liquidated";

  return (
    <figure className="relative mx-auto w-full max-w-[260px]" aria-label={`Health ${Number.isFinite(health) ? health.toFixed(2) : "no debt"}, ${label}`}>
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-hidden>
        <path d={arc} fill="none" stroke="var(--line)" strokeWidth="14" strokeLinecap="butt" />
        <motion.path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="butt"
          initial={false}
          animate={{ pathLength: frac }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 70, damping: 18 }}
        />
        <line {...liq} stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="butt" />
        {showProtection && <line {...prot} stroke="var(--caution)" strokeWidth="2.5" strokeLinecap="butt" />}
      </svg>
      <figcaption className="absolute inset-x-0 bottom-0 text-center">
        <div className={Number.isFinite(health) ? "text-4xl font-bold leading-none tracking-tight" : "text-2xl font-bold leading-none tracking-tight"}>
          {Number.isFinite(health) ? health.toFixed(2) : "No debt"}
        </div>
        <div className="mt-1.5 text-sm font-medium" style={{ color }}>
          {label}
        </div>
      </figcaption>
    </figure>
  );
}
