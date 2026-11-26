import { ChannelRole, ChannelScopeType, ChannelType } from '@xyne/shared';
import type { channelsSearch, channelsShareAgentStatus } from '@xyne/shared';
import type { z } from 'zod';
import { db } from '@/database/client';
import { hasProjectAdminAccess } from '@/database/acl/admin-access';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { UserGroupRepository } from '@/database/repositories/userGroups';
import { UserRepository } from '@/database/repositories/users';
import { ContractError } from '@/framework/api';
import { resolveAppDeskInstalledAppId, extractSlackChannelId } from '@/integrations/core/deskSources';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { SOCIAL_MEDIA_PLATFORMS, isMetaMessagingPlatform, isSocialMediaPlatform } from '@/integrations/social-media/constants';
import { ChannelEmailAliasService } from '@/services/channelEmailAliasService';
import {
  getPreShareStatus,
  ShareAgentConversationError,
  type ShareErrorCode,
} from '@/services/shareAgentConversationService';
import { vespaService } from '@/services/vespaSearch';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * Channel lookups and checks on the typed framework (routes/channels.ts): no req/res, same answers
 * as the ChannelController and ShareAgentConversationController methods they replace.
 */

const channelRepository = new ChannelRepository();
const channelParticipantRepository = new ChannelParticipantRepository();
const userRepository = new UserRepository();
const userGroupRepository = new UserGroupRepository();
const channelEmailAliasService = new ChannelEmailAliasService();

const internal = (error: unknown, logMessage: string, body: { error: string } & Record<string, unknown> = { error: 'Internal server error' }) => {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, body);
};
/** The envelope some of these answer with: `{ success: false, error }`. */
const failed = (error: string) => ({ success: false, error });

// ─── check-duplicate, member-counts, publish-targets ────────────────────────

/** POST /channels/check-duplicate: is this channel name taken in the caller's workspace. */
export async function checkDuplicate(input: { body: { name: string; projectId?: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { name, projectId } = input.body;
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(400, { error: 'Missing workspaceId' });
    const isDuplicate = await channelRepository.checkDuplicateName(name.trim(), workspaceId);
    return { isDuplicate, name: name.trim(), ...(projectId ? { projectId } : {}) };
  } catch (error) {
    throw internal(error, 'Error checking channel duplicate:');
  }
}

/** POST /channels/member-counts: participant counts for a set of channels. */
export async function memberCounts(input: { body: { channelIds: string[] }; user: AuthenticatedUser | undefined }) {
  try {
    if (!input.user?.id) throw new ContractError(401, failed('Unauthorized'));
    const { channelIds } = input.body;
    const counts: Record<string, number> = {};
    if (channelIds.length === 0) return { success: true as const, data: { counts } };
    const stats = await db.channelStats.findMany({
      where: { channelId: { in: channelIds } },
      select: { channelId: true, participantCount: true },
    });
    for (const stat of stats) counts[stat.channelId] = stat.participantCount;
    return { success: true as const, data: { counts } };
  } catch (error) {
    throw internal(error, 'Error in getChannelMemberCounts:', failed('Internal server error'));
  }
}

/** GET /channels/publish-targets: default and document channels the caller is in (no DMs). */
export async function publishTargets(input: { user: AuthenticatedUser | undefined }) {
  try {
    const userId = input.user?.id;
    if (!userId) throw new ContractError(403, { error: 'Unauthorized - user not authenticated' });
    const participations = await channelParticipantRepository.getUserChannels(userId);
    const channelIds = participations.map((p) => p.channelId);
    if (channelIds.length === 0) return { channels: [] };
    const allChannels = await channelRepository.getChannelsByIds(channelIds);
    return {
      channels: allChannels
        .filter((channel) => channel.scopeType === ChannelScopeType.DEFAULT || channel.scopeType === ChannelScopeType.DOCUMENT)
        .map((c) => ({ id: c.id, name: c.name, projectId: c.projectId, scopeType: c.scopeType })),
    };
  } catch (error) {
    throw internal(error, 'Error getting channels for docs:');
  }
}

// ─── Search for mentions ────────────────────────────────────────────────────

/** GET /channels/search: users and groups to mention. */
export async function searchForMentions(input: { query: z.infer<(typeof channelsSearch)['query']>; user: AuthenticatedUser | undefined }) {
  try {
    const userId = input.user!.id;
    const { q, limit = '10', types = 'users,groups' } = input.query;
    const searchLimit = Math.min(parseInt(limit) || 10, 15); // Max 15 results
    const searchTypes = types.split(',').map((type) => type.trim());
    type Mention =
      | { id: string; name: string; email: string; picture: string | null; type: 'user' }
      | { id: string; name: string; alias: string | null; description: string | null; memberCount: number; type: 'group' };
    const results: Mention[] = [];

    try {
      const searches: Promise<Mention[]>[] = [];
      if (searchTypes.includes('users')) {
        searches.push(
          userRepository.findBySearch(q.trim(), { page: 1, pageSize: searchLimit }).then((found) => {
            const users = Array.isArray(found) ? found : found.data;
            return users
              .filter((user) => user.status === 'ACTIVE' && user.id !== userId)
              .slice(0, searchLimit)
              .map((user) => ({ id: user.id, name: user.displayName || user.name, email: user.email, picture: user.picture, type: 'user' as const }));
          }),
        );
      }
      if (searchTypes.includes('groups')) {
        searches.push(
          userGroupRepository.findBySearch(q.trim(), { page: 1, pageSize: searchLimit }).then(async (found) => {
            const groups = Array.isArray(found) ? found : found.data;
            return Promise.all(
              groups.slice(0, searchLimit).map(async (group) => {
                let memberCount = 0;
                try {
                  memberCount = await userGroupRepository.getUserCount(group.id);
                } catch (error) {
                  logger.warn(`Failed to get member count for group ${group.id}:`, error);
                }
                return { id: group.id, name: group.name, alias: group.alias, description: group.description, memberCount, type: 'group' as const };
              }),
            );
          }),
        );
      }
      for (const found of await Promise.all(searches)) results.push(...found);

      const limited = results.slice(0, searchLimit);
      return { results: limited, total: limited.length, query: q, limit: searchLimit, types: searchTypes };
    } catch (searchError) {
      logger.error('Error during unified search:', searchError);
      throw new ContractError(500, { error: 'Search failed' });
    }
  } catch (error) {
    throw internal(error, 'Error in unified search for mentions:');
  }
}

// ─── One channel: connected email, alias, members ───────────────────────────

/** GET /channels/:channelId/connected-email: the desk's mailbox or app or social source. Same rule as the socket layer: workspace boundary, and members only for PRIVATE channels. */
export async function connectedEmail(input: { params: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { channelId } = input.params;
    const userId = input.user?.id;
    const workspaceId = input.user?.workspaceId;
    if (!userId || !workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const channel = await channelRepository.findById(channelId);
    if (!channel || channel.workspaceId !== workspaceId) throw new ContractError(404, { error: 'Channel not found' });
    if (channel.visibility === 'PRIVATE' && !(await channelParticipantRepository.isParticipant(channelId, userId))) {
      throw new ContractError(403, { error: 'Forbidden' });
    }

    // Slack channels and apps can be bound onto any desk type; they must not shadow the desk's own source.
    const source = await db.externalSource.findFirst({
      where: {
        channelId,
        workspaceId,
        NOT: {
          sourceType: {
            in: [
              ...(channel.type === ChannelType.SLACK ? [] : [ExternalSourcePlatform.SLACK_DESK]),
              ...(channel.type === ChannelType.APP ? [] : [ExternalSourcePlatform.APP_DESK]),
            ],
          },
        },
      },
      select: { name: true, displayName: true, sourceType: true, isActive: true, externalIdentifier: true },
      orderBy: { createdAt: 'desc' },
    });
    const hasSource = !!source;
    let isConnected = source?.isActive === true;
    const sourceType = source?.sourceType ?? null;
    let connectedLabel: string | null = null;
    let outboundConfigured = true;
    let deskApps: Array<{ id: string; displayName: string; externalIdentifier: string | null; packageName: string | null; isActive: boolean }> = [];

    if (source?.sourceType === ExternalSourcePlatform.APP_DESK) {
      const installedAppId = resolveAppDeskInstalledAppId(source) ?? '';
      const installedApp = await db.installedApps.findUnique({
        where: { id: installedAppId },
        select: { webhookUrl: true, app: { select: { name: true, signingSecret: true } } },
      });
      connectedLabel = installedApp?.app?.name ?? null;
      outboundConfigured = Boolean(installedApp?.webhookUrl?.trim() && installedApp.app?.signingSecret);
    } else if (source?.sourceType === ExternalSourcePlatform.SLACK_DESK) {
      connectedLabel = extractSlackChannelId(source.name);
    } else if (sourceType && isSocialMediaPlatform(sourceType) && !isMetaMessagingPlatform(sourceType)) {
      const reviewSources = await db.externalSource.findMany({
        where: { channelId, workspaceId, sourceType: { in: [...SOCIAL_MEDIA_PLATFORMS] } },
        select: { id: true, displayName: true, externalIdentifier: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const active = reviewSources.filter((s) => s.isActive);
      isConnected = active.length > 0;
      deskApps = reviewSources.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        externalIdentifier: s.externalIdentifier,
        packageName: s.externalIdentifier,
        isActive: s.isActive,
      }));
      connectedLabel = active.map((s) => s.displayName).join(', ') || 'No active apps';
    } else if (source && isMetaMessagingPlatform(source.sourceType)) {
      const igSources = await db.externalSource.findMany({
        where: { channelId, workspaceId, sourceType: source.sourceType },
        select: { id: true, displayName: true, externalIdentifier: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const active = igSources.filter((s) => s.isActive);
      isConnected = active.length > 0;
      deskApps = igSources.map((s) => ({
        id: s.id,
        displayName: s.displayName ?? s.externalIdentifier ?? '',
        externalIdentifier: s.externalIdentifier,
        packageName: s.externalIdentifier,
        isActive: s.isActive,
      }));
      const handlePrefix = source.sourceType === ExternalSourcePlatform.INSTAGRAM ? '@' : '';
      connectedLabel = active.map((s) => (s.displayName ? `${handlePrefix}${s.displayName}` : s.externalIdentifier)).join(', ') || null;
    }

    const answer = (email: string | null, label: string | null) => ({
      email,
      isConnected,
      hasSource,
      sourceType,
      connectedLabel: label,
      outboundConfigured,
      deskApps,
      googlePlayApps: deskApps,
    });

    const fromDisplay = (source?.displayName ?? '').match(/[\w.+-]+@[\w.-]+\.[\w.-]+/)?.[0];
    if (fromDisplay) {
      const email = fromDisplay.toLowerCase();
      return answer(email, connectedLabel ?? email);
    }
    const preference = await db.emailChannelPreference.findUnique({ where: { channelId }, select: { ownerUserId: true } });
    if (preference?.ownerUserId) {
      const owner = await db.user.findUnique({ where: { id: preference.ownerUserId }, select: { email: true } });
      if (owner?.email) {
        const email = owner.email.toLowerCase();
        return answer(email, connectedLabel ?? email);
      }
    }
    return answer(null, connectedLabel);
  } catch (error) {
    throw internal(error, 'Error in getConnectedEmail:');
  }
}

/** GET /channels/:channelId/email-alias: members only. */
export async function emailAlias(input: { params: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { channelId } = input.params;
    const userId = input.user?.id;
    if (!userId) throw new ContractError(401, { error: 'Unauthorized' });
    if (!(await channelParticipantRepository.isParticipant(channelId, userId))) throw new ContractError(403, { error: 'Forbidden' });
    const channel = await channelRepository.findById(channelId);
    if (!channel) throw new ContractError(404, { error: 'Channel not found' });
    return await channelEmailAliasService.getChannelEmailInfo(channel.workspaceId, channelId);
  } catch (error) {
    throw internal(error, 'Error in getEmailAlias:');
  }
}

/** GET /channels/:channelId/vespa-participants: user ids from the search index's channel permissions. */
export async function vespaParticipants(input: { params: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const userIds = await vespaService.channelService.getChannelParticipants(input.params.channelId, input.user!.id);
    return { success: true as const, data: { userIds } };
  } catch (error) {
    throw internal(error, 'Error in getVespaParticipants:', failed('Internal server error'));
  }
}

/** GET /channels/:channelId/members: active members as `{ id, name }`, for members only. */
export async function channelMembers(input: { params: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const { channelId } = input.params;
    if (!(await channelParticipantRepository.isParticipant(channelId, input.user!.id))) throw new ContractError(403, failed('Forbidden'));
    return { success: true as const, data: { members: await channelParticipantRepository.getActiveChannelMembers(channelId) } };
  } catch (error) {
    throw internal(error, 'Error in getChannelMembers:', failed('Internal server error'));
  }
}

/** GET /channels/:channelId/can-link-boards: a channel admin, or a project admin. */
export async function canLinkBoards(input: { params: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const userId = input.user!.id;
    const role = await channelParticipantRepository.getParticipantRole(input.params.channelId, userId);
    if (role === ChannelRole.ADMIN) return { success: true as const, data: { canLinkBoards: true } };
    return { success: true as const, data: { canLinkBoards: await hasProjectAdminAccess(db, userId) } };
  } catch (error) {
    throw internal(error, 'Error in canLinkChannelBoards:', failed('Internal server error'));
  }
}

// ─── Share an agent conversation: the pre-share status ──────────────────────

const SHARE_ERROR_STATUS: Record<ShareErrorCode, number> = {
  CHANNEL_NOT_FOUND: 404,
  NOT_A_CHANNEL_MEMBER: 403,
  INVALID_TARGET_CHANNEL: 422,
  CHANNEL_ARCHIVED: 409,
  RESHARE_CONFIRMATION_REQUIRED: 409,
  EMPTY_TRANSCRIPT: 422,
  TRANSCRIPT_TOO_LARGE: 413,
  NO_NEW_MESSAGES: 409,
  ADD_AGENT_FORBIDDEN: 403,
  AGENT_NOT_INSTALLED: 422,
  SHARING_DISABLED: 403,
};

/** GET /channels/:channelId/share-agent-conversation/status */
export async function shareAgentStatus(input: {
  params: { channelId: string };
  query: z.infer<(typeof channelsShareAgentStatus)['query']>;
  user: AuthenticatedUser | undefined;
}) {
  try {
    const workspaceId = input.user!.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    return await getPreShareStatus({
      agentSlug: input.query.agentSlug,
      sourceConversationId: input.query.sourceConversationId,
      targetChannelId: input.params.channelId,
      activePathTipMessageId: input.query.activePathTipMessageId || null,
      userId: input.user!.id,
      workspaceId,
    });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (error instanceof ShareAgentConversationError) {
      throw new ContractError(SHARE_ERROR_STATUS[error.code], { error: error.message, code: error.code });
    }
    logger.error('[shareAgentConversation] getStatus failed', { error });
    throw new ContractError(500, { error: 'Failed to share agent conversation' });
  }
}
