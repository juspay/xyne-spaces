/**
 * S2S client to xyne-claw's EnterpriseRAG-Bench helpers.
 *
 * The LiteLLM key lives on claw, so the onyx backend delegates answer
 * generation and judgement to claw instead of importing its own model client —
 * this keeps the benchmark's answerer/judges consistent with the answers claw
 * would produce in production. Mirrors the request style in
 * services/clawSpacesSyncClient.ts / automations/services/claw-client.ts
 * (x-s2s-key header, config.xyneClaw base url, bounded timeouts, fail-closed).
 */
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const BASE = () => config.xyneClaw.url.replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env['ONYX_EVAL_CLAW_TIMEOUT_MS'] ?? 180_000);

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const url = `${BASE()}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-s2s-key': config.xyneClaw.s2sKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as ({ success?: boolean } & Record<string, unknown>) | null;
    if (!res.ok || !json || json.success !== true) {
      logger.warn(`[claw-eval-bench] ${path} → HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
      return null;
    }
    return json as unknown as T;
  } catch (err) {
    logger.warn(`[claw-eval-bench] ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface ClawDoc {
  benchmarkDocId?: string | null;
  title?: string;
  content: string;
}

/** 2nd agent (answerer): question + retrieved docs (full content) → plain answer text. Empty string = unavailable. */
export async function evalAnswer(input: { question: string; docs: ClawDoc[]; model?: string }): Promise<{ answer: string; model: string } | null> {
  return post<{ answer: string; model: string }>('/eval-answer', input);
}

/** Completeness judge: per-fact support + fraction. Null individual facts are treated unsupported on the client. */
export async function evalFacts(input: { answer: string; answerFacts: string[]; model?: string }): Promise<{ supported: boolean[]; completeness: number; model: string } | null> {
  return post<{ supported: boolean[]; completeness: number; model: string }>('/eval-facts', input);
}

export type RelevanceLabel = 'required' | 'valid' | 'invalid';
/** One gold-set-correction relevance vote. The caller runs 3× per doc and majority-votes. */
export async function evalRelevance(input: { question: string; doc: ClawDoc; model?: string }): Promise<{ label: RelevanceLabel; note: string; model: string } | null> {
  return post<{ label: RelevanceLabel; note: string; model: string }>('/eval-relevance', input);
}

/**
 * Paper §5.1 correctness judge (binary) — expected vs generated → { correct: 0|1, reasoning }.
 * Lenient on style, strict on factual conflicts; independent of answer_facts.
 */
export async function evalCorrectness(input: { expected: string; generated: string; model?: string }): Promise<{ correct: 0 | 1; reasoning: string; model: string } | null> {
  return post<{ correct: 0 | 1; reasoning: string; model: string }>('/eval-correctness', input);
}
