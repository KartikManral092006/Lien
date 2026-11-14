import type { Summary } from "../lib/data";

const NAMES: Record<string, string> = {
  deposit_to_credit: "Deposit to credit",
  withdraw_two_phase: "Two-phase withdrawal",
  price_to_limit: "Price drop to new limit",
  liquidation_cross_chain: "Liquidation to seizure",
  protection: "Price drop to shield repay",
};

export function Performance({ summary }: { summary?: Summary | null }) {
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
                <th className="pb-2 text-right font-normal">Median</th>
                <th className="pb-2 text-right font-normal">p95</th>
                <th className="pb-2 text-right font-normal">Runs</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.flows).map(([k, f]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-2.5">{NAMES[k] ?? k}</td>
                  <td className="py-2.5 text-right font-medium">{(f.p50 / 1000).toFixed(1)}s</td>
                  <td className="py-2.5 text-right text-muted">{(f.p95 / 1000).toFixed(1)}s</td>
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
          <p className="mt-3 text-xs text-faint">Small samples so far. Updated {new Date(summary.generatedAt).toLocaleDateString()}.</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Benchmark results appear here after the next measured run.</p>
      )}
    </section>
  );
}
