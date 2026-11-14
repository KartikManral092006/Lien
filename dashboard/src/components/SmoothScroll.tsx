import "lenis/dist/lenis.css";
import { ReactLenis, type LenisRef } from "lenis/react";
import { cancelFrame, frame, motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Lenis smooth scrolling driven from Motion's frame loop (Motion's documented pairing), so scroll-linked
 * animations read the position Lenis just wrote in the same frame.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const lenisRef = useRef<LenisRef>(null);
  // People who ask for less motion get native scrolling; Lenis still handles anchor links.
  const reduce = !!useReducedMotion();
  useEffect(() => {
    const update = (data: { timestamp: number }) => {
      const lenis = lenisRef.current?.lenis;
      if (!lenis) return;
      (window as unknown as { __lenis?: unknown }).__lenis = lenis;
      lenis.raf(data.timestamp);
    };
    frame.update(update, true);
    return () => cancelFrame(update);
  }, []);
  return (
    <ReactLenis root ref={lenisRef} options={{ autoRaf: false, lerp: 0.1, smoothWheel: !reduce, anchors: { offset: -64 } }}>
      {children}
    </ReactLenis>
  );
}

/** Thin spectrum bar across the top that fills with page progress. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-gradient-to-r from-chain-base via-chain-lasna to-chain-uni"
      style={{ scaleX }}
    />
  );
}
