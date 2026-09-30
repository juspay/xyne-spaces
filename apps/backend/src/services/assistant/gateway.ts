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
/** The first pause before asking again after a busy or failed gateway; it doubles each time. */
export const JEV_RETRY_PAUSE_MS = 250;
/** After three outages in a row, Jev is not asked for 30 s. */
const jevBreaker = createBreaker(3, 30_000);

type JevAnswers = Record<string, JevAnswer>;

/** The gateway is busy (429): it will answer soon, and Jev is not down. */
function isBusy(failure: JevFailure): boolean {
  return failure.kind === 'status' && failure.status === 429;
}

/** Jev or the gateway is down, rather than this one request being unreadable. */
function isOutage(failure: JevFailure): boolean {
  if (failure.kind === 'status') return failure.status >= 500;
  return failure.kind === 'timeout' || failure.kind === 'network';
}

/** Details may be missing (they are asked for), but not which action the sentence asks for. */
function isUsable(questions: Record<string, JevQuestion>, answers: JevAnswers): boolean {
  return !('action' in questions) || 'action' in answers;
}

/**
 * Asks Jev before `deadline`. A busy or failed request is asked again after a pause that
 * doubles each time, and one still open after `JEV_SECOND_ASK_MS` is asked again alongside;
 * the first answer is used and the rest are cancelled. Only outages count toward the breaker,
 * so while Jev is down a turn fails at once, but a busy gateway never stops the assistant.
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
  const pause = (ms: number): Promise<void> =>
    wait(ms, undefined, { signal: answered.signal }).catch(() => undefined);

  const ask = async (): Promise<JevAnswers | null> => {
    const answers = await askJev(state, questions, deadline - Date.now(), answered.signal, {
      connection,
      partial: true,
      onFailure: (failure) => failures.push(failure),
    });
    return answers && isUsable(questions, answers) ? answers : null;
  };

  const askUntilAnswered = async (): Promise<JevAnswers | null> => {
    for (let pauseMs = JEV_RETRY_PAUSE_MS; ; pauseMs *= 2) {
      if (answered.signal.aborted || Date.now() >= deadline) return null;
      const failed = failures.length;
      const answers = await ask();
      const failure = failures[failed];
      if (answers || !failure || !(isBusy(failure) || isOutage(failure))) return answers;
      if (Date.now() + pauseMs >= deadline) return null;
      await pause(pauseMs);
    }
  };

  const first = askUntilAnswered();
  const stillOpen = Promise.race([
    first.then(() => false),
    pause(JEV_SECOND_ASK_MS).then(() => true),
  ]);
  const second = stillOpen.then((open) => (open ? askUntilAnswered() : null));
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
