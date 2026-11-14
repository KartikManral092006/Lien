import { motion } from "motion/react";

const BODIES = [
  { x: 210, y: 270, r: 30, color: "#4C8DFF", label: "Base", role: "Your collateral", above: false },
  { x: 500, y: 200, r: 22, color: "#22D3EE", label: "Reactive", role: "The shared ledger", above: true },
  { x: 790, y: 270, r: 30, color: "#FF4FA3", label: "Unichain", role: "Your credit", above: false },
];

/**
 * A still drawing of the 3D scene: shown instantly, and kept for reduced motion, slow connections and
 * devices without WebGL. It fades out once the live scene has drawn its first frame.
 */
export function ScenePoster({ hidden }: { hidden: boolean }) {
  return (
    <motion.svg
      viewBox="0 0 1000 480"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 size-full"
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.9 }}
      aria-hidden
    >
      <defs>
        {BODIES.map((b) => (
          <radialGradient key={b.label} id={`halo-${b.label}`}>
            <stop offset="0%" stopColor={b.color} stopOpacity="0.45" />
            <stop offset="35%" stopColor={b.color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={b.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {/* the four legs: over the top into the ledger, back underneath */}
      <path d="M210 270 Q355 120 500 200" fill="none" stroke="#4C8DFF" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M500 200 Q645 120 790 270" fill="none" stroke="#FF4FA3" strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M790 270 Q645 390 500 200" fill="none" stroke="#FF4FA3" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 6" />
      <path d="M500 200 Q355 390 210 270" fill="none" stroke="#4C8DFF" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 6" />
      <ellipse cx="500" cy="200" rx="48" ry="14" fill="none" stroke="#22D3EE" strokeOpacity="0.55" />
      {BODIES.map((b) => (
        <g key={b.label}>
          <circle cx={b.x} cy={b.y} r={b.r * 4} fill={`url(#halo-${b.label})`} />
          <circle cx={b.x} cy={b.y} r={b.r} fill={b.color} />
          <circle cx={b.x} cy={b.y} r={b.r * 0.62} fill="#fff" fillOpacity="0.35" />
          <text x={b.x} y={b.above ? b.y - b.r * 3.1 : b.y + b.r * 3} textAnchor="middle" fill={b.color} fontSize="14" fontWeight="600" fontFamily="var(--font-sans)">
            {b.label}
          </text>
          <text x={b.x} y={(b.above ? b.y - b.r * 3.1 : b.y + b.r * 3) + 18} textAnchor="middle" fill="var(--muted)" fontSize="12" fontFamily="var(--font-sans)">
            {b.role}
          </text>
        </g>
      ))}
    </motion.svg>
  );
}
