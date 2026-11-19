# Lien

**Collateral on Base. Credit on Unichain. One ledger on Reactive.**

[![ci](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml/badge.svg)](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml)

Lien lets you deposit collateral on one chain and borrow on another with no bridge and no wrapped token. A reactive contract on Reactive Lasna is the cross-chain clearing house: the only place credit limits, withdrawals, liquidations and protection are decided. A two-phase commit keeps both chains consistent, and an optional **shield** repays a borrower's loan before anyone can liquidate it.

Built for the Reactive Omni Buildathon, track **Every Second Counts**.

### In one transaction chain

**WETH drops on Base. About 2 seconds later, by block timestamps, the shield has repaid the loan on Unichain, and the account was never liquidatable.** This happened on testnet, and the price was moved by an ordinary browser wallet:

| | Transaction | What happened |
|---|---|---|
| 1. A visitor drops the price on **Base** | [`0x9d75…97e1`](https://sepolia.basescan.org/tx/0x9d7549be323311fcc087eb22f5d7a7655e1664203c178e61c2257ccf924797e1) | WETH $2,000 → $1,800 through the public price controller |
| 2. The ledger on **Reactive Lasna** decides | [`0x965f…8c4b`](https://lasna.reactscan.net/tx/0x965f049a44f99d329ac1b31ead751b2e9be33f09d17e637f9d6bfda051428c4b) | Re-prices the account and orders protection in the same callback that would flag it |
| 3. The shield repays on **Unichain** | [`0x5a5b…c7c4`](https://sepolia.uniscan.xyz/tx/0x5a5b8da94ddc2c3b52c53cb38dbea4b6b52781460c88a0c9055dbfc96a10c7c4) | 53 USDC repaid from the shield, debt 620 → 567, **not liquidatable** |

- **Three chains, 2–3 s block to block.** That is the on-chain median for every single-loop flow in [Results](#results), not a best case. An account beyond the first 8 re-checked after a price move waits one relay more: about 5 s. On the previous ~7 s Reactive blocks the same loops would take two to three times as long ([why it needs Omni](#why-it-needs-reactive-omni-in-numbers)).
- **The reactive contract is the protocol.** It holds the only cross-chain ledger and makes every decision that moves money. Remove it and nothing can be borrowed, withdrawn, protected or liquidated.
- **It is safe under races.** Withdrawals settle in two phases, so withdrawing on Base and borrowing on Unichain at the same instant cannot leave the protocol short. This is covered by tests and fuzzing with randomly ordered cross-chain delivery, and `npm run race` ran the same attack 30 times against the live contracts: [0 attempts where both succeeded, 0 insolvent outcomes](#two-phase-withdrawal-why-the-protocol-cannot-be-drained-by-racing-it).
- **Anyone can reproduce it.** Use the hosted dashboard at **[kartikmanral092006.github.io/Lien](https://kartikmanral092006.github.io/Lien/)**: connect a wallet, borrow, add a shield and press *Drop WETH 10%*.

---

## For judges: where each criterion is answered

| Criterion | Where to look |
|---|---|
| **Execution** | [Full-loop transactions](#full-loop-transactions): every flow's origin tx, the ClearingHouse reaction on Lasna, and the callback it triggered, with explorer links, including the [shield repaying a loan on-chain](#auto-protection-the-shield). All seven [deployed contracts](#deployed-contracts) are source-verified on Sourcify. Raw per-leg timings for every run are in [`results/runs.jsonl`](results/runs.jsonl). |
| **Integration** | [What the reactive contract decides](#what-the-reactive-contract-decides). It is the protocol, not a notifier: remove it and no limit, withdrawal, seizure or protection can happen. |
| **Usefulness** | [Why](#why), [why it needs Reactive Omni, in numbers](#why-it-needs-reactive-omni-in-numbers), and [Auto-protection](#auto-protection-the-shield). You can [try the shield yourself](#try-it-yourself): anyone can move the test price. |
| **Craft** | [Tests](#tests) (75, 97% of lines and 82% of branches covered, including fuzzing with randomly ordered cross-chain delivery), CI on every push, a scripted [demo](#2-demo-benchmark-race-test), a [hosted dashboard](https://kartikmanral092006.github.io/Lien/), [latency measured two ways](#results), and [run-it-yourself steps](#run-it-on-testnet). |

## Why

If your ETH is on Base and you need stablecoins on Unichain, today you bridge the collateral (slow, bridge risk, wrapped-token risk), sell it, or open separate positions on each chain that are liquidated separately. Lien keeps the collateral where it is and moves only the *credit*.

The hard part is coordination. Two chains that never talk to each other must agree on one number per user, and the gap between a price move and the reaction on the other chain is the protocol's risk window. That is why this is an *Every Second Counts* entry: every second of loop latency is a second in which a borrower can fall further below water, or a shield can arrive too late.

### Why it needs Reactive Omni, in numbers

**The window the loop has to beat.** A borrower at the 70% limit crosses the shield trigger (75%) when WETH falls about **6.7%**, and becomes liquidatable (80%) at about **12.5%**. The shield has to reach Unichain while the price covers the remaining 5.8 points, and a borrower without a shield relies on the same loop to be flagged before the debt outgrows the collateral.

**How long the loop takes.** Each loop crosses Reactive once or twice. We measured it on Omni and estimate the same loop on the previous ~7 s blocks:

| Loop | Reactive hops | Measured on Omni (on-chain median) | Same loop on ~7 s blocks (estimate) |
|---|---|---|---|
| Deposit → credit on Unichain | 1 | 2 s | about 5 s, up to 8 s |
| Price move → new limit or shield, first 8 accounts | 1 | 2 s | about 5 s, up to 8 s |
| Price move → new limit or shield, next 8 (one relay) | 2 | 5 s | about 11 s, up to 17 s |
| Two-phase withdrawal | 2 | 4 s | about 10 s, up to 16 s |

How the estimate is made: a reaction waits for the next Reactive block, on average half a block. Going from ~1 s to ~7 s blocks adds about 3 s on average, and up to 6 s, per Reactive hop; everything else is our measured time. It only accounts for block time, so treat it as a lower bound.

On ~7 s blocks, every price move would leave borrowers exposed two to three times as long, and each further batch of 8 accounts would add another wait for a slow block. Omni is what lets one ledger serve two chains inside the window.

## Architecture

```
 Base Sepolia (84532)                 Reactive Lasna (5318007)                 Unichain Sepolia (1301)
┌──────────────────────────┐         ┌───────────────────────────────┐        ┌──────────────────────────┐
│ CollateralVault          │─events─▶│ ClearingHouse                 │◀─events─│ CreditMarket             │
│  deposit                 │         │  ledger: collateral, pending, │        │  borrow / repay          │
│  requestWithdraw         │         │    debt, limit, shield, seq   │        │  liquidate               │
│  cancelWithdraw          │         │  risk: LTV 70%, protect 75%,  │        │  fundShield / withdraw   │
│  settleWithdraw  ◀─cb────│─────────│        LT 80%, bonus 5%       │──cb───▶│  sync(limit, flag, seq,  │
│  seize           ◀─cb────│         │                               │        │       protect)           │
├──────────────────────────┤         └───────────────────────────────┘        └──────────────────────────┘
│ MockPriceFeed  ──events──┼──────▶ (price)
└──────────────────────────┘
```

| Contract | Chain | Role |
|---|---|---|
| [`ClearingHouse`](contracts/src/ClearingHouse.sol) | Lasna | `AbstractReactive`. Subscribes to 10 event types on two chains (one is its own re-pricing relay), keeps the ledger, sends every callback |
| [`CollateralVault`](contracts/src/CollateralVault.sol) | Base Sepolia | `AbstractCallback`. Holds collateral; only the ClearingHouse can release or seize it |
| [`CreditMarket`](contracts/src/CreditMarket.sol) | Unichain Sepolia | `AbstractCallback`. Lends against limits the ClearingHouse sets; holds shields |
| [`MockPriceFeed`](contracts/src/mocks/MockPriceFeed.sol) | Base Sepolia | Test oracle; its price events drive re-pricing, protection and liquidation |
| [`PriceController`](contracts/src/mocks/PriceController.sol) | Base Sepolia | Testnet only. Owns the feed and lets **anyone** move the price within bounds, so a visitor can trigger a shield repayment or a liquidation with their own wallet |

Callbacks use the Omni API (`SYSTEM.requestCallbackV_1_0`), and every callback function checks both `onlyServiceProvider` (the caller is the callback proxy) and `onlyCallbackSender` (the injected sender is our ClearingHouse).

## What the reactive contract decides

The ClearingHouse is not a relay that forwards events. Every decision that moves money is made inside `react()`:

| Decision | Inputs it combines | Output |
|---|---|---|
| **Credit limit** for each user | collateral and pending withdrawals (Base), price (Base feed), LTV | `sync` on Unichain |
| **Whether a withdrawal may leave** | the debt snapshot Unichain reports *after* the lower limit is applied | `settleWithdraw(release / reject)` on Base |
| **How much collateral a liquidator gets** | amount repaid on Unichain, price, 5% bonus | `seize` on Base |
| **Whether to repay a loan from the shield** | debt vs. the 75% protection trigger, shield balance | `sync(..., protect = true)` on Unichain |
| **Which messages are stale** | per-user sequence numbers, request and liquidation ids | dropped or applied |

Neither chain can do any of this alone: Base does not know the debt, Unichain does not know the collateral or the price.

## The flows

| Flow | Loops | What happens |
|---|---|---|
| **Deposit → credit** | 1 | `Deposited` on Base → ClearingHouse computes `limit = value × LTV` → `sync` on Unichain |
| **Borrow / repay** | 0 | Local on Unichain, bounded by the synced limit; `DebtUpdated` mirrors debt into the ledger |
| **Withdraw** | 2 | Two-phase commit, see below |
| **Price drop → liquidatable** | 1 | `PriceUpdated` on Base → ClearingHouse re-prices every account → `sync(liquidatable = true)`. Accounts are re-checked in batches of 8: the first inside `react()`, each further batch in a fresh `react()` triggered by a relay through the CreditMarket (callback to Unichain, `RepriceRelayed` event back), so there is no account cap. [Measured on-chain](#batched-re-pricing-on-chain) |
| **Price drop → shield repays** | 1 | Same price event; for a user past the 75% trigger with a shield, the same `sync` repays debt from the shield instead of flagging the account |
| **Cross-chain liquidation** | 1 | Liquidator repays on Unichain → `Liquidated` → ClearingHouse → `seize` on Base pays the liquidator in collateral. Nobody bridges |

### Two-phase withdrawal (why the protocol cannot be drained by racing it)

1. `WithdrawRequested` on Base. The vault marks the amount *pending*; nothing leaves yet.
2. ClearingHouse lowers the user's credit limit on Unichain to what the remaining collateral supports and tags the sync with the request id.
3. The market applies the lower limit and emits `LimitApplied(..., debt)`: **the exact debt at the moment the limit dropped**.
4. ClearingHouse releases the collateral only if that debt fits under the new limit; otherwise it rejects and restores the limit.

Any borrow the user fires during the window lands either before step 3 (so it is included in the debt snapshot, and the withdrawal is rejected) or after it (so it is bounded by the lower limit). There is no ordering in which both succeed beyond the collateral. Stale or reordered callbacks are dropped by a per-user sequence number, settlements are idempotent per request and liquidation id, and a user can always cancel a pending withdrawal.

**Tested on-chain.** `npm run race -- --n 30` (run `race-1795008659897`, log in [`results/race.log`](results/race.log)) fired a full-collateral withdrawal on Base and a full-credit borrow on Unichain at the same moment, 30 times:

| Attempts | Withdrawal released | Borrow filled | Both succeeded | Insolvent outcomes |
|---|---|---|---|---|
| 30 | 2 | 28 | **0** | **0** |

The borrow usually wins because it is a single Unichain transaction, while the withdrawal needs a full loop through Lasna. Either way exactly one side succeeds. Example attempts: borrow first ([withdraw request](https://sepolia.basescan.org/tx/0x8a0d303559f2d6421a9b742c4a3272a4173e0288d69d048cd4a125d86c8ac517), [borrow](https://sepolia.uniscan.xyz/tx/0x284db607658c83bf5240fa55a3f24e79d6932c4aa7d00d3f335402e2b203c4c6), [withdrawal rejected](https://sepolia.basescan.org/tx/0xc3d345363f5de5e4d2622eec9c7915b7992a354c6948ef78a2c4e6cd64870fb8)), and withdrawal first ([withdraw request](https://sepolia.basescan.org/tx/0x1f7456945d585be74a28d1fb758f864e72ed9d47b613769676b55dacd85ec00a), [collateral released](https://sepolia.basescan.org/tx/0x15b6c6e55179659d12287c1386720d76ec4b6c89c521e0ec93c42f0b8b9e52d4), no borrow went through). Every attempt's transactions are in [`results/runs.jsonl`](results/runs.jsonl).

### Auto-protection (the shield)

A borrower can set aside USDC on Unichain (`fundShield`). Shield money is never lent to others.

When a price update pushes a user's debt above **75%** of their collateral value (above the 70% borrow limit, below the 80% liquidation threshold), the ClearingHouse adds `protect = true` to its normal `sync`. The market then repays the debt above the new limit **from the shield, in the same call that would otherwise set the liquidation flag**.

- **No liquidator can act first.** The flag that allows a liquidation and the protection that prevents it travel in the same callback.
- **Safe under duplicates and reordering.** The market repays *down to the limit*, never a fixed amount, so a repeated or late callback spends nothing extra.
- **Conservative when short.** If the shield cannot cover the gap, the account is still flagged.

**On-chain.** In the demo, a borrower at 630 USDC debt against 0.45 WETH, with a 300 USDC shield, is hit by a price drop from $2,000 to $1,600:

| Leg | Transaction | What it shows |
|---|---|---|
| Price drop on Base | [`0x586a…cac6`](https://sepolia.basescan.org/tx/0x586abb3de771d4d05317f188df19c584745a4bd8cb274ee1dc5f3292abf4cac6) | `PriceUpdated` to $1,600 |
| ClearingHouse on Lasna, +1.3 s | [`0xd382…b553`](https://lasna.reactscan.net/tx/0xd382d6019a2262b45487208a5f8f0b0e6c9b66b641002d983cbbb263a14bb553) | Re-prices the account and sends `sync(..., protect = true)` |
| Callback on Unichain, +3.1 s | [`0xd315…2f89`](https://sepolia.uniscan.xyz/tx/0xd3150162d243d59f8b892e3971405e1d96ed2db908e6464db11a2f9e15e72f89) | `Protected`: **126 USDC repaid** from the shield, debt 630 → 504 (the new limit, 0.45 × $1,600 × 70%), shield 300 → 174, and the account is **not** flagged for liquidation |

6.7 s from submitting the price update to the repayment on Unichain (one run so far; see [Results](#results)).

## Tests

```bash
cd contracts
forge test -vv
```

**75 tests, all passing**: 23 flow tests, 15 protection tests, 12 price-controller tests, 17 guard tests, 3 fuzz tests (256 runs each in CI) and 5 tests of the [self-callback probe](#batched-re-pricing-on-chain). `forge fmt --check`, `forge build`, `forge lint src` and `forge test` run in CI on every push, alongside a type-check of the bots and a production build of the dashboard.

The harness simulates the Reactive Network in Foundry: a mock system contract is etched at `0x8888…8888`, events from the vault, feed and market are queued per chain, and callbacks are delivered with the sender injection the real proxies perform.

- **[`LienFlows.t.sol`](contracts/test/LienFlows.t.sol)**: every flow, the race window, liquidation maths (repay 700 USDC at $1,600 with a 5% bonus = 0.459375 WETH), auth on every callback, stale syncs, duplicate seizures, cancel-then-late-release, and batched re-pricing with no account cap. With 27 borrowers, a crash flags every one in 4 batches: the first costs about 384k gas inside `react()`, and each relayed batch about 337k in its own `react()`, all under Reactive's 900k cap. These figures are measured against the mock system contract, so treat them as estimates. A second price arriving mid-pass restarts the pass (a stale relay does nothing), only our ClearingHouse can trigger a relay, and an outside call to `continueReprice` can never make an account sync twice.
- **[`LienShield.t.sol`](contracts/test/LienShield.t.sol)**: protection instead of liquidation, no window between flag and protection, partial shields, protection before the liquidation threshold, small moves leaving the shield untouched, rescuing an already-flagged account, duplicate and reordered protections, a shield withdrawn mid-flight, shields never lent out, protecting a full batch of 8 in one crash (about 423k gas), and protecting shielded accounts that fall beyond the first batch.
- **[`LienPriceController.t.sol`](contracts/test/LienPriceController.t.sol)**: a stranger's price drop triggers the shield (and, without one, liquidation) through the simulated Reactive flow; the 30% move cap, the $500–$5,000 range, the cooldown measured in seconds rather than blocks (10,000 blocks with no time passing are still refused), the daily cap, reset, owner-only administration and handing the oracle back.
- **[`LienGuards.t.sol`](contracts/test/LienGuards.t.sol)**: the guard paths of the two contracts that hold funds. Zero amounts, withdrawals above free collateral, cancelling someone else's request, a release arriving after a cancel (ignored, nothing paid) or after the collateral was seized (nothing overpaid), seizures capped at the collateral, the 50% close factor and dust debt, borrowing past the limit, the flag or the lendable cash (shields excluded), repayment capped at the debt, owner-only gas withdrawal, and a token that reports a failed transfer instead of reverting.
- **[`LienFuzz.t.sol`](contracts/test/LienFuzz.t.sol)**: three actors act randomly while events and callbacks are delivered in **random order and at random times**. One fuzz asserts `debt ≤ collateral × price × LTV` after every step; one delivers every callback in reverse order; one adds price moves, shields and liquidations and asserts that after settlement no account is left past the trigger with unused shield money and the liquidation flag always matches health.

**Coverage** (`forge coverage --no-match-coverage "(test|script|lib)/"`): 97% of lines and 82% of branches across `src/`. Per contract, by branch: ClearingHouse 91%, CollateralVault 88%, CreditMarket 82%.

**Static analysis.** [Slither](https://github.com/crytic/slither) 0.11 (`cd contracts && slither .`, configured by [`slither.config.json`](contracts/slither.config.json)) reports 26 results; none is an exploitable issue, and none needed a code change:

| Detector | Where | Assessment |
|---|---|---|
| `reentrancy-no-eth`, `reentrancy-benign`, `reentrancy-events` | ClearingHouse, probe | The only external call is `requestCallbackV_1_0` on Reactive's fixed system contract at `0x8888…8888`. It records a request and cannot call back into the ClearingHouse; the callback runs later, in a separate transaction on another chain. |
| `calls-loop` | ClearingHouse re-pricing batch | One system call per account whose limit changes, bounded by the batch size of 8. |
| `incorrect-equality`, `timestamp` | PriceController (testnet only) | Deliberate: the daily cap buckets `block.timestamp / 1 days`, and the cooldown is measured in seconds. Being off by a few seconds is harmless. |
| `immutable-states` | `owner` in three contracts | `owner` is never reassigned, so it could be `immutable` (a small gas saving). Left as is so the deployed, source-verified bytecode matches this repository. |
| `naming-convention`, `unindexed-event-address`, `cyclomatic-complexity` | ClearingHouse | Style: `T_*` are topic constants; `Configured` is emitted once; `react()` is the event dispatcher. |

Writing the protection fuzz also exposed a gap in the original ClearingHouse: it re-checked an account on a debt change only if the account was already flagged, so a borrow made against a stale limit right after a crash left an unhealthy account unflagged until the next price update. It now re-evaluates on every debt change (`test_borrowAgainstStaleLimitIsFlagged` fails on the old code).

## Results

Live testnet runs (`npm run analyze`; see [`results/SUMMARY.md`](results/SUMMARY.md)). Each run is measured on two clocks:

- **On-chain:** from the origin transaction's block to the final callback's block, using block timestamps. This is the latency of the protocol itself.
- **Wall clock:** from submitting the origin transaction until our script saw the final callback. It adds the origin transaction's own confirmation (about 2 s) and public-RPC polling. This is what a user waits.

| Flow | Runs | On-chain median | On-chain p95 | Wall-clock median | Wall-clock p95 |
|---|---|---|---|---|---|
| Deposit → credit on Unichain | 28 | **2 s** | 4 s | 6.7 s | 7.6 s |
| Two-phase withdrawal (2 loops) | 33 | **4 s** | 5 s | 9.2 s | 15.1 s |
| Price drop → new limit on Unichain | 13 | **2 s** | 3 s | 6.9 s | 8.2 s |
| Liquidation → seizure on Base | 4 | **2 s** | 2 s | 6.6 s | 8.4 s |
| Price drop → shield repays on Unichain | 1 | **2 s** | 2 s | 6.7 s | 6.7 s |
| Price move → new limit, account in the second batch (via relay) | 24 | **5 s** | 5 s | 8.4 s | 10.6 s |
| Price drop → shield repays, account in the second batch (via relay) | 1 | **4 s** | 4 s | 7.1 s | 7.1 s |
| Price drop → all 12 accounts re-checked (two batches) | 1 | **4 s** | 4 s | 7.1 s | 7.1 s |

- **Precision:** block timestamps on these chains are whole seconds, and the three chains' clocks differ slightly (a Lasna block can carry an earlier timestamp than the Base block it reacted to). On-chain figures are therefore accurate to about ±1 s; [`results/SUMMARY.md`](results/SUMMARY.md) has the per-leg values.
- **Sample size:** the first three rows and the second-batch price row include a 20-round benchmark on the current deployment (`bench-1795016294984`, 60 runs, 0 failures, about 3.2 lREACT); the other rows are smaller samples from demo runs across deployments (the loop logic is the same). In the benchmark alone, deposit took 2–4 s on-chain (median 3 s), withdrawal 3–5 s (median 4 s) and the second-batch price update 3–6 s (median 5 s). The wall-clock outliers (15.6 s for a withdrawal, 20.2 s for one price update) come from public-RPC polling: the on-chain time of those runs stayed at 4–5 s. The plain single-batch price row is from earlier deployments, where the demo account was in the first batch.
- **Batches:** on the current deployment the demo account is the 13th the ClearingHouse tracks (after the 12 from `npm run crowd`), so its price-driven runs are re-checked in the second batch, after a relay through Unichain. Those runs are listed separately; their extra legs are in [`results/SUMMARY.md`](results/SUMMARY.md).

### Batched re-pricing on-chain

`npm run crowd` on the current deployment (run `crowd-1794848145700`): 12 accounts, more than one batch of 8, then one price move. Every account was re-checked, the second batch after a relay through Unichain:

| Leg | Transaction | What happened |
|---|---|---|
| Price $2,000 → $1,950, Base | [`0x210b…84c5`](https://sepolia.basescan.org/tx/0x210b94fd8c3589d01196a9bae8f249f62650c4ac1185014bfc6a0ee8d01d84c5) | `PriceUpdated` |
| Batch 1, Lasna | [`0x8b56…12be`](https://lasna.reactscan.net/tx/0x8b563aa13dd87f2b6c014dfe15df5b27269b5c563ebbe06fa0dbe11d711612be) | `RepriceBatch` accounts 0–7 inside the price's `react()`, relay requested |
| Relay, Unichain | [`0x58dd…0adb`](https://sepolia.uniscan.xyz/tx/0x58dd0a4bdb326658323ecc17426feb1e321abe2a8d2cf1829e48d37c2bd80adb) | `relayReprice` callback emits `RepriceRelayed(epoch 1)` |
| Batch 2, Lasna | [`0xe217…6891`](https://lasna.reactscan.net/tx/0xe217f7933d76203eddc416f2c5ac61de33c0dcb21f7d29f4309af6e7eb3f6891) | `RepriceBatch` accounts 8–11, reacting to the relay |

About 4 s from the price block to the last batch by block timestamps (7.1 s wall clock). The script's price reset to $2,000 ran a second full pass the same way.

**Why a relay and not a self-callback.** Reactive's docs describe a reactive contract calling back into itself (`chainId: block.chainid`, `recipient: address(this)`), and that was our first design. On Lasna we could not get such a callback delivered. A first ClearingHouse requested its continuation ([`0x4ff3…0945`](https://lasna.reactscan.net/tx/0x4ff390ebb1ecfbe771e488f3fcd119c544f82250ab4e41d5fe6df70606210945)) and it never arrived. A minimal [probe contract](contracts/src/probes/SelfCallbackProbe.sol) ([`scripts/probe-selfcallback.sh`](scripts/probe-selfcallback.sh)) then requested four self-callbacks at 150k, 300k, 500k and 700k gas ([`0x1a69…2bc8`](https://lasna.reactscan.net/tx/0x1a693307e4a8d6f335b8ba3fdb716f2d673ee7cda605cd7c929c589824fc2bc8)), plus one from an ordinary transaction. None was delivered and the probe had no debt, while the Unichain callbacks requested in the ClearingHouse's same transaction were delivered. So the ClearingHouse now hands the continuation to the CreditMarket and reacts to the event it emits: every hop is a path already proven on-chain, and the work stays inside `react()`.

## Deployed contracts

Current deployment (2026-11-16), **with auto-protection and relayed batch re-pricing**. All seven contracts are source-verified on Sourcify with an exact match (creation and runtime bytecode).

| Contract | Chain | Address | Source |
|---|---|---|---|
| ClearingHouse | Reactive Lasna (5318007) | [`0x32BCab0a9199008576ca99a357E3adc5Ea2541c3`](https://lasna.reactscan.net/address/0x32BCab0a9199008576ca99a357E3adc5Ea2541c3) | [verified](https://repo.sourcify.dev/5318007/0x32BCab0a9199008576ca99a357E3adc5Ea2541c3) |
| CollateralVault | Base Sepolia (84532) | [`0x958488C803513fA8DFa5CCebd54c6022a17ea1Af`](https://sepolia.basescan.org/address/0x958488C803513fA8DFa5CCebd54c6022a17ea1Af) | [verified](https://repo.sourcify.dev/84532/0x958488C803513fA8DFa5CCebd54c6022a17ea1Af) |
| MockPriceFeed | Base Sepolia (84532) | [`0x056920DCD8A133F9De75D25CcA68C3a0A143aF52`](https://sepolia.basescan.org/address/0x056920DCD8A133F9De75D25CcA68C3a0A143aF52) | [verified](https://repo.sourcify.dev/84532/0x056920DCD8A133F9De75D25CcA68C3a0A143aF52) |
| Test WETH | Base Sepolia (84532) | [`0x3A0882E6cD99a927c28146242f289e6b8933D4ED`](https://sepolia.basescan.org/address/0x3A0882E6cD99a927c28146242f289e6b8933D4ED) | [verified](https://repo.sourcify.dev/84532/0x3A0882E6cD99a927c28146242f289e6b8933D4ED) |
| CreditMarket | Unichain Sepolia (1301) | [`0x126b1c07bb1473770fCb6033A8C5169DF7385beB`](https://sepolia.uniscan.xyz/address/0x126b1c07bb1473770fCb6033A8C5169DF7385beB) | [verified](https://repo.sourcify.dev/1301/0x126b1c07bb1473770fCb6033A8C5169DF7385beB) |
| Test USDC | Unichain Sepolia (1301) | [`0xB14b46F29AC7F46c75E157f1477874c9B56291bc`](https://sepolia.uniscan.xyz/address/0xB14b46F29AC7F46c75E157f1477874c9B56291bc) | [verified](https://repo.sourcify.dev/1301/0xB14b46F29AC7F46c75E157f1477874c9B56291bc) |
| PriceController | Base Sepolia (84532) | [`0xE078278A72a17ecCE70bf86fAA94F8618f4a119b`](https://sepolia.basescan.org/address/0xE078278A72a17ecCE70bf86fAA94F8618f4a119b) | [verified](https://repo.sourcify.dev/84532/0xE078278A72a17ecCE70bf86fAA94F8618f4a119b) |

Earlier deployments are retired (their gas balances were returned with [`scripts/recover-funds.sh`](scripts/recover-funds.sh)), but their transactions stay on-chain and in `results/runs.jsonl`. The shield rescue at the top of this page ran on the 2026-11-14 deployment (ClearingHouse [`0xb523…bDC0`](https://lasna.reactscan.net/address/0xb52397CC590D8aB36cCEFffdEbcb9e87c27ebDC0)), whose flows are unchanged in the current code.

### Try it yourself

Anyone can move the test price, so you can watch Reactive settle a rescue or a liquidation with your own wallet:

1. In the [dashboard](#3-dashboard), connect a wallet and follow the checklist: get test WETH, deposit, borrow close to your limit, and add a shield.
2. In **Testnet stress tools**, press **Drop WETH 10%**. Within seconds the ClearingHouse orders the shield to repay part of your loan; the settlement tracker times each leg. **Drop WETH 25%** without a shield makes the account liquidatable instead.
3. Press **Reset** when you are done.

The price is shared, so a move affects every account. Each public move is limited to 30%, within $500–$5,000, once every 60 seconds and 10 times per UTC day. The limits exist because every move costs the ClearingHouse lREACT on Lasna: one reaction, plus a sync for every account whose limit changes; the owner can tighten them with `setLimits`.

**Tested from the dashboard with a browser wallet.** An ordinary wallet pressed **Drop WETH 10%** on a position borrowed at 620 USDC with a 100 USDC shield:

| Leg | Transaction | What it shows |
|---|---|---|
| Price move through the public controller, Base | [`0x9d75…97e1`](https://sepolia.basescan.org/tx/0x9d7549be323311fcc087eb22f5d7a7655e1664203c178e61c2257ccf924797e1) | `PriceMoved` $2,000 → $1,800 via `setPrice`, the same path any visitor uses |
| ClearingHouse reaction, Lasna | [`0x965f…8c4b`](https://lasna.reactscan.net/tx/0x965f049a44f99d329ac1b31ead751b2e9be33f09d17e637f9d6bfda051428c4b) | Reacts to that price transaction and orders protection |
| Shield repays, Unichain | [`0x5a5b…c7c4`](https://sepolia.uniscan.xyz/tx/0x5a5b8da94ddc2c3b52c53cb38dbea4b6b52781460c88a0c9055dbfc96a10c7c4) | `Protected`: 53 USDC repaid, debt 620 → 567 (the new limit), shield 100 → 47, not liquidatable |

The Base and Unichain blocks are about 2 s apart by their (whole-second) timestamps.

An earlier deployment without auto-protection (ClearingHouse [`0x27aa…8aC6`](https://lasna.reactscan.net/address/0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6)) ran the same flows; its runs stay in `results/runs.jsonl`.

## Full-loop transactions

From `npm run demo` on the current deployment (origin → Lasna → destination; run `demo-1794998516023`, full log in [`results/demo.log`](results/demo.log)). This account sits in the second re-pricing batch, so the price-driven rows include the relay through Unichain:

| Flow | Origin | Reactive (Lasna), relay | Destination |
|---|---|---|---|
| Deposit → credit | [Base `0x4cb2…a120`](https://sepolia.basescan.org/tx/0x4cb2be050b02925174de67e502ef23cf62ce8077740785bc62e33b4d0126a120) | [`0x82a4…51c8`](https://lasna.reactscan.net/tx/0x82a4473a86b9c5b800a6823090d5f19b9bad271e19e4cd46336cf87eb1da51c8) | [Unichain `0xc594…2cf9`](https://sepolia.uniscan.xyz/tx/0xc5949d67b6475a86d0604bf7bbc544c7db87bd517a31c55b9713391bf07e2cf9) |
| Withdraw: request → lower limit → debt snapshot → decide → release | [Base `0x8e5d…d771`](https://sepolia.basescan.org/tx/0x8e5df8bd13a219ba8e56235b6cb905fe4f4ed2fcacf87096421fe0d6a3d5d771) | [`0x06b3…e6c2`](https://lasna.reactscan.net/tx/0x06b3d49bfa1722237c9b59b0c7a9375e7739343684df6277aac3f60fac9de6c2), [Unichain `0x790e…362d`](https://sepolia.uniscan.xyz/tx/0x790e5b9457bdd618b9dd8a05614745b2a75de33e8ec08a5f275674ce61c8362d), [`0x30fe…21ce`](https://lasna.reactscan.net/tx/0x30fe8637009863d97eab4aadcbfeb71efb136e47c12dec44a014c02dc77321ce) | [Base `0x56b0…9acd`](https://sepolia.basescan.org/tx/0x56b0639d9cddd16ed2d969ca78832daba273a2f775db8fc614f0652f8c6b9acd) |
| Crash → liquidatable | [Base `0x009e…aede`](https://sepolia.basescan.org/tx/0x009e3824f5b9a8bec237d6e1e0fcde1f82f400f6d92adf393abcef875374aede) | batch 1 [`0xa0e6…237b`](https://lasna.reactscan.net/tx/0xa0e66e378cc6da2c7f665c912fac02641200422db7a3268c6f19688a4265237b), relay [Unichain `0x7ad3…50f7`](https://sepolia.uniscan.xyz/tx/0x7ad388fe4484557877c32c93b061220517bb0a16c883af8ccd4ff7bac8b250f7), batch 2 [`0x85a5…7d6e`](https://lasna.reactscan.net/tx/0x85a5b566768b720b5a6238efaa8f3ed71b6d05c38f130d0f75cf73a5cbd97d6e) | [Unichain `0x38fd…df83`](https://sepolia.uniscan.xyz/tx/0x38fd02738250d2ce2bcf65be821fb856b3db25a54573ed7941be85da4d7ddf83) |
| Liquidation → seizure | [Unichain `0xf706…5505`](https://sepolia.uniscan.xyz/tx/0xf70664c6315a7643172af366b0fab5cd7b23aa85f4a04cb604676f0c89e45505) | [`0xe1a2…a194`](https://lasna.reactscan.net/tx/0xe1a27c78bf7439ffef9e13e4e7f060ae7ea8f1f9e0232ffe2784564aba88a194) | [Base `0xd3d8…4e67`](https://sepolia.basescan.org/tx/0xd3d8660c6dd4c4bb1b7709fb7da9189e4a6cc395a2fdc56e118759e9efe04e67) |
| Crash → **shield repays** | [Base `0x7605…0419`](https://sepolia.basescan.org/tx/0x760593516f2dd55ea1e25e35f4ea955c13fc2b17df05f7bdfbf9fa12a9e10419) | batch 1 [`0x9b96…3671`](https://lasna.reactscan.net/tx/0x9b96640ba81badfc2cb74442fc5690235ba149053e0326184ffea97c1ef53671), relay [Unichain `0x630e…ab21`](https://sepolia.uniscan.xyz/tx/0x630e7c6778eebfbcf46cf31ce8f25cfac8ba817592ec3ff2fdb842d16a57ab21), batch 2 [`0x4bc2…c2ee`](https://lasna.reactscan.net/tx/0x4bc21304830435da87253febe5698fb6c1a3689d77496f9289772c4c0998c2ee) | [Unichain `0x6c24…a066`](https://sepolia.uniscan.xyz/tx/0x6c24347ef64813235c8dc297d00284405f2d19dce54c0fba76d06059c813a066) (126 USDC repaid, never liquidatable) |

The same flows on the 2026-11-14 deployment, where the demo account was in the first batch, are in run `demo-1794661726781` in [`results/runs.jsonl`](results/runs.jsonl).

## Run it on testnet

### 0. Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 20+
- A **testnet-only** wallet. Never use a key that holds real funds.

```bash
cp .env.example .env            # set PRIVATE_KEY; never commit .env (it is git-ignored)
export PATH="$HOME/.foundry/bin:$PATH"
set -a && source .env && set +a # load the RPC URLs and key into this shell for the cast commands below
```

**Funding.** You need ETH on Base Sepolia and Unichain Sepolia for gas, and lREACT on Lasna for the ClearingHouse:

- Get Sepolia ETH from a faucet (for example the Google Cloud Web3 faucet).
- Bridge some to Base Sepolia and Unichain Sepolia through their official L1 bridges (ETH sent to these Sepolia contracts arrives at the same address on the L2 within a few minutes):
  ```bash
  cast send 0xfd0Bf71F60660E2f608ed56e1659C450eB113120 --value 0.02ether --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY   # Base Sepolia
  cast send 0xea58fcA6849d79EAd1f26608855c2D6407d54Ce2 --value 0.02ether --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY   # Unichain Sepolia
  ```
- Turn Sepolia ETH into lREACT: `./scripts/faucet.sh 0.05ether` (1 ETH = 100 lREACT).

### 1. Deploy (3 chains, 7 steps)

```bash
VERIFY=1 ./scripts/deploy.sh    # deploys, writes deployments.json, then publishes source on Sourcify
./scripts/status.sh             # balances and debt of all three contracts; any debt > 0 pauses that contract
./scripts/fund.sh clearinghouse 2ether   # top up when needed (also: vault / market)
```

- `CH_ADDRESS=0x… ./scripts/deploy.sh` reuses an existing ClearingHouse, so a deploy that stopped halfway can resume without paying `CH_FUNDING` again. Transactions a lagging public RPC rejects as "nonce too low" are retried automatically, and `BASE_RPC=…` (or `UNICHAIN_RPC`, `LASNA_RPC`) on the command line switches endpoints for one run.
- `./scripts/recover-funds.sh lasna:0xCH… base:0xVault… unichain:0xMarket…` returns the gas balance of contracts you are retiring to the deployer, so a redeploy can reuse it.
- `./scripts/verify.sh` re-runs source verification on its own (Sourcify supports all three chains).
- `deploy.sh` finishes by deploying the testnet `PriceController` and handing it the oracle (`OPEN_PRICE=0` keeps the oracle owner-only). For an existing deployment run `./scripts/deploy-controller.sh`; the limits are set with `PC_MAX_MOVE_BPS`, `PC_COOLDOWN`, `PC_MOVES_PER_DAY`, `PC_MIN_PRICE` and `PC_MAX_PRICE`. The bots move the price through the controller's unthrottled `ownerSetPrice`, and `returnFeed(address)` takes the oracle back.
- `CH_FUNDING` and `CALLBACK_FUNDING` in `.env` set how much each contract starts with; values given on the command line win over `.env` (for example `CH_FUNDING=2.5ether CALLBACK_FUNDING=0.0002ether ./scripts/deploy.sh`). Leave room for gas: deploying the ClearingHouse costs about 0.23 lREACT at Lasna's 100 gwei on top of `CH_FUNDING`. Callbacks are cheap: across 25 demo runs the vault and market spent about 0.00001 ETH each.
- Reactive charges the ClearingHouse for every reaction, so keep an eye on `status.sh`.

### 2. Demo, benchmark, race test

```bash
cd bots && npm install
npm run demo                       # deposit → borrow → two-phase withdraw → crash → liquidation → (shield → crash → protected)
npm run bench -- --n 30 --flows deposit,withdraw,price,liquidation,protection
npm run race -- --n 30             # withdraw everything on Base and borrow everything on Unichain at the same instant
npm run crowd -- --n 12            # more accounts than one batch, one price move, every re-check batch recorded
npm run analyze                    # results/SUMMARY.md and dashboard/public/summary.json
```

Every flow records the tx hash and timing of each leg (origin chain → Lasna → destination chain) in `results/runs.jsonl`. The bots scan logs in windows of at most 150 blocks and retry lagging RPC nodes, because public endpoints cap `eth_getLogs` ranges (Base Sepolia: 200 blocks, at about 5 blocks per second).

### 3. Dashboard

```bash
cd dashboard && npm install && npm run dev      # http://localhost:5173
npm run build                                    # static site in dashboard/dist, deployable to any static host
```

The hosted copy at **[kartikmanral092006.github.io/Lien](https://kartikmanral092006.github.io/Lien/)** is built and deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push that touches the dashboard, the deployment or the results.

- **Get started:** a checklist (connect, get test WETH, deposit, borrow, add a shield) that ticks itself off from on-chain state.
- **Position:** a health dial with the liquidation threshold, your liquidation price, and a check that the ledger on Reactive agrees with Base and Unichain.
- **What if WETH moves:** drag the price and see what the ledger would decide: the new limit, whether the shield steps in and how much it repays, or whether the account becomes liquidatable. It mirrors the contracts' integer maths locally and sends nothing; accounts without debt start on a clearly labelled example loan.
- **Actions:** deposit, borrow, repay, withdraw and shield. Each shows your health *after* the action before you sign, and every transaction is simulated first so a revert is explained in plain words instead of failing in the wallet.
- **Settlement:** after each action the page follows it across chains (origin → ClearingHouse → callback, and the second loop for withdrawals) and times every leg live. A docked tracker keeps the timer on screen anywhere on the page and compares each leg with its measured median.
- **Activity, measured speed and testnet stress tools** (drop the shared test price 10% or 25% or reset it, with the cooldown and moves left shown; act as a liquidator), kept apart from borrower actions.
- **Command menu** (⌘K / Ctrl K): jump to any section, start any action, get test tokens, open a contract on its explorer.

Built with React, Tailwind CSS v4, Radix primitives, Motion, [Magic UI](https://magicui.design) components (MIT), React Three Fiber, RainbowKit + wagmi and TanStack Query. Keyboard accessible, respects reduced motion, works down to phone width (Lighthouse accessibility 100 on mobile and desktop). three.js loads only after the page is idle and only on desktops; phones get a still image of the scene. Browser wallets work out of the box; set `VITE_WALLETCONNECT_PROJECT_ID` (see `dashboard/.env.example`) to add mobile wallets.

## Limitations (stated plainly)

- **Trust:** the ClearingHouse on Reactive is the source of truth. If Reactive Network delivered wrong events, the ledger would be wrong. This is the same class of trust as any cross-chain messaging layer.
- **Price risk window:** between a price crash and the `sync` landing on Unichain, a user can still borrow against the old limit. The ledger flags the account as soon as that debt reaches it, and the LTV/LT gap (70% / 80%) is the buffer for the window. The results above measure how long it is.
- **L2 soft finality:** credit is granted when the deposit is seen on Base, before L1 finality. A reorg after that could void a deposit. A production version would bound credit by recent deposits or wait for batch posting.
- **Mock oracle and tokens**, no interest rates, owner-seeded lending liquidity. On testnet anyone can move the oracle within the controller's limits; a real deployment would use a price feed such as Chainlink.
- **Re-pricing in batches:** a price update re-checks the first 8 accounts inside `react()`. Each further 8 wait for one more relay round trip through Unichain (the measured 12-account pass, two batches, took about 4 s by block timestamps; a second-batch account's new limit lands in about 5 s, median of 24 runs), so the 100th account is re-checked noticeably later than the first. The ledger has no account cap, but very large account counts would need prioritising the riskiest accounts first. `continueReprice` is callable by anyone as a fallback if a relay is ever lost, because it only runs the next unprocessed batch of the current price, once; the worst a stranger can do is make that batch run sooner.
- Testnet only, unaudited.

## Repository

```
contracts/   Foundry: src (ClearingHouse, CollateralVault, CreditMarket, mocks, probes), test (flows, shield, fuzz, probe, Reactive simulator)
scripts/     deploy.sh, deploy-controller.sh, verify.sh, status.sh, fund.sh, faucet.sh, recover-funds.sh, probe-selfcallback.sh
bots/        TypeScript + viem: demo, bench, race, crowd, analyze, status
dashboard/   Vite + React dashboard (Tailwind, Motion, Magic UI, React Three Fiber, RainbowKit)
results/     runs.jsonl (raw), SUMMARY.md (percentiles), demo.log
docs/        PLAN.md
```

## License

MIT
