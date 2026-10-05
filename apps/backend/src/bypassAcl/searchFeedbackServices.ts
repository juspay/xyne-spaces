import { MessageType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { conversationService } from '@/services/conversationService';
import { UserGroupRepository } from '@/database/repositories/userGroups';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import type { QueryContext } from '@/zero/acl/core/types';
import { asService, asSystem } from './base';

/**
 * Search feedback (services/searchFeedbackService). Feedback can be routed to one shared
 * channel that lives in a different workspace than the reporter, so these reads and the post
 * itself can't run under the reporter's own tenant scope.
 *
 * Every id passed in comes from server config (CAC `search_feedback_target`) or from the
 * resolved channel, never from the request.
 */

const userGroupRepository = new UserGroupRepository();

/** Configured feedback channel, by id. Private is allowed (an admin chose it); archived is not. */
export function findFeedbackChannelById(
  channelId: string
): Promise<{ id: string; name: string; workspaceId: string } | null> {
  return asSystem(
    ['Channel'],
    'search feedback: configured channel may be in another workspace than the reporter',
    async () =>
      await db.channel.findFirst({
        where: { id: channelId, isArchived: false },
        select: { id: true, name: true, workspaceId: true },
      })
  );
}

/** Configured user group to tag, by id. */
export function findFeedbackGroupById(
  userGroupId: string
): Promise<{ id: string; name: string; alias: string | null } | null> {
  return asSystem(
    ['UserGroup'],
    'search feedback: configured group may be in another workspace than the reporter',
    async () =>
      await db.userGroup.findUnique({
        where: { id: userGroupId },
        select: { id: true, name: true, alias: true },
      })
  );
}

/**
 * Fallback group in the channel's workspace, by alias then name (many groups have no alias).
 * `workspaceId` is the channel's workspace, which may not be the reporter's.
 */
export function findFeedbackGroupByHandle(
  handle: string,
  workspaceId: string
): Promise<{ id: string; name: string; alias: string | null } | null> {
  return asSystem(
    ['UserGroup'],
    "search feedback: fallback group lives in the channel's workspace, not the reporter's",
    async () =>
      (await userGroupRepository.findByAlias(handle, workspaceId)) ??
      (await userGroupRepository.findByName(handle, workspaceId))
  );
}

/** Member count for the group mention badge. */
export function countFeedbackGroupMembers(groupId: string): Promise<number> {
  return asSystem(
    ['UserGroupMapping'],
    'search feedback: group may be in another workspace than the reporter',
    async () => await userGroupRepository.getUserCount(groupId)
  );
}

/** Reporter's workspace name, for the message's `Workspace:` line. */
export function findFeedbackWorkspaceName(workspaceId: string): Promise<string | null> {
  return asSystem(
    ['Workspace'],
    "search feedback: workspace row isn't always visible under the reporter's request scope",
    async () =>
      (await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }))
        ?.name ?? null
  );
}

/**
 * Posts the feedback message as the reporter, written in the channel's workspace.
 * The reporter is not added to the channel just because they sent feedback.
 */
export function postFeedbackMessage(
  userId: string,
  channel: { id: string; workspaceId: string },
  content: string
): ReturnType<typeof conversationService.createConversationWithMessage> {
  return asService(
    ['Conversation', 'Message', 'ConversationParticipant'],
    'search feedback: post into the feedback channel, which may be in another workspace than the reporter',
    userId,
    channel.workspaceId,
    async () =>
      await conversationService.createConversationWithMessage({
        channelId: channel.id,
        userId,
        content,
        msgType: MessageType.USER,
        isAddingParticipant: false,
        emitsMessageReceivedViaSideEffects: true,
      })
  );
}

/**
 * Notifications (incl. the group ping) and unread counts for a posted feedback message, in
 * the channel's workspace. Only `workspaceId` is overridden on the reporter's context: the
 * handler reads just `userID` and `workspaceId`. Errors are logged, not thrown — the message
 * is already posted.
 */
export function notifyFeedbackPosted(
  ctx: QueryContext,
  channelWorkspaceId: string,
  messageId: string
): Promise<void> {
  return asService(
    ['Message', 'Activity', 'Notification', 'ChannelUserStatus'],
    "search feedback: notifications belong to the channel's workspace, not the reporter's",
    ctx.userID,
    channelWorkspaceId,
    async () => {
      try {
        await new MessagesSideEffectHandler({ ...ctx, workspaceId: channelWorkspaceId }).onInsert({
          entityId: messageId,
          entityType: 'messages',
          operation: 'insert',
        });
      } catch (err) {
        logger.error('[SearchFeedback] Side-effect handler error:', err);
      }
    }
  );
}
