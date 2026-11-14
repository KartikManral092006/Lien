# Lien

**Collateral on Base. Credit on Unichain. One ledger on Reactive.**

[![ci](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml/badge.svg)](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml)

Lien lets you deposit collateral on one chain and borrow on another with no bridge and no wrapped token. A reactive contract on Reactive Lasna is the cross-chain clearing house: the only place credit limits, withdrawals, liquidations and protection are decided. A two-phase commit keeps both chains consistent, and an optional **shield** repays a borrower's loan before anyone can liquidate it.

Built for the Reactive Omni Buildathon, track **Every Second Counts**.

---

## For judges: where each criterion is answered

| Criterion | Where to look |
|---|---|
| **Execution** | [Full-loop transactions](#full-loop-transactions): every flow's origin tx, the ClearingHouse reaction on Lasna, and the callback it triggered, with explorer links. Raw per-leg timings for every run are in [`results/runs.jsonl`](results/runs.jsonl). |
| **Integration** | [What the reactive contract decides](#what-the-reactive-contract-decides). It is the protocol, not a notifier: remove it and no limit, withdrawal, seizure or protection can happen. |
| **Usefulness** | [Why](#why) and [Auto-protection](#auto-protection-the-shield). |
| **Craft** | [Tests](#tests) (37, including fuzzing with randomly ordered cross-chain delivery), CI on every push, a scripted [demo](#2-demo-benchmark-race-test), a live [dashboard](#3-dashboard), and [run-it-yourself steps](#run-it-on-testnet). |

## Why

If your ETH is on Base and you need stablecoins on Unichain, today you bridge the collateral (slow, bridge risk, wrapped-token risk), sell it, or open separate positions on each chain that are liquidated separately. Lien keeps the collateral where it is and moves only the *credit*.

The hard part is coordination. Two chains that never talk to each other must agree on one number per user, and the gap between a price move and the reaction on the other chain is the protocol's risk window. That is why this is an *Every Second Counts* entry: every second of loop latency is a second in which a borrower can fall further below water, or a shield can arrive too late.

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
| [`ClearingHouse`](contracts/src/ClearingHouse.sol) | Lasna | `AbstractReactive`. Subscribes to 9 event types on two chains, keeps the ledger, sends every callback |
| [`CollateralVault`](contracts/src/CollateralVault.sol) | Base Sepolia | `AbstractCallback`. Holds collateral; only the ClearingHouse can release or seize it |
| [`CreditMarket`](contracts/src/CreditMarket.sol) | Unichain Sepolia | `AbstractCallback`. Lends against limits the ClearingHouse sets; holds shields |
| [`MockPriceFeed`](contracts/src/mocks/MockPriceFeed.sol) | Base Sepolia | Owner-set price so the demo can crash it on demand |

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
| **Price drop → liquidatable** | 1 | `PriceUpdated` on Base → ClearingHouse re-prices every account → `sync(liquidatable = true)` |
| **Price drop → shield repays** | 1 | Same price event; for a user past the 75% trigger with a shield, the same `sync` repays debt from the shield instead of flagging the account |
| **Cross-chain liquidation** | 1 | Liquidator repays on Unichain → `Liquidated` → ClearingHouse → `seize` on Base pays the liquidator in collateral. Nobody bridges |

### Two-phase withdrawal (why the protocol cannot be drained by racing it)

1. `WithdrawRequested` on Base. The vault marks the amount *pending*; nothing leaves yet.
2. ClearingHouse lowers the user's credit limit on Unichain to what the remaining collateral supports and tags the sync with the request id.
3. The market applies the lower limit and emits `LimitApplied(..., debt)`: **the exact debt at the moment the limit dropped**.
4. ClearingHouse releases the collateral only if that debt fits under the new limit; otherwise it rejects and restores the limit.

Any borrow the user fires during the window lands either before step 3 (so it is included in the debt snapshot, and the withdrawal is rejected) or after it (so it is bounded by the lower limit). There is no ordering in which both succeed beyond the collateral. Stale or reordered callbacks are dropped by a per-user sequence number, settlements are idempotent per request and liquidation id, and a user can always cancel a pending withdrawal.

### Auto-protection (the shield)

A borrower can set aside USDC on Unichain (`fundShield`). Shield money is never lent to others.

When a price update pushes a user's debt above **75%** of their collateral value (above the 70% borrow limit, below the 80% liquidation threshold), the ClearingHouse adds `protect = true` to its normal `sync`. The market then repays the debt above the new limit **from the shield, in the same call that would otherwise set the liquidation flag**.

- **No liquidator can act first.** The flag that allows a liquidation and the protection that prevents it travel in the same callback.
- **Safe under duplicates and reordering.** The market repays *down to the limit*, never a fixed amount, so a repeated or late callback spends nothing extra.
- **Conservative when short.** If the shield cannot cover the gap, the account is still flagged.

> **Status:** auto-protection is in this repository and fully tested, but the contracts deployed below are the earlier version without it. It goes on-chain with the next deployment; until then the demo and dashboard detect its absence and skip it.

## Tests

```bash
cd contracts
forge test -vv
```

**37 tests, all passing**: 20 flow tests, 14 protection tests and 3 fuzz tests (256 runs each in CI). `forge fmt --check`, `forge build`, `forge lint src` and `forge test` run in CI on every push, alongside a type-check of the bots and a production build of the dashboard.

The harness simulates the Reactive Network in Foundry: a mock system contract is etched at `0x8888…8888`, events from the vault, feed and market are queued per chain, and callbacks are delivered with the sender injection the real proxies perform.

- **[`LienFlows.t.sol`](contracts/test/LienFlows.t.sol)**: every flow, the race window, liquidation maths (repay 700 USDC at $1,600 with a 5% bonus = 0.459375 WETH), auth on every callback, stale syncs, duplicate seizures, cancel-then-late-release, the user cap, and a gas check: a price update that re-syncs all 8 users costs about 335k gas in `react()`, well under Reactive's 900k cap (measured against the mock system contract, so treat it as an estimate).
- **[`LienShield.t.sol`](contracts/test/LienShield.t.sol)**: protection instead of liquidation, no window between flag and protection, partial shields, protection before the liquidation threshold, small moves leaving the shield untouched, rescuing an already-flagged account, duplicate and reordered protections, a shield withdrawn mid-flight, shields never lent out, and protecting all 8 users in one crash (about 376k gas).
- **[`LienFuzz.t.sol`](contracts/test/LienFuzz.t.sol)**: three actors act randomly while events and callbacks are delivered in **random order and at random times**. One fuzz asserts `debt ≤ collateral × price × LTV` after every step; one delivers every callback in reverse order; one adds price moves, shields and liquidations and asserts that after settlement no account is left past the trigger with unused shield money and the liquidation flag always matches health.

Writing the protection fuzz also exposed a gap in the original ClearingHouse: it re-checked an account on a debt change only if the account was already flagged, so a borrow made against a stale limit right after a crash left an unhealthy account unflagged until the next price update. It now re-evaluates on every debt change (`test_borrowAgainstStaleLimitIsFlagged` fails on the old code).

## Results

Live testnet runs, measured from the first transaction to the final callback (`npm run analyze`, see [`results/SUMMARY.md`](results/SUMMARY.md)):

| Flow | Runs | Median | p95 |
|---|---|---|---|
| Deposit → credit on Unichain | 5 | 6.4 s | 7.6 s |
| Two-phase withdrawal (2 loops) | 9 | 9.4 s | 11.5 s |
| Price drop → new limit on Unichain | 10 | 6.7 s | 8.2 s |
| Liquidation → seizure on Base | 1 | 8.4 s | 8.4 s |

These are small samples from demo runs, not yet the planned 30-run benchmark. Each total includes the origin transaction's own confirmation (about 2 s) and public-RPC polling.

## Deployed contracts

Current deployment (the version **before** auto-protection):

| Contract | Chain | Address |
|---|---|---|
| ClearingHouse | Reactive Lasna (5318007) | [`0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6`](https://lasna.reactscan.net/address/0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6) |
| CollateralVault | Base Sepolia (84532) | [`0x7791bd27ea7640e10Eb66196B09f297a0746908b`](https://sepolia.basescan.org/address/0x7791bd27ea7640e10Eb66196B09f297a0746908b) |
| MockPriceFeed | Base Sepolia (84532) | [`0xCC0d36E8f458b880ee0678d216AD45183962265E`](https://sepolia.basescan.org/address/0xCC0d36E8f458b880ee0678d216AD45183962265E) |
| Test WETH | Base Sepolia (84532) | [`0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6`](https://sepolia.basescan.org/address/0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6) |
| CreditMarket | Unichain Sepolia (1301) | [`0xCC0d36E8f458b880ee0678d216AD45183962265E`](https://sepolia.uniscan.xyz/address/0xCC0d36E8f458b880ee0678d216AD45183962265E) |
| Test USDC | Unichain Sepolia (1301) | [`0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6`](https://sepolia.uniscan.xyz/address/0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6) |

Some addresses repeat across chains on purpose: the deployer was a fresh account on every chain, and a `CREATE` address depends only on deployer and nonce. They are different contracts on different chains.

## Full-loop transactions

From the first `npm run demo` on testnet (origin → Lasna → destination):

| Flow | Origin | Reactive (Lasna) | Destination |
|---|---|---|---|
| Deposit → credit | [Base `0xf456…dae8`](https://sepolia.basescan.org/tx/0xf456754e59380bf813b32856684bac089d85b8e2032a032cde8138b6a5c6dae8) | [`0x4395…d7df`](https://lasna.reactscan.net/tx/0x4395f2c5dec39eb8ad9c75a0604fd23b9b7baf28ea6a8e3a91edf86ee9bcd7df) | [Unichain `0xad68…7d06`](https://sepolia.uniscan.xyz/tx/0xad68f00b352fbfff481439359490a000995b64246e58b885ef61a624e6227d06) |
| Withdraw: request → lower limit → debt snapshot → decide → release | [Base `0x0121…2a67`](https://sepolia.basescan.org/tx/0x0121d7cc0e9ac191a929f6e42533f544656a54a88559cc4de337f8e67de62a67) | [`0x5fe1…decc`](https://lasna.reactscan.net/tx/0x5fe1aa0df6cefd1c3d7da687fcc1b1308156909682d2c31c25949c4cd141decc), [Unichain `0x96b1…3630`](https://sepolia.uniscan.xyz/tx/0x96b16dc616946c04e530e401ade83cc0869756607248164e740aece794383630), [`0xb747…3255`](https://lasna.reactscan.net/tx/0xb7471a2bb641d8b5e644992ebfeb4894f0a2869801aaa034d07c8b737cae3255) | [Base `0x8035…b454`](https://sepolia.basescan.org/tx/0x8035928b9fc03fa840e1080be742f7911c09f3b5d9366a33987e9b687d9bb454) |
| Crash → liquidatable | [Base `0x89fb…b2d0`](https://sepolia.basescan.org/tx/0x89fbdd39bd587db6589535908aac770bca98461da9b4c0b21ba049498bead2b0) | [`0x0cf7…f01b`](https://lasna.reactscan.net/tx/0x0cf7cc19e29a66c9f2dfa6e8874fe79a1cad234fd31a27d7f8667154678bf01b) | [Unichain `0xbf3d…c5c6`](https://sepolia.uniscan.xyz/tx/0xbf3da0707b1d196336e75c547ffaa99c98421104b1c5182d48ce471fb1e6b0c5) |
| Liquidation → seizure | [Unichain `0xdbf9…0688`](https://sepolia.uniscan.xyz/tx/0xdbf993dbd461a23a7002e16a84ca40c38cf8553939cf0ddd63ee469b24360688) | [`0xbc4c…3be9`](https://lasna.reactscan.net/tx/0xbc4c39f5a5a664ebeba134a45aa544bac8bc8c8cd4c419c09154f297243c3be9) | [Base `0x0939…d862`](https://sepolia.basescan.org/tx/0x0939bfbc57881d3daf4f634273f24ba4bebb55a053ed6614e2a9000431a1d862) |

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

- `CH_ADDRESS=0x… ./scripts/deploy.sh` reuses an existing ClearingHouse, so a deploy that stopped halfway can resume without paying `CH_FUNDING` again.
- `./scripts/verify.sh` re-runs source verification on its own (Sourcify supports all three chains).
- `CH_FUNDING` and `CALLBACK_FUNDING` in `.env` set how much each contract starts with. Reactive charges the ClearingHouse for every reaction, so keep an eye on `status.sh`.

### 2. Demo, benchmark, race test

```bash
cd bots && npm install
npm run demo                       # deposit → borrow → two-phase withdraw → crash → liquidation → (shield → crash → protected)
npm run bench -- --n 30 --flows deposit,withdraw,price,liquidation,protection
npm run race -- --n 30             # withdraw everything on Base and borrow everything on Unichain at the same instant
npm run analyze                    # results/SUMMARY.md and dashboard/public/summary.json
```

Every flow records the tx hash and timing of each leg (origin chain → Lasna → destination chain) in `results/runs.jsonl`. The bots scan logs in windows of at most 150 blocks and retry lagging RPC nodes, because public endpoints cap `eth_getLogs` ranges (Base Sepolia: 200 blocks, at about 5 blocks per second).

### 3. Dashboard

```bash
cd dashboard && npm install && npm run dev      # http://localhost:5173
npm run build                                    # static site in dashboard/dist, deployable to any static host
```

- **Position:** a health dial with the liquidation threshold, your liquidation price, and a check that the ledger on Reactive agrees with Base and Unichain.
- **Actions:** deposit, borrow, repay, withdraw and (on upgraded contracts) shield. Each shows your health *after* the action before you sign, and every transaction is simulated first so a revert is explained in plain words instead of failing in the wallet.
- **Settlement:** after each action the page follows it across chains (origin → ClearingHouse → callback, and the second loop for withdrawals) and times every leg live.
- **Activity, measured speed and testnet stress tools** (move the test oracle, act as a liquidator), kept apart from borrower actions.

Built with React, Tailwind CSS v4, Radix primitives, Motion, [Magic UI](https://magicui.design) components (MIT), React Three Fiber, RainbowKit + wagmi and TanStack Query. Keyboard accessible, respects reduced motion, works down to phone width. Browser wallets work out of the box; set `VITE_WALLETCONNECT_PROJECT_ID` (see `dashboard/.env.example`) to add mobile wallets.

## Limitations (stated plainly)

- **Trust:** the ClearingHouse on Reactive is the source of truth. If Reactive Network delivered wrong events, the ledger would be wrong. This is the same class of trust as any cross-chain messaging layer.
- **Price risk window:** between a price crash and the `sync` landing on Unichain, a user can still borrow against the old limit. The ledger flags the account as soon as that debt reaches it, and the LTV/LT gap (70% / 80%) is the buffer for the window. The results above measure how long it is.
- **L2 soft finality:** credit is granted when the deposit is seen on Base, before L1 finality. A reorg after that could void a deposit. A production version would bound credit by recent deposits or wait for batch posting.
- **Mock oracle and tokens**, no interest rates, owner-seeded lending liquidity.
- **User cap:** at most 8 tracked users, because one price update re-checks every account inside a single reactive transaction (900k gas cap). Batching with self-callbacks would lift this.
- Testnet only, unaudited.

## Repository

```
contracts/   Foundry: src (ClearingHouse, CollateralVault, CreditMarket, mocks), test (flows, shield, fuzz, Reactive simulator)
scripts/     deploy.sh, verify.sh, status.sh, fund.sh, faucet.sh
bots/        TypeScript + viem: demo, bench, race, analyze, status
dashboard/   Vite + React dashboard (Tailwind, Motion, Magic UI, React Three Fiber, RainbowKit)
results/     runs.jsonl (raw), SUMMARY.md (percentiles), demo.log
docs/        PLAN.md
```

## License

MIT
