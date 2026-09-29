import { setTimeout as wait } from 'node:timers/promises';
import { config } from '@/config/env';
import { getAssistantJevDuration } from '@/services/otel/assistantMetrics';
import {
  askJev,
  type JevAnswer,
  type JevConnection,
  type JevFailure,
  type JevQuestion,
  type JevState,
} from '@/services/queryIntent/jevClient';
import { createBreaker } from './breaker';

/** Jev on the LiteLLM gateway, or null when the gateway is not set up. */
export function jevConnection(): JevConnection | null {
  const baseUrl = config.litellm.baseUrl.trim().replace(/\/$/, '');
  const { apiKey } = config.litellm;
  return baseUrl && apiKey ? { url: `${baseUrl}/v1/systemone`, apiKey, model: 'jev-latest' } : null;
}

/** Every Jev request of one turn shares this much time, so a turn always answers within it. */
export const JEV_TURN_MS = 8_000;
/**
 * Jev usually answers in a fraction of a second, so a request still open after this long is
 * an outlier: it is asked again alongside, and the first answer wins.
 */
export const JEV_SECOND_ASK_MS = 1_500;
/** After three outages in a row, Jev is not asked for 30 s. */
const jevBreaker = createBreaker(3, 30_000);

type JevAnswers = Record<string, JevAnswer>;

/** Jev or the gateway is down or busy, rather than this one request being unreadable. */
function isOutage(failure: JevFailure): boolean {
  if (failure.kind === 'status') return failure.status >= 500 || failure.status === 429;
  return failure.kind === 'timeout' || failure.kind === 'network';
}

/** Details may be missing (they are asked for), but not which action the sentence asks for. */
function isUsable(questions: Record<string, JevQuestion>, answers: JevAnswers): boolean {
  return !('action' in questions) || 'action' in answers;
}

/**
 * Asks Jev before `deadline`. A request that fails, or is still open after
 * `JEV_SECOND_ASK_MS`, is asked once more; whichever answers first is used and the other is
 * cancelled. While Jev is down the turn fails at once instead of waiting.
 */
export async function askJevInTime(
  state: JevState,
  questions: Record<string, JevQuestion>,
  deadline: number
): Promise<JevAnswers | null> {
  if (!jevBreaker.allows(Date.now())) return null;
  const connection = jevConnection();
  const startedAt = Date.now();
  const answered = new AbortController();
  const failures: JevFailure[] = [];

  const ask = async (): Promise<JevAnswers | null> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0 || answered.signal.aborted) return null;
    const answers = await askJev(state, questions, remainingMs, answered.signal, {
      connection,
      partial: true,
      onFailure: (failure) => failures.push(failure),
    });
    return answers && isUsable(questions, answers) ? answers : null;
  };

  const first = ask();
  const second = Promise.race([
    first,
    wait(JEV_SECOND_ASK_MS, undefined, { signal: answered.signal }).catch(() => undefined),
  ]).then((early) => early ?? ask());
  const answers = await Promise.race([
    first.then((found) => found ?? second),
    second.then((found) => found ?? first),
  ]);
  answered.abort();

  getAssistantJevDuration().record(Date.now() - startedAt, { ok: String(answers !== null) });
  if (answers) jevBreaker.record(true, Date.now());
  else if (failures.some(isOutage)) jevBreaker.record(false, Date.now());
  return answers;
}
