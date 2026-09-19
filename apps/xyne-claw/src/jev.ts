/**
 * Jev (TypeSafe System One) client — typed evaluation with no text generation.
 *
 * One `state` is read once and every question is answered against it in
 * parallel, so asking 20 things costs barely more than asking one. Use it for
 * decisions the agent loop currently spends a full generative turn on:
 * which tools are worth loading, which search hits are worth reading, which
 * agent should take a task.
 *
 * Every entry point returns null rather than throwing when Jev is unavailable,
 * so a caller always has to keep the path it had before. Jev improves a
 * decision; it is never the only way to make one.
 */

import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("jev");

const ENDPOINT = process.env["JEV_URL"] ?? "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env["JEV_MODEL"] ?? "jev-latest";
const DEFAULT_TIMEOUT_MS = Math.max(200, Number(process.env["JEV_TIMEOUT_MS"] ?? 2500));
const DEFAULT_BATCH = Math.min(Math.max(Number(process.env["JEV_BATCH"] ?? 50), 1), 100);

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria?: string[] };

export interface JevAnswer {
  type: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
}

export interface JevOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Label for metrics, so call sites are distinguishable. */
  purpose?: string;
}

export function jevEnabled(): boolean {
  return Boolean(process.env["JEV_API_KEY"]?.trim());
}

/** Read an env threshold, so each call site can be tuned without a deploy. */
export function jevThreshold(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

async function post(
  state: string,
  questions: Record<string, JevQuestion>,
  opts: JevOptions,
  signal: AbortSignal,
): Promise<Record<string, JevAnswer>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${process.env["JEV_API_KEY"]}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, model: MODEL, questions }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  const body = (await res.json()) as { answers?: Record<string, JevAnswer> };
  return body.answers ?? {};
}

/**
 * Ask arbitrary typed questions about one state. Null when unavailable.
 */
export async function jevAsk(
  state: string,
  questions: Record<string, JevQuestion>,
  opts: JevOptions = {},
): Promise<Record<string, JevAnswer> | null> {
  if (!jevEnabled() || !state.trim() || Object.keys(questions).length === 0) return null;
  const purpose = opts.purpose ?? "ask";
  const started = Date.now();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const answers = await post(state, questions, opts, controller.signal);
    metric.observe("jev_ms", Date.now() - started, { purpose, result: "ok", questions: Object.keys(questions).length });
    return answers;
  } catch (err) {
    metric.count("jev_failed", { purpose, reason: controller.signal.aborted ? "timeout" : "error" });
    log.warn(
      `[jev] ${purpose} unavailable after ${Date.now() - started}ms — caller falls back:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export interface JevScoreOptions<T> extends JevOptions {
  /** Stable key per item; scores come back under these. */
  key: (item: T) => string;
  /** The yes/no question asked about each item, against the shared state. */
  instructions: (item: T) => string;
  /** Items per request. Batches run in parallel. */
  batch?: number;
  /** Hard cap on items considered, newest-first by caller ordering. */
  max?: number;
}

/**
 * Score a batch of items 0..1 for relevance to `state`. Returns a map keyed by
 * `key(item)`, or null when unavailable. This is the shape most call sites
 * want: tools, search hits, files, candidate agents.
 */
export async function jevScoreItems<T>(
  state: string,
  items: readonly T[],
  opts: JevScoreOptions<T>,
): Promise<Map<string, number> | null> {
  if (!jevEnabled() || !state.trim() || items.length === 0) return null;

  const pool = opts.max ? items.slice(0, opts.max) : items;
  const size = Math.min(Math.max(opts.batch ?? DEFAULT_BATCH, 1), 100);
  const batches: T[][] = [];
  for (let i = 0; i < pool.length; i += size) batches.push(pool.slice(i, i + size));

  const results = await Promise.all(
    batches.map(async (group) => {
      const questions: Record<string, JevQuestion> = {};
      group.forEach((item, i) => {
        questions[`i${i}`] = { type: "noul", instructions: opts.instructions(item) };
      });
      const answers = await jevAsk(state, questions, { ...opts, purpose: opts.purpose ?? "score" });
      if (!answers) return null;
      const part = new Map<string, number>();
      group.forEach((item, i) => {
        const v = answers[`i${i}`]?.noul;
        if (typeof v === "number") part.set(opts.key(item), v);
      });
      return part;
    }),
  );

  if (results.every((r) => r === null)) return null;
  const scores = new Map<string, number>();
  for (const part of results) if (part) for (const [k, v] of part) scores.set(k, v);
  return scores;
}
