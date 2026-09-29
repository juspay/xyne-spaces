import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ACTIONS } from '@xyne/shared/assistant';
import type { ACLContext } from '@/database/acl/base-acl';
import { config } from '@/config/env';
import { superpositionClient } from '@/services/superpositionClient';
import { databaseFinder, redisSessionStore } from './adapters';
import { askJevInTime, JEV_TURN_MS } from './gateway';
import type { TurnServices } from './turn';

export { jevConnection } from './gateway';
export { handleTurn } from './turn';

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
  const deadline = Date.now() + JEV_TURN_MS;
  return {
    catalog: ACTIONS,
    sessions: redisSessionStore,
    records: databaseFinder(context),
    async askJev(state, questions) {
      const startedAt = performance.now();
      try {
        return await askJevInTime(state, questions, deadline);
      } finally {
        diagnostics?.jevMs.push(Math.round((performance.now() - startedAt) * 10) / 10);
      }
    },
    newId: randomUUID,
    debug: config.env !== 'production',
  };
}
