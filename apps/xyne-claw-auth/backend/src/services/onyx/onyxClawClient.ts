/**
 * S2S client for xyne-claw's /eval-onyx/* JUDGE endpoints.
 *
 * Same "LLM-on-claw-only" invariant as evalJudgeClient: the LiteLLM key lives
 * on claw, so every paper judge goes there over S2S. Each call fails CLOSED
 * (returns the null-ish "judge_unavailable" marker the worker records) rather
 * than throwing — one bad call must not abort a 500-question run.
 *
 * NOTE: there is intentionally NO `answerFromDocs` client — the bench answers
 * through the ask-ai agent (the measured path), never through a synthetic
 * judge-side prompt; `/eval-onyx/answer` is pruned alongside.
 */
import { CONFIG } from "../../config.js";

import { createLogger } from "../../logger.js";
const log = createLogger("onyx-claw-client");

const BASE = () => CONFIG.xyneClawUrl.replace(/\/+$/, "");
const TIMEOUT_MS = () => CONFIG.onyxEvalClawTimeoutMs;

async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!CONFIG.xyneClawS2sKey) {
    log.warn(`[onyx-claw-client] ${path} skipped — no S2S key configured`);
    return null;
  }
  try {
    const res = await fetch(`${BASE()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS()),
    });
    const json = (await res.json().catch(() => null)) as ({ success?: boolean } & Record<string, unknown>) | null;
    if (!res.ok || !json || json.success !== true) {
      log.warn(`[onyx-claw-client] ${path} → HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
      return null;
    }
    return json as unknown as T;
  } catch (err) {
    log.warn(`[onyx-claw-client] ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface OnyxDocForClaw {
  benchmarkDocId?: string | null;
  title?: string;
  content: string;
}

/** Paper §5.1 correctness (binary, independent of facts). Null = unavailable → recorded as 0. */
export async function onyxCorrectness(input: { expected: string; generated: string; model?: string }): Promise<{ correct: 0 | 1; reasoning: string; model: string } | null> {
  return post<{ correct: 0 | 1; reasoning: string; model: string }>("/eval-onyx/correctness", input);
}

/** Paper §5.1 completeness (per-fact support). Null = unavailable → recorded as 0. */
export async function onyxFacts(input: { answer: string; answerFacts: string[]; model?: string }): Promise<{ supported: boolean[]; completeness: number; model: string } | null> {
  return post<{ supported: boolean[]; completeness: number; model: string }>("/eval-onyx/facts", input);
}

export type OnyxRelevanceLabel = "required" | "valid" | "invalid";

/** Paper §5.3: ONE relevance vote; the worker calls this 3× per doc and majority-votes. Null = unavailable vote. */
export async function onyxRelevance(input: { question: string; doc: OnyxDocForClaw; model?: string }): Promise<{ label: OnyxRelevanceLabel; note: string; model: string } | null> {
  return post<{ label: OnyxRelevanceLabel; note: string; model: string }>("/eval-onyx/relevance", input);
}

/**
 * Paper §5.3: regenerate the gold answer + facts from the corrected required
 * set (preserving anti-hallucination facts). Empty goldAnswer = discard the
 * correction — a judge outage never fabricates gold truth.
 */
export async function onyxRegenerateGold(input: { question: string; docs: OnyxDocForClaw[]; originalFacts: string[]; model?: string }): Promise<{ goldAnswer: string; answerFacts: string[]; model: string } | null> {
  return post<{ goldAnswer: string; answerFacts: string[]; model: string }>("/eval-onyx/regenerate-gold", input);
}
