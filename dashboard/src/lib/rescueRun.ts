import type { ChainKey } from "./chain";

/**
 * One real shield rescue, recorded on testnet by the benchmark (results/runs.jsonl, run bench-1795071504653,
 * flow protection_relayed, 2026-11-19). The replay on the page plays these legs back; nothing here is
 * simulated. Amounts are in whole USD / USDC, as the contracts reported them.
 */
export const RESCUE_RUN = {
  runId: "bench-1795071504653",
  recordedOn: "19 Nov 2026",
  /** Price-drop block on Base to rescue block on Unichain, by block timestamps. */
  onchainSeconds: 5,
  before: { price: 2_000, collateralWeth: 1, debt: 1_400, shield: 300 },
  after: { price: 1_600, debt: 1_120, shield: 20, repaid: 280 },
  /** ClearingHouse risk parameters at the time: borrow limit 70 %, liquidation line 80 % of collateral value. */
  ltvBps: 7_000,
  ltBps: 8_000,
  legs: [
    {
      chain: "base",
      tx: "0x84c62bf63b3e858bd23dc3201415d7884c229b102a7a852392ac6ef1fc4c7011",
      observedAtMs: 1795071518515,
      title: "WETH falls 20%, from $2,000 to $1,600",
      detail: "The loan is now past the liquidation line. Left alone, anyone could liquidate it.",
    },
    {
      chain: "lasna",
      tx: "0x9625b1b5e2e77a47f664ab2d5a9a9ed8bfcc24dedcbd415071aa90eb09443bf1",
      observedAtMs: 1795071520649,
      title: "Reactive sees the new price and re-checks borrowers",
      detail: "The ClearingHouse reacts to the price event on its own and re-checks the first batch of 8 accounts.",
    },
    {
      chain: "unichain",
      tx: "0x0221176c08266e2c07bdf572c858b253fb679e2f09ea6be1ac44b3626c65e850",
      observedAtMs: 1795071523139,
      title: "A relay on Unichain starts the next batch",
      detail: "There are more borrowers, so the ClearingHouse triggers the next batch through a callback on Unichain.",
    },
    {
      chain: "lasna",
      tx: "0x33cfb472fc5eff759fa1745ddcacdea8957f9253756a036f7f12981b2ff05216",
      observedAtMs: 1795071523578,
      title: "This borrower is checked and the shield is called in",
      detail: "Debt of 1,400 is above the new 1,120 limit, so the ClearingHouse orders a repayment from the shield.",
    },
    {
      chain: "unichain",
      tx: "0x70e854bb05946ca67180aa70a0d217779d95637a0c81879d0bd0cfe1fdef0c1e",
      observedAtMs: 1795071524933,
      title: "The shield repays 280 USDC. The loan is safe again",
      detail: "Debt drops from 1,400 to 1,120. The account was never flagged for liquidation, and no bot or person stepped in.",
    },
  ] as { chain: ChainKey; tx: `0x${string}`; observedAtMs: number; title: string; detail: string }[],
} as const;

export const DEMO_VIDEO_URL = "https://youtu.be/J5_mckbzYFo";

/** Fired by the navbar button: the replay resets to the calm state and plays from the start once scrolled to. */
export const WATCH_RESCUE_EVENT = "lien:watch-rescue";

/**
 * Click handler for every "watch a rescue" link. Wide screens land on the section heading; narrow ones land
 * on the chain rail, so the rail and the borrower's loan (stacked under it) are both on screen as it plays.
 */
export function watchRescue(e: { preventDefault: () => void; stopPropagation: () => void }) {
  window.dispatchEvent(new Event(WATCH_RESCUE_EVENT));
  if (!window.matchMedia("(max-width: 1023px)").matches) return; // Lenis follows the #rescue anchor
  const el = document.getElementById("rescue-live");
  if (!el) return;
  // Lenis listens for anchor clicks on the document; keep it from overriding this target with #rescue.
  e.preventDefault();
  e.stopPropagation();
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: HTMLElement, o: { offset: number }) => void } }).__lenis;
  if (lenis) lenis.scrollTo(el, { offset: -64 });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
}
