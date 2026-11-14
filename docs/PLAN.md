# Lien — Project Plan

> **Collateral on Base. Credit on Unichain. One ledger on Reactive.**
> Deposit collateral on one chain and borrow on another — no bridge, no wrapped tokens. A Reactive contract is the cross-chain clearing house: it keeps the only ledger, gates every withdrawal with a two-phase commit, and liquidates across chains in seconds.

- **Hackathon:** Reactive Omni Buildathon (DoraHacks), ends **Dec 5, 2026** — submit **Dec 3**
- **Track:** Every Second Counts ($2,000 / $250) — Unichain Sepolia + Base Sepolia + Lasna
- **Judging (equal weight):** Execution (gate), Integration, Usefulness, Craft

---

## 1. Why this project stands apart

**What other entries built (≈29 repos scanned on Nov 14):** stop-losses (6), cross-chain arbitrage bots (4), anti-drain vaults (5), dead-man's switches (3), budgets/allowances (5), AI risk scorers (3).
**Lending entries in this buildathon: 0.** Reactive's 2026 outlook lists *cross-chain lending* as a use case it wants to see.

Basic Reactive cross-chain lending examples exist from 2024–25 ("deposit on Sepolia, receive tokens on another chain"). Lien differs in three ways:

| | Older examples | Lien |
|---|---|---|
| Ledger | Each chain trusts one-way messages | Reactive contract is the **single source of truth** for both chains |
| Withdrawals | Unprotected or unsupported | **Two-phase commit**: lower credit on Unichain first, release on Base only after confirmation |
| Liquidations | None | **Cross-chain liquidation**: liquidator repays on Unichain, receives collateral on Base |
| Evidence | Demo tx | Latency percentiles for every flow, race-attack test, fuzzed safety invariant |

**Why it needs Omni speed:** the gap between a price crash and a liquidation is the protocol's risk window. Every second of loop latency is a second where collateral can fall further below the debt.

## 2. User and problem

**User:** someone holding assets on Base who needs stablecoins on Unichain (or any other L2).
**Today:** bridge the collateral (slow, bridge risk, wrapped-token risk), sell it, or open separate positions per chain that are liquidated separately.
**With Lien:** collateral never leaves Base. Credit appears on Unichain within seconds.

## 3. Flows (each is a measurable loop)

1. **Deposit → credit (1 loop).** Base `Deposited` → ClearingHouse sets `limit = collateral × price × LTV` → `sync` on Unichain.
2. **Borrow / repay (0 loops).** Local on Unichain within the limit; `DebtUpdated` mirrors debt to the ledger.
3. **Withdraw (2 loops, two-phase commit).** Request on Base → ClearingHouse lowers the limit on Unichain → Unichain reports the debt at that exact moment (`LimitApplied`) → ClearingHouse releases only if that debt fits under the lower limit, otherwise rejects and restores the limit.
4. **Price drop → liquidatable (1 loop).** Base `PriceUpdated` → ClearingHouse re-checks every account → `sync(liquidatable)`.
5. **Cross-chain liquidation (1 loop).** Liquidator repays on Unichain → ClearingHouse computes `repaid / price × (1 + bonus)` → `seize` on Base pays the liquidator.

Parameters: LTV 70 %, liquidation threshold 80 %, bonus 5 %, close factor 50 %, at most 8 tracked users.

## 4. Experiments and metrics

| Measurement | n | Output |
|---|---|---|
| Deposit → credit | 30 | p50 / p90 / p95 per leg and total |
| Two-phase withdrawal | 30 | p50 / p95 |
| Price crash → liquidatable | 30 | p50 / p95 |
| Liquidation → seizure | 30 | p50 / p95 |
| Race attack: withdraw everything on Base and borrow everything on Unichain at once | 30 | insolvent outcomes (target 0) |

Report n and percentiles, never one best run. Label any comparison with slower relayers as modelled, not measured.

## 5. Schedule (today = Nov 14)

| Date | Work | Done when |
|---|---|---|
| Nov 14 | Code written, 22 tests passing, lint clean | ✅ |
| Nov 14–16 | Testnet-only wallet, faucet funds on Sepolia, Base Sepolia, Unichain Sepolia | funds in wallet |
| Nov 17–21 | `scripts/deploy.sh`, first full loop on-chain | Execution gate passed |
| Nov 22–26 | `npm run demo`, `bench --n 30`, `race --n 30`, `analyze` | SUMMARY.md |
| Nov 27–29 | Dashboard polish, README tables filled | reproducible by a stranger |
| Nov 30–Dec 2 | Video under 3 minutes, push to public GitHub | ready |
| **Dec 3** | **Submit on DoraHacks** | submitted |
| Dec 4–5 | Buffer | — |

Cut order if behind: dashboard polish → liquidation bench → price bench. Never cut the two-phase withdrawal or the race test.

## 6. Demo video (≤ 3:00)

- **0:00–0:20** "Your ETH is on Base. You need USDC on Unichain. Today you bridge. With Lien you don't."
- **0:20–0:50** Architecture; the two-phase withdrawal in one diagram.
- **0:50–1:50** Live: deposit → credit → borrow → crash price → liquidatable → liquidator repays on Unichain → collateral arrives on Base. Reactscan tabs visible.
- **1:50–2:20** Race attack: 30 attempts, 0 insolvent.
- **2:20–2:45** Latency percentiles.
- **2:45–3:00** Limitations and what comes next.

## 7. Limitations to state openly

- Reactive Network is the clearing house; it is a trust assumption like any cross-chain messaging layer.
- Base is an L2 with soft finality; a reorg after credit is granted could void a deposit.
- Mock oracle, no interest, owner-seeded liquidity, 8-user cap, testnet only.

## 8. Questions to be ready for

1. Why can't a user withdraw on Base and borrow on Unichain at the same time and keep both?
2. What happens if a callback is lost, duplicated, or arrives out of order?
3. Why is the LTV/LT gap related to Reactive's latency?
4. Who pays for callbacks, and what happens when a contract runs into debt?
5. What breaks with 1,000 users, and how would you fix it?
