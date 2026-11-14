# Lien

**Collateral on Base. Credit on Unichain. One ledger on Reactive.**

Lien lets you deposit collateral on one chain and borrow on another with no bridge and no wrapped token. A Reactive contract on Lasna acts as the cross-chain clearing house. It is the only place credit limits, withdrawals and seizures are decided, and it keeps both chains consistent with a two-phase commit.

Built for the Reactive Omni Buildathon, track **Every Second Counts**.

---

## Why

If your ETH is on Base and you need stablecoins on Unichain, today you either bridge the collateral (slow, bridge risk, wrapped-token risk), sell it, or open separate positions on each chain that get liquidated separately. Lien keeps the collateral where it is and moves only the *credit*.

The interesting part is not the lending, it is the coordination. Two chains that never talk to each other must agree on one number per user, and the gap between a price move and a reaction on the other chain is the protocol's risk window. Omni's ~1 s blocks make that window small enough to build on.

## Architecture

```
 Base Sepolia (84532)                 Reactive Lasna (5318007)                 Unichain Sepolia (1301)
┌──────────────────────────┐         ┌───────────────────────────────┐        ┌──────────────────────────┐
│ CollateralVault          │─events─▶│ ClearingHouse                 │◀─events─│ CreditMarket             │
│  deposit                 │         │  ledger: collateral, pending, │        │  borrow / repay          │
│  requestWithdraw         │         │          debt, limit, seq     │        │  liquidate               │
│  cancelWithdraw          │         │  risk: LTV 70%, LT 80%,       │        │                          │
│  settleWithdraw  ◀─cb────│─────────│        bonus 5%               │──cb───▶│  sync(limit, flag, seq)  │
│  seize           ◀─cb────│         │                               │        │                          │
├──────────────────────────┤         └───────────────────────────────┘        └──────────────────────────┘
│ MockPriceFeed  ──events──┼──────▶ (price)
└──────────────────────────┘
```

| Contract | Chain | Role |
|---|---|---|
| [`ClearingHouse`](contracts/src/ClearingHouse.sol) | Lasna | `AbstractReactive`. Subscribes to 8 event types on two chains, keeps the ledger, sends every callback |
| [`CollateralVault`](contracts/src/CollateralVault.sol) | Base Sepolia | `AbstractCallback`. Holds collateral; only the ClearingHouse can release or seize it |
| [`CreditMarket`](contracts/src/CreditMarket.sol) | Unichain Sepolia | `AbstractCallback`. Lends against limits the ClearingHouse sets |
| [`MockPriceFeed`](contracts/src/mocks/MockPriceFeed.sol) | Base Sepolia | Owner-set price so the demo can crash it on demand |

Callbacks use the Omni API (`SYSTEM.requestCallbackV_1_0`) and every callback function checks both `onlyServiceProvider` (caller is the callback proxy) and `onlyCallbackSender` (the injected sender is our ClearingHouse).

## The five flows

| Flow | Loops | What happens |
|---|---|---|
| **Deposit → credit** | 1 | `Deposited` on Base → ClearingHouse computes `limit = value × LTV` → `sync` on Unichain |
| **Borrow / repay** | 0 | Local on Unichain, bounded by the synced limit; `DebtUpdated` mirrors debt into the ledger |
| **Withdraw** | 2 | Two-phase commit, see below |
| **Price drop → liquidatable** | 1 | `PriceUpdated` on Base → ClearingHouse re-prices every account → `sync(liquidatable=true)` |
| **Cross-chain liquidation** | 1 | Liquidator repays on Unichain → `Liquidated` → ClearingHouse → `seize` on Base pays the liquidator in collateral. Nobody bridges |

### Two-phase withdrawal (why the protocol cannot be drained by racing it)

1. `WithdrawRequested` on Base. The vault marks the amount *pending*; nothing leaves yet.
2. ClearingHouse lowers the user's credit limit on Unichain to what the remaining collateral supports and tags the sync with the request id.
3. The market applies the lower limit and emits `LimitApplied(..., debt)`: **the exact debt at the moment the limit dropped**.
4. ClearingHouse releases the collateral only if that debt fits under the new limit; otherwise it rejects and restores the limit.

Any borrow the user fires during the window lands either before step 3 (so it is included in the debt snapshot, and the withdrawal is rejected) or after it (so it is bounded by the lower limit). There is no ordering in which both succeed beyond the collateral. Stale or reordered callbacks are dropped by a per-user sequence number, settlements are idempotent per request/liquidation id, and a user can always cancel a pending withdrawal.

## Tests

```bash
cd contracts
forge test -vv
```

**22 tests, all passing** (20 flow tests + 2 fuzz tests × 256 runs each). `forge fmt --check` and `forge lint` are clean, and CI runs all four on every push.

The test harness simulates the Reactive Network in Foundry: a mock system contract is etched at `0x8888…8888`, events from the vault, feed and market are queued per chain, and callbacks are delivered with the sender injection the real proxies perform.

- **`LienFlows.t.sol`**: every flow, the race window, liquidation maths (repay 700 USDC at $1,600 with a 5 % bonus = 0.459375 WETH), auth on every callback, stale syncs, duplicate seizures, cancel-then-late-release, user cap, and a gas check: a price update that re-syncs all 8 users costs about 309k gas in `react()`, about a third of Reactive's 900k cap (measured against the mock system contract, so treat it as an estimate).
- **`LienFuzz.t.sol`**: three actors make random deposits, borrows, repays, withdrawals and cancels while events and callbacks are delivered in **random order and at random times**. After every step it asserts `debt ≤ collateral × price × LTV` for every user, and after full settlement that no withdrawal is stuck and no limit exceeds collateral. A second fuzz delivers all callbacks in reverse order.

## Run it on testnet

### 0. Prerequisites
- [Foundry](https://book.getfoundry.sh/getting-started/installation), Node 20+
- A **testnet-only** wallet with Sepolia ETH, Base Sepolia ETH and Unichain Sepolia ETH

```bash
cp .env.example .env            # fill PRIVATE_KEY and RPCs; never commit .env
./scripts/faucet.sh 0.5ether    # Sepolia ETH -> 50 lREACT on Lasna (1 ETH = 100 lREACT, max 5 ETH per tx)
```

### 1. Deploy everything (3 chains, 7 steps)
```bash
./scripts/deploy.sh             # writes deployments.json and dashboard/public/deployments.json
./scripts/status.sh             # balances and debt of all three contracts; any debt > 0 pauses that contract
./scripts/fund.sh clearinghouse 2ether   # top up when needed (also: vault / market)
```

### 2. Demo, benchmark, race attack
```bash
cd bots && npm install
npm run demo                       # deposit → borrow → two-phase withdraw → crash → cross-chain liquidation
npm run bench -- --n 30 --flows deposit,withdraw,price,liquidation
npm run race -- --n 30             # withdraw everything on Base + borrow everything on Unichain at the same instant
npm run analyze                    # results/SUMMARY.md + dashboard/public/summary.json
```

Every flow records the tx hash and timing of each leg (origin chain → Lasna → destination chain) in `results/runs.jsonl`.

### 3. Dashboard
```bash
cd dashboard && npm install && npm run dev
```
Unified position across the three chains, buttons for every action (including *Crash price −25%* and *Liquidate*), a live cross-chain timeline with explorer links, and the measured latency table.

## Deployed contracts

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

## Results

Fill in from `results/SUMMARY.md`. Report n and percentiles, never a single best run.

## Limitations (stated plainly)

- **Trust**: the ClearingHouse on Reactive is the source of truth. If Reactive Network delivered wrong events, the ledger would be wrong. This is the same class of trust as any cross-chain messaging layer.
- **Price risk window**: between a price crash and the `sync` landing on Unichain a user can still borrow against the old limit. The LTV/LT gap (70 % / 80 %) is the buffer for that window; the benchmark measures how long it actually is.
- **L2 soft finality**: credit is granted when the deposit is seen on Base, before L1 finality. A reorg after that could void a deposit. A production version would bound credit by recent deposits or wait for batch posting.
- **Mock oracle and tokens**, no interest rates, owner-seeded lending liquidity.
- **User cap**: at most 8 tracked users, because one price update re-checks every account inside a single reactive transaction (900k gas cap). Batching with self-callbacks would lift this.
- Testnet only, unaudited.

## Repository

```
contracts/   Foundry: src (ClearingHouse, CollateralVault, CreditMarket, mocks), test (flows + fuzz + Reactive simulator)
scripts/     deploy.sh, status.sh, fund.sh, faucet.sh
bots/        TypeScript + viem: demo, bench, race, analyze, status
dashboard/   Vite + React + viem live dashboard
results/     runs.jsonl (raw) and SUMMARY.md (percentiles)
docs/        PLAN.md
```

## License

MIT
