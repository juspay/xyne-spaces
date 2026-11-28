import { xyneApps } from '@/api/apps/xyne-apps.access';
import { AccessType, AppPermissionStatus, api } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { CommandType } from '@/database/repositories/appCommandRepository';
import { ContractError, controller } from '@/framework/api';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import type { AuthenticatedUser } from '@/types/express';
import { isValidUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';
import { isInstallWebhookHostAllowed } from '../../../apps/core/appUrlResolver';
import { buildDefaultFetchConfig, parseFetchConfig, redactFetchConfig } from '../../../apps/core/appFetchConfig';
import { attachableResourceFor, type AttachableResource } from '../../../apps/core/attachableResources';
import { appCommandRepository, internal, permissionsFailure } from '../dashboard.helpers';

// ─── Installed apps ─────────────────────────────────────────────────────────

/** The install, if it belongs to the caller's workspace (via its bot user): another workspace's is "not found". */
function findOwnInstall(installedAppId: string, workspaceId: string) {
  return repositories.installedApps.findFirst({ where: { id: installedAppId, user: { workspaceId } } });
}

function requireWorkspaceId(user: AuthenticatedUser | undefined, message: string): string {
  const workspaceId = user?.workspaceId;
  if (!workspaceId) throw new ContractError(400, { error: message });
  return workspaceId;
}

/** PATCH /apps/installed/:installedAppId: the outbound webhook URL of the caller's install. */
export const updateInstalledApp = controller(api.apps.installed.update, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const { webhookUrl } = input.body;
    if (webhookUrl !== undefined && webhookUrl !== '' && !isValidUrl(webhookUrl)) {
      throw new ContractError(400, { error: 'Invalid webhook URL format', code: 'INVALID_WEBHOOK_URL' });
    }
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) {
      throw new ContractError(404, { error: 'Installed app not found in this workspace', code: 'INSTALLED_APP_NOT_FOUND' });
    }
    if (webhookUrl && !(await isInstallWebhookHostAllowed(webhookUrl.trim(), install.appId))) {
      throw new ContractError(400, { error: 'This webhook host is reserved for the app it belongs to', code: 'RESERVED_WEBHOOK_HOST' });
    }
    const updated = await repositories.installedApps.update(install.id, {
      webhookUrl: webhookUrl === undefined ? install.webhookUrl : webhookUrl.trim() || null,
    });
    return { webhookUrl: updated.webhookUrl };
  } catch (error) {
    throw internal(error, 'Error updating installed app:');
  }
});

/** GET /apps/installed/:installedAppId/permissions: the INSTALL's permissions with approval statuses. */
export const getInstalledPermissions = controller(api.apps.installed.permissions, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });

    const permissions = await repositories.appPermissions.getInstalledPermissions(install.id);
    const permissionsPending = await repositories.appPermissions.hasPermissionsPendingReinstall(install.id);
    const statuses = await repositories.appPermissions.getInstalledPermissionsWithStatus(install.id);
    const hasApproved = statuses.some((p) => p.status === AppPermissionStatus.APPROVED);
    if (statuses.length > 0 && !hasApproved) {
      throw new ContractError(403, {
        error: 'no_approved_permissions',
        message: 'All permissions are pending activation. Please update the app.',
        permissions,
        permissionsPending,
        statuses,
      });
    }
    if (permissions.length === 0) {
      throw new ContractError(403, {
        error: 'no_permissions',
        message: 'No permissions have been granted to this app.',
        permissions,
        permissionsPending,
        statuses,
      });
    }
    return { permissions, permissionsPending, statuses };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** POST /apps/installed/:installedAppId/permissions: replace the INSTALL's permissions (no version bump). */
export const setInstalledPermissions = controller(api.apps.installed.permissionsSet, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
    await repositories.appPermissions.setInstalledPermissions(install.id, input.body.permissions);
    return { ok: true as const };
  } catch (error) {
    throw permissionsFailure(error);
  }
});

/** POST /apps/installed/:installedAppId/permissions/activate: pending edits to approved, deletions applied. */
export const activateInstalledPermissions = controller(api.apps.installed.permissionsActivate, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
    await repositories.appPermissions.activateInstalledPermissions(install.id);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

/** GET /apps/installed/:installedAppId/commands?commandType=: the INSTALL's snapshot, scoped to the caller's workspace. */
export const listInstalledCommands = controller(api.apps.installed.commands, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
    return await appCommandRepository.findInstalledByInstalledAppId(input.params.installedAppId, input.query.commandType as CommandType);
  } catch (error) {
    throw internal(error, '[COMMANDS] getInstalledCommands error:');
  }
});

// ─── Attached resources ─────────────────────────────────────────────────────

/** The install (in the caller's workspace: another workspace's is a 404, not a 403) and the resource type. */
async function resolveAttachable(params: { installedAppId: string; resourceType: string }, user: AuthenticatedUser | undefined) {
  const workspaceId = user?.workspaceId;
  if (!workspaceId) throw new ContractError(400, { error: 'installedAppId, resourceType and workspace are required' });
  const resource = attachableResourceFor(params.resourceType);
  if (!resource) throw new ContractError(404, { error: `Unknown resource type "${params.resourceType}"` });
  const install = await findOwnInstall(params.installedAppId, workspaceId);
  if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
  return { install, resource, workspaceId };
}

/** `describe` also filters, so a grant whose target was deleted drops out of the UI. */
async function currentAttachedItems(installedAppId: string, workspaceId: string, resource: AttachableResource) {
  const ids = await appResourceAccessService.listAttachedIds({ workspaceId, installedAppId, entityType: resource.entityType });
  return ids.length ? resource.describe(ids, workspaceId) : [];
}

/** GET /apps/installed/:installedAppId/resources/:resourceType */
export const listAttachedResources = controller(api.apps.installed.resources, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    const { install, resource, workspaceId } = await resolveAttachable(input.params, input.user);
    return { resourceType: resource.kind, items: await currentAttachedItems(install.id, workspaceId, resource) };
  } catch (error) {
    throw internal(error, 'Error listing attached resources:', { error: 'Failed to list attached resources' });
  }
});

/**
 * PATCH /apps/installed/:installedAppId/resources/:resourceType: a delta (added / removed ids)
 * rather than the whole set, effective at once. An id in both ends up attached (the repository
 * deletes before it creates).
 */
export const setAttachedResources = controller(api.apps.installed.resourcesSet, { checks: xyneApps(AccessType.ADMIN) }, async (input) => {
  try {
    const added = [...new Set(input.body.added ?? [])];
    const removed = [...new Set(input.body.removed ?? [])];
    const { install, resource, workspaceId } = await resolveAttachable(input.params, input.user);
    // Additions only: removing something already deleted is how an orphan gets pruned.
    if (added.length) {
      const found = await resource.describe(added, workspaceId);
      const missing = added.filter((id) => !found.some((row) => row.id === id));
      if (missing.length) throw new ContractError(400, { error: `Unknown ${resource.kind}`, entityIds: missing });
    }
    await appResourceAccessService.applyAttachmentChanges({
      workspaceId,
      installedAppId: install.id,
      entityType: resource.entityType,
      added,
      removed,
    });
    const items = await currentAttachedItems(install.id, workspaceId, resource);
    logger.info(`[APP-RESOURCES] install ${install.id} ${resource.kind}: +${added.length} -${removed.length} by ${input.user?.id}`);
    return { resourceType: resource.kind, items };
  } catch (error) {
    throw internal(error, 'Error updating attached resources:', { error: 'Failed to update attached resources' });
  }
});

// ─── Fetch config ───────────────────────────────────────────────────────────

const installNotFound = () =>
  new ContractError(404, { error: 'Installed app not found in this workspace', code: 'INSTALLED_APP_NOT_FOUND' });

/**
 * GET /apps/installed/:installedAppId/fetch-config: the stored config (secrets redacted), or a
 * default derived from the install's webhook URL when none is stored; `configured` tells which.
 */
export const getFetchConfig = controller(api.apps.installed.fetchConfig, { checks: xyneApps(AccessType.READ) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw installNotFound();

    if (install.fetchConfig) {
      // Parsed rather than passed through raw: a config stored before a schema change should
      // surface as an error here, where someone can fix it, not at fetch time in a worker.
      try {
        return { configured: true, config: redactFetchConfig(parseFetchConfig(install.fetchConfig, 'This install')) };
      } catch (error) {
        return { configured: true, config: null, invalid: true, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const suggested = install.webhookUrl?.trim()
      ? (() => {
          try {
            return buildDefaultFetchConfig(install.webhookUrl!.trim());
          } catch {
            return null;
          }
        })()
      : null;
    return { configured: false, config: suggested };
  } catch (error) {
    throw internal(error, 'Error reading app fetch config:');
  }
});

/** DELETE /apps/installed/:installedAppId/fetch-config: turns history pulls off for this install. */
export const deleteFetchConfig = controller(api.apps.installed.fetchConfigDelete, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw installNotFound();
    await repositories.installedApps.update(install.id, { fetchConfig: null });
    return { configured: false as const };
  } catch (error) {
    throw internal(error, 'Error clearing app fetch config:');
  }
});