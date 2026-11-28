import { api } from '@xyne/shared';
import { appPermission } from '@/apps/access';
import { ContractError, controller, type AppCaller } from '@/framework/api';
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

/** POST /apps/guests/create */
export const createAppGuest = controller(api.apps.guests.create, { checks: { permission: appPermission('guests:write') } }, async (input, reply) => {
  reply.status(201);
  return guestAction('create', () => createGuest(guestApp(input.user, input.app), input.body));
});

/** POST /apps/guests/get */
export const listAppGuests = controller(api.apps.guests.get, { checks: { permission: appPermission('guests:read') } }, async (input) => {
  return guestAction('list', () => listGuests(guestApp(input.user, input.app), input.body));
});

/** POST /apps/guests/update */
export const updateAppGuest = controller(api.apps.guests.update, { checks: { permission: appPermission('guests:write') } }, async (input) => {
  return guestAction('update', () => updateGuest(guestApp(input.user, input.app), input.body));
});

/** POST /apps/guests/token */
export const appGuestToken = controller(api.apps.guests.token, { checks: { permission: appPermission('guests:write') } }, async (input) => {
  return guestAction('token', () => issueGuestToken(guestApp(input.user, input.app), input.body.email));
});