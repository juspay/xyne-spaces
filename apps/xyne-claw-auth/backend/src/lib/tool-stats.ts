/**
 * Write-time tool summary for a finished run: its `agent_run_stats` row and one
 * `agent_run_tool_stats` row per tool it called. Runs after the run's own
 * transaction commits, so derived data never blocks or fails a run.
 *
 * Readers sum the duration buckets across rows, so every row must use the same
 * bucket edges and counter meanings; changing either means re-running the
 * backfill in force mode.
 *
 * `ci` (cited) only counts tokens in THIS run's own answer; a later turn
 * re-citing an earlier chunk is not seen at finalize.
 */

import type { Prisma } from "@prisma/client";

/** Upper bounds in ms; a final overflow bucket is implied. */
export const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000] as const;

/** Histogram slots: one per edge plus overflow. */
export const HISTOGRAM_SLOTS = DURATION_BUCKETS_MS.length + 1;

export interface ToolStat {
  /** tool name */
  t: string;
  /** calls */
  c: number;
  /** top-level calls (no parentToolCallId) */
  tl: number;
  /** errored calls (dropped ends excluded), including not-found */
  e: number;
  /** dropped tool_execution_end pushes */
  d: number;
  /** empty results */
  z: number;
  /** calls whose result carried a citation token */
  ce: number;
  /** citeable calls cited in this run's own answer */
  ci: number;
  /** summed durationMs */
  ms: number;
  /** max durationMs */
  mx: number;
  /** summed result bytes */
  b: number;
  /** repeat calls with identical args within this run */
  dup: number;
  /** errored calls followed by a later success of the same tool in this run */
  rec: number;
  /** errored calls whose result was "Tool X not found" (a palette miss, not a tool failure) */
  nf: number;
  /** duration histogram, DURATION_BUCKETS_MS + overflow */
  h: number[];
}

interface ToolErrorRow {
  tool: string;
  /** 1-based position in the run's toolInvocations array. */
  pos: number;
  errorClass: string;
  sample: string;
  notFound: boolean;
}

export interface RunToolSummary {
  stats: ToolStat[];
  totals: { calls: number; errors: number };
  errors: ToolErrorRow[];
}

const CLF_TOKEN_RE = /\[clf-[^#\s[\]]+#\d+\]/i;
const CLF_CAPTURE_RE = /\[clf-([^#\s[\]]+)#\d+\]/gi;
const DROPPED_END_RE = /^\(no result.*tool end event was not received\)$/;
const NOT_FOUND_RE = /^tool .+ not found/i;
const ORPHAN_MARKER = "interrupted (orphaned run)";

const SAMPLE_CHARS = 400;
/** Well past the 160-char class even after masking, so a cut never lands inside a masked token. */
const CLASS_INPUT_CHARS = 2000;
const CLASS_CHARS = 160;

interface RawInvocation {
  toolName?: unknown;
  toolCallId?: unknown;
  parentToolCallId?: unknown;
  args?: unknown;
  result?: unknown;
  isError?: unknown;
  status?: unknown;
  durationMs?: unknown;
}

function bucketIndex(ms: number): number {
  for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
    if (ms < DURATION_BUCKETS_MS[i]!) return i;
  }
  return DURATION_BUCKETS_MS.length;
}

/** A dropped end-event is a `running` row, or a swept row carrying the sentinel result with durationMs 0. */
function isDroppedEnd(inv: RawInvocation, result: string): boolean {
  return inv.status === "running" || DROPPED_END_RE.test(result);
}

/** Runtime-appended invocations the model never called (follow-up chips and their diagnostics). */
export function isSyntheticInvocation(inv: unknown): boolean {
  if (!inv || typeof inv !== "object") return false;
  const { toolName, args } = inv as RawInvocation;
  if (toolName === "internal-follow-up-diagnostics") return true;
  if (toolName === "ask-user-question" && args && typeof args === "object" && !Array.isArray(args)) {
    return (args as Record<string, unknown>)["purpose"] === "follow_up_suggestions";
  }
  return false;
}

/** toolCallIds the answer text cites. */
export function extractCitedToolCallIds(answerText: string | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (typeof answerText !== "string" || !answerText.includes("clf-")) return ids;
  for (const m of answerText.matchAll(CLF_CAPTURE_RE)) {
    if (m[1]) ids.add(m[1]);
  }
  return ids;
}

/** Stable key for identical-args detection within one run. */
function argsKey(args: unknown): string {
  if (args === undefined) return "";
  try {
    return JSON.stringify(args, (_k, v: unknown) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      }
      return v;
    }) ?? "";
  } catch {
    return "";
  }
}

/** Cut by code point so a surrogate pair is never split into invalid text. */
function cutCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join("");
}

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The text inside an error result: the first non-empty text part of an MCP
 * `{content:[{text}]}` envelope (later parts are skill injections), else
 * `{error}` / `{error:{message}}` / `{message}`, else the raw text.
 */
function unwrapErrorText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj["content"])) {
    for (const part of obj["content"]) {
      const text = part && typeof part === "object" ? (part as Record<string, unknown>)["text"] : undefined;
      if (nonBlank(text)) return text;
    }
  }
  const err = obj["error"];
  if (nonBlank(err)) return err;
  const errMsg = err && typeof err === "object" ? (err as Record<string, unknown>)["message"] : undefined;
  if (nonBlank(errMsg)) return errMsg;
  return nonBlank(obj["message"]) ? obj["message"] : raw;
}

/** Replaces a JSON body embedded in a message by its message, so upstream failures keep distinct classes. */
const EMBEDDED_JSON_ERROR = /\{[^{}]*"(?:error|message)"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}/g;

/** Order matters: urls/emails before quoted literals, uuids before generic hex, ids before bare numbers. */
const CLASS_MASKS: ReadonlyArray<[RegExp, string]> = [
  [/https?:\/\/[^\s"'<>]+/g, "<url>"],
  [/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g, "<email>"],
  // A single quote after a letter is an apostrophe ("can't"), not a literal.
  [/"(?:[^"\\]|\\.)*"|(?<![a-z0-9])'(?:[^'\\]|\\.)*'/g, "<str>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>"],
  [/\b[0-9a-f]{8,}\b/g, "<id>"],
  // cuid / nanoid style ids mix letters and digits; a word without a digit is prose.
  [/\b(?=[a-z_-]*\d)[a-z0-9_-]{16,}\b/g, "<id>"],
  [/\d+(?:\.\d+)?/g, "#"],
];

/** Error text to (class, sample, notFound): the class groups one failure mode across ids, numbers and literals. */
export function normalizeError(raw: string): { errorClass: string; sample: string; notFound: boolean } {
  // Postgres text rejects NUL.
  const text = unwrapErrorText(typeof raw === "string" ? raw : "").replace(/\u0000/g, "");
  const collapsed = text.replace(/\s+/g, " ").trim();
  // Masked before cutting: a cut through a uuid would leave a fragment that splits one class into many.
  let cls = collapsed.slice(0, CLASS_INPUT_CHARS).toLowerCase().replace(EMBEDDED_JSON_ERROR, "$1");
  for (const [re, placeholder] of CLASS_MASKS) cls = cls.replace(re, placeholder);
  cls = cls.replace(/\s+/g, " ").trim();
  return {
    errorClass: cutCodePoints(cls === "" ? "(empty error)" : cls, CLASS_CHARS),
    sample: cutCodePoints(collapsed, SAMPLE_CHARS),
    notFound: NOT_FOUND_RE.test(collapsed),
  };
}

/**
 * Summarise one run's invocations. Always returns a summary (empty for no or
 * malformed invocations): "recorded, no tools" must differ from "no stats row",
 * which coverage and the backfill key on.
 */
export function summarizeRun(invocations: unknown, answerText: string | null | undefined): RunToolSummary {
  if (!Array.isArray(invocations) || invocations.length === 0) return { stats: [], totals: { calls: 0, errors: 0 }, errors: [] };

  const citedIds = extractCitedToolCallIds(answerText);
  const byTool = new Map<string, ToolStat>();
  const errors: ToolErrorRow[] = [];
  const seenArgs = new Map<string, Set<string>>();
  const errorPositions = new Map<string, number[]>();
  const successPositions = new Map<string, number[]>();

  let pos = 0;
  for (const raw of invocations) {
    pos += 1;
    if (!raw || typeof raw !== "object" || isSyntheticInvocation(raw)) continue;
    const inv = raw as RawInvocation;
    const tool = typeof inv.toolName === "string" && inv.toolName !== "" ? inv.toolName : null;
    if (!tool) continue;

    const result = typeof inv.result === "string" ? inv.result : "";

    let stat = byTool.get(tool);
    if (!stat) {
      stat = {
        t: tool, c: 0, tl: 0, e: 0, d: 0, z: 0, ce: 0, ci: 0,
        ms: 0, mx: 0, b: 0, dup: 0, rec: 0, nf: 0,
        h: new Array<number>(HISTOGRAM_SLOTS).fill(0),
      };
      byTool.set(tool, stat);
    }

    stat.c += 1;
    if (inv.parentToolCallId === undefined || inv.parentToolCallId === null) stat.tl += 1;
    if (isDroppedEnd(inv, result)) {
      stat.d += 1;
      continue; // excluded from every latency/size/behaviour aggregate below
    }

    const isError = inv.isError === true;
    if (isError) {
      stat.e += 1;
      const norm = normalizeError(result);
      if (norm.notFound) stat.nf += 1;
      errors.push({ tool, pos, ...norm });
    }
    const positions = isError ? errorPositions : successPositions;
    positions.set(tool, [...(positions.get(tool) ?? []), pos]);

    if (result === "") stat.z += 1;
    stat.b += result.length;

    if (CLF_TOKEN_RE.test(result)) {
      stat.ce += 1;
      if (typeof inv.toolCallId === "string" && citedIds.has(inv.toolCallId)) stat.ci += 1;
    }

    // Rounded: the read side casts the sums with `::bigint`, and one fractional value would abort every query over the window.
    if (typeof inv.durationMs === "number" && Number.isFinite(inv.durationMs) && inv.durationMs >= 0) {
      const ms = Math.round(inv.durationMs);
      stat.ms += ms;
      if (ms > stat.mx) stat.mx = ms;
      stat.h[bucketIndex(ms)]! += 1;
    }

    const key = argsKey(inv.args);
    let seen = seenArgs.get(tool);
    if (!seen) { seen = new Set(); seenArgs.set(tool, seen); }
    if (seen.has(key)) stat.dup += 1;
    else seen.add(key);
  }

  // An errored call is recovered when the same tool later succeeds in the same run.
  for (const [tool, errs] of errorPositions) {
    const successes = successPositions.get(tool);
    const stat = byTool.get(tool);
    if (!successes || !stat) continue;
    const lastSuccess = successes[successes.length - 1]!;
    stat.rec = errs.filter((e) => e < lastSuccess).length;
  }

  const stats = [...byTool.values()];
  return {
    stats,
    totals: {
      calls: stats.reduce((n, s) => n + s.c, 0),
      errors: stats.reduce((n, s) => n + s.e, 0),
    },
    errors,
  };
}

/**
 * Estimate a percentile from summed duration histograms like Prometheus'
 * histogram_quantile: linear interpolation inside the bucket holding the rank,
 * bucket 0 starting at 0 ms. A rank in the overflow bucket has no upper edge,
 * so it is `{ ms: null, overflow: true }`.
 */
export function percentileFromBuckets(buckets: number[], p: number): { ms: number | null; overflow: boolean } {
  const counts = buckets.map((b) => (Number.isFinite(b) && b > 0 ? b : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return { ms: null, overflow: false };
  const rank = total * Math.min(Math.max(p, 0), 1);
  let below = 0;
  for (let i = 0; i < counts.length; i++) {
    const inBucket = counts[i]!;
    if (inBucket === 0) continue;
    if (below + inBucket >= rank) {
      if (i >= DURATION_BUCKETS_MS.length) return { ms: null, overflow: true };
      const lower = i === 0 ? 0 : DURATION_BUCKETS_MS[i - 1]!;
      const upper = DURATION_BUCKETS_MS[i]!;
      return { ms: Math.round(lower + ((upper - lower) * (rank - below)) / inBucket), overflow: false };
    }
    below += inBucket;
  }
  return { ms: null, overflow: true };
}

export interface RunStatsTarget {
  id: string;
  orgId: string;
  userId: string;
  agentSlug: string;
  completedAt: Date;
  error?: string | null;
}

export interface RunStatsItem {
  run: RunStatsTarget;
  summary: RunToolSummary;
  /** Per-call model series; undefined keeps whatever the row holds, so a backfill never erases it. */
  llmCalls?: unknown[] | undefined;
  /** The run's toolsUsed; merged with the tools its invocations called into `toolNames`. */
  toolsUsed?: readonly string[] | null | undefined;
  /** Citation-reflection outcome; undefined or null keeps whatever the row holds. */
  citationOutcome?: string | null | undefined;
}

/** Tools the run called plus its toolsUsed list; neither alone is complete. */
export function runToolNames(summary: RunToolSummary, toolsUsed: readonly string[] | null | undefined): string[] {
  const names = new Set(summary.stats.map((t) => t.t));
  for (const t of toolsUsed ?? []) if (typeof t === "string" && t !== "") names.add(t);
  return [...names].sort();
}

interface ToolErrorClass {
  class: string;
  count: number;
  /** The first sample of this class in the run. */
  sample: string;
  notFound: boolean;
}

/** A run's errored calls per tool, grouped by failure class in the order the run first hit each. */
export function errorClassesByTool(errors: readonly ToolErrorRow[]): Map<string, ToolErrorClass[]> {
  const byTool = new Map<string, Map<string, ToolErrorClass>>();
  for (const e of [...errors].sort((a, b) => a.pos - b.pos)) {
    let classes = byTool.get(e.tool);
    if (!classes) { classes = new Map(); byTool.set(e.tool, classes); }
    const hit = classes.get(e.errorClass);
    if (hit) {
      hit.count += 1;
      hit.notFound ||= e.notFound;
    } else {
      classes.set(e.errorClass, { class: e.errorClass, count: 1, sample: e.sample, notFound: e.notFound });
    }
  }
  return new Map([...byTool].map(([tool, classes]) => [tool, [...classes.values()]]));
}

interface ToolStatRow {
  runId: string; tool: string; orgId: string; userId: string; agentSlug: string; completedAt: string;
  calls: number; topLevelCalls: number; errors: number; recovered: number; notFound: number; dropped: number;
  duplicates: number; empty: number; citeable: number; cited: number; totalMs: number; maxMs: number; resultBytes: number;
  durationBuckets: number[];
  errorClasses: ToolErrorClass[] | null;
}

const MAX_TOOL_NAME = 200;
const INT4_MAX = 2_147_483_647;
/** Counters are int4 columns: clamped, so one absurd value can never fail the write. */
const int4 = (n: number): number => (Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), INT4_MAX) : 0);

/** The run's per-tool rows: plain columns from its summary, errors folded in by class. */
export function toolStatRows({ run, summary }: Pick<RunStatsItem, "run" | "summary">): ToolStatRow[] {
  const classes = errorClassesByTool(summary.errors);
  const completedAt = run.completedAt.toISOString();
  return summary.stats.map((s) => ({
    runId: run.id,
    tool: s.t.slice(0, MAX_TOOL_NAME),
    orgId: run.orgId,
    userId: run.userId,
    agentSlug: run.agentSlug,
    completedAt,
    calls: int4(s.c),
    topLevelCalls: int4(s.tl),
    errors: int4(s.e),
    recovered: int4(s.rec),
    notFound: int4(s.nf),
    dropped: int4(s.d),
    duplicates: int4(s.dup),
    empty: int4(s.z),
    citeable: int4(s.ce),
    cited: int4(s.ci),
    totalMs: int4(s.ms),
    maxMs: int4(s.mx),
    resultBytes: int4(s.b),
    durationBuckets: s.h.map(int4),
    errorClasses: classes.get(s.t) ?? null,
  }));
}

/**
 * Writes runs' `agent_run_stats` rows and their `agent_run_tool_stats` rows
 * inside the caller's transaction (finalize: one run; backfill: a batch).
 * Idempotent, and never goes backwards: the run row, and with it the tool rows,
 * only change when completedAt is not older than the stored one, since
 * finalizes of one session can land out of order. Orphan-closed runs keep no
 * rows: every metric excludes them.
 */
export async function persistRunStats(
  tx: Prisma.TransactionClient,
  items: readonly RunStatsItem[],
): Promise<{ statsRows: number; toolRows: number; errorCalls: number }> {
  const none = { statsRows: 0, toolRows: 0, errorCalls: 0 };
  if (items.length === 0) return none;
  const live = items.filter((i) => i.run.error !== ORPHAN_MARKER);
  const orphanIds = items.filter((i) => i.run.error === ORPHAN_MARKER).map((i) => i.run.id);

  // The tool rows go with the run row (foreign key, ON DELETE CASCADE).
  if (orphanIds.length > 0) {
    await tx.$executeRaw`DELETE FROM "agent_run_stats" WHERE "runId" = ANY(${orphanIds}::text[])`;
  }
  if (live.length === 0) return none;

  // completedAt travels as ISO text, converted to UTC wall time like Prisma's timestamp(3) columns.
  const applied = await tx.$queryRaw<Array<{ runId: string }>>`
    INSERT INTO "agent_run_stats"
      ("runId", "orgId", "userId", "agentSlug", "completedAt", "toolCalls", "toolErrors", "toolNames", "llmCallCount", "llmCalls", "citationOutcome")
    SELECT v.id, v.org, v.usr, v.agent, (v.done::timestamptz AT TIME ZONE 'UTC')::timestamp(3), v.c, v.e,
           ARRAY(SELECT jsonb_array_elements_text(v.n::jsonb)),
           CASE WHEN v.l IS NULL THEN NULL ELSE jsonb_array_length(v.l::jsonb) END, v.l::jsonb, v.co
    FROM unnest(
      ${live.map((i) => i.run.id)}::text[],
      ${live.map((i) => i.run.orgId)}::text[],
      ${live.map((i) => i.run.userId)}::text[],
      ${live.map((i) => i.run.agentSlug)}::text[],
      ${live.map((i) => i.run.completedAt.toISOString())}::text[],
      ${live.map((i) => int4(i.summary.totals.calls))}::int[],
      ${live.map((i) => int4(i.summary.totals.errors))}::int[],
      ${live.map((i) => JSON.stringify(runToolNames(i.summary, i.toolsUsed).map((n) => n.slice(0, MAX_TOOL_NAME))))}::text[],
      ${live.map((i) => (Array.isArray(i.llmCalls) ? JSON.stringify(i.llmCalls) : null))}::text[],
      ${live.map((i) => (typeof i.citationOutcome === "string" && i.citationOutcome !== "" ? i.citationOutcome : null))}::text[]
    ) AS v(id, org, usr, agent, done, c, e, n, l, co)
    ON CONFLICT ("runId") DO UPDATE SET
      "completedAt"     = EXCLUDED."completedAt",
      "toolCalls"       = EXCLUDED."toolCalls",
      "toolErrors"      = EXCLUDED."toolErrors",
      "toolNames"       = EXCLUDED."toolNames",
      "llmCallCount"    = COALESCE(EXCLUDED."llmCallCount", "agent_run_stats"."llmCallCount"),
      "llmCalls"        = COALESCE(EXCLUDED."llmCalls", "agent_run_stats"."llmCalls"),
      "citationOutcome" = COALESCE(EXCLUDED."citationOutcome", "agent_run_stats"."citationOutcome")
    WHERE "agent_run_stats"."completedAt" <= EXCLUDED."completedAt"
    RETURNING "runId"
  `;
  if (applied.length === 0) return none;
  const ids = new Set(applied.map((r) => r.runId));
  const written = live.filter((i) => ids.has(i.run.id));
  await tx.$executeRaw`DELETE FROM "agent_run_tool_stats" WHERE "runId" = ANY(${[...ids]}::text[])`;

  const rows = written.flatMap(toolStatRows);
  if (rows.length > 0) {
    await tx.$executeRaw`
      INSERT INTO "agent_run_tool_stats"
        ("runId", "tool", "orgId", "userId", "agentSlug", "completedAt", "calls", "topLevelCalls", "errors", "recovered",
         "notFound", "dropped", "duplicates", "empty", "citeable", "cited", "totalMs", "maxMs", "resultBytes",
         "durationBuckets", "errorClasses")
      SELECT t."runId", t."tool", t."orgId", t."userId", t."agentSlug",
             (t."completedAt"::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
             t."calls", t."topLevelCalls", t."errors", t."recovered", t."notFound", t."dropped", t."duplicates",
             t."empty", t."citeable", t."cited", t."totalMs", t."maxMs", t."resultBytes",
             ARRAY(SELECT b.n::int FROM jsonb_array_elements_text(t."durationBuckets") WITH ORDINALITY AS b(n, i) ORDER BY b.i),
             t."errorClasses"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
        "runId" text, "tool" text, "orgId" text, "userId" text, "agentSlug" text, "completedAt" text,
        "calls" int, "topLevelCalls" int, "errors" int, "recovered" int, "notFound" int, "dropped" int,
        "duplicates" int, "empty" int, "citeable" int, "cited" int, "totalMs" int, "maxMs" int, "resultBytes" int,
        "durationBuckets" jsonb, "errorClasses" jsonb)
    `;
  }
  return { statsRows: ids.size, toolRows: rows.length, errorCalls: written.reduce((n, i) => n + i.summary.errors.length, 0) };
}
