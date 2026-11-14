import { useSyncExternalStore } from "react";

/** Small shared UI state, so the checklist and command palette can drive the action panel. */
export type ActionTab = "deposit" | "borrow" | "repay" | "withdraw" | "shield";

const FIELD: Record<ActionTab, string> = { deposit: "dep", borrow: "bor", repay: "rep", withdraw: "wd", shield: "sh" };

let tab: ActionTab = "deposit";
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useActionTab() {
  return [useSyncExternalStore(subscribe, () => tab), setActionTab] as const;
}

export function setActionTab(t: ActionTab) {
  tab = t;
  listeners.forEach((l) => l());
}

/** Opens a tab, scrolls the action panel into view and puts the cursor in its amount field. */
export function openAction(t: ActionTab) {
  setActionTab(t);
  scrollToId("actions");
  window.setTimeout(() => document.getElementById(FIELD[t])?.focus({ preventScroll: true }), 650);
}

/** Smooth-scrolls through Lenis when it is running, natively otherwise. */
export function scrollToId(id: string, offset = -72) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: HTMLElement | number, o?: { offset?: number }) => void } }).__lenis;
  if (lenis) lenis.scrollTo(el, { offset });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + offset, behavior: "smooth" });
}

export function scrollToY(y: number) {
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: number) => void } }).__lenis;
  if (lenis) lenis.scrollTo(y);
  else window.scrollTo({ top: y, behavior: "smooth" });
}

let palette = false;
const paletteListeners = new Set<() => void>();
export function setPaletteOpen(open: boolean) {
  palette = open;
  paletteListeners.forEach((l) => l());
}
export function usePaletteOpen() {
  return useSyncExternalStore(
    (l) => {
      paletteListeners.add(l);
      return () => paletteListeners.delete(l);
    },
    () => palette,
  );
}
