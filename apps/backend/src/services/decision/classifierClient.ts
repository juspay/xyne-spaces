import { logger } from '@/utils/logger';
import { config as envConfig } from '@/config/env';
import type {
  AskFailure,
  ClassifierEngine,
  ClassifierTarget,
  DecisionAnswer,
  DecisionQuestion,
  ScoreQuestion,
  TokenUsage,
  YesNoQuestion,
} from './types';

/**
 * Client for typed classifiers (XOR, Jev): POST a state plus questions, get probabilities
 * back, with no text generation. https://jevai.wiki
 *
 * Endpoint and model are config, not code, so it talks to any service that speaks this wire
 * format (TypeSafe's hosted Jev, LiteLLM's /v1/decisions, a fine-tuned copy).
 *
 * Switching service or model changes probability calibration, so thresholds tuned against
 * one must be re-tuned for another.
 */

const ERROR_BODY_LIMIT = 2048;
const ERROR_TYPE = /^[a-z0-9_.-]{1,64}$/i;
const OVER_OPTION_LIMIT = /\b\d+\.\.\d+ options, got \d+\b/;

/** Hostname of the endpoint for logs, or undefined when the URL doesn't parse. */
const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

/**
 * A safe label for a non-2xx reply: LiteLLM's `error.type` when it looks like an
 * identifier, `html` for a gateway page, else `unknown`. The body is read (capped) and
 * released, but never logged or returned: it can echo the request, and the grid's
 * `error.message` includes part of the API key.
 */
const readErrorType = async (response: Response): Promise<string> => {
  let text = '';
  try {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (reader && text.length < ERROR_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader?.cancel();
  } catch {
    // A body that can't be read is just an unknown error type.
  }
  if (response.headers.get('content-type')?.includes('html') || text.trimStart().startsWith('<')) {
    return 'html';
  }
  try {
    const error = (JSON.parse(text) as { error?: unknown } | null)?.error;
    // Jev and XOR refuse a choice past their option limit with a plain message ("action: 2..64
    // options, got 120"): named, so the log says why without carrying the body.
    if (typeof error === 'string' && OVER_OPTION_LIMIT.test(error)) return 'options_over_limit';
    const type = (error as { type?: unknown } | null | undefined)?.type;
    return typeof type === 'string' && ERROR_TYPE.test(type) ? type : 'unknown';
  } catch {
    return 'unknown';
  }
};

const isProbability = (p: unknown): p is number => typeof p === 'number' && p >= 0 && p <= 1;

/**
 * Jev reports a score as the expected level index (0..n-1, e.g. 1.98 with 3 levels). Derived
 * from the per-level probabilities when all are present, so it is right whichever endpoint
 * answered; otherwise the index is rescaled.
 */
const readScore = (
  question: ScoreQuestion,
  answer: Record<string, unknown>
): DecisionAnswer | null => {
  const top = question.criteria.length - 1;
  if (top < 1 || typeof answer.score !== 'number' || !Number.isFinite(answer.score)) return null;

  const raw = (answer.probabilities ?? {}) as Record<string, unknown>;
  const probabilities = question.criteria.map((_, level) => raw[String(level)]);
  const complete = probabilities.every(isProbability);
  const total = complete ? probabilities.reduce((sum, p) => sum + p, 0) : 0;

  const index =
    complete && total > 0
      ? probabilities.reduce((sum, p, level) => sum + level * p, 0) / total
      : answer.score;
  const score = Math.min(1, Math.max(0, index / top));
  const level = complete
    ? probabilities.indexOf(Math.max(...probabilities))
    : Math.round(score * top);
  const confidence = isProbability(answer.confidence)
    ? answer.confidence
    : complete
      ? probabilities[level]
      : undefined;
  return { type: 'score', score, level, ...(confidence !== undefined ? { confidence } : {}) };
};

/** The answer to `question`, or null when Jev's reply for it is unusable. */
const readAnswer = (question: DecisionQuestion, raw: unknown): DecisionAnswer | null => {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;

  if (question.type === 'noul') {
    return isProbability(answer.noul) ? { type: 'noul', noul: answer.noul } : null;
  }

  if (question.type === 'score') return readScore(question, answer);

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
 * `questions` asked as yes/no whatever `type` says: they can come from remote config, where
 * it may be missing.
 */
export const asNoulQuestions = (
  questions: Record<string, YesNoQuestion>
): Record<string, YesNoQuestion> =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]): [string, YesNoQuestion] => [
      key,
      { ...question, type: 'noul' },
    ])
  );

/** The reply's `usage` ({ input_tokens, output_tokens }); undefined when it gave no counts. */
const readUsage = (usage: { input_tokens?: unknown; output_tokens?: unknown } | undefined): TokenUsage | undefined => {
  const promptTokens = Number(usage?.input_tokens);
  const completionTokens = Number(usage?.output_tokens);
  return Number.isFinite(promptTokens) && Number.isFinite(completionTokens) ? { promptTokens, completionTokens } : undefined;
};

/** P(yes) per question; null when there are no answers or any is not a yes/no. */
export const readNouls = (answers: Record<string, DecisionAnswer> | null): Record<string, number> | null => {
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
 * answer is unusable — same all-or-nothing rule as readNouls. With `partial`, an
 * unusable answer is left out instead, for a batch of independent questions where
 * one bad answer should not cost the rest; null then only when none is usable.
 * `signal` cancels the request early, e.g. when the caller's own client has gone.
 * `target` sends it to another service with the same wire format, e.g. XOR; `engine` names
 * it in logs. `onUsage` gets the tokens the reply reports, whether or not its answers are usable. Never throws.
 */
export const requestClassifierAnswers = async (
  state: string | Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number,
  signal?: AbortSignal,
  {
    partial = false,
    onFailure,
    onUsage,
    target = envConfig.jev,
    engine = 'jev',
  }: {
    partial?: boolean;
    onFailure?: (failure: AskFailure) => void;
    onUsage?: (usage: TokenUsage) => void;
    target?: ClassifierTarget;
    engine?: ClassifierEngine;
  } = {}
): Promise<Record<string, DecisionAnswer> | null> => {
  const { apiKey, url, model } = target;
  if (!apiKey) return null;
  const logContext = { engine, model, host: hostOf(url) };

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
      const errorType = await readErrorType(response);
      // Cancelled by the caller while the body was read: not a failure, as in the catch below.
      if (signal?.aborted) return null;
      logger.warn('Classifier request failed', { status: response.status, errorType, ...logContext });
      onFailure?.({ kind: 'status', status: response.status });
      return null;
    }

    const body = (await response.json()) as {
      answers?: Record<string, unknown>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const usage = readUsage(body.usage);
    if (usage) onUsage?.(usage);
    const answers: Record<string, DecisionAnswer> = {};
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
      logger.warn('Classifier answered with no usable probability', {
        questions: unusable.slice(0, 5),
        unusable: unusable.length,
        of: Object.keys(questions).length,
        ...logContext,
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
    logger.warn(`Classifier request ${timedOut ? `timed out after ${timeoutMs}ms` : 'errored'}`, {
      error: error instanceof Error ? error.name : 'unknown',
      ...logContext,
    });
    onFailure?.({ kind: timedOut ? 'timeout' : 'network' });
    return null;
  }
};
