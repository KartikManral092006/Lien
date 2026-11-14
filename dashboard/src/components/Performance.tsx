import type { Summary } from "../lib/data";

const NAMES: Record<string, string> = {
  deposit_to_credit: "Deposit to credit",
  withdraw_two_phase: "Two-phase withdrawal",
  price_to_limit: "Price drop to new limit",
  liquidation_cross_chain: "Liquidation to seizure",
  protection: "Price drop to shield repay",
};

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const s0 = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

/**
 * Two clocks per flow. On-chain is block timestamp to block timestamp (whole seconds, about ±1 s), the
 * figure comparable with other on-chain measurements. Wall clock adds the wait for the origin receipt and
 * RPC polling, so it is what a person watching the page experiences.
 */
export function Performance({ summary }: { summary?: Summary | null }) {
  const hasOnchain = !!summary && Object.values(summary.flows).some((f) => f.onchain);
  return (
    <section className="px-5 py-8 sm:px-8" aria-labelledby="perf-h">
      <h2 id="perf-h" className="text-sm font-medium text-muted">
        Measured on testnet
      </h2>
      {summary ? (
        <>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="pb-2 font-normal">Flow, first tx to last callback</th>
                {hasOnchain && <th className="pb-2 text-right font-normal">On-chain p50</th>}
                <th className="pb-2 text-right font-normal">{hasOnchain ? "Wall clock p50" : "Median"}</th>
                <th className="pb-2 text-right font-normal">p95</th>
                <th className="pb-2 text-right font-normal">Runs</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.flows).map(([k, f]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-2.5">{NAMES[k] ?? k}</td>
                  {hasOnchain && <td className="py-2.5 text-right font-medium">{f.onchain ? s0(f.onchain.p50) : "–"}</td>}
                  <td className={hasOnchain ? "py-2.5 text-right text-muted" : "py-2.5 text-right font-medium"}>{s1(f.p50)}</td>
                  <td className="py-2.5 text-right text-muted">{s1(f.p95)}</td>
                  <td className="py-2.5 text-right text-muted">{f.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.race && (
            <p className="mt-4 text-sm text-muted">
              Race test: {summary.race.attempts} simultaneous withdraw-and-borrow attempts,{" "}
              <strong className={summary.race.insolvent ? "text-danger" : "text-safe"}>{summary.race.insolvent} left the protocol short</strong>.
            </p>
          )}
          {hasOnchain && (
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-faint">
              On-chain: origin block to final callback block, from block timestamps. Whole seconds on three chains, so about ±1 s. Wall clock adds the wait for
              the origin receipt and RPC polling; p95 is wall clock.
            </p>
          )}
          <p className="mt-3 text-xs text-faint">Small samples so far. Updated {new Date(summary.generatedAt).toLocaleDateString()}.</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Benchmark results appear here after the next measured run.</p>
      )}
    </section>
  );
}
