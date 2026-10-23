import { Fragment, useEffect, useState } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { getLoopCommandStats } from "../../lib/api";
import type { LoopCommandStats, LoopCostRow } from "../../lib/api";
import { costOf, rateFor } from "../lib/modelPricing";

const DAYS = [7, 30, 90];

const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);
const fmtUsd = (v: number) => (v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  const m = Math.round(ms / 60_000);
  return m < 1 ? "<1m" : m < 120 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
}

export function priceCostRows(rows: LoopCostRow[]): { usd: number; unpricedRuns: number } {
  let usd = 0;
  let unpricedRuns = 0;
  for (const r of rows) {
    const rate = rateFor(r.model);
    if (!rate) {
      unpricedRuns += r.runs;
      continue;
    }
    usd += costOf(rate, { tokensIn: r.tokensIn, tokensOut: r.tokensOut, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite });
  }
  return { usd, unpricedRuns };
}

function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-4 items-end gap-px" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="w-1 rounded-sm bg-xyne-brand/70" style={{ height: `${Math.max(v ? 15 : 4, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} />
      ))}
    </span>
  );
}

export function LoopCommandsDashboard() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<LoopCommandStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    getLoopCommandStats(days)
      .then((d) => setRows(d.commands))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"));
  }, [days]);

  const totals = (rows ?? []).reduce(
    (t, r) => {
      const c = priceCostRows(r.costRows);
      return { runs: t.runs + r.runs, completed: t.completed + r.outcomes.completed, usd: t.usd + c.usd, unpriced: t.unpriced + c.unpricedRuns };
    },
    { runs: 0, completed: 0, usd: 0, unpriced: 0 },
  );

  return (
    <div className="space-y-3" data-id="loop-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-xyne-fg-secondary" data-id="loop-dashboard-total">
          {rows ? (
            <>
              <span className="font-medium text-xyne-fg-primary">{totals.runs}</span> runs ·{" "}
              <span className="font-medium text-xyne-fg-primary">{totals.completed}</span> completed with a report · about{" "}
              <span className="font-medium text-xyne-fg-primary">{fmtUsd(totals.usd)}</span> in model cost
              {totals.unpriced > 0 && <span className="text-xyne-fg-muted"> · {totals.unpriced} agent runs on models with no price</span>}
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <div className="flex rounded-lg border border-xyne-border p-0.5">
          {DAYS.map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 text-[12px] ${d === days ? "bg-xyne-surface-subtle font-medium text-xyne-fg-primary" : "text-xyne-fg-muted"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-[13px] text-xyne-error-fg">{error}</p>}
      <section className="overflow-x-auto rounded-xl border border-xyne-border">
        <table className="w-full min-w-[900px] text-[12px]">
          <thead className="bg-xyne-surface-subtle text-left text-xyne-fg-muted">
            <tr>
              {["Command", "Runs", "Completed", "Stopped", "Avg passes", "Duration p50 / p95", "Cost", "Findings", `Last ${days}d`].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-xyne-fg-muted">No loop commands yet.</td></tr>}
            {rows?.map((r) => {
              const cost = priceCostRows(r.costRows);
              const expanded = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-t border-xyne-border hover:bg-xyne-surface-subtle/50" onClick={() => setOpen(expanded ? null : r.id)} data-id="loop-stats-row">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1 font-mono font-medium text-xyne-fg-primary">
                        {expanded ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}/{r.name}
                      </span>
                      <span className="pl-4 text-[11px] text-xyne-fg-muted">v{r.version}{r.composite ? " · sequence" : ""}{r.published ? "" : " · draft"}</span>
                    </td>
                    <td className="px-3 py-2">{r.runs}{r.outcomes.running ? <span className="text-xyne-fg-muted"> ({r.outcomes.running} running)</span> : null}</td>
                    <td className={`px-3 py-2 ${(r.completionRate ?? 100) < 50 ? "text-xyne-error-fg" : ""}`}>{fmtPct(r.completionRate)}</td>
                    <td className="px-3 py-2">{r.outcomes.stopped}{r.outcomes["no-report"] ? <span className="text-amber-700 dark:text-amber-300"> · {r.outcomes["no-report"]} no report</span> : null}</td>
                    <td className="px-3 py-2">{r.avgPasses ?? "—"}</td>
                    <td className="px-3 py-2">{fmtMs(r.p50Ms)} / {fmtMs(r.p95Ms)}</td>
                    <td className="px-3 py-2">{cost.usd > 0 ? fmtUsd(cost.usd) : cost.unpricedRuns ? "no price" : "—"}</td>
                    <td className="px-3 py-2">{r.composite ? "—" : `${r.findings.proved} proved · ${r.findings.refuted} refuted · ${r.findings.conjecture} open`}</td>
                    <td className="px-3 py-2"><Bars values={r.daily.map((d) => d.runs)} /></td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-xyne-border bg-xyne-surface-sunken/40" data-id="loop-stats-detail">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="mb-1 font-medium text-xyne-fg-secondary">By version</p>
                            {r.byVersion.length === 0 && <p className="text-xyne-fg-muted">No runs in this window.</p>}
                            {r.byVersion.map((v) => (
                              <p key={v.version} className="text-xyne-fg-secondary">
                                v{v.version || "?"}: {v.runs} runs · {fmtPct(v.completionRate)} completed · {v.avgPasses ?? "—"} passes · p50 {fmtMs(v.p50Ms)}
                              </p>
                            ))}
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-xyne-fg-secondary">Recent runs</p>
                            {r.recent.length === 0 && <p className="text-xyne-fg-muted">None yet.</p>}
                            {r.recent.map((x) => (
                              <p key={x.id} className="truncate text-xyne-fg-secondary" title={x.report ?? undefined}>
                                <span className="font-mono text-[11px] text-xyne-fg-muted">{new Date(x.createdAt).toLocaleString()}</span> · v{x.version ?? "?"} · {x.status} · {x.passes} {r.composite ? (x.passes === 1 ? "step" : "steps") : x.passes === 1 ? "pass" : "passes"} · {fmtMs(x.ms)}
                                {x.report ? <span className="text-xyne-fg-muted"> — {x.report}</span> : null}
                              </p>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="text-[11px] text-xyne-fg-muted">
        Completed = finished with a final report, out of finished runs. Cost = every pass and checker run of the command, priced with the Metrics page prices. A sequence's cost is the sum of its steps. Runs started before this release have no pass sessions recorded, so their cost shows as —.
      </p>
    </div>
  );
}
