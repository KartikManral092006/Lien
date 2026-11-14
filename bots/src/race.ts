import { parseEventLogs } from "viem";
import { chAbi, marketAbi, vaultAbi } from "./abi.js";
import { COLL_UNIT, dep, pub } from "./config.js";
import { ensureWeth, position, repayAll, user, waitLimitAtLeast } from "./flows.js";
import { appendRun, argFlag, fmtUnits, logScanner, pollUntil, read, send } from "./util.js";

const n = Number(argFlag("n", "20"));
const runId = `race-${Date.now()}`;
const VAULT = dep.base.vault;
const MARKET = dep.unichain.market;

async function prepare() {
  await repayAll();
  const c = await read<bigint>("base", VAULT, vaultAbi, "collateralOf", [user]);
  if (c < COLL_UNIT) {
    await ensureWeth(COLL_UNIT - c);
    await send("base", { address: VAULT, abi: vaultAbi, functionName: "deposit", args: [COLL_UNIT - c] });
  }
  const ltv = await read<bigint>("lasna", dep.lasna.clearingHouse, chAbi, "ltvBps");
  const p = await position();
  const expected = (p.value * ltv) / 10_000n;
  await waitLimitAtLeast((expected * 99n) / 100n);
}

async function main() {
  console.log(`Race attack ${runId}: ${n} attempts to withdraw all collateral on Base while borrowing all credit on Unichain in the same moment`);
  let insolvent = 0;
  let released = 0;
  let borrowed = 0;
  let both = 0;

  for (let i = 0; i < n; i++) {
    await prepare();
    const free = await read<bigint>("base", VAULT, vaultAbi, "freeCollateralOf", [user]);
    const avail = await read<bigint>("unichain", MARKET, marketAbi, "availableCredit", [user]);
    const fromB = await pub.base.getBlockNumber();

    const [w, b] = await Promise.allSettled([
      send("base", { address: VAULT, abi: vaultAbi, functionName: "requestWithdraw", args: [free] }),
      send("unichain", { address: MARKET, abi: marketAbi, functionName: "borrow", args: [avail] }),
    ]);
    if (w.status !== "fulfilled") throw new Error(`withdraw request failed: ${String(w.reason)}`);
    const reqId = parseEventLogs({ abi: vaultAbi, logs: w.value.receipt.logs, eventName: "WithdrawRequested" })[0].args.reqId;

    const settled = await pollUntil(
      `WithdrawSettled ${reqId}`,
      logScanner("base", fromB, async (from, to) => {
        const logs = await pub.base.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: "WithdrawSettled", args: { user, reqId }, fromBlock: from, toBlock: to });
        return logs[0];
      }),
    );

    const p = await position();
    const ltv = await read<bigint>("lasna", dep.lasna.clearingHouse, chAbi, "ltvBps");
    const solvent = p.debt * 10_000n <= p.value * ltv;
    const didRelease = settled.value.args.released;
    const didBorrow = b.status === "fulfilled";
    if (!solvent) insolvent++;
    if (didRelease) released++;
    if (didBorrow) borrowed++;
    if (didRelease && didBorrow) both++;

    appendRun({
      flow: "race_attack",
      runId,
      attempt: i + 1,
      ok: true,
      startedAtMs: Date.now(),
      released: didRelease,
      borrowed: didBorrow,
      debtAfter: p.debt,
      collateralAfter: p.collateral,
      solvent,
      withdrawTx: w.value.hash,
      borrowTx: didBorrow ? b.value.hash : null,
      settleTx: settled.value.transactionHash,
    });
    console.log(
      `  #${String(i + 1).padStart(2)} withdraw ${didRelease ? "RELEASED" : "rejected"}  borrow ${didBorrow ? "FILLED  " : "blocked "}  debt ${fmtUnits(p.debt, 6, 2)}  collateral ${fmtUnits(p.collateral, 18)}  ${solvent ? "solvent" : "INSOLVENT"}`,
    );
  }

  console.log(`\n${n} attempts: ${released} withdrawals released, ${borrowed} borrows filled, ${both} where both succeeded, ${insolvent} insolvent outcomes`);
  await repayAll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
