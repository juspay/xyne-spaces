import { xyneApps } from '@/api/apps/xyne-apps.access';
import { AccessType, api } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { CommandNameConflictError, CommandNotFoundError, CommandType } from '@/database/repositories/appCommandRepository';
import { ContractError, controller } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { appCommandRepository, internal } from './dashboard.helpers';

// ─── Commands and shortcuts ─────────────────────────────────────────────────

/** GET /apps/:appId/commands?commandType=: an app's commands or shortcuts (admin UI). */
export const listAppCommands = controller(api.apps.commands, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    return await appCommandRepository.findByAppId(input.params.appId, input.query.commandType as CommandType);
  } catch (error) {
    throw internal(error, '[COMMANDS] getCommands error:');
  }
});

/** The app, if the caller created it: only the creator edits the template (matches the apps.update mutator ACL). */
async function ownAppForEdit(appId: string, user: AuthenticatedUser | undefined) {
  const app = await repositories.apps.findById(appId);
  if (!app) throw new ContractError(404, { error: 'App not found', code: 'APP_NOT_FOUND' });
  if (app.createdBy !== user?.id) {
    throw new ContractError(403, { error: 'Only the app creator can modify this app', code: 'FORBIDDEN' });
  }
  return app;
}

/** POST /apps/:appId/commands: a NEW command or shortcut; 409 if the name is taken. */
export const createAppCommand = controller(api.apps.commandsCreate, { checks: xyneApps(AccessType.WRITE) }, async (input, reply) => {
  reply.status(201);
  try {
    await ownAppForEdit(input.params.appId, input.user);
    const command = await appCommandRepository.create(input.params.appId, input.body);
    // Template changed: bump the version so installs see an available Update.
    await repositories.apps.bumpVersion(input.params.appId);
    return command;
  } catch (error) {
    if (error instanceof CommandNameConflictError) throw new ContractError(409, { error: error.code, message: error.message });
    throw internal(error, '[COMMANDS] createCommand error:');
  }
});

/** PUT /apps/:appId/commands: an EXISTING command or shortcut (by name and type): 404 if missing, 409 if the name is the other type's. */
export const updateAppCommand = controller(api.apps.commandsUpdate, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    await ownAppForEdit(input.params.appId, input.user);
    const command = await appCommandRepository.update(input.params.appId, input.body);
    await repositories.apps.bumpVersion(input.params.appId);
    return command;
  } catch (error) {
    if (error instanceof CommandNameConflictError) throw new ContractError(409, { error: error.code, message: error.message });
    if (error instanceof CommandNotFoundError) throw new ContractError(404, { error: error.code, message: error.message });
    throw internal(error, '[COMMANDS] updateCommand error:');
  }
});

/** DELETE /apps/:appId/commands/:commandName?commandType= */
export const deleteAppCommand = controller(api.apps.commandsDelete, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    await ownAppForEdit(input.params.appId, input.user);
    await appCommandRepository.deleteByAppIdNameAndType(input.params.appId, input.params.commandName, input.query.commandType as CommandType);
    await repositories.apps.bumpVersion(input.params.appId);
    return { message: 'Deleted' as const };
  } catch (error) {
    throw internal(error, '[COMMANDS] deleteCommand error:');
  }
});