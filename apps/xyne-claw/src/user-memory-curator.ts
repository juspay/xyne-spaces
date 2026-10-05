/**
 * User-Memory Curator — runs on claw, fed by claw-auth via
 * POST /internal/user-memory/distill.
 *
 * Distills a batch of a single user's authored Spaces records (messages /
 * hosted calls / authored canvases) into candidate facts about that user,
 * tagged into one of the fixed subsystems (see USER_MEMORY_SUBSYSTEMS).
 *
 * Difference from the session curator (curator.ts):
 *   - Input is THIS user's records, not an agent's transcript.
 *   - Output is FACTS ABOUT the user, not subsystem-memory updates.
 *   - Taxonomy is fixed (see USER_MEMORY_SUBSYSTEMS) and the
 *     curator MUST pick one, never invent.
 *   - Returns 0..N candidates per call; expectation is most batches emit
 *     a handful of high-signal facts, not one per record.
 *
 * Same forced-tool-call pattern as the session curator for guaranteed-valid
 * JSON output across providers.
 *
 * Failures (LLM timeout, bad JSON, missing env) → return []. The caller
 * skips the batch and logs; no batch fails the whole pipeline.
 */

import {
  isUserMemorySubsystem,
  type ExistingUserMemory,
  type UserMemoryCandidatePayload,
  type UserMemoryCuratorEmittedCandidate,
  type UserMemoryCuratorTrace,
  type UserMemoryRecord,
} from "xyne-claw-shared";

import { postChatCompletion, tokenUsage, type ChatCompletionResponse } from "./litellm-chat.js";
import { createLogger } from "./logger.js";
import { EMIT_CANDIDATES_TOOL, MAX_CANDIDATES_PER_BATCH, SYSTEM_PROMPT, buildUserPrompt } from "./user-memory-curator-prompt.js";
const log = createLogger("user-memory-curator");

// Background job: prefer the low-priority automation key so curator bursts
// can't queue interactive agent turns on the main key's parallel-slot pool.
const LITELLM_API_KEY = process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() || (process.env["LITELLM_API_KEY"] ?? "");
// Model name passed to LiteLLM for the distill call. MUST resolve from the same
// source as LITELLM_API_KEY above: LiteLLM keys are team-scoped and the teams'
// allowed-model lists are DISJOINT, so sending the interactive `LITELLM_MODEL`
// with the automation key is a hard 403 ("team not allowed to access model") —
// prod 2026-08-14, automation team allowed `private-large` but not
// `private-large-spaces`. Mirrors the key fallback order.
const CURATOR_MODEL = process.env["LITELLM_AUTOMATION_MODEL"]?.trim()
  || process.env["LITELLM_MODEL"]
  || "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000);
// Per-retry timeout escalation: a slow LLM gateway is usually just slow, not
// stuck, so give each retry more room. attempt 1 = base (10m), attempt 2 =
// base+step (12m), attempt 3 = base+2·step (14m).
const CURATOR_TIMEOUT_STEP_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_STEP_MS"] ?? 120_000);

/** Record-count backstop. The auth-side packer first enforces the ~80k-token
 * record-text budget, so this mainly lets batches of short messages use the
 * available context instead of stopping at the old 50-record ceiling. */
const MAX_RECORDS_PER_BATCH = 200;

/** Cap on prompt + raw-response text stored in the trace so a large batch
 *  can't bloat the persisted DigitalTwinPipelineEvent row. */
const TRACE_TEXT_CAP = 120_000;

/**
 * Best-effort recovery when the forced tool_choice doesn't materialize as a
 * proper `tool_calls` array and the emit_user_candidates payload ends up in
 * message.content instead. Two shapes are handled:
 *
 *   1. Plain JSON — `{ "candidates": [...] }` (optionally fenced / wrapped in
 *      prose). Some gateways answer the forced call this way.
 *   2. GLM native tool-call markup that LiteLLM failed to normalize into
 *      tool_calls, e.g. (note the sometimes-doubled opening tag):
 *        <tool_call><tool_call>emit_user_candidates<arg_key>candidates</arg_key><arg_value>[...]</arg_value></tool_call>
 *      This is intermittent — glm-latest usually emits well-formed markup that
 *      LiteLLM parses fine; a malformed variant leaks through as text.
 *
 * Returns a JSON string that parses to `{ candidates: [...] }` (including an
 * empty array — a legitimate "no candidates" result), or null otherwise.
 */
function extractToolArgsFromContent(content: string): string | null {
  const stripped = content.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const tryParse = (s: string): string | null => {
    try {
      const obj = JSON.parse(s) as { candidates?: unknown };
      if (obj && typeof obj === "object" && Array.isArray(obj.candidates)) return s;
    } catch {
      /* not JSON — fall through */
    }
    return null;
  };

  // 1) Plain JSON payload in content — whole string, then first `{`…last `}`.
  const whole = tryParse(stripped);
  if (whole) return whole;
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  const sliced = first >= 0 && last > first ? tryParse(stripped.slice(first, last + 1)) : null;
  if (sliced) return sliced;

  // 2) GLM native tool-call markup — pull the `candidates` arg_value and
  //    rebuild the payload. Non-greedy up to the first </arg_value>.
  const argValue = stripped
    .match(/<arg_key>\s*candidates\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i)?.[1]
    ?.trim();
  if (argValue !== undefined) return tryParse(`{"candidates":${argValue}}`);

  return null;
}

/** How many times to (re)attempt the LLM call for a single batch before giving
 *  up. Transient model-output failures (no tool_call, bad/malformed JSON) and
 *  5xx/timeouts are RETRIED — the same prompt very often succeeds on a fresh
 *  sample, so a one-off formatting glitch no longer discards a whole batch of
 *  records (previously "malformed-candidates" → the window's records were lost). */
const CURATOR_MAX_ATTEMPTS = Math.max(1, Number(process.env["USER_MEMORY_CURATOR_MAX_ATTEMPTS"] ?? 3));

/** Per-attempt debug context, surfaced in the trace whether the attempt won or
 *  lost (thinking, finish reason, raw content, how the tool args were obtained). */
interface AttemptMeta {
  usage?: { promptTokens?: number; completionTokens?: number };
  reasoning?: string;
  finishReason?: string;
  rawContent?: string;
  toolCallName?: string;
  toolCallSource?: "tool_calls" | "recovered-content";
}

type AttemptResult =
  | {
      ok: true;
      candidates: UserMemoryCandidatePayload[];
      emitted: UserMemoryCuratorEmittedCandidate[];
      rawResponse: string;
      meta: AttemptMeta;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      rawResponse?: string;
      meta: AttemptMeta;
      /** Present on "all-ungrounded": what the model emitted, so the caller can
       *  fall back to batch-level provenance instead of losing the batch. */
      emitted?: UserMemoryCuratorEmittedCandidate[];
      salvage?: UserMemoryCandidatePayload[];
    };

/** Parse the model's tool-call arguments and apply the server-side filter
 *  (empty → bad-subsystem → low-signal → ungrounded). Returns an AttemptResult
 *  so the retry loop can decide whether to try again. */
function parseCandidates(
  raw: string,
  batch: UserMemoryRecord[],
  userId: string,
  meta: AttemptMeta,
): AttemptResult {
  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`[user-memory-curator] bad JSON from LLM userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "bad-json", retryable: true, rawResponse: raw, meta };
  }

  if (!Array.isArray(parsed.candidates)) {
    log.warn(`[user-memory-curator] malformed candidates field userId=${userId}`);
    return { ok: false, error: "malformed-candidates", retryable: true, rawResponse: raw, meta };
  }

  const recordIds = new Set(batch.map((r) => r.id));
  /** Cited ids that match no record in this batch — kept for diagnostics, since
   *  "the model cited something" and "the model cited OUR ids" are very
   *  different failures and the logs could not previously tell them apart. */
  const unknownCitedIds = new Set<string>();
  const out: UserMemoryCandidatePayload[] = [];
  const emitted: UserMemoryCuratorEmittedCandidate[] = [];
  /** Well-formed candidates dropped only for citing unknown ids — the caller's
   *  batch-level-grounding fallback (groundedOnIds is filled in there). */
  const salvage: UserMemoryCandidatePayload[] = [];

  if (parsed.candidates.length > MAX_CANDIDATES_PER_BATCH) {
    log.warn(
      `[user-memory-curator] candidate output truncated ${parsed.candidates.length} → ${MAX_CANDIDATES_PER_BATCH} userId=${userId}`,
    );
  }
  for (const c of parsed.candidates.slice(0, MAX_CANDIDATES_PER_BATCH)) {
    // malformed = the entry isn't an object; we can't report its fields.
    if (!c || typeof c !== "object") {
      emitted.push({ text: "", verdict: "dropped", dropReason: "malformed" });
      continue;
    }
    const cand = c as Record<string, unknown>;
    const text = typeof cand["text"] === "string" ? cand["text"].trim() : "";
    const subsystem = cand["subsystem"];
    const signalScore = typeof cand["signalScore"] === "number" ? cand["signalScore"] : 0;
    const groundedOnIds = Array.isArray(cand["groundedOnIds"])
      ? cand["groundedOnIds"].filter((id): id is string => typeof id === "string")
      : [];

    const base: UserMemoryCuratorEmittedCandidate = {
      text,
      verdict: "dropped",
      ...(typeof subsystem === "string" ? { subsystem } : {}),
      signalScore,
      groundedOnIds,
    };

    if (!text) {
      emitted.push({ ...base, dropReason: "empty" });
      continue;
    }
    if (!isUserMemorySubsystem(subsystem)) {
      emitted.push({ ...base, dropReason: "bad-subsystem" });
      continue;
    }
    if (signalScore < 0.7) {
      emitted.push({ ...base, dropReason: "low-signal" });
      continue;
    }
    const clampedScore = Math.min(1, Math.max(0, signalScore));
    const validIds = groundedOnIds.filter((id) => recordIds.has(id));
    if (validIds.length === 0) {
      for (const id of groundedOnIds) unknownCitedIds.add(id);
      emitted.push({ ...base, dropReason: "ungrounded" });
      salvage.push({ text, subsystem, signalScore: clampedScore, groundedOnIds: [] });
      continue;
    }

    out.push({ text, subsystem, signalScore: clampedScore, groundedOnIds: validIds });
    emitted.push({ ...base, verdict: "kept", groundedOnIds: validIds });
  }

  // Every candidate the model produced was otherwise valid but cited ids we do
  // not recognise. That is a CITATION failure, not "the batch had nothing worth
  // remembering" — and it used to look identical to the latter: ok:true with an
  // empty list, no retry, a whole batch of good candidates silently gone.
  // Surface it as retryable so the loop gets another attempt.
  if (out.length === 0 && salvage.length > 0) {
    log.warn(
      `[user-memory-curator] all ${salvage.length} candidate(s) cited unknown record ids userId=${userId} ` +
        `cited=[${Array.from(unknownCitedIds).slice(0, 5).join(", ")}] ` +
        `expected=[${Array.from(recordIds).slice(0, 3).join(", ")}]`,
    );
    return { ok: false, error: "all-ungrounded", retryable: true, rawResponse: raw, meta, emitted, salvage };
  }

  return { ok: true, candidates: out, emitted, rawResponse: raw, meta };
}

/** One LLM call + parse + server-side filter. Never throws — always resolves to
 *  an AttemptResult so the retry loop can decide whether to try again. */
async function runDistillAttempt(
  userId: string,
  prompt: string,
  batch: UserMemoryRecord[],
  timeoutMs: number,
): Promise<AttemptResult> {
  const meta: AttemptMeta = {};
  let raw: string | undefined;
  try {
    const res = await postChatCompletion(LITELLM_API_KEY, {
      model: CURATOR_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      tools: [EMIT_CANDIDATES_TOOL],
      tool_choice: { type: "function", function: { name: EMIT_CANDIDATES_TOOL.function.name } },
      temperature: 0.2,
    },
    // maxRetries:0 → ONE fetch here; the curator's own attempt loop is the
    // single retry ladder (with the escalating timeout). Avoids nesting this
    // primitive's 4× retry inside our 3× loop (which would multiply the time
    // budget and make the per-retry escalation incoherent).
    { timeoutMs, label: `user-memory-curator:${userId}`, maxRetries: 0 });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[user-memory-curator] LiteLLM returned ${res.status} userId=${userId}: ${body.slice(0, 200)}`);
      // Retry 5xx AND 429 (rate-limit) at the curator level now that the inner
      // helper no longer retries them (maxRetries:0 above).
      return { ok: false, error: `llm-http-${res.status}`, retryable: res.status >= 500 || res.status === 429, meta };
    }

    const data = (await res.json()) as ChatCompletionResponse;

    if (data.usage) meta.usage = tokenUsage(data.usage);

    const choice = data.choices?.[0];
    const message = choice?.message;

    // Debug context — captured whether or not we end up with a usable tool
    // call, so a failed distill is as inspectable as a successful one.
    if (choice?.finish_reason !== undefined) meta.finishReason = choice.finish_reason;
    if (typeof message?.content === "string" && message.content.trim()) meta.rawContent = message.content;
    const reasoningRaw = message?.reasoning_content ?? message?.reasoning;
    if (typeof reasoningRaw === "string" && reasoningRaw.trim()) meta.reasoning = reasoningRaw;

    const toolCall = message?.tool_calls?.[0]?.function;
    raw = toolCall?.arguments;
    if (raw) {
      meta.toolCallSource = "tool_calls";
      if (typeof toolCall?.name === "string") meta.toolCallName = toolCall.name;
    }

    // Some gateways/models (observed with glm-latest via LiteLLM) don't honor
    // the forced tool_choice and instead answer with the emit_user_candidates
    // JSON in message.content. Recover from content when it parses as our
    // payload so a cooperative-but-non-conforming model still yields candidates.
    if (!raw && typeof message?.content === "string" && message.content.trim()) {
      const recovered = extractToolArgsFromContent(message.content);
      if (recovered) {
        log.warn(
          `[user-memory-curator] recovered candidates from message.content (no tool_call) userId=${userId} model=${CURATOR_MODEL}`,
        );
        raw = recovered;
        meta.toolCallSource = "recovered-content";
        meta.toolCallName = EMIT_CANDIDATES_TOOL.function.name;
      }
    }

    if (!raw) {
      // Diagnostics: forced tool_choice produced no tool_call AND content
      // didn't parse as our payload. Capture what the model actually returned
      // so the pipeline viewer ("Raw LLM response") and logs show the cause
      // (e.g. finish_reason=length truncation, a refusal, or plain prose).
      const toolCallCount = message?.tool_calls?.length ?? 0;
      const content = typeof message?.content === "string" ? message.content : "";
      const diag =
        `no tool_call — finish_reason=${choice?.finish_reason ?? "unknown"} ` +
        `tool_calls=${toolCallCount} content_chars=${content.length}\n` +
        `content:\n${content.slice(0, 4_000)}`;
      log.warn(
        `[user-memory-curator] no tool_call in response userId=${userId} model=${CURATOR_MODEL} ` +
          `finish_reason=${choice?.finish_reason ?? "unknown"} tool_calls=${toolCallCount} content_chars=${content.length} ` +
          `content_preview=${JSON.stringify(content.slice(0, 300))}`,
      );
      return { ok: false, error: "no-tool-call", retryable: true, rawResponse: diag, meta };
    }
  } catch (err) {
    log.warn(`[user-memory-curator] LLM call failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true, meta };
  }

  return parseCandidates(raw, batch, userId, meta);
}

/**
 * Run the user-memory curator on a batch of records. Returns the raw
 * candidate payloads (server-side attaches sourceRefs from the input ids
 * before persisting) plus a full observability trace of the LLM exchange
 * (prompt, raw response, per-candidate keep/drop verdicts, failure stage).
 *
 * Retries the LLM call on transient/output-quality failures up to
 * CURATOR_MAX_ATTEMPTS so a one-off malformed response no longer drops the
 * batch's records permanently.
 */
export async function distillUserMemory(
  userId: string,
  window: { from: string; to: string },
  records: UserMemoryRecord[],
  existingMemories: ExistingUserMemory[] = [],
): Promise<{ candidates: UserMemoryCandidatePayload[]; trace: UserMemoryCuratorTrace }> {
  // No-LLM-call result: empty trace, `error` only when a stage is given.
  const skip = (durationMs: number, error?: string) => ({
    candidates: [],
    trace: {
      model: CURATOR_MODEL,
      durationMs,
      prompt: "",
      promptChars: 0,
      emitted: [],
      ...(error !== undefined ? { error } : {}),
    },
  });

  // Empty batch — no LLM call, no prompt. Empty trace with no error stage.
  if (records.length === 0) return skip(0);

  const startedAt = Date.now();
  if (!LITELLM_API_KEY) {
    log.warn("[user-memory-curator] LITELLM_API_KEY not set — skipping");
    return skip(Date.now() - startedAt, "no-api-key");
  }

  const batch = records.slice(0, MAX_RECORDS_PER_BATCH);
  if (records.length > MAX_RECORDS_PER_BATCH) {
    log.warn(`[user-memory-curator] batch truncated ${records.length} → ${MAX_RECORDS_PER_BATCH} records userId=${userId}`);
  }

  const prompt = buildUserPrompt(batch, window, existingMemories);
  const promptChars = prompt.length;

  const traceBase = (meta: AttemptMeta, attempts: number) => ({
    model: CURATOR_MODEL,
    durationMs: Date.now() - startedAt,
    systemPrompt: SYSTEM_PROMPT.slice(0, TRACE_TEXT_CAP),
    prompt: prompt.slice(0, TRACE_TEXT_CAP),
    promptChars,
    attempts,
    ...(meta.finishReason !== undefined ? { finishReason: meta.finishReason } : {}),
    ...(meta.reasoning ? { reasoning: meta.reasoning.slice(0, TRACE_TEXT_CAP) } : {}),
    ...(meta.rawContent ? { rawContent: meta.rawContent.slice(0, TRACE_TEXT_CAP) } : {}),
    ...(meta.toolCallName ? { toolCallName: meta.toolCallName } : {}),
    ...(meta.toolCallSource ? { toolCallSource: meta.toolCallSource } : {}),
    ...(meta.usage ? { usage: meta.usage } : {}),
  });

  let failure: Extract<AttemptResult, { ok: false }> | null = null;
  let attempts = 0;

  const traceOf = (r: AttemptResult, emitted: UserMemoryCuratorEmittedCandidate[], error?: string) => ({
    ...traceBase(r.meta, attempts),
    ...(r.rawResponse !== undefined ? { rawResponse: r.rawResponse.slice(0, TRACE_TEXT_CAP) } : {}),
    emitted,
    ...(error !== undefined ? { error } : {}),
  });

  for (let i = 1; i <= CURATOR_MAX_ATTEMPTS; i++) {
    attempts = i;
    // Escalate the per-call timeout on each retry (10m → 12m → 14m).
    const attemptTimeoutMs = CURATOR_TIMEOUT_MS + (i - 1) * CURATOR_TIMEOUT_STEP_MS;
    const result = await runDistillAttempt(userId, prompt, batch, attemptTimeoutMs);

    if (result.ok) {
      if (i > 1) {
        log.info(`[user-memory-curator] succeeded on attempt ${i}/${CURATOR_MAX_ATTEMPTS} userId=${userId}`);
      }
      return { candidates: result.candidates, trace: traceOf(result, result.emitted) };
    }

    failure = result;
    if (!result.retryable || i === CURATOR_MAX_ATTEMPTS) break;
    log.warn(
      `[user-memory-curator] attempt ${i}/${CURATOR_MAX_ATTEMPTS} failed (${result.error}) — retrying userId=${userId}`,
    );
    // Small linear backoff so a transient gateway blip has time to clear.
    await new Promise((r) => setTimeout(r, 400 * i));
  }

  // Exhausted retries (or a permanent failure). Surface the last attempt's
  // context + the failing stage in the trace.
  const f = failure!;

  // SALVAGE: the model kept producing good candidates but never cited ids we
  // recognise. Dropping the whole batch loses real memories over a citation
  // formatting problem, so fall back to BATCH-level provenance: ground each
  // candidate on every record in the batch. Coarser than per-record grounding
  // (the reason it is a last resort, not the default), but the candidate
  // demonstrably came from these records, and sourceRefs still resolve — which
  // is what downstream event-timestamp picking needs.
  if (f.error === "all-ungrounded" && f.salvage?.length) {
    const batchIds = batch.map((r) => r.id);
    const salvaged = f.salvage.map((c) => ({ ...c, groundedOnIds: batchIds }));
    log.warn(
      `[user-memory-curator] salvaged ${salvaged.length} candidate(s) with batch-level grounding ` +
        `after ${attempts} attempt(s) userId=${userId}`,
    );
    return {
      candidates: salvaged,
      trace: traceOf(
        f,
        (f.emitted ?? []).map((e) =>
          e.dropReason === "ungrounded"
            ? { ...e, verdict: "kept" as const, groundedOnIds: batchIds }
            : e,
        ),
        "all-ungrounded-salvaged",
      ),
    };
  }

  return { candidates: [], trace: traceOf(f, f.emitted ?? [], f.error) };
}
