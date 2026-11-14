import { useConnectModal } from "@rainbow-me/rainbowkit";
import * as Tabs from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { useState } from "react";
import { useActionTab, type ActionTab } from "../lib/ui";
import { formatUnits, parseUnits, type Abi } from "viem";
import { COLL, DEBT, fmt, marketAbi, tokenAbi, vaultAbi, type Deployments } from "../lib/chain";
import { derive, type Position } from "../lib/data";
import type { useTx } from "../lib/tx";
import { AmountField, Button, Delta, cx } from "./primitives";

type Tx = ReturnType<typeof useTx>;
type Tab = ActionTab;

function parse(v: string, dec: number): bigint | undefined {
  if (!v || v === ".") return undefined;
  try {
    return parseUnits(v, dec);
  } catch {
    return undefined;
  }
}

const healthText = (h: number | undefined) => (h === undefined ? "–" : Number.isFinite(h) ? h.toFixed(2) : "No debt");

export function Actions({ d, p: viewed, tx, shieldSupported, canAct }: { d: Deployments; p?: Position; tx: Tx; shieldSupported: boolean; canAct: boolean }) {
  const [selected, setTab] = useActionTab();
  const tab: Tab = selected === "shield" && !shieldSupported ? "deposit" : selected;
  // Balances and previews belong to the connected wallet, never to an account someone is only viewing.
  const p = canAct ? viewed : undefined;
  const tabs: { id: Tab; label: string }[] = [
    { id: "deposit", label: "Deposit" },
    { id: "borrow", label: "Borrow" },
    { id: "repay", label: "Repay" },
    { id: "withdraw", label: "Withdraw" },
    ...(shieldSupported ? [{ id: "shield" as Tab, label: "Shield" }] : []),
  ];

  return (
    <section id="actions" className="relative scroll-mt-20" aria-label="Manage position">
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <Tabs.List className="flex overflow-x-auto border-b border-line" aria-label="Actions">
          {tabs.map((t) => (
            <Tabs.Trigger
              key={t.id}
              value={t.id}
              className={cx("relative flex-1 shrink-0 border-r border-line px-3 py-3.5 font-mono text-xs text-muted transition-colors last:border-r-0 hover:bg-white/[0.03] hover:text-ink", tab === t.id && "bg-white/[0.04] text-ink")}
            >
              {tab === t.id && <motion.span layoutId="action-tab" className="absolute inset-x-0 bottom-0 h-[2px] bg-chain-lasna" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className="relative">{t.label.toLowerCase()}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="px-5 py-6 sm:px-8">
          <Tabs.Content value="deposit">
            <Deposit d={d} p={p} tx={tx} canAct={canAct} />
          </Tabs.Content>
          <Tabs.Content value="borrow">
            <Borrow d={d} p={p} tx={tx} canAct={canAct} />
          </Tabs.Content>
          <Tabs.Content value="repay">
            <Repay d={d} p={p} tx={tx} canAct={canAct} />
          </Tabs.Content>
          <Tabs.Content value="withdraw">
            <Withdraw d={d} p={p} tx={tx} canAct={canAct} />
          </Tabs.Content>
          {shieldSupported && (
            <Tabs.Content value="shield">
              <Shield d={d} p={p} tx={tx} canAct={canAct} />
            </Tabs.Content>
          )}
        </div>
      </Tabs.Root>
    </section>
  );
}

type Props = { d: Deployments; p?: Position; tx: Tx; canAct: boolean };

function Preview({ p, next, rows }: { p?: Position; next?: Position; rows?: React.ReactNode }) {
  const now = derive(p);
  const after = derive(next);
  const tone = after && now ? (after.health >= now.health ? "good" : after.health < 1.2 ? "bad" : "neutral") : undefined;
  return (
    <div className="mt-5 border border-line bg-raised px-4 py-2">
      <Delta label="Health" from={healthText(now?.health)} to={after ? healthText(after.health) : undefined} tone={tone} />
      {rows}
    </div>
  );
}

/** Submit button; before a wallet is connected it becomes the way to connect one. */
function Cta({ canAct, ...rest }: React.ComponentProps<typeof Button> & { canAct: boolean }) {
  const { openConnectModal } = useConnectModal();
  if (!canAct)
    return (
      <Button type="button" className="mt-5 w-full" onClick={openConnectModal}>
        Connect wallet to continue
      </Button>
    );
  return <Button {...rest} className="mt-5 w-full" />;
}

function Deposit({ d, p, tx, canAct }: Props) {
  const [v, setV] = useState("");
  const amt = parse(v, COLL);
  const err = amt !== undefined && p && amt > p.weth ? "More than the WETH in your wallet." : undefined;
  const next = p && amt ? { ...p, collateral: p.collateral + amt, limit: 0n } : undefined;
  const nextLimit = next ? limitAfter(next, next.collateral) : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amt) return;
        tx.run("Deposit", "base", async () => [...(await tx.approvalFor("base", d.base.weth, d.base.vault, amt)), { address: d.base.vault, abi: vaultAbi as Abi, functionName: "deposit", args: [amt] }], {
          track: true,
          done: `Deposited ${v} WETH`,
        });
      }}
    >
      <AmountField id="dep" label="Deposit collateral on Base" value={v} onChange={setV} unit="WETH" balance={p ? fmt(p.weth, COLL, 4) : undefined} balanceLabel="Wallet" onMax={p ? () => setV(formatUnits(p.weth, COLL)) : undefined} error={err} />
      <Preview p={p} next={next} rows={<Delta label="Borrow limit" from={p ? `${fmt(p.limit, DEBT)} USDC` : "–"} to={nextLimit !== undefined ? `${fmt(nextLimit, DEBT)} USDC` : undefined} tone="good" />} />
      <Cta canAct={canAct} type="submit" busy={tx.busy === "Deposit"} disabled={!canAct || !amt || !!err || !!tx.busy}>
        Deposit WETH
      </Cta>
      <TestFaucet label="Get 1 test WETH" onClick={() => tx.run("Get test WETH", "base", [{ address: d.base.weth, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, 10n ** 18n] }], { done: "Received 1 test WETH" })} disabled={!canAct || !!tx.busy} />
    </form>
  );
}

function Borrow({ d, p, tx, canAct }: Props) {
  const [v, setV] = useState("");
  const amt = parse(v, DEBT);
  const err = amt !== undefined && p && amt > p.available ? "More than your available credit." : p?.liquidatable ? "Flagged accounts cannot borrow. Repay first." : undefined;
  const next = p && amt ? { ...p, debt: p.debt + amt } : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amt) return;
        tx.run("Borrow", "unichain", [{ address: d.unichain.market, abi: marketAbi as Abi, functionName: "borrow", args: [amt] }], { track: true, done: `Borrowed ${v} USDC` });
      }}
    >
      <AmountField id="bor" label="Borrow USDC on Unichain" value={v} onChange={setV} unit="USDC" balance={p ? fmt(p.available, DEBT) : undefined} onMax={p ? () => setV(formatUnits(p.available, DEBT)) : undefined} error={err} />
      <Preview p={p} next={next} rows={<Delta label="Debt" from={p ? `${fmt(p.debt, DEBT)} USDC` : "–"} to={next ? `${fmt(next.debt, DEBT)} USDC` : undefined} />} />
      <Cta canAct={canAct} type="submit" busy={tx.busy === "Borrow"} disabled={!canAct || !amt || !!err || !!tx.busy}>
        Borrow USDC
      </Cta>
      <p className="mt-3 text-sm text-muted">Your collateral stays on Base. Nothing is bridged.</p>
    </form>
  );
}

function Repay({ d, p, tx, canAct }: Props) {
  const [v, setV] = useState("");
  const amt = parse(v, DEBT);
  const max = p ? (p.usdc < p.debt ? p.usdc : p.debt) : 0n;
  const err = amt !== undefined && p && amt > p.usdc ? "More than the USDC in your wallet." : undefined;
  const next = p && amt ? { ...p, debt: p.debt > amt ? p.debt - amt : 0n } : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amt || !tx.address) return;
        tx.run("Repay", "unichain", async () => [...(await tx.approvalFor("unichain", d.unichain.usdc, d.unichain.market, amt)), { address: d.unichain.market, abi: marketAbi as Abi, functionName: "repay", args: [tx.address, amt] }], {
          track: true,
          done: `Repaid ${v} USDC`,
        });
      }}
    >
      <AmountField id="rep" label="Repay debt on Unichain" value={v} onChange={setV} unit="USDC" balance={p ? fmt(p.usdc, DEBT) : undefined} balanceLabel="Wallet" onMax={p ? () => setV(formatUnits(max, DEBT)) : undefined} error={err} />
      <Preview p={p} next={next} rows={<Delta label="Debt" from={p ? `${fmt(p.debt, DEBT)} USDC` : "–"} to={next ? `${fmt(next.debt, DEBT)} USDC` : undefined} tone="good" />} />
      <Cta canAct={canAct} type="submit" busy={tx.busy === "Repay"} disabled={!canAct || !amt || !!err || !!tx.busy}>
        Repay USDC
      </Cta>
      <TestFaucet label="Get 1,000 test USDC" onClick={() => tx.run("Get test USDC", "unichain", [{ address: d.unichain.usdc, abi: tokenAbi as Abi, functionName: "mint", args: [tx.address, 1_000n * 10n ** 6n] }], { done: "Received 1,000 test USDC" })} disabled={!canAct || !!tx.busy} />
    </form>
  );
}

/** Credit limit the ClearingHouse would grant for `free` collateral at the current price. */
function limitAfter(p: Position, free: bigint) {
  return (free * p.price * 10n ** BigInt(DEBT) * p.ltvBps) / (10n ** BigInt(COLL) * 10n ** 8n * 10_000n);
}

function Withdraw({ d, p, tx, canAct }: Props) {
  const [v, setV] = useState("");
  const amt = parse(v, COLL);
  // Collateral that must stay to keep the debt within the limit.
  const needed = p && p.price > 0n ? (p.debt * 10n ** BigInt(COLL) * 10n ** 8n * 10_000n + p.price * 10n ** BigInt(DEBT) * p.ltvBps - 1n) / (p.price * 10n ** BigInt(DEBT) * p.ltvBps) : 0n;
  const max = p ? (p.free > needed ? p.free - needed : 0n) : 0n;
  const err = amt !== undefined && p && amt > max ? (amt > p.free ? "More than your free collateral." : "Your debt needs this collateral. Repay first or withdraw less.") : undefined;
  const next = p && amt ? { ...p, collateral: p.collateral > amt ? p.collateral - amt : 0n } : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amt) return;
        tx.run("Withdraw", "base", [{ address: d.base.vault, abi: vaultAbi as Abi, functionName: "requestWithdraw", args: [amt] }], { track: true, done: `Withdrawal of ${v} WETH requested` });
      }}
    >
      <AmountField id="wd" label="Withdraw collateral from Base" value={v} onChange={setV} unit="WETH" balance={p ? fmt(max, COLL, 4) : undefined} balanceLabel="Safe to withdraw" onMax={p ? () => setV(formatUnits(max, COLL)) : undefined} error={err} />
      <Preview p={p} next={next} rows={<Delta label="Borrow limit" from={p ? `${fmt(p.limit, DEBT)} USDC` : "–"} to={next ? `${fmt(limitAfter(next, next.collateral - next.pending), DEBT)} USDC` : undefined} tone="bad" />} />
      <Cta canAct={canAct} type="submit" busy={tx.busy === "Withdraw"} disabled={!canAct || !amt || !!err || !!tx.busy}>
        Withdraw WETH
      </Cta>
      <p className="mt-3 text-sm text-muted">Settles in two steps: Unichain lowers your limit, then Base releases the WETH. Usually under 10 seconds.</p>
    </form>
  );
}

function Shield({ d, p, tx, canAct }: Props) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [v, setV] = useState("");
  const amt = parse(v, DEBT);
  const shield = p?.shield ?? 0n;
  const err =
    amt === undefined || !p ? undefined : mode === "add" ? (amt > p.usdc ? "More than the USDC in your wallet." : undefined) : amt > shield ? "More than your shield holds." : undefined;
  const label = mode === "add" ? "Add to shield" : "Remove from shield";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amt) return;
        if (mode === "add")
          tx.run(label, "unichain", async () => [...(await tx.approvalFor("unichain", d.unichain.usdc, d.unichain.market, amt)), { address: d.unichain.market, abi: marketAbi as Abi, functionName: "fundShield", args: [amt] }], {
            track: true,
            done: `Shield topped up by ${v} USDC`,
          });
        else tx.run(label, "unichain", [{ address: d.unichain.market, abi: marketAbi as Abi, functionName: "withdrawShield", args: [amt] }], { track: true, done: `Removed ${v} USDC from your shield` });
      }}
    >
      <div className="mb-4 inline-flex border border-line" role="radiogroup" aria-label="Shield action">
        {(["add", "remove"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx("border-r border-line px-4 py-1.5 font-mono text-xs last:border-r-0", mode === m ? "bg-ink text-paper" : "text-muted hover:bg-white/[0.04] hover:text-ink")}>
            {m === "add" ? "Add" : "Remove"}
          </button>
        ))}
      </div>
      <AmountField
        id="sh"
        label={mode === "add" ? "Set aside USDC on Unichain" : "Take USDC back"}
        value={v}
        onChange={setV}
        unit="USDC"
        balance={p ? fmt(mode === "add" ? p.usdc : shield, DEBT) : undefined}
        balanceLabel={mode === "add" ? "Wallet" : "In shield"}
        onMax={p ? () => setV(formatUnits(mode === "add" ? p.usdc : shield, DEBT)) : undefined}
        error={err}
      />
      <div className="mt-5 border border-line bg-raised px-4 py-2">
        <Delta label="Shield" from={`${fmt(shield, DEBT)} USDC`} to={amt ? `${fmt(mode === "add" ? shield + amt : shield > amt ? shield - amt : 0n, DEBT)} USDC` : undefined} tone={mode === "add" ? "good" : "bad"} />
      </div>
      <Cta canAct={canAct} type="submit" busy={tx.busy === label} disabled={!canAct || !amt || !!err || !!tx.busy}>
        {label}
      </Cta>
      <p className="mt-3 text-sm text-muted">If WETH falls far enough, Lien repays part of your loan from the shield in the same step that would flag you for liquidation. Liquidators never get the chance.</p>
    </form>
  );
}

function TestFaucet({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <div className="mt-3 text-center">
      <Button type="button" tone="ghost" size="sm" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}
