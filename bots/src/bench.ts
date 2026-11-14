import { marketAbi, vaultAbi } from "./abi.js";
import { COLL_UNIT, dep, PRICE_UNIT } from "./config.js";
import { flowDeposit, flowLiquidation, flowPrice, flowWithdraw, position, repayAll, user, waitNotLiquidatable } from "./flows.js";
import { appendRun, argFlag, read, send, type FlowResult } from "./util.js";

const n = Number(argFlag("n", "20"));
const flows = argFlag("flows", "deposit,withdraw,price").split(",");
const runId = `bench-${Date.now()}`;
const START_PRICE = 2_000n * PRICE_UNIT;
const STEP = COLL_UNIT / 10n;

async function attempt(label: string, fn: () => Promise<FlowResult>) {
  try {
    const r = await fn();
    appendRun(r);
    const legs = r.legs.map((l) => `${l.chain}:${((l.observedAtMs - r.startedAtMs) / 1000).toFixed(2)}s`).join(" ");
    console.log(`  ${label.padEnd(26)} ${(r.totalObservedMs / 1000).toFixed(2)} s   ${legs}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendRun({ flow: label, runId, ok: false, error: msg, startedAtMs: Date.now() });
    console.log(`  ${label.padEnd(26)} FAILED: ${msg}`);
  }
}

async function ensureBaseline() {
  await repayAll();
  const p = await position();
  if (p.price !== START_PRICE) await attempt("setup price", () => flowPrice(runId, START_PRICE));
  if (p.liquidatable) await waitNotLiquidatable();
  const c = await read<bigint>("base", dep.base.vault, vaultAbi, "collateralOf", [user]);
  if (c < COLL_UNIT) await attempt("setup deposit", () => flowDeposit(runId, COLL_UNIT - c));
}

async function main() {
  console.log(`Benchmark ${runId}: n=${n}, flows=${flows.join(",")}`);
  await ensureBaseline();

  for (let i = 0; i < n; i++) {
    console.log(`\nround ${i + 1}/${n}`);
    if (flows.includes("deposit")) await attempt("deposit_to_credit", () => flowDeposit(runId, STEP));
    if (flows.includes("withdraw")) await attempt("withdraw_two_phase", () => flowWithdraw(runId, STEP));
    if (flows.includes("price")) {
      const target = i % 2 === 0 ? 1_900n * PRICE_UNIT : START_PRICE;
      await attempt("price_to_limit", () => flowPrice(runId, target));
    }
    if (flows.includes("liquidation")) {
      await ensureBaseline();
      const avail = await read<bigint>("unichain", dep.unichain.market, marketAbi, "availableCredit", [user]);
      if (avail > 0n) await send("unichain", { address: dep.unichain.market, abi: marketAbi, functionName: "borrow", args: [avail] });
      await attempt("price_crash_to_flag", () => flowPrice(runId, 1_700n * PRICE_UNIT));
      const debt = await read<bigint>("unichain", dep.unichain.market, marketAbi, "debtOf", [user]);
      await attempt("liquidation_cross_chain", () => flowLiquidation(runId, user, debt / 2n));
      await repayAll();
      await attempt("price_restore", () => flowPrice(runId, START_PRICE));
    }
  }
  if (flows.includes("price")) await ensureBaseline();
  console.log(`\nDone. Results appended to results/runs.jsonl. Run "npm run analyze".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
