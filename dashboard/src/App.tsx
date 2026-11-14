import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, isAddress, maxUint256, parseUnits, type Abi, type Address, type Chain } from "viem";
import {
  chAbi,
  chains,
  feedAbi,
  fmt,
  KIND_NAMES,
  marketAbi,
  pub,
  short,
  tokenAbi,
  txUrl,
  vaultAbi,
  type ChainKey,
  type Deployments,
} from "./chain";

type State = {
  collateral: bigint;
  pending: bigint;
  free: bigint;
  weth: bigint;
  price: bigint;
  ch: { collateral: bigint; pending: bigint; debt: bigint; limit: bigint; seq: bigint; liquidatable: boolean; tracked: boolean };
  chPrice: bigint;
  ltv: bigint;
  lt: bigint;
  debt: bigint;
  limit: bigint;
  available: bigint;
  liquidatable: boolean;
  usdc: bigint;
};

type Item = { key: string; chain: ChainKey; name: string; detail: string; tx: string; block: bigint; ts: number; user?: string };

type Summary = {
  generatedAt: string;
  flows: Record<string, { n: number; p50: number; p90: number; p95: number; max: number; failures: number }>;
  race?: { attempts: number; released: number; borrowed: number; both: number; insolvent: number };
};

type Step = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

const WINDOW: Record<ChainKey, bigint> = { base: 3000n, unichain: 900n, lasna: 900n };

async function readState(d: Deployments, who: Address): Promise<State> {
  const [collateral, pending, free, weth, price, chAcc, chPrice, ltv, lt, debt, limit, available, liquidatable, usdc] = await Promise.all([
    pub.base.readContract({ address: d.base.vault, abi: vaultAbi, functionName: "collateralOf", args: [who] }),
    pub.base.readContract({ address: d.base.vault, abi: vaultAbi, functionName: "pendingOf", args: [who] }),
    pub.base.readContract({ address: d.base.vault, abi: vaultAbi, functionName: "freeCollateralOf", args: [who] }),
    pub.base.readContract({ address: d.base.weth, abi: tokenAbi, functionName: "balanceOf", args: [who] }),
    pub.base.readContract({ address: d.base.feed, abi: feedAbi, functionName: "price" }),
    pub.lasna.readContract({ address: d.lasna.clearingHouse, abi: chAbi, functionName: "accounts", args: [who] }),
    pub.lasna.readContract({ address: d.lasna.clearingHouse, abi: chAbi, functionName: "price" }),
    pub.lasna.readContract({ address: d.lasna.clearingHouse, abi: chAbi, functionName: "ltvBps" }),
    pub.lasna.readContract({ address: d.lasna.clearingHouse, abi: chAbi, functionName: "ltBps" }),
    pub.unichain.readContract({ address: d.unichain.market, abi: marketAbi, functionName: "debtOf", args: [who] }),
    pub.unichain.readContract({ address: d.unichain.market, abi: marketAbi, functionName: "limitOf", args: [who] }),
    pub.unichain.readContract({ address: d.unichain.market, abi: marketAbi, functionName: "availableCredit", args: [who] }),
    pub.unichain.readContract({ address: d.unichain.market, abi: marketAbi, functionName: "liquidatable", args: [who] }),
    pub.unichain.readContract({ address: d.unichain.usdc, abi: tokenAbi, functionName: "balanceOf", args: [who] }),
  ]);
  const [c, p, dd, l, s, lq, t] = chAcc;
  return {
    collateral,
    pending,
    free,
    weth,
    price,
    ch: { collateral: c, pending: p, debt: dd, limit: l, seq: BigInt(s), liquidatable: lq, tracked: t },
    chPrice,
    ltv,
    lt,
    debt,
    limit,
    available,
    liquidatable,
    usdc,
  };
}

const blockTs = new Map<string, number>();
async function tsOf(chain: ChainKey, block: bigint) {
  const k = `${chain}:${block}`;
  const hit = blockTs.get(k);
  if (hit !== undefined) return hit;
  const b = await pub[chain].getBlock({ blockNumber: block });
  const v = Number(b.timestamp) * 1000;
  blockTs.set(k, v);
  return v;
}

function describe(name: string, a: Record<string, any>): string {
  switch (name) {
    case "Deposited":
      return `+${fmt(a.amount, 18, 4)} WETH deposited`;
    case "WithdrawRequested":
      return `withdraw #${a.reqId} of ${fmt(a.amount, 18, 4)} WETH requested`;
    case "WithdrawSettled":
      return `withdraw #${a.reqId} ${a.released ? "released" : "rejected"}`;
    case "Seized":
      return `${fmt(a.amount, 18, 4)} WETH paid to liquidator (liq #${a.liqId})`;
    case "PriceUpdated":
      return `price set to $${fmt(a.price, 8)}`;
    case "DebtUpdated":
      return `debt ${a.change >= 0n ? "+" : ""}${fmt(a.change, 6)} → ${fmt(a.debt, 6)} USDC`;
    case "LimitApplied":
      return `limit ${fmt(a.limit, 6)} USDC (seq ${a.seq})${a.liquidatable ? " · LIQUIDATABLE" : ""}${a.reqId > 0n ? ` · debt snapshot ${fmt(a.debt, 6)} for withdraw #${a.reqId}` : ""}`;
    case "Liquidated":
      return `liquidator repaid ${fmt(a.repaid, 6)} USDC (liq #${a.liqId})`;
    case "Reacted":
      return `reacted to ${KIND_NAMES[Number(a.kind)] ?? a.kind} from ${Number(a.originChainId) === 84532 ? "Base" : "Unichain"}`;
    case "SyncSent":
      return `→ Unichain: limit ${fmt(a.limit, 6)}${a.liquidatable ? ", liquidatable" : ""} (seq ${a.seq})`;
    case "WithdrawDecision":
      return `→ Base: ${a.release ? "RELEASE" : "REJECT"} withdraw #${a.reqId} (debt ${fmt(a.debt, 6)} vs ${fmt(a.limitAfter, 6)})`;
    case "SeizeSent":
      return `→ Base: seize ${fmt(a.amount, 18, 4)} WETH (liq #${a.liqId})`;
    default:
      return name;
  }
}

async function fetchTimeline(d: Deployments): Promise<Item[]> {
  const sources: { chain: ChainKey; address: Address; abi: Abi; from: number }[] = [
    { chain: "base", address: d.base.vault, abi: vaultAbi, from: d.base.fromBlock },
    { chain: "base", address: d.base.feed, abi: feedAbi, from: d.base.fromBlock },
    { chain: "unichain", address: d.unichain.market, abi: marketAbi, from: d.unichain.fromBlock },
    { chain: "lasna", address: d.lasna.clearingHouse, abi: chAbi, from: d.lasna.fromBlock },
  ];
  const heads = await Promise.all((["base", "unichain", "lasna"] as ChainKey[]).map((c) => pub[c].getBlockNumber()));
  const head: Record<ChainKey, bigint> = { base: heads[0], unichain: heads[1], lasna: heads[2] };
  const batches = await Promise.all(
    sources.map(async (s) => {
      const lo = head[s.chain] > WINDOW[s.chain] ? head[s.chain] - WINDOW[s.chain] : 0n;
      const fromBlock = lo > BigInt(s.from) ? lo : BigInt(s.from);
      const logs = await (pub[s.chain] as any).getContractEvents({ address: s.address, abi: s.abi, fromBlock });
      return (logs as any[]).map((l) => ({ ...l, chain: s.chain }));
    }),
  );
  const flat = batches.flat().sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 60);
  const items = await Promise.all(
    flat.map(async (l): Promise<Item> => ({
      key: `${l.chain}:${l.transactionHash}:${l.logIndex}`,
      chain: l.chain,
      name: l.eventName,
      detail: describe(l.eventName, l.args),
      tx: l.transactionHash,
      block: l.blockNumber,
      ts: await tsOf(l.chain, l.blockNumber),
      user: l.args?.user,
    })),
  );
  return items.sort((a, b) => b.ts - a.ts || (a.chain === b.chain ? Number(b.block - a.block) : 0)).slice(0, 40);
}

function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const v = await fnRef.current();
        if (alive) {
          setData(v);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, deps);
  return { data, err };
}

async function walletFor(chain: Chain) {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  const w = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await w.requestAddresses();
  try {
    await w.switchChain({ id: chain.id });
  } catch (e: any) {
    if (e?.code === 4902 || /unrecognized|not been added|unknown chain/i.test(e?.message ?? "")) {
      await w.addChain({ chain });
      await w.switchChain({ id: chain.id });
    } else {
      throw e;
    }
  }
  return { w, account };
}

export default function App() {
  const [deps, setDeps] = useState<Deployments | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch("/deployments.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDeps)
      .catch(() => setMissing(true));
  }, []);
  if (missing)
    return (
      <main className="shell">
        <Header />
        <section className="panel">
          <h2>Not deployed yet</h2>
          <p>
            Run <code>scripts/deploy.sh</code> from the project root. It writes <code>dashboard/public/deployments.json</code>, then reload this page.
          </p>
        </section>
      </main>
    );
  if (!deps)
    return (
      <main className="shell">
        <Header />
      </main>
    );
  return <Dashboard d={deps} />;
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="top">
      <div>
        <h1>Lien</h1>
        <p className="tag">Collateral on Base · Credit on Unichain · One ledger on Reactive</p>
      </div>
      {right}
    </header>
  );
}

function Dashboard({ d }: { d: Deployments }) {
  const [connected, setConnected] = useState<Address | null>(null);
  const [watchInput, setWatchInput] = useState<string>(d.deployer);
  const who = (connected ?? (isAddress(watchInput) ? watchInput : d.deployer)) as Address;
  const state = usePoll(() => readState(d, who), 2500, [who]);
  const timeline = usePoll(() => fetchTimeline(d), 4000, []);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ label: string; chain: ChainKey; hash?: string; error?: string; at: number }[]>([]);
  const [amt, setAmt] = useState({ deposit: "1", withdraw: "0.2", borrow: "1000", repay: "500", liq: "500", liqTarget: "" });

  useEffect(() => {
    fetch("/summary.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => null);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) return alert("No browser wallet found. Install MetaMask or Rabby.");
    const w = createWalletClient({ transport: custom(window.ethereum) });
    const [a] = await w.requestAddresses();
    setConnected(a);
  }, []);

  async function act(label: string, chain: "base" | "unichain", steps: Step[]) {
    setBusy(label);
    try {
      const { w, account } = await walletFor(chains[chain]);
      setConnected(account);
      for (const s of steps) {
        const hash = await (w as any).writeContract({ ...s, account, chain: chains[chain] });
        setLog((l) => [{ label: `${label}: ${s.functionName}`, chain, hash, at: Date.now() }, ...l].slice(0, 8));
        await pub[chain].waitForTransactionReceipt({ hash });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      setLog((l) => [{ label, chain, error: msg, at: Date.now() }, ...l].slice(0, 8));
    } finally {
      setBusy(null);
    }
  }

  async function withApproval(chain: "base" | "unichain", token: Address, spender: Address, amount: bigint): Promise<Step[]> {
    const allowance = await pub[chain].readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [who, spender] });
    return allowance >= amount ? [] : [{ address: token, abi: tokenAbi as Abi, functionName: "approve", args: [spender, maxUint256] }];
  }

  const s = state.data;
  const value = s ? (s.collateral * s.price * 10n ** 6n) / (10n ** 18n * 10n ** 8n) : 0n;
  const health = s && s.debt > 0n ? Number((value * s.lt) / 10_000n) / Number(s.debt) : Infinity;
  const healthPct = Number.isFinite(health) ? Math.max(0, Math.min(100, (health / 2) * 100)) : 100;
  const tone = s?.liquidatable ? "bad" : health < 1.2 ? "warn" : "good";
  const parse = (v: string, dec: number) => {
    try {
      return parseUnits(v || "0", dec);
    } catch {
      return 0n;
    }
  };
  const target = (isAddress(amt.liqTarget) ? amt.liqTarget : who) as Address;
  const locked = !!busy || !connected;

  return (
    <main className="shell">
      <Header
        right={
          <div className="who">
            {connected ? <span className="pill">Connected {short(connected)}</span> : <button onClick={connect}>Connect wallet</button>}
            {!connected && <input className="addr" value={watchInput} onChange={(e) => setWatchInput(e.target.value)} placeholder="Watch address" />}
          </div>
        }
      />

      <section className="health panel">
        <div className="health-row">
          <div>
            <span className="label">Account</span>
            <span className="mono">{short(who)}</span>
          </div>
          <div>
            <span className="label">Collateral value</span>
            <span className="mono">${fmt(value, 6)}</span>
          </div>
          <div>
            <span className="label">Debt</span>
            <span className="mono">${fmt(s?.debt, 6)}</span>
          </div>
          <div>
            <span className="label">Health</span>
            <span className={`mono ${tone}`}>
              {Number.isFinite(health) ? health.toFixed(3) : "∞"}
              {s?.liquidatable ? " · liquidatable" : ""}
            </span>
          </div>
        </div>
        <div className="meter">
          <div className={`fill ${tone}`} style={{ width: `${healthPct}%` }} />
          <div className="tick" style={{ left: "50%" }} title="health 1.0" />
        </div>
        {!connected && <p className="note">Connect a wallet to use the buttons. Until then you are watching {short(who)}.</p>}
        {state.err && <p className="err">RPC: {state.err}</p>}
      </section>

      <section className="grid">
        <article className="panel chain base">
          <h2>
            Base Sepolia <small>CollateralVault</small>
          </h2>
          <Row k="Collateral" v={`${fmt(s?.collateral, 18, 4)} WETH`} />
          <Row k="Pending withdrawal" v={`${fmt(s?.pending, 18, 4)} WETH`} />
          <Row k="Wallet WETH" v={`${fmt(s?.weth, 18, 4)}`} />
          <Row k="Oracle price" v={`$${fmt(s?.price, 8)}`} />
          <div className="actions">
            <button disabled={locked} onClick={() => act("Mint 1 test WETH", "base", [{ address: d.base.weth, abi: tokenAbi, functionName: "mint", args: [who, 10n ** 18n] }])}>
              Mint 1 WETH
            </button>
            <label>
              <input value={amt.deposit} onChange={(e) => setAmt({ ...amt, deposit: e.target.value })} />
              <button
                disabled={locked}
                onClick={async () => {
                  const a = parse(amt.deposit, 18);
                  act("Deposit", "base", [...(await withApproval("base", d.base.weth, d.base.vault, a)), { address: d.base.vault, abi: vaultAbi, functionName: "deposit", args: [a] }]);
                }}
              >
                Deposit
              </button>
            </label>
            <label>
              <input value={amt.withdraw} onChange={(e) => setAmt({ ...amt, withdraw: e.target.value })} />
              <button disabled={locked} onClick={() => act("Withdraw", "base", [{ address: d.base.vault, abi: vaultAbi, functionName: "requestWithdraw", args: [parse(amt.withdraw, 18)] }])}>
                Withdraw
              </button>
            </label>
            <div className="split">
              <button className="danger" disabled={locked || !s} onClick={() => s && act("Crash price 25%", "base", [{ address: d.base.feed, abi: feedAbi, functionName: "setPrice", args: [(s.price * 75n) / 100n] }])}>
                Crash price −25%
              </button>
              <button disabled={locked} onClick={() => act("Restore price", "base", [{ address: d.base.feed, abi: feedAbi, functionName: "setPrice", args: [2_000n * 10n ** 8n] }])}>
                Restore $2,000
              </button>
            </div>
          </div>
        </article>

        <article className="panel chain lasna">
          <h2>
            Reactive Lasna <small>ClearingHouse</small>
          </h2>
          <Row k="Ledger collateral" v={`${fmt(s?.ch.collateral, 18, 4)} WETH`} />
          <Row k="Ledger pending" v={`${fmt(s?.ch.pending, 18, 4)} WETH`} />
          <Row k="Ledger debt" v={`${fmt(s?.ch.debt, 6)} USDC`} />
          <Row k="Limit sent" v={`${fmt(s?.ch.limit, 6)} USDC`} />
          <Row k="Sequence" v={s ? s.ch.seq.toString() : "–"} />
          <Row k="Price seen" v={`$${fmt(s?.chPrice, 8)}`} />
          <Row k="LTV / LT" v={s ? `${Number(s.ltv) / 100}% / ${Number(s.lt) / 100}%` : "–"} />
          <p className="note">Only this contract decides credit limits, withdrawals and seizures. Base and Unichain never talk to each other directly.</p>
        </article>

        <article className="panel chain unichain">
          <h2>
            Unichain Sepolia <small>CreditMarket</small>
          </h2>
          <Row k="Debt" v={`${fmt(s?.debt, 6)} USDC`} />
          <Row k="Credit limit" v={`${fmt(s?.limit, 6)} USDC`} />
          <Row k="Available" v={`${fmt(s?.available, 6)} USDC`} />
          <Row k="Wallet USDC" v={fmt(s?.usdc, 6)} />
          <Row k="Liquidatable" v={s?.liquidatable ? "yes" : "no"} />
          <div className="actions">
            <label>
              <input value={amt.borrow} onChange={(e) => setAmt({ ...amt, borrow: e.target.value })} />
              <button disabled={locked} onClick={() => act("Borrow", "unichain", [{ address: d.unichain.market, abi: marketAbi, functionName: "borrow", args: [parse(amt.borrow, 6)] }])}>
                Borrow
              </button>
            </label>
            <label>
              <input value={amt.repay} onChange={(e) => setAmt({ ...amt, repay: e.target.value })} />
              <button
                disabled={locked}
                onClick={async () => {
                  const a = parse(amt.repay, 6);
                  act("Repay", "unichain", [
                    { address: d.unichain.usdc, abi: tokenAbi, functionName: "mint", args: [who, a] },
                    ...(await withApproval("unichain", d.unichain.usdc, d.unichain.market, a)),
                    { address: d.unichain.market, abi: marketAbi, functionName: "repay", args: [who, a] },
                  ]);
                }}
              >
                Repay
              </button>
            </label>
            <input className="addr" value={amt.liqTarget} onChange={(e) => setAmt({ ...amt, liqTarget: e.target.value })} placeholder="Liquidate account (default: you)" />
            <label>
              <input value={amt.liq} onChange={(e) => setAmt({ ...amt, liq: e.target.value })} />
              <button
                className="danger"
                disabled={locked}
                onClick={async () => {
                  const a = parse(amt.liq, 6);
                  act("Liquidate", "unichain", [
                    { address: d.unichain.usdc, abi: tokenAbi, functionName: "mint", args: [who, a] },
                    ...(await withApproval("unichain", d.unichain.usdc, d.unichain.market, a)),
                    { address: d.unichain.market, abi: marketAbi, functionName: "liquidate", args: [target, a] },
                  ]);
                }}
              >
                Liquidate
              </button>
            </label>
          </div>
        </article>
      </section>

      {(busy || log.length > 0) && (
        <section className="panel txlog">
          <h3>{busy ? `Working: ${busy}…` : "Your transactions"}</h3>
          {log.map((l, i) => (
            <div key={i} className={`txrow ${l.error ? "err" : ""}`}>
              <span className={`dot ${l.chain}`} />
              <span>{l.label}</span>
              {l.hash ? (
                <a href={txUrl[l.chain] + l.hash} target="_blank" rel="noreferrer">
                  {short(l.hash)}
                </a>
              ) : (
                <span className="err">{l.error}</span>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <h3>Live cross-chain timeline</h3>
        {timeline.err && <p className="err">{timeline.err}</p>}
        <ol className="timeline">
          {(timeline.data ?? []).map((it) => (
            <li key={it.key} className={it.user && it.user.toLowerCase() === who.toLowerCase() ? "mine" : ""}>
              <span className={`dot ${it.chain}`} />
              <span className="time mono">{new Date(it.ts).toLocaleTimeString()}</span>
              <span className={`chip ${it.chain}`}>{it.chain}</span>
              <span className="what">{it.detail}</span>
              <a className="mono" href={txUrl[it.chain] + it.tx} target="_blank" rel="noreferrer">
                {short(it.tx)}
              </a>
            </li>
          ))}
          {timeline.data && timeline.data.length === 0 && <li className="empty">No events yet. Deposit to start the loop.</li>}
        </ol>
      </section>

      {summary && (
        <section className="panel">
          <h3>Measured latency</h3>
          <p className="note">From results/runs.jsonl, generated {new Date(summary.generatedAt).toLocaleString()}.</p>
          <table>
            <thead>
              <tr>
                <th>Flow</th>
                <th>n</th>
                <th>p50</th>
                <th>p90</th>
                <th>p95</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.flows).map(([k, f]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{f.n}</td>
                  <td>{(f.p50 / 1000).toFixed(2)} s</td>
                  <td>{(f.p90 / 1000).toFixed(2)} s</td>
                  <td>{(f.p95 / 1000).toFixed(2)} s</td>
                  <td>{(f.max / 1000).toFixed(2)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.race && (
            <p className="race">
              Race attack: {summary.race.attempts} attempts · {summary.race.released} withdrawals released · {summary.race.borrowed} borrows filled ·{" "}
              <strong className={summary.race.insolvent ? "bad" : "good"}>{summary.race.insolvent} insolvent</strong>
            </p>
          )}
        </section>
      )}

      <footer>
        Testnet demo with mock tokens and a mock oracle. Contracts: ClearingHouse {short(d.lasna.clearingHouse)} · Vault {short(d.base.vault)} · Market {short(d.unichain.market)}
      </footer>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="label">{k}</span>
      <span className="mono">{v}</span>
    </div>
  );
}
