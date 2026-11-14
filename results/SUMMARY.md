# Lien measured results

Generated 2026-11-14T10:01:07.438Z from `results/runs.jsonl`.

Times are wall-clock from submitting the origin transaction to observing each leg via RPC polling (250 ms interval), so each figure carries up to ~0.25 s of observation lag.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | failures |
|---|---|---|---|---|---|---|
| deposit_to_credit | 5 | 6.37 | 7.56 | 7.56 | 7.56 | 0 |
| withdraw_two_phase | 9 | 9.43 | 11.50 | 11.50 | 11.50 | 0 |
| price_to_limit | 10 | 6.72 | 7.97 | 8.24 | 8.24 | 0 |
| liquidation_cross_chain | 1 | 8.37 | 8.37 | 8.37 | 8.37 | 0 |

## Per-leg breakdown

### deposit_to_credit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: deposit (origin) | 2.13 | 2.77 |
| lasna: ClearingHouse react | 2.24 | 2.49 |
| unichain: credit applied (callback) | 2.41 | 2.72 |

### withdraw_two_phase

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: requestWithdraw (origin) | 2.29 | 3.62 |
| lasna: phase 1: lower credit | 1.85 | 2.99 |
| unichain: limit applied + debt snapshot | 2.94 | 3.25 |
| lasna: phase 2: decide | 0.72 | 1.62 |
| base: collateral released | 1.05 | 1.69 |

### price_to_limit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price update (origin) | 2.24 | 3.03 |
| lasna: ClearingHouse re-prices | 1.86 | 2.90 |
| unichain: flagged liquidatable | 2.67 | 3.18 |

### liquidation_cross_chain

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| unichain: liquidator repays (origin) | 2.10 | 2.10 |
| lasna: ClearingHouse computes seizure | 5.07 | 5.07 |
| base: collateral paid to liquidator | 1.19 | 1.19 |
