import { useState } from "react";
import { isAddress, parseUnits, type Abi, type Address } from "viem";
import { DEBT, PRICE, feedAbi, fmt, marketAbi, tokenAbi, type Deployments } from "../lib/chain";
import type { Position } from "../lib/data";
import type { useTx } from "../lib/tx";
import { Button } from "./primitives";

/** Testnet-only levers: move the mock oracle and act as a liquidator. Kept apart from borrower actions. */
export function StressTools({ d, p, tx, who, canAct }: { d: Deployments; p?: Position; tx: ReturnType<typeof useTx>; who: Address; canAct: boolean }) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("500");
  const victim = (isAddress(target) ? target : who) as Address;
  const repay = (() => {
    try {
      return parseUnits(amount || "0", DEBT);
    } catch {
      return 0n;
    }
  })();
  const locked = !canAct || !!tx.busy;

  return (
    <section className="px-5 py-8 sm:px-8" aria-labelledby="stress-h">
      <h2 id="stress-h" className="text-base font-semibold tracking-tight">
        Testnet stress tools
      </h2>
      <p className="mt-1 text-sm text-muted">Move the test oracle and play the liquidator to see protection and liquidation happen live.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          tone="danger"
          size="sm"
          disabled={locked || !p}
          busy={tx.busy === "Price crash"}
          onClick={() => p && tx.run("Price crash", "base", [{ address: d.base.feed, abi: feedAbi as Abi, functionName: "setPrice", args: [(p.price * 75n) / 100n] }], { track: true, done: `WETH set to $${fmt((p.price * 75n) / 100n, PRICE)}` })}
        >
          Drop WETH 25%
        </Button>
        <Button
          tone="quiet"
          size="sm"
          disabled={locked}
          busy={tx.busy === "Price reset"}
          onClick={() => tx.run("Price reset", "base", [{ address: d.base.feed, abi: feedAbi as Abi, functionName: "setPrice", args: [2_000n * 10n ** 8n] }], { track: true, done: "WETH back to $2,000" })}
        >
          Reset to $2,000
        </Button>
        {p && <span className="text-sm text-muted">Now ${fmt(p.price, PRICE)}</span>}
      </div>

      <form
        className="mt-5 grid grid-cols-[1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tx.address || repay === 0n) return;
          tx.run(
            "Liquidate",
            "unichain",
            async () => [
              { address: d.unichain.usdc, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, repay] },
              ...(await tx.approvalFor("unichain", d.unichain.usdc, d.unichain.market, repay)),
              { address: d.unichain.market, abi: marketAbi as Abi, functionName: "liquidate", args: [victim, repay] },
            ],
            { track: true, done: "Liquidation sent" },
          );
        }}
      >
        <label className="sr-only" htmlFor="liq-target">
          Account to liquidate
        </label>
        <input
          id="liq-target"
          value={target}
          onChange={(e) => setTarget(e.target.value.trim())}
          placeholder={`Account to liquidate (default: viewed account)`}
          className="col-span-2 h-9 border border-line bg-raised px-3 font-mono text-xs outline-none focus:border-chain-base"
        />
        <label className="sr-only" htmlFor="liq-amt">
          USDC to repay
        </label>
        <input
          id="liq-amt"
          inputMode="decimal"
          placeholder="USDC to repay"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="h-9 border border-line bg-raised px-3 text-sm outline-none focus:border-chain-base"
        />
        <Button tone="quiet" size="sm" type="submit" className="h-9" disabled={locked || repay === 0n} busy={tx.busy === "Liquidate"}>
          Liquidate
        </Button>
      </form>
      <p className="mt-2 text-xs text-faint">Repays up to half the debt on Unichain and pays you the collateral plus a 5% bonus on Base.</p>
    </section>
  );
}
