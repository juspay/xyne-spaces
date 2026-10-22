/**
 * Per-LLM-call latency and token series for one agentic run.
 *
 * Context size for a call is `in + cr + cw` (cached tokens are reported separately from `in`).
 * Throughput is `out / (dec / 1000)`, derivable so not stored. `cmp`, `rty` and `m` mark
 * compaction, retry and model changes that would otherwise confound TTFT-vs-context analysis.
 * Keys are terse because the series is stored per run.
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
  /** Fresh input tokens, excluding cached. */
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
  /** First call after a compaction. */
  cmp?: true;
  /** An auto-retry preceded this call, so its TTFT includes the failed attempt. */
  rty?: true;
  /** Set when the call came from a subagent's own loop. */
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

/** Compaction and retry arrive as events before the call they affect, so they latch onto the next recorded call. */
export class LlmTurnRecorder {
  private readonly calls: LlmCallStat[] = [];
  private pendingCompaction = false;
  private pendingRetry = false;

  markCompaction(): void {
    this.pendingCompaction = true;
  }

  markRetry(): void {
    this.pendingRetry = true;
  }

  record(input: LlmCallInput): void {
    const compaction = this.pendingCompaction;
    const retry = this.pendingRetry;
    this.pendingCompaction = false;
    this.pendingRetry = false;
    if (this.calls.length >= MAX_LLM_CALLS) return;
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
      ...(compaction ? { cmp: true as const } : {}),
      ...(retry ? { rty: true as const } : {}),
      ...(input.subagentName ? { sa: input.subagentName } : {}),
    });
  }

  /** Undefined when nothing was recorded, so the column stays NULL rather than an empty array. */
  snapshot(): LlmCallStat[] | undefined {
    return this.calls.length > 0 ? [...this.calls] : undefined;
  }
}

/** Concatenate series in order, keeping the first MAX_LLM_CALLS (parent calls first, so nested tail calls drop). */
export function mergeLlmCallSeries(
  ...series: ReadonlyArray<readonly LlmCallStat[] | undefined>
): { calls: LlmCallStat[]; dropped: number } {
  const all = series.flatMap((s) => s ?? []);
  return { calls: all.slice(0, MAX_LLM_CALLS), dropped: Math.max(0, all.length - MAX_LLM_CALLS) };
}
