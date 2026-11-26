import crypto from 'node:crypto';
import {
  AccessType,
  AppIncomingWebhookAction,
  AppIncomingWebhookType,
  AppPermissionStatus,
  type RouteBody,
  type RouteParams,
  type RouteQuery,
  type appsChannelCommands,
  type appsCommands,
  type appsCommandsCreate,
  type appsCommandsDelete,
  type appsCommandsUpdate,
  type appsConfigureWebhook,
  type appsCreate,
  type appsIncomingWebhooksCreate,
  type appsIncomingWebhooksList,
  type appsIncomingWebhooksUpdate,
  type appsInstalledCommands,
  type appsInstalledPermissionsSet,
  type appsInstalledResourcesSet,
  type appsInstalledUpdate,
  type appsOrgNames,
  type appsPermissionsSet,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { CreateAppInput } from '@/database/repositories/appsRepository';
import {
  AppCommandRepository,
  CommandAccessibility,
  CommandNameConflictError,
  CommandNotFoundError,
  CommandType,
} from '@/database/repositories/appCommandRepository';
import { withWorkspaceScope } from '@/database/tenant/context';
import { ContractError } from '@/framework/api';
import { promoteAppToGlobal } from '@/bypassAcl/appServices';
import { vespaQueue } from '@/queues/vespaQueue';
import { ClawAgentLookupError } from '@/services/clawAgentService';
import { appResourceAccessService } from '@/services/appResourceAccessService';
import { decrypt, encrypt } from '@/services/encryptionService';
import type { AuthenticatedUser } from '@/types/express';
import { isValidUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';
import { appSchema } from '@/vespa/src/types';
import { isInstallWebhookHostAllowed } from '../core/appUrlResolver';
import { configureWebhook, getSigningSecret, installApp, regenerateJwt } from '../core/appUtils';
import {
  buildDefaultFetchConfig,
  parseFetchConfig,
  redactFetchConfig,
} from '../core/appFetchConfig';
import { attachableResourceFor, type AttachableResource } from '../core/attachableResources';
import { incomingWebhookController } from '../controllers/incomingWebhookController';

/**
 * The Xyne Apps dashboard API on the typed framework (apps/routes/apps.ts): no req/res, same
 * answers as the controller methods they replace (AppController, PermissionController,
 * CommandController, AppResourceController, FetchConfigController and the management half of
 * IncomingWebhookController). A ContractError is an answer; anything else is logged and
 * answered as the controller did.
 */

const appCommandRepository = new AppCommandRepository();

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Authentication required', code: 'UNAUTHORIZED' });
  return user;
}

/** An error the controller answered as 500 `{ error: 'Internal server error' }` (or `body`), logged first. */
function internal(error: unknown, logMessage: string, body: { error: string } = { error: 'Internal server error' }): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, body);
}

const isNotFound = (error: unknown): error is Error => error instanceof Error && error.message.includes('not found');

async function isAclAdmin(userId: string): Promise<boolean> {
  const resource = await repositories.resources.findByName('XYNE-APPS');
  if (!resource) return false;
  return await repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN);
}

// ─── App setup ──────────────────────────────────────────────────────────────

/** POST /apps/create */
export async function createApp(input: { body: RouteBody<typeof appsCreate>; user: AuthenticatedUser | undefined }) {
  const user = requireUser(input.user);
  try {
    const { name, description } = input.body;
    const botName = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const botEmail = `${botName}@app.xyne.ai`;
    if (await repositories.users.findByEmail(botEmail, user.workspaceId)) {
      throw new ContractError(409, { error: `An app with name "${name}" already exists`, code: 'DUPLICATE_APP_NAME' });
    }
    // The creator's owning org (apps are owned at the org level, created at ORG scope).
    const workspace = await repositories.workspaces.findById(user.workspaceId);
    if (!workspace?.orgId) {
      throw new ContractError(400, { error: 'Could not resolve organization for the current workspace', code: 'ORG_REQUIRED' });
    }
    const appData: CreateAppInput = { name, description, createdBy: user.id, orgId: workspace.orgId };
    const app = await repositories.apps.createApp(appData);
    // Queue Vespa indexing for the new app (worker fetches + maps by docId).
    vespaQueue
      .addJob({ schema: appSchema, jobType: 'feed', docId: app.id })
      .catch((err) => logger.error(`Failed to queue Vespa feed for app ${app.id}:`, err));
    return app;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('Error creating external app:', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      throw new ContractError(409, { error: error.message, code: 'DUPLICATE_APP_NAME' });
    }
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** POST /apps/install/:appId */
export async function installAppHandler(input: { params: { appId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { appId } = input.params;
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(400, { error: 'Workspace ID is required', code: 'WORKSPACE_REQUIRED' });

    // Eligibility: ORG-scoped apps install only within the owning org; GLOBAL apps install anywhere.
    // (Install is gated to XYNE-APPS admins by the route's access check.)
    const app = await repositories.apps.findById(appId);
    if (!app) throw new ContractError(404, { error: 'App not found', code: 'APP_NOT_FOUND' });
    if (app.scope === 'ORG') {
      const workspace = await repositories.workspaces.findById(workspaceId);
      if (!workspace || workspace.orgId !== app.orgId) {
        throw new ContractError(403, { error: 'This app is not available to your workspace', code: 'APP_NOT_IN_SCOPE' });
      }
    }
    return await installApp(appId, workspaceId);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('Error installing external app:', error);
    // Could not tell AGENT from APP (claw-auth down / misconfigured): nothing was written; retryable.
    if (error instanceof ClawAgentLookupError) {
      throw new ContractError(503, { error: error.message, code: 'CLAW_AGENT_LOOKUP_FAILED' });
    }
    if (isNotFound(error)) throw new ContractError(404, { error: error.message, code: 'APP_NOT_FOUND' });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** POST /apps/promote/:appId: ORG scope to GLOBAL (marketplace). XYNE-APPS admin only. */
export async function promoteApp(input: { params: { appId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { appId } = input.params;
    const user = requireUser(input.user);
    if (!(await isAclAdmin(user.id))) {
      throw new ContractError(403, { error: 'Only a XYNE-APPS admin can promote apps to global', code: 'FORBIDDEN' });
    }
    const app = await repositories.apps.findById(appId);
    if (!app) throw new ContractError(404, { error: 'App not found', code: 'APP_NOT_FOUND' });
    if (app.scope === 'GLOBAL') throw new ContractError(409, { error: 'App is already global', code: 'ALREADY_GLOBAL' });

    // Ownership: only an admin of the app's OWN org may promote it (not just any XYNE-APPS admin).
    const workspace = await repositories.workspaces.findById(user.workspaceId);
    if (!workspace?.orgId || workspace.orgId !== app.orgId) {
      throw new ContractError(403, { error: 'You can only promote apps owned by your organization', code: 'FORBIDDEN' });
    }
    // Promotion is authorised by org ownership above, not by who created the app: the app row
    // carries its creating workspace's id, which for a sibling workspace in the same org is not
    // the caller's. Both checks that matter (XYNE-APPS admin, same owning org) have run above.
    return await promoteAppToGlobal(appId);
  } catch (error) {
    throw internal(error, 'Error promoting app:');
  }
}

/** POST /apps/configureWebhook/:appId */
export async function configureAppWebhook(input: {
  params: { appId: string };
  body: RouteBody<typeof appsConfigureWebhook>;
  user: AuthenticatedUser | undefined;
}) {
  try {
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    return await configureWebhook(input.params.appId, input.body.webhookUrl, workspaceId);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('Error configuring webhook:', error);
    if (isNotFound(error)) throw new ContractError(404, { error: error.message, code: 'INSTALLED_APP_NOT_FOUND' });
    if (error instanceof Error && error.message.includes('Invalid webhook URL')) {
      throw new ContractError(400, { error: error.message, code: 'INVALID_WEBHOOK_URL' });
    }
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** POST /apps/regenerate-jwt/:appId: the XYNE-APPS admin or the app's creator. */
export async function regenerateAppJwt(input: { params: { appId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { appId } = input.params;
    const user = requireUser(input.user);
    const [app, isAdmin] = await Promise.all([repositories.apps.findById(appId), isAclAdmin(user.id)]);
    if (!app) throw new ContractError(404, { error: 'App not found', code: 'NOT_FOUND' });
    if (!isAdmin && app.createdBy !== user.id) {
      throw new ContractError(403, { error: 'Unauthorized: Only admin or app creator can regenerate JWT', code: 'FORBIDDEN' });
    }
    return await regenerateJwt(appId, user.workspaceId);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('Error regenerating JWT:', error);
    if (isNotFound(error)) throw new ContractError(404, { error: error.message, code: 'INSTALLED_APP_NOT_FOUND' });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** POST /apps/signing-secret/:appId: the app's creator or an admin. */
export async function appSigningSecret(input: { params: { appId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const isAdmin = await isAclAdmin(user.id);
    return await getSigningSecret(input.params.appId, user.id, isAdmin);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('Error getting signing secret:', error);
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      throw new ContractError(403, { error: error.message, code: 'FORBIDDEN' });
    }
    if (isNotFound(error)) throw new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

// ─── Lookups ────────────────────────────────────────────────────────────────

/** GET /apps/bot-channels/:appId: channels the app's bot is in that the caller can also see. */
export async function botChannels(input: { params: { appId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const installedApp = await repositories.installedApps.findFirst({ where: { appId: input.params.appId } });
    if (!installedApp) throw new ContractError(404, { error: 'App is not installed', code: 'APP_NOT_INSTALLED' });

    const participations = await repositories.channelParticipants.getUserChannels(installedApp.userId);
    const channelIds = participations.map((p) => p.channelId);
    const requesterChannelIds = await repositories.channelParticipants.getAccessibleChannelIds(channelIds, user.id);
    const accessibleChannelIds = channelIds.filter((channelId) => requesterChannelIds.has(channelId));
    const channels = await repositories.channels.getChannelsByIds(accessibleChannelIds);
    return { channels: channels.map((ch) => ({ id: ch.id, name: ch.name, visibility: ch.visibility, projectId: ch.projectId })) };
  } catch (error) {
    throw internal(error, 'Error getting bot channels:');
  }
}

/** GET /apps/project-boards/:projectId */
export async function projectBoards(input: { params: { projectId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const boards = await repositories.boards.findBoardsByProject(input.params.projectId);
    return {
      boards: boards
        .filter((board) => board.workspaceId === workspaceId)
        .map((board) => ({ id: board.id, name: board.name, projectId: board.projectId })),
    };
  } catch (error) {
    throw internal(error, 'Error getting project boards:');
  }
}

/** POST /apps/org-names: org ids to names, only for the ids asked about. */
export async function orgNames(input: { body: RouteBody<typeof appsOrgNames> }) {
  try {
    const ids = Array.from(new Set(input.body.orgIds)).filter(Boolean);
    if (ids.length === 0) return { orgNames: {} };
    // Resolves names for the requested orgs, which may include the app's origin org.
    const orgs = await withWorkspaceScope(() =>
      db.organization.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, name: true } }),
    );
    const names: Record<string, string> = {};
    for (const o of orgs) names[o.orgId] = o.name;
    return { orgNames: names };
  } catch (error) {
    throw internal(error, 'Error resolving org names:');
  }
}

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
export async function updateInstalledApp(input: {
  params: { installedAppId: string };
  body: RouteBody<typeof appsInstalledUpdate>;
  user: AuthenticatedUser | undefined;
}) {
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
}

// ─── Permissions ────────────────────────────────────────────────────────────

/** An error message to its answer: "Unknown permissions…" is a 400, anything else a 500 (the message is returned). */
function permissionsFailure(error: unknown): ContractError {
  if (error instanceof ContractError) return error;
  const msg = error instanceof Error ? error.message : 'Internal server error';
  return new ContractError(msg.startsWith('Unknown permissions') ? 400 : 500, { error: msg });
}

/** GET /apps/permissions: everything in the registry. */
export async function listAvailablePermissions() {
  try {
    return { permissions: await repositories.appPermissions.findAll() };
  } catch {
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** GET /apps/permissions/:appId: the app TEMPLATE permissions. */
export async function getAppPermissions(input: { params: { appId: string } }) {
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
}

/** POST /apps/permissions/:appId: replace the TEMPLATE permissions (creator only); bumps the version. */
export async function setAppPermissions(input: {
  params: { appId: string };
  body: RouteBody<typeof appsPermissionsSet>;
  user: AuthenticatedUser | undefined;
}) {
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
}

/** GET /apps/installed/:installedAppId/permissions: the INSTALL's permissions with approval statuses. */
export async function getInstalledPermissions(input: { params: { installedAppId: string }; user: AuthenticatedUser | undefined }) {
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
}

/** POST /apps/installed/:installedAppId/permissions: replace the INSTALL's permissions (no version bump). */
export async function setInstalledPermissions(input: {
  params: { installedAppId: string };
  body: RouteBody<typeof appsInstalledPermissionsSet>;
  user: AuthenticatedUser | undefined;
}) {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
    await repositories.appPermissions.setInstalledPermissions(install.id, input.body.permissions);
    return { ok: true as const };
  } catch (error) {
    throw permissionsFailure(error);
  }
}

/** POST /apps/installed/:installedAppId/permissions/activate: pending edits to approved, deletions applied. */
export async function activateInstalledPermissions(input: { params: { installedAppId: string }; user: AuthenticatedUser | undefined }) {
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
}

// ─── Commands and shortcuts ─────────────────────────────────────────────────

/** GET /apps/:appId/commands?commandType=: an app's commands or shortcuts (admin UI). */
export async function listAppCommands(input: { params: RouteParams<typeof appsCommands>; query: RouteQuery<typeof appsCommands> }) {
  try {
    return await appCommandRepository.findByAppId(input.params.appId, input.query.commandType as CommandType);
  } catch (error) {
    throw internal(error, '[COMMANDS] getCommands error:');
  }
}

/** GET /apps/installed/:installedAppId/commands?commandType=: the INSTALL's snapshot, scoped to the caller's workspace. */
export async function listInstalledCommands(input: {
  params: { installedAppId: string };
  query: RouteQuery<typeof appsInstalledCommands>;
  user: AuthenticatedUser | undefined;
}) {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw new ContractError(404, { error: 'Installed app not found in this workspace' });
    return await appCommandRepository.findInstalledByInstalledAppId(input.params.installedAppId, input.query.commandType as CommandType);
  } catch (error) {
    throw internal(error, '[COMMANDS] getInstalledCommands error:');
  }
}

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
export async function createAppCommand(input: {
  params: { appId: string };
  body: RouteBody<typeof appsCommandsCreate>;
  user: AuthenticatedUser | undefined;
}) {
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
}

/** PUT /apps/:appId/commands: an EXISTING command or shortcut (by name and type): 404 if missing, 409 if the name is the other type's. */
export async function updateAppCommand(input: {
  params: { appId: string };
  body: RouteBody<typeof appsCommandsUpdate>;
  user: AuthenticatedUser | undefined;
}) {
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
}

/** DELETE /apps/:appId/commands/:commandName?commandType= */
export async function deleteAppCommand(input: {
  params: RouteParams<typeof appsCommandsDelete>;
  query: RouteQuery<typeof appsCommandsDelete>;
  user: AuthenticatedUser | undefined;
}) {
  try {
    await ownAppForEdit(input.params.appId, input.user);
    await appCommandRepository.deleteByAppIdNameAndType(input.params.appId, input.params.commandName, input.query.commandType as CommandType);
    await repositories.apps.bumpVersion(input.params.appId);
    return { message: 'Deleted' as const };
  } catch (error) {
    throw internal(error, '[COMMANDS] deleteCommand error:');
  }
}

/** GET /apps/channel/:channelId/commands: commands or shortcuts available in a channel (shortcuts carry appName). */
export async function listChannelCommands(input: {
  params: { channelId: string };
  query: RouteQuery<typeof appsChannelCommands>;
}) {
  const { commandType, commandAccessibility } = input.query;
  const filter: { commandType: CommandType; commandAccessibility?: CommandAccessibility } = { commandType: commandType as CommandType };
  if (commandAccessibility && Object.values(CommandAccessibility).includes(commandAccessibility as CommandAccessibility)) {
    filter.commandAccessibility = commandAccessibility as CommandAccessibility;
  }
  try {
    // Shortcuts need appName for the picker UI; commands don't
    return commandType === CommandType.SHORTCUT
      ? await appCommandRepository.findByChannelIdWithAppName(input.params.channelId, filter)
      : await appCommandRepository.findByChannelId(input.params.channelId, filter);
  } catch (error) {
    throw internal(error, '[COMMANDS] getChannelCommands error:');
  }
}

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
export async function listAttachedResources(input: {
  params: { installedAppId: string; resourceType: string };
  user: AuthenticatedUser | undefined;
}) {
  try {
    const { install, resource, workspaceId } = await resolveAttachable(input.params, input.user);
    return { resourceType: resource.kind, items: await currentAttachedItems(install.id, workspaceId, resource) };
  } catch (error) {
    throw internal(error, 'Error listing attached resources:', { error: 'Failed to list attached resources' });
  }
}

/**
 * PATCH /apps/installed/:installedAppId/resources/:resourceType: a delta (added / removed ids)
 * rather than the whole set, effective at once. An id in both ends up attached (the repository
 * deletes before it creates).
 */
export async function setAttachedResources(input: {
  params: { installedAppId: string; resourceType: string };
  body: RouteBody<typeof appsInstalledResourcesSet>;
  user: AuthenticatedUser | undefined;
}) {
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
}

// ─── Fetch config ───────────────────────────────────────────────────────────

const installNotFound = () =>
  new ContractError(404, { error: 'Installed app not found in this workspace', code: 'INSTALLED_APP_NOT_FOUND' });

/**
 * GET /apps/installed/:installedAppId/fetch-config: the stored config (secrets redacted), or a
 * default derived from the install's webhook URL when none is stored; `configured` tells which.
 */
export async function getFetchConfig(input: { params: { installedAppId: string }; user: AuthenticatedUser | undefined }) {
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
}

/** DELETE /apps/installed/:installedAppId/fetch-config: turns history pulls off for this install. */
export async function deleteFetchConfig(input: { params: { installedAppId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const workspaceId = requireWorkspaceId(input.user, 'installedAppId and workspace are required');
    const install = await findOwnInstall(input.params.installedAppId, workspaceId);
    if (!install) throw installNotFound();
    await repositories.installedApps.update(install.id, { fetchConfig: null });
    return { configured: false as const };
  } catch (error) {
    throw internal(error, 'Error clearing app fetch config:');
  }
}

// ─── Incoming-webhook management ────────────────────────────────────────────

type BotUser = (Awaited<ReturnType<typeof repositories.users.findById>> & { workspaceId?: string }) | null;

/** POST /apps/incoming-webhooks */
export async function createIncomingWebhook(input: { body: RouteBody<typeof appsIncomingWebhooksCreate>; user: AuthenticatedUser | undefined }) {
  try {
    const { installedAppId, channelId, boardId, name, type, action } = input.body;
    const user = input.user;
    if (!user?.id) {
      logger.warn('[Incoming-Webhook] Missing authenticated user for create webhook', { body: input.body });
      throw new ContractError(401, { error: 'Unauthorized' });
    }
    // Scope to the caller's workspace (via the bot user) so you can't create a webhook against
    // another workspace's install.
    const workspaceId = user.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const installedApp = await repositories.installedApps.findFirst({ where: { id: installedAppId, user: { workspaceId } } });
    if (!installedApp) throw new ContractError(404, { error: 'Installed app not found in this workspace' });

    if (!(await repositories.channelParticipants.isParticipant(channelId, installedApp.userId))) {
      throw new ContractError(400, { error: 'Bot is not a member of this channel' });
    }
    if (!(await repositories.channelParticipants.isParticipant(channelId, user.id))) {
      throw new ContractError(400, { error: 'User is not a member of this channel' });
    }
    const channel = await repositories.channels.findById(channelId);
    if (!channel) throw new ContractError(404, { error: 'Channel not found' });

    // Only SentinelOne supports ticket creation today; the other sources always post a message.
    const messageOnlyTypes: AppIncomingWebhookType[] = [
      AppIncomingWebhookType.SLACK,
      AppIncomingWebhookType.AMAZON_SNS,
      AppIncomingWebhookType.PINGDOM,
      AppIncomingWebhookType.GCP,
    ];
    const normalizedAction: AppIncomingWebhookAction = messageOnlyTypes.includes(type) ? AppIncomingWebhookAction.MESSAGE : action;
    const effectiveBoardId = normalizedAction === AppIncomingWebhookAction.TICKET ? boardId : undefined;
    let boardName: string | null = null;
    if (normalizedAction === AppIncomingWebhookAction.TICKET && !effectiveBoardId) {
      throw new ContractError(400, { error: 'Board is required for ticket webhooks' });
    }
    if (effectiveBoardId) {
      const board = await repositories.boards.findById(effectiveBoardId);
      if (!board) throw new ContractError(404, { error: 'Board not found' });
      boardName = board.name;
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const webhook = await repositories.incomingWebhooks.create({
      installedAppId,
      channelId,
      workspaceId,
      ...(effectiveBoardId ? { boardId: effectiveBoardId } : {}),
      name,
      type,
      action: normalizedAction,
      secret: encrypt(rawSecret),
      createdBy: user.id,
    });
    const botUser = (await repositories.users.findById(installedApp.userId)) as BotUser;
    const webhookUrl = incomingWebhookController.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret, type);
    return {
      id: webhook.id,
      name: webhook.name,
      channelId: webhook.channelId,
      channelName: channel?.name ?? '',
      channelVisibility: channel?.visibility ?? 'public',
      boardId: webhook.boardId ?? null,
      boardName,
      type,
      action: normalizedAction,
      isActive: webhook.isActive,
      createdAt: webhook.createdAt,
      webhookUrl,
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error creating webhook', { userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** GET /apps/incoming-webhooks/:installedAppId */
export async function listIncomingWebhooks(input: {
  params: { installedAppId: string };
  query: RouteQuery<typeof appsIncomingWebhooksList>;
  user: AuthenticatedUser | undefined;
}) {
  const { installedAppId } = input.params;
  try {
    const { limit, offset, includeInactive } = input.query;
    const activeOnly = !includeInactive;
    // Scope to the caller's workspace: another workspace's install's webhooks are not listed.
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const installedApp = await repositories.installedApps.findFirst({ where: { id: installedAppId, user: { workspaceId } } });
    if (!installedApp) throw new ContractError(404, { error: 'Installed app not found in this workspace' });

    const [webhooks, total] = await Promise.all([
      repositories.incomingWebhooks.findByInstalledAppId(installedAppId, { skip: offset, take: limit, activeOnly }),
      repositories.incomingWebhooks.countByInstalledAppId(installedAppId, activeOnly),
    ]);
    const botUser = (await repositories.users.findById(installedApp.userId)) as BotUser;
    const result = webhooks.map((webhook) => {
      let webhookUrl = '';
      if (webhook.isActive) {
        try {
          const rawSecret = decrypt(webhook.secret);
          const webhookType = (webhook.type as AppIncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK;
          webhookUrl = incomingWebhookController.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret, webhookType);
        } catch (error) {
          logger.warn('[Incoming-Webhook] Failed to decrypt webhook secret while listing webhooks', { webhookId: webhook.id, installedAppId, error });
          webhookUrl = '';
        }
      }
      return {
        id: webhook.id,
        name: webhook.name,
        channelId: webhook.channelId,
        channelName: webhook.channel.name,
        channelVisibility: webhook.channel.visibility,
        boardId: webhook.boardId ?? null,
        boardName: webhook.board?.name ?? null,
        type: (webhook.type as AppIncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK,
        action: (webhook.action as AppIncomingWebhookAction | undefined) ?? AppIncomingWebhookAction.MESSAGE,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        webhookUrl,
      };
    });
    return { webhooks: result, total, limit, offset };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error listing webhooks', { installedAppId, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** The webhook, if it belongs to an install of the caller's workspace (any other is "not found"). */
async function ownWebhook(webhookId: string, workspaceId: string | undefined) {
  const webhook = await repositories.incomingWebhooks.findById(webhookId);
  if (!webhook) throw new ContractError(404, { error: 'Webhook not found' });
  if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
  const ownInstall = await repositories.installedApps.findFirst({ where: { id: webhook.installedAppId, user: { workspaceId } } });
  if (!ownInstall) throw new ContractError(404, { error: 'Webhook not found' });
  return webhook;
}

/** PATCH /apps/incoming-webhooks/:webhookId: rename (not a revoked one). */
export async function updateIncomingWebhook(input: {
  params: { webhookId: string };
  body: RouteBody<typeof appsIncomingWebhooksUpdate>;
  user: AuthenticatedUser | undefined;
}) {
  const { webhookId } = input.params;
  try {
    const webhook = await ownWebhook(webhookId, input.user?.workspaceId);
    if (!webhook.isActive) throw new ContractError(400, { error: 'Cannot update a revoked webhook' });
    await repositories.incomingWebhooks.update(webhookId, { name: input.body.name });
    return { success: true as const };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error updating webhook', { webhookId, userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

/** POST /apps/incoming-webhooks/:webhookId/revoke */
export async function revokeIncomingWebhook(input: { params: { webhookId: string }; user: AuthenticatedUser | undefined }) {
  const { webhookId } = input.params;
  try {
    const userId = input.user?.id;
    const workspaceId = input.user?.workspaceId;
    if (!userId || !workspaceId) {
      logger.warn('[Incoming-Webhook] Missing authenticated user for revoke webhook', { webhookId });
      throw new ContractError(401, { error: 'Unauthorized' });
    }
    const webhook = await ownWebhook(webhookId, workspaceId);
    if (!webhook.isActive) throw new ContractError(400, { error: 'Webhook is already revoked' });
    await repositories.incomingWebhooks.revoke(webhookId, userId);
    return { success: true as const };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error revoking webhook', { webhookId, userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
}
