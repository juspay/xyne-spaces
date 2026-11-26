import { ChannelRole, type RouteBody, type RouteQuery, type appsChannelDeskConfig, type appsChannelInfo, type appsChannelList, type appsChannelOpenDm, type appsChannelUpdate } from '@xyne/shared';
import { setAppChannelOnDesk } from '@/channelsDesk/admin';
import { ChannelController } from '@/controllers/channelController';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { ContractError, type AppCaller } from '@/framework/api';
import { AppError } from '@/middleware/errorHandler';
import { applyChannelParticipants, planChannelParticipants, type AddedChannelParticipant, type ChannelParticipantsPlan } from '@/services/channelParticipantsService';
import { ChannelFieldError, prepareChannelFields, writeChannelFields } from '@/services/channelFieldService';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { ChannelParticipantsSideEffectHandler } from '@/zero/side-effects/tables/channel-participants-handler';
import { GuestError } from '../../../apps/core/guestUtils';
import { findMembers } from '../../../apps/utils/channelUtils';

/**
 * The Xyne Apps channel API on the typed framework (apps/routes/channel.ts): no req/res, same
 * answers as the controller methods it replaces (ChannelController.getChannelByName /
 * getDeskConfig / listChannels, AppChannelController.update, the inline openDm route).
 */

const internalError = () => new ContractError(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });

function requireBot(user: AuthenticatedUser | undefined): AuthenticatedUser & { workspaceId: string } {
  if (!user?.workspaceId) throw new ContractError(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  return user as AuthenticatedUser & { workspaceId: string };
}

/** POST /apps/channel/openDm: the bot's DM with a user of its own workspace. */
export async function openDm(input: { body: RouteBody<typeof appsChannelOpenDm>; user: AuthenticatedUser | undefined }) {
  const bot = input.user;
  const workspaceId = bot?.workspaceId; // tenant from the verified token, never the body
  if (!bot || !workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
  const { targetUserId } = input.body;
  try {
    // Tenant isolation: 404 (not 403) on a mismatch, so cross-tenant user ids cannot be enumerated.
    const targetUser = await repositories.users.findById(targetUserId);
    if (!targetUser || targetUser.workspaceId !== workspaceId) {
      logger.warn(`[openDm] Rejected cross-workspace/unknown target user ${targetUserId} for workspace ${workspaceId}`);
      throw new ContractError(404, { error: 'Target user not found' });
    }
    const { unifiedDMService } = await import('@/bots/unified/services/unified-dm-service');
    const channel = await unifiedDMService.getOrCreateBotDM(targetUserId, bot.id, workspaceId);
    return { channelId: channel.id };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[openDm] Failed to open DM:', error);
    throw new ContractError(500, { error: 'Internal server error' });
  }
}

async function findChannel(channelId: string | undefined, channelName: string | undefined) {
  const channel = channelId ? await repositories.channels.findById(channelId) : await repositories.channels.findByName(channelName!);
  if (!channel) throw new ContractError(404, { error: 'Channel not found', code: 'CHANNEL_NOT_FOUND' });
  return channel;
}

/** POST /apps/channel/info */
export async function channelInfo(input: { body: RouteBody<typeof appsChannelInfo> }) {
  try {
    const channel = await findChannel(input.body.channelId, input.body.channelName);
    return {
      id: channel.id,
      name: channel.name,
      description: channel.description || undefined,
      type: channel.type,
      scopeType: channel.scopeType,
      visibility: channel.visibility,
      projectId: channel.projectId,
      createdBy: channel.createdBy,
      createdAt: channel.createdAt,
      participantCount: channel.participantCount,
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[CHANNEL-CONTROLLER] Error getting channel by name:', error);
    throw internalError();
  }
}

/** POST /apps/channel/deskChannelConfig: the channel's EmailChannelPreference. */
export async function deskChannelConfig(input: { body: RouteBody<typeof appsChannelDeskConfig> }) {
  try {
    const channel = await findChannel(input.body.channelId, input.body.channelName);
    const config = await new EmailChannelPreferenceRepository().findByChannelId(channel.id);
    return { config };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[CHANNEL-CONTROLLER] Error getting desk config:', error);
    throw internalError();
  }
}

/** GET /apps/channel/list: cursor pagination, optional exact name filter. */
export async function listChannels(input: { query: RouteQuery<typeof appsChannelList>; user: AuthenticatedUser | undefined }) {
  const { limit, cursor, joined, projectId, scopeType, name } = input.query;
  // Tenant comes from the verified app token, never from the query string.
  const bot = requireBot(input.user);
  try {
    const where: Record<string, unknown> = { workspaceId: bot.workspaceId };
    if (projectId) where.projectId = projectId;
    if (scopeType) where.scopeType = scopeType;
    if (name) where.name = name;
    if (joined === 'true') where.participants = { some: { userId: bot.id } };

    // One extra to know whether there is more.
    const channels = await repositories.channels.findManyPaginated({ where, limit: limit + 1, cursor });
    const hasMore = channels.length > limit;
    const items = hasMore ? channels.slice(0, limit) : channels;
    return {
      items: items.map((channel) => ({
        id: channel.id,
        name: channel.name,
        description: channel.description || undefined,
        scopeType: channel.scopeType,
        projectId: channel.projectId,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt,
      })),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  } catch (error) {
    logger.error('[CHANNEL-CONTROLLER] Error listing channels:', error);
    throw internalError();
  }
}

const NO_DESK = { error: 'This app has no Channels desk yet; an admin links one in Desks.', code: 'NO_DESK' };
const ON_OTHER_DESK = { error: 'This channel is already on another desk.', code: 'CHANNEL_ON_OTHER_DESK' };
const NOT_ELIGIBLE = {
  error: 'Only regular channels can go on a desk (not DMs, archived channels or desks).',
  code: 'CHANNEL_NOT_ELIGIBLE',
};
const PARTICIPANTS_ERROR_CODES: Record<number, string> = { 400: 'VALIDATION_FAILED', 403: 'FORBIDDEN', 404: 'CHANNEL_NOT_FOUND' };
const channelController = new ChannelController();

/** One "changed the roles of ..." channel message for the whole call, not one per person. */
async function announceRoleChanges(
  bot: AuthenticatedUser,
  channelId: string,
  changes: Array<{ userId: string; userName: string; oldRole: string; role: string }>,
): Promise<void> {
  try {
    await channelController.sendRoleUpdatedSystemMessage(
      channelId,
      { id: bot.id, name: bot.name },
      changes.map(({ userId, userName, oldRole, role }) => ({ userId, userName, oldRole, newRole: role })),
    );
  } catch (error) {
    logger.error('[APP-CHANNEL] Failed to post role-change system message', {
      error: (error instanceof Error ? error.message : String(error)).replace(/\n|\r/g, ' '),
    });
  }
}

/** The "X was added by Y" channel message, then the participants side effects (sync, notifications). */
async function announceAdded(bot: AuthenticatedUser, channelId: string, added: AddedChannelParticipant[]): Promise<void> {
  try {
    await channelController.sendAddAndRemoveParticipantsSystemMessage(
      channelId,
      added.map(({ userId, userName }) => ({ userId, userName })),
      { id: bot.id, name: bot.name },
      'participants_added',
    );
  } catch (error) {
    logger.error('[APP-CHANNEL] Failed to post add-people system message', {
      error: (error instanceof Error ? error.message : String(error)).replace(/\n|\r/g, ' '),
    });
  }
  const handler = new ChannelParticipantsSideEffectHandler({
    userID: bot.id,
    workspaceId: bot.workspaceId,
    role: bot.role,
    orgRole: bot.orgRole,
    memberId: bot.memberId,
  });
  await handler.onBatchInsert(channelId, added.map(({ userId }) => userId));
  await repositories.channels.queueVespaFeed(channelId, bot.workspaceId);
}

/**
 * POST /apps/channel/update: set the fields of a channel the bot is in, put it on the app's
 * Channels desk or take it off, and add people (with updateRoles, also set existing roles).
 */
export async function updateChannel(input: {
  body: RouteBody<typeof appsChannelUpdate>;
  user: AuthenticatedUser | undefined;
  app: AppCaller | undefined;
}) {
  const bot = requireBot(input.user);
  const { channelId, fields, desk, updateRoles } = input.body;
  const adminEmails = [...new Set(input.body.adminEmails)];
  const memberEmails = [...new Set(input.body.memberEmails)];
  const app = { installedAppId: input.app?.installedAppId ?? '', botUserId: bot.id, workspaceId: bot.workspaceId };

  try {
    const inChannel = await db.channelParticipant.findFirst({
      where: { channelId, userId: bot.id, workspaceId: app.workspaceId },
      select: { channelId: true },
    });
    if (!inChannel) throw new ContractError(403, { error: `${channelId} is not a channel this app is in.`, code: 'CHANNEL_NOT_ALLOWED' });

    const prepared = fields ? await prepareChannelFields(app.workspaceId, fields) : null;
    let participantsPlan: ChannelParticipantsPlan | null = null;
    if (adminEmails.length + memberEmails.length > 0) {
      const adminIds = await findMembers(app, adminEmails);
      const memberIds = await findMembers(app, memberEmails);
      participantsPlan = await planChannelParticipants({
        channelId,
        actorId: app.botUserId,
        actorWorkspaceRole: bot.role,
        workspaceId: app.workspaceId,
        updateRoles,
        targets: [
          ...adminIds.map((userId) => ({ userId, role: ChannelRole.ADMIN })),
          ...memberIds.map((userId) => ({ userId, role: ChannelRole.MEMBER })),
        ],
      });
    }

    if (desk !== undefined) {
      const result = await setAppChannelOnDesk(app, channelId, desk);
      if (result === 'no-desk') throw new ContractError(400, NO_DESK);
      if (result === 'not-eligible') throw new ContractError(400, NOT_ELIGIBLE);
      if (result === 'other-desk') throw new ContractError(409, ON_OTHER_DESK);
    }
    if (prepared) await writeChannelFields(app.workspaceId, channelId, prepared);

    let participants: { added: string[]; updated: Array<{ userId: string; role: string }>; alreadyMembers: string[] } | undefined;
    if (participantsPlan) {
      const { added, updated, alreadyMembers } = await applyChannelParticipants(participantsPlan);
      if (added.length > 0) await announceAdded(bot, channelId, added);
      if (updated.length > 0) await announceRoleChanges(bot, channelId, updated);
      participants = {
        added: added.map(({ userId }) => userId),
        updated: updated.map(({ userId, role }) => ({ userId, role })),
        alreadyMembers,
      };
    }
    return { channelId, ...(desk !== undefined && { desk }), ...(participants && { participants }) };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (error instanceof ChannelFieldError) throw new ContractError(400, { error: error.message, code: error.code });
    if (error instanceof GuestError) throw new ContractError(error.status, { error: error.message, code: error.code });
    if (error instanceof AppError && error.statusCode < 500) {
      throw new ContractError(error.statusCode, { error: error.message, code: PARTICIPANTS_ERROR_CODES[error.statusCode] ?? 'BAD_REQUEST' });
    }
    logger.error('[APP-CHANNEL] Channel update failed:', error);
    throw new ContractError(500, { error: 'Internal server error' });
  }
}