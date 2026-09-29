import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ACTIONS } from '@xyne/shared/assistant';
import type { ACLContext } from '@/database/acl/base-acl';
import { config } from '@/config/env';
import {
  askJev,
  type JevAnswer,
  type JevQuestion,
  type JevState,
} from '@/services/queryIntent/jevClient';
import { getAssistantJevDuration } from '@/services/otel/assistantMetrics';
import { superpositionClient } from '@/services/superpositionClient';
import { databaseFinder, redisSessionStore } from './adapters';
import { createBreaker } from './breaker';
import { jevConnection } from './gateway';
import type { TurnServices } from './turn';

export { jevConnection } from './gateway';
export { handleTurn } from './turn';

/** Give Jev more room for assistant turns before the existing recovery path takes over. */
const JEV_TIMEOUT_MS = 10_000;
/** A failure this fast is a refused request (a busy gateway), which a retry usually clears. */
const QUICK_FAILURE_MS = 1000;
/** After three failed requests in a row, Jev is not asked for 30 s. */
const jevBreaker = createBreaker(3, 30_000);

/**
 * Asks Jev, retrying once when the request was refused at once. A slow failure is not retried,
 * and while Jev keeps failing the turn fails at once instead of waiting.
 */
async function askJevWithRetry(
  state: JevState,
  questions: Record<string, JevQuestion>
): Promise<Record<string, JevAnswer> | null> {
  if (!jevBreaker.allows(Date.now())) return null;
  const connection = jevConnection();
  const startedAt = Date.now();
  const deadline = startedAt + JEV_TIMEOUT_MS;
  const ask = async (): Promise<Record<string, JevAnswer> | null> => {
    const attemptStartedAt = Date.now();
    const remainingMs = Math.max(1, deadline - attemptStartedAt);
    const answers = await askJev(state, questions, remainingMs, undefined, { connection });
    getAssistantJevDuration().record(Date.now() - attemptStartedAt, { ok: String(answers !== null) });
    jevBreaker.record(answers !== null, Date.now());
    return answers;
  };
  const answers = await ask();
  if (answers || Date.now() - startedAt > QUICK_FAILURE_MS) return answers;
  return ask();
}

/** Longest wait for the on/off flag; without an answer in time, the assistant stays on. */
const FLAG_TIMEOUT_MS = 300;

/** The ASSISTANT_ENABLED flag turns the assistant off without a deploy. */
export async function isAssistantOn(workspaceId: string, userId: string): Promise<boolean> {
  const flag = superpositionClient
    .getBooleanValue('ASSISTANT_ENABLED', true, { workspaceId, userId })
    .catch(() => true);
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(true), FLAG_TIMEOUT_MS)
  );
  return Promise.race([flag, timeout]);
}

/** Time spent in Jev during one turn, for the Diagnose log. */
export interface AssistantRequestDiagnostics {
  jevMs: number[];
}

/** The real services for one user's request. */
export function assistantServices(
  context: ACLContext,
  diagnostics?: AssistantRequestDiagnostics
): TurnServices {
  return {
    catalog: ACTIONS,
    sessions: redisSessionStore,
    records: databaseFinder(context),
    async askJev(state, questions) {
      const startedAt = performance.now();
      try {
        return await askJevWithRetry(state, questions);
      } finally {
        diagnostics?.jevMs.push(Math.round((performance.now() - startedAt) * 10) / 10);
      }
    },
    newId: randomUUID,
    debug: config.env !== 'production',
  };
}
