import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/**
 * A soft light that follows the pointer across the page frame and brings up a faint hairline grid
 * around it, in keeping with the boxy layout. Pointer position is written to CSS variables once per
 * frame, so React never re-renders. Off for touch screens and for people who ask for less motion.
 */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || reduce || matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      raf = 0;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
      el.style.opacity = "1";
    };
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      el.style.opacity = "0";
    };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [reduce]);

  return (
    <div ref={ref} aria-hidden className="spotlight pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-500">
      <div className="spotlight-glow absolute inset-0" />
      <div className="spotlight-grid absolute inset-0" />
    </div>
  );
}
