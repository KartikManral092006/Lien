# Lien measured results

Generated 2026-11-14T13:13:43.281Z from `results/runs.jsonl`.

Times are wall-clock from submitting the origin transaction to observing each leg via RPC polling (250 ms interval), so each figure carries up to ~0.25 s of observation lag.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | failures |
|---|---|---|---|---|---|---|
| deposit_to_credit | 6 | 6.29 | 7.56 | 7.56 | 7.56 | 0 |
| withdraw_two_phase | 10 | 9.43 | 9.91 | 11.50 | 11.50 | 0 |
| price_to_limit | 13 | 6.90 | 7.97 | 8.24 | 8.24 | 0 |
| liquidation_cross_chain | 2 | 6.62 | 8.37 | 8.37 | 8.37 | 0 |
| protection | 1 | 6.68 | 6.68 | 6.68 | 6.68 | 0 |

## Per-leg breakdown

### deposit_to_credit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: deposit (origin) | 2.11 | 2.77 |
| lasna: ClearingHouse react | 1.92 | 2.49 |
| unichain: credit applied (callback) | 2.29 | 2.72 |

### withdraw_two_phase

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: requestWithdraw (origin) | 2.26 | 3.62 |
| lasna: phase 1: lower credit | 1.85 | 3.72 |
| unichain: limit applied + debt snapshot | 2.90 | 3.25 |
| lasna: phase 2: decide | 0.72 | 1.62 |
| base: collateral released | 1.05 | 1.69 |

### price_to_limit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price update (origin) | 2.24 | 3.03 |
| lasna: ClearingHouse re-prices | 1.86 | 2.90 |
| unichain: flagged liquidatable | 2.81 | 3.18 |

### liquidation_cross_chain

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| unichain: liquidator repays (origin) | 1.76 | 2.10 |
| lasna: ClearingHouse computes seizure | 3.77 | 5.07 |
| base: collateral paid to liquidator | 1.08 | 1.19 |

### protection

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price drop (origin) | 2.31 | 2.31 |
| lasna: ClearingHouse orders protection | 1.30 | 1.30 |
| unichain: shield repaid debt (callback) | 3.07 | 3.07 |
