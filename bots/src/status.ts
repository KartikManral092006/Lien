import { chAbi, payableAbi, priceControllerAbi } from "./abi.js";
import { dep, pub } from "./config.js";
import { position, user } from "./flows.js";
import { fmtUnits, read } from "./util.js";

const SYSTEM = "0x8888888888888888888888888888888888888888" as const;
/** Measured cost of one public price move with the current 13 tracked accounts (two batches, one relay), in lREACT. */
const LREACT_PER_MOVE = 0.1;
/** Keep at least this much so a visitor's move never leaves the ClearingHouse in debt. */
const LOW_WATER = 1;

async function main() {
  const [chBal, chReserves, chDebt, vaultBal, vaultDebt, marketBal, marketDebt, chPrice, users] = await Promise.all([
    pub.lasna.getBalance({ address: dep.lasna.clearingHouse }),
    read<bigint>("lasna", SYSTEM, payableAbi, "reserves", [dep.lasna.clearingHouse]),
    read<bigint>("lasna", SYSTEM, payableAbi, "debt", [dep.lasna.clearingHouse]),
    pub.base.getBalance({ address: dep.base.vault }),
    read<bigint>("base", dep.base.callbackProxy, payableAbi, "debt", [dep.base.vault]),
    pub.unichain.getBalance({ address: dep.unichain.market }),
    read<bigint>("unichain", dep.unichain.callbackProxy, payableAbi, "debt", [dep.unichain.market]),
    read<bigint>("lasna", dep.lasna.clearingHouse, chAbi, "price"),
    read<bigint>("lasna", dep.lasna.clearingHouse, chAbi, "usersCount"),
  ]);

  console.log("Contracts");
  console.log(`  ClearingHouse  ${dep.lasna.clearingHouse}  balance ${fmtUnits(chBal, 18)} lREACT  reserves ${fmtUnits(chReserves, 18)}  debt ${chDebt}  price ${fmtUnits(chPrice, 8, 2)}  users ${users}`);
  console.log(`  Vault          ${dep.base.vault}  balance ${fmtUnits(vaultBal, 18, 6)} ETH  debt ${vaultDebt}`);
  console.log(`  Market         ${dep.unichain.market}  balance ${fmtUnits(marketBal, 18, 6)} ETH  debt ${marketDebt}`);
  if (chDebt > 0n || vaultDebt > 0n || marketDebt > 0n) console.log("  WARNING: a contract is in debt and will not react. Run scripts/fund.sh");

  // Runway: how many public price moves the ClearingHouse can still pay for.
  const funds = Number(chBal + chReserves) / 1e18;
  const moves = Math.floor(funds / LREACT_PER_MOVE);
  const pc = dep.base.priceController;
  let perDay = 0n;
  let left = "";
  if (pc) {
    const [[, leftToday], cap] = await Promise.all([
      read<readonly [bigint, bigint]>("base", pc, priceControllerAbi, "status"),
      read<bigint>("base", pc, priceControllerAbi, "maxMovesPerDay"),
    ]);
    perDay = cap;
    left = `  public moves left today ${leftToday}/${cap}`;
  }
  const days = perDay > 0n ? `, about ${(moves / Number(perDay)).toFixed(1)} days at the daily cap` : "";
  console.log(`\nRunway  ${funds.toFixed(2)} lREACT ≈ ${moves} price moves at ~${LREACT_PER_MOVE} each${days}${left}`);
  if (funds < LOW_WATER) console.log(`  WARNING: below ${LOW_WATER} lREACT. Top up with scripts/fund.sh before visitors drain it.`);

  const p = await position(user);
  console.log(`\nAccount ${user}`);
  console.log(`  collateral ${fmtUnits(p.collateral, 18)} WETH (pending ${fmtUnits(p.pending, 18)})  value ${fmtUnits(p.value, 6, 2)} USDC`);
  console.log(`  debt ${fmtUnits(p.debt, 6, 2)} USDC  limit ${fmtUnits(p.limit, 6, 2)} USDC  health ${Number.isFinite(p.health) ? p.health.toFixed(3) : "∞"}  ${p.liquidatable ? "LIQUIDATABLE" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
