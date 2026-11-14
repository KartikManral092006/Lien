# Lien

**Collateral on Base. Credit on Unichain. One ledger on Reactive.**

[![ci](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml/badge.svg)](https://github.com/KartikManral092006/Lien/actions/workflows/test.yml)

Lien lets you deposit collateral on one chain and borrow on another with no bridge and no wrapped token. A reactive contract on Reactive Lasna is the cross-chain clearing house: the only place credit limits, withdrawals, liquidations and protection are decided. A two-phase commit keeps both chains consistent, and an optional **shield** repays a borrower's loan before anyone can liquidate it.

Built for the Reactive Omni Buildathon, track **Every Second Counts**.

---

## For judges: where each criterion is answered

| Criterion | Where to look |
|---|---|
| **Execution** | [Full-loop transactions](#full-loop-transactions): every flow's origin tx, the ClearingHouse reaction on Lasna, and the callback it triggered, with explorer links, including the [shield repaying a loan on-chain](#auto-protection-the-shield). All six [deployed contracts](#deployed-contracts) are source-verified on Sourcify. Raw per-leg timings for every run are in [`results/runs.jsonl`](results/runs.jsonl). |
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
| Deposit → credit on Unichain | 6 | 6.3 s | 7.6 s |
| Two-phase withdrawal (2 loops) | 10 | 9.4 s | 11.5 s |
| Price drop → new limit on Unichain | 13 | 6.9 s | 8.2 s |
| Liquidation → seizure on Base | 2 | 6.6 s | 8.4 s |
| Price drop → shield repays on Unichain | 1 | 6.7 s | 6.7 s |

These are small samples from demo runs on both deployments (before and after auto-protection; the loop logic is the same), not yet the planned 30-run benchmark. Each total includes the origin transaction's own confirmation (about 2 s) and public-RPC polling.

## Deployed contracts

Current deployment, **with auto-protection**. All six contracts are source-verified on Sourcify with an exact match (creation and runtime bytecode):

| Contract | Chain | Address | Source |
|---|---|---|---|
| ClearingHouse | Reactive Lasna (5318007) | [`0xb52397CC590D8aB36cCEFffdEbcb9e87c27ebDC0`](https://lasna.reactscan.net/address/0xb52397CC590D8aB36cCEFffdEbcb9e87c27ebDC0) | [verified](https://repo.sourcify.dev/5318007/0xb52397CC590D8aB36cCEFffdEbcb9e87c27ebDC0) |
| CollateralVault | Base Sepolia (84532) | [`0x841203412954a70A7ac2888D31d12a6b97b1369A`](https://sepolia.basescan.org/address/0x841203412954a70A7ac2888D31d12a6b97b1369A) | [verified](https://repo.sourcify.dev/84532/0x841203412954a70A7ac2888D31d12a6b97b1369A) |
| MockPriceFeed | Base Sepolia (84532) | [`0x34f608cC436Ec16cf236356c0Bd7786809ea1B75`](https://sepolia.basescan.org/address/0x34f608cC436Ec16cf236356c0Bd7786809ea1B75) | [verified](https://repo.sourcify.dev/84532/0x34f608cC436Ec16cf236356c0Bd7786809ea1B75) |
| Test WETH | Base Sepolia (84532) | [`0x7730D3E461C845ec47fe0f6f0b8a44efCEB5e8aa`](https://sepolia.basescan.org/address/0x7730D3E461C845ec47fe0f6f0b8a44efCEB5e8aa) | [verified](https://repo.sourcify.dev/84532/0x7730D3E461C845ec47fe0f6f0b8a44efCEB5e8aa) |
| CreditMarket | Unichain Sepolia (1301) | [`0x2C2a8a207D76362EB86c67e3a4b6f5CC556C5ea6`](https://sepolia.uniscan.xyz/address/0x2C2a8a207D76362EB86c67e3a4b6f5CC556C5ea6) | [verified](https://repo.sourcify.dev/1301/0x2C2a8a207D76362EB86c67e3a4b6f5CC556C5ea6) |
| Test USDC | Unichain Sepolia (1301) | [`0x1dc61edE33987cfB9C1CBc50355F4CE4c07544c4`](https://sepolia.uniscan.xyz/address/0x1dc61edE33987cfB9C1CBc50355F4CE4c07544c4) | [verified](https://repo.sourcify.dev/1301/0x1dc61edE33987cfB9C1CBc50355F4CE4c07544c4) |

An earlier deployment without auto-protection (ClearingHouse [`0x27aa…8aC6`](https://lasna.reactscan.net/address/0x27aaCFF011Eb4c6b1CC73c9C250C317bBaAA8aC6)) ran the same flows; its runs stay in `results/runs.jsonl`.

## Full-loop transactions

From `npm run demo` on the current deployment (origin → Lasna → destination; run `demo-1794661726781`, full log in [`results/demo.log`](results/demo.log)):

| Flow | Origin | Reactive (Lasna) | Destination |
|---|---|---|---|
| Deposit → credit | [Base `0x90c6…cff5`](https://sepolia.basescan.org/tx/0x90c62c60f523f905e8815008e86f03a127046bd5f5c538a3c1bedf85230ecff5) | [`0xc388…d926`](https://lasna.reactscan.net/tx/0xc38894a2f9c2108b104044cd48904829fb7a76351dcf3107bbfcccebf260d926) | [Unichain `0xd56e…90b6`](https://sepolia.uniscan.xyz/tx/0xd56e04e93839f83baa5f38a559f92eca08198c5aa0b26a0c54d53c67393690b6) |
| Withdraw: request → lower limit → debt snapshot → decide → release | [Base `0x163f…12de`](https://sepolia.basescan.org/tx/0x163f51cb6ab54f3bff4243d586433bd196c9d05fef95bef2b682227829ed12de) | [`0x1a98…66e2`](https://lasna.reactscan.net/tx/0x1a98337be0275399a493de488409c5b84cf6b6d34063c3d4bfc21106709e66e2), [Unichain `0x1047…69ed`](https://sepolia.uniscan.xyz/tx/0x10474ea53261373523085ea9f0db2d201a8c19f60d7d5fd4180f5edcc07769ed), [`0x348e…831e`](https://lasna.reactscan.net/tx/0x348e5199d1afd3419783216f04886d6195a54515fc03beb68f17ee41a58e831e) | [Base `0xf567…7887`](https://sepolia.basescan.org/tx/0xf567c8061527102fc8d4ab048d28da6ccf1b729c78b0e4d6cd5550a9662b7887) |
| Crash → liquidatable | [Base `0xe552…0f27`](https://sepolia.basescan.org/tx/0xe552cc56ae7d16cf60057485804e4a9f00d2b5a27bf9ea98d3aa630a634f0827) | [`0x8cf2…937e`](https://lasna.reactscan.net/tx/0x8cf2433fe31310cd50d530a7020b2c2faa444c5c9fd375848e516e84f061937e) | [Unichain `0x2f95…fa23`](https://sepolia.uniscan.xyz/tx/0x2f9533ad7141caf2a88072d77acbf17ad074b88e6411ab3b6277c8a3434dfa23) |
| Liquidation → seizure | [Unichain `0xc57f…2161`](https://sepolia.uniscan.xyz/tx/0xc57f8b25e77d9ad16a1e50a03568e6a1acd95dfe62ff51cde27b73b6e4de2161) | [`0x9501…3302`](https://lasna.reactscan.net/tx/0x9501bb9343cb5c21c0b89ec23b4a78e4782c8857e1eb7efab00f98bfbc133302) | [Base `0x1977…6a88`](https://sepolia.basescan.org/tx/0x19777ad1bb6e67d23655cb8cdd379c908463401fb29875e4c9afa453d8606a88) |
| Crash → **shield repays** | [Base `0x586a…cac6`](https://sepolia.basescan.org/tx/0x586abb3de771d4d05317f188df19c584745a4bd8cb274ee1dc5f3292abf4cac6) | [`0xd382…b553`](https://lasna.reactscan.net/tx/0xd382d6019a2262b45487208a5f8f0b0e6c9b66b641002d983cbbb263a14bb553) | [Unichain `0xd315…2f89`](https://sepolia.uniscan.xyz/tx/0xd3150162d243d59f8b892e3971405e1d96ed2db908e6464db11a2f9e15e72f89) |

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
- `CH_FUNDING` and `CALLBACK_FUNDING` in `.env` set how much each contract starts with; values given on the command line win over `.env` (for example `CH_FUNDING=2.5ether CALLBACK_FUNDING=0.0002ether ./scripts/deploy.sh`). Leave room for gas: deploying the ClearingHouse costs about 0.23 lREACT at Lasna's 100 gwei on top of `CH_FUNDING`. Callbacks are cheap: across 25 demo runs the vault and market spent about 0.00001 ETH each.
- Reactive charges the ClearingHouse for every reaction, so keep an eye on `status.sh`.

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

- **Get started:** a checklist (connect, get test WETH, deposit, borrow, add a shield) that ticks itself off from on-chain state.
- **Position:** a health dial with the liquidation threshold, your liquidation price, and a check that the ledger on Reactive agrees with Base and Unichain.
- **What if WETH moves:** drag the price and see what the ledger would decide: the new limit, whether the shield steps in and how much it repays, or whether the account becomes liquidatable. It mirrors the contracts' integer maths locally and sends nothing; accounts without debt start on a clearly labelled example loan.
- **Actions:** deposit, borrow, repay, withdraw and shield. Each shows your health *after* the action before you sign, and every transaction is simulated first so a revert is explained in plain words instead of failing in the wallet.
- **Settlement:** after each action the page follows it across chains (origin → ClearingHouse → callback, and the second loop for withdrawals) and times every leg live. A docked tracker keeps the timer on screen anywhere on the page and compares each leg with its measured median.
- **Activity, measured speed and testnet stress tools** (move the test oracle, act as a liquidator), kept apart from borrower actions.
- **Command menu** (⌘K / Ctrl K): jump to any section, start any action, get test tokens, open a contract on its explorer.

Built with React, Tailwind CSS v4, Radix primitives, Motion, [Magic UI](https://magicui.design) components (MIT), React Three Fiber, RainbowKit + wagmi and TanStack Query. Keyboard accessible, respects reduced motion, works down to phone width (Lighthouse accessibility 100 on mobile and desktop). three.js loads only after the page is idle and only on desktops; phones get a still image of the scene. Browser wallets work out of the box; set `VITE_WALLETCONNECT_PROJECT_ID` (see `dashboard/.env.example`) to add mobile wallets.

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
