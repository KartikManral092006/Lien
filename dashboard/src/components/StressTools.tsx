import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isAddress, parseUnits, type Abi, type Address } from "viem";
import { DEBT, PRICE, feedAbi, fmt, marketAbi, priceControllerAbi, pub, tokenAbi, type Deployments } from "../lib/chain";
import type { Position } from "../lib/data";
import type { useTx } from "../lib/tx";
import { Button } from "./primitives";

type Lever = { open: true; nextMoveAt: number; movesLeft: number; min: bigint; maxMoveBps: bigint; defaultPrice: bigint } | { open: false; owner: Address };

/** Who may move the test price right now: anyone through the PriceController, or only the feed's owner. */
function useLever(d: Deployments) {
  const pc = d.base.priceController;
  return useQuery({
    queryKey: ["price-lever", pc ?? d.base.feed],
    refetchInterval: 5000,
    queryFn: async (): Promise<Lever> => {
      const r = <T,>(address: Address, abi: Abi, functionName: string) => pub.base.readContract({ address, abi, functionName } as any) as Promise<T>;
      if (!pc) return { open: false, owner: await r<Address>(d.base.feed, feedAbi as Abi, "owner") };
      const [[next, left], min, bps, def] = await Promise.all([
        r<readonly [bigint, bigint]>(pc, priceControllerAbi as Abi, "status"),
        r<bigint>(pc, priceControllerAbi as Abi, "minPrice"),
        r<bigint>(pc, priceControllerAbi as Abi, "maxMoveBps"),
        r<bigint>(pc, priceControllerAbi as Abi, "defaultPrice"),
      ]);
      return { open: true, nextMoveAt: Number(next), movesLeft: Number(left), min, maxMoveBps: bps, defaultPrice: def };
    },
  });
}

/**
 * Moves the shared test price. -10% lands a borrower at the limit in the shield zone; -25% takes an
 * unshielded one past the liquidation threshold. Every move is public, so the page says so.
 */
function PriceLever({ d, p, tx, canAct }: { d: Deployments; p?: Position; tx: ReturnType<typeof useTx>; canAct: boolean }) {
  const lever = useLever(d);
  const l = lever.data;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const cooling = l?.open && l.nextMoveAt > now ? l.nextMoveAt - now : 0;
  useEffect(() => {
    if (!cooling) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [cooling]);

  const ownerOnly = l && !l.open && tx.address?.toLowerCase() !== l.owner.toLowerCase();
  const blocked = !canAct || !!tx.busy || !l || !!ownerOnly || !!cooling || (l.open && l.movesLeft === 0);
  const pc = d.base.priceController;

  const move = async (label: string, pct: bigint) => {
    if (!p) return;
    const to = (p.price * (100n - pct)) / 100n;
    await tx.run(label, "base", [pc ? { address: pc, abi: priceControllerAbi as Abi, functionName: "setPrice", args: [to] } : { address: d.base.feed, abi: feedAbi as Abi, functionName: "setPrice", args: [to] }], {
      track: true,
      done: `WETH set to $${fmt(to, PRICE)}`,
    });
    lever.refetch();
  };
  const reset = async () => {
    const to = l?.open ? l.defaultPrice : 2_000n * 10n ** 8n;
    await tx.run("Price reset", "base", [pc ? { address: pc, abi: priceControllerAbi as Abi, functionName: "resetPrice", args: [] } : { address: d.base.feed, abi: feedAbi as Abi, functionName: "setPrice", args: [to] }], {
      track: true,
      done: `WETH back to $${fmt(to, PRICE)}`,
    });
    lever.refetch();
  };
  const tooLow = (pct: bigint) => !!(p && l?.open && (p.price * (100n - pct)) / 100n < l.min);
  const atDefault = !!(p && l?.open && p.price === l.defaultPrice);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="danger" size="sm" disabled={blocked || !p || tooLow(10n)} busy={tx.busy === "Drop WETH 10%"} onClick={() => move("Drop WETH 10%", 10n)} title="A borrower at the limit lands in the shield zone">
          Drop WETH 10%
        </Button>
        <Button tone="danger" size="sm" disabled={blocked || !p || tooLow(25n)} busy={tx.busy === "Drop WETH 25%"} onClick={() => move("Drop WETH 25%", 25n)} title="An unshielded borrower at the limit becomes liquidatable">
          Drop WETH 25%
        </Button>
        <Button tone="quiet" size="sm" disabled={blocked || atDefault} busy={tx.busy === "Price reset"} onClick={reset}>
          Reset to ${fmt(l?.open ? l.defaultPrice : 2_000n * 10n ** 8n, PRICE)}
        </Button>
        {p && <span className="text-sm text-muted">Now ${fmt(p.price, PRICE)}</span>}
      </div>
      <p className="mt-2 text-xs text-faint" aria-live="polite">
        {!l
          ? "Checking who can move the price…"
          : !l.open
            ? ownerOnly
              ? "On this deployment only the deployer can move the test price. The recorded runs in the README show both outcomes."
              : "You own the test oracle on this deployment."
            : cooling
              ? `This moves the test price for everyone. Next move in ${cooling} s.`
              : l.movesLeft === 0
                ? "This moves the test price for everyone. Today's limit is used up; it resets at midnight UTC."
                : `This moves the test price for everyone. Up to ${Number(l.maxMoveBps) / 100}% per move, ${l.movesLeft} moves left today.`}
      </p>
    </div>
  );
}

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

      <PriceLever d={d} p={p} tx={tx} canAct={canAct} />

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
