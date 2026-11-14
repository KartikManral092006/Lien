# Lien measured results

Generated 2026-11-14T17:57:08.125Z from `results/runs.jsonl`.

Times are wall-clock from submitting the origin transaction to observing each leg via RPC polling (250 ms interval), so each figure carries up to ~0.25 s of observation lag.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | failures |
|---|---|---|---|---|---|---|
| deposit_to_credit | 6 | 6.29 | 7.56 | 7.56 | 7.56 | 0 |
| withdraw_two_phase | 10 | 9.43 | 9.91 | 11.50 | 11.50 | 0 |
| price_to_limit | 13 | 6.90 | 7.97 | 8.24 | 8.24 | 0 |
| liquidation_cross_chain | 2 | 6.62 | 8.37 | 8.37 | 8.37 | 0 |
| protection | 1 | 6.68 | 6.68 | 6.68 | 6.68 | 0 |

## On-chain latency (block to block)

From the origin transaction's block to the block of the final callback, using each chain's block timestamp. This excludes the wait for the origin receipt and RPC polling, so it is the figure to compare with other block-to-block measurements.

Caveat: whole-second block timestamps on three chains; accurate to about ±1 s; per-leg values can be negative because chain clocks differ.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | wall-clock p50 (s) |
|---|---|---|---|---|---|---|
| deposit_to_credit | 6 | 2.00 | 2.00 | 2.00 | 2.00 | 6.29 |
| withdraw_two_phase | 10 | 4.00 | 5.00 | 5.00 | 5.00 | 9.43 |
| price_to_limit | 13 | 2.00 | 3.00 | 3.00 | 3.00 | 6.90 |
| liquidation_cross_chain | 2 | 2.00 | 2.00 | 2.00 | 2.00 | 6.62 |
| protection | 1 | 2.00 | 2.00 | 2.00 | 2.00 | 6.68 |

## Per-leg breakdown

### deposit_to_credit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: deposit (origin) | 2.11 | 2.77 |
| lasna: ClearingHouse react | 1.92 | 2.49 |
| unichain: credit applied (callback) | 2.29 | 2.72 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse react | -1.00 | -1.00 | 0.00 |
| unichain: credit applied (callback) | 3.00 | 2.00 | 3.00 |

### withdraw_two_phase

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: requestWithdraw (origin) | 2.26 | 3.62 |
| lasna: phase 1: lower credit | 1.85 | 3.72 |
| unichain: limit applied + debt snapshot | 2.90 | 3.25 |
| lasna: phase 2: decide | 0.72 | 1.62 |
| base: collateral released | 1.05 | 1.69 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: phase 1: lower credit | 0.00 | -1.00 | 0.00 |
| unichain: limit applied + debt snapshot | 3.00 | 3.00 | 3.00 |
| lasna: phase 2: decide | -1.00 | -1.00 | 0.00 |
| base: collateral released | 3.00 | 2.00 | 3.00 |

### price_to_limit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price update (origin) | 2.24 | 3.03 |
| lasna: ClearingHouse re-prices | 1.86 | 2.90 |
| unichain: flagged liquidatable | 2.81 | 3.18 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse re-prices | -1.00 | -1.00 | 0.00 |
| unichain: flagged liquidatable | 3.00 | 2.00 | 3.00 |

### liquidation_cross_chain

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| unichain: liquidator repays (origin) | 1.76 | 2.10 |
| lasna: ClearingHouse computes seizure | 3.77 | 5.07 |
| base: collateral paid to liquidator | 1.08 | 1.19 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse computes seizure | -1.00 | -1.00 | 0.00 |
| base: collateral paid to liquidator | 2.00 | 2.00 | 3.00 |

### protection

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price drop (origin) | 2.31 | 2.31 |
| lasna: ClearingHouse orders protection | 1.30 | 1.30 |
| unichain: shield repaid debt (callback) | 3.07 | 3.07 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse orders protection | -1.00 | -1.00 | -1.00 |
| unichain: shield repaid debt (callback) | 3.00 | 3.00 | 3.00 |
