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
import {
  activeJudgeBackend,
  recordJudgeExchange,
  recordJudgeShadow,
  shadowJudgeBackends,
  SYSTEM_ONE_BACKENDS,
  type JudgeBackendName,
  type SystemOneBackendName,
  type SystemOneBackendSpec,
} from "./judge-backend.js";
import { llmJudgeConfig, llmJudgePost } from "./judge-llm.js";

const log = createLogger("jev");

const DEFAULT_TIMEOUT_MS = Math.max(200, Number(process.env["JEV_TIMEOUT_MS"] ?? 2500));
const DEFAULT_BATCH = Math.min(Math.max(Number(process.env["JEV_BATCH"] ?? 50), 1), 100);

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  /**
   * `criteria` are ordered anchor levels from low (score 0) to high (score 1);
   * the answer is where the state falls between them. Required by the API.
   */
  | { type: "score"; instructions: string; criteria: string[] };

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

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function systemOneConfig(backend: SystemOneBackendName) {
  const spec: SystemOneBackendSpec = SYSTEM_ONE_BACKENDS[backend];
  const ownUrl = env(`${spec.envPrefix}_URL`);
  const ownModel = env(`${spec.envPrefix}_MODEL`);
  const shared = spec.sharedEnvPrefix;
  const viaLitellm = spec.viaLitellm === true;
  const litellmBase = env("LITELLM_URL").replace(/\/$/, "");
  return {
    url:
      ownUrl ||
      (shared ? env(`${shared}_URL`) : "") ||
      spec.defaultUrl ||
      (viaLitellm && litellmBase ? `${litellmBase}/v1/systemone` : ""),
    key:
      env(`${spec.envPrefix}_API_KEY`) ||
      (shared ? env(`${shared}_API_KEY`) : "") ||
      (viaLitellm ? env("LITELLM_API_KEY") : ""),
    model: ownModel || spec.defaultModel || "",
    // Distinct from its sibling when it has its own URL/model, or when it is the
    // LiteLLM-served default (only while no shared OUR_JEV_URL is configured).
    distinct:
      !shared ||
      Boolean(ownUrl || ownModel) ||
      (viaLitellm && Boolean(litellmBase) && !env(`${shared}_URL`)),
  };
}

export function judgeBackendConfigured(backend: JudgeBackendName): boolean {
  if (backend === "llm") {
    const cfg = llmJudgeConfig();
    return Boolean(cfg.url && cfg.key && cfg.model);
  }
  const cfg = systemOneConfig(backend);
  return Boolean(cfg.url && cfg.key && cfg.distinct);
}

export function jevEnabled(): boolean {
  return judgeBackendConfigured(activeJudgeBackend());
}

/** Read an env threshold, so each call site can be tuned without a deploy. */
export function jevThreshold(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

async function post(
  backend: JudgeBackendName,
  state: string,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal,
): Promise<Record<string, JevAnswer>> {
  if (backend === "llm") return llmJudgePost(state, questions, signal);
  const cfg = systemOneConfig(backend);
  const res = await fetch(cfg.url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, ...(cfg.model ? { model: cfg.model } : {}), questions }),
  });
  if (!res.ok) throw new Error(`${backend} ${res.status}`);
  const body = (await res.json()) as { answers?: Record<string, JevAnswer> };
  return normaliseScores(body.answers ?? {}, questions);
}

/**
 * Scores come back relative to the question's ordered levels. Our grid endpoint
 * returns the expected LEVEL INDEX (0 … n-1, e.g. 1.76 with 3 levels); every
 * caller reads 0..1. Derive 0..1 from the per-level probabilities when present
 * (Σ level·p / (n-1)) — scale-independent, so it is right whichever System One
 * endpoint answered — else rescale an out-of-range score by (n-1). Exported for tests.
 */
export function normaliseScores(
  answers: Record<string, JevAnswer>,
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const [id, a] of Object.entries(answers)) {
    const q = questions[id];
    if (a?.type !== "score" || q?.type !== "score" || q.criteria.length < 2) {
      out[id] = a;
      continue;
    }
    const top = q.criteria.length - 1;
    const probs = a.probabilities ? Object.entries(a.probabilities) : [];
    const levelProbs = probs.filter(([k, p]) => /^\d+$/.test(k) && typeof p === "number");
    let score: number | undefined;
    if (levelProbs.length > 0) {
      const mass = levelProbs.reduce((n, [, p]) => n + p, 0);
      if (mass > 0) score = levelProbs.reduce((n, [k, p]) => n + Number(k) * p, 0) / mass / top;
    }
    if (score === undefined && typeof a.score === "number") score = a.score > 1 ? a.score / top : a.score;
    out[id] = score === undefined ? a : { ...a, score: Math.min(1, Math.max(0, score)) };
  }
  return out;
}

/**
 * The caller's budget wins. A slower backend may only shorten it, never
 * stretch it: a 1.5s hot-path gate must not become a 30s stall just because
 * the run is pinned to the LLM judge.
 */
export function backendTimeoutMs(backend: JudgeBackendName, requested: number | undefined): number {
  if (backend === "llm") {
    const llm = llmJudgeConfig().timeoutMs;
    return requested === undefined ? llm : Math.min(requested, llm);
  }
  return requested ?? DEFAULT_TIMEOUT_MS;
}

function answerValue(answer: JevAnswer | undefined): number | string | undefined {
  if (!answer) return undefined;
  return answer.noul ?? answer.score ?? answer.choice;
}

async function runShadow(
  primary: JudgeBackendName,
  shadow: JudgeBackendName,
  state: string,
  questions: Record<string, JevQuestion>,
  primaryAnswers: Record<string, JevAnswer>,
  primaryMs: number,
  purpose: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), backendTimeoutMs(shadow, undefined));
  const started = Date.now();
  try {
    const answers = await post(shadow, state, questions, controller.signal);
    const shadowMs = Date.now() - started;
    let compared = 0;
    let agreed = 0;
    let diffSum = 0;
    for (const id of Object.keys(questions)) {
      const a = answerValue(primaryAnswers[id]);
      const b = answerValue(answers[id]);
      if (a === undefined || b === undefined) continue;
      compared += 1;
      if (typeof a === "number" && typeof b === "number") {
        diffSum += Math.abs(a - b);
        if (a >= 0.5 === b >= 0.5) agreed += 1;
      } else if (a === b) {
        agreed += 1;
      }
    }
    const meanAbsDiff = compared > 0 ? diffSum / compared : 0;
    recordJudgeShadow({ primary, shadow, purpose, questions: compared, agreed, meanAbsDiff, primaryMs, shadowMs });
    metric.observe("judge_shadow_ms", shadowMs, { purpose, primary, shadow });
    metric.observe("judge_shadow_agreement", compared > 0 ? agreed / compared : 0, { purpose, primary, shadow, questions: compared });
  } catch {
    metric.count("judge_shadow_failed", { purpose, primary, shadow });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask arbitrary typed questions about one state. Null when unavailable.
 */
export async function jevAsk(
  state: string,
  questions: Record<string, JevQuestion>,
  opts: JevOptions = {},
): Promise<Record<string, JevAnswer> | null> {
  return jevAskOn(activeJudgeBackend(), state, questions, opts);
}

export async function jevAskOn(
  backend: JudgeBackendName,
  state: string,
  questions: Record<string, JevQuestion>,
  opts: JevOptions = {},
): Promise<Record<string, JevAnswer> | null> {
  if (!judgeBackendConfigured(backend) || !state.trim() || Object.keys(questions).length === 0) return null;
  const purpose = opts.purpose ?? "ask";
  const count = Object.keys(questions).length;
  const started = Date.now();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), backendTimeoutMs(backend, opts.timeoutMs));
  const record = (ms: number, answers: Record<string, JevAnswer> | null, error?: string): void =>
    recordJudgeExchange({
      backend, purpose, ms, questions: count, ok: answers !== null,
      state, questionSpec: questions, answers,
      ...(error ? { error } : {}),
      at: new Date(started).toISOString(),
    });
  try {
    const answers = await post(backend, state, questions, controller.signal);
    const elapsed = Date.now() - started;
    metric.observe("jev_ms", elapsed, { purpose, backend, result: "ok", questions: count });
    record(elapsed, answers);
    for (const shadow of shadowJudgeBackends(backend)) {
      if (!judgeBackendConfigured(shadow)) continue;
      void runShadow(backend, shadow, state, questions, answers, elapsed, purpose);
    }
    return answers;
  } catch (err) {
    const elapsed = Date.now() - started;
    const reason = controller.signal.aborted ? "timeout" : "error";
    const msg = err instanceof Error ? err.message : String(err);
    metric.count("jev_failed", { purpose, backend, reason });
    record(elapsed, null, `${reason}: ${msg}`);
    log.warn(`[jev] ${purpose} via ${backend} unavailable after ${elapsed}ms — caller falls back:`, msg);
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
      const questions = Object.fromEntries(
        group.map((item, i) => [`i${i}`, { type: "noul" as const, instructions: opts.instructions(item) }]),
      );
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
