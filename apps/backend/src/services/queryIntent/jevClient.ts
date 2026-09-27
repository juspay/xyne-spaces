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

/** A yes/no question. Jev also has `score`; add it when a caller needs one. */
export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

/** Pick one of up to 255 options, each keyed by id and described in plain words. */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion;

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice';
      choice: string;
      /** Probability per option id. */
      probabilities: Record<string, number>;
      /** Jev's confidence in `choice`. */
      confidence: number;
    };

export const isJevConfigured = (): boolean => Boolean(envConfig.jev.apiKey);

const isProbability = (p: unknown): p is number => typeof p === 'number' && p >= 0 && p <= 1;

/** The answer to `question`, or null when Jev's reply for it is unusable. */
const readAnswer = (question: JevQuestion, raw: unknown): JevAnswer | null => {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;

  if (question.type === 'noul') {
    return isProbability(answer.noul) ? { type: 'noul', noul: answer.noul } : null;
  }

  const choice = answer.choice;
  if (typeof choice !== 'string' || !(choice in question.criteria)) return null;
  const probabilities: Record<string, number> = {};
  if (answer.probabilities && typeof answer.probabilities === 'object') {
    for (const [option, p] of Object.entries(answer.probabilities as Record<string, unknown>)) {
      if (isProbability(p)) probabilities[option] = p;
    }
  }
  const confidence = isProbability(answer.confidence) ? answer.confidence : probabilities[choice];
  if (!isProbability(confidence)) return null;
  return { type: 'choice', choice, probabilities, confidence };
};

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
  const answers = await askJev(state, questions, timeoutMs);
  if (!answers) return null;
  const probabilities: Record<string, number> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (answer.type !== 'noul') return null;
    probabilities[key] = answer.noul;
  }
  return probabilities;
};

/**
 * Answers to any mix of questions about one `state`, in a single request. `state` is
 * a string or a JSON object; questions can point into an object with backticked paths
 * like `candidate.text`. Keyed like `questions`, and null when Jev can't answer or any
 * answer is unusable — same all-or-nothing rule as askJevNouls. `signal` cancels the
 * request early, e.g. when the caller's own client has gone. Never throws.
 */
export const askJev = async (
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Record<string, JevAnswer> | null> => {
  const { apiKey, url, model } = envConfig.jev;
  if (!apiKey) return null;

  try {
    const response = await fetch(url || DEFAULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, state, questions }),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // Status only: an error body can echo the request, which carries user text.
      logger.warn('Jev request failed', { status: response.status });
      return null;
    }

    const body = (await response.json()) as { answers?: Record<string, unknown> };
    const answers: Record<string, JevAnswer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = readAnswer(question, body.answers?.[key]);
      if (!answer) {
        logger.warn('Jev answered with no usable probability', { question: key });
        return null;
      }
      answers[key] = answer;
    }
    return answers;
  } catch (error) {
    // Cancelled by the caller: nothing went wrong, so nothing to report.
    if (signal?.aborted) return null;
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    logger.warn(`Jev request ${timedOut ? `timed out after ${timeoutMs}ms` : 'errored'}`, {
      error,
    });
    return null;
  }
};
