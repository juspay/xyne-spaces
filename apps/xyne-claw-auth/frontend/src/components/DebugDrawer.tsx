import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  Braces,
  BrainCircuit,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Copy,
  FileText,
  Lightbulb,
  ListTree,
  Maximize2,
  MessagesSquare,
  MessageSquareText,
  Quote,
  RefreshCw,
  RotateCcw,
  Sparkles,
  User,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchConversationDebugArtifacts, type DebugArtifactBundle, type DebugEventRecord } from "../lib/api";
import { deepParseJson } from "../lib/toolFormat";

type DebugDrawerProps = {
  open: boolean;
  agentSlug: string;
  conversationId: string | null | undefined;
  onClose: () => void;
  inline?: boolean;
  width?: number;
  liveEvents?: DebugEventRecord[];
  running?: boolean;
  artifactsReadyVersion?: number;
  selectedTurnIndex?: number | null;
  selectedTurnLive?: boolean;
  /** Branching-safe turn selection. When set, the drawer renders ONLY the run
   *  whose data.sessionId matches — chronological turn indexes don't survive
   *  branching (the Nth visible assistant may not be the Nth run by time
   *  once siblings exist). Caller derives this from runByAssistantMsgId. */
  selectedSessionId?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Palette diffs arrive under two spellings: a `tool_palette_change` event names
 * them `added`/`removed`, while `paletteAdded`/`paletteRemoved` is what the
 * materializer folds off an `llm_request` onto its `session_prompt`. Read both
 * so a palette row renders its chips on either shape.
 */
function paletteList(data: Record<string, unknown>, folded: "paletteAdded" | "paletteRemoved", own: "added" | "removed"): string[] {
  const foldedList = stringList(data[folded]);
  return foldedList.length > 0 ? foldedList : stringList(data[own]);
}

/** A payload the v2 writer interned into the blob log instead of inlining. */
type BlobRefLike = { hash: string; bytes?: number; originalBytes?: number; truncated?: boolean; preview?: string };

function asBlobRef(value: unknown): BlobRefLike | null {
  if (!isRecord(value) || typeof value.hash !== "string") return null;
  return value as BlobRefLike;
}

type ResolvedField = {
  text: string;
  /** Bytes for a ref (what the writer stored), chars for an inline string. */
  size: number;
  truncated: boolean;
  isRef: boolean;
};

/**
 * Reads a payload field that may arrive inline OR as a blob ref — either in the
 * field itself or in its `<field>Ref` sibling, which is what survives when the
 * blob content could not be resolved. A ref renders its preview rather than an
 * empty panel, so "captured but not inlined" never looks like "nothing here".
 */
function resolveFieldText(data: Record<string, unknown>, key: string): ResolvedField | null {
  const inline = data[key];
  if (typeof inline === "string") {
    return inline ? { text: inline, size: inline.length, truncated: false, isRef: false } : null;
  }
  const ref = asBlobRef(inline) ?? asBlobRef(data[`${key}Ref`]);
  if (!ref) return null;
  const preview = typeof ref.preview === "string" ? ref.preview : "";
  return {
    text: preview,
    size: typeof ref.bytes === "number" ? ref.bytes : preview.length,
    truncated: ref.truncated === true || ref.originalBytes !== undefined || !preview,
    isRef: true,
  };
}

function fieldSizeLabel(field: ResolvedField): string {
  return `${field.size} ${field.isRef ? "bytes" : "chars"}${field.truncated ? " · truncated" : ""}`;
}

/**
 * What a ref-backed field is actually showing. On the LIVE channel a ref is
 * always just its ~200-char preview — the payload stays in claw's blob log
 * until the run finishes and the trace is materialized, and we deliberately
 * don't push a 20 KB system prompt over the wire every turn. Say that, instead
 * of letting a preview pass for the whole value.
 */
function refNote(field: ResolvedField, live = false): string {
  const head = field.text ? "preview" : "not inlined";
  const tail = live ? " · full content available when the run completes" : "";
  return `${head} · ${field.size} bytes${field.truncated ? " · truncated" : ""}${tail}`;
}

/** Body for a resolved payload: the text plus, for refs, what is missing. */
function FieldText({ field, className = "", live = false }: { field: ResolvedField; className?: string; live?: boolean }) {
  return (
    <>
      <pre className={`max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary ${className}`}>
        {field.text || "(payload not captured)"}
      </pre>
      {field.isRef && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{refNote(field, live)}</p>
      )}
    </>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function messageText(message: Record<string, unknown>): string {
  // compactionSummary / branchSummary messages carry their text in `summary`,
  // not `content` — without this they render as "(empty)".
  if (typeof message.summary === "string") return message.summary;
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  const textBlocks = message.content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (textBlocks) return textBlocks;
  return message.content
    .map((block) => isRecord(block) && typeof block.thinking === "string" ? block.thinking : "")
    .filter(Boolean)
    .join("\n");
}

function messageTime(message: Record<string, unknown>): string {
  const value = message.createdAt ?? message.timestamp;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  return typeof value === "string" ? value : "";
}

function displayMessageText(message: Record<string, unknown>): string {
  const text = messageText(message);
  if (asString(message.role) !== "user") return text;
  const match = /## (?:Query|User Reply)\s*\n([\s\S]*)$/.exec(text);
  return match?.[1]?.trim() || text;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!["{", "["].includes(trimmed[0] ?? "")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function jsonTypeLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return `${count} key${count === 1 ? "" : "s"}`;
  }
  if (value === null) return "null";
  return typeof value;
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-xyne-fg-muted">null</span>;
  if (value === undefined) return <span className="text-xyne-fg-muted">undefined</span>;
  if (typeof value === "string") {
    // Multi-line or long strings (markdown, code, search results) render as raw
    // text with real newlines on their own line — `JSON.stringify` would escape
    // them to a single unreadable `\n`-laden quoted line.
    if (value.includes("\n") || value.length > 120) {
      return <span className="mt-0.5 block break-words whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">{value}</span>;
    }
    return <span className="break-words whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
  return <span className="break-words text-xyne-fg-secondary">{String(value)}</span>;
}

function JsonNode({
  label,
  value,
  depth,
  defaultExpandedDepth,
}: {
  label?: string;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
}) {
  const expandable = Array.isArray(value) || isRecord(value);
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);

  if (!expandable) {
    return (
      <div className="flex min-w-0 gap-1.5 py-px font-mono text-[11px] leading-5">
        {label !== undefined && <span className="shrink-0 text-sky-700 dark:text-sky-300">{JSON.stringify(label)}:</span>}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const openBracket = Array.isArray(value) ? "[" : "{";
  const closeBracket = Array.isArray(value) ? "]" : "}";

  return (
    <div className="font-mono text-[11px] leading-5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full min-w-0 items-center gap-1 py-px text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      >
        <ChevronDown size={11} className={`shrink-0 text-xyne-fg-muted transition-transform ${expanded ? "" : "-rotate-90"}`} />
        {label !== undefined && <span className="shrink-0 text-sky-700 dark:text-sky-300">{JSON.stringify(label)}:</span>}
        <span className="text-xyne-fg-muted">{openBracket}</span>
        {!expanded && <span className="text-xyne-fg-muted">{jsonTypeLabel(value)}</span>}
        {!expanded && <span className="text-xyne-fg-muted">{closeBracket}</span>}
      </button>
      {expanded && (
        <div className="ml-[5px] border-l border-xyne-border pl-3">
          {entries.map(([key, child]) => (
            <JsonNode key={key} label={key} value={child} depth={depth + 1} defaultExpandedDepth={defaultExpandedDepth} />
          ))}
          <div className="text-xyne-fg-muted">{closeBracket}</div>
        </div>
      )}
    </div>
  );
}

function CopyJsonButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // Strings copy verbatim (markdown/text stays usable); structured values
      // copy as pretty JSON.
      await navigator.clipboard.writeText(typeof value === "string" ? value : prettyJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" onClick={copy} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary" title="Copy">
      {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function JsonViewerModal({ value, title, onClose }: { value: unknown; title: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex h-[min(900px,calc(100vh-24px))] w-[min(1200px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-xyne-border px-3">
          <Braces size={14} className="text-sky-600 dark:text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-xyne-fg-primary">{title}</span>
          <span className="text-[10px] text-xyne-fg-muted">{jsonTypeLabel(value)}</span>
          <CopyJsonButton value={value} />
          <button type="button" onClick={onClose} className="rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary" title="Close"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <JsonNode value={value} depth={0} defaultExpandedDepth={999} />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function JsonViewer({
  value,
  title = "JSON",
  defaultExpandedDepth = 999,
  scroll = true,
}: {
  value: unknown;
  title?: string;
  defaultExpandedDepth?: number;
  /** Set false when an ancestor already scrolls: nesting a second scroller
   *  swallows the wheel as soon as the pointer crosses this box. */
  scroll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsedValue = useMemo(() => parseJsonLike(value), [value]);
  return (
    <>
      <div className="overflow-hidden rounded-md border border-xyne-border bg-xyne-surface-sunken shadow-inner">
        <div className="flex h-8 items-center gap-1.5 border-b border-xyne-border px-2">
          <Braces size={12} className="text-sky-600 dark:text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-xyne-fg-secondary">{title}</span>
          <span className="text-[9px] text-xyne-fg-muted">{jsonTypeLabel(parsedValue)}</span>
          <CopyJsonButton value={parsedValue} />
          <button type="button" onClick={() => setExpanded(true)} className="rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary" title="Open expanded JSON viewer"><Maximize2 size={12} /></button>
        </div>
        <div className={`p-2 ${scroll ? "max-h-64 overflow-auto" : ""}`}>
          <JsonNode value={parsedValue} depth={0} defaultExpandedDepth={defaultExpandedDepth} />
        </div>
      </div>
      {expanded && <JsonViewerModal value={parsedValue} title={title} onClose={() => setExpanded(false)} />}
    </>
  );
}

/** Markdown body shared by the result view and any other rendered-text surface. */
function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-table:my-2 prose-hr:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:border prose-td:border prose-th:border-xyne-border prose-td:border-xyne-border">
      <Markdown remarkPlugins={[remarkGfm]}>{text || "_(empty)_"}</Markdown>
    </div>
  );
}

type ResultView = "tree" | "raw" | "markdown";

/**
 * Renders a tool-call result readably with a view switch. Results arrive as a
 * string: compact JSON, an MCP content-block array, or plain text. We deep-parse
 * it — structured payloads default to an expandable tree (nested JSON-in-string
 * unwrapped); string payloads default to raw text with a Markdown toggle so
 * agent answers, summaries, and docs can be read rendered in the same panel.
 */
function ToolResultView({ value }: { value: unknown }) {
  const parsed = useMemo(() => deepParseJson(value), [value]);
  const isString = typeof parsed === "string";
  const rawText = useMemo(() => (typeof parsed === "string" ? parsed : prettyJson(parsed)), [parsed]);

  // Markdown only makes sense for text results; structured JSON gets Tree/Raw.
  const views: Array<{ id: ResultView; label: string }> = isString
    ? [{ id: "raw", label: "Text" }, { id: "markdown", label: "Markdown" }]
    : [{ id: "tree", label: "Tree" }, { id: "raw", label: "Raw" }];
  const [view, setView] = useState<ResultView>(isString ? "raw" : "tree");
  const [expanded, setExpanded] = useState(false);
  const activeView = views.some((v) => v.id === view) ? view : views[0]!.id;

  return (
    <>
      <div className="overflow-hidden rounded-md border border-xyne-border bg-xyne-surface-sunken shadow-inner">
        <div className="flex h-8 items-center gap-1.5 border-b border-xyne-border px-2">
          <Braces size={12} className="text-sky-600 dark:text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-xyne-fg-secondary">Result</span>
          <div className="flex items-center gap-0.5 rounded border border-xyne-border bg-xyne-surface p-0.5">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${activeView === v.id ? "bg-xyne-brand text-xyne-fg-inverse" : "text-xyne-fg-muted hover:text-xyne-fg-primary"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <CopyJsonButton value={isString ? rawText : parsed} />
          {activeView !== "markdown" && (
            <button type="button" onClick={() => setExpanded(true)} className="rounded p-1 text-xyne-fg-muted hover:bg-black/5 dark:hover:bg-white/10 hover:text-xyne-fg-primary" title="Open expanded viewer"><Maximize2 size={12} /></button>
          )}
        </div>
        <div className="max-h-72 overflow-auto p-2">
          {activeView === "tree" && <JsonNode value={parsed} depth={0} defaultExpandedDepth={999} />}
          {activeView === "raw" && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">{rawText || "(empty)"}</pre>
          )}
          {activeView === "markdown" && <MarkdownBody text={rawText} />}
        </div>
      </div>
      {expanded && <JsonViewerModal value={parsed} title="Result" onClose={() => setExpanded(false)} />}
    </>
  );
}

function truncate(text: string, limit = 320): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

type StreamRateSample = {
  offsetMs: number;
  streamsPerSec: number;
  streamsCollected: number;
};

function streamRateSamples(value: unknown): StreamRateSample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((sample) => {
    if (!isRecord(sample)) return [];
    const offsetMs = typeof sample.offsetMs === "number" ? sample.offsetMs : null;
    const streamsPerSec = typeof sample.streamsPerSec === "number" ? sample.streamsPerSec : null;
    const streamsCollected = typeof sample.streamsCollected === "number" ? sample.streamsCollected : null;
    return offsetMs != null && streamsPerSec != null && streamsCollected != null
      ? [{ offsetMs, streamsPerSec, streamsCollected }]
      : [];
  });
}

function streamRateTone(rate: number): { dot: string; text: string; bar: string; label: string } {
  if (rate >= 20) return { dot: "bg-emerald-400", text: "text-emerald-600 dark:text-emerald-300", bar: "bg-emerald-400", label: "Fast" };
  if (rate >= 8) return { dot: "bg-amber-400", text: "text-amber-600 dark:text-amber-300", bar: "bg-amber-400", label: "Moderate" };
  return { dot: "bg-red-400", text: "text-red-600 dark:text-red-300", bar: "bg-red-400", label: "Slow" };
}

function downsampleStreamRates(samples: StreamRateSample[], maxPoints = 48): StreamRateSample[] {
  if (samples.length <= maxPoints) return samples;
  const bucketSize = samples.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, bucketIndex) => {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));
    const bucket = samples.slice(start, end);
    const last = bucket[bucket.length - 1]!;
    return {
      offsetMs: last.offsetMs,
      streamsPerSec: bucket.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / bucket.length,
      streamsCollected: last.streamsCollected,
    };
  });
}

function combineStreamRateWindows(windows: StreamRateSample[][]): StreamRateSample[] {
  const combined: StreamRateSample[] = [];
  let elapsedOffset = 0;
  let collectedOffset = 0;
  for (const window of windows) {
    if (window.length === 0) continue;
    for (const sample of window) {
      combined.push({
        offsetMs: elapsedOffset + sample.offsetMs,
        streamsPerSec: sample.streamsPerSec,
        streamsCollected: collectedOffset + sample.streamsCollected,
      });
    }
    const last = window[window.length - 1]!;
    elapsedOffset += last.offsetMs + 1_000;
    collectedOffset += last.streamsCollected;
  }
  return combined;
}

function StreamRateGraph({ samples }: { samples: StreamRateSample[] }) {
  if (samples.length === 0) return null;
  const displaySamples = downsampleStreamRates(samples);
  const peak = Math.max(...samples.map((sample) => sample.streamsPerSec), 1);
  const average = samples.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / samples.length;
  const total = samples.at(-1)?.streamsCollected ?? 0;
  return (
    <div className="overflow-hidden rounded-md border border-xyne-border-subtle bg-xyne-surface/70">
      <div className="flex items-center gap-3 border-b border-xyne-border-subtle px-2 py-1 text-[9px] text-xyne-fg-muted">
        <span className="font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Stream rate</span>
        <span><strong className="text-xyne-fg-secondary">Avg</strong> {average.toFixed(1)}/s</span>
        <span><strong className="text-xyne-fg-secondary">Peak</strong> {peak.toFixed(1)}/s</span>
        <span className="ml-auto"><strong className="text-xyne-fg-secondary">Collected</strong> {total}</span>
      </div>
      <div
        className="grid h-16 items-end gap-px px-2 pt-2"
        style={{ gridTemplateColumns: `repeat(${displaySamples.length}, minmax(0, 1fr))` }}
      >
        {displaySamples.map((sample, index) => {
          const tone = streamRateTone(sample.streamsPerSec);
          return (
            <div
              key={`${sample.offsetMs}-${index}`}
              className={`w-full rounded-t-sm ${tone.bar} opacity-80 hover:opacity-100`}
              style={{ height: `${Math.max(4, (sample.streamsPerSec / peak) * 100)}%` }}
              title={`${(sample.offsetMs / 1000).toFixed(1)}s · ${sample.streamsPerSec.toFixed(1)} streams/s · ${sample.streamsCollected} collected`}
            />
          );
        })}
      </div>
      <div className="flex justify-between px-2 pb-1 text-[8px] text-xyne-fg-muted">
        <span>0s</span>
        <span>{((samples.at(-1)?.offsetMs ?? 0) / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

function StreamRateStatus({ rate, collected, live }: { rate: number; collected: number; live: boolean }) {
  const tone = streamRateTone(rate);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle bg-xyne-surface-subtle/60 px-3 py-1.5 text-[10px]">
      <span className={`h-2 w-2 rounded-full ${tone.dot} ${live ? "animate-pulse" : ""}`} />
      <span className="font-semibold text-xyne-fg-secondary">Streaming</span>
      <span className={`font-mono text-[12px] font-semibold ${tone.text}`}>{rate.toFixed(1)} streams/s</span>
      <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${tone.text}`}>{tone.label}</span>
      <span className="ml-auto text-xyne-fg-muted">{collected} streams collected{live ? " · live" : " · persisted"}</span>
    </div>
  );
}

function messageLabel(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return role || "Message";
}

type TimelineEvent = Record<string, unknown> & { startedAt?: string };

/**
 * Kinds that never earn a timeline row: stream bookkeeping and transcript
 * deltas (`message_append`). `llm_request`/`llm_response` are not listed —
 * compactTimeline folds them onto their turn's `session_prompt` row instead.
 */
const HIDDEN_TIMELINE_KINDS = new Set(["message_update", "stream_rate", "message_append"]);

/** Request fields the materializer lifts onto the turn's `session_prompt`;
 *  mirrored here (with their blob-ref spellings) for the live fold below. */
const FOLD_REQUEST_FIELDS = [
  "systemPrompt",
  "tools",
  "toolNames",
  "availableSkills",
  "temperature",
  "maxTokens",
  "thinkingLevel",
  "fastMode",
  "model",
  "provider",
  "paletteAdded",
  "paletteRemoved",
] as const;

/** `llm_response` fields the materializer renames onto the prompt row — what
 *  RequestParamsStrip reads for stop reason, cache hit/miss and TTFT. */
const FOLD_RESPONSE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["usage", "responseUsage"],
  ["stopReason", "responseStopReason"],
  ["ttftMs", "ttftMs"],
];

/**
 * Merge one `llm_request` / `llm_response` onto its turn's prompt row, the way
 * materialization does for a completed run. Ref spellings ride along: live
 * events carry `systemPromptRef` where a materialized one carries the inlined
 * `systemPrompt`, and the row renderer reads either.
 */
function foldLlmEvent(row: TimelineEvent, event: TimelineEvent): TimelineEvent {
  const eventData = isRecord(event.data) ? event.data : {};
  const merged: Record<string, unknown> = { ...(isRecord(row.data) ? row.data : {}) };
  if (asString(event.kind) === "llm_request") {
    for (const field of FOLD_REQUEST_FIELDS) {
      const refKey = `${field}Ref`;
      // The request's value REPLACES the prompt row's in EITHER spelling:
      // session_prompt carries only the persona prompt, which must not shadow
      // the true effective one just because it arrived inline and this didn't.
      if (eventData[field] !== undefined) {
        merged[field] = eventData[field];
        delete merged[refKey];
      } else if (eventData[refKey] !== undefined) {
        merged[refKey] = eventData[refKey];
        delete merged[field];
      }
    }
  } else {
    for (const [from, to] of FOLD_RESPONSE_FIELDS) {
      if (eventData[from] !== undefined) merged[to] = eventData[from];
    }
  }
  return { ...row, data: merged };
}

/**
 * Fields the materializer emits once per run and back-references thereafter
 * (`<field>UnchangedFromSeq`), because a 48-tool catalog and a 28 KB system
 * prompt are identical on every call and re-sending them per turn doubled the
 * bundle. Rehydrate here so every downstream renderer still sees a plain value.
 */
const DEDUPED_FOLD_FIELDS = ["systemPrompt", "tools", "toolNames", "availableSkills"] as const;

function rehydrateRepeatedPayloads(events: unknown[]): unknown[] {
  const bySeq = new Map<number, Record<string, unknown>>();
  for (const value of events) {
    if (!isRecord(value) || typeof value.seq !== "number") continue;
    if (isRecord(value.data)) bySeq.set(value.seq, value.data);
  }
  let touched = false;
  const out = events.map((value) => {
    if (!isRecord(value) || !isRecord(value.data)) return value;
    let data: Record<string, unknown> | null = null;
    for (const field of DEDUPED_FOLD_FIELDS) {
      const from = value.data[`${field}UnchangedFromSeq`];
      if (typeof from !== "number") continue;
      const source = bySeq.get(from)?.[field];
      if (source === undefined) continue;
      data ??= { ...value.data };
      data[field] = source;
    }
    if (!data) return value;
    touched = true;
    return { ...value, data };
  });
  return touched ? out : events;
}

function compactTimeline(rawEvents: unknown[]): TimelineEvent[] {
  const events = rehydrateRepeatedPayloads(rawEvents);
  const compacted: TimelineEvent[] = [];
  const pendingTools = new Map<string, number>();
  // Prompt row per LLM call, so this turn's `llm_request` / `llm_response` fold
  // onto it. Materialization does the same fold for a completed run; doing it
  // here too keeps the LIVE timeline from showing a duplicate LLM row every
  // turn, and gives the live prompt row the request's params.
  const promptRows = new Map<number, number>();
  // A call's prompt row and its request/response are produced by different
  // hooks, so the request can arrive first. Knowing up front which calls DO get
  // a prompt row lets us hold the fold instead of emitting a duplicate LLM row.
  const promptCalls = new Set<number>();
  for (const value of events) {
    if (isRecord(value) && asString(value.kind) === "session_prompt" && typeof value.llmCall === "number") {
      promptCalls.add(value.llmCall);
    }
  }
  const deferredFolds = new Map<number, TimelineEvent[]>();
  // Tool rows stay addressable after their end event lands, so a late
  // `tool_invocation_update` (background task finishing) folds into the same
  // row instead of appearing as an orphan event.
  const toolRows = new Map<string, number>();

  for (const value of events) {
    if (!isRecord(value) || HIDDEN_TIMELINE_KINDS.has(asString(value.kind))) continue;
    const event = value as TimelineEvent;
    const kind = asString(event.kind);
    const llmCall = typeof event.llmCall === "number" ? event.llmCall : undefined;
    if (kind === "session_prompt") {
      const rowIndex = compacted.length;
      compacted.push(event);
      if (llmCall === undefined) continue;
      if (promptRows.has(llmCall)) continue;
      promptRows.set(llmCall, rowIndex);
      for (const held of deferredFolds.get(llmCall) ?? []) {
        compacted[rowIndex] = foldLlmEvent(compacted[rowIndex]!, held);
      }
      deferredFolds.delete(llmCall);
      continue;
    }
    if (kind === "llm_request" || kind === "llm_response") {
      const rowIndex = llmCall !== undefined ? promptRows.get(llmCall) : undefined;
      if (rowIndex !== undefined) {
        compacted[rowIndex] = foldLlmEvent(compacted[rowIndex]!, event);
        continue;
      }
      if (llmCall !== undefined && promptCalls.has(llmCall)) {
        deferredFolds.set(llmCall, [...(deferredFolds.get(llmCall) ?? []), event]);
        continue;
      }
      // No prompt row for this call (a compaction or follow-up call has none),
      // so the request stands on its own — same fallback as materialization.
      if (kind === "llm_request") compacted.push(event);
      continue;
    }
    const toolCallId = asString(event.toolCallId);
    if (kind === "tool_invocation_update") {
      const updateId = toolCallId || (isRecord(event.data) ? asString(event.data.toolCallId) : "");
      const rowIndex = toolRows.get(updateId);
      if (rowIndex === undefined) continue;
      const row = compacted[rowIndex]!;
      compacted[rowIndex] = {
        ...row,
        data: {
          ...(isRecord(row.data) ? row.data : {}),
          ...(isRecord(event.data) ? event.data : {}),
        },
      };
      continue;
    }
    if (kind === "tool_execution_start" && toolCallId) {
      pendingTools.set(toolCallId, compacted.length);
      toolRows.set(toolCallId, compacted.length);
      compacted.push(event);
      continue;
    }
    if (kind === "tool_execution_end" && toolCallId && pendingTools.has(toolCallId)) {
      const index = pendingTools.get(toolCallId)!;
      const start = compacted[index]!;
      compacted[index] = {
        ...event,
        startedAt: asString(start.at),
        data: {
          ...(isRecord(start.data) ? start.data : {}),
          ...(isRecord(event.data) ? event.data : {}),
        },
      };
      pendingTools.delete(toolCallId);
      continue;
    }
    compacted.push(event);
  }

  return compacted;
}

function eventTitle(kind: string, data: Record<string, unknown>): string {
  if (kind === "tool_execution_start" || kind === "tool_execution_end") {
    const name = asString(data.toolName);
    return name ? `Tool · ${name}` : "Tool call";
  }
  if (kind === "session_prompt" || kind === "llm_request") return "LLM request";
  if (kind === "tool_palette_change") return "Tool palette changed";
  if (kind === "skill_loaded") return "Skill loaded";
  if (kind === "subagent_start") return "Subagent started";
  if (kind === "subagent_end") return "Subagent finished";
  if (kind === "provider_fallback") return "Provider fallback";
  if (kind === "delegation") return "Agent delegation";
  if (kind === "thinking") return "Thinking";
  if (kind === "assistant_turn_end") return "Assistant response";
  if (kind === "session_start") return "Session started";
  if (kind === "session_end") return "Session completed";
  if (kind === "session_error") return "Error";
  if (kind === "auto_retry_start") return "Retry attempt";
  if (kind === "compaction_start") return "Context compaction started";
  if (kind === "compaction_end") return "Context compaction completed";
  if (kind === "citation_reflection") return "Citation check";
  return kind.replaceAll("_", " ");
}

function eventIcon(kind: string): { Icon: typeof Bug; color: string } {
  if (kind === "session_prompt") return { Icon: BrainCircuit, color: "text-indigo-500 dark:text-indigo-400" };
  if (kind === "thinking") return { Icon: Lightbulb, color: "text-purple-500 dark:text-purple-400" };
  if (kind === "tool_execution_start" || kind === "tool_execution_end") return { Icon: Wrench, color: "text-amber-500 dark:text-amber-400" };
  if (kind === "assistant_turn_end") return { Icon: Bot, color: "text-emerald-500 dark:text-emerald-400" };
  if (kind === "session_start") return { Icon: CirclePlay, color: "text-sky-500 dark:text-sky-400" };
  if (kind === "session_end") return { Icon: CheckCircle2, color: "text-cyan-500 dark:text-cyan-400" };
  if (kind === "session_error") return { Icon: AlertCircle, color: "text-red-500 dark:text-red-400" };
  if (kind === "auto_retry_start") return { Icon: RotateCcw, color: "text-orange-500 dark:text-orange-400" };
  if (kind === "compaction_start" || kind === "compaction_end") return { Icon: Zap, color: "text-violet-500 dark:text-violet-400" };
  if (kind === "citation_reflection") return { Icon: Quote, color: "text-teal-500 dark:text-teal-400" };
  return { Icon: CirclePlay, color: "text-xyne-fg-tertiary" };
}

/**
 * Structured-Trace row config per event kind: the short uppercase chip label,
 * the lucide icon, the 2px left-rail border color, and the chip text/bg.
 * `quiet` marks low-signal rows (LLM request) that recede via weight + opacity
 * rather than a hue. Colors are light/dark-safe Tailwind palette tokens — the
 * xyne fg-tertiary/fg-muted tokens are the SAME hex, so "quiet" can never come
 * from a second grey.
 */
type EventVisual = { Icon: typeof Bug; label: string; rail: string; chip: string; quiet?: boolean };

function eventVisual(kind: string, isError: boolean): EventVisual {
  if (isError) return { Icon: AlertCircle, label: kind === "session_cancelled" ? "CANCEL" : "ERROR", rail: "border-red-500", chip: "bg-red-500/10 text-red-700 dark:text-red-300" };
  if (kind.startsWith("tool_execution")) return { Icon: Wrench, label: "TOOL", rail: "border-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  switch (kind) {
    case "session_start": return { Icon: CirclePlay, label: "SESSION", rail: "border-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300" };
    case "session_prompt":
    case "llm_request": return { Icon: BrainCircuit, label: "LLM", rail: "border-xyne-border-strong", chip: "text-xyne-fg-muted", quiet: true };
    case "tool_palette_change": return { Icon: Wrench, label: "PALETTE", rail: "border-amber-400", chip: "bg-amber-400/10 text-amber-700 dark:text-amber-300" };
    case "skill_loaded": return { Icon: Sparkles, label: "SKILL", rail: "border-indigo-500", chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" };
    case "subagent_start":
    case "subagent_end": return { Icon: Workflow, label: "SUB", rail: "border-cyan-500", chip: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
    case "delegation": return { Icon: Workflow, label: "A2A", rail: "border-blue-500", chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300" };
    case "provider_fallback": return { Icon: RotateCcw, label: "FALLBACK", rail: "border-orange-500", chip: "bg-orange-500/10 text-orange-700 dark:text-orange-300" };
    case "thinking": return { Icon: Lightbulb, label: "THINK", rail: "border-violet-500", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300" };
    case "assistant_turn_end": return { Icon: MessageSquareText, label: "ASST", rail: "border-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
    case "compaction_start":
    case "compaction_end": return { Icon: Zap, label: "COMPACT", rail: "border-fuchsia-500", chip: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" };
    case "auto_retry_start": return { Icon: RotateCcw, label: "RETRY", rail: "border-orange-500", chip: "bg-orange-500/10 text-orange-700 dark:text-orange-300" };
    case "citation_reflection": return { Icon: Quote, label: "CITE", rail: "border-teal-500", chip: "bg-teal-500/10 text-teal-700 dark:text-teal-300" };
    case "session_end": return { Icon: CheckCircle2, label: "DONE", rail: "border-cyan-500", chip: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
    default: return { Icon: CirclePlay, label: kind.replaceAll("_", " ").slice(0, 7).toUpperCase(), rail: "border-xyne-border-strong", chip: "text-xyne-fg-muted", quiet: true };
  }
}

/** Δ-from-origin label for the trace time column, e.g. "+0.0s", "+5.1s", "+1m04s". */
function formatDelta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = ms / 1000;
  if (s < 60) return `+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

function DebugTimelineSection({
  title,
  data,
  defaultOpen = false,
  subagentTracesByParentToolCallId,
  selectedEventKey,
  onSelectEvent,
  timeMode = "delta",
  live = false,
}: {
  title: string;
  data: Record<string, unknown> | null;
  defaultOpen?: boolean;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]>;
  selectedEventKey?: string | null;
  onSelectEvent?: (key: string) => void;
  timeMode?: "delta" | "abs";
  /** These events are streaming in, not read back off a completed trace. */
  live?: boolean;
}) {
  const events = useMemo(() => {
    const raw = data?.events;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const visibleEvents = useMemo(() => compactTimeline(events), [events]);

  // The full transcript, carried ONCE on the snapshot. Each turn's panel is a
  // prefix of it (`data.messagesTo`), so rows slice rather than each shipping
  // its own copy — that copy was O(turns^2) on the wire.
  const transcript = useMemo(() => (Array.isArray(data?.messages) ? data.messages : undefined), [data]);

  // Expand/collapse all timeline cards. The cards are native <details> elements
  // (no React state to lift), so we flip their `open` attribute through a ref.
  // Scoped to the timeline's direct-child cards — opens each tool/event card
  // without also unfurling every nested raw-data block inside them.
  const timelineRef = useRef<HTMLDivElement>(null);
  const setAllCards = (open: boolean) => {
    timelineRef.current?.querySelectorAll(":scope > details").forEach((node) => {
      (node as HTMLDetailsElement).open = open;
    });
  };

  // Per-row timestamps. Δ is the GAP FROM THE PREVIOUS ROW — that is what
  // answers "what was slow?", which is the whole reason to look at a timeline.
  // Time-from-run-start is still useful for orientation, so it moves to the
  // hover title rather than being the headline number.
  const eventTimesMs = useMemo(
    () =>
      visibleEvents.map((e) => {
        if (!isRecord(e)) return undefined;
        const t = Date.parse(asString(e.at) || asString(e.startedAt));
        return Number.isFinite(t) ? t : undefined;
      }),
    [visibleEvents],
  );
  const originMs = useMemo(() => {
    const known = eventTimesMs.filter((t): t is number => t !== undefined);
    return known.length > 0 ? Math.min(...known) : undefined;
  }, [eventTimesMs]);

  // Sub-steps (thinking / assistant / tool) indent under the spine; the LAST
  // assistant turn is the conclusion and stays flush.
  const lastAssistantIdx = useMemo(() => {
    let idx = -1;
    visibleEvents.forEach((e, i) => { if (isRecord(e) && asString(e.kind) === "assistant_turn_end") idx = i; });
    return idx;
  }, [visibleEvents]);

  const streamGraph = useMemo(() => combineStreamRateWindows(events.flatMap((event) => {
    if (!isRecord(event) || asString(event.kind) !== "assistant_turn_end" || !isRecord(event.data)) return [];
    const samples = streamRateSamples(event.data.streamRateSamples);
    return samples.length > 0 ? [samples] : [];
  })), [events]);

  const toolsUsed = useMemo(() => {
    const raw = data?.toolsUsed;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const tokenUsage = isRecord(data?.tokenUsage) ? data?.tokenUsage as Record<string, unknown> : null;
  const latency = isRecord(data?.latency) ? data?.latency as Record<string, unknown> : null;
  const streamChars = typeof data?.streamChars === "number" ? data.streamChars as number : undefined;
  const streamThinkingChars = typeof data?.streamThinkingChars === "number" ? data.streamThinkingChars as number : undefined;
  const streamTextChars = typeof data?.streamTextChars === "number" ? data.streamTextChars as number : undefined;
  const streamCharsPerSec = typeof data?.streamCharsPerSec === "number" ? data.streamCharsPerSec as number : undefined;
  const thinkingConfig = isRecord(data?.thinking) ? data.thinking as Record<string, unknown> : null;
  const thinkingLevel = thinkingConfig ? asString(thinkingConfig.effectiveLevel) : "";

  const runWarnings = stringList(data?.warnings);
  const headerMeta = [asString(data?.provider), asString(data?.model), thinkingLevel ? `thinking ${thinkingLevel}` : "", toolsUsed.length ? `${toolsUsed.length} tools` : "", `${visibleEvents.length} events`, runWarnings.length ? "partial trace" : ""].filter(Boolean).join(" · ");
  const TurnIcon = data?.subagentName ? Workflow : MessageSquareText;
  const turnIconColor = data?.subagentName ? "text-cyan-600 dark:text-cyan-400" : "text-xyne-fg-tertiary";
  return (
    <details open={defaultOpen} className="group/turn border-b border-xyne-border last:border-b-0">
      <summary className="cursor-pointer list-none py-2">
        <div className="flex items-baseline gap-2">
          <ChevronDown size={13} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/turn:rotate-0" />
          <TurnIcon size={13} className={`shrink-0 self-center ${turnIconColor}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-xyne-fg-primary">{title}</p>
            {headerMeta && <p className="truncate text-[11px] text-xyne-fg-muted">{headerMeta}</p>}
          </div>
        </div>
      </summary>

      <div className="ml-1.5 border-l border-xyne-border-subtle pl-4 pb-3 pt-1 space-y-2">
        {runWarnings.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            {runWarnings.map((warning, index) => (
              <p key={`${index}-${warning}`} className="break-words">{warning}</p>
            ))}
          </div>
        )}

        {Boolean(data?.task || data?.question || data?.providerError) && (
          <p className={`text-[12px] leading-relaxed ${data?.providerError ? "text-red-600 dark:text-red-400" : "text-xyne-fg-secondary"}`}>
            {asString(data?.providerError) || asString(data?.question) || asString(data?.task)}
          </p>
        )}

        {thinkingConfig && (
          <details className="group/sm" open>
            <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1">
              <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sm:rotate-0" />
              <BrainCircuit size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
              <span className="text-[12px] font-semibold text-xyne-fg-secondary">Thinking configuration</span>
            </summary>
            <div className="ml-1.5 border-l border-xyne-border-subtle pl-4 pt-1.5 pb-1 text-[12px] text-xyne-fg-secondary">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="text-xyne-fg-muted">Requested:</span> {asString(thinkingConfig.requestedLevel)}</span>
                <span><span className="text-xyne-fg-muted">Effective:</span> {asString(thinkingConfig.effectiveLevel)}</span>
                <span><span className="text-xyne-fg-muted">Source:</span> {asString(thinkingConfig.source).replaceAll("_", " ")}</span>
                <span><span className="text-xyne-fg-muted">Reasoning model:</span> {thinkingConfig.modelSupportsReasoning ? "yes" : "no"}</span>
              </div>
              {asString(thinkingConfig.wireMode) && <p className="mt-1 font-mono text-[11px] text-xyne-fg-muted">{asString(thinkingConfig.wireMode)}</p>}
            </div>
          </details>
        )}

        {(tokenUsage || latency || streamGraph.length > 0) && (
          <details className="group/sm">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1">
              <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sm:rotate-0" />
              <Activity size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
              <span className="text-[12px] font-semibold text-xyne-fg-secondary">Stream metrics</span>
            </summary>
            <div className="ml-1.5 border-l border-xyne-border-subtle pl-4 pt-1.5 pb-1 space-y-2">
              {(tokenUsage || latency) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-xyne-fg-secondary">
                  {tokenUsage && <span><span className="text-xyne-fg-muted">Tokens:</span> {asString(tokenUsage.input)} in / {asString(tokenUsage.output)} out</span>}
                  {latency && <span><span className="text-xyne-fg-muted">Total:</span> {asString(latency.totalMs)}ms</span>}
                  {latency && <span><span className="text-xyne-fg-muted">LLM:</span> {asString(latency.llmTotalMs)}ms</span>}
                  {streamCharsPerSec !== undefined && <span><span className="text-xyne-fg-muted">Stream:</span> {streamCharsPerSec.toFixed(1)} chars/s</span>}
                  {streamChars !== undefined && <span><span className="text-xyne-fg-muted">Chars:</span> {streamChars}</span>}
                  {streamTextChars !== undefined && <span><span className="text-xyne-fg-muted">Text:</span> {streamTextChars}</span>}
                  {streamThinkingChars !== undefined && <span><span className="text-xyne-fg-muted">Thinking:</span> {streamThinkingChars}</span>}
                </div>
              )}
              {streamGraph.length > 0 && <StreamRateGraph samples={streamGraph} />}
            </div>
          </details>
        )}

        {visibleEvents.length > 0 && (
          <details open className="group/tl">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1">
              <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/tl:rotate-0" />
              <ListTree size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
              <span className="text-[12px] font-semibold text-xyne-fg-secondary">Timeline</span>
              <div className="ml-auto flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    // Inside <summary> — stop the click from toggling the Timeline itself.
                    e.preventDefault();
                    e.stopPropagation();
                    setAllCards(true);
                  }}
                  className="text-[11px] text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary"
                >
                  Expand all
                </button>
                <span className="text-[11px] text-xyne-fg-muted">·</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAllCards(false);
                  }}
                  className="text-[11px] text-xyne-fg-muted transition-colors hover:text-xyne-fg-secondary"
                >
                  Collapse all
                </button>
                <span className="text-[11px] text-xyne-fg-muted">{visibleEvents.length} event{visibleEvents.length === 1 ? "" : "s"}</span>
              </div>
            </summary>
            <div ref={timelineRef} className="pt-1">
              {visibleEvents.map((event, idx) => {
                const ekind = isRecord(event) ? asString(event.kind) : "";
                const indented = (ekind === "thinking" || ekind === "assistant_turn_end" || ekind.startsWith("tool_execution")) && idx !== lastAssistantIdx;
                return (
                  <DebugEventItem
                    key={`${String(event.seq ?? idx)}`}
                    event={event}
                    eventKey={`${String(event.seq ?? idx)}`}
                    displayIndex={idx + 1}
                    selected={selectedEventKey === `${String(event.seq ?? idx)}`}
                    onSelect={onSelectEvent}
                    subagentTracesByParentToolCallId={subagentTracesByParentToolCallId}
                    transcript={transcript}
                    originMs={originMs}
                    prevMs={idx > 0 ? eventTimesMs[idx - 1] : undefined}
                    timeMode={timeMode}
                    indented={indented}
                    live={live}
                  />
                );
              })}
            </div>
          </details>
        )}

        <details className="group/raw">
          <summary className="cursor-pointer list-none py-1 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary">Show raw run data</summary>
          <div className="ml-1.5 border-l border-xyne-border-subtle pl-4 pt-1"><JsonViewer value={{ ...data, events: visibleEvents }} title="Run artifact" /></div>
        </details>
      </div>
    </details>
  );
}

function MessageSnapshot({ message }: { message: unknown }) {
  if (!isRecord(message)) return <JsonViewer value={message} title="Message" />;
  const role = asString(message.role);
  const content = displayMessageText(message);
  const status = asString(message.status);
  const createdAt = messageTime(message);
  const isAssistant = role === "assistant";
  const isUser = role === "user";
  const isSystem = role === "system";
  const RoleIcon = isAssistant ? Bot : isSystem ? FileText : User;
  const roleIconColor = isAssistant
    ? "text-emerald-500 dark:text-emerald-400"
    : isUser
      ? "text-sky-500 dark:text-sky-400"
      : "text-xyne-fg-tertiary";
  return (
    <details className="group/msg border-b border-xyne-border-subtle/40 py-2 last:border-b-0">
      <summary className="cursor-pointer list-none">
        <div className="flex items-baseline gap-2">
          <ChevronDown size={10} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/msg:rotate-0" />
          <RoleIcon size={11} className={`shrink-0 self-center ${roleIconColor}`} />
          <span className="text-[12px] font-semibold text-xyne-fg-primary">{messageLabel(role)}</span>
          {createdAt && <span className="text-[11px] text-xyne-fg-muted">{formatTime(createdAt)}</span>}
          {status && <span className="text-[11px] text-xyne-fg-muted">· {status}</span>}
        </div>
        <p className="mt-1 ml-[29px] line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary group-open/msg:hidden">
          {content || "(empty)"}
        </p>
      </summary>
      <div className="ml-1.5 mt-1 border-l border-xyne-border-subtle pl-4 space-y-2">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary">{content || "(empty)"}</pre>
        <details>
          <summary className="cursor-pointer list-none text-[10px] text-xyne-fg-muted hover:text-xyne-fg-secondary">Show raw message data</summary>
          <div className="mt-1"><JsonViewer value={message} title={`${messageLabel(role)} message`} defaultExpandedDepth={999} /></div>
        </details>
      </div>
    </details>
  );
}

/**
 * The system prompt with its `<available_skills>` block tinted. The block is the
 * answer to "which skills could the model even see", and it is unfindable by eye
 * inside a 20 KB prompt. Rendered as real nodes — never innerHTML — so prompt
 * text that contains markup stays inert.
 */
function SystemPromptText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const closed = /<available_skills>[\s\S]*?<\/available_skills>/.exec(text);
    // A truncated prompt loses the closing tag; highlight to the end instead of
    // silently giving up on the one region worth finding.
    const start = closed ? closed.index : text.indexOf("<available_skills>");
    if (start < 0) return null;
    const end = closed ? closed.index + closed[0].length : text.length;
    return { before: text.slice(0, start), block: text.slice(start, end), after: text.slice(end) };
  }, [text]);

  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <span className="rounded-sm bg-amber-400/20 text-xyne-fg-primary ring-1 ring-inset ring-amber-500/30">{parts.block}</span>
      {parts.after}
    </>
  );
}

type SkillEntry = { name: string; description: string; location: string };

function skillEntries(value: unknown): SkillEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = asString(item.name);
    return name ? [{ name, description: asString(item.description), location: asString(item.location) }] : [];
  });
}

function AvailableSkillsPanel({ skills }: { skills: SkillEntry[] }) {
  if (skills.length === 0) return null;
  return (
    <details className="group/sk rounded-md bg-xyne-surface">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
        <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sk:rotate-0" />
        <Sparkles size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
        <span className="text-[12px] font-semibold text-xyne-fg-secondary">Available skills</span>
        <span className="ml-auto text-[11px] text-xyne-fg-muted">{skills.length} skill{skills.length === 1 ? "" : "s"}</span>
      </summary>
      <div className="max-h-72 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
        {skills.map((skill) => (
          <div key={skill.name} className="border-b border-xyne-border-subtle/40 py-1 last:border-b-0">
            <p className="font-mono text-[11.5px] text-xyne-fg-primary">{skill.name}</p>
            {skill.description && <p className="text-[11.5px] leading-relaxed text-xyne-fg-muted">{skill.description}</p>}
            {skill.location && <p className="truncate font-mono text-[10px] text-xyne-fg-tertiary">{skill.location}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

type ToolEntry = { name: string; description: string; parameters: unknown };

/** Full definitions when the trace has them, name-only rows when it only kept
 *  `toolNames` — a shorter list is still the truth about what was offered. */
function toolEntries(data: Record<string, unknown>): ToolEntry[] {
  if (Array.isArray(data.tools)) {
    return data.tools.flatMap((item) => {
      if (!isRecord(item)) return [];
      const name = asString(item.name);
      return name ? [{ name, description: asString(item.description), parameters: item.parameters }] : [];
    });
  }
  return stringList(data.toolNames).map((name) => ({ name, description: "", parameters: undefined }));
}

function ToolDefinitionsPanel({ tools }: { tools: ToolEntry[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="group/tools rounded-md bg-xyne-surface">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
        <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/tools:rotate-0" />
        <Wrench size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
        <span className="text-[12px] font-semibold text-xyne-fg-secondary">Tools offered</span>
        <span className="ml-auto text-[11px] text-xyne-fg-muted">{tools.length} tool{tools.length === 1 ? "" : "s"}</span>
      </summary>
      <div className="max-h-96 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
        {tools.map((tool) => (
          <details key={tool.name} className="group/tool border-b border-xyne-border-subtle/40 last:border-b-0">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1">
              <ChevronDown size={10} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/tool:rotate-0" />
              <span className="shrink-0 font-mono text-[11.5px] text-xyne-fg-primary">{tool.name}</span>
              {tool.description && <span className="min-w-0 truncate text-[11.5px] text-xyne-fg-muted">{tool.description}</span>}
            </summary>
            <div className="ml-1.5 border-l border-xyne-border-subtle pb-1 pl-3 pt-1 space-y-1">
              {tool.description && <p className="text-[11.5px] leading-relaxed text-xyne-fg-secondary">{tool.description}</p>}
              {tool.parameters !== undefined
                ? <JsonViewer value={tool.parameters} title={`${tool.name} parameters`} defaultExpandedDepth={2} scroll={false} />
                : <p className="text-[11px] text-xyne-fg-muted">No parameter schema captured for this tool.</p>}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

/** The mid-run palette diff (load-tools / fast-mode), which otherwise only ever
 *  showed up as a silent change in what the model could call. */
function PaletteChips({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-xyne-surface px-2 py-1.5">
      <span className="mr-1 text-[11px] text-xyne-fg-muted">Tool palette</span>
      {added.map((name) => (
        <span key={`add-${name}`} className="rounded bg-emerald-500/10 px-1 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300">+{name}</span>
      ))}
      {removed.map((name) => (
        <span key={`rm-${name}`} className="rounded bg-red-500/10 px-1 font-mono text-[10.5px] text-red-700 dark:text-red-300">−{name}</span>
      ))}
    </div>
  );
}

function RequestParamsStrip({ data }: { data: Record<string, unknown> }) {
  const items: Array<[string, string]> = [];
  const push = (label: string, value: string) => { if (value) items.push([label, value]); };
  push("Model", asString(data.model));
  push("Provider", asString(data.provider));
  if (typeof data.temperature === "number") push("Temp", String(data.temperature));
  if (typeof data.maxTokens === "number") push("Max tokens", String(data.maxTokens));
  push("Thinking", asString(data.thinkingLevel));
  if (typeof data.fastMode === "boolean") push("Fast mode", data.fastMode ? "on" : "off");
  push("Stop", asString(data.responseStopReason));

  const usage = isRecord(data.responseUsage) ? data.responseUsage : null;
  const cacheRead = typeof usage?.cacheRead === "number" ? usage.cacheRead : null;
  const cacheWrite = typeof usage?.cacheWrite === "number" ? usage.cacheWrite : null;
  if (cacheRead != null || cacheWrite != null) {
    // Read tokens are the cache HIT: zero reads on a repeat turn is the tell for
    // a prompt-cache miss, which is why the raw numbers stay visible.
    push("Cache", `${cacheRead ?? 0} read / ${cacheWrite ?? 0} write · ${(cacheRead ?? 0) > 0 ? "hit" : "miss"}`);
  }
  if (typeof data.ttftMs === "number") push("TTFT", `${data.ttftMs}ms`);

  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary">
      {items.map(([label, value]) => (
        <span key={label}><span className="text-xyne-fg-muted">{label}:</span> {value}</span>
      ))}
    </div>
  );
}

/** Non-fatal read problems for the run(s) on screen. Without this a partial
 *  artifact read is indistinguishable from an agent that simply did nothing. */
function WarningsNotice({ warnings }: { warnings: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (warnings.length === 0) return null;
  const shown = expanded ? warnings : warnings.slice(0, 3);
  return (
    <div className="flex shrink-0 gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">Partial trace · {warnings.length} warning{warnings.length === 1 ? "" : "s"}</p>
        {shown.map((warning, index) => (
          <p key={`${index}-${warning}`} className="break-words leading-relaxed">{warning}</p>
        ))}
        {warnings.length > 3 && (
          <button type="button" onClick={() => setExpanded((current) => !current)} className="underline underline-offset-2 hover:no-underline">
            {expanded ? "Show less" : `Show ${warnings.length - 3} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function collectWarnings(bundle: DebugArtifactBundle | null): string[] {
  if (!bundle) return [];
  const sources: unknown[] = [
    bundle.warnings,
    bundle.debugSession?.warnings,
    ...(bundle.runs ?? []).map((run) => run.data.warnings),
    ...(bundle.subagents ?? []).map((sub) => sub.data.warnings),
  ];
  // Runs share most warnings (same blob log, same GCS miss) — dedupe or the
  // strip turns into a wall of the same line.
  return [...new Set(sources.flatMap((source) => stringList(source)))];
}

function DebugEventItem({
  event,
  eventKey,
  selected = false,
  onSelect,
  subagentTracesByParentToolCallId,
  transcript,
  originMs,
  prevMs,
  timeMode = "delta",
  indented = false,
  live = false,
}: {
  event: unknown;
  eventKey: string;
  displayIndex?: number;
  selected?: boolean;
  onSelect?: (key: string) => void;
  subagentTracesByParentToolCallId?: Map<string, SubagentTraceGroup[]>;
  /** The run's full transcript. A turn's panel is the prefix ending at this
   *  event's `messagesTo`; absent on the live stream, where there is no
   *  snapshot yet. */
  transcript?: unknown[];
  /** Earliest event in the run — used for the "into run" figure on hover. */
  originMs?: number;
  /** Timestamp of the row above this one; Δ is measured against it. */
  prevMs?: number;
  /** "delta" → +Xs from run start (default); "abs" → wall-clock time. */
  timeMode?: "delta" | "abs";
  /** Sub-steps of a turn (thinking / assistant / tool) indent under the spine. */
  indented?: boolean;
  /** This row came off the LIVE stream, where every big payload is still just a
   *  blob-ref preview. Changes what the ref affordances promise. */
  live?: boolean;
}) {
  if (!isRecord(event)) {
    return <JsonViewer value={event} title="Event" />;
  }

  const kind = asString(event.kind) || "event";
  const seq = asString(event.seq);
  const at = asString(event.at);
  const startedAt = asString(event.startedAt);
  const subagentName = asString(event.subagentName);
  const data = isRecord(event.data) ? event.data : {};
  const isTool = kind.startsWith("tool_execution");
  const isPendingTool = kind === "tool_execution_start";
  const isError = kind === "session_error" || (isTool && data.isError === true);
  const duration = asString(data.durationMs);
  const subagentTraces = isTool && subagentTracesByParentToolCallId
    ? subagentTracesByParentToolCallId.get(asString(data.toolCallId) || asString(event.toolCallId)) ?? []
    : [];

  // session_prompt carries the folded llm_request: the TRUE system prompt (with
  // its <available_skills> block), the tool schemas the model was handed, and
  // the request params. Payloads may be inline strings or blob refs.
  const isPromptEvent = kind === "session_prompt" || kind === "llm_request";
  const systemPromptField = resolveFieldText(data, "systemPrompt");
  const userPromptField = resolveFieldText(data, "prompt");
  const availableSkills = isPromptEvent ? skillEntries(data.availableSkills) : [];
  const offeredTools = isPromptEvent ? toolEntries(data) : [];
  const paletteAdded = paletteList(data, "paletteAdded", "added");
  const paletteRemoved = paletteList(data, "paletteRemoved", "removed");
  // Only consulted when the lists came back empty — a palette diff big enough
  // to be interned arrives as `addedRef`/`removedRef` with a preview.
  const paletteAddedField = resolveFieldText(data, "added");
  const paletteRemovedField = resolveFieldText(data, "removed");
  const thinkingField = resolveFieldText(data, "text");
  const assistantField = resolveFieldText(data, "assistantText");
  const errorField = resolveFieldText(data, "error");
  // A ref can sit in the field itself, so "present" is not the same as "inline".
  const hasInlineResult = "result" in data && !asBlobRef(data.result);
  const hasInlineArgs = "args" in data && !asBlobRef(data.args);
  const resultField = hasInlineResult ? null : resolveFieldText(data, "result");
  const argsField = hasInlineArgs ? null : resolveFieldText(data, "args");
  // Older traces embedded the prefix per event; newer ones carry only the
  // cursor. Accept both so a trace written before this change still renders.
  const panelMessages = Array.isArray(data.messages)
    ? data.messages
    : transcript && typeof data.messagesTo === "number"
      ? transcript.slice(0, Math.max(0, Math.min(data.messagesTo, transcript.length)))
      : undefined;
  const messagesField = panelMessages ? null : resolveFieldText(data, "messages");

  const summary = eventSummary(kind, data);
  // LLM request is low-signal: its msg count rides on the title, so suppress the
  // redundant "Sending N messages" preview.
  const showSummary = Boolean(summary) && !isPromptEvent;
  const timestamp = isTool ? (at || startedAt) : at;
  const visual = eventVisual(kind, isError);
  const VisualIcon = visual.Icon;

  // Title: tool name (mono) for tools; LLM request carries its msg count; the
  // final assistant turn is tagged; everything else uses its label.
  const msgCount = typeof data.messageCount === "number" ? data.messageCount : null;
  const isFinalAssistant = kind === "assistant_turn_end" && !indented;
  const titleText = isTool
    ? (asString(data.toolName) || "tool")
    : isPromptEvent
      ? `LLM request${msgCount != null ? ` · ${msgCount} msgs` : ""}`
      : isFinalAssistant
        ? "Assistant response · final"
        : eventTitle(kind, data);
  const titleClass = isError
    ? "font-semibold text-red-600 dark:text-red-400"
    : visual.quiet
      ? "font-normal text-xyne-fg-tertiary opacity-70"
      : isTool
        ? "font-mono font-medium text-xyne-fg-primary"
        : "font-semibold text-xyne-fg-primary";

  // Time column: the gap since the previous row by default, absolute on the abs
  // toggle. A run-start-relative column looks like a stopwatch and hides the one
  // thing a timeline is read for — which step took the time.
  const eventMs = timestamp ? Date.parse(timestamp) : NaN;
  const absTime = timestamp ? formatTime(timestamp) : "";
  const gapMs = prevMs != null && Number.isFinite(eventMs) ? eventMs - prevMs : undefined;
  const timeText = timeMode === "abs" || !Number.isFinite(eventMs)
    ? absTime
    : gapMs === undefined
      ? "+0.0s" // first row: nothing precedes it
      : formatDelta(gapMs);
  // Everything the column no longer shows, on hover.
  const timeTitle = [
    absTime,
    originMs != null && Number.isFinite(eventMs) ? `${formatDelta(eventMs - originMs).replace(/^\+/, "")} into run` : "",
    gapMs !== undefined ? `${formatDelta(gapMs).replace(/^\+/, "")} since previous` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details className={`group/event border-l-2 ${visual.rail} ${indented ? "ml-4" : ""} ${selected ? "bg-xyne-surface-subtle/60" : "hover:bg-black/[0.015] dark:hover:bg-white/[0.025]"}`}>
      <summary
        className="cursor-pointer list-none py-[5px] pl-2 pr-1"
        onPointerDown={() => onSelect?.(eventKey)}
      >
        <div className="flex items-center gap-2">
          <span className={`flex w-[58px] shrink-0 items-center gap-1 rounded px-1 py-px text-[9px] font-bold uppercase tracking-[0.03em] ${visual.chip}`}>
            <VisualIcon size={10} className="shrink-0" />
            <span className="truncate">{visual.label}</span>
          </span>
          <span className={`min-w-0 truncate text-[12.5px] leading-tight ${titleClass}`}>{titleText}</span>
          {subagentName && (
            <span className="shrink-0 rounded bg-cyan-500/10 px-1 text-[9px] text-cyan-700 dark:text-cyan-300">{subagentName}</span>
          )}
          {subagentTraces.length > 0 && (
            <span className="shrink-0 text-[10px] text-cyan-600 dark:text-cyan-400">+{subagentTraces.length} sub</span>
          )}
          <span className="ml-auto flex shrink-0 items-center font-mono text-[10.5px] tabular-nums">
            <span className="w-[50px] text-right text-xyne-fg-secondary" title={timeTitle}>{timeText}</span>
            <span className="w-[50px] text-right text-xyne-fg-muted">{isTool && duration ? `${duration}ms` : ""}</span>
            <span className="w-[58px] text-right">
              {isTool && (data.isError
                ? <span className="rounded bg-red-500/15 px-1 font-semibold text-red-700 dark:text-red-300">Failed</span>
                : isPendingTool
                  ? <span className="text-amber-600 dark:text-amber-400">Running</span>
                  : <span className="text-emerald-600 dark:text-emerald-400">OK</span>)}
            </span>
          </span>
          <ChevronRight size={11} className="ml-0.5 shrink-0 text-xyne-fg-tertiary opacity-0 transition group-hover/event:opacity-60 group-open/event:rotate-90" />
        </div>
        {showSummary && (
          <p className={`mt-0.5 line-clamp-2 whitespace-pre-wrap pl-[66px] pr-6 text-[12px] leading-relaxed group-open/event:hidden ${kind === "thinking" ? "italic text-xyne-fg-secondary" : "text-xyne-fg-secondary"}`}>
            {summary}
          </p>
        )}
      </summary>
      <div className={`pl-[16px] pr-2 pb-3 pt-1 space-y-1.5 ${selected ? "bg-xyne-surface-subtle/60" : ""}`}>
        {isPromptEvent && (
          <div className="space-y-1.5">
            <RequestParamsStrip data={data} />
            {systemPromptField && (
              <details className="group/sp rounded-md bg-xyne-surface">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
                  <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/sp:rotate-0" />
                  <FileText size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
                  <span className="text-[12px] font-semibold text-xyne-fg-secondary">System prompt</span>
                  <span className="ml-auto text-[11px] text-xyne-fg-muted">{fieldSizeLabel(systemPromptField)}</span>
                </summary>
                <div className="px-2 pb-2 pt-1">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-xyne-fg-secondary">
                    {systemPromptField.text ? <SystemPromptText text={systemPromptField.text} /> : "(payload not captured)"}
                  </pre>
                  {systemPromptField.isRef && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{refNote(systemPromptField, live)}</p>
                  )}
                </div>
              </details>
            )}
            <AvailableSkillsPanel skills={availableSkills} />
            <ToolDefinitionsPanel tools={offeredTools} />
            <PaletteChips added={paletteAdded} removed={paletteRemoved} />
            {panelMessages && panelMessages.length > 0 && (
              <details className="group/im rounded-md bg-xyne-surface">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
                  <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/im:rotate-0" />
                  <MessagesSquare size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
                  <span className="text-[12px] font-semibold text-xyne-fg-secondary">Input messages</span>
                  <span className="ml-auto text-[11px] text-xyne-fg-muted">{panelMessages.length} message{panelMessages.length === 1 ? "" : "s"}</span>
                </summary>
                <div className="px-2 pb-2 pt-1">
                  {panelMessages.map((msg, idx) => (
                    <MessageSnapshot key={`${seq}-msg-${idx}`} message={msg} />
                  ))}
                </div>
              </details>
            )}
            {messagesField && (
              <details className="group/imr rounded-md bg-xyne-surface">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
                  <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/imr:rotate-0" />
                  <MessagesSquare size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
                  <span className="text-[12px] font-semibold text-xyne-fg-secondary">Input messages</span>
                  <span className="ml-auto text-[11px] text-xyne-fg-muted">{fieldSizeLabel(messagesField)}</span>
                </summary>
                <div className="px-2 pb-2 pt-1">
                  <FieldText field={messagesField} live={live} />
                </div>
              </details>
            )}
            {userPromptField && (
              <details className="group/up rounded-md bg-xyne-surface">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5">
                  <ChevronDown size={11} className="shrink-0 self-center text-xyne-fg-tertiary transition-transform -rotate-90 group-open/up:rotate-0" />
                  <User size={11} className="shrink-0 self-center text-xyne-fg-tertiary" />
                  <span className="text-[12px] font-semibold text-xyne-fg-secondary">User prompt</span>
                  <span className="ml-auto text-[11px] text-xyne-fg-muted">{fieldSizeLabel(userPromptField)}</span>
                </summary>
                <div className="px-2 pb-2 pt-1">
                  <FieldText field={userPromptField} className="max-h-64" live={live} />
                </div>
              </details>
            )}
            <details className="rounded-md bg-xyne-surface">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary">Show raw event data</summary>
              <div className="px-2 pb-2 pt-1"><JsonViewer value={data} title="LLM event" /></div>
            </details>
          </div>
        )}

        {kind === "tool_execution_start" && (
          <div className="space-y-1.5">
            {hasInlineArgs && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Arguments</p>
                <JsonViewer value={data.args} title="Arguments" defaultExpandedDepth={999} />
              </div>
            )}
            {argsField && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Arguments</p>
                <FieldText field={argsField} live={live} />
              </div>
            )}
            <SubagentTraceInline traces={subagentTraces} live={live} />
          </div>
        )}

        {kind === "tool_execution_end" && (
          <div className="space-y-1.5">
            {argsField && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Arguments</p>
                <FieldText field={argsField} live={live} />
              </div>
            )}
            {hasInlineArgs && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Arguments</p>
                <JsonViewer value={data.args} title="Arguments" defaultExpandedDepth={999} />
              </div>
            )}
            {/* Vespa query — emitted by kb-search and spaces-search. Lives
                  on data.debug.payloads (one entry per Vespa hit: "exact" +
                  optional "fuzzy-fallback"). Renders the YQL string verbatim so
                  it can be copy-pasted into a Vespa shell for replay. */}
            {isRecord(data.debug) && Array.isArray((data.debug as Record<string, unknown>).payloads) && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Vespa query</p>
                {((data.debug as { payloads: Array<Record<string, unknown>> }).payloads).map((p, i) => (
                  <div key={i} className="space-y-1">
                    {typeof p.stage === "string" && (
                      <p className="text-[11px] text-xyne-fg-muted">stage: {p.stage}</p>
                    )}
                    {typeof p.yql === "string" && (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-xyne-surface-sunken p-2 text-[11px] leading-relaxed text-xyne-fg-secondary">{p.yql}</pre>
                    )}
                    {isRecord(p.vespaParams) && (
                      <details className="rounded-md bg-xyne-surface-sunken">
                        <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary">Bound params + ranking inputs</summary>
                        <div className="px-2 pb-2 pt-1"><JsonViewer value={p.vespaParams} title="vespaParams" /></div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
            {hasInlineResult && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Result</p>
                <ToolResultView value={data.result} />
              </div>
            )}
            {resultField && (
              <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                <p className="text-[12px] font-semibold text-xyne-fg-secondary">Result</p>
                <FieldText field={resultField} live={live} />
              </div>
            )}
            <SubagentTraceInline traces={subagentTraces} live={live} />
          </div>
        )}

        {kind === "thinking" && thinkingField && (
          // Match the collapsed preview exactly (italic sans, secondary, aligned
          // under the title) so expanding just reveals the FULL text in place,
          // not a heavier card with a different font.
          <p className="whitespace-pre-wrap pl-[58px] pr-6 text-[12px] italic leading-relaxed text-xyne-fg-secondary">
            {thinkingField.text || "(payload not captured)"}
            {thinkingField.isRef && <span className="not-italic text-amber-700 dark:text-amber-300"> · {refNote(thinkingField, live)}</span>}
          </p>
        )}

        {kind === "assistant_turn_end" && (
          <div className="space-y-1.5">
            {assistantField && (
              // Same casual-expand treatment as thinking (non-italic, matches the
              // assistant preview). Usage stats stay below as a metadata row.
              <p className="whitespace-pre-wrap pl-[58px] pr-6 text-[12px] leading-relaxed text-xyne-fg-secondary">
                {assistantField.text || "(payload not captured)"}
                {assistantField.isRef && <span className="text-amber-700 dark:text-amber-300"> · {refNote(assistantField, live)}</span>}
              </p>
            )}
            {(isRecord(data.usage) || typeof data.streamChars === "number" || typeof data.streamCharsPerSec === "number") && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary">
                {isRecord(data.usage) && (
                  <span><span className="text-xyne-fg-muted">Usage:</span> {asString((data.usage as Record<string, unknown>).input_tokens) || asString((data.usage as Record<string, unknown>).input) || "0"} in / {asString((data.usage as Record<string, unknown>).output_tokens) || asString((data.usage as Record<string, unknown>).output) || "0"} out</span>
                )}
                {typeof data.streamChars === "number" && <span><span className="text-xyne-fg-muted">Chars:</span> {data.streamChars}</span>}
                {typeof data.streamCharsPerSec === "number" && <span><span className="text-xyne-fg-muted">Rate:</span> {asString(data.streamCharsPerSec)} chars/s</span>}
                {typeof data.streamTextChars === "number" && <span><span className="text-xyne-fg-muted">Text:</span> {data.streamTextChars}</span>}
                {typeof data.streamThinkingChars === "number" && <span><span className="text-xyne-fg-muted">Thinking:</span> {data.streamThinkingChars}</span>}
              </div>
            )}
          </div>
        )}

        {kind === "session_error" && errorField && (
          <pre className="whitespace-pre-wrap rounded-md bg-xyne-surface p-2 text-[12px] leading-relaxed text-red-700 dark:text-red-300">
            {errorField.text || "(payload not captured)"}
            {errorField.isRef ? ` · ${refNote(errorField, live)}` : ""}
          </pre>
        )}

        {kind === "tool_palette_change" && (
          paletteAdded.length > 0 || paletteRemoved.length > 0 ? (
            <PaletteChips added={paletteAdded} removed={paletteRemoved} />
          ) : (
            // The `initial` palette event lists EVERY tool, which is big enough
            // to get interned — show the ref's preview instead of an empty row.
            <>
              {paletteAddedField && (
                <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                  <p className="text-[12px] font-semibold text-xyne-fg-secondary">Added</p>
                  <FieldText field={paletteAddedField} live={live} />
                </div>
              )}
              {paletteRemovedField && (
                <div className="space-y-1 rounded-md bg-xyne-surface px-2 py-1.5">
                  <p className="text-[12px] font-semibold text-xyne-fg-secondary">Removed</p>
                  <FieldText field={paletteRemovedField} live={live} />
                </div>
              )}
            </>
          )
        )}

        {kind === "session_end" && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-xyne-surface px-2 py-1.5 text-[11px] text-xyne-fg-secondary">
            {typeof data.textLength === "number" && <span><span className="text-xyne-fg-muted">Length:</span> {data.textLength}</span>}
            {typeof data.durationMs === "number" && <span><span className="text-xyne-fg-muted">Duration:</span> {data.durationMs}ms</span>}
            {typeof data.streamChars === "number" && <span><span className="text-xyne-fg-muted">Chars:</span> {data.streamChars}</span>}
            {typeof data.streamCharsPerSec === "number" && <span><span className="text-xyne-fg-muted">Rate:</span> {asString(data.streamCharsPerSec)} chars/s</span>}
            {isRecord(data.tokenUsage) && <span><span className="text-xyne-fg-muted">Tokens:</span> {asString((data.tokenUsage as Record<string, unknown>).input)} in / {asString((data.tokenUsage as Record<string, unknown>).output)} out</span>}
          </div>
        )}

        {!["session_prompt", "llm_request", "tool_execution_start", "tool_execution_end", "assistant_turn_end", "session_error", "session_end"].includes(kind) && (
          <details className="rounded-md bg-xyne-surface">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-xyne-fg-muted hover:text-xyne-fg-secondary">Show raw event data</summary>
            <div className="px-2 pb-2 pt-1"><JsonViewer value={data} title="Event data" /></div>
          </details>
        )}
      </div>
    </details>
  );
}

function LiveDebugTrace({
  events,
  selectedEventKey,
  onSelectEvent,
}: {
  events: DebugEventRecord[];
  selectedEventKey?: string | null;
  onSelectEvent?: (key: string) => void;
}) {
  const rootEvents = compactTimeline(events.filter((event) => !event.subagentName));
  const subagentGroups = new Map<string, DebugEventRecord[]>();
  for (const event of events) {
    if (!event.subagentName) continue;
    const key = `${event.parentToolCallId ?? "unknown"}`;
    const group = subagentGroups.get(key) ?? [];
    group.push(event);
    subagentGroups.set(key, group);
  }
  const subagentTraceGroups = new Map<string, SubagentTraceGroup[]>();
  for (const [key, group] of subagentGroups.entries()) {
    const first = group[0];
    if (!first) continue;
    const compactedGroup = compactTimeline(group);
    const trace = {
      subagentName: first.subagentName || "Subagent",
      parentToolCallId: first.parentToolCallId ?? key,
      question: asString(first.data?.question) || asString(first.data?.task) || "Subagent task",
      task: asString(first.data?.task) || asString(first.data?.question) || "Subagent task",
      events: compactedGroup,
    };
    const list = subagentTraceGroups.get(trace.parentToolCallId) ?? [];
    list.push({
      subagentName: trace.subagentName,
      parentToolCallId: trace.parentToolCallId,
      trace,
    });
    subagentTraceGroups.set(trace.parentToolCallId, list);
  }

  return (
    <div>
      {rootEvents.length > 0 && (
        <div>
          {rootEvents.map((event, idx) => {
            const prev = idx > 0 ? rootEvents[idx - 1] : undefined;
            const prevAt = prev ? Date.parse(asString(prev.at) || asString(prev.startedAt)) : NaN;
            return (
              <DebugEventItem
                key={`live-root-${event.seq}-${idx}`}
                event={event}
                eventKey={`live-root-${event.seq}-${idx}`}
                selected={selectedEventKey === `live-root-${event.seq}-${idx}`}
                onSelect={onSelectEvent}
                subagentTracesByParentToolCallId={subagentTraceGroups}
                {...(Number.isFinite(prevAt) ? { prevMs: prevAt } : {})}
                live
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function eventSummary(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case "session_start":
      return asString(data.task);
    case "session_prompt":
    case "llm_request": {
      const count = typeof data.messageCount === "number" ? data.messageCount : 0;
      return count ? `Sending ${count} message${count === 1 ? "" : "s"} to the model` : "";
    }
    case "tool_execution_start":
    case "tool_execution_end":
      return "";
    case "thinking":
      return truncate(resolveFieldText(data, "text")?.text ?? "", 240);
    case "assistant_turn_end":
      return truncate(resolveFieldText(data, "assistantText")?.text ?? "", 240);
    case "tool_palette_change": {
      const added = paletteList(data, "paletteAdded", "added").length;
      const removed = paletteList(data, "paletteRemoved", "removed").length;
      const parts = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ");
      return parts ? `Tool palette ${parts}` : "";
    }
    case "skill_loaded":
      return asString(data.name) || asString(data.skill) || asString(data.location);
    case "subagent_start":
    case "subagent_end":
      return asString(data.subagentName) || asString(data.task) || asString(data.question);
    case "delegation":
      return asString(data.targetAgent) || asString(data.task) || asString(data.question);
    case "provider_fallback":
      return asString(data.reason) || [asString(data.from), asString(data.to)].filter(Boolean).join(" → ");
    case "compaction_start":
      return "Conversation history is being condensed";
    case "compaction_end": {
      if (typeof data.errorMessage === "string" && data.errorMessage) return truncate(data.errorMessage, 240);
      // Show the compacted summary (the "response") when present; the full text
      // is in the raw event data. Falls back to the generic line for no-op/aborted.
      return typeof data.summary === "string" && data.summary
        ? truncate(data.summary, 240)
        : "Conversation history condensed";
    }
    case "auto_retry_start":
      return "Retrying after a transient error";
    case "session_error":
      return truncate(resolveFieldText(data, "error")?.text ?? "", 240);
    case "session_end":
      return "";
    case "citation_reflection": {
      if (asString(data.phase) === "nudge") {
        const round = typeof data.round === "number" ? data.round : 0;
        const maxRounds = typeof data.maxRounds === "number" ? data.maxRounds : 0;
        return `Answer used sources but isn't cited — nudging the model to add citations (round ${round}/${maxRounds})`;
      }
      const outcome = asString(data.outcome);
      const labels: Record<string, string> = {
        already_cited: "Answer already cited — no action needed",
        no_citeable_sources: "No citeable sources retrieved — nothing to enforce",
        fixed_after_nudge: "Citations added after reflection",
        still_uncited: "Still uncited after reflection",
        aborted: "Reflection aborted (run cancelled)",
      };
      return labels[outcome] ?? outcome.replaceAll("_", " ");
    }
    default:
      return "";
  }
}

type SubagentTraceGroup = {
  subagentName: string;
  parentToolCallId: string;
  trace: Record<string, unknown>;
};

function groupSubagentTraces(traces: DebugArtifactBundle["subagents"]): SubagentTraceGroup[] {
  return traces
    .map((sub) => ({
      subagentName: asString(sub.data.subagentName) || sub.fileName,
      parentToolCallId: asString(sub.data.parentToolCallId),
      trace: sub.data,
    }))
    .filter((item) => item.parentToolCallId);
}

function SubagentTraceInline({ traces, live = false }: { traces: SubagentTraceGroup[]; live?: boolean }) {
  if (traces.length === 0) return null;
  return (
    <div className="mt-1 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-xyne-fg-secondary">
        <Workflow size={12} className="text-cyan-600 dark:text-cyan-400" />
        Subagent trace{traces.length === 1 ? "" : "s"}
      </p>
      <div className="space-y-1.5">
        {traces.map((sub) => (
          <div key={`${sub.parentToolCallId}:${sub.subagentName}`} className="rounded-md bg-xyne-surface px-2">
            <DebugTimelineSection
              title={`${sub.subagentName}: ${truncate(asString(sub.trace.question) || "Subagent task", 80)}`}
              data={sub.trace}
              live={live}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function conversationPairs(messages: unknown[]): Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> {
  const pairs: Array<{ user: Record<string, unknown>; assistant?: Record<string, unknown> }> = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = asString(message.role);
    if (role === "user") {
      // Internal harness nudges (structured-output / verify-responses / citation
      // reflection) are delivered via session.prompt("<system>…") and land in the
      // transcript as user-role messages. They are NOT real conversation turns —
      // skip them so a post-response nudge doesn't spawn a phantom empty turn.
      if (messageText(message).trimStart().startsWith("<system>")) continue;
      pairs.push({ user: message });
    } else if (role === "assistant" && pairs.length > 0 && !pairs[pairs.length - 1]?.assistant) {
      pairs[pairs.length - 1]!.assistant = message;
    }
  }
  return pairs;
}

function bundleContainsRun(
  bundle: DebugArtifactBundle,
  expected: { sessionId?: string; startedAt: number } | null,
): boolean {
  if (!expected) return true;
  const candidates = [bundle.debugSession, ...(bundle.runs ?? []).map((run) => run.data)]
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  return candidates.some((candidate) => {
    if (expected.sessionId && asString(candidate.sessionId) === expected.sessionId) return true;
    const startedAt = new Date(asString(candidate.startedAt)).getTime();
    return Number.isFinite(startedAt) && startedAt >= expected.startedAt - 2_000;
  });
}

function liveStreamStatus(events: DebugEventRecord[]): { rate: number; collected: number; live: boolean } | null {
  const latestBySource = new Map<string, DebugEventRecord>();
  for (const event of events) {
    if (event.kind !== "stream_rate") continue;
    const source = event.subagentName
      ? `${event.subagentName}:${event.parentToolCallId ?? "unknown"}`
      : "root";
    latestBySource.set(source, event);
  }
  if (latestBySource.size === 0) return null;
  let rate = 0;
  let collected = 0;
  let live = false;
  for (const event of latestBySource.values()) {
    const data = isRecord(event.data) ? event.data : {};
    const active = data.active === true;
    if (active && typeof data.streamsPerSec === "number") rate += data.streamsPerSec;
    if (typeof data.streamsCollected === "number") collected += data.streamsCollected;
    live ||= active;
  }
  return { rate, collected, live };
}

function persistedStreamStatus(bundle: DebugArtifactBundle | null): { rate: number; collected: number; live: false } | null {
  if (!bundle) return null;
  const candidates = [bundle.debugSession, ...(bundle.runs ?? []).map((run) => run.data)]
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  let latest: Record<string, unknown> | null = null;
  let latestAt = "";
  for (const candidate of candidates) {
    const events = Array.isArray(candidate.events) ? candidate.events : [];
    for (const event of events) {
      if (!isRecord(event) || asString(event.kind) !== "assistant_turn_end" || !isRecord(event.data)) continue;
      const at = asString(event.at);
      if (!latest || at >= latestAt) {
        latest = event.data;
        latestAt = at;
      }
    }
  }
  if (!latest) return null;
  const samples = streamRateSamples(latest.streamRateSamples);
  const collected = typeof latest.streamsCollected === "number"
    ? latest.streamsCollected
    : samples.at(-1)?.streamsCollected ?? 0;
  if (samples.length === 0 && collected === 0) return null;
  const rate = samples.length > 0
    ? samples.reduce((sum, sample) => sum + sample.streamsPerSec, 0) / samples.length
    : 0;
  return { rate, collected, live: false };
}

function DebugSessionBody({
  bundle,
  selectedTurnIndex,
  selectedSessionId,
  onLoadOlderRuns,
  loadingOlderRuns = false,
}: {
  bundle: DebugArtifactBundle;
  selectedTurnIndex?: number | null;
  selectedSessionId?: string | null;
  /** Absent once the server-side page cap is reached — the older runs are then
   *  only reachable by cursor, which this drawer doesn't drive. */
  onLoadOlderRuns?: () => void;
  loadingOlderRuns?: boolean;
}) {
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<"delta" | "abs">("delta");
  const root = bundle.debugSession;
  const rootEvents = Array.isArray(root?.events) ? root.events as Record<string, unknown>[] : (bundle.debugEvents ?? []);
  const persistedRuns = (bundle.runs ?? [])
    .slice()
    .sort((a, b) => asString(a.data.startedAt).localeCompare(asString(b.data.startedAt)));
  const historicalMessages = Array.isArray(root?.messages) ? root.messages : [];
  const historicalPairs = conversationPairs(historicalMessages);
  const legacyPairs = historicalPairs.slice(0, Math.max(0, historicalPairs.length - persistedRuns.length));
  const turnCount = legacyPairs.length + persistedRuns.length;
  const subagents = bundle.subagents.slice().sort((a, b) => {
    const aStarted = asString(a.data.startedAt);
    const bStarted = asString(b.data.startedAt);
    return aStarted.localeCompare(bStarted);
  });
  const subagentTracesBySession = new Map<string, SubagentTraceGroup[]>();
  for (const trace of groupSubagentTraces(subagents)) {
    const parentSessionId = asString(trace.trace.parentSessionId);
    if (!parentSessionId) continue;
    const list = subagentTracesBySession.get(parentSessionId) ?? [];
    list.push(trace);
    subagentTracesBySession.set(parentSessionId, list);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-1">
        <p className="text-[13px] font-semibold text-xyne-fg-primary">Conversation turns</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded border border-xyne-border bg-xyne-surface p-0.5" title="Timestamp display">
            {(["delta", "abs"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTimeMode(m)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${timeMode === m ? "bg-xyne-brand text-xyne-fg-inverse" : "text-xyne-fg-muted hover:text-xyne-fg-primary"}`}
              >
                {m === "delta" ? "Δ" : "abs"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-xyne-fg-muted">
            {turnCount || historicalPairs.length} turn{(turnCount || historicalPairs.length) === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* The run list is a capped PAGE. Without this line a long thread just
          stops at its 25th-newest run and looks like that is all there ever
          was — the older runs exist, they were simply not fetched. */}
      {bundle.truncated && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1.5 text-[11px] text-xyne-fg-muted">
          <span>
            Showing {persistedRuns.length} of {bundle.totalRuns ?? persistedRuns.length} runs · older runs not loaded
          </span>
          {onLoadOlderRuns ? (
            <button
              type="button"
              onClick={onLoadOlderRuns}
              disabled={loadingOlderRuns}
              className="rounded border border-xyne-border-subtle bg-xyne-surface px-1.5 py-0.5 font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingOlderRuns ? "Loading…" : "Load older runs"}
            </button>
          ) : (
            <span>page limit reached</span>
          )}
        </div>
      )}

      {legacyPairs.map((pair, index) => {
        // Hide legacy pairs entirely when a sessionId selector is active —
        // those rows pre-date the per-run files and can't be matched by sid.
        if (selectedSessionId != null) return null;
        if (selectedTurnIndex != null && selectedTurnIndex !== index) return null;
        const useRootTimeline = persistedRuns.length === 0 && index === legacyPairs.length - 1;
        const legacyTraces = useRootTimeline ? subagentTracesBySession.get(asString(root?.sessionId ?? "")) ?? [] : [];
        const legacyTracesByToolCallId = new Map<string, SubagentTraceGroup[]>();
        for (const trace of legacyTraces) {
          const list = legacyTracesByToolCallId.get(trace.parentToolCallId) ?? [];
          list.push(trace);
          legacyTracesByToolCallId.set(trace.parentToolCallId, list);
        }
        return (
          <DebugTimelineSection
            key={`legacy-turn-${index}`}
            title={`Turn ${index + 1}: ${truncate(displayMessageText(pair.user) || "User request", 90)}`}
            data={useRootTimeline && root ? { ...root, events: rootEvents } : {
              startedAt: messageTime(pair.user),
              finishedAt: pair.assistant ? messageTime(pair.assistant) : "",
              events: [],
            }}
            defaultOpen={useRootTimeline}
            subagentTracesByParentToolCallId={legacyTracesByToolCallId}
            selectedEventKey={selectedEventKey}
            onSelectEvent={setSelectedEventKey}
            timeMode={timeMode}
          />
        );
      })}

      {persistedRuns.length > 0 ? persistedRuns.map((run, index) => {
        const turnIndex = legacyPairs.length + index;
        // Branching-safe: prefer sessionId match. Chronological turn order
        // diverges from visible-path order once siblings exist.
        if (selectedSessionId != null && asString(run.data.sessionId) !== selectedSessionId) return null;
        if (selectedSessionId == null && selectedTurnIndex != null && selectedTurnIndex !== turnIndex) return null;
        const traceGroups = subagentTracesBySession.get(asString(run.data.sessionId)) ?? [];
        const subagentTracesByParentToolCallId = new Map<string, SubagentTraceGroup[]>();
        for (const trace of traceGroups) {
          const list = subagentTracesByParentToolCallId.get(trace.parentToolCallId) ?? [];
          list.push(trace);
          subagentTracesByParentToolCallId.set(trace.parentToolCallId, list);
        }
        return (
          <DebugTimelineSection
            key={run.fileName}
            title={`Turn ${legacyPairs.length + index + 1}: ${truncate(asString(run.data.task) || "User request", 90)}`}
            data={run.data}
            defaultOpen={index === persistedRuns.length - 1}
            subagentTracesByParentToolCallId={subagentTracesByParentToolCallId}
            selectedEventKey={selectedEventKey}
            onSelectEvent={setSelectedEventKey}
            timeMode={timeMode}
          />
        );
      }) : legacyPairs.length === 0 && historicalPairs.length === 0 && (selectedTurnIndex == null || selectedTurnIndex === 0) ? (
        <DebugTimelineSection
          title="Latest run"
          data={root ? { ...root, events: rootEvents } : null}
          defaultOpen
          subagentTracesByParentToolCallId={(() => {
            const traces = subagentTracesBySession.get(asString(root?.sessionId ?? "")) ?? [];
            const map = new Map<string, SubagentTraceGroup[]>();
            for (const trace of traces) {
              const list = map.get(trace.parentToolCallId) ?? [];
              list.push(trace);
              map.set(trace.parentToolCallId, list);
            }
            return map;
          })()}
          selectedEventKey={selectedEventKey}
          onSelectEvent={setSelectedEventKey}
          timeMode={timeMode}
        />
      ) : null}

      {selectedTurnIndex == null && subagents.filter((sub) => !persistedRuns.some((run) => asString(run.data.sessionId) === asString(sub.data.parentSessionId))).length > 0 && (
        <p className="border-t border-xyne-border-subtle pt-2 text-[12px] text-xyne-fg-muted">
          Some subagent traces could not be matched to a parent turn. Open the raw run data in the relevant turn to inspect them.
        </p>
      )}
    </div>
  );
}

/** claw's own defaults for the run page (`DEFAULT_RUN_LIMIT` / `MAX_RUN_LIMIT`
 *  in its debug route). Raising `limit` IS the paging UI here: one more click
 *  fetches an older slab, up to the server's ceiling. */
const RUN_PAGE_DEFAULT = 25;
const RUN_PAGE_MAX = 100;

export function DebugDrawer({ open, agentSlug, conversationId, onClose, inline = false, width = 460, liveEvents = [], running = false, artifactsReadyVersion = 0, selectedTurnIndex = null, selectedTurnLive = false, selectedSessionId = null }: DebugDrawerProps) {
  const [bundle, setBundle] = useState<DebugArtifactBundle | null>(null);
  const [bundleHasCurrentRun, setBundleHasCurrentRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [runLimit, setRunLimit] = useState(RUN_PAGE_DEFAULT);
  // A wider page refetches in the background (the current bundle stays on
  // screen), so the button needs its own pending flag — `loading` only covers
  // the first, bundle-less fetch.
  const [olderRunsPending, setOlderRunsPending] = useState(false);
  const [showLiveTrace, setShowLiveTrace] = useState(false);
  const expectedRunRef = useRef<{ sessionId?: string; startedAt: number } | null>(null);
  const previousRunningRef = useRef(false);
  const previousArtifactsReadyVersionRef = useRef(artifactsReadyVersion);
  const warnings = useMemo(() => collectWarnings(bundle), [bundle]);
  const currentLiveStream = useMemo(() => liveStreamStatus(liveEvents), [liveEvents]);
  const savedStream = useMemo(() => persistedStreamStatus(bundle), [bundle]);
  const streamStatus = running && currentLiveStream ? currentLiveStream : savedStream ?? currentLiveStream;

  useEffect(() => {
    if (running && liveEvents.length > 0) {
      setShowLiveTrace(true);
      return;
    }
    // Hold the live overlay until the bundle has actually caught up to the
    // most recent run — otherwise follow-up turns flash live events for a
    // moment and then vanish because a stale bundle from a prior turn was
    // already present.
    if (!bundle || !bundleHasCurrentRun) return;
    const timer = window.setTimeout(() => setShowLiveTrace(false), 240);
    return () => window.clearTimeout(timer);
  }, [running, liveEvents.length, bundle, bundleHasCurrentRun]);

  useEffect(() => {
    if (running && !previousRunningRef.current) {
      expectedRunRef.current = { startedAt: Date.now() };
      // A new run started — any existing bundle is now stale until we refetch.
      setBundleHasCurrentRun(false);
    }
    previousRunningRef.current = running;
  }, [running]);

  useEffect(() => {
    const start = liveEvents.find((event) => event.kind === "session_start");
    if (!start) return;
    const sessionId = isRecord(start.data) ? asString(start.data.sessionId) : "";
    const startedAt = new Date(start.at).getTime();
    expectedRunRef.current = {
      ...(sessionId ? { sessionId } : {}),
      startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    };
  }, [liveEvents]);

  useEffect(() => {
    setBundle(null);
    setBundleHasCurrentRun(true);
    setError(null);
    setRunLimit(RUN_PAGE_DEFAULT);
    setOlderRunsPending(false);
    previousArtifactsReadyVersionRef.current = artifactsReadyVersion;
  }, [agentSlug, conversationId]);

  useEffect(() => {
    if (!open || !agentSlug || !conversationId) return;
    let cancelled = false;
    let inFlight = false;
    const readinessChanged = artifactsReadyVersion !== previousArtifactsReadyVersionRef.current;
    previousArtifactsReadyVersionRef.current = artifactsReadyVersion;

    const fetchArtifacts = async (showError: boolean, requireCurrentRun = false): Promise<boolean> => {
      if (inFlight) return false;
      inFlight = true;
      try {
        const data = await fetchConversationDebugArtifacts(agentSlug, conversationId, { limit: runLimit });
        if (cancelled) return false;
        setBundle(data);
        setError(null);
        if (requireCurrentRun && !bundleContainsRun(data, expectedRunRef.current)) return false;
        if (requireCurrentRun) {
          expectedRunRef.current = null;
          setBundleHasCurrentRun(true);
        }
        return true;
      } catch (err) {
        if (!cancelled && showError) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        inFlight = false;
      }
    };

    setLoading(!bundle && !running);
    setError(null);
    if (running && !readinessChanged) {
      void fetchArtifacts(false);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const requireCurrentRun = readinessChanged && expectedRunRef.current != null;
      let loaded = false;
      const attempts = requireCurrentRun ? 3 : 1;
      for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
        loaded = await fetchArtifacts(false, requireCurrentRun);
        if (loaded) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!loaded && !cancelled) await fetchArtifacts(true, requireCurrentRun);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, agentSlug, conversationId, artifactsReadyVersion, refreshVersion, runLimit]);

  // Any bundle landing (wider page, refresh, or in-progress poll) answers the
  // pending "load older" click.
  useEffect(() => { setOlderRunsPending(false); }, [bundle]);

  // A VIEWER / reloaded tab has no driving stream (`running` is false), so the
  // fetch runs once. When the fetched bundle is a PARTIAL in-progress run
  // (claw's incremental debug write, or the DB-synthesized in-progress bundle
  // the /debug route returns before completion), poll so the drawer stays live
  // until the run finishes. Stops automatically once the bundle is no longer
  // marked in-progress or the drawer closes.
  const bundleInProgress = useMemo(() => {
    if (!bundle) return false;
    if ((bundle.debugSession as { inProgress?: boolean } | null)?.inProgress === true) return true;
    return (bundle.runs ?? []).some((r) => (r.data as { inProgress?: boolean } | undefined)?.inProgress === true);
  }, [bundle]);
  // Stop the in-progress poll once a fetch errors — when the run completes the
  // DB-synth /debug route 404s (no in-progress runs left), which throws here; we
  // must tear down or the interval loops forever. Reset on open / conversation nav.
  const [livePollStopped, setLivePollStopped] = useState(false);
  useEffect(() => { setLivePollStopped(false); }, [open, agentSlug, conversationId]);
  useEffect(() => {
    // Only a VIEWER polls; the driving tab already streams debug via liveEvents.
    if (!open || running || !agentSlug || !conversationId || !bundleInProgress || livePollStopped) return;
    let cancelled = false;
    const id = window.setInterval(() => {
      fetchConversationDebugArtifacts(agentSlug, conversationId, { limit: runLimit })
        .then((data) => { if (!cancelled) setBundle(data); }) // a completed bundle flips bundleInProgress → effect tears down
        .catch(() => { if (!cancelled) setLivePollStopped(true); });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, running, agentSlug, conversationId, bundleInProgress, livePollStopped, runLimit]);

  if (!open) return null;

  const panel = (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-xyne-border-subtle px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-xyne-brand-ghost text-xyne-brand">
          <Bug size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-xyne-fg-primary">Debugger</p>
          <p className="truncate text-[10px] text-xyne-fg-muted">
            {selectedSessionId
              ? `Run ${selectedSessionId.slice(0, 8)}`
              : selectedTurnIndex != null
                ? `Turn ${selectedTurnIndex + 1}`
                : agentSlug} {conversationId ? `· ${conversationId}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!conversationId) return;
            setRefreshVersion((version) => version + 1);
          }}
          disabled={!conversationId || loading}
          className="inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1 text-[10px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface hover:text-xyne-fg-primary"
          aria-label="Close debugger"
        >
          <X size={16} />
        </button>
      </div>
      <WarningsNotice warnings={warnings} />
      {streamStatus && <StreamRateStatus rate={streamStatus.rate} collected={streamStatus.collected} live={running && streamStatus.live} />}

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {!conversationId ? (
          running && liveEvents.length > 0 ? (
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-baseline gap-2">
                  <p className="text-[12px] font-semibold text-xyne-fg-secondary">Live run</p>
                  <p className="text-[11px] text-xyne-fg-muted">waiting for conversation id</p>
                </div>
                <LiveDebugTrace events={liveEvents} />
              </div>
              <p className="border-t border-xyne-border-subtle pt-3 text-[12px] text-xyne-fg-muted">
                The conversation record will appear here once the backend assigns an id.
              </p>
            </div>
          ) : (
            <p className="py-6 text-[13px] text-xyne-fg-muted">
              Open a conversation to inspect its runtime trace.
            </p>
          )
        ) : loading && !bundle ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-md bg-xyne-surface-subtle" />
            <div className="h-72 animate-pulse rounded-md bg-xyne-surface-subtle" />
          </div>
        ) : error && !bundle ? (
          <p className="py-4 text-[13px] text-red-700 dark:text-red-300">{error}</p>
        ) : (
          <div className="space-y-3">
            {conversationId && (showLiveTrace || (running && liveEvents.length > 0)) && selectedSessionId == null && (selectedTurnIndex == null || selectedTurnLive) && (() => {
              // Never let a stale PRIOR-turn bundle hide an actively-streaming
              // new run: while the current turn is streaming live events, force
              // the handoff off. Otherwise follow-up turns render the live block
              // but at opacity-0, because the prior bundle survives the turn
              // boundary and the bundleHasCurrentRun reset is a deferred/racy
              // effect. Once the run ends (running=false, liveEvents reset to []),
              // this reverts to bundle && bundleHasCurrentRun and hands off to the
              // persisted trace as before.
              const liveHandedOff = Boolean(bundle && bundleHasCurrentRun && !(running && liveEvents.length > 0));
              return (
                <div
                  className={`transition-all duration-300 ease-out ${liveHandedOff ? "pointer-events-none opacity-0 -translate-y-1" : "opacity-100 translate-y-0"}`}
                  aria-hidden={liveHandedOff}
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <p className="text-[12px] font-semibold text-xyne-fg-secondary">Live run</p>
                    <p className="text-[11px] text-xyne-fg-muted">{liveHandedOff ? "handoff to persisted trace" : "updates while the request is in flight"}</p>
                  </div>
                  <LiveDebugTrace events={liveEvents} />
                </div>
              );
            })()}
            <div className={`transition-all duration-300 ease-out ${bundle ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"}`}>
              {bundle ? (
                <DebugSessionBody
                  bundle={bundle}
                  selectedTurnIndex={selectedTurnIndex}
                  selectedSessionId={selectedSessionId}
                  loadingOlderRuns={olderRunsPending}
                  {...(runLimit < RUN_PAGE_MAX
                    ? {
                        onLoadOlderRuns: () => {
                          setOlderRunsPending(true);
                          setRunLimit((limit) => Math.min(RUN_PAGE_MAX, limit + RUN_PAGE_DEFAULT));
                        },
                      }
                    : {})}
                />
              ) : (
                <p className="py-6 text-[13px] text-xyne-fg-muted">
                  No debugger artifacts found for this conversation.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (inline) {
    return (
      <div
        className="flex h-full min-h-0 flex-col border-l border-xyne-border-subtle bg-xyne-surface shadow-2xl"
        style={{ width }}
      >
        {panel}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[min(940px,92vw)] flex-col border-l border-xyne-border-subtle bg-xyne-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>
    </div>
  );
}
