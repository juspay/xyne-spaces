import { api, AccessType, type RouteBody } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { CreateAppInput } from '@/database/repositories/appsRepository';
import { withWorkspaceScope } from '@/database/tenant/context';
import { ContractError } from '@/framework/api';
import { promoteAppToGlobal } from '@/bypassAcl/appServices';
import { vespaQueue } from '@/queues/vespaQueue';
import { ClawAgentLookupError } from '@/services/clawAgentService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { appSchema } from '@/vespa/src/types';
import { configureWebhook, getSigningSecret, installApp, regenerateJwt } from '../../apps/core/appUtils';
import { internal } from './dashboard.helpers';

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Authentication required', code: 'UNAUTHORIZED' });
  return user;
}

const isNotFound = (error: unknown): error is Error => error instanceof Error && error.message.includes('not found');

async function isAclAdmin(userId: string): Promise<boolean> {
  const resource = await repositories.resources.findByName('XYNE-APPS');
  if (!resource) return false;
  return await repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN);
}

// ─── App setup ──────────────────────────────────────────────────────────────

/** POST /apps/create */
export async function createApp(input: { body: RouteBody<typeof api.apps.create>; user: AuthenticatedUser | undefined }) {
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
  body: RouteBody<typeof api.apps.configureWebhook>;
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
export async function orgNames(input: { body: RouteBody<typeof api.apps.orgNames> }) {
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