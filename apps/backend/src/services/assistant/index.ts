import { randomUUID } from 'node:crypto';
import { ACTIONS } from '@xyne/shared/assistant';
import { askJev, isJevConfigured } from '@/services/queryIntent/jevClient';
import {
  databaseFinder,
  isDetailsConfigured,
  readDetailsWithLiteLLM,
  redisSessionStore,
} from './adapters';
import type { TurnServices } from './turn';

export { handleTurn } from './turn';

/** Jev usually answers in well under a second; past this the turn reports a failure. */
const JEV_TIMEOUT_MS = 5000;

/** The assistant needs Jev for choosing actions and a LiteLLM model for reading details. */
export function isAssistantConfigured(): boolean {
  return isJevConfigured() && isDetailsConfigured();
}

/** The real services for one user's request. */
export function assistantServices(userId: string): TurnServices {
  return {
    catalog: ACTIONS,
    sessions: redisSessionStore,
    records: databaseFinder(userId),
    askJev: (state, questions) => askJev(state, questions, JEV_TIMEOUT_MS),
    readDetails: readDetailsWithLiteLLM,
    newId: randomUUID,
  };
}
