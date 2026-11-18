# Lien measured results

Generated 2026-11-18T13:41:16.633Z from `results/runs.jsonl`.

Times are wall-clock from submitting the origin transaction to observing each leg via RPC polling (250 ms interval), so each figure carries up to ~0.25 s of observation lag.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | failures |
|---|---|---|---|---|---|---|
| deposit_to_credit | 8 | 6.29 | 7.56 | 7.56 | 7.56 | 0 |
| withdraw_two_phase | 13 | 9.01 | 9.91 | 11.50 | 11.50 | 0 |
| price_to_limit | 13 | 6.90 | 7.97 | 8.24 | 8.24 | 0 |
| liquidation_cross_chain | 4 | 6.62 | 8.37 | 8.37 | 8.37 | 0 |
| protection | 1 | 6.68 | 6.68 | 6.68 | 6.68 | 0 |
| reprice_batches | 1 | 7.14 | 7.14 | 7.14 | 7.14 | 1 |
| price_to_limit_relayed | 4 | 7.61 | 9.37 | 9.37 | 9.37 | 0 |
| protection_relayed | 1 | 7.14 | 7.14 | 7.14 | 7.14 | 0 |

## On-chain latency (block to block)

From the origin transaction's block to the block of the final callback, using each chain's block timestamp. This excludes the wait for the origin receipt and RPC polling, so it is the figure to compare with other block-to-block measurements.

Caveat: whole-second block timestamps on three chains; accurate to about ±1 s; per-leg values can be negative because chain clocks differ.

| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | wall-clock p50 (s) |
|---|---|---|---|---|---|---|
| deposit_to_credit | 8 | 2.00 | 2.00 | 2.00 | 2.00 | 6.29 |
| withdraw_two_phase | 13 | 4.00 | 5.00 | 5.00 | 5.00 | 9.01 |
| price_to_limit | 13 | 2.00 | 3.00 | 3.00 | 3.00 | 6.90 |
| liquidation_cross_chain | 4 | 2.00 | 2.00 | 2.00 | 2.00 | 6.62 |
| protection | 1 | 2.00 | 2.00 | 2.00 | 2.00 | 6.68 |
| reprice_batches | 1 | 4.00 | 4.00 | 4.00 | 4.00 | 7.14 |
| price_to_limit_relayed | 4 | 4.00 | 5.00 | 5.00 | 5.00 | 7.61 |
| protection_relayed | 1 | 4.00 | 4.00 | 4.00 | 4.00 | 7.14 |

## Race attack

Each attempt submits a full-collateral withdrawal on Base and a full-credit borrow on Unichain at the same moment.

| Attempts | Withdrawals released | Borrows filled | Both succeeded | Insolvent outcomes |
|---|---|---|---|---|
| 30 | 2 | 28 | 0 | 0 |

## Per-leg breakdown

### deposit_to_credit

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: deposit (origin) | 2.01 | 2.77 |
| lasna: ClearingHouse react | 2.24 | 3.14 |
| unichain: credit applied (callback) | 2.41 | 2.85 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse react | -1.00 | -1.00 | 0.00 |
| unichain: credit applied (callback) | 3.00 | 2.00 | 3.00 |

### withdraw_two_phase

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: requestWithdraw (origin) | 2.25 | 3.62 |
| lasna: phase 1: lower credit | 1.93 | 3.72 |
| unichain: limit applied + debt snapshot | 2.76 | 3.25 |
| lasna: phase 2: decide | 0.72 | 1.62 |
| base: collateral released | 1.05 | 1.69 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: phase 1: lower credit | -1.00 | -1.00 | 0.00 |
| unichain: limit applied + debt snapshot | 3.00 | 3.00 | 3.00 |
| lasna: phase 2: decide | -1.00 | -1.00 | 0.00 |
| base: collateral released | 2.00 | 2.00 | 3.00 |

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
| unichain: liquidator repays (origin) | 1.96 | 2.14 |
| lasna: ClearingHouse computes seizure | 3.77 | 5.07 |
| base: collateral paid to liquidator | 1.00 | 1.19 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse computes seizure | -1.00 | -1.00 | 0.00 |
| base: collateral paid to liquidator | 2.00 | 1.00 | 3.00 |

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

### reprice_batches

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price update (origin) | 0.85 | 0.85 |
| lasna: batch 1 (inside react): accounts 0-7 | 1.49 | 1.49 |
| lasna: batch 2 (after relay): accounts 8-11 | 4.79 | 4.79 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: batch 1 (inside react): accounts 0-7 | -1.00 | -1.00 | -1.00 |
| lasna: batch 2 (after relay): accounts 8-11 | 5.00 | 5.00 | 5.00 |

### price_to_limit_relayed

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price update (origin) | 1.16 | 1.90 |
| lasna: ClearingHouse re-prices | 1.98 | 2.95 |
| unichain: relay 1 (callback) | 2.36 | 2.67 |
| lasna: ClearingHouse re-prices batch 2 | 0.42 | 0.89 |
| unichain: limit updated | 1.36 | 2.14 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse re-prices | -1.00 | -1.00 | 0.00 |
| unichain: relay 1 (callback) | 3.00 | 3.00 | 3.00 |
| lasna: ClearingHouse re-prices batch 2 | -1.00 | -1.00 | 0.00 |
| unichain: limit updated | 3.00 | 2.00 | 3.00 |

### protection_relayed

| Leg | p50 (s) | p95 (s) |
|---|---|---|
| base: price drop (origin) | 1.25 | 1.25 |
| lasna: ClearingHouse re-prices | 1.65 | 1.65 |
| unichain: relay 1 (callback) | 2.19 | 2.19 |
| lasna: ClearingHouse re-prices batch 2 | 0.77 | 0.77 |
| unichain: shield repaid debt (callback) | 1.28 | 1.28 |

On-chain gap from the previous leg's block (block timestamps):

| Leg | p50 (s) | min (s) | max (s) |
|---|---|---|---|
| lasna: ClearingHouse re-prices | -1.00 | -1.00 | -1.00 |
| unichain: relay 1 (callback) | 3.00 | 3.00 | 3.00 |
| lasna: ClearingHouse re-prices batch 2 | 0.00 | 0.00 | 0.00 |
| unichain: shield repaid debt (callback) | 2.00 | 2.00 | 2.00 |
