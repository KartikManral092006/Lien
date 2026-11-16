/**
 * Proves on testnet that there is no account cap: brings the ClearingHouse past one batch of accounts,
 * moves the price once, and records every batch of the re-check, including the follow-up batches that run
 * in fresh reactions, each triggered by a relay through the CreditMarket on Unichain.
 *
 *   npm run crowd                # 12 extra accounts (plus the deployer's, if it has a position): more than one batch of 8
 *   npm run crowd -- --n 20
 *
 * The extra accounts are derived from PRIVATE_KEY (testnet only), funded with a little Base Sepolia ETH by
 * the deployer, and each deposits 0.1 test WETH. Re-running reuses them. Costs: Base gas for the accounts,
 * one ClearingHouse reaction per deposit, and the re-check of every account (paid in lREACT by the contract).
 */
import { createWalletClient, encodePacked, formatEther, http, keccak256, maxUint256, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { chAbi, priceControllerAbi, feedAbi, tokenAbi, vaultAbi } from "./abi.js";
import { COLL_UNIT, EXPLORER, PRICE_UNIT, dep, pub, wallet } from "./config.js";
import { appendRun, argFlag, finish, makeLeg, pollUntil, read, send, sleep, type Leg } from "./util.js";

const n = Number(argFlag("n", "12"));
const runId = `crowd-${Date.now()}`;
const CH = dep.lasna.clearingHouse;
const VAULT = dep.base.vault;
const WETH = dep.base.weth;
const DEPOSIT = COLL_UNIT / 10n;

function crowdAccount(i: number) {
  const key = keccak256(encodePacked(["bytes32", "string", "uint256"], [process.env.PRIVATE_KEY as Hex, "lien-crowd", BigInt(i)]));
  return privateKeyToAccount(key);
}

async function ensureDeposited(i: number) {
  const acct = crowdAccount(i);
  const collateral = await read<bigint>("base", VAULT, vaultAbi, "collateralOf", [acct.address]);
  if (collateral >= DEPOSIT) return false;

  // Gas for approve + deposit, with headroom; Base Sepolia gas is cheap but not free.
  const gasPrice = await pub.base.getGasPrice();
  const need = gasPrice * 400_000n * 3n;
  const bal = await pub.base.getBalance({ address: acct.address });
  if (bal < need) {
    const hash = await wallet.base.sendTransaction({ to: acct.address, value: need - bal, chain: baseSepolia, account: wallet.base.account! });
    await pub.base.waitForTransactionReceipt({ hash, pollingInterval: 250 });
  }
  await send("base", { address: WETH, abi: tokenAbi, functionName: "mint", args: [acct.address, DEPOSIT] });

  const w = createWalletClient({ account: acct, chain: baseSepolia, transport: http(process.env.BASE_RPC) });
  await send("base", { address: WETH, abi: tokenAbi, functionName: "approve", args: [VAULT, maxUint256] }, w);
  await send("base", { address: VAULT, abi: vaultAbi, functionName: "deposit", args: [DEPOSIT] }, w);
  return true;
}

function setPrice(p: bigint) {
  return dep.base.priceController
    ? send("base", { address: dep.base.priceController, abi: priceControllerAbi, functionName: "ownerSetPrice", args: [p] })
    : send("base", { address: dep.base.feed, abi: feedAbi, functionName: "setPrice", args: [p] });
}

async function main() {
  const batch = await read<bigint>("lasna", CH, chAbi, "BATCH").catch(() => {
    throw new Error("This ClearingHouse has no BATCH(): it is the capped version. Redeploy with scripts/deploy.sh first.");
  });
  console.log(`Crowd ${runId}: ${n} extra accounts, batch size ${batch}`);
  console.log(`Deployer Base balance: ${formatEther(await pub.base.getBalance({ address: wallet.base.account!.address }))} ETH`);

  for (let i = 0; i < n; i++) {
    const added = await ensureDeposited(i);
    console.log(`  account ${String(i + 1).padStart(2)} ${crowdAccount(i).address} ${added ? "deposited 0.1 WETH" : "already deposited"}`);
  }

  const before = await read<bigint>("lasna", CH, chAbi, "usersCount");
  // The deployer counts only if it has its own position on this deployment (a fresh deploy has none).
  const deployerIn = (await read<bigint>("base", VAULT, vaultAbi, "collateralOf", [wallet.base.account!.address])) > 0n;
  const want = BigInt(n) + (deployerIn ? 1n : 0n);
  console.log(`\nWaiting for the ledger to track at least ${want} accounts (now ${before})…`);
  await pollUntil("accounts tracked", async () => ((await read<bigint>("lasna", CH, chAbi, "usersCount")) >= want ? true : undefined), 300_000);
  const total = await read<bigint>("lasna", CH, chAbi, "usersCount");
  const expectedBatches = Number((total + batch - 1n) / batch);
  console.log(`Tracked: ${total} accounts, so a price update needs ${expectedBatches} batches.`);

  // A small drop lowers every account's limit, so each one gets a sync in its batch.
  const price = await read<bigint>("lasna", CH, chAbi, "price");
  const target = price === 2_000n * PRICE_UNIT ? 1_950n * PRICE_UNIT : 2_000n * PRICE_UNIT;
  const epochBefore = await read<bigint>("lasna", CH, chAbi, "repriceEpoch");
  const fromL = await pub.lasna.getBlockNumber();
  const start = Date.now();
  const o = await setPrice(target);
  const legs: Leg[] = [await makeLeg("price update (origin)", "base", o.hash, o.receipt.blockNumber, o.minedObservedAt)];
  console.log(`\nPrice $${price / PRICE_UNIT} -> $${target / PRICE_UNIT}: ${EXPLORER.base}${o.hash}`);

  const epoch = epochBefore + 1n;
  const seen = new Set<string>();
  const deadline = Date.now() + 180_000;
  let reached = 0n;
  let cursor = fromL;
  while (reached < total && Date.now() < deadline) {
    const head = await pub.lasna.getBlockNumber();
    if (head >= cursor) {
      const logs = await pub.lasna.getContractEvents({ address: CH, abi: chAbi, eventName: "RepriceBatch", args: { epoch }, fromBlock: cursor, toBlock: head });
      for (const l of logs) {
        if (seen.has(l.transactionHash)) continue;
        seen.add(l.transactionHash);
        const label = l.args.from === 0n ? "batch 1 (inside react)" : `batch ${Number(l.args.from! / batch) + 1} (after relay)`;
        legs.push(await makeLeg(`${label}: accounts ${l.args.from}-${l.args.to! - 1n}`, "lasna", l.transactionHash, l.blockNumber, Date.now()));
        console.log(`  ${label.padEnd(28)} accounts ${l.args.from}–${l.args.to! - 1n} of ${l.args.total}  ${EXPLORER.lasna}${l.transactionHash}`);
        if (l.args.to! > reached) reached = l.args.to!;
      }
      cursor = head > cursor + 5n ? head - 5n : cursor;
    }
    await sleep(500);
  }

  const ok = reached >= total;
  const r = finish("reprice_batches", runId, start, legs, { accounts: total, batches: legs.length - 1, expectedBatches, newPrice: target }, ok ? undefined : `only ${reached} of ${total} accounts re-checked within 180 s`);
  r.ok = ok;
  appendRun(r);
  console.log(
    ok
      ? `\nAll ${total} accounts re-checked in ${legs.length - 1} batches, ${(r.totalBlockMs / 1000).toFixed(0)} s by block timestamps (${(r.totalObservedMs / 1000).toFixed(1)} s observed).`
      : `\nIncomplete: ${r.note}. If no relayed batch appeared, check for RepriceRelayed on the CreditMarket (Unichain); anyone can finish the pass with continueReprice(address,uint256) on the ClearingHouse.`,
  );
  if (target !== 2_000n * PRICE_UNIT) {
    console.log("Restoring the price to $2,000.");
    await setPrice(2_000n * PRICE_UNIT);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
