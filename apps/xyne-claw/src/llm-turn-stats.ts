/**
 * Per-LLM-call latency and token record for one agentic run.
 *
 * The agent loop already measures everything here — TTFT, decode time and the
 * provider's token usage are all computed at `message_end` — but folds each
 * into a run-level sum and discards the per-call value. What reaches
 * `agent_runs` is a single `ttftMs` (the FIRST turn only, as a cold-start
 * signal) plus one run-level `tokensPerSec`. That is enough to say a run was
 * slow and nothing about why.
 *
 * Recording the series instead makes two questions answerable: how TTFT moves
 * with prompt size, and how throughput moves with position in the loop.
 *
 * ── Deriving the axes ─────────────────────────────────────────────────────
 * Context size for a call is `in + cr + cw`. pi-ai reports cached tokens
 * SEPARATELY from `input`, so summing all three is what gives the real prompt
 * size; `in` alone understates it by the entire cached prefix, which on a long
 * agentic run is most of the context.
 *
 * Throughput is `out / (dec / 1000)`. Deliberately not stored — it is exactly
 * derivable, and storing it would let a rounding change put the stored and
 * derived values out of step.
 *
 * ── Why the markers matter more than they look ────────────────────────────
 * Without `cmp` and `m` the headline correlation is confounded:
 *
 *   - compaction RESETS the prompt, so context-vs-turn is a sawtooth rather
 *     than a ramp. Marking the call after a compaction separates "TTFT grew
 *     with context" from "TTFT dropped because we just compacted", and doubles
 *     as the direct read on whether compaction buys latency.
 *   - provider fallback can swap the model mid-run, so a TTFT step change at
 *     call 12 may be a different model rather than a bigger prompt.
 *   - a retried call's TTFT includes the abandoned attempt, so it is not
 *     comparable to a clean one.
 *
 * Keys are terse because this is stored per run, and its size decides whether
 * the column stays inline or spills to TOAST.
 */

/** Bound on retained calls per run, so a pathological loop cannot bloat the row. */
export const MAX_LLM_CALLS = 200;

export interface LlmCallStat {
  /** 1-based call index within the run. */
  i: number;
  /** Ms from turn start to first streamed delta. Null when no delta arrived. */
  ttft: number | null;
  /** Ms from first delta to message end. */
  dec: number;
  /** Fresh input tokens — EXCLUDES cached, see the module header. */
  in: number;
  out: number;
  /** Cache read tokens. */
  cr: number;
  /** Cache write tokens. */
  cw: number;
  /** Streamed characters, thinking + visible text. */
  ch?: number;
  sr?: string;
  /** Model id; can change mid-run via provider fallback. */
  m?: string;
  p?: string;
  /** First call after a compaction, i.e. running against a reset prompt. */
  cmp?: true;
  /** An auto-retry preceded this call, so its TTFT includes the failed attempt. */
  rty?: true;
  /** Present when the call came from a subagent's own loop, not the parent's. */
  sa?: string;
}

export interface LlmCallInput {
  index: number;
  ttftMs: number | null;
  decodeMs: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
  streamChars?: number | undefined;
  stopReason?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  subagentName?: string | undefined;
}

/**
 * Collects the per-call series for one run.
 *
 * Compaction and retry are observed as their own events BEFORE the call they
 * affect completes, so they are latched and applied to the next recorded call
 * rather than passed in at record time.
 */
export class LlmTurnRecorder {
  private readonly calls: LlmCallStat[] = [];
  private pendingCompaction = false;
  private pendingRetry = false;
  private dropped = 0;

  /** Latch: the NEXT call runs against a freshly compacted prompt. */
  markCompaction(): void {
    this.pendingCompaction = true;
  }

  /** Latch: the NEXT call retries one that failed mid-stream. */
  markRetry(): void {
    this.pendingRetry = true;
  }

  record(input: LlmCallInput): void {
    if (this.calls.length >= MAX_LLM_CALLS) {
      this.dropped += 1;
      this.pendingCompaction = false;
      this.pendingRetry = false;
      return;
    }
    const usage = input.usage;
    this.calls.push({
      i: input.index,
      ttft: input.ttftMs,
      dec: Math.max(0, Math.round(input.decodeMs)),
      in: usage?.input ?? 0,
      out: usage?.output ?? 0,
      cr: usage?.cacheRead ?? 0,
      cw: usage?.cacheWrite ?? 0,
      ...(input.streamChars ? { ch: input.streamChars } : {}),
      ...(input.stopReason ? { sr: input.stopReason } : {}),
      ...(input.model ? { m: input.model } : {}),
      ...(input.provider ? { p: input.provider } : {}),
      ...(this.pendingCompaction ? { cmp: true as const } : {}),
      ...(this.pendingRetry ? { rty: true as const } : {}),
      ...(input.subagentName ? { sa: input.subagentName } : {}),
    });
    this.pendingCompaction = false;
    this.pendingRetry = false;
  }

  /** Merge calls recorded by a subagent's own loop into this run's series. */
  absorb(calls: readonly LlmCallStat[] | undefined): void {
    if (!calls) return;
    for (const call of calls) {
      if (this.calls.length >= MAX_LLM_CALLS) {
        this.dropped += 1;
        continue;
      }
      this.calls.push(call);
    }
  }

  /** Calls dropped by the cap. Non-zero means the series is truncated. */
  droppedCount(): number {
    return this.dropped;
  }

  /** Undefined when nothing was recorded, so the column stays NULL rather than an empty array. */
  snapshot(): LlmCallStat[] | undefined {
    return this.calls.length > 0 ? [...this.calls] : undefined;
  }
}

/** Prompt size for a call: fresh input plus both cache halves. */
export function contextTokens(call: LlmCallStat): number {
  return call.in + call.cr + call.cw;
}

/** Output tokens per second of decode. Null when the call produced no timed output. */
export function tokensPerSecond(call: LlmCallStat): number | null {
  if (call.dec <= 0 || call.out <= 0) return null;
  return Math.round(call.out / (call.dec / 1000));
}
