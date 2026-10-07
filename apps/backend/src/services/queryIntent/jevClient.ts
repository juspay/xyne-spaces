import { Agent } from 'undici';
import { logger } from '@/utils/logger';
import { isProbability } from '@/utils/probability';
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

// Node's fetch drops an idle connection after ~4 s, so a call after a pause pays a new TCP+TLS
// handshake (+100–400 ms). Keeping it open for 30 s covers a conversation's pauses.
const jevAgent = new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000 });

const WARM_EVERY_MS = 20_000;
const WARM_TIMEOUT_MS = 5000;
let lastWarmAt = 0;

/**
 * Opens the connection to Jev ahead of a call, e.g. while the user is still speaking. A HEAD
 * does no model work (the endpoint answers 405 without auth), and at most one goes out per
 * 20 s. Fire and forget: a failure only means the real call opens the connection itself.
 */
export const warmJev = (): void => {
  const { apiKey, url } = envConfig.jev;
  const now = Date.now();
  if (!apiKey || now - lastWarmAt < WARM_EVERY_MS) return;
  lastWarmAt = now;
  fetch(url, {
    method: 'HEAD',
    dispatcher: jevAgent,
    signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
  } as unknown as RequestInit)
    .then((response) => {
      logger.debug('Jev connection warmed', { status: response.status, ms: Date.now() - now });
      return response.body?.cancel();
    })
    .catch(() => undefined);
};

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

type Attempt = { answers: Record<string, JevAnswer> | null; failure?: JevFailure };

/** The first attempt to give an answer wins; when none does, the last to finish is the outcome. */
const firstUsable = (attempts: Promise<Attempt>[]): Promise<Attempt> =>
  new Promise((resolve) => {
    let pending = attempts.length;
    for (const attempt of attempts) {
      void attempt.then((outcome) => {
        pending -= 1;
        if (outcome.answers || pending === 0) resolve(outcome);
      });
    }
  });

/** `first`, and once it has been pending for `afterMs`, a second identical attempt beside it. */
const hedged = async (
  first: Promise<Attempt>,
  second: () => Promise<Attempt>,
  afterMs: number
): Promise<Attempt> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, afterMs, null);
  });
  const early = await Promise.race([first, slow]);
  clearTimeout(timer);
  if (early) return early;
  logger.info('Jev request hedged', { afterMs });
  return firstUsable([first, second()]);
};

/**
 * Answers to any mix of questions about one `state`, in a single request. `state` is
 * a string or a JSON object; questions can point into an object with backticked paths
 * like `candidate.text`. Keyed like `questions`, and null when Jev can't answer or any
 * answer is unusable — same all-or-nothing rule as askJevNouls. With `partial`, an
 * unusable answer is left out instead, for a batch of independent questions where
 * one bad answer should not cost the rest; null then only when none is usable.
 * `signal` cancels the request early, e.g. when the caller's own client has gone.
 * `hedgeAfterMs`: when the first attempt is still pending after that long, an identical
 * second one starts beside it; the first to answer wins and the other is aborted. A call
 * that is usually fast but sometimes slow finishes sooner this way, at the cost of the
 * occasional duplicate request. `timeoutMs` and `signal` bound both attempts together.
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
    hedgeAfterMs,
  }: {
    partial?: boolean;
    onFailure?: (failure: JevFailure) => void;
    hedgeAfterMs?: number;
  } = {}
): Promise<Record<string, JevAnswer> | null> => {
  const { apiKey, url, model } = envConfig.jev;
  if (!apiKey) return null;

  // Aborted once the call is over, which stops the attempt that did not win.
  const over = new AbortController();
  const bound = AbortSignal.any(
    signal
      ? [AbortSignal.timeout(timeoutMs), signal, over.signal]
      : [AbortSignal.timeout(timeoutMs), over.signal]
  );

  const attempt = async (): Promise<Attempt> => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, state, questions }),
        signal: bound,
        // `dispatcher` is an undici extension not in the DOM RequestInit type.
        dispatcher: jevAgent,
      } as unknown as RequestInit);
      if (!response.ok) {
        // Status only: an error body can echo the request, which carries user text. The
        // body is still released, so the connection goes back to the pool.
        await response.body?.cancel();
        return { answers: null, failure: { kind: 'status', status: response.status } };
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
        if (!partial || unusable.length === Object.keys(questions).length) {
          return { answers: null, failure: { kind: 'unusable' } };
        }
        // Question keys only: they name fields, never what the user said.
        logger.warn('Jev left some questions unanswered', {
          questions: unusable.slice(0, 5),
          of: Object.keys(questions).length,
        });
      }
      return { answers };
    } catch (error) {
      // Cancelled by the caller, or by the other attempt winning: nothing went wrong, so
      // nothing to report.
      if (signal?.aborted || over.signal.aborted) return { answers: null };
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return { answers: null, failure: { kind: timedOut ? 'timeout' : 'network' } };
    }
  };

  try {
    const first = attempt();
    const outcome =
      hedgeAfterMs === undefined ? await first : await hedged(first, attempt, hedgeAfterMs);
    // Logged once, from the final outcome, so hedged attempts do not each report the same failure.
    // The failure kind and status only: an error's message can echo the request, which carries user text.
    if (!outcome.answers && outcome.failure) {
      logger.warn('Jev request failed', { ...outcome.failure, timeoutMs });
      onFailure?.(outcome.failure);
    }
    return outcome.answers;
  } finally {
    over.abort();
  }
};
