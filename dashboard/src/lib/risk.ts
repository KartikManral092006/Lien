import { COLL, DEBT, PRICE } from "./chain";
import type { Position } from "./data";

const CU = 10n ** BigInt(COLL);
const DU = 10n ** BigInt(DEBT);
const PU = 10n ** BigInt(PRICE);

export type Outcome = {
  price: bigint;
  value: bigint;
  limit: bigint;
  /** Health before any shield acts. */
  health: number;
  /** The ClearingHouse would order a shield repayment at this price. */
  protects: boolean;
  repaid: bigint;
  debtAfter: bigint;
  shieldAfter: bigint;
  healthAfter: number;
  /** Flagged for liquidation once the callback lands (after any shield repayment). */
  liquidatable: boolean;
  zone: "safe" | "capped" | "protect" | "liquidatable";
};

/**
 * What the ledger would decide if the oracle moved to `price` (8 decimals). Mirrors
 * ClearingHouse.valueOf / limitFor / isUnhealthy / needsProtection and CreditMarket._protect.
 */
export function outcomeAt(p: Position, price: bigint): Outcome {
  const valueOf = (c: bigint) => (c * price * DU) / (CU * PU);
  const value = valueOf(p.collateral);
  const limit = (valueOf(p.collateral - p.pending) * p.ltvBps) / 10_000n;
  const shield = p.shield ?? 0n;
  const protectBps = p.protectBps ?? 7_500n;
  const debt = p.debt;

  const unhealthy = debt * 10_000n > value * p.ltBps;
  const protects = shield > 0n && debt > limit && debt * 10_000n > value * protectBps;
  const repaid = protects ? (debt - limit < shield ? debt - limit : shield) : 0n;
  const debtAfter = debt - repaid;
  const liquidatable = unhealthy && !(protects && debtAfter <= limit);

  const h = (d: bigint) => (d > 0n ? Number((value * p.ltBps) / 10_000n) / Number(d) : Infinity);
  const zone = liquidatable ? "liquidatable" : protects ? "protect" : debt > limit ? "capped" : "safe";
  return { price, value, limit, health: h(debt), protects, repaid, debtAfter, shieldAfter: shield - repaid, healthAfter: h(debtAfter), liquidatable, zone };
}

/** Oracle price (8 decimals) at which debt × 10⁴ equals collateral value × bps. */
export function priceAtBps(p: Position, bps: bigint, debt = p.debt) {
  if (debt === 0n || p.collateral === 0n) return undefined;
  return (debt * CU * PU * 10_000n) / (p.collateral * DU * bps);
}
