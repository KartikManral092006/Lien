import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const HEX = "0123456789abcdef";

/** Random hex in place of each character, keeping the "0x" prefix and the ellipsis where they are. */
function noise(s: string, offset = 0) {
  return Array.from(s, (c, i) => (offset + i < 2 || c === "…" ? c : HEX[(Math.random() * 16) | 0])).join("");
}

/**
 * Resolves a hex string from noise into its real value, left to right, the first time it appears or
 * whenever it changes. Same length throughout, so a monospace layout never shifts.
 */
export function useScramble(text: string, ms = 700) {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(() => (reduce ? text : noise(text)));

  useEffect(() => {
    if (reduce) {
      setOut(text);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const settled = Math.floor(p * text.length);
      setOut(text.slice(0, settled) + noise(text.slice(settled), settled));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms, reduce]);

  return out;
}
