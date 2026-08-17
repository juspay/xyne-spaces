/**
 * Claw Operation Registry
 *
 * Maps SDK Claw methods to the remote-agent service. Claw is not part of the Zero
 * catalog, so every operation is a direct API call — same pattern as search.
 *
 * Claw lives on the same host as Spaces but under a different path prefix, served
 * by a different service (`apps/xyne-claw-auth`) with its own credential. See
 * `core/claw-auth.ts` for why the Spaces token cannot be reused here.
 */

import { api } from './types.js';
import type { ClawAgent, ClawRun, ClawRunInput, ClawSession } from '../types/index.js';

/** Path prefix for every Claw endpoint. */
export const CLAW_API_PATH = '/claw/api/v1';

/** Device-flow paths, used directly by `ClawAuth` (they take no bearer token). */
export const CLAW_AUTH_START_PATH = `${CLAW_API_PATH}/cli/auth/start`;
export const CLAW_AUTH_TOKEN_PATH = `${CLAW_API_PATH}/cli/auth/token`;

/** The client id claw-auth expects from CLI-style callers. */
export const CLAW_CLIENT_ID = 'xyne-cli';

/**
 * Statuses that mean a run has stopped moving. Anything else is still in flight.
 * `cancelled` and `canceled` both occur in the wild.
 */
export const TERMINAL_RUN_STATUSES: readonly string[] = [
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'error',
];

/** Read the first present string among `keys`. */
function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Unwrap claw-auth's `{ success, data }` envelope.
 *
 * Every response is wrapped, so reading the top level directly yields nothing.
 */
export function unwrap(raw: unknown): Record<string, unknown> {
  const envelope = asObject(raw);
  const data = envelope['data'];
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : envelope;
}

/**
 * Find a list inside a response, tolerating the envelope.
 *
 * Checks the raw value, then `data`, then the named keys at either level. Without
 * this, list calls silently return `[]` rather than failing visibly.
 */
export function coerceList(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const envelope = asObject(raw);

  const data = envelope['data'];
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  for (const key of keys) {
    const value = envelope[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function toAgent(item: unknown): ClawAgent {
  const o = asObject(item);
  const agent: ClawAgent = { slug: str(o, 'slug', 'agentSlug') ?? '' };
  const name = str(o, 'name', 'displayName');
  const description = str(o, 'description');
  if (name !== undefined) agent.name = name;
  if (description !== undefined) agent.description = description;
  return agent;
}

function toSession(item: unknown): ClawSession {
  const o = asObject(item);
  const session: ClawSession = { sessionId: str(o, 'sessionId', 'session_id', 'id') ?? '' };
  const agentSlug = str(o, 'agentSlug', 'agent_slug', 'agent');
  const status = str(o, 'status');
  const title = str(o, 'title', 'summary', 'name');
  const createdAt = str(o, 'createdAt', 'created_at');
  if (agentSlug !== undefined) session.agentSlug = agentSlug;
  if (status !== undefined) session.status = status;
  if (title !== undefined) session.title = title;
  if (createdAt !== undefined) session.createdAt = createdAt;
  return session;
}

/** Build a `ClawRun` from an already-unwrapped run row. */
export function toRun(sessionId: string, row: Record<string, unknown>): ClawRun {
  const run: ClawRun = { sessionId, status: str(row, 'status') ?? 'unknown' };
  const result = str(row, 'result', 'response', 'output', 'lastAssistantText');
  const error = str(row, 'error', 'errorMessage');
  if (result !== undefined) run.result = result;
  if (error !== undefined) run.error = error;
  return run;
}

export const clawOperations = {
  /**
   * List agents this account can dispatch to.
   * Maps to: GET /claw/api/v1/agents
   */
  listAgents: api<void, ClawAgent[]>('GET', `${CLAW_API_PATH}/agents`, {
    mapResult: (raw) => coerceList(raw, 'agents').map(toAgent),
  }),

  /**
   * List recent runs.
   * Maps to: GET /claw/api/v1/runs/light
   */
  listSessions: api<{ limit: number }, ClawSession[]>('GET', `${CLAW_API_PATH}/runs/light`, {
    mapArgs: (args) => ({ limit: args.limit }),
    mapResult: (raw) => coerceList(raw, 'runs', 'sessions').map(toSession),
  }),

  /**
   * Dispatch a task to an agent.
   * Maps to: POST /claw/api/v1/run
   *
   * A conversationId is always sent: claw-auth only writes the AgentRun row that
   * `getRun` reads when one is present, so a run created without it can never be
   * polled. One is generated when the caller supplies none.
   */
  createRun: api<Required<Pick<ClawRunInput, 'agent' | 'task' | 'conversationId'>> &
    Pick<ClawRunInput, 'channelId' | 'deliverTo'>, string>('POST', `${CLAW_API_PATH}/run`, {
    mapArgs: (args) => ({
      agentSlug: args.agent,
      task: args.task,
      triggerSource: 'api',
      conversationId: args.conversationId,
      ...(args.channelId ? { channelId: args.channelId } : {}),
      ...(args.deliverTo ? { deliverTo: args.deliverTo } : {}),
    }),
    mapResult: (raw) => {
      const sessionId = str(unwrap(raw), 'sessionId', 'session_id', 'id');
      if (!sessionId) {
        throw new Error('Claw did not return a sessionId for the new run.');
      }
      return sessionId;
    },
  }),

  /**
   * Fetch one run's full row.
   * Maps to: GET /claw/api/v1/runs/:sessionId
   *
   * Returns the raw row; the resource pairs it with the session id it asked for
   * rather than trusting the row to echo one back.
   */
  getRun: api<{ sessionId: string }, Record<string, unknown>>(
    'GET',
    (args) => `${CLAW_API_PATH}/runs/${encodeURIComponent(args.sessionId)}`,
    {
      // The id is in the path; sending it again as a query param would be noise.
      mapArgs: () => undefined,
      mapResult: (raw) => unwrap(raw),
    }
  ),
} as const;
