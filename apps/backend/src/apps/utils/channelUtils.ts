import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ProjectType, UserStatus, WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import { findOrgMembers } from '@/bypassAcl/appGuestServices';
import { GuestError, type GuestApp } from '../core/guestUtils';

/**
 * Resolve channelId from channelName or conversationId if channelId is not provided
 * 
 * @param channelId - Channel ID (optional)
 * @param conversationId - Conversation ID (optional)
 * @param channelName - Channel name (optional)
 * @returns Resolved channel ID
 * @throws Error if no identifier is provided, or if the resource is not found
 */
export async function resolveChannelId(
  channelId: string | undefined,
  conversationId: string | undefined,
  channelName?: string | undefined
): Promise<string> {
  if (channelId) {
    return channelId;
  }

  if (channelName) {
    logger.info(`[CHANNEL-UTILS] Resolving channelId from channelName: ${channelName}`);
    const channel = await repositories.channels.findByName(channelName);
    if (!channel) {
      logger.warn(`[CHANNEL-UTILS] Channel not found by name: ${channelName}`);
      throw new Error('Channel not found');
    }
    logger.info(`[CHANNEL-UTILS] Resolved channelId: ${channel.id} from channelName: ${channelName}`);
    return channel.id;
  }

  if (!conversationId) {
    throw new Error('Either channelId, channelName, or conversationId is required');
  }

  logger.info(`[CHANNEL-UTILS] Resolving channelId from conversationId: ${conversationId}`);
  const conversation = await repositories.conversations.findById(conversationId);
  
  if (!conversation) {
    logger.warn(`[CHANNEL-UTILS] Conversation not found: ${conversationId}`);
    throw new Error('Conversation not found');
  }

  logger.info(`[CHANNEL-UTILS] Resolved channelId: ${conversation.channelId} from conversationId: ${conversationId}`);
  return conversation.channelId;
}

/** Active, non-guest workspace members by email, in the order given. */
export async function findMembers(app: GuestApp, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const users = await db.user.findMany({ where: { workspaceId: app.workspaceId, email: { in: emails } } });
  const members = await findOrgMembers(app, users.map((user) => user.orgMemberId));
  const inOrg = new Set(members.filter((member) => !member.leftAt).map((member) => member.memberId));
  const byEmail = new Map(users.map((user) => [user.email, user]));
  const invalid = emails.filter((email) => {
    const user = byEmail.get(email);
    return (
      !user ||
      user.role === WorkspaceRole.GUEST ||
      user.status !== UserStatus.ACTIVE ||
      user.leftAt ||
      !inOrg.has(user.orgMemberId)
    );
  });
  if (invalid.length > 0) {
    throw new GuestError(404, 'MEMBER_NOT_FOUND', `No active member with email ${invalid.join(', ')}.`);
  }
  return emails.map((email) => byEmail.get(email)!.id);
}

/** The project a new channel goes in, by its name (unique per workspace). */
export async function findProject(app: GuestApp, name: string): Promise<string> {
  const project = await db.project.findFirst({
    where: { workspaceId: app.workspaceId, name, type: { not: ProjectType.DM } },
    select: { id: true },
  });
  if (!project) {
    throw new GuestError(404, 'PROJECT_NOT_FOUND', `No project named ${name}.`);
  }
  return project.id;
}
