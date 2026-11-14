import { marketAbi, vaultAbi } from "./abi.js";
import { COLL_UNIT, DEBT_UNIT, dep, PRICE_UNIT } from "./config.js";
import { flowDeposit, flowLiquidation, flowPrice, flowWithdraw, position, repayAll, user, waitNotLiquidatable } from "./flows.js";
import { appendRun, fmtUnits, pollUntil, printFlow, read, send, type FlowResult } from "./util.js";

const runId = `demo-${Date.now()}`;
const START_PRICE = 2_000n * PRICE_UNIT;

async function show(title: string) {
  const p = await position();
  console.log(`\n=== ${title}`);
  console.log(`  collateral on Base   ${fmtUnits(p.collateral, 18)} WETH  (pending ${fmtUnits(p.pending, 18)})`);
  console.log(`  debt on Unichain     ${fmtUnits(p.debt, 6, 2)} USDC   limit ${fmtUnits(p.limit, 6, 2)} USDC`);
  console.log(`  price                ${fmtUnits(p.price, 8, 2)} USD   health ${Number.isFinite(p.health) ? p.health.toFixed(3) : "∞"}${p.liquidatable ? "   LIQUIDATABLE" : ""}`);
}

function record(r: FlowResult) {
  printFlow(r);
  appendRun(r);
}

async function reset() {
  console.log("Resetting the demo account to a clean state...");
  await repayAll();
  const p = await position();
  if (p.price !== START_PRICE) record(await flowPrice(runId, START_PRICE));
  if (p.liquidatable) await waitNotLiquidatable();
  const free = await read<bigint>("base", dep.base.vault, vaultAbi, "freeCollateralOf", [user]);
  if (free > 0n) record(await flowWithdraw(runId, free));
}

async function main() {
  console.log(`Lien demo for ${user}`);
  await reset();
  await show("Start");

  console.log("\n[1] Deposit 1 WETH on Base -> credit appears on Unichain");
  record(await flowDeposit(runId, 1n * COLL_UNIT));
  await show("After deposit");

  console.log("\n[2] Borrow 1,000 USDC on Unichain against collateral that never left Base");
  const b = await send("unichain", { address: dep.unichain.market, abi: marketAbi, functionName: "borrow", args: [1_000n * DEBT_UNIT] });
  console.log(`  borrow tx https://sepolia.uniscan.xyz/tx/${b.hash}`);
  // Load-balanced RPC nodes can lag the one that returned the receipt; wait until the debt is visible.
  await pollUntil("borrow visible on Unichain", async () => ((await position()).debt >= 1_000n * DEBT_UNIT ? true : undefined), 30_000);
  await show("After borrow");

  console.log("\n[3] Withdraw 0.2 WETH on Base -> two-phase commit (lower credit first, then release)");
  record(await flowWithdraw(runId, (2n * COLL_UNIT) / 10n));
  await show("After withdrawal");

  console.log("\n[4] Price crashes 25% on Base -> account flagged liquidatable on Unichain");
  record(await flowPrice(runId, 1_500n * PRICE_UNIT));
  await show("After crash");

  console.log("\n[5] Liquidator repays 500 USDC on Unichain -> receives WETH on Base");
  record(await flowLiquidation(runId, user, 500n * DEBT_UNIT));
  await show("After liquidation");

  console.log("\n[6] Cleanup: repay and restore price");
  await repayAll();
  record(await flowPrice(runId, START_PRICE));
  await show("End");
  console.log(`\nAll timings appended to results/runs.jsonl (run ${runId}). Run "npm run analyze" for percentiles.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
