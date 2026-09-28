import { logger } from '@/utils/logger';
import { config as envConfig } from '@/config/env';

/**
 * Client for Jev — a typed classifier: POST a state plus a question, get a probability
 * back, with no text generation. https://jevai.wiki
 *
 * Endpoint and model are config, not code, so this client can talk to any service that
 * speaks the same wire format (TypeSafe's hosted Jev, a LiteLLM-hosted jev, a fine-tuned
 * copy): set JEV_URL and JEV_MODEL. Unset JEV_API_KEY => the feature stays off.
 *
 * Switching service or model changes probability calibration, so the thresholds in
 * index.ts must be re-tuned against whichever one is live.
 */

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
/** Pinned, not a floating alias: thresholds are only valid for the model they were tuned on. */
const DEFAULT_MODEL = 'jev-1.13.0';

/** A yes/no question. Jev also has `choice` and `score`; add them when a caller needs one. */
export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export const isJevConfigured = (): boolean => Boolean(envConfig.jev.apiKey);

/**
 * P(yes) for one question about `state`, or null when Jev can't answer: no key, timeout,
 * non-2xx, or a malformed reply. Never throws, so callers need no try/catch.
 */
export const askJevNoul = async (
  state: string,
  question: JevNoulQuestion,
  timeoutMs: number
): Promise<number | null> => {
  const answers = await askJevNouls(state, { q: question }, timeoutMs);
  return answers?.q ?? null;
};

/**
 * P(yes) for several questions about one `state`, in a single request — Jev answers a
 * batch in about the time it takes to answer one. Keyed like `questions`. Null when
 * Jev can't answer, or when any answer is unusable: a partial batch would read as
 * "every missing question is a no". Never throws.
 */
export const askJevNouls = async (
  state: string,
  questions: Record<string, JevNoulQuestion>,
  timeoutMs: number
): Promise<Record<string, number> | null> => {
  const { apiKey, url, model } = envConfig.jev;
  if (!apiKey) return null;

  try {
    const response = await fetch(url || DEFAULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // Status only: an error body can echo the request, which carries user text.
      logger.warn('Jev request failed', { status: response.status });
      return null;
    }

    const body = (await response.json()) as { answers?: Record<string, { noul?: unknown }> };
    const answers: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const p = body.answers?.[key]?.noul;
      if (typeof p !== 'number' || p < 0 || p > 1) {
        logger.warn('Jev answered with no usable probability', { question: key });
        return null;
      }
      answers[key] = p;
    }
    return answers;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    logger.warn(`Jev request ${timedOut ? `timed out after ${timeoutMs}ms` : 'errored'}`, {
      error,
    });
    return null;
  }
};
