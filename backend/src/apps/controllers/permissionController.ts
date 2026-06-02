import { type Request, type Response } from 'express';
import { repositories } from '@/database/repositories';
import { AppPermissionStatus } from '@prisma/client';

export class PermissionController {
  /**
   * GET /apps/permissions
   * List all available permissions in the registry.
   */
  listAvailable = async (_req: Request, res: Response): Promise<void> => {
    try {
      const permissions = await repositories.appPermissions.findAll();
      res.status(200).json({ permissions });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /apps/permissions/:appId
   * Return permissions for the app.
   * - If installed: returns the scoped installed_app_permissions
   * - If not installed: returns the pre-install app_permission grants
   */
  getGranted = async (req: Request, res: Response): Promise<void> => {
    try {
      const { appId } = req.params;
      const installation = await repositories.installedApps.findFirst({ where: { appId } });
      let permissions: string[];
      let permissionsPending = false;
      if (installation) {
        permissions = await repositories.appPermissions.getInstalledPermissions(installation.id);
        permissionsPending = await repositories.appPermissions.hasPermissionsPendingReinstall(installation.id);

        // 403 if all permissions are still UNAPPROVED (app was never reinstalled after grant)
        const allStatuses = await repositories.appPermissions.getInstalledPermissionsWithStatus(installation.id);
        const hasApproved = allStatuses.some((p) => p.status === AppPermissionStatus.APPROVED);
        if (allStatuses.length > 0 && !hasApproved) {
          res.status(403).json({
            error: 'no_approved_permissions',
            message: 'All permissions are pending activation. Please reinstall the app.',
          });
          return;
        }
      } else {
        permissions = await repositories.appPermissions.getAppPermissions(appId);
      }

      // 403 if no permissions are granted at all
      if (permissions.length === 0) {
        res.status(403).json({
          error: 'no_permissions',
          message: 'No permissions have been granted to this app.',
        });
        return;
      }

      res.status(200).json({ permissions, permissionsPending });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /apps/permissions/:appId
   * Replace the full set of permissions for an app.
   * - If NOT installed: saves to app_permission (pre-install global grants)
   * - If installed: saves to installed_app_permissions (scoped to installation)
   * Body: { permissions: string[] }
   */
  setPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { appId } = req.params;
      const { permissions } = req.body as { permissions: string[] };
      if (!Array.isArray(permissions)) {
        res.status(400).json({ error: 'permissions must be an array of strings' });
        return;
      }
      const installation = await repositories.installedApps.findFirst({ where: { appId } });
      if (installation) {
        // App is installed — save scoped permissions to installed_app_permissions
        await repositories.appPermissions.setInstalledPermissions(installation.id, permissions);
      } else {
        // App not yet installed — save global pre-install grants to app_permission
        await repositories.appPermissions.setAppPermissions(appId, permissions);
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Internal server error';
      const status = msg.startsWith('Unknown permissions') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  };
}
