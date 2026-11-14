import { hexToBigInt, maxUint256, parseEventLogs, type Address, type Hex, type WalletClient } from "viem";
import { chAbi, chShieldAbi, feedAbi, Kind, marketAbi, tokenAbi, vaultAbi } from "./abi.js";
import { account, COLL_UNIT, DEBT_UNIT, dep, liquidatorWallet, PRICE_UNIT, pub } from "./config.js";
import { finish, logScanner, makeLeg, pollUntil, read, send, type FlowResult, type Leg } from "./util.js";

const CH = dep.lasna.clearingHouse;
const VAULT = dep.base.vault;
const FEED = dep.base.feed;
const WETH = dep.base.weth;
const MARKET = dep.unichain.market;
const USDC = dep.unichain.usdc;

export const user = account.address;

export async function ensureWeth(amount: bigint) {
  const bal = await read<bigint>("base", WETH, tokenAbi, "balanceOf", [user]);
  if (bal < amount) await send("base", { address: WETH, abi: tokenAbi, functionName: "mint", args: [user, amount - bal] });
  const allowance = await read<bigint>("base", WETH, tokenAbi, "allowance", [user, VAULT]);
  if (allowance < amount) await send("base", { address: WETH, abi: tokenAbi, functionName: "approve", args: [VAULT, maxUint256] });
}

export async function ensureUsdc(amount: bigint, w?: WalletClient) {
  const owner = (w?.account?.address ?? user) as Address;
  const bal = await read<bigint>("unichain", USDC, tokenAbi, "balanceOf", [owner]);
  if (bal < amount) await send("unichain", { address: USDC, abi: tokenAbi, functionName: "mint", args: [owner, amount - bal] }, w);
  const allowance = await read<bigint>("unichain", USDC, tokenAbi, "allowance", [owner, MARKET]);
  if (allowance < amount) await send("unichain", { address: USDC, abi: tokenAbi, functionName: "approve", args: [MARKET, maxUint256] }, w);
}

async function lasnaHead() {
  return pub.lasna.getBlockNumber();
}

async function waitReacted(kind: number, originTx: Hex, fromBlock: bigint) {
  const want = hexToBigInt(originTx);
  return pollUntil(
    `Lasna reaction (kind ${kind}) to ${originTx}`,
    logScanner("lasna", fromBlock, async (from, to) => {
      const logs = await pub.lasna.getContractEvents({ address: CH, abi: chAbi, eventName: "Reacted", args: { kind }, fromBlock: from, toBlock: to });
      return logs.find((l) => l.args.originTxHash === want);
    }),
  );
}

async function syncFromReaction(lasnaTx: Hex, forUser: Address) {
  const receipt = await pub.lasna.getTransactionReceipt({ hash: lasnaTx });
  const syncs = parseEventLogs({ abi: chAbi, logs: receipt.logs, eventName: "SyncSent" });
  return syncs.find((s) => s.args.user.toLowerCase() === forUser.toLowerCase());
}

async function waitLimitApplied(forUser: Address, seq: bigint, fromBlock: bigint) {
  return pollUntil(
    `LimitApplied seq ${seq} on Unichain`,
    logScanner("unichain", fromBlock, async (from, to) => {
      const logs = await pub.unichain.getContractEvents({ address: MARKET, abi: marketAbi, eventName: "LimitApplied", args: { user: forUser, seq }, fromBlock: from, toBlock: to });
      return logs[0];
    }),
  );
}

export async function flowDeposit(runId: string, amount: bigint): Promise<FlowResult> {
  await ensureWeth(amount);
  const fromL = await lasnaHead();
  const fromU = await pub.unichain.getBlockNumber();
  const start = Date.now();
  const o = await send("base", { address: VAULT, abi: vaultAbi, functionName: "deposit", args: [amount] });
  const legs: Leg[] = [await makeLeg("deposit (origin)", "base", o.hash, o.receipt.blockNumber, o.minedObservedAt)];

  const r = await waitReacted(Kind.Deposit, o.hash, fromL);
  legs.push(await makeLeg("ClearingHouse react", "lasna", r.value.transactionHash, r.value.blockNumber, r.observedAt));

  const sync = await syncFromReaction(r.value.transactionHash, user);
  if (!sync) return finish("deposit_to_credit", runId, start, legs, { amount }, "no limit change was large enough to sync");

  const a = await waitLimitApplied(user, sync.args.seq, fromU);
  legs.push(await makeLeg("credit applied (callback)", "unichain", a.value.transactionHash, a.value.blockNumber, a.observedAt));
  return finish("deposit_to_credit", runId, start, legs, { amount, limit: a.value.args.limit });
}

export async function flowWithdraw(runId: string, amount: bigint): Promise<FlowResult> {
  const fromL = await lasnaHead();
  const fromU = await pub.unichain.getBlockNumber();
  const fromB = await pub.base.getBlockNumber();
  const start = Date.now();
  const o = await send("base", { address: VAULT, abi: vaultAbi, functionName: "requestWithdraw", args: [amount] });
  const req = parseEventLogs({ abi: vaultAbi, logs: o.receipt.logs, eventName: "WithdrawRequested" })[0];
  const reqId = req.args.reqId;
  const legs: Leg[] = [await makeLeg("requestWithdraw (origin)", "base", o.hash, o.receipt.blockNumber, o.minedObservedAt)];

  const r1 = await waitReacted(Kind.WithdrawRequest, o.hash, fromL);
  legs.push(await makeLeg("phase 1: lower credit", "lasna", r1.value.transactionHash, r1.value.blockNumber, r1.observedAt));

  const sync = await syncFromReaction(r1.value.transactionHash, user);
  if (sync) {
    const a = await waitLimitApplied(user, sync.args.seq, fromU);
    legs.push(await makeLeg("limit applied + debt snapshot", "unichain", a.value.transactionHash, a.value.blockNumber, a.observedAt));
    const r2 = await waitReacted(Kind.LimitApplied, a.value.transactionHash, fromL);
    legs.push(await makeLeg("phase 2: decide", "lasna", r2.value.transactionHash, r2.value.blockNumber, r2.observedAt));
  }

  const s = await pollUntil(
    `WithdrawSettled ${reqId}`,
    logScanner("base", fromB, async (from, to) => {
      const logs = await pub.base.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: "WithdrawSettled", args: { user, reqId }, fromBlock: from, toBlock: to });
      return logs[0];
    }),
  );
  legs.push(await makeLeg(s.value.args.released ? "collateral released" : "withdrawal rejected", "base", s.value.transactionHash, s.value.blockNumber, s.observedAt));
  return finish("withdraw_two_phase", runId, start, legs, { amount, reqId, released: s.value.args.released }, sync ? undefined : "decided in one loop");
}

export async function flowPrice(runId: string, newPrice: bigint, watchUser: Address = user): Promise<FlowResult> {
  const fromL = await lasnaHead();
  const fromU = await pub.unichain.getBlockNumber();
  const start = Date.now();
  const o = await send("base", { address: FEED, abi: feedAbi, functionName: "setPrice", args: [newPrice] });
  const legs: Leg[] = [await makeLeg("price update (origin)", "base", o.hash, o.receipt.blockNumber, o.minedObservedAt)];

  const r = await waitReacted(Kind.Price, o.hash, fromL);
  legs.push(await makeLeg("ClearingHouse re-prices", "lasna", r.value.transactionHash, r.value.blockNumber, r.observedAt));

  const sync = await syncFromReaction(r.value.transactionHash, watchUser);
  if (!sync) return finish("price_to_limit", runId, start, legs, { newPrice }, "price move too small to resync this user");

  const a = await waitLimitApplied(watchUser, sync.args.seq, fromU);
  legs.push(await makeLeg(a.value.args.liquidatable ? "flagged liquidatable" : "limit updated", "unichain", a.value.transactionHash, a.value.blockNumber, a.observedAt));
  return finish("price_to_limit", runId, start, legs, { newPrice, liquidatable: a.value.args.liquidatable, limit: a.value.args.limit });
}

export async function flowLiquidation(runId: string, target: Address, repay: bigint): Promise<FlowResult> {
  await ensureUsdc(repay, liquidatorWallet);
  const fromL = await lasnaHead();
  const fromB = await pub.base.getBlockNumber();
  const start = Date.now();
  const o = await send("unichain", { address: MARKET, abi: marketAbi, functionName: "liquidate", args: [target, repay] }, liquidatorWallet);
  const liq = parseEventLogs({ abi: marketAbi, logs: o.receipt.logs, eventName: "Liquidated" })[0];
  const liqId = liq.args.liqId;
  const legs: Leg[] = [await makeLeg("liquidator repays (origin)", "unichain", o.hash, o.receipt.blockNumber, o.minedObservedAt)];

  const r = await waitReacted(Kind.Liquidated, o.hash, fromL);
  legs.push(await makeLeg("ClearingHouse computes seizure", "lasna", r.value.transactionHash, r.value.blockNumber, r.observedAt));

  const s = await pollUntil(
    `Seized ${liqId}`,
    logScanner("base", fromB, async (from, to) => {
      const logs = await pub.base.getContractEvents({ address: VAULT, abi: vaultAbi, eventName: "Seized", args: { user: target, liqId }, fromBlock: from, toBlock: to });
      return logs[0];
    }),
  );
  legs.push(await makeLeg("collateral paid to liquidator", "base", s.value.transactionHash, s.value.blockNumber, s.observedAt));
  return finish("liquidation_cross_chain", runId, start, legs, { repaid: liq.args.repaid, seized: s.value.args.amount, liqId });
}

/** True when the deployed market has auto-protection (shields). Older deployments don't. */
export async function shieldSupported() {
  try {
    await read<bigint>("unichain", MARKET, marketAbi, "totalShield");
    return true;
  } catch {
    return false;
  }
}

export async function ensureShield(amount: bigint) {
  const have = await read<bigint>("unichain", MARKET, marketAbi, "shieldOf", [user]);
  if (have < amount) {
    await ensureUsdc(amount - have);
    await send("unichain", { address: MARKET, abi: marketAbi, functionName: "fundShield", args: [amount - have] });
  }
  // Protection is decided on Reactive, so wait until the ledger has seen the shield before moving the price.
  await pollUntil("ledger sees the shield", async () => {
    const acc = await read<readonly unknown[]>("lasna", CH, chShieldAbi, "accounts", [user]);
    return (acc[7] as bigint) >= amount ? true : undefined;
  });
}

export async function withdrawShieldAll() {
  const s = await read<bigint>("unichain", MARKET, marketAbi, "shieldOf", [user]);
  if (s > 0n) await send("unichain", { address: MARKET, abi: marketAbi, functionName: "withdrawShield", args: [s] });
}

/**
 * Price drop -> ClearingHouse re-prices and orders protection -> Unichain repays from the shield in the
 * same callback that would otherwise flag the account. The end-to-end time is how long a borrower is
 * exposed before Reactive steps in.
 */
export async function flowProtection(runId: string, newPrice: bigint): Promise<FlowResult> {
  const fromL = await lasnaHead();
  const fromU = await pub.unichain.getBlockNumber();
  const start = Date.now();
  const o = await send("base", { address: FEED, abi: feedAbi, functionName: "setPrice", args: [newPrice] });
  const legs: Leg[] = [await makeLeg("price drop (origin)", "base", o.hash, o.receipt.blockNumber, o.minedObservedAt)];

  const r = await waitReacted(Kind.Price, o.hash, fromL);
  legs.push(await makeLeg("ClearingHouse orders protection", "lasna", r.value.transactionHash, r.value.blockNumber, r.observedAt));

  const p = await pollUntil(
    `Protected for ${user}`,
    logScanner("unichain", fromU, async (from, to) => {
      const logs = await pub.unichain.getContractEvents({ address: MARKET, abi: marketAbi, eventName: "Protected", args: { user }, fromBlock: from, toBlock: to });
      return logs[0];
    }),
  );
  legs.push(await makeLeg("shield repaid debt (callback)", "unichain", p.value.transactionHash, p.value.blockNumber, p.observedAt));
  const flagged = await read<boolean>("unichain", MARKET, marketAbi, "liquidatable", [user]);
  return finish("protection", runId, start, legs, { newPrice, repaid: p.value.args.repaid, debt: p.value.args.debt, shieldLeft: p.value.args.shieldLeft, flagged });
}

export async function position(who: Address = user) {
  const [collateral, pending, debt, limit, liquidatable, price, ltBps] = await Promise.all([
    read<bigint>("base", VAULT, vaultAbi, "collateralOf", [who]),
    read<bigint>("base", VAULT, vaultAbi, "pendingOf", [who]),
    read<bigint>("unichain", MARKET, marketAbi, "debtOf", [who]),
    read<bigint>("unichain", MARKET, marketAbi, "limitOf", [who]),
    read<boolean>("unichain", MARKET, marketAbi, "liquidatable", [who]),
    read<bigint>("base", FEED, feedAbi, "price"),
    read<bigint>("lasna", CH, chAbi, "ltBps"),
  ]);
  const value = (collateral * price * DEBT_UNIT) / (COLL_UNIT * PRICE_UNIT);
  const health = debt === 0n ? Infinity : Number((value * ltBps) / 10_000n) / Number(debt);
  return { collateral, pending, debt, limit, liquidatable, price, value, health };
}

export async function repayAll(who: Address = user) {
  const debt = await read<bigint>("unichain", MARKET, marketAbi, "debtOf", [who]);
  if (debt === 0n) return;
  await ensureUsdc(debt);
  await send("unichain", { address: MARKET, abi: marketAbi, functionName: "repay", args: [who, debt] });
}

export async function waitLimitAtLeast(min: bigint, who: Address = user) {
  return pollUntil(`credit limit >= ${min}`, async () => {
    const lim = await read<bigint>("unichain", MARKET, marketAbi, "limitOf", [who]);
    return lim >= min ? lim : undefined;
  });
}

export async function waitNotLiquidatable(who: Address = user) {
  return pollUntil("liquidatable flag cleared", async () => {
    const f = await read<boolean>("unichain", MARKET, marketAbi, "liquidatable", [who]);
    return f ? undefined : true;
  });
}
