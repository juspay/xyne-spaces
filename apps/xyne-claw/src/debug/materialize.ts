/**
 * v2 → v1 materialization.
 *
 * The write path is append-only and de-duplicated (blob refs, transcript
 * deltas, one `llm_request` per model call). Every existing reader — DebugDrawer,
 * the dashboard trace panel, the debug HTML exporter, the webhook `/debug`
 * command — still expects the old fully-inlined `DebugSessionSnapshot`. This
 * module rebuilds that shape on read so the rewrite is invisible to all of them.
 *
 * Three things here are compatibility, not design:
 *
 * - `llm_request` is FOLDED into the turn's `session_prompt`. The drawer has one
 *   "prompt" row per turn and no concept of a separate request event; folding is
 *   what makes the true effective system prompt (the one with `<available_skills>`
 *   appended by pi) appear where the UI already looks for it. The pairing is by
 *   SEQ ADJACENCY, not by `llmCall` — see `foldModelCalls`.
 * - Per-event `messages` are RE-INLINED from the replayed transcript, because the
 *   drawer renders a transcript panel per event. The v2 writer stores an index
 *   range instead of a copy — that is the fix for the O(turns²) traces — so the
 *   copy has to come back here, sliced to the range (or, failing that, to the
 *   transcript as it stood at that event's seq) so a turn shows ITS transcript.
 * - Re-inlining is budgeted. A 400-turn run would otherwise materialize into
 *   hundreds of megabytes of duplicated transcript; over budget we blank the
 *   OLDEST embeds first and say so in `warnings`, so a huge trace degrades
 *   instead of taking the process down.
 *
 * Everything this module cannot reconstruct faithfully becomes a `warning` on
 * the snapshot rather than a silent repair: a transcript with a visible hole is
 * recoverable, one that was quietly spliced is not.
 */

import type { Citation } from "xyne-claw-shared";
import type { BlobIndex, BlobLine } from "./blobs.js";
import type { ReadRun } from "./store.js";
import type {
  BlobRef,
  DebugEventRecord,
  DebugEventV2,
  DebugSessionSnapshot,
  RunHeader,
  ToolInvocation,
} from "./types.js";
import { isBlobRef } from "./types.js";

/** Total bytes of re-inlined per-event transcript we are willing to produce. */
const DEFAULT_MAX_INLINE_BYTES = 8_000_000;

/** Collects non-fatal read problems; deduped because one bad blob is referenced
 *  by every event that carries its hash. */
type Warn = (message: string) => void;

function warningSink(): { warn: Warn; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  return {
    warnings,
    warn: (message) => {
      if (seen.has(message)) return;
      seen.add(message);
      warnings.push(message);
    },
  };
}

/**
 * Blob fields whose content is the value itself, not a JSON encoding of it.
 *
 * `serializeForBlob` passes strings through unchanged, so a stored `result` of
 * `{"content":[...]}` is an MCP envelope STRING, not an object. Parsing it back
 * would silently change the type the UI (and the exporter's `JSON.parse` guards)
 * has always seen. Anything not listed here was structured on the way in and is
 * parsed back to structure.
 */
const STRING_BLOB_FIELDS = new Set([
  "assistantText",
  "context",
  "detail",
  "error",
  "errorMessage",
  "lastAssistantText",
  "message",
  "prompt",
  "question",
  "result",
  "summary",
  "systemPrompt",
  "task",
  "text",
]);

/**
 * Fields lifted from `llm_request` onto the turn's `session_prompt`.
 *
 * `messagesFrom`/`messagesTo` are in here because the request is the ONLY event
 * that carries the transcript range for its model call; without them the prompt
 * row has no range and its panel falls back to the whole transcript.
 */
const FOLD_REQUEST_FIELDS = [
  "systemPrompt",
  "tools",
  "toolNames",
  "availableSkills",
  "model",
  "provider",
  "temperature",
  "maxTokens",
  "thinkingLevel",
  "fastMode",
  "paletteAdded",
  "paletteRemoved",
  "messagesFrom",
  "messagesTo",
] as const;

/**
 * Folded fields that are usually IDENTICAL on every call of a run: the system
 * prompt, the tool catalog, the parsed skill list.
 *
 * On disk they cost one copy each (content addressing). Re-inlining them into
 * every `session_prompt` would hand that duplication straight back on the wire —
 * a 4-turn run measured 49% redundant bytes, and it scales with turn count. So
 * the first occurrence carries the payload and later identical ones carry
 * `<field>UnchangedFromSeq` instead. Consumers rehydrate by walking back to that
 * seq (DebugDrawer does it in `compactTimeline`, the HTML exporter in its own
 * pre-pass), so nothing is lost — a turn that genuinely CHANGES one of these
 * (mid-run `load-tools`, a provider fallback with a different prompt) still
 * carries the new value in full, which is exactly when you need to see it.
 */
const DEDUPED_FOLD_FIELDS = ["systemPrompt", "tools", "toolNames", "availableSkills"] as const;

export const UNCHANGED_FROM_SUFFIX = "UnchangedFromSeq";

function dedupeRepeatedPayloads(events: readonly DebugEventRecord[]): void {
  // Serialized value of each field as last EMITTED, with the seq that carries it.
  const last = new Map<string, { seq: number; json: string }>();
  for (const record of events) {
    for (const field of DEDUPED_FOLD_FIELDS) {
      const value = record.data[field];
      if (value === undefined) continue;
      const json = JSON.stringify(value);
      if (json === undefined) continue;
      const prev = last.get(field);
      if (prev && prev.json === json) {
        delete record.data[field];
        record.data[`${field}${UNCHANGED_FROM_SUFFIX}`] = prev.seq;
      } else {
        last.set(field, { seq: record.seq, json });
      }
    }
  }
}

/** Events whose `data.messages` the drawer renders as a transcript panel. */
const TRANSCRIPT_EMBED_KINDS = new Set(["session_prompt", "assistant_turn_end"]);

// ── primitives ──────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asStatus(v: unknown): "running" | "completed" | undefined {
  return v === "running" || v === "completed" ? v : undefined;
}

function asBackgroundState(v: unknown): "running" | "completed" | "error" | undefined {
  return v === "running" || v === "completed" || v === "error" ? v : undefined;
}

function bySeq(a: DebugEventV2, b: DebugEventV2): number {
  return a.seq - b.seq;
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

function decodeBlobField(field: string, raw: string, ref: BlobRef, warn?: Warn): unknown {
  if (STRING_BLOB_FIELDS.has(field)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    // Content that isn't JSON was a string all along (an unregistered field), or
    // the blob was cut mid-value. The raw text is still the best we have, but a
    // structured field arriving as a string changes what the UI renders, so say
    // so rather than letting the panel look merely odd.
    warn?.(
      ref.truncated === true
        ? `field "${field}" (blob ${ref.hash}) was truncated at ${ref.bytes} of ${ref.originalBytes ?? ref.bytes} bytes and no longer parses as JSON; the raw text is shown instead`
        : `field "${field}" (blob ${ref.hash}) could not be parsed back to JSON; the raw text is shown instead`,
    );
    return raw;
  }
}

/**
 * Replace every `<field>Ref` with the resolved `<field>`.
 *
 * A ref whose content is absent (capture level `metadata`, or a blob log that
 * lost its tail) is LEFT IN PLACE rather than dropped: the hash and byte count
 * still tell the reader something existed and how big it was.
 *
 * A ref that was TRUNCATED on the way in leaves `<field>Truncated` and
 * `<field>OriginalBytes` behind it. Without them the UI shows a cut payload as
 * if it were the whole thing, which is the one way a trace can actively mislead.
 */
function resolveData(
  data: Record<string, unknown>,
  blobs: BlobIndex,
  warn?: Warn,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const refs: Array<[string, BlobRef]> = [];
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith("Ref") && isBlobRef(v)) {
      refs.push([k, v]);
      continue;
    }
    out[k] = v;
  }
  for (const [k, refValue] of refs) {
    const field = k.slice(0, -"Ref".length);
    const raw = blobs.get(refValue.hash);
    if (raw === undefined) {
      out[k] = refValue;
      continue;
    }
    out[field] = decodeBlobField(field, raw, refValue, warn);
    if (refValue.truncated === true) {
      out[`${field}Truncated`] = true;
      if (refValue.originalBytes !== undefined) {
        out[`${field}OriginalBytes`] = refValue.originalBytes;
      }
    }
  }
  return out;
}

// ── transcript replay ───────────────────────────────────────────────────────

function readDelta(data: Record<string, unknown>, blobs: BlobIndex): unknown[] | undefined {
  const inline = data.messages;
  if (Array.isArray(inline)) return inline;
  const ref = data.messagesRef;
  if (!isBlobRef(ref)) return undefined;
  const raw = blobs.get(ref.hash);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface Transcript {
  messages: unknown[];
  /** Transcript length after each `message_append`, in seq order. Lets an event
   *  that carries no range be sliced to the transcript as it stood back then. */
  checkpoints: Array<{ seq: number; length: number }>;
  warnings: string[];
}

/** `12..18` for a delta we could not apply; `12..?` when the writer's own
 *  bookkeeping is missing too. */
function missingRange(from: number, to: number | undefined): string {
  return `${from}..${to ?? "?"}`;
}

/**
 * Rebuild the full transcript from the `message_append` deltas.
 *
 * `reset: true` means compaction rewrote the list rather than extending it, so
 * the delta REPLACES what came before. A delta whose `from` lands inside the
 * accumulator truncates to that point first — mid-turn rewrites are otherwise
 * appended twice.
 *
 * Deltas are concatenated, so anything we cannot apply — an unreadable blob, a
 * `from` past the end of what we have — leaves a HOLE at a position the reader
 * cannot see. Every such gap is reported; a spliced transcript that claims to be
 * complete is worse than a short one that admits it.
 */
function replayTranscript(run: ReadRun): Transcript {
  const acc: unknown[] = [];
  const checkpoints: Array<{ seq: number; length: number }> = [];
  const { warn, warnings } = warningSink();
  const appends = run.events.filter((e) => e.kind === "message_append").sort(bySeq);

  for (const e of appends) {
    const data = e.data ?? {};
    const delta = readDelta(data, run.blobs);
    const declaredFrom = asNumber(data.from);
    const declaredTo = asNumber(data.to);
    if (!delta) {
      warn(
        `transcript incomplete: dropped delta at seq ${e.seq} (messages ${missingRange(declaredFrom ?? acc.length, declaredTo)} missing)`,
      );
      checkpoints.push({ seq: e.seq, length: acc.length });
      continue;
    }
    if (data.reset === true) {
      acc.length = 0;
      acc.push(...delta);
      checkpoints.push({ seq: e.seq, length: acc.length });
      continue;
    }
    if (declaredFrom !== undefined && declaredFrom >= 0 && declaredFrom < acc.length) {
      acc.length = declaredFrom;
    } else if (declaredFrom !== undefined && declaredFrom > acc.length) {
      // An earlier delta went missing: appending here silently renumbers every
      // message after the gap, so name the range that is absent.
      warn(
        `transcript incomplete: delta at seq ${e.seq} starts at message ${declaredFrom} but only ${acc.length} are known (messages ${missingRange(acc.length, declaredFrom)} missing)`,
      );
    }
    acc.push(...delta);
    checkpoints.push({ seq: e.seq, length: acc.length });
  }

  return { messages: acc, checkpoints, warnings };
}

export function replayMessages(run: ReadRun): unknown[] {
  return replayTranscript(run).messages;
}

/**
 * Transcript length as of a given seq. Returns a cursor rather than a lookup
 * because it walks the checkpoints once: callers MUST query in ascending seq
 * order (the materializer iterates a seq-sorted list).
 */
function lengthAsOfCursor(t: Transcript): (seq: number) => number {
  let i = 0;
  let length = 0;
  return (seq: number): number => {
    while (i < t.checkpoints.length) {
      const c = t.checkpoints[i];
      if (c === undefined || c.seq > seq) break;
      length = c.length;
      i += 1;
    }
    return length;
  };
}

// ── tool invocations ────────────────────────────────────────────────────────

function resultToString(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
}

/**
 * Rebuild `ToolInvocation[]` from the start/end/update event trio.
 *
 * The three kinds are a state machine per `toolCallId`: start writes a `running`
 * row so an in-flight trace shows the call, end replaces it with the completed
 * one, and update patches it afterwards — that last one is how a background
 * subagent flips from `running` to `completed` long after its tool call
 * returned.
 */
export function deriveToolInvocations(run: ReadRun): ToolInvocation[] {
  const rows = new Map<string, ToolInvocation>();
  const ordered = [...run.events].sort(bySeq);

  /** End events predate stable ids in old traces; fall back to the newest
   *  still-running row for the same tool name. */
  const runningKeyFor = (toolName: string | undefined): string | undefined => {
    if (!toolName) return undefined;
    let found: string | undefined;
    for (const [key, row] of rows) {
      if (row.toolName === toolName && row.status === "running") found = key;
    }
    return found;
  };

  for (const e of ordered) {
    if (e.kind === "tool_execution_start") {
      const d = resolveData(e.data ?? {}, run.blobs);
      const key = e.toolCallId ?? `seq:${e.seq}`;
      rows.set(key, {
        toolName: asString(d.toolName) ?? "unknown",
        args: d.args,
        result: "",
        isError: false,
        startedAt: e.at,
        durationMs: 0,
        status: "running",
        ...(e.toolCallId !== undefined ? { toolCallId: e.toolCallId } : {}),
        ...(e.parentToolCallId !== undefined ? { parentToolCallId: e.parentToolCallId } : {}),
        ...(e.subagentName !== undefined ? { subagentName: e.subagentName } : {}),
      });
      continue;
    }

    if (e.kind === "tool_execution_end") {
      const d = resolveData(e.data ?? {}, run.blobs);
      const toolName = asString(d.toolName);
      const key = e.toolCallId ?? runningKeyFor(toolName) ?? `seq:${e.seq}`;
      const prev = rows.get(key);
      const citations = Array.isArray(d.citations) ? (d.citations as Citation[]) : undefined;
      const debug =
        typeof d.debug === "object" && d.debug !== null && !Array.isArray(d.debug)
          ? (d.debug as Record<string, unknown>)
          : undefined;
      const toolCallId = e.toolCallId ?? prev?.toolCallId;
      const parentToolCallId = e.parentToolCallId ?? prev?.parentToolCallId;
      const subagentName = e.subagentName ?? prev?.subagentName;
      const backgroundState = asBackgroundState(d.backgroundState);
      const backgroundTaskId = asString(d.backgroundTaskId);

      rows.set(key, {
        toolName: toolName ?? prev?.toolName ?? "unknown",
        args: d.args !== undefined ? d.args : prev?.args,
        result: resultToString(d.result) ?? "",
        isError: d.isError === true,
        startedAt: prev?.startedAt ?? e.at,
        durationMs: asNumber(d.durationMs) ?? prev?.durationMs ?? 0,
        status: asStatus(d.status) ?? "completed",
        ...(toolCallId !== undefined ? { toolCallId } : {}),
        ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
        ...(subagentName !== undefined ? { subagentName } : {}),
        ...(citations !== undefined ? { citations } : {}),
        ...(debug !== undefined ? { debug } : {}),
        ...(typeof d.background === "boolean" ? { background: d.background } : {}),
        ...(backgroundState !== undefined ? { backgroundState } : {}),
        ...(backgroundTaskId !== undefined ? { backgroundTaskId } : {}),
      });
      continue;
    }

    if (e.kind === "tool_invocation_update") {
      const d = resolveData(e.data ?? {}, run.blobs);
      const key = asString(d.toolCallId) ?? e.toolCallId;
      const row = key ? rows.get(key) : undefined;
      // A patch for a call we never saw start has nothing to attach to; the
      // start/end pair is the record of the call, so dropping it loses nothing.
      if (!row) continue;
      const status = asStatus(d.status);
      if (status !== undefined) row.status = status;
      if (typeof d.background === "boolean") row.background = d.background;
      const backgroundState = asBackgroundState(d.backgroundState);
      if (backgroundState !== undefined) row.backgroundState = backgroundState;
      const backgroundTaskId = asString(d.backgroundTaskId);
      if (backgroundTaskId !== undefined) row.backgroundTaskId = backgroundTaskId;
      const durationMs = asNumber(d.durationMs);
      if (durationMs !== undefined) row.durationMs = durationMs;
      const result = resultToString(d.result);
      if (result !== undefined) row.result = result;
    }
  }

  return [...rows.values()];
}

// ── events ──────────────────────────────────────────────────────────────────

function baseRecord(e: DebugEventV2, blobs: BlobIndex, warn: Warn): DebugEventRecord {
  return {
    seq: e.seq,
    at: e.at,
    kind: e.kind,
    ...(e.turn !== undefined ? { turn: e.turn } : {}),
    ...(e.llmCall !== undefined ? { llmCall: e.llmCall } : {}),
    ...(e.toolCallId !== undefined ? { toolCallId: e.toolCallId } : {}),
    ...(e.parentToolCallId !== undefined ? { parentToolCallId: e.parentToolCallId } : {}),
    ...(e.subagentName !== undefined ? { subagentName: e.subagentName } : {}),
    ...(e.childRunId !== undefined ? { childRunId: e.childRunId } : {}),
    data: resolveData(e.data ?? {}, blobs, warn),
  };
}

function foldRequest(target: DebugEventRecord, request: DebugEventRecord): void {
  for (const field of FOLD_REQUEST_FIELDS) {
    const v = request.data[field];
    if (v !== undefined) target.data[field] = v;
  }
}

function foldResponse(target: DebugEventRecord, response: DebugEventRecord): void {
  if (response.data.usage !== undefined) target.data.responseUsage = response.data.usage;
  if (response.data.stopReason !== undefined) {
    target.data.responseStopReason = response.data.stopReason;
  }
  if (response.data.ttftMs !== undefined) target.data.ttftMs = response.data.ttftMs;
}

/**
 * Attach each model call's request/response to the prompt row it belongs to.
 *
 * The pairing key is SEQ, not `llmCall`. There are two independent counters:
 * agent.ts bumps its own on pi's `turn_start`, the stream hook bumps its own on
 * every `streamFn` invocation. Any call without a matching turn_start — a
 * retry, a compaction call, a provider fallback — drifts them apart, and from
 * then on an `llmCall`-keyed fold staples one turn's system prompt and tool list
 * onto a different turn's panel. Seq is the single ordering both writers share,
 * and adjacency in it is what "same model call" actually means.
 *
 * Both emission orders are tolerated. Pi emits `turn_start` before calling
 * `streamFn`, so the prompt row normally comes first; a request that arrives
 * first (a hook that runs ahead, a re-ordered log) is held and claimed by the
 * prompt that follows it, unless its own response lands in between — that
 * request's call is over and cannot belong to a turn that has not started.
 *
 * `llmCall` equality is only the fallback, for a request the seq pass could not
 * place at all.
 *
 * Returns the request records that were folded away (the caller drops them from
 * the timeline; their content now lives on the prompt row).
 */
function foldModelCalls(records: DebugEventRecord[]): Set<DebugEventRecord> {
  const foldedRequests = new Set<DebugEventRecord>();
  const promptsWithRequest = new Set<DebugEventRecord>();
  const foldedResponses = new Set<DebugEventRecord>();
  /** Where each model call's request landed — `undefined` when that request had
   *  no prompt row to fold into. Request and response DO share one counter (the
   *  stream hook stamps both), so this pairing cannot drift. */
  const requestTargets = new Map<number, DebugEventRecord | undefined>();

  let openPrompt: DebugEventRecord | undefined;
  let unclaimedRequest: DebugEventRecord | undefined;

  for (const r of records) {
    if (r.kind === "session_prompt") {
      if (unclaimedRequest) {
        foldRequest(r, unclaimedRequest);
        foldedRequests.add(unclaimedRequest);
        promptsWithRequest.add(r);
        if (unclaimedRequest.llmCall !== undefined) requestTargets.set(unclaimedRequest.llmCall, r);
        unclaimedRequest = undefined;
      }
      openPrompt = r;
      continue;
    }
    if (r.kind === "llm_request") {
      if (openPrompt && !promptsWithRequest.has(openPrompt)) {
        foldRequest(openPrompt, r);
        foldedRequests.add(r);
        promptsWithRequest.add(openPrompt);
        if (r.llmCall !== undefined) requestTargets.set(r.llmCall, openPrompt);
      } else {
        // A second call within one turn (retry, compaction). It has no prompt
        // row of its own yet; the next one may still claim it.
        unclaimedRequest = r;
        if (r.llmCall !== undefined) requestTargets.set(r.llmCall, undefined);
      }
      continue;
    }
    if (r.kind === "llm_response") {
      const call = r.llmCall;
      if (call !== undefined && requestTargets.has(call)) {
        // Follow the request: a response to a call that never had a prompt row
        // must not be pinned onto the prompt that happens to be open.
        const target = requestTargets.get(call);
        if (target) {
          foldResponse(target, r);
          foldedResponses.add(r);
        }
      } else if (openPrompt) {
        foldResponse(openPrompt, r);
        foldedResponses.add(r);
      }
      // The call this response closes is over, so a request still waiting for a
      // home cannot belong to a turn that has not started yet.
      unclaimedRequest = undefined;
      continue;
    }
  }

  // Fallback: a request/response the seq pass never placed still carries its
  // writer-stamped llmCall, which is right whenever the counters happen not to
  // have drifted.
  const freePromptByCall = new Map<number, DebugEventRecord>();
  for (const r of records) {
    if (r.kind !== "session_prompt" || r.llmCall === undefined) continue;
    if (promptsWithRequest.has(r)) continue;
    if (!freePromptByCall.has(r.llmCall)) freePromptByCall.set(r.llmCall, r);
  }
  for (const r of records) {
    if (r.llmCall === undefined) continue;
    const target = freePromptByCall.get(r.llmCall);
    if (!target) continue;
    if (r.kind === "llm_request" && !foldedRequests.has(r)) {
      foldRequest(target, r);
      foldedRequests.add(r);
      promptsWithRequest.add(target);
      freePromptByCall.delete(r.llmCall);
    } else if (r.kind === "llm_response" && !foldedResponses.has(r)) {
      foldResponse(target, r);
      foldedResponses.add(r);
    }
  }

  return foldedRequests;
}

interface BuiltEvents {
  events: DebugEventRecord[];
  warnings: string[];
  transcript: Transcript;
}

function buildV1Events(run: ReadRun): BuiltEvents {
  const { warn, warnings } = warningSink();

  const records = [...run.events]
    .sort(bySeq)
    // Bookkeeping for the transcript log, not a timeline row — the drawer would
    // render one grey "message_append" line per turn for no information.
    .filter((e) => e.kind !== "message_append")
    .map((e) => baseRecord(e, run.blobs, warn));

  const foldedRequests = foldModelCalls(records);
  const events = records.filter((r) => !foldedRequests.has(r));
  dedupeRepeatedPayloads(events);

  // ── re-inline the per-event transcript panels ────────────────────────────
  const transcript = replayTranscript(run);
  for (const w of transcript.warnings) warn(w);
  const lengthAsOf = lengthAsOfCursor(transcript);

  // Each turn's transcript panel is a PREFIX of `snapshot.messages`, so stamping
  // the cursor is enough — the reader slices. Inlining the prefix instead put
  // the whole transcript-so-far on the wire twice per turn, which is O(turns^2)
  // and was 42% of a 4-turn bundle. `messagesTo` is what the panel needs and it
  // costs 12 bytes.
  for (const r of events) {
    if (!TRANSCRIPT_EMBED_KINDS.has(r.kind)) continue;
    // The event's own range wins. Without one (an `assistant_turn_end`, or a
    // prompt row whose request never made it), the transcript AS OF THIS EVENT
    // is the honest answer — showing turn 1 the messages of turn 40 is a lie.
    const to = asNumber(r.data.messagesTo) ?? lengthAsOf(r.seq);
    r.data.messagesTo = Math.max(0, Math.min(to, transcript.messages.length));
  }

  return { events, warnings, transcript };
}

export function toV1Events(run: ReadRun): DebugEventRecord[] {
  return buildV1Events(run).events;
}

// ── snapshot ────────────────────────────────────────────────────────────────

/**
 * The drawer reads the stream counters off the snapshot root, not off
 * `latency`. Mirrored rather than moved — both readers exist.
 */
interface SnapshotWithStreamMirror extends DebugSessionSnapshot {
  streamChars?: number;
  streamCharsPerSec?: number;
  streamTextChars?: number;
  streamThinkingChars?: number;
}

function copyHeaderIdentity(h: RunHeader): Partial<DebugSessionSnapshot> {
  return {
    ...(h.conversationId !== undefined ? { conversationId: h.conversationId } : {}),
    ...(h.sessionId !== undefined ? { sessionId: h.sessionId } : {}),
    ...(h.agentSlug !== undefined ? { agentSlug: h.agentSlug } : {}),
    ...(h.userId !== undefined ? { userId: h.userId } : {}),
    ...(h.userName !== undefined ? { userName: h.userName } : {}),
    ...(h.userEmail !== undefined ? { userEmail: h.userEmail } : {}),
    ...(h.provider !== undefined ? { provider: h.provider } : {}),
    ...(h.model !== undefined ? { model: h.model } : {}),
    ...(h.thinking !== undefined ? { thinking: h.thinking } : {}),
    ...(h.speed !== undefined ? { speed: h.speed } : {}),
    ...(h.context !== undefined ? { context: h.context } : {}),
    ...(h.systemPromptOverride !== undefined
      ? { systemPromptOverride: h.systemPromptOverride }
      : {}),
  };
}

export function toV1Snapshot(run: ReadRun): DebugSessionSnapshot {
  const h = run.header;
  // One build, one replay: the events and the snapshot's `messages` must be the
  // same transcript, and its warnings must reach the reader exactly once.
  const built = buildV1Events(run);
  const latency = h.latency;
  const warnings = [...run.warnings, ...built.warnings];

  const lastAssistantText =
    h.lastAssistantTextRef !== undefined
      ? (run.blobs.get(h.lastAssistantTextRef.hash) ?? "")
      : "";

  const snapshot: SnapshotWithStreamMirror = {
    schemaVersion: 1,
    ...copyHeaderIdentity(h),
    startedAt: h.startedAt,
    finishedAt: h.finishedAt,
    task: h.task,
    ...(h.status === "running" ? { inProgress: true } : {}),
    ...(h.status === "cancelled" || h.status === "error" || h.status === "crashed"
      ? { cancelled: true }
      : {}),
    messages: built.transcript.messages,
    toolInvocations: deriveToolInvocations(run),
    tokenUsage: h.tokenUsage,
    latency,
    lastAssistantText,
    events: built.events,
    ...(latency.streamChars !== undefined ? { streamChars: latency.streamChars } : {}),
    ...(latency.streamCharsPerSec !== undefined
      ? { streamCharsPerSec: latency.streamCharsPerSec }
      : {}),
    ...(latency.streamTextChars !== undefined
      ? { streamTextChars: latency.streamTextChars }
      : {}),
    ...(latency.streamThinkingChars !== undefined
      ? { streamThinkingChars: latency.streamThinkingChars }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  return snapshot;
}

// ── raw v2 passthrough ──────────────────────────────────────────────────────

/**
 * The un-materialized run, for readers that want the append-only form: header
 * and events verbatim plus a CONTENT-FREE blob index, so a caller can size a
 * payload (or decide to fetch it) without paying for it.
 */
export function toV2Run(run: ReadRun): {
  runId: string;
  header: RunHeader;
  events: DebugEventV2[];
  blobIndex: Array<Omit<BlobLine, "content">>;
} {
  const blobIndex: Array<Omit<BlobLine, "content">> = [];
  for (const hash of run.blobs.hashes) {
    const meta = run.blobs.meta(hash);
    if (meta) blobIndex.push(meta);
  }
  return { runId: run.header.runId, header: run.header, events: run.events, blobIndex };
}
