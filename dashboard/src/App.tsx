import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { Actions } from "./components/Actions";
import { Activity } from "./components/Activity";
import { Checklist } from "./components/Checklist";
import { CommandPalette } from "./components/CommandPalette";
import { LoopDock } from "./components/LoopDock";
import { PriceSimulator } from "./components/PriceSimulator";
import { Band, Frame, RevealHeading } from "./components/grid";
import { HowItWorks } from "./components/HowItWorks";
import { Logo } from "./components/Logo";
import { Navbar } from "./components/Navbar";
import { Performance } from "./components/Performance";
import { Position } from "./components/Position";
import { RescueReplay } from "./components/RescueReplay";
import { SettlementLoop } from "./components/SettlementLoop";
import { ScrollProgress } from "./components/SmoothScroll";
import { StressTools } from "./components/StressTools";
import { Hero } from "./components/hero/Hero";
import { explorer, short, type Deployments } from "./lib/chain";
import { useActivity, useDeployments, usePosition, useShieldSupport, useSummary } from "./lib/data";
import { useTx } from "./lib/tx";

export default function App() {
  const deps = useDeployments();
  const summary = useSummary();
  const { address } = useAccount();
  const demo = usePosition(deps.data, address ?? deps.data?.deployer);
  return (
    <>
      <a href="#main" className="fixed left-4 top-3 z-[70] -translate-y-20 bg-ink px-4 py-2 text-sm font-medium text-paper focus:translate-y-0">
        Skip to dashboard
      </a>
      <ScrollProgress />
      <Navbar />
      <Frame>
        <Hero summary={summary.data} price={demo.data?.price} />
        <RescueReplay />
        {deps.isError ? <NotDeployed /> : deps.data ? <Dashboard d={deps.data} /> : <Loading />}
      </Frame>
    </>
  );
}

function Dashboard({ d }: { d: Deployments }) {
  const { address } = useAccount();
  const [watch, setWatch] = useState("");
  const watched = isAddress(watch) ? (watch as Address) : undefined;
  const who = (address ?? watched ?? d.deployer) as Address;
  const viewing = address ? "you" : watched ? "other" : "demo";

  const position = usePosition(d, who);
  const activity = useActivity(d);
  const summary = useSummary();
  const shield = useShieldSupport(d);
  const tx = useTx(d);
  const canAct = !!address;
  const heading = viewing === "you" ? "Your position" : viewing === "demo" ? "The demo account" : `Account ${short(who)}`;

  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <CommandPalette d={d} tx={tx} shieldSupported={!!shield.data} connected={canAct} />
      <LoopDock />
      <Band
        id="position"
        label="position"
        aside={
          !address ? (
            <label className="flex items-center gap-3">
              <span className="hidden sm:inline">{viewing === "demo" ? "viewing demo account" : `viewing ${short(who)}`}</span>
              <input
                value={watch}
                onChange={(e) => setWatch(e.target.value.trim())}
                placeholder="look up 0x…"
                aria-label="Look up any address"
                className="h-7 w-40 border border-line bg-transparent px-2 font-mono text-xs text-ink outline-none transition-colors focus:border-chain-lasna sm:w-64"
              />
            </label>
          ) : (
            <span>connected</span>
          )
        }
      >
        <div className="border-b border-line px-5 py-12 sm:px-8 sm:py-16">
          <RevealHeading text={heading} className="text-[clamp(2rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]" />
          {position.isError && !position.data && <p className="mt-4 text-sm text-caution">Could not reach one of the networks. Retrying every few seconds.</p>}
        </div>
        <Checklist d={d} p={canAct ? position.data : undefined} tx={tx} shieldSupported={!!shield.data} connected={canAct} />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_460px] *:min-w-0">
          <div className="px-5 py-10 sm:px-8">
            <Position p={position.data} shieldSupported={!!shield.data} account={who} />
          </div>
          <div className="border-t border-line lg:border-l lg:border-t-0">
            <Actions d={d} p={position.data} tx={tx} shieldSupported={!!shield.data} canAct={canAct} />
          </div>
        </div>
        <PriceSimulator p={position.data} shieldSupported={!!shield.data} />
      </Band>

      <HowItWorks />
      <SettlementLoop />

      <Band id="activity" label="activity">
        <Activity items={activity.data} error={activity.isError} who={who} />
        <div className="grid border-t border-line lg:grid-cols-2 *:min-w-0">
          <Performance summary={summary.data} />
          <div className="border-t border-line lg:border-l lg:border-t-0">
            <StressTools d={d} p={position.data} tx={tx} who={who} canAct={canAct} />
          </div>
        </div>
      </Band>

      <Footer d={d} />
    </main>
  );
}

function Footer({ d }: { d: Deployments }) {
  const links: [string, string][] = [
    ["ClearingHouse on Lasna", explorer.address.lasna + d.lasna.clearingHouse],
    ["CollateralVault on Base", explorer.address.base + d.base.vault],
    ["CreditMarket on Unichain", explorer.address.unichain + d.unichain.market],
  ];
  return (
    <Band id="contracts" label="contracts">
      <div className="grid md:grid-cols-2">
        <div className="px-5 py-10 sm:px-8">
          <Logo />
          <p className="mt-4 max-w-[40ch] text-sm text-muted">Collateral on Base. Credit on Unichain. One ledger on Reactive.</p>
          <p className="mt-8 font-mono text-xs text-faint">Testnet only. Test tokens, a test oracle, and contracts that have not been audited.</p>
        </div>
        <ul className="border-t border-line md:border-l md:border-t-0">
          {links.map(([label, href]) => (
            <li key={label} className="border-b border-line last:border-b-0">
              <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between px-5 py-5 text-sm text-muted transition-colors hover:bg-white/[0.03] hover:text-ink sm:px-8">
                {label}
                <span className="font-mono text-xs text-faint">explorer</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}

function NotDeployed() {
  return (
    <Band label="setup">
      <div className="px-5 py-16 sm:px-8">
        <h2 className="text-2xl font-semibold">No deployment found</h2>
        <p className="mt-3 max-w-[60ch] text-muted">
          Run <code className="bg-raised px-1.5 py-0.5 font-mono text-sm">scripts/deploy.sh</code> from the project root. It writes the contract addresses this page reads, then reload.
        </p>
      </div>
    </Band>
  );
}

function Loading() {
  return (
    <Band label="loading">
      <div className="grid lg:grid-cols-[1fr_460px]" aria-busy="true">
        <div className="h-96 animate-pulse bg-white/[0.02]" />
        <div className="h-96 animate-pulse border-l border-line bg-white/[0.02]" />
      </div>
    </Band>
  );
}
