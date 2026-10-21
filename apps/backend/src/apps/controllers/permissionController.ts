import { type Request, type Response } from 'express';
import { AppPermissionStatus } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import type { PermissionKind } from '@/database/repositories/appPermissionRepository';

/**
 * `?kind=event` switches every endpoint below to event subscriptions (SUBSCRIBE rows) — the
 * Events modal. Omitted = API permissions, exactly as before.
 */
function kindFrom(req: Request): PermissionKind {
  return req.query.kind === 'event' ? 'event' : 'api';
}

// Zero event rows means "every event", so an empty event selection would silently re-enable
// everything. Require at least one; to stop all events, clear the webhook URL instead.
const EMPTY_EVENTS_ERROR = 'Select at least one event. To stop all events, clear the webhook URL.';

export class PermissionController {
  /**
   * GET /apps/permissions
   * List all available permissions in the registry.
   */
  listAvailable = async (req: Request, res: Response): Promise<void> => {
    try {
      const permissions = await repositories.appPermissions.findAll(kindFrom(req));
      res.status(200).json({ permissions });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /apps/permissions/:appId
   * Return the app TEMPLATE permissions (app_permission). Used by the Org/Marketplace edit
   * screen (creator). Install-scoped permissions are served by getInstalledGranted below.
   */
  getGranted = async (req: Request, res: Response): Promise<void> => {
    try {
      const { appId } = req.params;
      const kind = kindFrom(req);
      const permissions = await repositories.appPermissions.getAppPermissions(appId, kind);

      // Events: no rows is the normal "receives every event" state, not an error.
      if (kind === 'event') {
        res.status(200).json({ permissions, permissionsPending: false, statuses: [], configured: permissions.length > 0 });
        return;
      }

      // 403 if no permissions are granted at all
      if (permissions.length === 0) {
        res.status(403).json({
          error: 'no_permissions',
          message: 'No permissions have been granted to this app.',
          permissions,
          permissionsPending: false,
          statuses: [],
        });
        return;
      }

      res.status(200).json({ permissions, permissionsPending: false, statuses: [] });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /apps/permissions/:appId
   * Replace the app TEMPLATE permissions (app_permission). Used by the creator on the
   * Org/Marketplace edit screen. Bumps the app version so installs see an Update.
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
      const kind = kindFrom(req);
      if (kind === 'event' && permissions.length === 0) {
        res.status(400).json({ error: EMPTY_EVENTS_ERROR });
        return;
      }
      // Only the creator may edit the template (matches the apps.update mutator ACL).
      const app = await repositories.apps.findById(appId);
      if (!app) {
        res.status(404).json({ error: 'App not found', code: 'APP_NOT_FOUND' });
        return;
      }
      if (app.createdBy !== req.user?.id) {
        res.status(403).json({ error: 'Only the app creator can modify this app', code: 'FORBIDDEN' });
        return;
      }
      await repositories.appPermissions.setAppPermissions(appId, permissions, kind);
      // Template permissions changed -> bump version so installs surface the Update prompt.
      await repositories.apps.bumpVersion(appId);
      res.status(200).json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Internal server error';
      const status = msg.startsWith('Unknown permissions') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  };

  /**
   * Resolve an install owned by the caller's workspace, or null. Scopes per-install permission
   * edits to the caller's workspace (via the install's bot-user relation).
   */
  private async findOwnInstall(installedAppId: string, workspaceId: string) {
    return repositories.installedApps.findFirst({
      where: { id: installedAppId, user: { workspaceId } },
    });
  }

  /**
   * GET /apps/installed/:installedAppId/permissions
   * Return the INSTALL's scoped permissions (installed_app_permissions) with approval statuses.
   * Used by the Installed edit screen (workspace admin).
   */
  getInstalledGranted = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }
      const install = await this.findOwnInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({ error: 'Installed app not found in this workspace' });
        return;
      }

      const kind = kindFrom(req);
      const permissions = await repositories.appPermissions.getInstalledPermissions(install.id, kind);
      const permissionsPending = await repositories.appPermissions.hasPermissionsPendingReinstall(install.id, kind);
      const statuses = await repositories.appPermissions.getInstalledPermissionsWithStatus(install.id, kind);

      // Events: no rows is the normal "receives every event" state, not an error.
      if (kind === 'event') {
        res.status(200).json({ permissions, permissionsPending, statuses, configured: statuses.length > 0 });
        return;
      }

      const hasApproved = statuses.some((p) => p.status === AppPermissionStatus.APPROVED);
      if (statuses.length > 0 && !hasApproved) {
        res.status(403).json({
          error: 'no_approved_permissions',
          message: 'All permissions are pending activation. Please update the app.',
          permissions,
          permissionsPending,
          statuses,
        });
        return;
      }
      if (permissions.length === 0) {
        res.status(403).json({
          error: 'no_permissions',
          message: 'No permissions have been granted to this app.',
          permissions,
          permissionsPending,
          statuses,
        });
        return;
      }

      res.status(200).json({ permissions, permissionsPending, statuses });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /apps/installed/:installedAppId/permissions
   * Replace the INSTALL's scoped permissions (installed_app_permissions). Used by the Installed
   * edit screen (workspace admin). Does NOT bump the app version — this is an install-level change.
   * Body: { permissions: string[] }
   */
  setInstalledPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      const { permissions } = req.body as { permissions: string[] };
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }
      if (!Array.isArray(permissions)) {
        res.status(400).json({ error: 'permissions must be an array of strings' });
        return;
      }
      const kind = kindFrom(req);
      if (kind === 'event' && permissions.length === 0) {
        res.status(400).json({ error: EMPTY_EVENTS_ERROR });
        return;
      }
      const install = await this.findOwnInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({ error: 'Installed app not found in this workspace' });
        return;
      }
      await repositories.appPermissions.setInstalledPermissions(install.id, permissions, kind);
      res.status(200).json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Internal server error';
      const status = msg.startsWith('Unknown permissions') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  };

  /**
   * POST /apps/installed/:installedAppId/permissions/activate
   * Activate the INSTALL's pending permission edits (installed_app_permissions) in place, without
   * resetting to the app template. Promotes UNAPPROVED → APPROVED and drops PENDINGDELETE rows.
   * Used by the Installed edit screen's "Apply & activate" button (workspace admin).
   */
  activateInstalledPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }
      const install = await this.findOwnInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({ error: 'Installed app not found in this workspace' });
        return;
      }
      await repositories.appPermissions.activateInstalledPermissions(install.id, kindFrom(req));
      res.status(200).json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Internal server error';
      res.status(500).json({ error: msg });
    }
  };
}
