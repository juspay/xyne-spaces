import { xyneApps } from '@/api/apps/xyne-apps.access';
import { AccessType, api } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { ContractError, controller } from '@/framework/api';
import { permissionsFailure } from '../dashboard.helpers';

/** GET /apps/permissions: everything in the registry. */
export const listAvailablePermissions = controller(api.apps.permissions.list, async () => {
  try {
    return { permissions: await repositories.appPermissions.findAll() };
  } catch {
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** GET /apps/permissions/:appId: the app TEMPLATE permissions. */
export const getAppPermissions = controller(api.apps.permissions.get, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    const permissions = await repositories.appPermissions.getAppPermissions(input.params.appId);
    if (permissions.length === 0) {
      throw new ContractError(403, {
        error: 'no_permissions',
        message: 'No permissions have been granted to this app.',
        permissions,
        permissionsPending: false,
        statuses: [],
      });
    }
    return { permissions, permissionsPending: false as const, statuses: [] as { scope: string; status: string }[] };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** POST /apps/permissions/:appId: replace the TEMPLATE permissions (creator only); bumps the version. */
export const setAppPermissions = controller(api.apps.permissions.set, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    const { appId } = input.params;
    const app = await repositories.apps.findById(appId);
    if (!app) throw new ContractError(404, { error: 'App not found', code: 'APP_NOT_FOUND' });
    // Only the creator may edit the template (matches the apps.update mutator ACL).
    if (app.createdBy !== input.user?.id) {
      throw new ContractError(403, { error: 'Only the app creator can modify this app', code: 'FORBIDDEN' });
    }
    await repositories.appPermissions.setAppPermissions(appId, input.body.permissions);
    // Template permissions changed: bump the version so installs surface the Update prompt.
    await repositories.apps.bumpVersion(appId);
    return { ok: true as const };
  } catch (error) {
    throw permissionsFailure(error);
  }
});