/**
 * The four numbers that decide whether anything needs attention, plus a
 * one-line verdict.
 *
 * Sits ABOVE the tabs deliberately: "is anything wrong right now" has to be
 * answerable without first choosing a view, and it stays on screen while the
 * reader is deep in the tool or LLM panels.
 *
 * The status banner and the two hero durations used to live inside the overview
 * card. They were promoted here rather than duplicated — the overview keeps the
 * full breakdown (outcomes, tokens, users, memory) and remains the detail view.
 *
 * The verdict is stated as a sentence, not a colour alone, so the signal
 * survives for a reader who cannot distinguish the tones.
 */

import { type ReactElement } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { AgentMetrics, GlobalMetrics } from "../../../lib/api";
import { formatCount, formatMs, formatPct } from "./metricsFormat";

type Tone = "good" | "bad" | "flat";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-xyne-success-fg",
  bad: "text-xyne-error-fg",
  flat: "text-xyne-fg-muted",
};

function signedMs(ms: number | null | undefined): { label: string; tone: Tone } {
  if (ms == null) return { label: "—", tone: "flat" };
  if (Math.abs(ms) < 50) return { label: "≈0 vs previous", tone: "flat" };
  return {
    label: `${ms > 0 ? "+" : ""}${formatMs(Math.abs(ms))} ${ms > 0 ? "slower" : "faster"}`,
    tone: ms > 0 ? "bad" : "good",
  };
}

function signedPct(value: number | null | undefined): { label: string; tone: Tone } {
  if (value == null || Number.isNaN(value)) return { label: "—", tone: "flat" };
  if (Math.abs(value) < 0.001) return { label: "≈0 vs previous", tone: "flat" };
  return {
    label: `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`,
    tone: value > 0 ? "bad" : "good",
  };
}

export function HeadlineKpis({ data }: { data: GlobalMetrics | AgentMetrics }): ReactElement {
  const { totals, delta } = data;

  // Thresholds tuned for the typical claw run mix. The point is to anchor the
  // eye before it dives into details, not to be a precise SLO.
  const concerns: string[] = [];
  if (totals.errorRate > 0.1) concerns.push(`error rate is ${formatPct(totals.errorRate)}`);
  if ((totals.p95TotalMs ?? 0) > 5 * 60_000)
    concerns.push(`slow tail is ${formatMs(totals.p95TotalMs)}`);
  if (delta.errorRate > 0.02) concerns.push("errors trending up");
  if ((delta.p95TotalMs ?? 0) > 30_000) concerns.push("p95 latency trending up");

  const healthy = concerns.length === 0;
  const p50 = signedMs(delta.p50TotalMs);
  const p95 = signedMs(delta.p95TotalMs);
  const err = signedPct(delta.errorRate);

  return (
    <section className="rounded-xl bg-xyne-surface p-[20px] shadow-sm">
      <div
        className={
          "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] " +
          (healthy
            ? "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg"
            : "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg")
        }
      >
        {healthy ? (
          <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
        ) : (
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        )}
        <p>
          {healthy
            ? `Healthy across ${formatCount(totals.runs)} run${totals.runs === 1 ? "" : "s"} in this window.`
            : `${concerns.length} concern${concerns.length === 1 ? "" : "s"}: ${concerns.join(" · ")}.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Typical run"
          help="Half of runs finished faster than this."
          value={formatMs(totals.p50TotalMs)}
          delta={p50.label}
          tone={p50.tone}
        />
        <Kpi
          label="Slow tail (p95)"
          help="The slowest 5% took at least this long."
          value={formatMs(totals.p95TotalMs)}
          delta={p95.label}
          tone={p95.tone}
        />
        <Kpi
          label="Error rate"
          help="Share of runs that failed outright."
          value={formatPct(totals.errorRate)}
          delta={err.label}
          tone={err.tone}
          emphasis={totals.errorRate > 0.1}
        />
        <Kpi
          label="Runs"
          help="Completed runs in the selected window."
          value={formatCount(totals.runs)}
          delta={`${delta.runs >= 0 ? "+" : ""}${formatCount(delta.runs)} vs previous`}
          tone="flat"
        />
      </div>
    </section>
  );
}

function Kpi({
  label,
  help,
  value,
  delta,
  tone,
  emphasis,
}: {
  label: string;
  help: string;
  value: string;
  delta: string;
  tone: Tone;
  emphasis?: boolean;
}): ReactElement {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{label}</div>
      <div
        className={
          "mt-1 text-[28px] font-semibold leading-tight tabular-nums " +
          (emphasis ? "text-xyne-error-fg" : "text-xyne-fg-primary")
        }
      >
        {value}
      </div>
      <div className={"mt-0.5 text-[12px] font-medium " + TONE_TEXT[tone]}>{delta}</div>
      <div className="mt-0.5 text-[11px] text-xyne-fg-muted">{help}</div>
    </div>
  );
}
