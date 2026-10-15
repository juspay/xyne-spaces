import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { recordJudgeExchange } from "./judge-trace.js";
import { llmJudgeConfig, llmJudgePost } from "./judge-llm.js";

const log = createLogger("xor");

export type XorQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface XorAnswer {
  type: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
}

export interface XorRequest {
  state: string;
  questions: Record<string, XorQuestion>;
  purpose: string;
  images?: string[] | undefined;
  signal?: AbortSignal | undefined;
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL.test(value);
}

export type XorAsk = (req: XorRequest) => Promise<Record<string, XorAnswer> | null>;

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export const XOR_TIMEOUT_MS = Math.max(200, Number(env("XOR_TIMEOUT_MS", "JEV_TIMEOUT_MS") || 10_000));
const DEFAULT_BATCH = Math.min(Math.max(Number(env("XOR_BATCH", "JEV_BATCH") || 50), 1), 100);

export function xorConfig(): { backend: "xor" | "llm"; url: string; key: string; model: string; timeoutMs: number } {
  if (env("XOR_BACKEND", "JUDGE_BACKEND").toLowerCase() === "llm") {
    const llm = llmJudgeConfig();
    return { backend: "llm", url: llm.url, key: llm.key, model: llm.model, timeoutMs: Math.min(XOR_TIMEOUT_MS, llm.timeoutMs) };
  }
  const litellm = env("LITELLM_URL").replace(/\/$/, "").replace(/\/v1$/, "");
  return {
    backend: "xor",
    url: env("XOR_URL", "OUR_NORMAL_JEV_URL", "OUR_JEV_URL") || (litellm ? `${litellm}/v1/systemone` : ""),
    key: env("XOR_API_KEY", "OUR_NORMAL_JEV_API_KEY", "OUR_JEV_API_KEY", "LITELLM_API_KEY"),
    model: env("XOR_MODEL", "OUR_NORMAL_JEV_MODEL") || "jev-latest",
    timeoutMs: XOR_TIMEOUT_MS,
  };
}

export function xorEnabled(): boolean {
  const cfg = xorConfig();
  return Boolean(cfg.url && cfg.key && cfg.model);
}

export function xorThreshold(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function normaliseScores(
  answers: Record<string, XorAnswer>,
  questions: Record<string, XorQuestion>,
): Record<string, XorAnswer> {
  const out: Record<string, XorAnswer> = {};
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

async function post(
  cfg: ReturnType<typeof xorConfig>,
  state: string,
  questions: Record<string, XorQuestion>,
  signal: AbortSignal,
  images: string[],
): Promise<Record<string, XorAnswer>> {
  if (cfg.backend === "llm") {
    if (images.length > 0) throw new Error("llm backend cannot read images");
    return llmJudgePost(state, questions, signal);
  }
  const res = await fetch(cfg.url, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: cfg.model, questions, ...(images.length > 0 ? { images } : {}) }),
  });
  if (!res.ok) throw new Error(`xor ${res.status}`);
  const body = (await res.json()) as { answers?: Record<string, XorAnswer> };
  return normaliseScores(body.answers ?? {}, questions);
}

export async function xor(req: XorRequest): Promise<Record<string, XorAnswer> | null> {
  const { state, questions, purpose, signal } = req;
  const images = req.images ?? [];
  const cfg = xorConfig();
  if (!cfg.url || !cfg.key || !cfg.model || !state.trim() || Object.keys(questions).length === 0) return null;
  if (images.some((img) => !isImageDataUrl(img))) {
    log.warn(`[xor] ${purpose} refused: images must be base64 image data URLs`);
    return null;
  }
  const count = Object.keys(questions).length;
  const started = Date.now();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const record = (ms: number, answers: Record<string, XorAnswer> | null, error?: string): void =>
    recordJudgeExchange({
      backend: cfg.backend,
      purpose,
      ms,
      questions: count,
      ok: answers !== null,
      state: images.length > 0 ? `${state}\n[${images.length} image(s) attached]` : state,
      questionSpec: questions,
      answers,
      ...(error ? { error } : {}),
      at: new Date(started).toISOString(),
    });
  try {
    const answers = await post(cfg, state, questions, controller.signal, images);
    const elapsed = Date.now() - started;
    metric.observe("xor_ms", elapsed, { purpose, backend: cfg.backend, result: "ok", questions: count, images: images.length });
    record(elapsed, answers);
    return answers;
  } catch (err) {
    const elapsed = Date.now() - started;
    const reason = controller.signal.aborted ? "timeout" : "error";
    const msg = err instanceof Error ? err.message : String(err);
    metric.count("xor_failed", { purpose, backend: cfg.backend, reason });
    record(elapsed, null, `${reason}: ${msg}`);
    log.warn(`[xor] ${purpose} unavailable after ${elapsed}ms (${reason}: ${msg}) — caller falls back`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface XorScoreRequest<T> {
  state: string;
  items: readonly T[];
  purpose: string;
  key: (item: T) => string;
  instructions: (item: T) => string;
  batch?: number;
  max?: number;
  signal?: AbortSignal | undefined;
}

export async function xorScoreItems<T>(req: XorScoreRequest<T>): Promise<Map<string, number> | null> {
  if (!xorEnabled() || !req.state.trim() || req.items.length === 0) return null;
  const pool = req.max ? req.items.slice(0, req.max) : req.items;
  const size = Math.min(Math.max(req.batch ?? DEFAULT_BATCH, 1), 100);
  const batches: T[][] = [];
  for (let i = 0; i < pool.length; i += size) batches.push(pool.slice(i, i + size));
  const results = await Promise.all(
    batches.map(async (group) => {
      const questions = Object.fromEntries(
        group.map((item, i) => [`i${i}`, { type: "noul" as const, instructions: req.instructions(item) }]),
      );
      const answers = await xor({ state: req.state, questions, purpose: req.purpose, signal: req.signal });
      if (!answers) return null;
      const part = new Map<string, number>();
      group.forEach((item, i) => {
        const v = answers[`i${i}`]?.noul;
        if (typeof v === "number") part.set(req.key(item), v);
      });
      return part;
    }),
  );
  if (results.every((r) => r === null)) return null;
  const scores = new Map<string, number>();
  for (const part of results) if (part) for (const [k, v] of part) scores.set(k, v);
  return scores;
}
