import { type RouteBody } from '@xyne/shared';
import type { clientEventsPost, clientEventsRemove } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { ContractError } from '@/framework/api';
import { redisService } from '@/services/redisService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { requireUser } from '../settings.helpers';

// ─── Client events and header overrides ─────────────────────────────────────

const MAX_TOTAL_SIZE = 4096;
const DEFAULT_LOADING_SECONDS = 3;
// Clients apply these as request headers and as cookies on the app's domain, so only the
// routing override the edge and CAC act on is accepted: x-route-env picks a dashboard-edge
// lane and the CAC environment.
const ALLOWED_HEADERS = new Set(['x-route-env']);
const ALLOWED_VALUE = /^[a-z0-9-]{1,32}$/;

const invalidRequest = (message: string) => new ContractError(400, { error: 'Invalid request', message });

function validateHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw invalidRequest('payload.headers must be an object of name/value string pairs');
  }
  const normalized: Record<string, string> = {};
  let totalSize = 0;
  for (const [rawName, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== 'string') throw invalidRequest(`Value for header ${rawName} must be a string`);
    const name = rawName.toLowerCase();
    if (!ALLOWED_HEADERS.has(name)) throw invalidRequest(`Header not allowed: ${rawName}`);
    if (!ALLOWED_VALUE.test(value)) throw invalidRequest(`Value for header ${rawName} must match ${ALLOWED_VALUE}`);
    totalSize += name.length + value.length;
    normalized[name] = value;
  }
  if (totalSize > MAX_TOTAL_SIZE) throw invalidRequest(`headers too large: at most ${MAX_TOTAL_SIZE} chars in total`);
  return normalized;
}

/** The ids that belong to the caller's workspace. */
async function filterToCallerWorkspace(user: AuthenticatedUser | undefined, userIds: string[]): Promise<Set<string>> {
  const workspaceId = user?.workspaceId;
  if (!workspaceId || userIds.length === 0) return new Set();
  const users = await withWorkspaceScope(() =>
    DatabaseClient.getInstance().user.findMany({ where: { id: { in: userIds }, workspaceId }, select: { id: true } }),
  );
  return new Set(users.map((u) => u.id));
}

async function requireInCallerWorkspace(user: AuthenticatedUser | undefined, userIds: string[]): Promise<void> {
  const allowed = await filterToCallerWorkspace(user, userIds);
  if (!userIds.every((id) => allowed.has(id))) {
    throw new ContractError(403, { error: 'Forbidden', message: 'All userIds must belong to your workspace' });
  }
}

async function publishClientCommand(
  userId: string,
  event: 'header_update' | 'reload',
  payload: Record<string, unknown>,
  options: { force: boolean; loadingSeconds: number },
): Promise<boolean> {
  try {
    await redisService.broadcastUserEvent(userId, {
      type: 'client_command',
      userId,
      data: { event, payload, force: options.force, loadingSeconds: options.loadingSeconds },
      timestamp: new Date(),
    });
    return true;
  } catch (error) {
    logger.error(`[CLIENT-EVENT] Failed to publish ${event} for user ${userId}:`, error);
    return false;
  }
}

function clientEventFailure(error: unknown, logMessage: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
}

/** GET /client-events/me: the caller's own overrides; ones saved before the allowlist existed are not handed back. */
export async function myHeaderOverrides(input: { user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const stored = await redisService.getUserHeaderOverrides(user.id);
    return Object.fromEntries(
      Object.entries(stored ?? {}).filter(
        ([name, value]) => ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string' && ALLOWED_VALUE.test(value),
      ),
    ) as Record<string, string>;
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to get own header overrides:');
  }
}

/** GET /client-events: every override of users in the caller's workspace. */
export async function allHeaderOverrides(input: { user: AuthenticatedUser | undefined }) {
  try {
    const overrides = await redisService.getAllUserHeaderOverrides();
    const allowed = await filterToCallerWorkspace(input.user, Object.keys(overrides));
    return Object.fromEntries(Object.entries(overrides).filter(([userId]) => allowed.has(userId)));
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to get header overrides:');
  }
}

/** POST /client-events: push a command (header_update or reload) to users' browsers. */
export async function postClientEvent(input: { body: RouteBody<typeof clientEventsPost>; user: AuthenticatedUser | undefined }) {
  try {
    const { userIds, event, payload } = input.body;
    const force = input.body.force === true;
    const loadingSeconds = input.body.loadingSeconds ?? DEFAULT_LOADING_SECONDS;
    const rawPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    await requireInCallerWorkspace(input.user, userIds);

    const options = { force, loadingSeconds };
    const results: Array<{ userId: string; published: boolean }> = [];
    if (event === 'header_update') {
      const normalized = validateHeaders(rawPayload.headers);
      logger.info(`[CLIENT-EVENT] Admin ${input.user?.id} header_update for ${userIds.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds}):`, normalized);
      for (const userId of userIds) {
        const merged = await redisService.setUserHeaderOverrides(userId, normalized);
        results.push({ userId, published: await publishClientCommand(userId, 'header_update', { headers: merged }, options) });
      }
    } else {
      logger.info(`[CLIENT-EVENT] Admin ${input.user?.id} ${event} for ${userIds.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds})`);
      for (const userId of userIds) {
        results.push({ userId, published: await publishClientCommand(userId, event, rawPayload, options) });
      }
    }
    return { success: true as const, event, results };
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to push client event:');
  }
}

/** DELETE /client-events: remove header overrides (all, or the named ones) and tell the users' browsers. */
export async function removeHeaderOverrides(input: { body: RouteBody<typeof clientEventsRemove>; user: AuthenticatedUser | undefined }) {
  try {
    const { userIds, headerNames } = input.body;
    const options = { force: input.body.force === true, loadingSeconds: input.body.loadingSeconds ?? DEFAULT_LOADING_SECONDS };
    await requireInCallerWorkspace(input.user, userIds);
    logger.info(
      `[CLIENT-EVENT] Admin ${input.user?.id} removing ${headerNames ? headerNames.join(', ') : 'ALL'} for ${userIds.length} user(s) (force=${options.force}, loadingSeconds=${options.loadingSeconds})`,
    );
    const results: Array<{ userId: string; headers: Record<string, string>; published: boolean }> = [];
    for (const userId of userIds) {
      const remaining = await redisService.removeUserHeaderOverrides(userId, headerNames);
      results.push({ userId, headers: remaining, published: await publishClientCommand(userId, 'header_update', { headers: remaining }, options) });
    }
    return { success: true as const, results };
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to remove header overrides:');
  }
}