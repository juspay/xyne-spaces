/**
 * What the overview shows when a session filter is set.
 *
 * The run-level rollups are window aggregates with no single-run form — a p95
 * over one value is that value — so filtering to a session used to leave this
 * tab showing workspace numbers under a banner apologising for it. This shows
 * the run instead: what it did, how long, what it spent, and whether the deep
 * tabs will have anything for it.
 *
 * That last part matters. `toolCalls`/`llmCallsRecorded` are null for runs that
 * predate their columns, and saying so here saves the reader clicking through
 * three empty tabs to find out.
 */

import { type ReactElement } from "react";
import type { SessionSummary } from "../../../lib/api";
import { MetricsCard, PanelError, StatTile } from "./MetricsPrimitives";
import { STATUS } from "./metricsPalette";
import { formatCompact, formatCount, formatMs } from "./metricsFormat";

const STATUS_TONE: Record<string, string | undefined> = {
  completed: STATUS.good,
  failed: STATUS.critical,
  cancelled: undefined,
  running: STATUS.warning,
};

export function SessionSummaryCard({
  sessionId,
  data,
  loading,
  error,
}: {
  sessionId: string;
  data: SessionSummary | undefined;
  loading: boolean;
  error: string | null;
}): ReactElement {
  if (error) {
    return (
      <MetricsCard title="Session" description={sessionId}>
        <PanelError error={error} />
      </MetricsCard>
    );
  }
  if (!data) {
    return (
      <MetricsCard title="Session" description={sessionId}>
        <p className="py-6 text-[13px] text-xyne-fg-muted">
          {loading ? "Loading session…" : "No session loaded."}
        </p>
      </MetricsCard>
    );
  }

  const contextTokens = data.tokens.in + data.tokens.cacheRead + data.tokens.cacheWrite;
  const distinctTools = new Set(data.toolsUsed).size;

  return (
    <div className="flex flex-col gap-[20px]">
      <MetricsCard
        title={`Session · ${data.agentSlug}`}
        description={data.task ?? "No task text recorded."}
        action={
          <span
            className="shrink-0 rounded-full border border-xyne-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
            style={{ color: STATUS_TONE[data.status] }}
          >
            {data.status}
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] md:grid-cols-3">
          <Row label="Session id" value={data.sessionId} mono />
          <Row label="Trigger" value={data.trigger} />
          <Row label="Model" value={data.model ? `${data.provider ?? "?"} · ${data.model}` : "—"} mono />
          <Row label="Started" value={new Date(data.startedAt).toLocaleString()} />
          <Row
            label="Completed"
            value={data.completedAt ? new Date(data.completedAt).toLocaleString() : "still running"}
          />
          <Row label="Rating" value={data.rating ? (data.rating === "up" ? "👍" : "👎") : "—"} />
        </dl>

        {data.error && (
          <p
            className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-xyne-error-bg px-3 py-2 font-mono text-[11px]"
            style={{ color: STATUS.critical }}
          >
            {data.error}
          </p>
        )}
      </MetricsCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Wall clock"
          value={formatMs(data.totalMs)}
          detail={`${formatMs(data.llmTotalMs)} model · ${formatMs(data.toolMs)} tools`}
          aggregation="cumulative"
          unit="ms"
        />
        <StatTile
          label="Model turns"
          value={data.llmTurns === null ? "—" : formatCount(data.llmTurns)}
          detail={
            data.llmRetries
              ? `${formatCount(data.llmRetries)} retried`
              : data.ttftMs === null
                ? undefined
                : `first token ${formatMs(data.ttftMs)}`
          }
          aggregation="cumulative"
          unit="calls"
        />
        <StatTile
          label="Tool calls"
          value={data.toolCalls === null ? "n/a" : formatCount(data.toolCalls)}
          detail={`${formatCount(distinctTools)} distinct tools`}
          aggregation="cumulative"
          unit="calls"
        />
        <StatTile
          label="Context in"
          value={formatCompact(contextTokens)}
          detail={`${formatCompact(data.tokens.in)} fresh · ${formatCompact(data.tokens.cacheRead)} cached`}
          aggregation="cumulative"
          unit="tokens"
        />
        <StatTile
          label="Generated"
          value={formatCompact(data.tokens.out)}
          aggregation="cumulative"
          unit="tokens"
        />
        <StatTile
          label="Per-call series"
          value={data.llmCallsRecorded === null ? "not recorded" : formatCount(data.llmCallsRecorded)}
          detail={
            data.llmCallsRecorded === null
              ? "LLM calls tab will be empty for this run"
              : "LLM calls tab has data"
          }
          tone={data.llmCallsRecorded === null ? "warning" : "neutral"}
          hint="Per-call timing is recorded while a run executes and is never backfilled, so runs from before the feature shipped have none."
        />
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-xyne-fg-muted">{label}</dt>
      <dd
        className={
          "truncate text-xyne-fg-primary" + (mono ? " font-mono text-[11px]" : " text-[12px]")
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
