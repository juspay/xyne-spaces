import { ContractError, type AppCaller } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { getUserData } from '../core/userUtils';
import { getAllUserGroups } from '../core/userGroupUtils';
import { GuestError, createGuest, issueGuestToken, listGuests, updateGuest, type GuestApp } from '../core/guestUtils';

/**
 * Xyne Apps users, user groups and guests on the typed framework: no req/res, same answers as
 * the controllers they replace (UserController, UserGroupController, GuestController).
 */

/** "… not found" → 404, anything else → 500, as the user and user-group controllers answered. */
function notFoundOr500(error: unknown, logMessage: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  if (error instanceof Error && error.message.includes('not found')) {
    return new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
  }
  return new ContractError(500, { error: 'Internal server error' });
}

/** GET /apps/user/info */
export async function userInfo(input: { query: { userId: string } }): Promise<unknown> {
  try {
    return await getUserData(input.query.userId);
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user data:');
  }
}

/** GET /apps/usergroups/list */
export async function listUserGroups(): Promise<unknown> {
  try {
    return await getAllUserGroups();
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user groups:');
  }
}

/** The app from its verified token: the install and its bot. */
function guestApp(user: AuthenticatedUser | undefined, app: AppCaller | undefined): GuestApp {
  if (!user?.workspaceId || !app) throw new ContractError(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  return { installedAppId: app.installedAppId, botUserId: user.id, workspaceId: user.workspaceId };
}

/** A guest action: GuestError as its own status and code, anything else as a 500. */
async function guestAction<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (error instanceof GuestError) throw new ContractError(error.status, { error: error.message, code: error.code });
    logger.error('[APP-GUESTS] Guest request failed', { action, error: error instanceof Error ? error.message : 'unknown' });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

type GuestInput<B> = { body: B; user: AuthenticatedUser | undefined; app: AppCaller | undefined };

/** POST /apps/guests/create */
export function createAppGuest(input: GuestInput<Parameters<typeof createGuest>[1]>): Promise<unknown> {
  return guestAction('create', () => createGuest(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/get */
export function listAppGuests(input: GuestInput<Parameters<typeof listGuests>[1]>): Promise<unknown> {
  return guestAction('list', () => listGuests(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/update */
export function updateAppGuest(input: GuestInput<Parameters<typeof updateGuest>[1]>): Promise<unknown> {
  return guestAction('update', () => updateGuest(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/token */
export function appGuestToken(input: GuestInput<{ email: string }>): Promise<unknown> {
  return guestAction('token', () => issueGuestToken(guestApp(input.user, input.app), input.body.email));
}
