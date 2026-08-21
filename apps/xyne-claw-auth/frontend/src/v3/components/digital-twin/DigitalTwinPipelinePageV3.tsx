import { useState, useEffect, useCallback, useRef } from "react";
import {
  FunnelIcon,
  ArrowClockwiseIcon,
  SpinnerGapIcon,
  ArrowLeftIcon,
  WarningIcon,
  ClockIcon,
  CloudArrowUpIcon,
  ArrowsCounterClockwiseIcon,
  ChatCircleDotsIcon,
  CaretRightIcon,
  CaretDownIcon,
  CheckIcon,
  XIcon,
  CopyIcon,
  DatabaseIcon,
  BrainIcon,
  WrenchIcon,
  ScrollIcon,
  ChatTextIcon,
  CodeIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  listDigitalTwinPipelineEvents,
  getDigitalTwinPipelineEvent,
  retryDigitalTwinPipelineEvent,
  getDigitalTwinStatus,
  type PipelineEventSummary,
  type PipelineEventDetail,
  type CuratorEmittedCandidate,
  type CuratorTrace,
  type PipelineRecordPreview,
  type SynthTrace,
  type SynthFileResult,
  type GateTrace,
  type DigitalTwinBackfillBlock,
} from "../../../lib/api";
import { SUBSYSTEM_LABELS } from "./ProposalModal";

interface Props {
  userId: string;
  onBack?: () => void;
  /** Poll for new events while a backfill is actively running. */
  live?: boolean;
  /** When set (deep-link from a memory's "View reasoning"), the matching event
   *  auto-expands on mount. */
  initialEventId?: string | null;
}

type RunTypeFilter = "" | "backfill" | "daily" | "upload" | "twin-approval" | "synthesize" | "gate";
type StatusFilter = "" | "ok" | "empty" | "error" | "running" | "retry";

const RUN_TYPE_OPTIONS: { label: string; value: RunTypeFilter }[] = [
  { label: "All",       value: "" },
  { label: "Backfill",  value: "backfill" },
  { label: "Daily",     value: "daily" },
  { label: "Upload",    value: "upload" },
  { label: "Twin reply", value: "twin-approval" },
  { label: "Persona rebuild", value: "synthesize" },
  { label: "Respond gate", value: "gate" },
];

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All",     value: "" },
  { label: "Running", value: "running" },
  { label: "OK",      value: "ok" },
  { label: "Empty",   value: "empty" },
  { label: "Error",   value: "error" },
];

const RUN_TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  backfill:        { label: "Backfill",   icon: <ArrowsCounterClockwiseIcon size={12} /> },
  daily:           { label: "Daily",      icon: <ClockIcon size={12} /> },
  upload:          { label: "Upload",     icon: <CloudArrowUpIcon size={12} /> },
  "twin-approval": { label: "Twin reply", icon: <ChatCircleDotsIcon size={12} /> },
  synthesize:      { label: "Persona rebuild", icon: <SparkleIcon size={12} weight="fill" /> },
  gate:            { label: "Respond gate", icon: <FunnelIcon size={12} /> },
};

const DROP_REASON_LABELS: Record<string, string> = {
  "empty":             "empty",
  "empty-or-too-long": "empty / too long",
  "bad-subsystem":     "invalid subsystem",
  "low-signal":        "score < 0.7",
  "ungrounded":        "no grounding record",
  "malformed":         "malformed",
};

const PAGE_SIZE = 40;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function fmtWindow(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const f = new Date(from).toLocaleDateString(undefined, opts);
  const t = new Date(to).toLocaleDateString(undefined, opts);
  return f === t ? f : `${f} → ${t}`;
}

// ── Status + verdict chips ────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  if (status === "running" || status === "retry") {
    const isRetry = status === "retry";
    return (
      <span className={`inline-flex items-center gap-[4px] rounded px-[6px] py-[1px] text-[10px] font-semibold uppercase tracking-[0.04em] ${isRetry ? "bg-xyne-warning-bg text-xyne-warning-fg" : "bg-xyne-brand/10 text-xyne-brand"}`}>
        <SpinnerGapIcon size={9} className="animate-spin" /> {status}
      </span>
    );
  }
  const cls =
    status === "ok"
      ? "bg-xyne-success-bg text-xyne-success-fg"
      : status === "error"
      ? "bg-xyne-error-bg text-xyne-error-fg"
      : "bg-xyne-surface-sunken text-xyne-fg-muted";
  return (
    <span className={`rounded px-[6px] py-[1px] text-[10px] font-semibold uppercase tracking-[0.04em] ${cls}`}>
      {status}
    </span>
  );
}

// Editorial display serif — applied inline so it never depends on a Tailwind
// font utility mapping. Used only for large Twin headings.
const SERIF: React.CSSProperties = { fontFamily: "var(--comp-font-serif)" };

// ── Funnel — proportional tapering bar (read → proposed → kept → saved) ───────

// Funnel = records read → facts the LLM proposed → facts you ACCEPTED. "read"
// and "proposed" describe the curator run; "accepted" is the LIVE count of
// candidates from this run you've approved, so it drops when you reject and
// rises as you approve. proposed ≠ accepted until you've reviewed everything.
const FUNNEL_STAGES = [
  { label: "read",     title: "Records fed to the curator this run",       bg: "bg-[#eef1f5]", fg: "text-xyne-fg-secondary" },
  { label: "proposed", title: "Facts the LLM proposed",                    bg: "bg-[#e4e8ee]", fg: "text-xyne-fg-secondary" },
  { label: "accepted", title: "Facts you approved (updates as you review)", bg: "bg-[#cae6d2]", fg: "text-xyne-success-fg" },
] as const;

function Funnel({ read, proposed, accepted }: { read: number; proposed: number; accepted: number }) {
  const vals = [read, proposed, accepted];
  const max = Math.max(1, ...vals);
  return (
    <div
      className="flex h-[34px] min-w-[240px] max-w-[380px] flex-1 items-stretch overflow-hidden rounded-md"
      title="Records read → facts the LLM proposed → facts you've accepted. 'accepted' updates live as you approve/reject in Proposals."
    >
      {FUNNEL_STAGES.map((s, i) => {
        const v = vals[i] ?? 0;
        // Width ∝ count so the bar visibly tapers; floor keeps small/zero legible.
        const grow = Math.max(0.7, (v / max) * 4);
        return (
          <div
            key={s.label}
            title={`${s.label}: ${v} — ${s.title}`}
            className={`flex flex-col justify-center border-r-2 border-xyne-surface px-[10px] ${s.bg} ${v === 0 ? "opacity-40" : ""}`}
            style={{ flexGrow: grow, flexBasis: 0 }}
          >
            <span className={`font-mono text-[12px] font-semibold leading-none tabular-nums ${s.fg}`}>{v}</span>
            <span className="mt-[3px] text-[9px] uppercase tracking-[0.04em] text-xyne-fg-muted">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Grouping — cluster events into one row per backfill/daily/upload trigger ───

interface TriggerGroup {
  key: string;
  runType: string;
  latestAt: string;
  events: PipelineEventSummary[];
}

const CLUSTER_GAP_MS = 20 * 60 * 1000; // events >20min apart start a new trigger

function sameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/**
 * Group the (createdAt-desc) event list into triggers. Backfill/upload cluster
 * by createdAt proximity (one trigger fans out ~12 windows back-to-back); daily
 * and twin-approval group by calendar day. Exact grouping via a backend runId
 * is a follow-up — this heuristic matches real usage (triggers run in minutes,
 * re-triggers are hours/days apart).
 */
function groupEvents(events: PipelineEventSummary[]): TriggerGroup[] {
  const groups: TriggerGroup[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    const prev = last?.events[last.events.length - 1];
    const clustered =
      !!last && !!prev && last.runType === e.runType &&
      (e.runType === "backfill" || e.runType === "upload"
        ? Date.parse(prev.createdAt) - Date.parse(e.createdAt) <= CLUSTER_GAP_MS
        : sameCalendarDay(prev.createdAt, e.createdAt));
    if (clustered) last!.events.push(e);
    else groups.push({ key: e.id, runType: e.runType, latestAt: e.createdAt, events: [e] });
  }
  return groups;
}

function fmtSpanMonths(fromIso: string, toIso: string): string | null {
  const months = (Date.parse(toIso) - Date.parse(fromIso)) / (30 * 24 * 3600 * 1000);
  if (!Number.isFinite(months) || months < 0.5) return null;
  const rounded = Math.round(months);
  if (rounded <= 1) return "1 month";
  if (rounded < 12) return `${rounded} months`;
  const yrs = Math.round(months / 12);
  return yrs === 1 ? "1 year" : `${yrs} years`;
}

interface GroupRollup {
  read: number; proposed: number; accepted: number; autoApproved: number;
  durationMs: number; windowFrom: string; windowTo: string; windows: number;
  sourceKinds: string[]; okCount: number; errorCount: number; hadWork: boolean;
}

function rollup(g: TriggerGroup): GroupRollup {
  let read = 0, proposed = 0, accepted = 0, autoApproved = 0, durationMs = 0, okCount = 0, errorCount = 0;
  let windowFrom = g.events[0]!.windowFrom, windowTo = g.events[0]!.windowTo;
  const kinds = new Set<string>();
  for (const e of g.events) {
    read += e.recordCount; proposed += e.emittedCount; accepted += e.approvedCount ?? 0;
    autoApproved += e.autoApproved; durationMs += e.durationMs;
    if (e.status === "ok") okCount++; if (e.status === "error") errorCount++;
    if (Date.parse(e.windowFrom) < Date.parse(windowFrom)) windowFrom = e.windowFrom;
    if (Date.parse(e.windowTo) > Date.parse(windowTo)) windowTo = e.windowTo;
    if (e.sourceKind) kinds.add(e.sourceKind);
  }
  return {
    read, proposed, accepted, autoApproved, durationMs, windowFrom, windowTo,
    windows: g.events.length, sourceKinds: [...kinds], okCount, errorCount, hadWork: read > 0,
  };
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-[4px] rounded border border-xyne-border bg-xyne-surface px-[6px] py-[2px] text-[10px] text-xyne-fg-muted transition hover:text-xyne-fg-primary"
    >
      {copied ? <CheckIcon size={10} /> : <CopyIcon size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Collapsible monospace block (prompt / raw response / thinking) ────────────

function CodeBlock({
  label,
  text,
  icon,
  defaultOpen,
  tone = "default",
}: {
  label: string;
  text: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  tone?: "default" | "thinking";
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const thinking = tone === "thinking";
  return (
    <div
      className={`rounded-lg border ${
        thinking ? "border-xyne-brand-ghost/30 bg-xyne-brand/10" : "border-xyne-border bg-xyne-surface-sunken"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-[6px] px-[10px] py-[7px] text-left text-[11px] font-semibold ${
          thinking ? "text-xyne-brand" : "text-xyne-fg-secondary"
        }`}
      >
        {open ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
        {icon && <span className={thinking ? "text-xyne-brand" : "text-xyne-fg-muted"}>{icon}</span>}
        {label}
        <span className="text-[10px] font-normal text-xyne-fg-muted">({text.length.toLocaleString()} chars)</span>
        <span className="ml-auto" onClick={(ev) => ev.stopPropagation()}>
          <CopyButton text={text} />
        </span>
      </button>
      {open && (
        <pre
          className={`max-h-[360px] overflow-auto whitespace-pre-wrap break-words border-t px-[12px] py-[10px] text-[11px] leading-relaxed ${
            thinking
              ? "border-xyne-brand-ghost/30 italic text-xyne-fg-secondary"
              : "border-xyne-border text-xyne-fg-secondary"
          }`}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

// ── Tool-call source badge ────────────────────────────────────────────────────

function ToolSourceBadge({ source }: { source: NonNullable<CuratorTrace["toolCallSource"]> }) {
  const recovered = source === "recovered-content";
  return (
    <span
      className={`inline-flex items-center gap-[3px] rounded px-[5px] py-[1px] text-[10px] font-medium ${
        recovered ? "bg-xyne-warning-bg text-xyne-warning-fg" : "bg-xyne-success-bg text-xyne-success-fg"
      }`}
      title={
        recovered
          ? "The model ignored the forced tool call and answered in content; the arguments were parsed out of the raw text."
          : "The model returned a proper tool call."
      }
    >
      {recovered ? <WarningIcon size={9} weight="bold" /> : <CheckIcon size={9} weight="bold" />}
      {recovered ? "recovered from content" : "tool_calls"}
    </span>
  );
}

// ── Tool call block (name + source + arguments) ───────────────────────────────

function ToolCallBlock({ trace }: { trace: CuratorTrace }) {
  const recovered = trace.toolCallSource === "recovered-content";
  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface-sunken">
      <div className="flex flex-wrap items-center gap-[6px] px-[10px] py-[7px] text-[11px] font-semibold text-xyne-fg-secondary">
        <WrenchIcon size={12} className="text-xyne-fg-muted" />
        Tool call
        {trace.toolCallName && (
          <code className="rounded bg-xyne-surface px-[5px] py-[1px] font-mono text-[10px] font-normal text-xyne-fg-primary">
            {trace.toolCallName}
          </code>
        )}
        {trace.toolCallSource && <ToolSourceBadge source={trace.toolCallSource} />}
      </div>
      {recovered && (
        <p className="border-t border-xyne-border px-[10px] py-[6px] text-[10px] leading-relaxed text-xyne-fg-muted">
          The model didn't emit a native tool call — its arguments were parsed out of the raw content (common with
          glm-latest via LiteLLM). See <span className="font-medium">Raw content</span> below for what it actually returned.
        </p>
      )}
      {trace.rawResponse && (
        <div className="border-t border-xyne-border p-[8px]">
          <CodeBlock label="arguments" text={trace.rawResponse} icon={<CodeIcon size={11} />} defaultOpen />
        </div>
      )}
    </div>
  );
}

// ── Emitted candidate row ─────────────────────────────────────────────────────

function EmittedRow({ c }: { c: CuratorEmittedCandidate }) {
  const kept = c.verdict === "kept";
  return (
    <div className="flex gap-[10px] rounded-lg border border-xyne-border bg-xyne-surface p-[10px]">
      <div className="shrink-0 pt-[1px]">
        <span
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
            kept ? "bg-xyne-success-bg text-xyne-success-fg" : "bg-xyne-error-bg text-xyne-error-fg"
          }`}
          title={kept ? "kept" : "dropped"}
        >
          {kept ? <CheckIcon size={11} weight="bold" /> : <XIcon size={11} weight="bold" />}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-relaxed text-xyne-fg-primary">{c.text || <span className="italic text-xyne-fg-muted">(empty)</span>}</p>
        <div className="mt-[5px] flex flex-wrap items-center gap-[6px] text-[10px]">
          {c.subsystem && (
            <span className="rounded bg-xyne-surface-sunken px-[5px] py-[1px] font-medium text-xyne-fg-secondary">
              {SUBSYSTEM_LABELS[c.subsystem] ?? c.subsystem}
            </span>
          )}
          {typeof c.signalScore === "number" && (
            <span className="text-xyne-fg-muted">score {Math.round(c.signalScore * 100)}%</span>
          )}
          {c.groundedOnIds && (
            <span className="text-xyne-fg-muted">· {c.groundedOnIds.length} grounding{c.groundedOnIds.length === 1 ? "" : "s"}</span>
          )}
          {!kept && c.dropReason && (
            <span className="rounded bg-xyne-error-bg px-[5px] py-[1px] font-medium text-xyne-error-fg">
              dropped: {DROP_REASON_LABELS[c.dropReason] ?? c.dropReason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Record preview row ────────────────────────────────────────────────────────

function RecordRow({ r }: { r: PipelineRecordPreview }) {
  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface p-[10px]">
      <div className="flex flex-wrap items-center gap-[6px] text-[10px] text-xyne-fg-muted">
        <span className="rounded bg-xyne-surface-sunken px-[5px] py-[1px] font-medium text-xyne-fg-secondary">{r.type}</span>
        {r.channelName && <span>#{r.channelName}</span>}
        {r.title && <span className="truncate">{r.title}</span>}
        <span className="ml-auto">{new Date(r.ts).toLocaleString()}</span>
      </div>
      <p className="mt-[6px] whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">
        {r.textPreview}
      </p>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, count, children, defaultOpen }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[6px] text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted"
      >
        {open ? <CaretDownIcon size={11} /> : <CaretRightIcon size={11} />}
        {title}
        <span className="text-xyne-fg-tertiary">({count})</span>
      </button>
      {open && <div className="mt-[8px] flex flex-col gap-[8px]">{children}</div>}
    </div>
  );
}

// ── Expanded detail ───────────────────────────────────────────────────────────

function EventDetail({ userId, id }: { userId: string; id: string }) {
  const [detail, setDetail] = useState<PipelineEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<"idle" | "sending" | "started" | "failed">("idle");

  const onRetry = async (): Promise<void> => {
    setRetry("sending");
    try {
      await retryDigitalTwinPipelineEvent(userId, id);
      setRetry("started");
    } catch {
      setRetry("failed");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDigitalTwinPipelineEvent(userId, id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setError("Failed to load event detail"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[20px]">
        <SpinnerGapIcon size={18} className="animate-spin text-xyne-fg-muted" />
      </div>
    );
  }
  if (error || !detail) {
    return <div className="px-[4px] py-[10px] text-[12px] text-xyne-error-fg">{error ?? "Not found"}</div>;
  }

  const trace = detail.trace;
  // Synthesis runs carry a SynthTrace (per-file breakdown), not a curator trace.
  if (isSynthTrace(trace)) {
    return <SynthDetail detail={detail} trace={trace} />;
  }
  // Respond/ignore gate decisions carry a GateTrace (input + LLM exchange).
  if (isGateTrace(trace)) {
    return <GateDetail detail={detail} trace={trace} />;
  }
  const meta: Array<[string, string]> = [
    ["Model", trace?.model ?? "—"],
    ["Duration", fmtDuration(detail.durationMs)],
    ["Prompt", trace?.promptChars != null ? `${trace.promptChars.toLocaleString()} chars` : "—"],
    ["Tokens", trace?.usage ? `${trace.usage.promptTokens ?? "?"} in / ${trace.usage.completionTokens ?? "?"} out` : "—"],
    ...(trace?.finishReason ? ([["Finish reason", trace.finishReason]] as Array<[string, string]>) : []),
    ["Existing memories", String(detail.existingMemoryCount)],
    ["Source", detail.source],
    ["Window", `${new Date(detail.windowFrom).toLocaleString()} → ${new Date(detail.windowTo).toLocaleString()}`],
  ];

  const hasToolCall = !!(trace && (trace.toolCallName || trace.rawResponse || trace.toolCallSource));
  const hasExchange = !!(trace && (trace.systemPrompt || trace.prompt || trace.reasoning || hasToolCall || trace.rawContent));

  return (
    <div className="flex flex-col gap-[14px] border-t border-xyne-border bg-xyne-surface-subtle px-[16px] py-[14px]">
      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-[16px] gap-y-[6px] sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">{k}</p>
            <p className="truncate text-[12px] text-xyne-fg-primary" title={v}>{v}</p>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {(detail.status === "error" || trace?.error) && (
        <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-[12px] py-[9px] text-[12px] text-xyne-error-fg">
          <span className="font-semibold">Pipeline error: </span>
          {trace?.error ?? detail.error ?? "unknown error"}
        </div>
      )}

      {/* Retry — only for runs that stored nothing, so it can't duplicate
          candidates. Re-walks the same window; results arrive as new events. */}
      {(detail.status === "error" || detail.status === "empty") && detail.sourceKind && (
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            onClick={onRetry}
            disabled={retry === "sending" || retry === "started"}
            className="flex items-center gap-[6px] rounded border border-xyne-border px-[10px] py-[5px] text-[11.5px] text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-hover disabled:opacity-50"
          >
            {retry === "sending" && <SpinnerGapIcon size={12} className="animate-spin" />}
            {retry === "started" ? "Retry started" : "Retry this window"}
          </button>
          <span className="text-[11px] text-xyne-fg-muted">
            {retry === "started"
              ? "Running in the background — refresh in a minute to see the new run."
              : retry === "failed"
                ? "Could not start the retry."
                : `Re-runs ${detail.sourceKind} for this window.`}
          </span>
        </div>
      )}

      {/* LLM candidates (verdicts). `trace.emitted` only exists once the curator
          LLM has responded — a still-running run carries a PARTIAL trace without
          it, so guard the array itself (not just `trace`), and show an in-progress
          note for running runs instead of crashing on `.length`. */}
      {trace?.emitted ? (
        trace.emitted.length > 0 ? (
          <Section title="LLM candidates" count={trace.emitted.length} defaultOpen>
            {trace.emitted.map((c, i) => <EmittedRow key={i} c={c} />)}
          </Section>
        ) : (
          <p className="text-[12px] text-xyne-fg-muted">
            The LLM emitted no candidates for this batch{detail.status === "empty" ? " (no records to distill)." : "."}
          </p>
        )
      ) : detail.status === "running" ? (
        <p className="text-[12px] text-xyne-fg-muted">Run in progress — candidates and the LLM exchange will appear once it completes.</p>
      ) : (
        <p className="text-[12px] text-xyne-fg-muted">No trace captured for this event.</p>
      )}

      {/* LLM exchange — full debug trace of the single curator call */}
      {hasExchange && (
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted">
            <SparkleIcon size={12} className="text-xyne-brand" weight="fill" />
            LLM exchange
          </div>
          {trace?.systemPrompt && (
            <CodeBlock label="System prompt" text={trace.systemPrompt} icon={<ScrollIcon size={11} />} />
          )}
          {trace?.prompt && (
            <CodeBlock label="User prompt" text={trace.prompt} icon={<ChatTextIcon size={11} />} />
          )}
          {trace?.reasoning && (
            <CodeBlock label="Model thinking" text={trace.reasoning} icon={<BrainIcon size={11} />} tone="thinking" defaultOpen />
          )}
          {hasToolCall && trace && <ToolCallBlock trace={trace} />}
          {trace?.rawContent && (
            <CodeBlock label="Raw content" text={trace.rawContent} icon={<ChatTextIcon size={11} />} />
          )}
        </div>
      )}

      {/* Records sent */}
      {detail.records && detail.records.length > 0 && (
        <Section title="Records sent" count={detail.records.length}>
          {detail.records.map((r) => <RecordRow key={r.id} r={r} />)}
        </Section>
      )}
    </div>
  );
}

// ── Synthesis (persona rebuild) detail ────────────────────────────────────────

function isSynthTrace(t: CuratorTrace | SynthTrace | GateTrace | null): t is SynthTrace {
  return !!t && (t as SynthTrace).kind === "synthesize";
}

function isGateTrace(t: CuratorTrace | SynthTrace | GateTrace | null): t is GateTrace {
  return !!t && (t as GateTrace).kind === "gate";
}

// ── Respond/ignore gate decision detail ───────────────────────────────────────

function GateDetail({ detail, trace }: { detail: PipelineEventDetail; trace: GateTrace }) {
  const meta: Array<[string, string]> = [
    ["Decision", trace.respond ? "Replied" : "Stayed silent"],
    ["Confidence", `${Math.round((trace.confidence ?? 0) * 100)}%`],
    ["Via", trace.decisionSource],
    ...(trace.model ? ([["Model", trace.model]] as Array<[string, string]>) : []),
    ["Latency", fmtDuration(detail.durationMs)],
    ...(trace.senderName ? ([["From", trace.senderName]] as Array<[string, string]>) : []),
    ...(trace.channelName
      ? ([["Channel", `#${trace.channelName}${trace.channelType ? ` (${trace.channelType})` : ""}`]] as Array<[string, string]>)
      : []),
    ["When", new Date(detail.windowFrom).toLocaleString()],
  ];
  const hasExchange = !!(trace.systemPrompt || trace.userPrompt || trace.response || trace.thinking);
  return (
    <div className="flex flex-col gap-[14px] border-t border-xyne-border bg-xyne-surface-subtle px-[16px] py-[14px]">
      {/* Failure banner — the gate errored (timeout / HTTP / bad response) and
          fail-opened to a reply. Shown above the decision so failures stand out. */}
      {trace.error && (
        <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-[12px] py-[9px] text-[12px] text-xyne-error-fg">
          <span className="font-semibold">Gate failed (fail-open): </span>{trace.error}
        </div>
      )}
      {/* Decision banner */}
      <div
        className={`rounded-lg border px-[12px] py-[9px] text-[12px] ${trace.respond ? "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg" : "border-xyne-border bg-xyne-surface-sunken text-xyne-fg-secondary"}`}
      >
        <span className="font-semibold">{trace.respond ? "Twin replied" : "Twin stayed silent"}</span>
        {trace.reason ? ` — ${trace.reason}` : ""}
      </div>
      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-[16px] gap-y-[6px] sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">{k}</p>
            <p className="truncate text-[12px] text-xyne-fg-primary" title={v}>{v}</p>
          </div>
        ))}
      </div>
      {/* Incoming message (the webhook event) */}
      <CodeBlock label="Incoming message" text={trace.incoming} icon={<ChatTextIcon size={11} />} defaultOpen />
      {/* Full LLM exchange */}
      {hasExchange ? (
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted">
            <SparkleIcon size={12} className="text-xyne-brand" weight="fill" /> Gate LLM exchange
          </div>
          {trace.systemPrompt && <CodeBlock label="System prompt" text={trace.systemPrompt} icon={<ScrollIcon size={11} />} />}
          {trace.userPrompt && <CodeBlock label="User prompt" text={trace.userPrompt} icon={<ChatTextIcon size={11} />} />}
          {trace.thinking && <CodeBlock label="Model thinking" text={trace.thinking} icon={<BrainIcon size={11} />} tone="thinking" defaultOpen />}
          {trace.response && <CodeBlock label="Decision output" text={trace.response} icon={<CodeIcon size={11} />} />}
        </div>
      ) : (
        <p className="text-[12px] text-xyne-fg-muted">Decided by rule ({trace.decisionSource}) — no LLM call.</p>
      )}
    </div>
  );
}

function SynthFileRow({ f }: { f: SynthFileResult }) {
  const [open, setOpen] = useState(false);
  const tone =
    f.action === "updated"
      ? "text-xyne-success-fg"
      : f.action === "error"
      ? "text-xyne-error-fg"
      : "text-xyne-fg-muted";
  const hasExchange = !!(f.systemPrompt || f.userPrompt || f.rawOutput);
  const available = f.factsAvailable ?? f.factsUsed;
  const tokens = f.usage
    ? `${f.usage.promptTokens ?? "?"} in / ${f.usage.completionTokens ?? "?"} out`
    : "—";
  return (
    <div className="bg-xyne-surface">
      <button
        type="button"
        onClick={() => hasExchange && setOpen((v) => !v)}
        className={`flex w-full items-center gap-[8px] px-[12px] py-[8px] text-left ${hasExchange ? "cursor-pointer hover:bg-xyne-surface-sunken" : "cursor-default"}`}
      >
        {hasExchange
          ? open ? <CaretDownIcon size={11} className="text-xyne-fg-muted" /> : <CaretRightIcon size={11} className="text-xyne-fg-muted" />
          : <span className="w-[11px]" />}
        <span className="font-mono text-[12px] text-xyne-fg-primary">{f.name}</span>
        <span className="text-[11px] text-xyne-fg-tertiary">
          {f.factsUsed}{available !== f.factsUsed ? ` of ${available}` : ""} fact{available === 1 ? "" : "s"}
          {f.chars ? ` · ${f.chars.toLocaleString()} chars` : ""}
          {f.error ? ` · ${f.error}` : ""}
        </span>
        {f.contextLimited && (
          <span
            className="flex items-center gap-[3px] text-[10px] font-medium text-xyne-warning-fg"
            title={`Input capped: ${f.factsDropped ?? available - f.factsUsed} memories omitted${f.factsClipped ? `, ${f.factsClipped} clipped` : ""}.`}
          >
            <WarningIcon size={10} /> context limited
          </span>
        )}
        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-[0.04em] ${tone}`}>{f.action}</span>
      </button>
      {open && hasExchange && (
        <div className="flex flex-col gap-[8px] border-t border-xyne-border-subtle bg-xyne-surface-subtle px-[12px] py-[10px]">
          <div className="grid grid-cols-2 gap-x-[16px] gap-y-[6px] sm:grid-cols-4">
            {[
              ["Model", f.model ?? "—"],
              ["LLM duration", fmtDuration(f.durationMs ?? 0)],
              ["Prompt", f.promptChars != null ? `${f.promptChars.toLocaleString()} chars` : "—"],
              ["Tokens", tokens],
              ["Facts", `${f.factsUsed} used / ${available} available`],
              ["Fact budget", f.factInputBudgetChars != null ? `${(f.factInputChars ?? 0).toLocaleString()} / ${f.factInputBudgetChars.toLocaleString()} chars` : "—"],
              ["Finish reason", f.finishReason ?? "—"],
              ["Output", f.chars != null ? `${f.chars.toLocaleString()} chars stored` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">{k}</p>
                <p className="truncate text-[12px] text-xyne-fg-primary" title={v}>{v}</p>
              </div>
            ))}
          </div>
          {f.contextLimited && (
            <div className="rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-[10px] py-[8px] text-[11px] text-xyne-warning-fg">
              The input guard included {f.factsUsed} of {available} memories and omitted {f.factsDropped ?? available - f.factsUsed}
              {f.factsClipped ? `; ${f.factsClipped} oversized memories were clipped by the previous per-memory limit` : ""}. The exact text sent is visible in the user prompt below.
            </div>
          )}
          <div className="flex items-center gap-[6px] pt-[2px] text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-muted">
            <SparkleIcon size={12} className="text-xyne-brand" weight="fill" /> LLM exchange
          </div>
          {f.systemPrompt && <CodeBlock label="System prompt" text={f.systemPrompt} icon={<ScrollIcon size={11} />} />}
          {f.userPrompt && <CodeBlock label="User prompt" text={f.userPrompt} icon={<ChatTextIcon size={11} />} />}
          {f.rawOutput && <CodeBlock label="LLM output" text={f.rawOutput} icon={<CodeIcon size={11} />} defaultOpen />}
        </div>
      )}
    </div>
  );
}

function SynthDetail({ detail, trace }: { detail: PipelineEventDetail; trace: SynthTrace }) {
  const updated = trace.files.filter((f) => f.action === "updated");
  const meta: Array<[string, string]> = [
    ["Trigger", trace.trigger],
    ["Files updated", `${updated.length} of ${trace.files.length}`],
    ["Duration", trace.running ? "running…" : fmtDuration(detail.durationMs)],
    ["When", new Date(detail.createdAt).toLocaleString()],
  ];
  return (
    <div className="flex flex-col gap-[14px] border-t border-xyne-border bg-xyne-surface-subtle px-[16px] py-[14px]">
      <div className="grid grid-cols-2 gap-x-[16px] gap-y-[6px] sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.06em] text-xyne-fg-muted">{k}</p>
            <p className="truncate text-[12px] text-xyne-fg-primary" title={v}>{v}</p>
          </div>
        ))}
      </div>
      {detail.error && (
        <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-[12px] py-[9px] text-[12px] text-xyne-error-fg">
          <span className="font-semibold">Error: </span>
          {detail.error}
        </div>
      )}
      {trace.files.length > 0 ? (
        <div className="flex flex-col divide-y divide-xyne-border-subtle overflow-hidden rounded-lg border border-xyne-border">
          {trace.files.map((f) => <SynthFileRow key={f.name} f={f} />)}
        </div>
      ) : (
        <p className="text-[12px] text-xyne-fg-muted">No files compiled yet.</p>
      )}
      {trace.running && (
        <p className="flex items-center gap-[6px] text-[12px] text-xyne-fg-muted">
          <SpinnerGapIcon size={12} className="animate-spin" />
          Compiling files from your approved memories…
        </p>
      )}
    </div>
  );
}

// ── Source glyph (inline SVG so there's no icon-import risk) ───────────────────

function SourceGlyph({ kind }: { kind: string | null }) {
  const common = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, className: "h-[15px] w-[15px] text-xyne-fg-muted" } as const;
  if (kind === "calls") return <svg {...common}><circle cx="8" cy="8" r="5.2" /><path d="M8 5v3l2 1.4" /></svg>;
  if (kind === "canvases") return <svg {...common}><rect x="3" y="2.5" width="10" height="11" rx="1.3" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></svg>;
  // messages (default)
  return <svg {...common}><path d="M2 4.5h12v7H5l-3 2.5z" /></svg>;
}

function sourceLabel(e: PipelineEventSummary): string {
  if (e.runType === "synthesize") return "persona files";
  if (e.runType === "gate") return "respond gate";
  if (e.sourceKind) return e.sourceKind;
  if (e.runType === "upload") return "upload";
  if (e.runType === "twin-approval") return "twin reply";
  return "run";
}

// ── Event row — thin timeline row, expands to the full debug detail ───────────

function EventRow({ userId, e, initialEventId }: { userId: string; e: PipelineEventSummary; initialEventId?: string | null }) {
  const [open, setOpen] = useState(e.id === initialEventId);
  const hasCounts = e.recordCount > 0;
  return (
    <div className="border-t border-xyne-border-subtle first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`grid w-full grid-cols-[minmax(140px,190px)_1fr_auto] items-center gap-[16px] py-[9px] pr-[2px] text-left transition ${open ? "" : "hover:bg-xyne-surface-subtle"}`}
      >
        <span className={`flex items-center gap-[8px] ${e.status === "empty" ? "text-xyne-fg-muted" : "text-xyne-fg-secondary"}`}>
          <SourceGlyph kind={e.sourceKind} />
          <span className="truncate text-[12.5px] font-medium">{sourceLabel(e)}</span>
        </span>
        <span className={`truncate font-mono text-[11.5px] ${e.status === "empty" ? "text-xyne-fg-muted" : "text-xyne-fg-tertiary"}`}>
          {fmtWindow(e.windowFrom, e.windowTo)}
        </span>
        <span className="flex items-center gap-[14px] justify-self-end">
          {e.runType === "synthesize" ? (
            <span
              className="hidden font-mono text-[11.5px] text-xyne-fg-tertiary tabular-nums sm:inline"
              title={`${e.keptCount} of ${e.emittedCount} persona files updated`}
            >
              <b className="font-semibold text-xyne-fg-primary">{e.keptCount}</b>
              <span className="mx-[3px] text-xyne-fg-muted">/</span>
              {e.emittedCount} files
            </span>
          ) : e.runType === "gate" ? (
            <span className={`hidden font-mono text-[11.5px] tabular-nums sm:inline ${e.status === "ok" ? "text-xyne-success-fg" : "text-xyne-fg-muted"}`}>
              {e.status === "ok" ? "replied" : "stayed silent"}
            </span>
          ) : hasCounts ? (
            <span
              className="hidden font-mono text-[11.5px] text-xyne-fg-tertiary tabular-nums sm:inline"
              title={`${e.recordCount} read → ${e.emittedCount} proposed → ${e.approvedCount ?? 0} accepted${e.pendingCount ? ` (${e.pendingCount} pending)` : ""}`}
            >
              <b className="font-semibold text-xyne-fg-primary">{e.recordCount}</b>
              <span className="mx-[3px] text-xyne-fg-muted">→</span>
              <b className="font-semibold text-xyne-fg-primary">{e.emittedCount}</b>
              <span className="mx-[3px] text-xyne-fg-muted">→</span>
              <b className="font-semibold text-xyne-fg-primary">{e.approvedCount ?? 0}</b>
            </span>
          ) : (
            <span className="hidden font-mono text-[11px] text-xyne-fg-muted sm:inline">no records</span>
          )}
          <span className="min-w-[42px] text-right font-mono text-[11px] text-xyne-fg-muted">{e.status === "empty" ? "—" : fmtDuration(e.durationMs)}</span>
          <StatusChip status={e.status} />
          <span className="text-xyne-fg-muted">{open ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}</span>
        </span>
      </button>
      {e.error && !open && (
        <p className="flex items-start gap-[4px] pb-[8px] text-[11px] text-xyne-error-fg">
          <WarningIcon size={12} className="mt-[1px] shrink-0" />
          <span className="line-clamp-1">{e.error}</span>
        </p>
      )}
      {open && (
        <div className="-ml-[30px] mb-[8px] overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
          <EventDetail userId={userId} id={e.id} />
        </div>
      )}
    </div>
  );
}

// ── Trigger group — one backfill/daily/upload run, on the timeline rail ────────

function TriggerGroupView({ userId, group, initialEventId }: { userId: string; group: TriggerGroup; initialEventId?: string | null }) {
  const r = rollup(group);
  const meta = RUN_TYPE_META[group.runType];
  const span = group.runType === "backfill" ? fmtSpanMonths(r.windowFrom, r.windowTo) : null;
  const isSynth = group.runType === "synthesize";
  const synthUpdated = group.events.reduce((s, e) => s + e.keptCount, 0);
  const synthTotal = group.events.reduce((s, e) => s + e.emittedCount, 0);
  const synthRunning = group.events.some((e) => e.status === "running");
  const isGate = group.runType === "gate";
  const gateReplied = group.events.filter((e) => e.status === "ok").length;
  const gateSilent = group.events.filter((e) => e.status === "empty").length;
  return (
    <div className="relative pl-[30px]">
      {/* rail */}
      <span className="absolute left-[9px] top-[30px] bottom-[8px] w-[1.5px] bg-xyne-border-subtle" />
      {/* node */}
      <span className="absolute left-[1px] top-[20px] flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-xyne-fg-primary bg-xyne-surface">
        <span className="h-[6px] w-[6px] rounded-full bg-xyne-fg-primary" />
      </span>

      {/* header */}
      <div className="pt-[14px] pb-[12px]">
        <div className="flex flex-wrap items-baseline gap-[10px]">
          <span className="inline-flex items-center gap-[6px] text-[15px] font-semibold text-xyne-fg-primary" style={SERIF}>
            {meta?.icon}{meta?.label ?? group.runType}
          </span>
          {span && (
            <span className="rounded border border-xyne-border px-[6px] py-[1px] font-mono text-[10px] uppercase tracking-[0.03em] text-xyne-fg-tertiary">{span}</span>
          )}
          <span className="font-mono text-[11.5px] text-xyne-fg-tertiary" title={new Date(group.latestAt).toLocaleString()}>
            {timeAgo(group.latestAt)}
          </span>
          {r.errorCount > 0 && (
            <span className="rounded bg-xyne-error-bg px-[6px] py-[1px] text-[10px] font-medium text-xyne-error-fg">{r.errorCount} error{r.errorCount > 1 ? "s" : ""}</span>
          )}
        </div>

        <div className="mt-[12px] flex flex-wrap items-center gap-x-[22px] gap-y-[10px]">
          {isSynth ? (
            synthRunning ? (
              <span className="flex items-center gap-[7px] text-[13px] text-xyne-fg-secondary">
                <SpinnerGapIcon size={14} className="animate-spin" /> Rebuilding persona from your approved memories…
              </span>
            ) : (
              <span className="flex items-baseline gap-[6px]" title="Persona files recompiled from your approved memories.">
                <span className="font-mono text-[17px] font-semibold text-xyne-fg-primary">{synthUpdated}</span>
                <span className="text-[11px] text-xyne-fg-tertiary">of {synthTotal} persona files updated</span>
              </span>
            )
          ) : isGate ? (
            <span className="flex items-baseline gap-[6px]" title="Respond/ignore gate decisions in this trigger.">
              <span className="font-mono text-[17px] font-semibold text-xyne-fg-primary">{gateReplied}</span>
              <span className="text-[11px] text-xyne-fg-tertiary">replied</span>
              <span className="mx-[2px] text-xyne-fg-muted">·</span>
              <span className="font-mono text-[17px] font-semibold text-xyne-fg-primary">{gateSilent}</span>
              <span className="text-[11px] text-xyne-fg-tertiary">stayed silent</span>
            </span>
          ) : r.hadWork ? (
            <>
              <span className="flex items-baseline gap-[6px]" title="Records read this run → facts you've accepted from it.">
                <span className="font-mono text-[17px] font-semibold text-xyne-fg-primary">{r.read}</span>
                <span className="text-[11px] text-xyne-fg-tertiary">records</span>
                <span className="mx-[2px] text-xyne-fg-muted">→</span>
                <span className="font-mono text-[17px] font-semibold text-xyne-fg-primary">{r.accepted}</span>
                <span className="text-[11px] text-xyne-fg-tertiary">accepted</span>
              </span>
              <Funnel read={r.read} proposed={r.proposed} accepted={r.accepted} />
            </>
          ) : (
            <span className="text-[12px] text-xyne-fg-muted">No records in this run — nothing to distil.</span>
          )}
          <span className="ml-auto font-mono text-[11px] text-xyne-fg-tertiary">
            {isSynth || isGate ? null : (
              <>
                {r.windows} window{r.windows > 1 ? "s" : ""}
                {r.sourceKinds.length > 0 && <> · {r.sourceKinds.join(" · ")}</>}
              </>
            )}
            {r.durationMs > 0 && <>{isSynth || isGate ? "" : " · "}{fmtDuration(r.durationMs)}</>}
            {r.autoApproved > 0 && <> · {r.autoApproved} auto</>}
          </span>
        </div>
      </div>

      {/* events */}
      <div className="pb-[8px]">
        {group.events.map((e) => <EventRow key={e.id} userId={userId} e={e} initialEventId={initialEventId} />)}
      </div>
    </div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

function Pills<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-[2px] rounded-lg border border-xyne-border bg-xyne-surface-sunken p-[2px]">
      {options.map((o) => (
        <button
          key={o.value || "all"}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-[9px] py-[3px] text-[11px] font-medium transition ${
            value === o.value
              ? "bg-xyne-surface text-xyne-fg-primary shadow-sm"
              : "text-xyne-fg-muted hover:text-xyne-fg-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/** Slim one-line "what's happening right now" strip above the feed, so the page
 *  is never silent during long curator LLM calls. No card / no nested boxes —
 *  one horizontal line of muted text that updates every few seconds. */
function LiveBackfillStrip({ block }: { block: DigitalTwinBackfillBlock }) {
  const o = block.overall;
  const win = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // The source being worked right now (active BullMQ job, or a live window).
  const active = Object.entries(block.sources).find(
    ([, s]) => s.job?.state === "active" || (!s.complete && !!s.currentWindow),
  );
  const src = active?.[0];
  const s = active?.[1];
  const cw = s?.currentWindow;
  const retrying = s?.job && s.job.attemptsMade > 0 ? `retry ${s.job.attemptsMade}/${s.job.maxAttempts}` : null;
  const lastErr = s?.lastError?.message;
  return (
    <div className="mb-[14px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] border-b border-xyne-border pb-[11px] text-[12px] text-xyne-fg-secondary">
      <span className="flex items-center gap-[6px] font-medium text-xyne-brand">
        <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-xyne-brand" />
        {o.stalled ? "Stalled" : "Working"}
      </span>
      <span className="font-mono text-[11px] text-xyne-fg-tertiary">
        {o.windowsDone}/{o.windowsTotal} windows{o.pctByWindows != null ? ` · ${o.pctByWindows}%` : ""}
      </span>
      {src && (
        <span>
          · {src}
          {cw ? ` ${win(cw.from)}–${win(cw.to)}` : ""}
        </span>
      )}
      {retrying && <span className="text-xyne-warning-fg">· {retrying}</span>}
      <span className="font-mono text-[11px] text-xyne-fg-tertiary">· {o.candidatesMade} memories</span>
      {lastErr && <span className="truncate text-xyne-fg-muted">· last: {lastErr}</span>}
    </div>
  );
}

export function DigitalTwinPipelinePageV3({ userId, onBack, live = false, initialEventId }: Props) {
  const [events, setEvents] = useState<PipelineEventSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runType, setRunType] = useState<RunTypeFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");

  // Guard against out-of-order responses when filters change quickly.
  const reqIdRef = useRef(0);

  // Live backfill overview (separate, faster poll than the event feed) — drives
  // the top strip so long silent LLM calls still show forward progress.
  const [backfill, setBackfill] = useState<DigitalTwinBackfillBlock | null>(null);
  const statusReqRef = useRef(0);
  const loadStatus = useCallback(async () => {
    const reqId = ++statusReqRef.current;
    try {
      const s = await getDigitalTwinStatus(userId);
      if (reqId === statusReqRef.current) setBackfill(s.backfill ?? null);
    } catch { /* best-effort — the strip just hides */ }
  }, [userId]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void loadStatus(), 30_000);
    return () => clearInterval(t);
  }, [live, loadStatus]);

  const load = useCallback(async (silent: boolean) => {
    const reqId = ++reqIdRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const page = await listDigitalTwinPipelineEvents(userId, {
        limit: PAGE_SIZE,
        ...(runType ? { runType } : {}),
        ...(status ? { status } : {}),
      });
      if (reqId !== reqIdRef.current) return;
      setEvents(page.events);
      setNextBefore(page.nextBefore);
    } catch {
      if (reqId === reqIdRef.current) setError("Failed to load pipeline events");
    } finally {
      if (reqId === reqIdRef.current && !silent) setLoading(false);
    }
  }, [userId, runType, status]);

  useEffect(() => { void load(false); }, [load]);

  // Live polling while a backfill is running — silent so the list doesn't flash.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(true), 30_000);
    return () => clearInterval(t);
  }, [live, load]);

  const loadMore = useCallback(async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await listDigitalTwinPipelineEvents(userId, {
        limit: PAGE_SIZE,
        before: nextBefore,
        ...(runType ? { runType } : {}),
        ...(status ? { status } : {}),
      });
      setEvents((prev) => [...prev, ...page.events]);
      setNextBefore(page.nextBefore);
    } catch {
      setError("Failed to load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [userId, nextBefore, runType, status]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-xyne-border bg-xyne-surface">
        <div className="flex flex-wrap items-center gap-[12px] px-[24px] py-[14px]">
          {/* Back to overview — on the LEFT (conventional placement) */}
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[5px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
            >
              <ArrowLeftIcon size={13} />
              Overview
            </button>
          )}
          <FunnelIcon size={20} className="text-xyne-brand" weight="duotone" />
          <div>
            <h1 className="flex items-center gap-[8px] text-[18px] font-semibold text-xyne-fg-primary" style={SERIF}>
              Memory activity
              {live && (
                <span className="flex items-center gap-[4px] text-[10px] font-medium text-xyne-success-fg">
                  <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-xyne-success-fg" />
                  live
                </span>
              )}
            </h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              Every curator run — what it read, what the LLM proposed, and what you've accepted
            </p>
          </div>
          <button
            onClick={() => void load(false)}
            disabled={loading}
            className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-md text-xyne-fg-muted transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-40"
            aria-label="Refresh"
          >
            {loading ? <SpinnerGapIcon size={14} className="animate-spin" /> : <ArrowClockwiseIcon size={14} />}
          </button>
        </div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-[10px] px-[24px] pb-[12px]">
          <Pills options={RUN_TYPE_OPTIONS} value={runType} onChange={setRunType} />
          <Pills options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-[24px] py-[16px]">
          {backfill?.overall.running && <LiveBackfillStrip block={backfill} />}
          {loading && events.length === 0 && (
            <div className="flex items-center justify-center py-[60px]">
              <SpinnerGapIcon size={22} className="animate-spin text-xyne-fg-muted" />
            </div>
          )}

          {error && (
            <div className="mb-[12px] rounded-lg border border-xyne-error-border bg-xyne-error-bg p-[12px] text-[12px] text-xyne-error-fg">
              {error}{" "}
              <button onClick={() => void load(false)} className="underline">Retry</button>
            </div>
          )}

          {!loading && events.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-[60px] text-center">
              <DatabaseIcon size={30} className="mb-[10px] text-xyne-fg-muted" />
              <p className="text-[14px] font-medium text-xyne-fg-secondary">No pipeline events yet</p>
              <p className="mt-[4px] max-w-[380px] text-[12px] text-xyne-fg-tertiary">
                Events appear here once a backfill, daily sync, or upload runs — each one records the full curator exchange.
              </p>
            </div>
          )}

          {events.length > 0 && (
            <div className="flex flex-col">
              {groupEvents(events).map((g) => <TriggerGroupView key={g.key} userId={userId} group={g} initialEventId={initialEventId} />)}
            </div>
          )}

          {nextBefore && (
            <div className="mt-[14px] flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[14px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-40"
              >
                {loadingMore && <SpinnerGapIcon size={13} className="animate-spin" />}
                Load older
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
