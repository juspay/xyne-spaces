import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckIcon, LightningIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { ackFastSubagentAlert, getFastSubagentStats, listXorReviews, runFastDriftCheck, submitXorReview } from "../../lib/api";
import type { FastSubagentAlert, FastSubagentRow, XorReviewItem } from "../../lib/api";
import { Button } from "./ui/Button";
import { computeFastSubagentCost, type FastSubagentCost } from "../lib/modelPricing";
import { useSnackbar } from "./ui/Snackbar";

const DAYS = [1, 7, 30];

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
const fmtUsd = (v: number) => (Math.abs(v) >= 100 ? `$${v.toFixed(0)}` : Math.abs(v) >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const fmtNum = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

function Spark({ points }: { points: Array<number | null> }) {
  const vals = points.map((p) => p ?? 0);
  const max = Math.max(10, ...vals);
  const w = 72;
  const h = 18;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="text-amber-500" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function FastSubagentsOpsPage({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<FastSubagentRow[] | null>(null);
  const [alerts, setAlerts] = useState<FastSubagentAlert[]>([]);
  const [reviews, setReviews] = useState<XorReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getFastSubagentStats(days), listXorReviews()]);
      setRows(s.subagents);
      setAlerts(s.alerts);
      setReviews(r);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    try {
      const { created } = await runFastDriftCheck();
      showSnackbar({ variant: created.length ? "error" : "success", title: created.length ? `${created.length} drift alert(s) raised` : "No drift found" });
      await load();
    } catch (err) {
      showSnackbar({ variant: "error", title: "Drift check failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setChecking(false);
    }
  };

  const ack = async (id: string) => {
    await ackFastSubagentAlert(id).catch(() => undefined);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledgedAt: new Date().toISOString() } : a)));
  };

  const review = async (id: string, verdict: "correct" | "wrong") => {
    try {
      await submitXorReview(id, verdict);
      setReviews((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      showSnackbar({ variant: "error", title: "Review failed", description: err instanceof Error ? err.message : undefined });
    }
  };

  const open = alerts.filter((a) => !a.acknowledgedAt);
  const costs = new Map<string, FastSubagentCost>((rows ?? []).map((r) => [r.subagentName, computeFastSubagentCost(r.stats?.costRows ?? [])]));
  const total = [...costs.values()].reduce((t, c) => ({ spent: t.spent + c.spent, saved: t.saved + c.saved, unpriced: t.unpriced + c.unpricedCalls }), { spent: 0, saved: 0, unpriced: 0 });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-xyne-surface" data-id="fast-subagents-ops">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-xyne-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-[16px] font-semibold text-xyne-fg-primary">
            <LightningIcon size={18} /> Fast subagents
          </h1>
          <p className="text-[12px] text-xyne-fg-muted">Cheap-model + xor subagents: how often they run, how fast, how sure xor is, and what they saved the parent.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-xyne-border p-0.5">
            {DAYS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 text-[12px] ${d === days ? "bg-xyne-surface-subtle font-medium text-xyne-fg-primary" : "text-xyne-fg-muted"}`}>
                {d === 1 ? "24h" : `${d}d`}
              </button>
            ))}
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => void check()} disabled={checking}>
              {checking ? "Checking…" : "Run drift check"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {error && <p className="text-[13px] text-xyne-error-fg">{error}</p>}

        {open.length > 0 && (
          <section className="space-y-2" data-id="fast-alerts">
            {open.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-xyne-border-error bg-xyne-surface p-3 text-[13px]">
                <span className="flex items-start gap-2 text-xyne-error-fg">
                  <WarningIcon size={16} className="mt-0.5 shrink-0" />
                  <span>
                    {a.message}
                    <span className="ml-2 text-[11px] text-xyne-fg-muted">{new Date(a.createdAt).toLocaleString()}</span>
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void ack(a.id)}>Acknowledge</Button>
              </div>
            ))}
          </section>
        )}

        {rows && rows.some((r) => r.calls > 0) && (
          <p className="text-[13px] text-xyne-fg-secondary" data-id="fast-cost-total">
            Spent <span className="font-medium text-xyne-fg-primary">{fmtUsd(total.spent)}</span> on fast subagents (cheap model + xor) ·
            about <span className="font-medium text-xyne-success-fg">{fmtUsd(total.saved)}</span> saved vs the parent model doing the same work inline
            {total.unpriced > 0 && <span className="text-xyne-fg-muted"> · {total.unpriced} calls on models with no price</span>}
          </p>
        )}

        <section className="overflow-x-auto rounded-xl border border-xyne-border">
          <table className="w-full min-w-[980px] text-[12px]" data-id="fast-stats">
            <thead className="bg-xyne-surface-subtle text-left text-xyne-fg-muted">
              <tr>
                {["Subagent", "Calls", "p50 / p95", "Unsure", `Unsure (${days === 1 ? "24h" : "daily"})`, "xor down", "Cache", "Escalations", "Tokens offloaded", "Cost / saved", "Eval", "Reviews", "Quota"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-xyne-fg-muted">Loading…</td></tr>
              )}
              {rows?.map((r) => (
                <tr key={r.subagentName} className="border-t border-xyne-border" data-id="fast-stats-row">
                  <td className="px-3 py-2">
                    <button className="font-medium text-xyne-fg-primary hover:underline" onClick={() => navigate(`/v3/subagents/${r.subagentName}${r.builtin ? "" : "?tab=checks"}`)}>
                      {r.subagentName}
                    </button>
                    <div className="text-[11px] text-xyne-fg-muted">{r.builtin ? "built-in" : "custom"}{r.stats?.models.length ? ` · ${r.stats.models.join(", ")}` : ""}</div>
                  </td>
                  <td className="px-3 py-2">{r.calls}{r.stats?.errorRate ? <span className="text-xyne-error-fg"> · {r.stats.errorRate}% err</span> : null}</td>
                  <td className="px-3 py-2">{fmtMs(r.stats?.p50Ms)} / {fmtMs(r.stats?.p95Ms)}</td>
                  <td className={`px-3 py-2 ${(r.stats?.unsureRate ?? 0) >= 20 ? "text-amber-700 dark:text-amber-300" : ""}`}>{fmtPct(r.stats?.unsureRate)}</td>
                  <td className="px-3 py-2">{r.stats ? <Spark points={r.stats.daily.map((d) => d.unsureRate)} /> : "—"}</td>
                  <td className={`px-3 py-2 ${(r.stats?.unavailableRate ?? 0) >= 5 ? "text-xyne-error-fg" : ""}`}>{fmtPct(r.stats?.unavailableRate)}</td>
                  <td className="px-3 py-2">{fmtPct(r.stats?.cacheHitRate)}</td>
                  <td className="px-3 py-2">{r.stats?.escalations ?? 0}</td>
                  <td className="px-3 py-2">{r.stats ? fmtNum(r.stats.tokensOffloaded) : "—"}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      const c = costs.get(r.subagentName);
                      if (!c || c.pricedCalls === 0) return <span className="text-xyne-fg-muted">{c?.unpricedCalls ? "no price" : "—"}</span>;
                      return (
                        <span title={`Inline on the parent model: ${fmtUsd(c.inline)}`}>
                          {fmtUsd(c.spent)} <span className={c.saved >= 0 ? "text-xyne-success-fg" : "text-xyne-error-fg"}>/ {c.saved >= 0 ? "" : "−"}{fmtUsd(Math.abs(c.saved))}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {r.eval ? (
                      <span>{fmtPct(r.eval.accuracy)}{r.eval.stale ? <span className="text-[11px] text-xyne-fg-muted"> (stale)</span> : null}</span>
                    ) : (
                      <span className="text-xyne-fg-muted">not run</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.reviews.pending} pending
                    {r.reviews.wrongRate !== null && <span className={r.reviews.wrongRate >= 15 ? "text-xyne-error-fg" : "text-xyne-fg-muted"}> · {r.reviews.wrongRate}% wrong</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.budget?.xorItemsPerHour ? `${fmtNum(r.budget.xorItemsPerHour)}/h` : "—"}
                    {r.stats?.quotaBlocked ? <span className="text-xyne-error-fg"> · {r.stats.quotaBlocked} blocked</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-[11px] text-xyne-fg-muted">
          Unsure = xor answers below the confidence threshold. Escalations = times the cheap model fell back to the standard one. Tokens offloaded = tokens the subagent's cheap model read and wrote instead of the parent. Cost = the cheap model's tokens plus xor calls at the Metrics page's prices; saved = the same tokens priced at the parent's model (Opus when unknown) minus that cost, an estimate.
        </p>

        <section className="space-y-2" data-id="fast-reviews">
          <h2 className="text-[13px] font-medium text-xyne-fg-primary">Review confident answers ({reviews.length})</h2>
          <p className="text-[12px] text-xyne-fg-muted">A sample of answers xor was confident about. Mark each right or wrong; a high wrong rate raises a drift alert.</p>
          {reviews.length === 0 && <p className="rounded-xl border border-dashed border-xyne-border p-4 text-[12px] text-xyne-fg-muted">Nothing to review yet.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-xl border border-xyne-border bg-xyne-surface p-3 text-[12px]" data-id="fast-review-item">
              <div className="min-w-0 flex-1">
                <p className="text-xyne-fg-muted">{r.subagentName} · {r.question}</p>
                <p className="mt-0.5 font-medium text-xyne-fg-primary">
                  {r.value} <span className="font-normal text-xyne-fg-muted">({Math.round(r.confidence * 100)}%)</span>
                </p>
                <p className="mt-1 truncate font-mono text-xyne-fg-secondary">{r.item}</p>
              </div>
              <Button size="sm" onClick={() => void review(r.id, "correct")} leadingIcon={<CheckIcon size={14} />}>Right</Button>
              <Button size="sm" variant="ghost" onClick={() => void review(r.id, "wrong")} leadingIcon={<XIcon size={14} />}>Wrong</Button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
