import { SUBAGENT_DEFINITIONS } from "xyne-claw-shared";

export interface DebugTraceEvent {
  seq?: number;
  at?: string;
  kind?: string;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  data?: Record<string, unknown>;
}

export interface DebugTraceRun {
  schemaVersion?: unknown;
  conversationId?: unknown;
  sessionId?: unknown;
  agentSlug?: unknown;
  provider?: unknown;
  model?: unknown;
  thinking?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  task?: unknown;
  tokenUsage?: unknown;
  latency?: unknown;
  events?: unknown;
}

export const DEBUG_TRACE_MAX_BYTES = 2_000_000;

const SECRET_RE = /(bearer\s+\S+|sk-[A-Za-z0-9]{8,}|token"?\s*[:=]\s*"?\S+)/gi;
const THINKING_MAX = 600;
const SYSTEM_PROMPT_MAX = 4000;
const TOOLS_MAX = 4000;
const ARG_SUMMARY_MAX = 80;

const TOOL_LABELS = new Map<string, string>(
  SUBAGENT_DEFINITIONS.map((def) => [def.name, def.progressLabels[0] ?? def.name] as const),
);

function scrub(value: string): string {
  return value.replace(SECRET_RE, "[redacted]");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clean(value: unknown, max = 200): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  const scrubbed = scrub(raw).replace(/\s+/g, " ").trim();
  const cut = scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
  return escapeHtml(cut);
}

function cleanBlock(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const scrubbed = scrub(value);
  const cut = scrubbed.length > max ? `${scrubbed.slice(0, max)}\n…[truncated]` : scrubbed;
  return escapeHtml(cut);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ms(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const totalSec = Math.round(n / 1000);
  return `${Math.floor(totalSec / 60)}m ${String(totalSec % 60).padStart(2, "0")}s`;
}

function offset(atIso: string | null, startMs: number | null): string {
  if (!atIso || startMs === null) return "—";
  const t = Date.parse(atIso);
  if (Number.isNaN(t)) return "—";
  const delta = Math.max(0, t - startMs);
  const totalSec = Math.floor(delta / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function argSummary(args: unknown): string {
  const source = rec(args);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (parts.length >= 3) break;
    if (value === null || value === undefined) continue;
    const type = typeof value;
    if (type !== "string" && type !== "number" && type !== "boolean") continue;
    const raw = String(value).replace(/\s+/g, " ").trim();
    if (raw.length === 0) continue;
    parts.push(`${key}=${raw.length > 30 ? `${raw.slice(0, 30)}…` : raw}`);
  }
  if (parts.length === 0) return "";
  const joined = parts.join(" · ");
  return clean(joined.length > ARG_SUMMARY_MAX ? `${joined.slice(0, ARG_SUMMARY_MAX)}…` : joined, ARG_SUMMARY_MAX + 2);
}

function toolLabel(toolName: string): string {
  return TOOL_LABELS.get(toolName) ?? "";
}

/**
 * A payload the recorder interned into the blob log instead of inlining it.
 * The hash and byte count outlive the content (a `metadata` capture keeps the
 * ref and drops the bytes), so a row can still say what existed and how big it
 * was — which is the whole reason these must not render as `[object Object]`.
 */
interface BlobRefLike {
  hash: string;
  bytes: number;
  originalBytes?: number;
  truncated?: true;
  preview?: string;
}

function isBlobRefLike(value: unknown): value is BlobRefLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { hash?: unknown }).hash === "string" &&
    typeof (value as { bytes?: unknown }).bytes === "number"
  );
}

interface Payload {
  value: unknown;
  ref: BlobRefLike | null;
}

/**
 * Read a field that may be inline, a BlobRef standing in for the value, or a
 * sibling `<field>Ref` — the form materialization leaves behind when the blob
 * content could not be resolved.
 */
function payload(data: Record<string, unknown>, field: string): Payload {
  const inline = data[field];
  if (isBlobRefLike(inline)) return { value: undefined, ref: inline };
  const sibling = data[`${field}Ref`];
  return { value: inline, ref: isBlobRefLike(sibling) ? sibling : null };
}

function refNote(ref: BlobRefLike): string {
  const bytes = ref.originalBytes ?? ref.bytes;
  return `[${ref.truncated || ref.preview ? "truncated" : "not captured"} — ${bytes} bytes]`;
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function payloadBlock(p: Payload, max: number): string {
  if (p.value !== undefined && p.value !== null) {
    const body = cleanBlock(jsonText(p.value), max);
    return p.ref ? `${body}\n${escapeHtml(refNote(p.ref))}` : body;
  }
  if (!p.ref) return "";
  const preview = p.ref.preview ? cleanBlock(p.ref.preview, max) : "";
  return preview ? `${preview}\n${escapeHtml(refNote(p.ref))}` : escapeHtml(refNote(p.ref));
}

function payloadSize(p: Payload): number | null {
  if (typeof p.value === "string") return p.value.length;
  if (p.ref) return p.ref.originalBytes ?? p.ref.bytes;
  return null;
}

function payloadCount(p: Payload): number | null {
  return Array.isArray(p.value) ? p.value.length : null;
}

/** Names out of a list of strings, of `{ name }` objects, or of a bare ref. */
function nameList(p: Payload, max: number): string {
  if (Array.isArray(p.value)) {
    const names = p.value
      .map((item) => (typeof item === "string" ? item : str(rec(item)["name"]) ?? ""))
      .filter((n) => n.length > 0);
    return names.length > 0 ? clean(names.join(", "), max) : "";
  }
  return p.ref?.preview ? clean(p.ref.preview, max) : "";
}

function collapsed(label: string, body: string): string {
  return body ? `<details><summary>${escapeHtml(label)}</summary><pre>${body}</pre></details>` : "";
}

/**
 * Providers disagree on usage key names (`input` / `inputTokens` /
 * `cache_read_input_tokens`), and `llm_response` carries the provider's raw
 * object, so read whichever spelling arrived.
 */
function usageParts(usage: Record<string, unknown>): string {
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = num(usage[key]);
      if (value !== null) return value;
    }
    return null;
  };
  return [
    ["in", pick("input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens")],
    ["out", pick("output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens")],
    ["cacheR", pick("cacheRead", "cacheReadTokens", "cachedInputTokens", "cache_read_input_tokens")],
    ["cacheW", pick("cacheWrite", "cacheWriteTokens", "cache_creation_input_tokens")],
  ]
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `${String(label)} ${String(value)}`)
    .join(" · ");
}

/** Request params, shared by `llm_request` and the `session_prompt` row that
 *  materialization folds a request into. */
function requestMeta(data: Record<string, unknown>): string[] {
  const toolCount = num(data["toolCount"]) ?? payloadCount(payload(data, "tools"));
  const added = payloadCount(payload(data, "paletteAdded")) ?? 0;
  const removed = payloadCount(payload(data, "paletteRemoved")) ?? 0;
  return [
    toolCount !== null ? `${toolCount} tools` : "",
    data["thinkingLevel"] ? `thinking ${clean(data["thinkingLevel"], 20)}` : "",
    num(data["temperature"]) !== null ? `temp ${num(data["temperature"])}` : "",
    num(data["maxTokens"]) !== null ? `maxTokens ${num(data["maxTokens"])}` : "",
    data["fastMode"] === true ? "fast mode" : "",
    added > 0 || removed > 0 ? `palette +${added}/−${removed}` : "",
  ].filter(Boolean);
}

/**
 * The effective system prompt (the one pi actually sent, `<available_skills>`
 * included), the tool definitions with their schemas, and the skill list — all
 * collapsed, because each is kilobytes and none of it is what a reader scans a
 * timeline for.
 */
function requestBody(data: Record<string, unknown>): string {
  const system = payload(data, "systemPrompt");
  const tools = payload(data, "tools");
  const skills = payload(data, "availableSkills");
  const systemSize = payloadSize(system);
  const toolCount = num(data["toolCount"]) ?? payloadCount(tools);
  const skillNames = nameList(skills, 300);
  return (
    collapsed(
      `system prompt${systemSize !== null ? ` (${systemSize} chars)` : ""}`,
      payloadBlock(system, SYSTEM_PROMPT_MAX),
    ) +
    collapsed(`tools${toolCount !== null ? ` (${toolCount})` : ""}`, payloadBlock(tools, TOOLS_MAX)) +
    (skillNames ? `<div class="meta">skills — ${skillNames}</div>` : "")
  );
}

/** Emitted once per run and back-referenced thereafter — see the materializer's
 *  `dedupeRepeatedPayloads`. An exported trace must still show them on every
 *  call, so resolve the references before rendering. */
const DEDUPED_FOLD_FIELDS = ["systemPrompt", "tools", "toolNames", "availableSkills"] as const;

function rehydrateRepeatedPayloads(list: DebugTraceEvent[]): DebugTraceEvent[] {
  const bySeq = new Map<number, Record<string, unknown>>();
  for (const event of list) {
    const seq = num(event.seq);
    const data = event.data;
    if (seq !== null && seq !== undefined && data && typeof data === "object") {
      bySeq.set(seq, data as Record<string, unknown>);
    }
  }
  return list.map((event) => {
    if (!event.data || typeof event.data !== "object") return event;
    const data = event.data as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    for (const field of DEDUPED_FOLD_FIELDS) {
      const from = data[`${field}UnchangedFromSeq`];
      if (typeof from !== "number") continue;
      const source = bySeq.get(from)?.[field];
      if (source === undefined) continue;
      next ??= { ...data };
      next[field] = source;
    }
    return next ? { ...event, data: next } : event;
  });
}

function events(run: DebugTraceRun): DebugTraceEvent[] {
  if (!Array.isArray(run.events)) return [];
  const list = run.events.filter((e): e is DebugTraceEvent => Boolean(e) && typeof e === "object");
  const sorted = [...list].sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
  return rehydrateRepeatedPayloads(sorted);
}

interface ToolStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

function row(cells: { offset: string; badge: string; kindClass: string; title: string; meta: string; body?: string }): string {
  const body = cells.body ? `<div class="body">${cells.body}</div>` : "";
  return (
    `<div class="row ${cells.kindClass}">` +
    `<div class="off">${cells.offset}</div>` +
    `<div class="main"><div class="head"><span class="badge">${cells.badge}</span>` +
    `<span class="title">${cells.title}</span></div>` +
    (cells.meta ? `<div class="meta">${cells.meta}</div>` : "") +
    body +
    `</div></div>`
  );
}

export function renderDebugTraceHtml(run: DebugTraceRun): string {
  const all = events(run);
  const startedAt = str(run.startedAt);
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const startBase = Number.isNaN(startMs) ? null : startMs;

  const endsByCallId = new Map<string, DebugTraceEvent>();
  for (const event of all) {
    if (event.kind === "tool_execution_end" && str(event.toolCallId)) {
      endsByCallId.set(event.toolCallId as string, event);
    }
  }

  const stats = new Map<string, ToolStat>();
  for (const event of all) {
    if (event.kind !== "tool_execution_end") continue;
    const data = rec(event.data);
    const name = str(data["toolName"]) ?? "(unknown)";
    const stat = stats.get(name) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    stat.count += 1;
    if (data["isError"] === true) stat.errors += 1;
    const duration = num(data["durationMs"]) ?? 0;
    stat.totalMs += duration;
    if (duration > stat.maxMs) stat.maxMs = duration;
    stats.set(name, stat);
  }

  const promptAtByCall = new Map<number, string>();
  for (const event of all) {
    const call = num(event.llmCall);
    if (event.kind === "session_prompt" && call !== null && str(event.at)) {
      promptAtByCall.set(call, event.at as string);
    }
  }

  const rows: string[] = [];
  let bytes = 0;
  let truncated = false;
  let toolCalls = 0;
  let llmTurns = 0;
  let compactions = 0;

  for (const event of all) {
    const kind = event.kind ?? "";
    // tool_execution_end is folded into its start row; message_append is
    // transcript bookkeeping and would add one empty row per turn.
    if (kind === "tool_execution_end" || kind === "message_append") continue;
    const at = str(event.at);
    const off = offset(at, startBase);
    const data = rec(event.data);
    let rendered: string | null = null;

    if (kind === "session_start") {
      rendered = row({
        offset: off,
        badge: "start",
        kindClass: "k-session",
        title: "Session start",
        meta: [
          clean(data["provider"], 40),
          clean(data["model"], 60),
          data["thinking"] ? `thinking ${clean(data["thinking"], 20)}` : "",
          data["mode"] ? `mode ${clean(data["mode"], 20)}` : "",
        ].filter(Boolean).join(" · "),
        body: data["task"] ? `<div class="task">${cleanBlock(data["task"], 400)}</div>` : "",
      });
    } else if (kind === "session_tools") {
      rendered = row({
        offset: off,
        badge: "tools",
        kindClass: "k-session",
        title: `Tool palette — ${num(data["toolCount"]) ?? 0} tools`,
        meta: Array.isArray(data["tools"]) ? clean((data["tools"] as unknown[]).join(", "), 300) : "",
      });
    } else if (kind === "mode_switch") {
      rendered = row({
        offset: off,
        badge: "mode",
        kindClass: "k-session",
        title: `Mode ${clean(data["from"], 20)} → ${clean(data["to"], 20)}`,
        meta: clean(data["reason"], 60),
      });
    } else if (kind === "session_prompt") {
      // Materialization folds the turn's llm_request into this row, so the
      // request params and prompt/tool payloads may live here.
      rendered = row({
        offset: off,
        badge: "llm",
        kindClass: "k-prompt",
        title: `LLM call #${num(event.llmCall) ?? 0} sent`,
        meta: [
          data["kind"] ? clean(data["kind"], 20) : "",
          `${num(data["messageCount"]) ?? 0} messages`,
          num(data["imagesCount"]) ? `${num(data["imagesCount"])} images` : "",
          ...requestMeta(data),
        ].filter(Boolean).join(" · "),
        body: requestBody(data),
      });
    } else if (kind === "llm_request") {
      rendered = row({
        offset: off,
        badge: "request",
        kindClass: "k-prompt",
        title:
          `LLM request #${num(event.llmCall) ?? 0} — ` +
          `${clean(data["provider"], 30) || clean(run.provider, 30) || "?"}/` +
          `${clean(data["model"], 60) || clean(run.model, 60) || "?"}`,
        meta: requestMeta(data).join(" · "),
        body: requestBody(data),
      });
    } else if (kind === "llm_response") {
      rendered = row({
        offset: off,
        badge: "response",
        kindClass: "k-llm",
        title: `LLM response #${num(event.llmCall) ?? 0}${data["stopReason"] ? ` — stop ${clean(data["stopReason"], 40)}` : ""}`,
        meta: [
          num(data["ttftMs"]) !== null ? `ttft ${ms(data["ttftMs"])}` : "",
          num(data["totalMs"]) !== null ? `total ${ms(data["totalMs"])}` : "",
          usageParts(rec(data["usage"])),
          data["errorMessage"] ? `error ${clean(data["errorMessage"], 120)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "tool_palette_change") {
      const added = payload(data, "added");
      const removed = payload(data, "removed");
      const addedNames = nameList(added, 160);
      const removedNames = nameList(removed, 160);
      rendered = row({
        offset: off,
        badge: "tools",
        kindClass: "k-session",
        title: `Tool palette ${clean(data["source"], 24) || "change"} — +${payloadCount(added) ?? 0} / −${payloadCount(removed) ?? 0}`,
        meta: [
          addedNames ? `added ${addedNames}` : "",
          removedNames ? `removed ${removedNames}` : "",
          num(data["activeCount"]) !== null ? `${num(data["activeCount"])} active` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "skill_loaded") {
      rendered = row({
        offset: off,
        badge: "skill",
        kindClass: "k-sub",
        title: `Skill loaded — ${clean(data["slug"], 60) || "(unnamed)"}`,
        meta: [
          clean(data["path"], 140),
          data["viaToolCallId"] ? `via ${clean(data["viaToolCallId"], 40)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "subagent_start") {
      rendered = row({
        offset: off,
        badge: "subagent",
        kindClass: "k-sub",
        title: `Subagent start — ${clean(data["subagentName"] ?? event.subagentName, 40) || "(unnamed)"}`,
        meta: [
          `${clean(data["provider"], 30) || "?"}/${clean(data["model"], 60) || "?"}`,
          num(data["questionChars"]) !== null ? `question ${num(data["questionChars"])} chars` : "",
          payloadCount(payload(data, "toolNames")) !== null
            ? `${payloadCount(payload(data, "toolNames"))} tools`
            : "",
          data["childRunId"] ? `run ${clean(data["childRunId"], 40)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "subagent_end") {
      rendered = row({
        offset: off,
        badge: "subagent",
        kindClass: data["status"] === "error" ? "k-retry" : "k-sub",
        title: `Subagent end — ${clean(data["subagentName"] ?? event.subagentName, 40) || "(unnamed)"}${data["status"] ? ` (${clean(data["status"], 20)})` : ""}`,
        meta: [
          num(data["durationMs"]) !== null ? ms(data["durationMs"]) : "",
          num(data["textLength"]) !== null ? `${num(data["textLength"])} chars` : "",
          nameList(payload(data, "toolsUsed"), 160) ? `tools ${nameList(payload(data, "toolsUsed"), 160)}` : "",
          data["providerError"] ? `error ${clean(data["providerError"], 120)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "provider_fallback") {
      rendered = row({
        offset: off,
        badge: "fallback",
        kindClass: "k-retry",
        title: `Provider fallback ${clean(data["fromProvider"], 30) || "?"} → ${clean(data["toProvider"], 30) || "?"}`,
        meta: [
          num(data["attempt"]) !== null ? `attempt ${num(data["attempt"])}` : "",
          data["reason"] ? `reason ${clean(data["reason"], 120)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "delegation") {
      const detail = payload(data, "detail");
      const detailText = typeof detail.value === "string" ? detail.value : detail.ref?.preview ?? "";
      rendered = row({
        offset: off,
        badge: "delegation",
        kindClass: "k-sub",
        title: `Delegation ${clean(data["kind"], 24) || ""} — ${clean(data["caller"], 40) || "?"} → ${clean(data["callee"], 40) || "?"}`,
        meta: [
          num(data["depth"]) !== null ? `depth ${num(data["depth"])}` : "",
          data["reason"] ? `reason ${clean(data["reason"], 80)}` : "",
          clean(detailText, 120),
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "thinking") {
      rendered = row({
        offset: off,
        badge: "think",
        kindClass: "k-think",
        title: `Thinking — ${num(data["chars"]) ?? 0} chars`,
        meta: "",
        body: `<details><summary>show reasoning</summary><pre>${cleanBlock(data["text"], THINKING_MAX)}</pre></details>`,
      });
    } else if (kind === "assistant_turn_end") {
      llmTurns += 1;
      const usage = rec(data["usage"]);
      const call = num(event.llmCall);
      const promptAt = call !== null ? promptAtByCall.get(call) ?? null : null;
      const totalMs =
        promptAt && at && !Number.isNaN(Date.parse(promptAt)) && !Number.isNaN(Date.parse(at))
          ? Date.parse(at) - Date.parse(promptAt)
          : null;
      const tokenParts = usageParts(usage);
      rendered = row({
        offset: off,
        badge: "llm",
        kindClass: "k-llm",
        title: `LLM turn ${num(event.turn) ?? llmTurns} — ${clean(run.provider, 30) || "?"}/${clean(run.model, 60) || "?"}`,
        meta: [
          totalMs !== null ? `total ${ms(totalMs)}` : "",
          num(data["ttftMs"]) !== null ? `ttft ${ms(data["ttftMs"])}` : "",
          data["stopReason"] ? `stop ${clean(data["stopReason"], 40)}` : "",
          tokenParts,
          data["errorMessage"] ? `error ${clean(data["errorMessage"], 120)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "tool_execution_start") {
      toolCalls += 1;
      const name = str(data["toolName"]) ?? "(unknown)";
      const end = str(event.toolCallId) ? endsByCallId.get(event.toolCallId as string) : undefined;
      const endData = rec(end?.data);
      const isError = endData["isError"] === true;
      const mark = end ? (isError ? "✕" : "✓") : "…";
      const label = toolLabel(name);
      const summary = argSummary(data["args"]);
      rendered = row({
        offset: off,
        badge: "tool",
        kindClass: isError ? "k-tool err" : "k-tool",
        title: `${mark} ${escapeHtml(name)}${label ? ` <span class="lbl">${escapeHtml(label)}</span>` : ""}`,
        meta: [
          end ? ms(endData["durationMs"]) : "running",
          event.subagentName ? `subagent ${clean(event.subagentName, 40)}` : "",
          summary ? `args ${summary}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "compaction_start") {
      compactions += 1;
      rendered = row({
        offset: off,
        badge: "compact",
        kindClass: "k-compact",
        title: "Compaction started",
        meta: [
          data["reason"] ? `reason ${clean(data["reason"], 60)}` : "",
          num(data["tokensBefore"]) !== null ? `tokensBefore ${num(data["tokensBefore"])}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "compaction_end") {
      rendered = row({
        offset: off,
        badge: "compact",
        kindClass: "k-compact",
        title: `Compaction ended${data["aborted"] === true ? " (aborted)" : ""}`,
        meta: [
          data["reason"] ? `reason ${clean(data["reason"], 60)}` : "",
          num(data["tokensBefore"]) !== null ? `tokensBefore ${num(data["tokensBefore"])}` : "",
          data["willRetry"] === true ? "willRetry" : "",
          data["errorMessage"] ? `error ${clean(data["errorMessage"], 120)}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "auto_retry_start" || kind === "auto_retry_end") {
      rendered = row({
        offset: off,
        badge: "retry",
        kindClass: "k-retry",
        title: `Provider retry / fallback (attempt ${num(data["attempt"]) ?? "?"}/${num(data["maxAttempts"]) ?? "?"})`,
        meta: clean(data["errorMessage"], 160),
      });
    } else if (kind === "background_subagents_delivered") {
      rendered = row({
        offset: off,
        badge: "subagent",
        kindClass: "k-sub",
        title: `Background subagents delivered — ${num(data["count"]) ?? 0}`,
        meta: Array.isArray(data["tasks"]) ? clean((data["tasks"] as unknown[]).map((t) => String(t)).join(" · "), 200) : "",
      });
    } else if (kind === "citation_reflection" || kind === "twin_deliver_reflection") {
      rendered = row({
        offset: off,
        badge: "reflect",
        kindClass: "k-sub",
        title: kind === "citation_reflection" ? "Citation reflection" : "Delivery reflection",
        meta: [
          data["phase"] ? clean(data["phase"], 30) : "",
          data["action"] ? clean(data["action"], 40) : "",
          num(data["round"]) !== null ? `round ${num(data["round"])}` : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind === "session_end" || kind === "session_cancelled" || kind === "session_error") {
      const latency = rec(data["latency"]);
      rendered = row({
        offset: off,
        badge: "end",
        kindClass: "k-session",
        title:
          kind === "session_end" ? "Session end" : kind === "session_cancelled" ? "Session cancelled" : "Session error",
        meta: [
          num(data["toolCount"]) !== null ? `${num(data["toolCount"])} tool calls` : "",
          num(latency["llmTurns"]) !== null ? `${num(latency["llmTurns"])} LLM turns` : "",
          num(latency["totalMs"]) !== null ? `total ${ms(latency["totalMs"])}` : "",
          data["error"] ? clean(data["error"], 160) : "",
        ].filter(Boolean).join(" · "),
      });
    } else if (kind.length > 0) {
      rendered = row({
        offset: off,
        badge: escapeHtml(kind.slice(0, 24)),
        kindClass: "k-other",
        title: escapeHtml(kind),
        meta: "",
      });
    }

    if (!rendered) continue;
    if (bytes + rendered.length > DEBUG_TRACE_MAX_BYTES) {
      truncated = true;
      break;
    }
    bytes += rendered.length;
    rows.push(rendered);
  }

  const usage = rec(run.tokenUsage);
  const latency = rec(run.latency);
  const finishedAt = str(run.finishedAt);
  const durationMs =
    num(latency["totalMs"]) ??
    (startBase !== null && finishedAt && !Number.isNaN(Date.parse(finishedAt))
      ? Date.parse(finishedAt) - startBase
      : null);

  const statRows = [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([name, stat]) =>
      `<tr><td>${escapeHtml(name)}</td><td>${stat.count}</td><td>${ms(stat.totalMs / Math.max(1, stat.count))}</td>` +
      `<td>${ms(stat.maxMs)}</td><td>${stat.errors > 0 ? `<span class="err-count">${stat.errors}</span>` : "0"}</td></tr>`,
    )
    .join("");

  const headerRows = [
    ["Agent", clean(run.agentSlug, 80)],
    ["Session", clean(run.sessionId, 80)],
    ["Conversation", clean(run.conversationId, 120)],
    ["Provider / model", `${clean(run.provider, 40) || "—"} / ${clean(run.model, 80) || "—"}`],
    ["Thinking", clean(run.thinking, 40) || "—"],
    ["Started", clean(startedAt, 40) || "—"],
    ["Finished", clean(finishedAt, 40) || "in progress"],
    ["Duration", ms(durationMs)],
    [
      "Tokens",
      [
        num(usage["input"]) !== null ? `in ${num(usage["input"])}` : "",
        num(usage["output"]) !== null ? `out ${num(usage["output"])}` : "",
        num(usage["cacheRead"]) !== null ? `cache read ${num(usage["cacheRead"])}` : "",
        num(usage["cacheWrite"]) !== null ? `cache write ${num(usage["cacheWrite"])}` : "",
      ].filter(Boolean).join(" · ") || "—",
    ],
    [
      "Latency",
      [
        num(latency["llmTurns"]) !== null ? `${num(latency["llmTurns"])} turns` : "",
        num(latency["llmTotalMs"]) !== null ? `llm ${ms(latency["llmTotalMs"])}` : "",
        num(latency["llmWaitMs"]) !== null ? `wait ${ms(latency["llmWaitMs"])}` : "",
        num(latency["llmDecodeMs"]) !== null ? `decode ${ms(latency["llmDecodeMs"])}` : "",
        num(latency["toolMs"]) !== null ? `tools ${ms(latency["toolMs"])}` : "",
        num(latency["llmRetries"]) ? `${num(latency["llmRetries"])} retries` : "",
      ].filter(Boolean).join(" · ") || "—",
    ],
  ]
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join("");

  const truncNotice = truncated
    ? `<p class="notice">Timeline truncated — the trace exceeded the ${Math.round(DEBUG_TRACE_MAX_BYTES / 1_000_000)} MB rendering cap. ${rows.length} of ${all.length} events shown.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution trace — ${clean(run.agentSlug, 60) || "run"}</title>
<style>
:root { color-scheme: light dark; --bg:#fff; --fg:#16181d; --muted:#666e7a; --line:#e3e6ea; --accent:#2f6fd0; --warn:#b8620a; --err:#c0362c; --chip:#f2f4f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161a; --fg:#e6e8ec; --muted:#9aa3ae; --line:#2a2e35; --accent:#79aaf5; --warn:#e0a25a; --err:#ef7a70; --chip:#1e2229; } }
* { box-sizing: border-box; }
body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
h1 { font-size:18px; margin:0 0 4px; }
h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:28px 0 10px; }
table { border-collapse:collapse; width:100%; max-width:900px; }
th, td { text-align:left; padding:5px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
.meta-table th { width:170px; color:var(--muted); font-weight:500; }
.scroll { overflow-x:auto; }
.row { display:flex; gap:12px; padding:8px 10px; border-left:3px solid var(--line); margin-bottom:2px; background:var(--chip); border-radius:0 5px 5px 0; }
.off { flex:0 0 62px; font-variant-numeric:tabular-nums; color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; padding-top:2px; }
.main { min-width:0; flex:1; }
.head { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
.badge { font-size:10px; text-transform:uppercase; letter-spacing:.05em; padding:1px 6px; border-radius:9px; background:var(--bg); border:1px solid var(--line); color:var(--muted); }
.title { font-weight:600; word-break:break-word; }
.lbl { font-weight:400; color:var(--muted); }
.meta { color:var(--muted); font-size:12.5px; word-break:break-word; }
.body { margin-top:6px; }
pre { white-space:pre-wrap; word-break:break-word; margin:6px 0 0; font-size:12.5px; background:var(--bg); padding:8px; border-radius:4px; border:1px solid var(--line); }
.task { font-size:13px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
details summary { cursor:pointer; color:var(--accent); font-size:12.5px; }
.k-tool { border-left-color:var(--accent); }
.k-tool.err { border-left-color:var(--err); }
.k-llm { border-left-color:#7a55c9; }
.k-prompt { border-left-color:var(--line); }
.k-think { border-left-color:#8a8f98; }
.k-compact { border-left-color:var(--warn); background:color-mix(in srgb, var(--warn) 12%, var(--chip)); }
.k-retry { border-left-color:var(--err); }
.k-session { border-left-color:var(--fg); }
.k-sub { border-left-color:#2c9c7a; }
.err-count { color:var(--err); font-weight:600; }
.notice { color:var(--warn); font-size:13px; }
.foot { color:var(--muted); font-size:12px; margin-top:28px; }
</style></head>
<body>
<h1>Execution trace — ${clean(run.agentSlug, 60) || "run"}</h1>
<p class="meta">${toolCalls} tool calls · ${llmTurns} LLM turns · ${compactions} compactions · ${all.length} events</p>
<h2>Run</h2>
<div class="scroll"><table class="meta-table"><tbody>${headerRows}</tbody></table></div>
<h2>Tool calls by name</h2>
<div class="scroll"><table><thead><tr><th>Tool</th><th>Calls</th><th>Avg</th><th>Max</th><th>Errors</th></tr></thead>
<tbody>${statRows || `<tr><td colspan="5">No tool calls recorded.</td></tr>`}</tbody></table></div>
<h2>Timeline</h2>
${truncNotice}
${rows.join("\n")}
<p class="foot">Tool arguments are reduced to a short summary and tool results are never included. Secrets are scrubbed. The final answer body is not part of this trace.</p>
</body></html>`;
}
