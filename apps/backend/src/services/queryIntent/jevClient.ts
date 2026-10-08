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
      /** Jev's confidence in `choice`, when it gave one. */
      confidence?: number;
    };

/** Why a Jev call came back empty; a caller cancelling it is not a failure. */
export type JevFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'status'; status: number }
  | { kind: 'unusable' };

export const isJevConfigured = (): boolean => Boolean(envConfig.jev.apiKey);

export const isPrivateJevConfigured = (): boolean =>
  isJevConfigured() && Boolean(process.env.JEV_URL?.trim());

const isProbability = (p: unknown): p is number => typeof p === 'number' && p >= 0 && p <= 1;

/** The answer to `question`, or null when Jev's reply for it is unusable. */
const readAnswer = (question: JevQuestion, raw: unknown): JevAnswer | null => {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;

  if (question.type === 'noul') {
    return isProbability(answer.noul) ? { type: 'noul', noul: answer.noul } : null;
  }

  const choice = answer.choice;
  // Own keys only: `in` would also accept "constructor" and the like.
  const isOption =
    typeof choice === 'string' && Object.prototype.hasOwnProperty.call(question.criteria, choice);
  if (!isOption) return null;
  const probabilities: Record<string, number> = {};
  if (answer.probabilities && typeof answer.probabilities === 'object') {
    for (const [option, p] of Object.entries(answer.probabilities as Record<string, unknown>)) {
      if (isProbability(p)) probabilities[option] = p;
    }
  }
  const confidence = isProbability(answer.confidence) ? answer.confidence : probabilities[choice];
  return {
    type: 'choice',
    choice,
    probabilities,
    ...(isProbability(confidence) ? { confidence } : {}),
  };
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
  // Asked as yes/no whatever `type` says: questions can come from remote config,
  // where it may be missing.
  const asNoul = Object.fromEntries(
    Object.entries(questions).map(([key, question]): [string, JevNoulQuestion] => [
      key,
      { ...question, type: 'noul' },
    ])
  );
  const answers = await askJev(state, asNoul, timeoutMs);
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
 * answer is unusable — same all-or-nothing rule as askJevNouls. With `partial`, an
 * unusable answer is left out instead, for a batch of independent questions where
 * one bad answer should not cost the rest; null then only when none is usable.
 * `signal` cancels the request early, e.g. when the caller's own client has gone.
 * Never throws.
 */
export const askJev = async (
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  timeoutMs: number,
  signal?: AbortSignal,
  {
    partial = false,
    onFailure,
  }: { partial?: boolean; onFailure?: (failure: JevFailure) => void } = {}
): Promise<Record<string, JevAnswer> | null> => {
  const { apiKey, url, model } = envConfig.jev;
  if (!apiKey) return null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, state, questions }),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // Status only: an error body can echo the request, which carries user text. The
      // body is still released, so the connection goes back to the pool.
      logger.warn('Jev request failed', { status: response.status });
      await response.body?.cancel();
      onFailure?.({ kind: 'status', status: response.status });
      return null;
    }

    const body = (await response.json()) as { answers?: Record<string, unknown> };
    const answers: Record<string, JevAnswer> = {};
    const unusable: string[] = [];
    for (const [key, question] of Object.entries(questions)) {
      const answer = readAnswer(question, body.answers?.[key]);
      if (answer) {
        answers[key] = answer;
      } else {
        unusable.push(key);
      }
    }
    if (unusable.length > 0) {
      logger.warn('Jev answered with no usable probability', {
        questions: unusable.slice(0, 5),
        unusable: unusable.length,
        of: Object.keys(questions).length,
      });
      if (!partial || unusable.length === Object.keys(questions).length) {
        onFailure?.({ kind: 'unusable' });
        return null;
      }
    }
    return answers;
  } catch (error) {
    // Cancelled by the caller: nothing went wrong, so nothing to report.
    if (signal?.aborted) return null;
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    // The error's name only: a reply that isn't JSON fails with a message quoting it,
    // and it can echo the request.
    logger.warn(`Jev request ${timedOut ? `timed out after ${timeoutMs}ms` : 'errored'}`, {
      error: error instanceof Error ? error.name : 'unknown',
    });
    onFailure?.({ kind: timedOut ? 'timeout' : 'network' });
    return null;
  }
};
