/**
 * The always-visible KPI row, in decision order: Success, End-to-end p95, Tool errors, End-to-end p50, Tokens per run, Runs.
 * Every tile shows its sample size and `statusFor` mutes figures under their floor. The verdict is green only when
 * every judged metric is ok above its floor and capture is at least 50%.
 * Run time is end-to-end wall clock (completedAt - startedAt) over completed runs; agent-reported totalMs is
 * tooltip-only. Tokens per run counts fresh + cache read + cache write.
 */

import type { ReactElement, ReactNode } from "react";
import { Activity, CircleCheck, CircleDashed, CircleX, Coins, Hourglass, Timer, TriangleAlert, Wrench } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { SummaryFigures } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useSummary } from "../../hooks/useDeepMetrics";
import {
  DrillCount,
  KpiStrip,
  KpiStripSkeleton,
  PanelError,
  SAMPLE_FLOORS,
  StatusGlyph,
  clearDrillParams,
  countDelta,
  floorFor,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtTokens,
  latencyDelta,
  plural,
  rateDelta,
  statusFor,
  statusText,
  useMetricsParams,
  type Delta,
  type Kpi,
  type MetricsScopeParams,
  type Status,
} from "./MetricsPrimitives";

const COLS = "grid-cols-2 @min-[560px]:grid-cols-3 @min-[960px]:grid-cols-6";
const VALUE = "text-[24px]";

/** Below this share of runs carrying a judged field the verdict cannot be green. */
const MIN_CAPTURE = 0.5;

function fromLine(n: number, of: number, noun = "runs"): string {
  return `from ${fmtInt(n)} of ${fmtInt(of)} ${noun}`;
}

function windowCaption(days: number): string {
  return days === 1 ? "Last 24 hours · vs the 24 hours before" : `Last ${days} days · vs the ${days} days before`;
}

function scopeCaption(scope: MetricsScopeParams): ReactNode {
  const orgs = scope.orgScope === "all" ? ", all orgs" : "";
  if (scope.agentSlugs.length === 1) {
    return (
      <>
        agent <span className="font-mono text-xyne-fg-secondary">{scope.agentSlugs[0]}</span>
        {orgs}
      </>
    );
  }
  if (scope.agentSlugs.length > 1) return `${scope.agentSlugs.length} agents${orgs}`;
  return `all agents${orgs}`;
}

interface Judged {
  label: string;
  status: Status;
  concern: string;
  gap: string | null;
}

interface Verdict {
  tone: "good" | "warn" | "bad" | "neutral";
  text: string;
  title: string;
}

/** Concerns above their floor win; else any gap or capture under 50% is neutral; only then green. */
function verdictFor(cur: SummaryFigures, judged: Judged[]): Verdict {
  const rules =
    "Judged: success rate (≥ 95%), end-to-end p95 (< 2m), tool error rate (< 5%), each only with enough samples (30 runs, 20 timed runs, 30 tool calls) and at least half the runs captured.";
  if (cur.runs === 0) return { tone: "neutral", text: "No runs in this window", title: rules };
  const concerns = judged.filter((j) => j.status === "warn" || j.status === "bad");
  if (concerns.length > 0) {
    return {
      tone: concerns.some((c) => c.status === "bad") ? "bad" : "warn",
      text: `${concerns.length} ${plural(concerns.length, "concern")}: ${concerns.map((c) => c.concern).join(" · ")}`,
      title: rules,
    };
  }
  const gaps = judged.flatMap((j) => (j.gap ? [j.gap] : []));
  const timing = cur.completed > 0 ? cur.wall.n / cur.completed : 1;
  if (timing < MIN_CAPTURE && !gaps.some((g) => g.startsWith("run timing"))) {
    gaps.push(`run timing captured for ${fmtInt(cur.wall.n)} of ${fmtInt(cur.completed)} completed runs`);
  }
  const t = cur.tools;
  const toolCapture = cur.runs > 0 ? t.runsSummarised / cur.runs : 1;
  if (toolCapture < MIN_CAPTURE) {
    gaps.push(`tool stats recorded for ${fmtInt(t.runsSummarised)} of ${fmtInt(cur.runs)} runs`);
  }
  if (gaps.length > 0) return { tone: "neutral", text: `Not enough data to judge — ${gaps[0]}`, title: `${gaps.join(" · ")}. ${rules}` };
  return { tone: "good", text: `Healthy — ${fmtInt(cur.runs)} ${plural(cur.runs, "run")}, all checks within limits`, title: rules };
}

const VERDICT_CLASS: Record<Verdict["tone"], string> = {
  good: "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg",
  warn: "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg",
  bad: "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg",
  neutral: "border-xyne-neutral-border bg-xyne-neutral-bg text-xyne-neutral-fg",
};

const VERDICT_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleX, neutral: CircleDashed } as const;

function VerdictPill({ verdict }: { verdict: Verdict }): ReactElement {
  const Icon = VERDICT_ICON[verdict.tone];
  return (
    <span
      role="status"
      title={verdict.title}
      className={cn(
        "inline-flex min-h-6 max-w-full cursor-help items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium",
        VERDICT_CLASS[verdict.tone],
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      <span className="min-w-0">{verdict.text}</span>
    </span>
  );
}

/** Suppress a delta that would compare thin data. */
function gated(delta: Delta | null, status: Status): Delta | null {
  if (!delta) return null;
  if (status === "thin") return { ...delta, label: "too few to compare", tone: "neutral", direction: "flat", insufficient: true };
  return delta;
}

export function HeadlineKpis({ scope }: { scope: MetricsScopeParams }): ReactElement {
  const state = useSummary(scope);
  const patch = useMetricsParams();
  const [params] = useSearchParams();
  const caption = (
    <>
      {windowCaption(scope.days)} · {scopeCaption(scope)} · runs finished in the window
    </>
  );

  if (!state.data) {
    return (
      <section aria-label="Headline metrics" className="flex flex-col gap-2">
        <p className="text-[12px] text-xyne-fg-muted">{caption}</p>
        {state.error ? (
          <PanelError error={state.error} onRetry={state.refetch} />
        ) : (
          <KpiStripSkeleton count={6} cols={COLS} tall />
        )}
      </section>
    );
  }

  const cur = state.data.current;
  const prev = state.data.previous;

  const openFailed = (status: "failed" | "cancelled" | "failed,cancelled"): void =>
    patch({ drill: "failed", status, minMs: null, model: null, provider: null });

  const toolsHref = (() => {
    const next = clearDrillParams(new URLSearchParams(params), { keepMeasures: true });
    next.set("tab", "tools");
    next.set("sort", "errors");
    next.set("dir", "desc");
    return `/v3/metrics?${next.toString()}`;
  })();

  const successStatus = statusFor("runSuccess", cur.successRate, cur.runs);
  const successDelta = gated(
    rateDelta(
      { value: cur.successRate, n: cur.runs },
      prev ? { value: prev.successRate, n: prev.runs } : null,
      { higherIsBetter: true, floor: floorFor("runSuccess") },
    ),
    successStatus,
  );
  const failedLine: ReactNode =
    cur.failed === 0 && cur.cancelled === 0 ? (
      "No failed or cancelled runs"
    ) : (
      <>
        <DrillCount
          variant="inline"
          value={cur.failed}
          title={`Show the ${fmtInt(cur.failed)} failed ${plural(cur.failed, "run")}`}
          onClick={() => openFailed("failed")}
        />{" "}
        failed ·{" "}
        <DrillCount
          variant="inline"
          value={cur.cancelled}
          title={`Show the ${fmtInt(cur.cancelled)} cancelled ${plural(cur.cancelled, "run")}`}
          onClick={() => openFailed("cancelled")}
        />{" "}
        cancelled
      </>
    );

  const wall = cur.wall;
  const prevWall = prev?.wall ?? null;
  const p95Status = statusFor("runP95", wall.p95Ms, wall.n, { previous: prevWall?.p95Ms, previousN: prevWall?.n });
  const p50Status = statusFor("runP50", wall.p50Ms, wall.n);
  const agentTip =
    cur.agent.n > 0
      ? `Agent-reported time: p50 ${fmtMs(cur.agent.p50Ms)} · p95 ${fmtMs(cur.agent.p95Ms)} over ${fmtInt(cur.agent.n)} ${plural(cur.agent.n, "run")}.`
      : "No agent-reported run time in this window.";
  const timeHint =
    "End-to-end: wall clock from start to finish of completed runs, including queueing and every model and tool call.";
  const p95Floor = floorFor("runP95");
  const p95Value =
    p95Status === "thin" ? (
      <span className="text-[14px] font-normal">needs {fmtInt(p95Floor)}+ runs</span>
    ) : (
      fmtMs(wall.p95Ms)
    );

  const t = cur.tools;
  const toolStatus: Status = t.calls === 0 ? "na" : statusFor("toolErrorRate", t.errorRate, t.calls);
  const toolDelta = gated(
    rateDelta(
      { value: t.errorRate, n: t.calls },
      prev ? { value: prev.tools.errorRate, n: prev.tools.calls } : null,
      { higherIsBetter: false, floor: floorFor("toolErrorRate"), noun: "tool calls" },
    ),
    toolStatus,
  );
  const toolCapture = cur.runs > 0 ? t.runsSummarised / cur.runs : 1;
  const missingStats = Math.max(cur.runs - t.runsSummarised, 0);
  const toolLine: ReactNode =
    t.calls === 0 ? (
      missingStats > 0 ? (
        `No tool stats yet for ${fmtInt(missingStats)} ${plural(missingStats, "run")}`
      ) : (
        "No tool calls in this window"
      )
    ) : (
      <>
        <DrillCount variant="inline" value={t.errors} to={toolsHref} title="Open the Tools tab ranked by errors" /> of{" "}
        {fmtInt(t.calls)} {plural(t.calls, "call")}
        {toolCapture < 0.9 && <> · {fromLine(t.runsSummarised, cur.runs, "runs with tool stats")}</>}
      </>
    );

  const tk = cur.tokens;
  // Thin under the average floor or under 10% capture (METRIC_DEFS.capture).
  const tokensStatus: Status | undefined =
    tk.n === 0 ? "na" : tk.n < SAMPLE_FLOORS.avg || statusFor("capture", tk.n / Math.max(1, cur.runs), cur.runs) === "thin" ? "thin" : undefined;
  const cacheStatus = statusFor("cacheHit", tk.cacheHitRate, tk.n);
  const prevTk = prev?.tokens ?? null;
  const tokensDelta = (() => {
    if (tokensStatus === "na" || !prevTk) return null;
    const d = countDelta(tk.promptPerRun, prevTk.promptPerRun, fmtTokens);
    if (!d) return null;
    const titled = {
      ...d,
      title: `Now: ${fmtTokens(tk.promptPerRun)} in · ${fmtTokens(tk.outputPerRun)} out per run over ${fmtInt(tk.n)} runs · Previous: ${fmtTokens(prevTk.promptPerRun)} in · ${fmtTokens(prevTk.outputPerRun)} out over ${fmtInt(prevTk.n)} runs`,
    };
    return gated(titled, tokensStatus === "thin" || prevTk.n < SAMPLE_FLOORS.avg ? "thin" : "ok");
  })();
  const tokensValue = (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="text-[18px]">{fmtTokens(tk.promptPerRun)} in</span>
      <span className="text-[13px] font-medium text-xyne-fg-secondary">{fmtTokens(tk.outputPerRun)} out</span>
    </span>
  );
  const tokensLine: ReactNode = (
    <>
      {fromLine(tk.n, cur.runs)}
      {tk.cacheHitRate != null && (
        <>
          {" · "}
          <span className={cn("inline-flex items-center gap-0.5", cacheStatus !== "ok" && cacheStatus !== "thin" && statusText(cacheStatus))}>
            <StatusGlyph status={cacheStatus} size={11} />
            {fmtPct(tk.cacheHitRate)} cached
          </span>
        </>
      )}
    </>
  );

  const items: Kpi[] = [
    {
      key: "success",
      label: "Success rate",
      icon: CircleCheck,
      hint: "Completed ÷ finished runs. Failed and cancelled runs both count against it.",
      value: fmtPct(cur.successRate),
      valueTitle: `${fmtInt(cur.completed)} of ${fmtInt(cur.runs)} runs completed`,
      status: successStatus,
      n: cur.runs,
      nLabel: "runs",
      floor: floorFor("runSuccess"),
      naWhy: "No runs in this window",
      delta: successDelta,
      deltaNote: prev ? undefined : "no prior window",
      line: failedLine,
    },
    {
      key: "p95",
      label: "End-to-end p95",
      icon: Hourglass,
      hint: `${timeHint} The slowest 5% took at least this long.`,
      value: p95Value,
      valueTitle: `p95 ${fmtMs(wall.p95Ms)} over ${fmtInt(wall.n)} ${plural(wall.n, "completed run")}. ${agentTip}`,
      status: p95Status,
      n: wall.n,
      nLabel: "timed runs",
      floor: p95Floor,
      naWhy: "No completed runs in this window",
      delta: latencyDelta({ ms: wall.p95Ms, n: wall.n }, prevWall ? { ms: prevWall.p95Ms, n: prevWall.n } : null),
      deltaNote: prev ? undefined : "no prior window",
      line: fromLine(wall.n, cur.runs),
    },
    {
      key: "tool-errors",
      label: "Tool errors",
      icon: Wrench,
      hint: "Errored ÷ tool calls, from the per-run tool summaries.",
      value: fmtPct(t.errorRate),
      valueTitle:
        t.calls > 0 ? `${fmtInt(t.errors)} of ${fmtInt(t.calls)} tool calls returned an error, across ${fmtInt(t.runsWithTools)} runs` : undefined,
      status: toolStatus,
      n: t.calls,
      nLabel: "tool calls",
      floor: floorFor("toolErrorRate"),
      naWhy: missingStats > 0 ? "Tool stats not built yet for this window" : "No tool calls in this window",
      delta: toolDelta,
      deltaNote: prev ? undefined : "no prior window",
      line: toolLine,
    },
    {
      key: "p50",
      label: "End-to-end p50",
      icon: Timer,
      hint: `${timeHint} Half of runs finished faster than this.`,
      value: fmtMs(wall.p50Ms),
      valueTitle: `p50 ${fmtMs(wall.p50Ms)} over ${fmtInt(wall.n)} ${plural(wall.n, "completed run")}. ${agentTip}`,
      status: p50Status,
      n: wall.n,
      nLabel: "timed runs",
      floor: floorFor("runP50"),
      naWhy: "No completed runs in this window",
      delta: latencyDelta({ ms: wall.p50Ms, n: wall.n }, prevWall ? { ms: prevWall.p50Ms, n: prevWall.n } : null),
      deltaNote: prev ? undefined : "no prior window",
      line: fromLine(wall.n, cur.runs),
    },
    {
      key: "tokens",
      label: "Tokens per run",
      icon: Coins,
      hint: "Prompt tokens per run (fresh + cache read + cache write), then output tokens per run, over runs that recorded tokens.",
      value: tokensValue,
      valueTitle:
        tk.n > 0
          ? `${fmtTokens(tk.freshPerRun)} fresh + ${fmtTokens(tk.cachedPerRun)} cached prompt tokens per run · ${fmtTokens(tk.outputPerRun)} output · over ${fmtInt(tk.n)} runs`
          : undefined,
      status: tokensStatus,
      n: tk.n,
      nLabel: "runs with tokens",
      floor: SAMPLE_FLOORS.avg,
      naWhy: "No run recorded tokens in this window",
      delta: tokensDelta,
      deltaNote: prev ? undefined : "no prior window",
      line: tokensLine,
    },
    {
      key: "runs",
      label: "Runs",
      icon: Activity,
      value: fmtInt(cur.runs),
      valueTitle: `${fmtInt(cur.completed)} completed · ${fmtInt(cur.failed)} failed · ${fmtInt(cur.cancelled)} cancelled`,
      delta: countDelta(cur.runs, prev?.runs, fmtInt),
      deltaNote: prev ? undefined : "no prior window",
      line: (
        <>
          {fmtInt(cur.users)} {plural(cur.users, "user")}
          {cur.delegatedRuns > 0 && <> · {fmtInt(cur.delegatedRuns)} delegated</>}
        </>
      ),
    },
  ];

  const judged: Judged[] = [
    {
      label: "success",
      status: successStatus,
      concern: `success ${fmtPct(cur.successRate)}`,
      gap: successStatus === "thin" ? `only ${fmtInt(cur.runs)} ${plural(cur.runs, "run")} (needs ${fmtInt(floorFor("runSuccess"))}+)` : null,
    },
    {
      label: "p95",
      status: p95Status,
      concern: `slow tail ${fmtMs(wall.p95Ms)}`,
      gap:
        p95Status === "thin" || p95Status === "na"
          ? `run timing captured for ${fmtInt(wall.n)} of ${fmtInt(cur.runs)} runs`
          : null,
    },
    {
      label: "tools",
      status: toolStatus,
      concern: `tool errors ${fmtPct(t.errorRate)}`,
      gap:
        toolStatus === "thin"
          ? `only ${fmtInt(t.calls)} tool ${plural(t.calls, "call")} (needs ${fmtInt(floorFor("toolErrorRate"))}+)`
          : toolStatus === "na" && missingStats > 0
            ? `tool stats recorded for ${fmtInt(t.runsSummarised)} of ${fmtInt(cur.runs)} runs`
            : null,
    },
  ];
  const verdict = verdictFor(cur, judged);

  return (
    <section aria-label="Headline metrics" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <VerdictPill verdict={verdict} />
        <p className="text-[12px] text-xyne-fg-muted">{caption}</p>
      </div>
      <KpiStrip
        items={items}
        size="lg"
        cols={COLS}
        valueClass={VALUE}
        showDeltas
        busy={state.isPlaceholder || (state.loading && state.data !== undefined)}
      />
    </section>
  );
}
