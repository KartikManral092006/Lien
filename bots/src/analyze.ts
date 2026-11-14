import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNS = path.join(ROOT, "results", "runs.jsonl");

type Leg = { name: string; chain: string; observedAtMs: number; blockTimeMs: number };
type Run = {
  flow: string;
  ok: boolean;
  startedAtMs: number;
  legs?: Leg[];
  totalObservedMs?: number;
  totalBlockMs?: number;
  note?: string;
  released?: boolean;
  borrowed?: boolean;
  solvent?: boolean;
};

function pct(xs: number[], p: number) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

const sec = (ms: number) => (Number.isNaN(ms) ? "-" : (ms / 1000).toFixed(2));

function main() {
  if (!existsSync(RUNS)) {
    console.log("No results/runs.jsonl yet. Run npm run demo, bench or race first.");
    return;
  }
  const runs: Run[] = readFileSync(RUNS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const byFlow = new Map<string, Run[]>();
  const failures = new Map<string, number>();
  for (const r of runs) {
    if (!r.ok) {
      failures.set(r.flow, (failures.get(r.flow) ?? 0) + 1);
      continue;
    }
    if (!r.legs || r.note) continue;
    const list = byFlow.get(r.flow) ?? [];
    list.push(r);
    byFlow.set(r.flow, list);
  }

  const summary: Record<string, unknown> = { generatedAt: new Date().toISOString(), flows: {} as Record<string, unknown> };
  const lines: string[] = ["# Lien measured results", "", `Generated ${summary.generatedAt} from \`results/runs.jsonl\`.`, ""];
  lines.push("Times are wall-clock from submitting the origin transaction to observing each leg via RPC polling (250 ms interval), so each figure carries up to ~0.25 s of observation lag.", "");
  lines.push("| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | failures |", "|---|---|---|---|---|---|---|");

  const flowsOut = summary.flows as Record<string, unknown>;
  const legSections: string[] = [];
  const chainRows: string[] = [];
  for (const [flow, list] of byFlow) {
    const totals = list.map((r) => r.totalObservedMs ?? NaN).filter((x) => !Number.isNaN(x));
    lines.push(`| ${flow} | ${totals.length} | ${sec(pct(totals, 50))} | ${sec(pct(totals, 90))} | ${sec(pct(totals, 95))} | ${sec(Math.max(...totals))} | ${failures.get(flow) ?? 0} |`);

    const legNames = list[0].legs!.map((l) => `${l.chain}: ${l.name}`);
    const legStats = legNames.map((name, i) => {
      const deltas = list
        .filter((r) => r.legs!.length === legNames.length)
        .map((r) => r.legs![i].observedAtMs - (i === 0 ? r.startedAtMs : r.legs![i - 1].observedAtMs));
      return { name, p50: pct(deltas, 50), p95: pct(deltas, 95) };
    });
    // On-chain latency: first leg's block timestamp to the last leg's, independent of RPC polling and of
    // the wait for the origin transaction's receipt. Whole-second timestamps, so values are multiples of 1 s.
    const full = list.filter((r) => r.legs!.length === legNames.length);
    const chainTotals = full.map((r) => r.legs![r.legs!.length - 1].blockTimeMs - r.legs![0].blockTimeMs);
    const chainLegs = legNames.slice(1).map((name, j) => {
      const deltas = full.map((r) => r.legs![j + 1].blockTimeMs - r.legs![j].blockTimeMs);
      return { name, p50: pct(deltas, 50), min: Math.min(...deltas), max: Math.max(...deltas) };
    });
    const onchain = chainTotals.length
      ? { n: chainTotals.length, p50: pct(chainTotals, 50), p90: pct(chainTotals, 90), p95: pct(chainTotals, 95), max: Math.max(...chainTotals), legs: chainLegs }
      : undefined;
    if (onchain) {
      chainRows.push(`| ${flow} | ${onchain.n} | ${sec(onchain.p50)} | ${sec(onchain.p90)} | ${sec(onchain.p95)} | ${sec(onchain.max)} | ${sec(pct(totals, 50))} |`);
    }

    legSections.push(`### ${flow}`, "", "| Leg | p50 (s) | p95 (s) |", "|---|---|---|", ...legStats.map((l) => `| ${l.name} | ${sec(l.p50)} | ${sec(l.p95)} |`), "");
    if (onchain) {
      legSections.push(
        "On-chain gap from the previous leg's block (block timestamps):",
        "",
        "| Leg | p50 (s) | min (s) | max (s) |",
        "|---|---|---|---|",
        ...chainLegs.map((l) => `| ${l.name} | ${sec(l.p50)} | ${sec(l.min)} | ${sec(l.max)} |`),
        "",
      );
    }
    flowsOut[flow] = {
      n: totals.length,
      p50: pct(totals, 50),
      p90: pct(totals, 90),
      p95: pct(totals, 95),
      max: Math.max(...totals),
      failures: failures.get(flow) ?? 0,
      legs: legStats,
      onchain,
    };
  }

  if (chainRows.length) {
    lines.push(
      "",
      "## On-chain latency (block to block)",
      "",
      "From the origin transaction's block to the block of the final callback, using each chain's block timestamp. This excludes the wait for the origin receipt and RPC polling, so it is the figure to compare with other block-to-block measurements.",
      "",
      "Caveat: whole-second block timestamps on three chains; accurate to about ±1 s; per-leg values can be negative because chain clocks differ.",
      "",
      "| Flow | n | p50 (s) | p90 (s) | p95 (s) | max (s) | wall-clock p50 (s) |",
      "|---|---|---|---|---|---|---|",
      ...chainRows,
    );
  }

  const race = runs.filter((r) => r.flow === "race_attack" && r.ok);
  if (race.length) {
    const released = race.filter((r) => r.released).length;
    const borrowed = race.filter((r) => r.borrowed).length;
    const both = race.filter((r) => r.released && r.borrowed).length;
    const insolvent = race.filter((r) => !r.solvent).length;
    summary.race = { attempts: race.length, released, borrowed, both, insolvent };
    lines.push("", "## Race attack", "", "Each attempt submits a full-collateral withdrawal on Base and a full-credit borrow on Unichain at the same moment.", "");
    lines.push("| Attempts | Withdrawals released | Borrows filled | Both succeeded | Insolvent outcomes |", "|---|---|---|---|---|");
    lines.push(`| ${race.length} | ${released} | ${borrowed} | ${both} | ${insolvent} |`);
  }

  lines.push("", "## Per-leg breakdown", "", ...legSections);

  mkdirSync(path.join(ROOT, "results"), { recursive: true });
  writeFileSync(path.join(ROOT, "results", "SUMMARY.md"), lines.join("\n"));
  mkdirSync(path.join(ROOT, "dashboard", "public"), { recursive: true });
  writeFileSync(path.join(ROOT, "dashboard", "public", "summary.json"), JSON.stringify(summary, null, 2));
  console.log(lines.join("\n"));
}

main();
