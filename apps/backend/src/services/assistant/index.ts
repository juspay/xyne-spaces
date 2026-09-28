import { randomUUID } from 'node:crypto';
import { ACTIONS } from '@xyne/shared/assistant';
import type { ACLContext } from '@/database/acl/base-acl';
import { config } from '@/config/env';
import {
  askJev,
  type JevAnswer,
  type JevQuestion,
  type JevState,
} from '@/services/queryIntent/jevClient';
import { databaseFinder, redisSessionStore } from './adapters';
import { jevConnection } from './gateway';
import type { TurnServices } from './turn';

export { jevConnection } from './gateway';
export { handleTurn } from './turn';

/** Jev usually answers in well under a second; past this the turn reports a failure. */
const JEV_TIMEOUT_MS = 5000;
/** A failure this fast is a refused request (a busy gateway), which a retry usually clears. */
const QUICK_FAILURE_MS = 1000;

/** Asks Jev, retrying once when the request was refused at once. A slow failure is not retried. */
async function askJevWithRetry(
  state: JevState,
  questions: Record<string, JevQuestion>
): Promise<Record<string, JevAnswer> | null> {
  const connection = jevConnection();
  const startedAt = Date.now();
  const answers = await askJev(state, questions, JEV_TIMEOUT_MS, undefined, { connection });
  if (answers || Date.now() - startedAt > QUICK_FAILURE_MS) return answers;
  return askJev(state, questions, JEV_TIMEOUT_MS, undefined, { connection });
}

/** The real services for one user's request. */
export function assistantServices(context: ACLContext): TurnServices {
  return {
    catalog: ACTIONS,
    sessions: redisSessionStore,
    records: databaseFinder(context),
    askJev: askJevWithRetry,
    newId: randomUUID,
    debug: config.env !== 'production',
  };
}
