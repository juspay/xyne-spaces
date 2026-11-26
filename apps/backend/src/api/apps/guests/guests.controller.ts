import { ContractError, type AppCaller } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { GuestError, createGuest, issueGuestToken, listGuests, updateGuest, type GuestApp } from '../../../apps/core/guestUtils';

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
export function createAppGuest(input: GuestInput<Parameters<typeof createGuest>[1]>) {
  return guestAction('create', () => createGuest(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/get */
export function listAppGuests(input: GuestInput<Parameters<typeof listGuests>[1]>) {
  return guestAction('list', () => listGuests(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/update */
export function updateAppGuest(input: GuestInput<Parameters<typeof updateGuest>[1]>) {
  return guestAction('update', () => updateGuest(guestApp(input.user, input.app), input.body));
}

/** POST /apps/guests/token */
export function appGuestToken(input: GuestInput<{ email: string }>) {
  return guestAction('token', () => issueGuestToken(guestApp(input.user, input.app), input.body.email));
}