import { ReadonlyJSONValue, Transaction, defineMutators, defineMutator } from '@rocicorp/zero';
import {
  ChannelRole,
  ChannelType,
  ChannelVisibility,
  MessageType,
  CallStatus,
  RecurringCallSeriesStatus,
  InvitationResponse,
  MeetingStatus,
  ChannelScopeType,
  ChannelAddUserPolicy,
  ChannelSortOrder,
  ConversationParticipation,
  TicketStatusV2,
  TicketPriority,
  TicketReferenceRelation,
  CanvasVisibility,
  CanvasRole,
  BookmarkEntityType,
  AttachmentEntityType,
  UserPresenceStatus,
  FormFieldType,
  FormContextType,
  FormEntityType,
  LinkVisibility,
  UserResponsibility,
  DocType,
  PRStatusEvent,
  RotationInterval,

  ActivityClassification,
  AccessType,
  BoardType,
  TicketStageRequestStatus,
  ActivityType,
  RCAStatus,
  COEStatus,
  SEVERITY,
  AttributionConfidence,
  NudgeKind,
  NudgeState,
  SurfaceAreaType,
  SurfaceLinkKind,
  NotificationLevel,
  SavedConfigContextType,
  SavedConfigVisibility,
  SavedConfigEntityName,
  WorkspaceRole,
  Status,
  OrgRole,
  DelayedMessageStatus,
  Schema,

} from './schema.js';
import { createForwardedMessageXml, parseForwardedMessageXml } from '../forwardedMessage.js';
import { getNudgeActionBehavior } from '../nudges.js';
import { serializeInitialMessageMd, serializeParentMessageMd } from '../utils/activityMetadataParser.js';
import type { MessageType as MessageTypeEnum } from './schema.js';
import { extractAllMentions } from '../utils/mentionParser.js';
import { z } from 'zod';

/** Build initial_message_md from message data. Single helper for all conversation creation sites. */
function buildInitialMessageMd(msg: {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType: MessageTypeEnum;
  hasAttachment?: boolean;
  showInChannel?: boolean;
  visibleTo?: string | null;
  createdAt: number;
  metadata?: unknown;
  childConversationId?: string | null;
}): string | null {
  return serializeInitialMessageMd({
    messageId: msg.messageId,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: msg.content,
    msgType: msg.msgType,
    hasAttachment: msg.hasAttachment ?? false,
    edited: false,
    isDeleted: false,
    showInChannel: msg.showInChannel ?? false,
    visibleTo: msg.visibleTo ?? null,
    createdAt: msg.createdAt,
    metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
    nudgeCount: null,
    isSent: false,
    reactions_md: null,
    link_preview_md: null,
    childConversationId: msg.childConversationId ?? null,
  });
}

/** Build parent_message_md from an existing message row. */
function buildParentMessageMd(msg: {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType: MessageTypeEnum;
  createdAt: number;
}): string | null {
  return serializeParentMessageMd({
    messageId: msg.messageId,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: msg.content,
    msgType: msg.msgType,
    createdAt: msg.createdAt,
  });
}
import { zql } from './builder.js';
import {
  buildRepliesMdFromMessages,
  isChatMessageType,
  resolveMessage,
  updateReactionsMd,
  updateInitialMessageMdField,
  updateInitialMessageMdReaction,
} from './messageMetadata.js';
import { updateTicketMdFromZero } from '../utils/ticketMetadata.js';

async function getConversationSeenCutoffAt(
  tx: Transaction<Schema>,
  channelId: string,
  fallbackTimestamp: number,
): Promise<number> {
  const seenConversations = await tx.run(
    zql.conversations
      .where('channelId', channelId)
      .where('createdAt', '<=', fallbackTimestamp)
      .orderBy('createdAt', 'desc')
      .limit(25),
  );

  return seenConversations[seenConversations.length - 1]?.createdAt ?? null;
}

export type AuthData = {
  sub: string;
};

function getNudgeDirection(
  nudgeKind: string,
): { from: SurfaceAreaType; to: SurfaceAreaType } | null {
  switch (nudgeKind as NudgeKind) {
    case NudgeKind.CREATE_TICKET_FROM_MESSAGE:
    case NudgeKind.FIND_RELATED_TICKET_FROM_MESSAGE:
      return { from: SurfaceAreaType.MESSAGE, to: SurfaceAreaType.TICKET };
    case NudgeKind.FIND_RELATED_MESSAGE_FROM_MESSAGE:
      return { from: SurfaceAreaType.MESSAGE, to: SurfaceAreaType.MESSAGE };
    case NudgeKind.SCHEDULE_CALL_FROM_THREAD:
      return { from: SurfaceAreaType.MESSAGE, to: SurfaceAreaType.CALL };
    default:
      return null;
  }
}

const bookmarkByEntityQuery = (userId: string, entityId: string, entityType: BookmarkEntityType) =>
  zql.bookmarks
    .where('userId', userId)
    .where('entityId', entityId)
    .where('entityType', entityType);

const buildCompletedBookmarkMetadata = (
  metadata: unknown,
  completedAt: number,
): ReadonlyJSONValue => {
  const nextMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  delete nextMetadata.reminder;
  delete nextMetadata.snoozeUntil;
  nextMetadata.completion = {
    done: true,
    completedAt: new Date(completedAt).toISOString(),
  };

  return nextMetadata as ReadonlyJSONValue;
};

export const mutators = defineMutators({
  notificationSettings: {
    setChannelNotificationLevel: defineMutator(
      z.object({
        channelId: z.string(),
        desktopNotificationLevel: z
          .enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE'])
          .optional(),
        mobileNotificationLevel: z
          .enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE'])
          .optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { channelId, desktopNotificationLevel, mobileNotificationLevel, timestamp },
      }) => {
        const userStatus = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!userStatus) {
          throw new Error('Not a channel participant');
        }

        await tx.mutate.channel_user_status.update({
          id: userStatus.id,
          ...(desktopNotificationLevel !== undefined && { desktopNotificationLevel }),
          ...(mobileNotificationLevel !== undefined && { mobileNotificationLevel }),
          updatedAt: timestamp,
        });
      },
    ),
  },
  channel: {
    joinChannel: defineMutator(
      z.object({
        channelId: z.string(),
        channelParticipantId: z.string(),
        channelUserStatusId: z.string(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx: _ctx,
        args: { channelId, channelParticipantId, channelUserStatusId, timestamp },
      }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        // Check if channel is public
        if (channel.visibility !== ChannelVisibility.PUBLIC) {
          throw new Error('Can only join public channels');
        }

        // Check if user is already a participant
        const existingParticipant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', _ctx.userID).one(),
        );

        if (existingParticipant) {
          throw new Error('You are already a member of this channel');
        }

        // Add user as a participant
        await tx.mutate.channel_participants.insert({
          id: channelParticipantId,
          channelId: channelId,
          joinedAt: timestamp,
          role: ChannelRole.MEMBER,
          userId: _ctx.userID,

          // TODO: deprecated columns needs to be removed
          lastViewedAt: timestamp,
          isStarred: false,
          isClosed: false,
        });

        // Check for existing soft-deleted channel_user_status to restore
        const existingSoftDeletedStatus = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', _ctx.userID)
            .where('isDeleted', true)
            .one(),
        );
        const conversationSeenCutoffAt = await getConversationSeenCutoffAt(
          tx,
          channelId,
          timestamp,
        );

        if (existingSoftDeletedStatus) {
          // Restore the soft-deleted status record
          await tx.mutate.channel_user_status.update({
            id: existingSoftDeletedStatus.id,
            isDeleted: false,
            isClosed: false,
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.channel_user_status.insert({
            id: channelUserStatusId,
            channelId: channelId,
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
            userId: _ctx.userID,
            isStarred: false,
            isClosed: false,
            unreadCount: 0,
            isRecapSubscribed: false,
            desktopNotificationLevel: NotificationLevel.ALL,
            mobileNotificationLevel: NotificationLevel.ALL,
            isDeleted: false,
            updatedAt: timestamp,
          });
        }
      },
    ),
    promoteToChannel: defineMutator(
      z.object({
        channelId: z.string(),
        name: z.string().min(2).max(80),
        description: z.string().optional(),
        visibility: z.enum([ChannelVisibility.PUBLIC, ChannelVisibility.PRIVATE]),
        projectId: z.string(),
        conversationId: z.string(),
        messageId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, name } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error('Channel not found');
        }

        if (channel.scopeType !== ChannelScopeType.GROUP_DM) {
          throw new Error('Only GROUP_DM channels can be promoted to a regular channel');
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!participant) {
          throw new Error('You are not a participant of this channel');
        }

        const existingChannel = await tx.run(zql.channels.where('name', name).one());
        if (existingChannel && existingChannel.id !== channelId) {
          throw new Error('A channel with this name already exists');
        }
      },
    ),
    addParticipants: defineMutator(
      z.object({
        channelId: z.string(),
        userIds: z.array(z.string()),
        timestamp: z.number(),
        participantIds: z.record(z.string(), z.string()), // Map userId -> participantId
        userStatusIds: z.record(z.string(), z.string()), // Map userId -> userStatusId
      }),
      async ({
        tx,
        ctx,
        args: { channelId, userIds, timestamp, participantIds, userStatusIds },
      }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exists");
        }

        const participationOfRequestingUser = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!participationOfRequestingUser) {
          throw new Error('You are not allowed to add someone');
        }

        const users = await Promise.all(userIds.map(id => tx.run(zql.users.where('id', id).one())));
        const validUsers = users.filter(user => user !== undefined);
        const conversationSeenCutoffAt = await getConversationSeenCutoffAt(
          tx,
          channelId,
          timestamp,
        );

        for (const user of validUsers) {
          const isAlreadyParticipant = await tx.run(
            zql.channel_participants.where('channelId', channelId).where('userId', user.id).one(),
          );
          if (isAlreadyParticipant) {
            continue;
          }

          const participantId = participantIds[user.id];
          if (!participantId) {
            throw new Error(`participantId is required for user ${user.id}`);
          }
          const statusId = userStatusIds[user.id];
          if (!statusId) {
            throw new Error(`userStatusId is required for user ${user.id}`);
          }
          await tx.mutate.channel_participants.insert({
            id: participantId,
            channelId: channelId,
            joinedAt: timestamp,
            role: ChannelRole.MEMBER,
            userId: user.id,
            // TODO: deprecated columns needs to be removed
            lastViewedAt: timestamp,
            isStarred: false,
            isClosed: false,
          });

          await tx.mutate.channel_user_status.insert({
            id: statusId,
            channelId: channelId,
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
            userId: user.id,
            isStarred: false,
            isClosed: false,
            unreadCount: 0,
            isRecapSubscribed: false,
            desktopNotificationLevel: NotificationLevel.ALL,
            mobileNotificationLevel: NotificationLevel.ALL,
            isDeleted: false,
            updatedAt: timestamp,
          });
        }
      },
    ),
    removeParticipant: defineMutator(
      z.object({ channelId: z.string(), targetUserId: z.string(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, targetUserId, updatedAt } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        const participationOfRequestingUser = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!participationOfRequestingUser) {
          throw new Error('Only channel members can remove participants');
        }

        if (participationOfRequestingUser.role !== ChannelRole.ADMIN) {
          throw new Error('Only channel admins can remove participants');
        }

        // Check if target user is actually a participant
        const targetParticipant = await tx.run(
          zql.channel_participants
            .where('channelId', channelId)
            .where('userId', targetUserId)
            .one(),
        );

        if (!targetParticipant) {
          throw new Error('User is not a participant in this channel');
        }

        // Prevent removing yourself
        if (targetUserId === ctx.userID) {
          throw new Error('Cannot remove yourself from the channel');
        }

        // Prevent removing the channel creator
        if (targetUserId === channel.createdBy) {
          throw new Error('Cannot remove the channel creator');
        }

        // Remove the participant
        await tx.mutate.channel_participants.delete({
          id: targetParticipant.id,
        });

        const channelUserStatusParticipant = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', targetUserId)
            .where('isDeleted', false)
            .one(),
        );

        if (channelUserStatusParticipant) {
          await tx.mutate.channel_user_status.update({
            id: channelUserStatusParticipant.id,
            isDeleted: true,
            updatedAt,
          });
        }
      },
    ),
    leaveChannel: defineMutator(
      z.object({ channelId: z.string(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, updatedAt } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error('Channel not found');
        }

        // Check if user is participant
        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!participant) {
          throw new Error('Not a channel participant');
        }

        // Remove participant
        await tx.mutate.channel_participants.delete({
          id: participant.id,
        });

        const channelUserStatusParticipant = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (channelUserStatusParticipant) {
          await tx.mutate.channel_user_status.update({
            id: channelUserStatusParticipant.id,
            isDeleted: true,
            updatedAt,
          });
        }
      },
    ),
    updateAddUserPolicy: defineMutator(
      z.object({
        channelId: z.string(),
        policy: z.nativeEnum(ChannelAddUserPolicy),
      }),
      async ({ tx, ctx, args: { channelId, policy } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        if (channel.scopeType !== ChannelScopeType.DEFAULT) {
          throw new Error('Can only update add-user policy for default channels');
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!participant || participant.role !== ChannelRole.ADMIN) {
          throw new Error('Only channel admins can update the add-user policy');
        }

        await tx.mutate.channel_stats.update({
          channelId,
          addUserPolicy: policy,
        });
      },
    ),
    makeChannelPublic: defineMutator(
      z.object({
        channelId: z.string(),
      }),
      async ({ tx, ctx, args: { channelId } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        if (channel.scopeType !== ChannelScopeType.DEFAULT) {
          throw new Error('Can only change visibility for default channels');
        }
        if (channel.visibility !== ChannelVisibility.PRIVATE) {
          throw new Error('Channel is already public');
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!participant || participant.role !== ChannelRole.ADMIN) {
          throw new Error('Only channel admins can make a channel public');
        }

        await tx.mutate.channels.update({
          id: channelId,
          visibility: ChannelVisibility.PUBLIC,
        });
      },
    ),
    markChannelAsViewed: defineMutator(
      z.object({
        channelId: z.string(),
        conversationId: z.string().optional(),
        timestamp: z.number(),
        draftMessageId: z.string(),
        draftMessage: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: { channelId, conversationId, timestamp, draftMessageId, draftMessage },
      }) => {
        const participant = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!participant) {
          throw new Error('Not a channel participant');
        }

        const conversationSeenCutoffAt = await getConversationSeenCutoffAt(
          tx,
          channelId,
          timestamp,
        );

        const updateData: {
          lastViewedAt: number;
          unreadCount: number;
          lastViewedConversationId?: string;
          conversationSeenCutoffAt?: number;
        } = {
          lastViewedAt: timestamp,
          unreadCount: 0,
          conversationSeenCutoffAt,
        };

        if (conversationId) {
          updateData.lastViewedConversationId = conversationId;
        }

        await tx.mutate.channel_user_status.update({
          id: participant.id,
          ...updateData,
          updatedAt: timestamp,
        });

        // Query for drafts in this channel for this user (follows backend logic)
        const channelDrafts = await tx.run(
          zql.draft_messages.where('channelId', channelId).where('userId', ctx.userID),
        );

        // Find the channel-level draft (conversationId === null)
        const draft = channelDrafts.find(d => d.conversationId === null);

        if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
          await tx.mutate.draft_messages.delete({ id: draft.id });
        } else if (draftMessage.trim() !== '') {
          await tx.mutate.draft_messages.upsert({
            id: draft?.id || draftMessageId,
            conversationId: null,
            channelId,
            userId: ctx.userID,
            content: draftMessage,
            hasAttachment: draft?.hasAttachment || false,
            updatedAt: timestamp,
            createdAt: draft?.createdAt || timestamp,
          });
        }

        const unreadActivities = await tx.run(
          zql.activities
            .where('userId', ctx.userID)
            .where('isRead', false)
            .where('channelId', channelId),
        );

        if (unreadActivities.length === 0) {
          return;
        }

        const messageIds = Array.from(
          new Map(
            unreadActivities.map(a => [
              a.actionSourceId,
              { activityId: a.id, sourceId: a.actionSourceId },
            ]),
          ).values(),
        );

        const messages = await Promise.all(
          messageIds.map(messagePair => resolveMessage(tx, messagePair.sourceId)),
        );

        for (const [index, message] of messages.entries()) {
          const messagePair = messageIds[index];
          if (!message || !messagePair) {
            continue;
          }
          const conv = await tx.run(
            zql.conversations.where('conversationId', message.conversationId).one(),
          );
          if (conv?.initialMessageId === message.messageId) {
            await tx.mutate.activities.update({
              id: messagePair.activityId,
              isRead: true,
            });
          }
        }
      },
    ),
    markChannelUnreadFrom: defineMutator(
      z.object({
        channelId: z.string(),
        messageId: z.string(),
        conversationId: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, messageId, conversationId, timestamp } }) => {
        const participant = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!participant) {
          throw new Error(`User ${ctx.userID} is not a participant of channel ${channelId}`);
        }

        // Validate message exists
        let message = await resolveMessage(tx, messageId);
        if (!message) {
          throw new Error(`Message ${messageId} not found`);
        }

        // If the message is from the current user, find the nearest message from another user
        if (message.senderId === ctx.userID) {
          // Get the conversation to find messages before/after this one
          const currentConversation = await tx.run(
            zql.conversations.where('conversationId', message.conversationId).one(),
          );
          if (!currentConversation) {
            throw new Error(`Conversation ${message.conversationId} not found`);
          }

          // First, try to find a conversation ABOVE (before) from another user
          const previousConversations = await tx.run(
            zql.conversations
              .where('channelId', channelId)
              .where('createdAt', '<', currentConversation.createdAt)
              .where('createdBy', '!=', ctx.userID)
              .orderBy('createdAt', 'desc')
              .limit(1),
          );

          let targetConversation = previousConversations[0];

          // If no previous conversation from another user, try to find one BELOW (after)
          if (!targetConversation) {
            const nextConversations = await tx.run(
              zql.conversations
                .where('channelId', channelId)
                .where('createdAt', '>', currentConversation.createdAt)
                .where('createdBy', '!=', ctx.userID)
                .orderBy('createdAt', 'asc')
                .limit(1),
            );
            targetConversation = nextConversations[0];
          }

          if (!targetConversation) {
            // No message from another user exists at all, nothing to mark as unread
            return;
          }

          // Get the initial message of that conversation
          const targetMessage = await resolveMessage(tx, targetConversation.initialMessageId);

          if (!targetMessage) {
            // Target message not found, nothing to mark as unread
            return;
          }

          // Use the target message instead
          message = targetMessage;
        }

        // Get the conversation to use its createdAt for lastViewedAt calculation
        // We use conversation.createdAt because the UI compares lastViewedAt against conversation.createdAt
        const messageConversation = await tx.run(
          zql.conversations.where('conversationId', message.conversationId).one(),
        );
        if (!messageConversation) {
          throw new Error(`Conversation ${message.conversationId} not found`);
        }

        const newLastViewedAt = messageConversation.createdAt - 1;
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error(`Channel ${channelId} not found`);
        }

        // Fetch activities with related messages and conversations in a single query
        const recentActivities = await tx.run(
          zql.activities
            .where('userId', ctx.userID)
            .where('channelId', channelId)
            .where('createdAt', '>', newLastViewedAt)
            .related('message', m => m.related('conversation')),
        );

        // Filter for Root Activities (exclude thread replies and user's own messages)
        // Is Root if: Message exists AND InitialMessageId == MessageId AND not sent by current user
        const rootActivities = recentActivities.filter(activity => {
          if (!activity.messageId || !activity.message) return false;
          const msg = activity.message;
          return msg.conversation && msg.conversation.initialMessageId === msg.messageId;
        });

        let unreadCount = 0;

        if (
          channel.scopeType === ChannelScopeType.DM ||
          channel.scopeType === ChannelScopeType.GROUP_DM
        ) {
          // For DMs, count conversations not created by the current user
          const conversations = await tx.run(
            zql.conversations
              .where('channelId', channelId)
              .where('createdAt', '>', newLastViewedAt)
              .where('createdBy', '!=', ctx.userID),
          );
          unreadCount = conversations.length;
        } else {
          // For Channels, use the Root Activity count we just calculated
          unreadCount = rootActivities.length;
        }

        const updateData: {
          lastViewedAt: number;
          unreadCount: number;
          lastViewedConversationId?: string;
          conversationSeenCutoffAt?: number;
        } = {
          lastViewedAt: newLastViewedAt,
          unreadCount: unreadCount,
          conversationSeenCutoffAt: await getConversationSeenCutoffAt(
            tx,
            channelId,
            newLastViewedAt,
          ),
        };

        if (conversationId) {
          updateData.lastViewedConversationId = conversationId;
        }

        // Update Channel status
        await tx.mutate.channel_user_status.update({
          id: participant.id,
          ...updateData,
          updatedAt: timestamp,
        });

        // Mark root activities unread sequentially for safer transaction handling
        // We only update activities that are currently marked as read
        const activitiesToMarkUnread = rootActivities.filter(a => a.isRead);
        for (const activity of activitiesToMarkUnread) {
          await tx.mutate.activities.update({
            id: activity.id,
            isRead: false,
          });
        }
      },
    ),
    toggleStarred: defineMutator(
      z.object({ channelId: z.string(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, updatedAt } }) => {
        const participation = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!participation) {
          throw new Error('Not a channel participant');
        }

        await tx.mutate.channel_user_status.update({
          id: participation.id,
          isStarred: !participation.isStarred,
          updatedAt,
        });
      },
    ),
    closeDm: defineMutator(
      z.object({ channelId: z.string(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, updatedAt } }) => {
        const participation = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!participation) {
          throw new Error('Not a channel participant');
        }

        await tx.mutate.channel_user_status.update({
          id: participation.id,
          isClosed: true,
          updatedAt,
        });
      },
    ),
    reopenDm: defineMutator(
      z.object({ channelId: z.string(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, updatedAt } }) => {
        const participation = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!participation) {
          throw new Error('Not a channel participant');
        }

        await tx.mutate.channel_user_status.update({
          id: participation.id,
          isClosed: false,
          updatedAt,
        });
      },
    ),
    updateSelectedBoardId: defineMutator(
      z.object({ channelId: z.string(), boardId: z.string().nullable(), updatedAt: z.number() }),
      async ({ tx, ctx, args: { channelId, boardId, updatedAt } }) => {
        const userStatus = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (!userStatus) {
          throw new Error('No channel user status found');
        }

        await tx.mutate.channel_user_status.update({
          id: userStatus.id,
          selectedBoardId: boardId,
          updatedAt,
        });
      },
    ),
    updateDescription: defineMutator(
      z.object({
        channelId: z.string(),
        description: z.string(),
        messageId: z.string(),
        conversationId: z.string(),
        timestamp: z.number(),
        conversationParticipantId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          channelId,
          description,
          messageId,
          conversationId,
          timestamp,
          conversationParticipantId,
        },
      }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        // Check if user is a participant
        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!participant) {
          throw new Error('Only channel participants can update the description');
        }
        // Get user info for system message (optional — user may not be in local replica yet)
        const user = await tx.run(zql.users.where('id', ctx.userID).one());
        await tx.mutate.channels.update({
          id: channelId,
          description: description,
        });

        const now = timestamp;
        const systemMessageContent = `set the channel description to: ${description}`;

        // Create conversation for the system message
        await tx.mutate.conversations.insert({
          conversationId,
          channelId,
          createdBy: ctx.userID,
          initialMessageId: messageId,
          lastActivityAt: now,
          replyCount: 0,
          pinned: false,
          metadata: undefined,
          createdAt: now,
          initial_message_md: buildInitialMessageMd({
            messageId,
            conversationId,
            senderId: ctx.userID,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            createdAt: now,
          }),
        });

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: ctx.userID,
          content: systemMessageContent,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isSent: false,
          isDeleted: false,
          showInChannel: false,
          createdAt: now,
          metadata: {
            operationType: 'description_updated',
            newDescription: description,
            userId: ctx.userID,
            userName: user?.name,
          },
        });

        // Add creator as conversation participant
        await tx.mutate.conversation_participants.insert({
          id: conversationParticipantId,
          conversationId,
          userId: ctx.userID,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: now,
          channelId: channelId,
        });
      },
    ),
    updateParticipantRole: defineMutator(
      z.object({
        channelId: z.string(),
        targetUserId: z.string(),
        newRole: z.nativeEnum(ChannelRole),
        timestamp: z.number(),
        conversationId: z.string(),
        messageId: z.string(),
        conversationParticipantId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          channelId,
          targetUserId,
          newRole,
          timestamp,
          conversationId,
          messageId,
          conversationParticipantId,
        },
      }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        // Check if requesting user is an admin or channel creator
        const requestingParticipant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!requestingParticipant) {
          throw new Error('You are not a participant in this channel');
        }

        const isAdmin = requestingParticipant.role === ChannelRole.ADMIN;
        const isCreator = channel.createdBy === ctx.userID;

        if (!isAdmin && !isCreator) {
          throw new Error('Only channel admins or creators can update participant roles');
        }

        // Get target participant
        const targetParticipant = await tx.run(
          zql.channel_participants
            .where('channelId', channelId)
            .where('userId', targetUserId)
            .one(),
        );

        if (!targetParticipant) {
          throw new Error('User is not a participant in this channel');
        }

        // Prevent modifying the channel creator's role
        if (targetUserId === channel.createdBy) {
          throw new Error("Cannot modify the channel creator's role");
        }

        // Only creators can grant admin role
        if (newRole === ChannelRole.ADMIN && !isCreator) {
          throw new Error('Only channel creators can grant admin role');
        }

        // Non-creators cannot change admin roles
        if (targetParticipant.role === ChannelRole.ADMIN && !isCreator) {
          throw new Error('Only channel creators can modify admin roles');
        }

        // Update the participant's role
        await tx.mutate.channel_participants.update({
          id: targetParticipant.id,
          role: newRole,
        });

        // Get user info for system message
        const requestingUser = await tx.run(zql.users.where('id', ctx.userID).one());
        const targetUser = await tx.run(zql.users.where('id', targetUserId).one());

        if (!requestingUser || !targetUser) {
          throw new Error('User not found');
        }

        const now = timestamp;
        const systemMessageContent = `changed ${targetUser.name}'s role to ${newRole}`;

        // Create conversation for the system message
        await tx.mutate.conversations.insert({
          conversationId,
          channelId,
          createdBy: ctx.userID,
          initialMessageId: messageId,
          lastActivityAt: now,
          replyCount: 0,
          pinned: false,
          metadata: undefined,
          createdAt: now,
          initial_message_md: buildInitialMessageMd({
            messageId,
            conversationId,
            senderId: ctx.userID,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            createdAt: now,
          }),
        });

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: ctx.userID,
          content: systemMessageContent,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: false,
          showInChannel: false,
          createdAt: now,
          metadata: {
            operationType: 'role_updated',
            targetUserId: targetUserId,
            targetUserName: targetUser.name,
            newRole: newRole,
            updatedBy: ctx.userID,
            updatedByName: requestingUser.name,
          },
        });

        // Add creator as conversation participant
        await tx.mutate.conversation_participants.insert({
          id: conversationParticipantId,
          conversationId,
          userId: ctx.userID,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: now,
          channelId: channelId,
        });
      },
    ),
    renameChannel: defineMutator(
      z.object({
        channelId: z.string(),
        name: z.string().min(2).max(80),
        messageId: z.string(),
        conversationId: z.string(),
        timestamp: z.number(),
        conversationParticipantId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: { channelId, name },
      }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        if (channel.scopeType !== ChannelScopeType.DEFAULT) {
          throw new Error('Only default channels can be renamed');
        }

        // Check if user is a participant
        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );

        if (!participant) {
          throw new Error('Only channel participants can rename the channel');
        }

        // Only admins or creator can rename
        if (participant.role !== ChannelRole.ADMIN && channel.createdBy !== ctx.userID) {
          throw new Error('Only channel admins can rename the channel');
        }

        // Check for duplicate name
        const existingChannel = await tx.run(zql.channels.where('name', name).one());
        if (existingChannel && existingChannel.id !== channelId) {
          throw new Error('A channel with this name already exists');
        }


      },
    ),
    archiveChannel: defineMutator(
      z.object({
        channelId: z.string(),
      }),
      async ({ tx, args: { channelId } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        if (channel.type !== ChannelType.DEFAULT) {
          throw new Error('Only channels can be archived');
        }

        await tx.mutate.channels.update({
          id: channelId,
          isArchived: true,
        });
      },
    ),
    unarchiveChannel: defineMutator(
      z.object({
        channelId: z.string(),
      }),
      async ({ tx, args: { channelId } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        await tx.mutate.channels.update({
          id: channelId,
          isArchived: false,
        });
      },
    ),
  },
  conversations: {
    send: defineMutator(
      z.object({
        channelId: z.string(),
        content: z.string(),
        conversationId: z.string(),
        messageId: z.string(),
        timestamp: z.number(),
        type: z.nativeEnum(MessageType),
      }),
      async ({
        tx,
        ctx,
        args: { channelId, content, type, conversationId, messageId, timestamp },
      }) => {
        if (content === '') {
          throw new Error('Message content or files are required to start a conversation');
        }

        const now = timestamp;

        // Query for drafts first to determine hasAttachments before conversation insert
        const channelDrafts = await tx.run(
          zql.draft_messages.where('channelId', channelId).where('userId', ctx.userID),
        );
        const draft = channelDrafts.find(d => d.conversationId === null);

        let hasAttachments = false;
        if (draft) {
          const draftAttachments = await tx.run(
            zql.message_attachments
              .where('entityId', draft.id)
              .where('entityType', AttachmentEntityType.DRAFT),
          );

          if (draftAttachments.length > 0) {
            hasAttachments = true;
            // Transfer attachments from draft to message
            for (const attachment of draftAttachments) {
              await tx.mutate.message_attachments.update({
                id: attachment.id,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId: conversationId,
              });
            }
          }

          // Delete the draft message after transferring
          await tx.mutate.draft_messages.delete({
            id: draft.id,
          });
        }

        await tx.mutate.conversations.insert({
          conversationId,
          channelId,
          createdBy: ctx.userID,
          initialMessageId: messageId,
          lastActivityAt: now,
          replyCount: 0,
          pinned: false,
          metadata: {},
          createdAt: now,
          initial_message_md: buildInitialMessageMd({
            messageId,
            conversationId,
            senderId: ctx.userID,
            content: content.trim(),
            msgType: type,
            hasAttachment: hasAttachments,
            createdAt: now,
          }),
        });

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: ctx.userID,
          content: content.trim(),
          msgType: type,
          hasAttachment: hasAttachments,
          edited: false,
          isDeleted: false,
          isSent: false,
          showInChannel: false,
          createdAt: now,
          metadata: {},
        });

        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        const participation = await tx.run(
          zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );

        if (participation) {
          const conversationSeenCutoffAt = await getConversationSeenCutoffAt(tx, channelId, now);
          await tx.mutate.channel_user_status.update({
            id: participation.id,
            lastViewedAt: now,
            conversationSeenCutoffAt,
            lastViewedConversationId: conversationId,
            isClosed: false,
            updatedAt: now,
          });
        }
      },
    ),
    update: defineMutator(
      z.object({ messageId: z.string(), content: z.string() }),
      async ({ tx, args: { messageId, content } }) => {
        if (content === '') {
          throw new Error('Message content or files are required to start a conversation');
        }

        await tx.mutate.messages.update({
          messageId,
          content: content,
          edited: true,
        });
        await updateInitialMessageMdField(tx, { messageId }, { content, edited: true });
      },
    ),
    togglePin: defineMutator(
      z.object({ conversationId: z.string() }),
      async ({ tx, args: { conversationId } }) => {
        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );

        if (!conversation) {
          throw new Error("Conversation doesn't exist");
        }

        await tx.mutate.conversations.update({
          conversationId,
          pinned: !conversation.pinned,
        });
      },
    ),
    forwardMessage: defineMutator(
      z.object({
        targetChannelId: z.string(),
        originalMessageId: z.string(),
        optionalMessage: z.string().optional(),
        conversationId: z.string(),
        messageId: z.string(),
        timestamp: z.number(),
        conversationParticipantId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          targetChannelId,
          originalMessageId,
          optionalMessage,
          conversationId,
          messageId,
          timestamp,
          conversationParticipantId,
        },
      }) => {
        // Verify target channel exists
        const targetChannel = await tx.run(zql.channels.where('id', targetChannelId).one());
        if (!targetChannel) {
          throw new Error('Target channel not found');
        }

        // Verify user is a participant of the target channel
        const participation = await tx.run(
          zql.channel_participants
            .where('channelId', targetChannelId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (!participation) {
          throw new Error('You are not a participant of the target channel');
        }

        // Get the original message
        const originalMessage = await resolveMessage(tx, originalMessageId);
        if (!originalMessage) {
          throw new Error('Original message not found');
        }

        // Get original sender info
        const originalSender = await tx.run(zql.users.where('id', originalMessage.senderId).one());

        // Get original message's conversation to find the channel
        const originalConversation = await tx.run(
          zql.conversations.where('conversationId', originalMessage.conversationId).one(),
        );

        // Verify user is a participant of the origin channel (where the message is being forwarded from)
        if (originalConversation?.channelId) {
          const originParticipation = await tx.run(
            zql.channel_participants
              .where('channelId', originalConversation.channelId)
              .where('userId', ctx.userID)
              .one(),
          );
          if (!originParticipation) {
            throw new Error('You are not a participant of the origin channel');
          }
        }

        // Handle re-forwarding: if the original message is already forwarded,
        // parse the XML to get the optionalText and use that as content (if exists)
        // When using optionalText, don't include attachments (it's either optionalText OR message content with attachments)
        const isReForwarding = originalMessage.msgType === MessageType.FORWARDED;
        let forwardedContent = originalMessage.content;
        let useOptionalText = false;

        if (isReForwarding) {
          const parsedForwarded = parseForwardedMessageXml(originalMessage.content);
          if (parsedForwarded?.optionalText) {
            forwardedContent = parsedForwarded.optionalText;
            useOptionalText = true;
          } else if (parsedForwarded?.content) {
            forwardedContent = parsedForwarded.content;
          }
        }
        const forwardedHasAttachment = useOptionalText ? false : originalMessage.hasAttachment;

        const now = timestamp;

        // Create XML content for the forwarded message
        const xmlContent = createForwardedMessageXml({
          originalMessageId,
          originalSenderId: originalMessage.senderId,
          originalSenderName: originalSender?.name || 'Unknown User',
          originalCreatedAt: originalMessage.createdAt,
          originalChannelId: originalConversation?.channelId || null,
          originalConversationId: originalMessage.conversationId,
          optionalText: optionalMessage || null,
          content: forwardedContent,
        });

        // Create conversation for the forwarded message
        await tx.mutate.conversations.insert({
          conversationId,
          channelId: targetChannelId,
          createdBy: ctx.userID,
          initialMessageId: messageId,
          lastActivityAt: now,
          replyCount: 0,
          pinned: false,
          metadata: {},
          createdAt: now,
          initial_message_md: buildInitialMessageMd({
            messageId,
            conversationId,
            senderId: ctx.userID,
            content: xmlContent,
            msgType: MessageType.FORWARDED,
            hasAttachment: forwardedHasAttachment,
            createdAt: now,
          }),
        });

        // Update user's last viewed time
        const userStatus = await tx.run(
          zql.channel_user_status
            .where('channelId', targetChannelId)
            .where('userId', ctx.userID)
            .where('isDeleted', false)
            .one(),
        );
        if (userStatus) {
          const conversationSeenCutoffAt = await getConversationSeenCutoffAt(
            tx,
            targetChannelId,
            now,
          );
          await tx.mutate.channel_user_status.update({
            id: userStatus.id,
            lastViewedAt: now,
            conversationSeenCutoffAt,
            lastViewedConversationId: conversationId,
            updatedAt: now,
          });
        }

        // --- Call Message Forwarding Specifics ---

        let replyCount = 0;
        const originalMetadata = originalMessage.metadata as Record<string, unknown> | undefined;
        const isCallMessage = originalMetadata?.['isCallMessage'] === true;

        // Define metadata for the new forwarded message
        const forwardedMessageMetadata = {} as Record<string, unknown>;
        if (isCallMessage) {
          forwardedMessageMetadata['isCallMessage'] = true;
          if (originalMetadata?.['callId']) {
            forwardedMessageMetadata['callId'] = originalMetadata['callId'];
          }
        }

        // If it is a call message, we want to clone all non-user bot messages (like transcipts/summaries)
        if (isCallMessage) {
          // Get all bot thread messages from the original conversation
          const botMessages = await tx.run(
            zql.messages
              .where('conversationId', originalMessage.conversationId)
              .where('msgType', MessageType.BOT),
          );

          replyCount = botMessages.length;

          // Insert the cloned bot messages into the new conversation
          for (let i = 0; i < botMessages.length; i++) {
            const botMsg = botMessages[i]!;
            const clonedMessageId = `${conversationId}-botmsg-${i}`;

            await tx.mutate.messages.insert({
              messageId: clonedMessageId,
              conversationId,
              senderId: botMsg.senderId,
              content: botMsg.content,
              msgType: botMsg.msgType,
              hasAttachment: botMsg.hasAttachment,
              edited: botMsg.edited,
              isDeleted: botMsg.isDeleted,
              isSent: botMsg.isSent,
              showInChannel: botMsg.showInChannel,
              childConversationId: botMsg.childConversationId,
              createdAt: botMsg.createdAt,
              metadata: botMsg.metadata,
              visibleTo: botMsg.visibleTo,
            });

            // If the bot message had attachments, we need to clone the attachment references
            if (botMsg.hasAttachment) {
              const originalAttachments = await tx.run(
                zql.message_attachments
                  .where('entityId', botMsg.messageId)
                  .where('entityType', AttachmentEntityType.CHAT),
              );

              for (let j = 0; j < originalAttachments.length; j++) {
                const attInfo = originalAttachments[j]! as unknown as {
                  fileUrl?: string;
                  url?: string;
                  originalFilename?: string;
                  size?: number;
                  thumbnailUrl?: string;
                  mimetype?: string;
                  createdAt?: number;
                  storageProvider?: string;
                };
                // Generate a deterministic ID for the attachment mapping
                const clonedAttId = `${clonedMessageId}-att-${j}`;
                await tx.mutate.message_attachments.insert({
                  id: clonedAttId,
                  entityId: clonedMessageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId: conversationId,
                  url: attInfo.fileUrl || attInfo.url || '',
                  originalFilename: attInfo.originalFilename || '',
                  size: attInfo.size || 0,
                  thumbnailUrl: attInfo.thumbnailUrl,
                  mimetype: attInfo.mimetype || '',
                  createdAt: attInfo.createdAt || now,
                  storageProvider: attInfo.storageProvider || 's3',
                  uploadedByUserId: ctx.userID,
                  createdBy: ctx.userID,
                  isDeleted: false,
                  workspaceId: ctx.workspaceId,
                });
              }
            }
          }
        }

        // Create the forwarded message with XML content
        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: ctx.userID,
          content: xmlContent,
          msgType: MessageType.FORWARDED,
          hasAttachment: forwardedHasAttachment,
          edited: false,
          isDeleted: false,
          isSent: false,
          showInChannel: false,
          createdAt: now,
          metadata: forwardedMessageMetadata as ReadonlyJSONValue,
        });

        // Update reply count if bots were added
        if (replyCount > 0) {
          await tx.mutate.conversations.update({
            conversationId,
            replyCount,
          });
        }

        // Add creator as conversation participant
        await tx.mutate.conversation_participants.insert({
          id: conversationParticipantId,
          conversationId,
          userId: ctx.userID,
          isSubscribed: true,
          participationType: ConversationParticipation.AUTHOR,
          joinedAt: now,
          channelId: targetChannelId,
        });
      },
    ),
    subscribeToConversation: defineMutator(
      z.object({
        conversationId: z.string(),
        timestamp: z.number(),
        participantId: z.string(),
      }),
      async ({ tx, ctx, args: { conversationId, timestamp, participantId } }) => {
        // Check if conversation exists
        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        // Check if user is already a participant
        const existingParticipant = await tx.run(
          zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (existingParticipant) {
          // User already exists, just update isSubscribed to true
          if (!existingParticipant.isSubscribed) {
            await tx.mutate.conversation_participants.update({
              id: existingParticipant.id,
              isSubscribed: true,
            });
          }
          return;
        }

        // Create new manual subscription entry with null participationType
        await tx.mutate.conversation_participants.insert({
          id: participantId,
          conversationId,
          userId: ctx.userID,
          isSubscribed: true,
          joinedAt: timestamp,
          channelId: conversation.channelId,
        });
      },
    ),
    unsubscribeFromConversation: defineMutator(
      z.object({
        conversationId: z.string(),
      }),
      async ({ tx, ctx, args: { conversationId } }) => {
        // Find user's subscription
        const subscription = await tx.run(
          zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (!subscription) {
          // User is not a participant
          return;
        }

        if (!subscription.isSubscribed) {
          // Already unsubscribed
          return;
        }

        // Set isSubscribed to false (keeps participation record)
        await tx.mutate.conversation_participants.update({
          id: subscription.id,
          isSubscribed: false,
        });
      },
    ),
  },
  messages: {
    send: defineMutator(
      z.object({
        conversationId: z.string(),
        content: z.string(),
        type: z.nativeEnum(MessageType),
        showInChannel: z.boolean().optional(),
        timestamp: z.number(),
        messageId: z.string(),
        childConversationId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          conversationId,
          content,
          type,
          showInChannel,
          timestamp,
          messageId,
          childConversationId,
        },
      }) => {
        if (content === '') {
          throw new Error('Message content or files are required to start a conversation');
        }

        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        const channel = await tx.run(zql.channels.where('id', conversation.channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exists");
        }

        // Query for drafts in this channel for this user (follows backend logic)
        const channelDrafts = await tx.run(
          zql.draft_messages.where('channelId', conversation.channelId).where('userId', ctx.userID),
        );

        // Find the draft for this specific conversation
        const draft = channelDrafts.find(d => d.conversationId === conversationId);

        // Transfer attachments from draft to message if found
        let hasAttachments = false;
        if (draft) {
          const draftAttachments = await tx.run(
            zql.message_attachments
              .where('entityId', draft.id)
              .where('entityType', AttachmentEntityType.DRAFT),
          );

          if (draftAttachments.length > 0) {
            hasAttachments = true;
            // Transfer attachments from draft to message
            for (const attachment of draftAttachments) {
              await tx.mutate.message_attachments.update({
                id: attachment.id,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId: conversationId,
              });
            }
          }

          // Delete the draft message after transferring
          await tx.mutate.draft_messages.delete({
            id: draft.id,
          });
        }

        const message = {
          messageId,
          conversationId,
          senderId: ctx.userID,
          content: content.trim(),
          msgType: type,
          hasAttachment: hasAttachments,
          edited: false,
          isSent: false,
          isDeleted: false,
          showInChannel: showInChannel || false,
          childConversationId: showInChannel ? childConversationId || null : null,
          createdAt: timestamp,
          metadata: undefined,
        };

        await tx.mutate.messages.insert(message);

        if (type === MessageType.USER || type === MessageType.FORWARDED) {
          const allMessages = await tx.run(
            zql.messages.where('conversationId', conversation.conversationId),
          );
          const updatedRepliesMd = buildRepliesMdFromMessages(
            allMessages,
            conversation.initialMessageId,
          );

          if (updatedRepliesMd !== conversation.replies_md) {
            await tx.mutate.conversations.update({
              conversationId: conversation.conversationId,
              replies_md: updatedRepliesMd,
            });
          }
        }

        // If showInChannel is true, create a new conversation for this message in the channel
        if (showInChannel) {
          if (!childConversationId) {
            throw new Error('Child conversation ID is required when showInChannel is true');
          }

          const parentMsg = await resolveMessage(tx, conversation.initialMessageId);

          await tx.mutate.conversations.insert({
            conversationId: childConversationId,
            channelId: conversation.channelId,
            createdBy: ctx.userID,
            initialMessageId: messageId,
            parentMessageId: conversation.initialMessageId,
            lastActivityAt: timestamp,
            replyCount: 0,
            pinned: false,
            createdAt: timestamp,
            initial_message_md: buildInitialMessageMd({
              messageId,
              conversationId,
              senderId: ctx.userID,
              content: content.trim(),
              msgType: type,
              hasAttachment: hasAttachments,
              showInChannel: true,
              createdAt: timestamp,
              childConversationId,
            }),
            parent_message_md: parentMsg ? buildParentMessageMd(parentMsg) : null,
          });
        }

        // Find the most recent message before this one
        // and set its child conversation replyCount to 1 if it has showInChannel=true
        const mostRecentPrevMsg = await tx.run(
          zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '<', message.createdAt)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .one(),
        );

        if (mostRecentPrevMsg?.showInChannel && mostRecentPrevMsg.childConversationId) {
          await tx.mutate.conversations.update({
            conversationId: mostRecentPrevMsg.childConversationId,
            replyCount: 1,
          });
        }
      },
    ),
    update: defineMutator(
      z.object({ messageId: z.string(), content: z.string().optional() }),
      async ({ tx, ctx, args: { messageId, content } }) => {
        const message = await resolveMessage(tx, messageId);

        if (!message) {
          throw new Error('Message not available');
        }

        // For forwarded messages, empty content is allowed (clearing optional message)
        // For regular messages, content cannot be empty
        const isForwardedMessage = message.msgType === MessageType.FORWARDED;
        if (content !== undefined && content === '' && !isForwardedMessage) {
          throw new Error('Message content cannot be empty');
        }

        // Allow system messages to be updated by any channel participant
        if (message.msgType !== MessageType.SYSTEM && message.senderId !== ctx.userID) {
          throw new Error('Only the sender can edit the messages');
        }

        if (content !== undefined) {
          if (isForwardedMessage) {
            // For forwarded messages, parse XML, update optionalText, and re-serialize
            const parsedForwarded = parseForwardedMessageXml(message.content);
            if (parsedForwarded) {
              const updatedXmlContent = createForwardedMessageXml({
                ...parsedForwarded,
                optionalText: content || null,
              });
              await tx.mutate.messages.update({
                messageId,
                content: updatedXmlContent,
                edited: true,
              });
              await updateInitialMessageMdField(
                tx,
                { messageId },
                { content: updatedXmlContent, edited: true },
              );
            }
          } else {
            // For regular messages, update the content directly
            await tx.mutate.messages.update({
              messageId,
              content,
              edited: true,
            });
            await updateInitialMessageMdField(tx, { messageId }, { content, edited: true });
          }
        }
      },
    ),
    updateShowInChannel: defineMutator(
      z.object({
        messageId: z.string(),
        showInChannel: z.boolean(),
        childConversationId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { messageId, showInChannel, childConversationId, timestamp } }) => {
        if (!showInChannel) {
          throw new Error('This action only supports sending messages to the channel.');
        }
        const message = await resolveMessage(tx, messageId);

        if (!message) {
          throw new Error('Unauthorized');
        }

        if (message.senderId !== ctx.userID) {
          throw new Error('Unauthorized');
        }
        if (message.showInChannel) {
          return;
        }

        await tx.mutate.messages.update({
          messageId,
          showInChannel: true,
        });

        // Get the conversation to get channelId
        const conversation = await tx.run(
          zql.conversations.where('conversationId', message.conversationId).one(),
        );

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        const messagesAfterThis = await tx.run(
          zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '>', message.createdAt),
        );

        const hasNewerReplies = messagesAfterThis.length > 0;

        const parentMsgRow = await resolveMessage(tx, conversation.initialMessageId);

        // Create a new conversation for this message in the channel (like send does)
        await tx.mutate.conversations.insert({
          conversationId: childConversationId,
          channelId: conversation.channelId,
          createdBy: ctx.userID,
          initialMessageId: messageId,
          parentMessageId: conversation.initialMessageId,
          lastActivityAt: timestamp,
          replyCount: hasNewerReplies ? 1 : 0,
          pinned: false,
          createdAt: timestamp,
          initial_message_md: buildInitialMessageMd({
            messageId,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            msgType: message.msgType,
            hasAttachment: message.hasAttachment,
            showInChannel: true,
            createdAt: message.createdAt,
            childConversationId,
          }),
          parent_message_md: parentMsgRow ? buildParentMessageMd(parentMsgRow) : null,
        });

        // Update the message with the child conversation ID
        await tx.mutate.messages.update({
          messageId,
          childConversationId: childConversationId,
        });
        await updateInitialMessageMdField(tx, { messageId }, { childConversationId });
      },
    ),
    react: defineMutator(
      z.object({
        messageId: z.string(),
        emojiName: z.string(),
        action: z.enum(['add', 'remove']),
        timestamp: z.number(),
        reactionId: z.string().optional(),
        countId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: { messageId, emojiName, action, timestamp, reactionId, countId },
      }) => {
        const decodedEmoji = decodeURIComponent(emojiName);
        if (!decodedEmoji.trim() || decodedEmoji.length > 100) {
          throw new Error('Invalid Emoji');
        }
        const reaction = await tx.run(
          zql.reaction_counts.where('messageId', messageId).where('emojiName', decodedEmoji).one(),
        );

        if (action === 'add') {
          const reactionIdToUse = reactionId;
          if (!reactionIdToUse) {
            throw new Error('reactionId is required when adding a reaction');
          }
          const countIdToUse = countId;
          if (!countIdToUse) {
            throw new Error('countId is required when creating a new reaction count');
          }
          await tx.mutate.reactions.insert({
            reactionId: reactionIdToUse,
            messageId,
            userId: ctx.userID,
            emojiName: decodedEmoji,
            createdAt: timestamp,
          });

          if (reaction) {
            await tx.mutate.reaction_counts.update({
              countId: reaction.countId,
              count: reaction.count + 1,
            });
          } else {
            await tx.mutate.reaction_counts.insert({
              countId: countIdToUse,
              count: 1,
              messageId,
              emojiName: decodedEmoji,
              updatedAt: timestamp,
            });
          }

          await updateReactionsMd(tx, messageId, decodedEmoji, ctx.userID, 'add');
          // Sync initial_message_md — compute new reactions_md from the conversation's existing md
          await updateInitialMessageMdReaction(tx, messageId, decodedEmoji, ctx.userID, 'add');
        } else if (action === 'remove') {
          const reactionRow = await tx.run(
            zql.reactions
              .where('emojiName', decodedEmoji)
              .where('messageId', messageId)
              .where('userId', ctx.userID)
              .one(),
          );

          if (!reactionRow) {
            await updateReactionsMd(tx, messageId, decodedEmoji, ctx.userID, 'remove');
            await updateInitialMessageMdReaction(tx, messageId, decodedEmoji, ctx.userID, 'remove');
            return;
          }

          await tx.mutate.reactions.delete({ reactionId: reactionRow.reactionId });
          if (reaction) {
            if (reaction.count > 1) {
              await tx.mutate.reaction_counts.update({
                countId: reaction.countId,
                count: reaction.count - 1,
                updatedAt: timestamp,
              });
            } else {
              await tx.mutate.reaction_counts.delete({ countId: reaction.countId });
            }
          }

          await updateReactionsMd(tx, messageId, decodedEmoji, ctx.userID, 'remove');
          await updateInitialMessageMdReaction(tx, messageId, decodedEmoji, ctx.userID, 'remove');
        }
      },
    ),
    handleNonParticipantAction: defineMutator(
      z.object({
        messageId: z.string(),
        action: z.enum(['add', 'add_all', 'ignore', 'ignore_all']),
        userIds: z.array(z.string()),
        channelId: z.string(),
      }),
      async ({ tx, args: { messageId } }) => {
        // First delete the message
        await tx.mutate.messages.delete({ messageId });

        // This mutator is also handled on the backend for adding participants
        // Frontend handles the deletion, backend handles participant addition
      },
    ),
    delete: defineMutator(
      z.object({ messageId: z.string() }),
      async ({ tx, args: { messageId } }) => {
        const message = await resolveMessage(tx, messageId);

        if (!message) {
          throw new Error('Message not found');
        }

        const conversation = await tx.run(
          zql.conversations.where('conversationId', message.conversationId).one(),
        );

        if (!conversation) {
          throw new Error('conversation not found');
        }

        const attachments = await tx.run(zql.message_attachments.where('entityId', messageId));
        const reactions = await tx.run(zql.reactions.where('messageId', messageId));
        const reactionCounts = await tx.run(zql.reaction_counts.where('messageId', messageId));

        await Promise.all(
          attachments.map(async attachment => {
            await tx.mutate.message_attachments.delete({
              id: attachment.id,
            });
          }),
        );

        await Promise.all(
          reactions.map(async reaction => {
            await tx.mutate.reactions.delete({
              reactionId: reaction.reactionId,
            });
          }),
        );

        await Promise.all(
          reactionCounts.map(async count => {
            await tx.mutate.reaction_counts.delete({
              countId: count.countId,
            });
          }),
        );

        // Get all OTHER messages in the conversation (excluding the one being deleted)
        const allMessages = await tx.run(
          zql.messages.where('conversationId', message.conversationId),
        );

        const otherMessages = allMessages.filter(m => m.messageId !== messageId);

        if (isChatMessageType(message.msgType)) {
          const updatedRepliesMd = buildRepliesMdFromMessages(
            otherMessages,
            conversation.initialMessageId,
          );

          if (updatedRepliesMd !== conversation.replies_md) {
            await tx.mutate.conversations.update({
              conversationId: conversation.conversationId,
              replies_md: updatedRepliesMd,
            });
          }
        }

        const isInitialMessage = conversation.initialMessageId === messageId;
        const hasReplies = otherMessages.length > 0;
        const shouldSoftDelete = isInitialMessage && hasReplies;

        // Clean up MENTIONED participants within Zero transaction
        const mentions = extractAllMentions(message.content);

        if (mentions.userIds.length > 0) {
          // For each mentioned user, check if they're still mentioned elsewhere
          for (const userId of mentions.userIds) {
            // Check if user is still mentioned in any other message
            const stillMentioned = otherMessages.some(msg => {
              const msgMentions = extractAllMentions(msg.content);
              return msgMentions.userIds.includes(userId);
            });

            // If not mentioned elsewhere, check if they're a MENTIONED participant and remove them
            if (!stillMentioned && userId !== conversation.createdBy) {
              const participant = await tx.run(
                zql.conversation_participants
                  .where('conversationId', message.conversationId)
                  .where('userId', userId)
                  .one(),
              );

              // Only delete if they're MENTIONED type (keep AUTHOR participants for now)
              if (
                participant &&
                participant.participationType === ConversationParticipation.MENTIONED
              ) {
                await tx.mutate.conversation_participants.delete({
                  id: participant.id,
                });
              }
            }
          }
        }

        // Clean up AUTHOR participant if this was their only message
        const senderId = message.senderId;

        // Check if sender has any other messages in this conversation
        const otherMessagesFromSender = otherMessages.filter(msg => msg.senderId === senderId);

        // If this was their only message, remove their AUTHOR participant
        if (otherMessagesFromSender.length === 0) {
          const senderParticipant = await tx.run(
            zql.conversation_participants
              .where('conversationId', message.conversationId)
              .where('userId', senderId)
              .one(),
          );

          // Remove AUTHOR participant (they have no more messages)
          if (
            senderParticipant &&
            senderParticipant.participationType === ConversationParticipation.AUTHOR
          ) {
            await tx.mutate.conversation_participants.delete({
              id: senderParticipant.id,
            });
          }
        }

        // Handle showInChannel viewNewerReplies updates when deleting a message
        // Check if there are any messages after this one with showInChannel=true
        const messagesAfterThis = await tx.run(
          zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '>', message.createdAt)
            .limit(1)
            .one(),
        );

        // If no messages below, check for a message above
        if (!messagesAfterThis) {
          const messageAbove = await tx.run(
            zql.messages
              .where('conversationId', message.conversationId)
              .where('createdAt', '<', message.createdAt)
              .orderBy('createdAt', 'desc')
              .limit(1)
              .one(),
          );

          // If there's a message above with showInChannel, set its replyCount to 0
          if (messageAbove?.childConversationId && messageAbove.showInChannel) {
            await tx.mutate.conversations.update({
              conversationId: messageAbove.childConversationId,
              replyCount: 0,
            });
          }
        }

        // 5. Final Delete Logic
        if (shouldSoftDelete) {
          // SCENARIO 1: Root Message + Has Replies -> Soft Delete
          // Keep conversation, wipe message content
          await tx.mutate.messages.update({
            messageId,
            isDeleted: true,
            content: '',
            hasAttachment: false,
            edited: false,
            link_preview_md: '',
          });
          await updateInitialMessageMdField(
            tx,
            { messageId },
            { isDeleted: true, content: '', hasAttachment: false, edited: false, link_preview_md: '' },
          );
        } else {
          // SCENARIO 2: Hard Delete (Reply OR Root with no replies)
          await tx.mutate.messages.delete({ messageId });

          const isInitialMessageDeleted =
            otherMessages.length === 1 &&
            otherMessages[0] &&
            otherMessages[0].messageId === conversation.initialMessageId &&
            otherMessages[0].isDeleted === true;

          const shouldDeleteConversation = otherMessages.length === 0 || isInitialMessageDeleted;

          if (shouldDeleteConversation) {
            // Delete the conversation
            await tx.mutate.conversations.delete({ conversationId: conversation.conversationId });

            // Clean up the ghost root message if it exists so we don't leave orphaned data
            if (isInitialMessageDeleted && otherMessages[0]) {
              await tx.mutate.messages.delete({ messageId: otherMessages[0].messageId });
            }
          } else {
            // Just a normal reply deletion, update the count
            await tx.mutate.conversations.update({
              conversationId: conversation.conversationId,
              replyCount: Math.max(0, conversation.replyCount - 1),
            });
          }
        }
      },
    ),
  },
  messageAttachment: {
    delete: defineMutator(
      z.object({ attachmentId: z.string() }),
      async ({ tx, ctx, args: { attachmentId } }) => {
        const attachment = await tx.run(zql.message_attachments.where('id', attachmentId).one());

        if (!attachment) {
          throw new Error('Attachment not found');
        }

        if (
          attachment.entityType !== AttachmentEntityType.DRAFT &&
          attachment.entityType !== AttachmentEntityType.CHAT
        ) {
          await tx.mutate.message_attachments.delete({ id: attachment.id });
          return;
        }

        if (attachment.entityType === AttachmentEntityType.CHAT) {
          const message = await resolveMessage(tx, attachment.entityId);

          if (!message) {
            throw new Error("Attachment doesn't belong to a message");
          }

          if (message.senderId !== ctx.userID) {
            throw new Error('Only sender of attachment can delete it');
          }

          // Soft-delete: mark the attachment as deleted instead of removing it
          await tx.mutate.message_attachments.update({
            id: attachmentId,
            isDeleted: true,
          });

          // Check if there are any remaining non-deleted attachments for this message
          const remainingAttachments = await tx.run(
            zql.message_attachments
              .where('entityId', message.messageId)
              .where('isDeleted', false),
          );

          // Only inspect content if no non-deleted attachments remain
          if (remainingAttachments.length === 0) {
            // Check if the message content is empty (including HTML-only content like <p><br></p>)
            const doc = new DOMParser().parseFromString(message.content, 'text/html');
            const plainText = doc.body.textContent?.trim();

            if (plainText === '') {
              // All attachments are soft-deleted and message body is empty.
              // Keep the message so tombstones ("This file was deleted.") remain visible.
              // Do NOT delete the message.
            }
            // Note: we intentionally do NOT set hasAttachment: false — the soft-deleted
            // attachments still need to appear as tombstones in the UI.
          }
        } else {
          await tx.mutate.message_attachments.delete({ id: attachment.id });

          const remainingAttachments = await tx.run(
            zql.message_attachments.where('entityId', attachment.entityId),
          );

          if (remainingAttachments.length === 0) {
            await tx.mutate.draft_messages.update({
              id: attachment.entityId,
              hasAttachment: false,
            });
          }
        }
      },
    ),
    deleteMany: defineMutator(
      z.object({ attachmentIds: z.array(z.string()) }),
      async ({ tx, args: { attachmentIds } }) => {
        for (const attachmentId of attachmentIds) {
          const attachment = await tx.run(zql.message_attachments.where('id', attachmentId).one());
          if (!attachment) continue;

          await tx.mutate.message_attachments.delete({ id: attachment.id });

          const remainingAttachments = await tx.run(
            zql.message_attachments.where('entityId', attachment.entityId),
          );

          if (remainingAttachments.length === 0) {
            if (attachment.entityType !== AttachmentEntityType.DRAFT) {
              await tx.mutate.messages.update({
                messageId: attachment.entityId,
                hasAttachment: false,
              });
              await updateInitialMessageMdField(
                tx,
                { messageId: attachment.entityId },
                { hasAttachment: false },
              );
            } else {
              await tx.mutate.draft_messages.update({
                id: attachment.entityId,
                hasAttachment: false,
              });
            }
          }
        }
      },
    ),
  },
  draft: {
    createAttachments: defineMutator(
      z.object({
        draftMessageId: z.string(),
        attachments: z.array(
          z.object({
            attachmentId: z.string(),
            originalFilename: z.string(),
            mimetype: z.string(),
            size: z.number(),
            width: z.number().optional(),
            height: z.number().optional(),
            duration: z.number().optional(),
          }),
        ),
        channelId: z.string(),
        conversationId: z.string().optional(),
        content: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { draftMessageId, attachments, channelId, conversationId, content, timestamp },
      }) => {
        // 1. Check if draft exists for this channel/conversation/user
        let existingDraft = null;
        if (conversationId) {
          existingDraft = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', ctx.userID)
              .where('conversationId', conversationId)
              .one(),
          );
        } else {
          const channelDrafts = await tx.run(
            zql.draft_messages.where('channelId', channelId).where('userId', ctx.userID),
          );
          existingDraft = channelDrafts.find(d => d.conversationId === null);
        }

        const finalDraftMessageId = existingDraft?.id || draftMessageId;

        // 2. If no draft exists, create one with the provided ID
        if (!existingDraft) {
          await tx.mutate.draft_messages.insert({
            id: draftMessageId,
            channelId,
            conversationId: conversationId || null,
            userId: ctx.userID,
            content: content || '',
            hasAttachment: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        } else {
          // Update draft's hasAttachment flag
          if (!existingDraft.hasAttachment) {
            await tx.mutate.draft_messages.update({
              id: finalDraftMessageId,
              content: content || existingDraft.content,
              hasAttachment: true,
            });
          }
        }

        // 3. Create or update all attachments
        for (const attachment of attachments) {
          const { attachmentId, originalFilename, mimetype, size, width, height, duration } =
            attachment;

          const rawName = originalFilename || 'unnamed_file';
          const lastDotIdx = rawName.lastIndexOf('.');

          let ext = '';
          let nameWithoutExt = rawName;

          if (lastDotIdx === 0) {
            ext = rawName;
            nameWithoutExt = '';
          } else if (lastDotIdx > 0) {
            ext = rawName.substring(lastDotIdx);
            nameWithoutExt = rawName.substring(0, lastDotIdx);
          }

          const maxBaseLength = Math.max(1, 255 - ext.length);

          let sanitizedBase = nameWithoutExt
            .replace(/[^a-zA-Z0-9 ._-]/g, '_')
            .replace(/\.\./g, '_')
            .replace(/^\.+/, '')
            .replace(/[\s.]+$/, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, maxBaseLength)
            .trim();

          if (!sanitizedBase) {
            sanitizedBase = `file_${Date.now()}`;
          }

          const sanitizedFilename = sanitizedBase + ext;

          const attachmentMetadata = duration ? { duration } : null;

          const existingAttachment = await tx.run(
            zql.message_attachments.where('id', attachmentId).one(),
          );

          if (existingAttachment) {
            await tx.mutate.message_attachments.update({
              id: attachmentId,
              entityId: finalDraftMessageId,
              entityType: AttachmentEntityType.DRAFT,
              conversationId: conversationId || null,
              originalFilename: sanitizedFilename,
              mimetype,
              size,
              width,
              height,
              ...(attachmentMetadata && { metadata: attachmentMetadata }),
            });
          } else {
            await tx.mutate.message_attachments.insert({
              id: attachmentId,
              entityType: AttachmentEntityType.DRAFT,
              entityId: finalDraftMessageId,
              storageProvider: '',
              originalFilename: sanitizedFilename,
              mimetype,
              size,
              width,
              height,
              uploadedByUserId: ctx.userID,
              createdAt: existingDraft?.createdAt || timestamp,
              createdBy: ctx.userID,
              url: '', // Will be populated after upload completes
              workspaceId: ctx.workspaceId,
              metadata: attachmentMetadata,
              conversationId: conversationId || null,
              isDeleted: false,
            });
          }
        }
      },
    ),
  },
  calls: {
    reject: defineMutator(
      z.object({ callId: z.string(), timestamp: z.number() }),
      async ({ tx, ctx, args: { callId, timestamp } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());

        if (!call) {
          throw new Error('Call not found');
        }

        const participant = await tx.run(
          zql.call_participants.where('callId', call.id).where('userId', ctx.userID).one(),
        );

        if (participant) {
          await tx.mutate.call_participants.update({
            id: participant.id,
            response: InvitationResponse.DECLINED,
            respondedAt: timestamp,
          });
        }
      },
    ),
    invite: defineMutator(
      z.object({
        callId: z.string(),
        userIds: z.array(z.string()),
        timestamp: z.number(),
        participantIds: z.record(z.string(), z.string()),
      }),
      async ({ tx, ctx, args: { callId, userIds, timestamp, participantIds = {} } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        if (!call || call.status !== CallStatus.ACTIVE) {
          throw new Error('Call not found');
        }

        const now = timestamp;

        // Invite each user
        for (const userId of userIds) {
          // Check if user already has a participant record
          const existingParticipant = await tx.run(
            zql.call_participants.where('callId', call.id).where('userId', userId).one(),
          );

          if (existingParticipant) {
            // Re-invite: reset to INVITED status (works for declined or left users)
            if (
              existingParticipant.response !== InvitationResponse.ACCEPTED ||
              existingParticipant.leftAt !== null
            ) {
              await tx.mutate.call_participants.update({
                id: existingParticipant.id,
                response: InvitationResponse.INVITED,
                meetingStatus: existingParticipant.meetingStatus,
                invitedBy: ctx.userID,
                invitedAt: now,
                respondedAt: null,
                joinedAt: null,
                leftAt: null,
              });
            }
          } else {
            // Create new participant invitation
            const newParticipantId = participantIds[userId];
            if (!newParticipantId) {
              throw new Error(`participantId is required for user ${userId}`);
            }
            await tx.mutate.call_participants.insert({
              id: newParticipantId,
              callId: call.id,
              userId: userId,
              invitedBy: ctx.userID,
              invitedAt: now,
              response: InvitationResponse.INVITED,
              meetingStatus: MeetingStatus.PENDING,
              respondedAt: null,
              joinedAt: null,
              leftAt: null,
              isExternal: false
            });
          }
        }
      },
    ),
    cancel: defineMutator(
      z.object({
        callId: z.string(),
        timestamp: z.number(),
        cancelEntireSeries: z.boolean().optional(),
      }),
      async ({ tx, args: { callId, timestamp, cancelEntireSeries } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        if (!call || call.status !== CallStatus.SCHEDULED) {
          throw new Error('Call not found or not scheduled');
        }
        await tx.mutate.calls.update({
          id: call.id,
          status: CallStatus.CANCELLED,
          updatedAt: timestamp,
        });
        if (cancelEntireSeries && call.recurringSeriesId) {
          await tx.mutate.recurring_call_series.update({
            id: call.recurringSeriesId,
            status: RecurringCallSeriesStatus.CANCELLED,
            updatedAt: timestamp,
          });
        }
      },
    ),
    approveLobbyRequest: defineMutator(
      z.object({ callId: z.string(), participantId: z.string() }),
      async ({ tx, ctx, args: { callId, participantId } }) => {
        const call = await tx.run(zql.calls.where('id', callId).one());
        if (!call) throw new Error('Call not found');
        if (call.createdByUserId !== ctx.userID) {
          throw new Error('Only the call creator can admit participants');
        }
        await tx.mutate.call_participants.update({
          id: participantId,
          response: InvitationResponse.ACCEPTED,
          respondedAt: Date.now(),
        });
      },
    ),
    rejectLobbyRequest: defineMutator(
      z.object({ callId: z.string(), participantId: z.string() }),
      async ({ tx, ctx, args: { callId, participantId } }) => {
        const call = await tx.run(zql.calls.where('id', callId).one());
        if (!call) throw new Error('Call not found');
        if (call.createdByUserId !== ctx.userID) {
          throw new Error('Only the call creator can decline participants');
        }
        await tx.mutate.call_participants.update({
          id: participantId,
          response: InvitationResponse.DECLINED,
          respondedAt: Date.now(),
        });
      },
    ),
  },
  activities: {
    markAsRead: defineMutator(
      z.object({ activityId: z.string() }),
      async ({ tx, ctx, args: { activityId } }) => {
        const activity = await tx.run(zql.activities.where('id', activityId).one());

        if (!activity) {
          throw new Error('Activity not found');
        }

        if (activity.userId !== ctx.userID) {
          throw new Error('You can only mark your own activities as read');
        }

        await tx.mutate.activities.update({
          id: activityId,
          isRead: true,
        });
      },
    ),
    markAsReadByFilter: defineMutator(
      z.object({
        actorAction: z.string().optional(),
        classification: z.nativeEnum(ActivityClassification).optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { actorAction, classification, timestamp } }) => {
        let query = zql.activities.where('userId', ctx.userID).where('isRead', false);

        if (actorAction) {
          query = query.where('actorAction', actorAction);
        }
        if (classification) {
          query = query.where('classification', classification);
        }

        const unreadActivities = await tx.run(query);

        if (unreadActivities.length > 0) {
          await Promise.all(
            unreadActivities.map(activity =>
              tx.mutate.activities.update({
                id: activity.id,
                isRead: true,
              }),
            ),
          );
          const channelIdCounts = new Map<string, number>();
          unreadActivities.forEach(activity => {
            if (activity.channelId) {
              const currentCount = channelIdCounts.get(activity.channelId) || 0;
              channelIdCounts.set(activity.channelId, currentCount + 1);
            }
          });

          const uniqueChannelIds = Array.from(channelIdCounts.keys());
          const channelUserStatuses = await tx.run(
            zql.channel_user_status
              .where('userId', ctx.userID)
              .where('isDeleted', false)
              .where('channelId', 'IN', uniqueChannelIds),
          );
          await Promise.all(
            channelUserStatuses.map(channelStatus => {
              const readCount = channelIdCounts.get(channelStatus.channelId) || 0;
              const newUnreadCount = Math.max(0, channelStatus.unreadCount - readCount);
              return tx.mutate.channel_user_status.update({
                id: channelStatus.id,
                unreadCount: newUnreadCount,
                updatedAt: timestamp,
              });
            }),
          );
        }
      },
    ),
    markActivitiesSeenByMessageId: defineMutator(
      z.object({ messageId: z.string() }),
      async ({ tx, ctx, args: { messageId } }) => {
        const messageActivities = await tx.run(
          zql.activities
            .where(helper =>
              helper.or(
                helper.cmp('actionSource', 'message'),
                helper.cmp('actionSource', 'missed_call'),
              ),
            )
            .where('actionSourceId', messageId)
            .where('userId', ctx.userID),
        );

        for (const activity of messageActivities) {
          if (!activity.isRead) {
            await tx.mutate.activities.update({
              id: activity.id,
              isRead: true,
            });
          }
        }

        // Reactions now use actionSource = 'message' with actionSourceId = messageId,
        // so they're already covered by the messageActivities query above.
      },
    ),
    markThreadActivitiesAsReadV2: defineMutator(
      z.object({
        conversationId: z.string(),
        draftMessageId: z.string(),
        draftMessage: z.string(),
        timestamp: z.number(),
        participantId: z.string(),
      }),
      async ({ tx, ctx, args: { conversationId, draftMessageId, draftMessage, timestamp, participantId } }) => {
        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        const channelId = conversation.channelId;

        // Query for drafts in this channel for this user (follows backend logic)
        const draft = await tx.run(
          zql.draft_messages
            .where('channelId', channelId)
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
          await tx.mutate.draft_messages.delete({ id: draft.id });
        } else if (draftMessage.trim() !== '') {
          await tx.mutate.draft_messages.upsert({
            id: draft?.id || draftMessageId,
            conversationId,
            channelId,
            userId: ctx.userID,
            content: draftMessage,
            hasAttachment: draft?.hasAttachment || false,
            updatedAt: timestamp,
            createdAt: draft?.createdAt || timestamp,
          });
        }

        // Update ConversationParticipant.lastReadAt to track when user last read this thread
        // Only do this if participantId is provided (backward compatible)
        if (participantId) {
          let participant = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', ctx.userID)
              .one(),
          );

          if (!participant) {
            await tx.mutate.conversation_participants.insert({
              id: participantId,
              conversationId,
              userId: ctx.userID,
              joinedAt: timestamp,
              channelId: channelId,
              lastReadAt: timestamp,
              isSubscribed: false,
              participationType: null,
            });
          } else {
            await tx.mutate.conversation_participants.update({
              id: participant.id,
              lastReadAt: timestamp,
            });
          }
        }

        const messagesInConversation = await tx.run(
          zql.messages.where('conversationId', conversationId),
        );

        if (messagesInConversation.length === 0) {
          return;
        }

        const messageIdsInConversation = messagesInConversation.map(m => m.messageId);

        const unreadActivities = await tx.run(
          zql.activities
            .where('userId', ctx.userID)
            .where('isRead', false)
            .where('actionSource', 'message')
            .where('messageId', 'IN', messageIdsInConversation),
        );

        if (unreadActivities.length === 0) {
          return;
        }

        const messageData = unreadActivities.map(a => ({
          activityId: a.id,
          sourceId: a.messageId || a.actionSourceId,
        }));

        const messages = await Promise.all(
          messageData.map(data => resolveMessage(tx, data.sourceId)),
        );

        for (const [index, message] of messages.entries()) {
          const data = messageData[index];
          if (!message || !data) {
            continue;
          }
          const conv = await tx.run(
            zql.conversations.where('conversationId', message.conversationId).one(),
          );
          if (conv?.initialMessageId !== message.messageId) {
            await tx.mutate.activities.update({
              id: data.activityId,
              isRead: true,
            });
          }
        }
      },
    ),
    markMissedCallsAsRead: defineMutator(z.object({}), async ({ tx, ctx }) => {
      const query = zql.activities
        .where('userId', ctx.userID)
        .where('actorAction', 'missed_call')
        .where('isRead', false);

      const unreadMissedCalls = await tx.run(query);
      if (unreadMissedCalls.length > 0) {
        await Promise.all(
          unreadMissedCalls.map(activity =>
            tx.mutate.activities.update({
              id: activity.id,
              isRead: true,
            }),
          ),
        );
      }
    }),
  },
  ticket: {
    update: defineMutator(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        statusV2: z.string().optional(),
        priority: z.string().optional(),
        stageName: z.string().optional(),
        assignedTo: z.string().nullable().optional(),
        userGroupId: z.string().nullable().optional(),
        eta: z.number().optional(),
        boardId: z.string().optional(),
        metadata: z.any().optional(),
        isArchived: z.boolean().optional(),
        kanbanPosition: z.string().nullable().optional(),
        updatedAt: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          title,
          description,
          statusV2,
          priority,
          stageName,
          assignedTo,
          userGroupId,
          eta,
          boardId,
          metadata,
          isArchived,
          kanbanPosition,
          updatedAt,
        },
      }) => {
        interface TicketUpdateData {
          updatedBy: string;
          updatedAt: number;
          title?: string;
          description?: string;
          statusV2?: TicketStatusV2;
          priority?: TicketPriority;
          stageName?: string;
          assignedTo?: string | null;
          userGroupId?: string;
          eta?: number;
          boardId?: string;
          metadata?: ReadonlyJSONValue;
          isArchived?: boolean;
          kanbanPosition?: string | null;
        }

        const updateData: TicketUpdateData = {
          updatedBy: ctx.userID,
          updatedAt: updatedAt,
        };

        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (statusV2 !== undefined) {
          updateData.statusV2 = statusV2 as TicketStatusV2;
        }
        if (priority !== undefined) updateData.priority = priority as TicketPriority;
        if (stageName !== undefined) updateData.stageName = stageName;
        if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
        if (userGroupId !== undefined && userGroupId !== null) {
          updateData.userGroupId = userGroupId;
        }
        if (eta !== undefined) updateData.eta = eta;
        if (boardId !== undefined) updateData.boardId = boardId;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        if (metadata !== undefined) updateData.metadata = metadata;
        if (isArchived !== undefined) updateData.isArchived = isArchived;
        if (kanbanPosition !== undefined) updateData.kanbanPosition = kanbanPosition;

        await tx.mutate.tickets.update({
          id,
          ...updateData,
        });

        await updateTicketMdFromZero(tx, zql, id);
      },
    ),
    updateAssignment: defineMutator(
      z.object({ ticketId: z.string(), assignedTo: z.string().nullable(), timestamp: z.number() }),
      async ({ tx, ctx, args: { ticketId, assignedTo, timestamp } }) => {
        await tx.mutate.tickets.update({
          id: ticketId,
          assignedTo,
          updatedBy: ctx.userID,
          updatedAt: timestamp,
        });

        await updateTicketMdFromZero(tx, zql, ticketId);
      },
    ),
  },
  ticketStageEta: {
    update: defineMutator(
      z.object({
        id: z.string(),
        stageEta: z.number(),
        updatedAt: z.number(),
        ticketId: z.string().optional(),
        stageId: z.string().optional(),
      }),
      async ({ tx, ctx, args: { id, stageEta, updatedAt, ticketId, stageId } }) => {
        await tx.mutate.ticket_stage_eta.update({
          id,
          stageEta,
          updatedAt,
          updatedBy: ctx.userID,
          ...(ticketId && { ticketId }),
          ...(stageId && { stageId }),
        });
      },
    ),
  },
  subTicket: {
    create: defineMutator(
      z.object({
        subTicketId: z.string(),
        mappingId: z.string(),
        timestamp: z.number(),
        title: z.string(),
        description: z.string().optional(),
        ticketId: z.string(),
        conversationId: z.string().optional(),
        subTicketXyneId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: { subTicketId, timestamp, mappingId, title, description, ticketId, conversationId },
      }) => {
        // Create the subticket
        await tx.mutate.sub_tickets.insert({
          id: subTicketId,
          title,
          description: description || null,
          mappedTicketId: null,
          createdBy: ctx.userID,
          updatedBy: ctx.userID,
          conversationId: conversationId || null,
          createdAt: timestamp,
          updatedAt: timestamp,
          stageProgression: null,
          assignedTo: null,
          workspaceId: ctx.workspaceId,
        });

        // Create the mapping
        await tx.mutate.ticket_sub_ticket_mappings.insert({
          id: mappingId,
          ticketId,
          subTicketId,
        });
      },
    ),
    update: defineMutator(
      z.object({
        subTicketId: z.string(),
        timestamp: z.number(),
        mappedTicketId: z.string().optional(),
        conversationId: z.string().optional(),
        assignedTo: z.string().optional().nullable(),
      }),
      async ({
        tx,
        ctx,
        args: { subTicketId, mappedTicketId, conversationId, timestamp, assignedTo },
      }) => {
        // Update the subticket
        await tx.mutate.sub_tickets.update({
          id: subTicketId,
          ...(mappedTicketId !== undefined && { mappedTicketId }),
          ...(conversationId !== undefined && { conversationId }),
          ...(assignedTo !== undefined && { assignedTo }),
          updatedBy: ctx.userID,
          updatedAt: timestamp,
        });
      },
    ),
  },
  project: {
    update: defineMutator(
      z.object({
        projectId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { projectId, name, description, timestamp } }) => {
        // Validate project exists
        const project = await tx.run(zql.projects.where('id', projectId).one());
        if (!project) {
          throw new Error('Project not found');
        }

        // Check for duplicate name if name is being changed
        if (name && name !== project.name) {
          const existingProject = await tx.run(zql.projects.where('name', name).one());
          if (existingProject && existingProject.id !== projectId) {
            throw new Error(`Project with name '${name}' already exists`);
          }
        }

        // Update project
        await tx.mutate.projects.update({
          id: projectId,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          updatedBy: ctx.userID,
          updatedAt: timestamp,
        });
      },
    ),
    delete: defineMutator(
      z.object({ projectId: z.string() }),
      async ({ tx, args: { projectId } }) => {
        // Validate project exists
        const project = await tx.run(zql.projects.where('id', projectId).one());
        if (!project) {
          throw new Error('Project not found');
        }

        // Delete project
        await tx.mutate.projects.delete({
          id: projectId,
        });
      },
    ),
  },
  userGroup: {
    update: defineMutator(
      z.object({
        userGroupId: z.string(),
        name: z.string().optional(),
        alias: z.string().optional(),
        description: z.string().optional(),
        userResponsibilityUpdates: z
          .record(z.string(), z.nativeEnum(UserResponsibility))
          .optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        args: { userGroupId, name, alias, description, userResponsibilityUpdates, timestamp },
      }) => {
        // Update user group - backend validates existence and uniqueness
        await tx.mutate.user_groups.update({
          id: userGroupId,
          ...(name !== undefined && { name }),
          ...(alias !== undefined && { alias }),
          ...(description !== undefined && { description }),
          updatedAt: timestamp,
        });

        // Update user responsibilities if provided
        if (userResponsibilityUpdates) {
          // Apply updates
          for (const [userId, responsibility] of Object.entries(userResponsibilityUpdates)) {
            const mapping = await tx.run(
              zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one(),
            );
            if (mapping) {
              await tx.mutate.user_group_mappings.update({
                id: mapping.id,
                responsibility,
                updatedAt: timestamp,
              });
            }
          }

          // Verify at least one MANAGER or TEAM_LEAD remains after updates
          const updatedMappings = await tx.run(
            zql.user_group_mappings.where('userGroupId', userGroupId),
          );
          const hasLeadership = updatedMappings.some(
            m =>
              m.responsibility === UserResponsibility.MANAGER ||
              m.responsibility === UserResponsibility.TEAM_LEAD,
          );

          if (!hasLeadership) {
            throw new Error('User group must have at least one MANAGER or TEAM_LEAD');
          }
        }
      },
    ),
    delete: defineMutator(
      z.object({ userGroupId: z.string() }),
      async ({ tx, args: { userGroupId } }) => {
        const terminalTickets = await tx.run(
          zql.tickets
            .where('userGroupId', userGroupId)
            .where(helpers =>
              helpers.or(
                helpers.cmp('statusV2', TicketStatusV2.CANCELLED),
                helpers.cmp('statusV2', TicketStatusV2.COMPLETED),
              ),
            ),
        );

        if (terminalTickets.length > 0) {
          throw new Error(
            'Cannot delete user group with tickets in terminal status (CANCELLED or COMPLETED)',
          );
        }

        // First, delete all mappings associated with the user group
        const mappings = await tx.run(zql.user_group_mappings.where('userGroupId', userGroupId));
        for (const mapping of mappings) {
          await tx.mutate.user_group_mappings.delete({ id: mapping.id });
        }

        // Then, delete the user group itself - backend validates existence
        await tx.mutate.user_groups.delete({
          id: userGroupId,
        });
      },
    ),
    deactivate: defineMutator(
      z.object({ userGroupId: z.string(), timestamp: z.number() }),
      async ({ tx, args: { userGroupId, timestamp } }) => {
        await tx.mutate.user_groups.update({
          id: userGroupId,
          isActive: false,
          updatedAt: timestamp,
        });
      },
    ),
    reactivate: defineMutator(
      z.object({ userGroupId: z.string(), timestamp: z.number() }),
      async ({ tx, args: { userGroupId, timestamp } }) => {
        await tx.mutate.user_groups.update({
          id: userGroupId,
          isActive: true,
          updatedAt: timestamp,
        });
      },
    ),
    addUsers: defineMutator(
      z.object({
        userGroupId: z.string(),
        userIds: z.array(z.string()),
        timestamp: z.number(),
        mappingIds: z.record(z.string(), z.string()), // Map userId -> mappingId
      }),
      async ({ tx, args: { userGroupId, userIds, timestamp, mappingIds = {} } }) => {
        // Bulk check for existing mappings to avoid duplicates
        const existingMappings = await Promise.all(
          userIds.map(userId =>
            tx.run(
              zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one(),
            ),
          ),
        );
        const existingUserIds = new Set(
          existingMappings
            .filter((m): m is NonNullable<typeof m> => m !== undefined)
            .map(m => m.userId),
        );

        // Add only users who are not already in the group
        const userIdsToAdd = userIds.filter(userId => !existingUserIds.has(userId));

        // Add new users
        for (const userId of userIdsToAdd) {
          const mappingId = mappingIds[userId];
          if (!mappingId) {
            throw new Error(`mappingId is required for user ${userId}`);
          }
          await tx.mutate.user_group_mappings.insert({
            id: mappingId,
            userGroupId,
            userId,
            responsibility: UserResponsibility.MEMBER, // New users added get MEMBER role by default
            onCallSetNumbers: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    removeUsers: defineMutator(
      z.object({ userGroupId: z.string(), userIds: z.array(z.string()) }),
      async ({ tx, args: { userGroupId, userIds } }) => {
        // Remove users from group
        // Find all mappings to be removed using individual queries
        const mappingsToRemove = await Promise.all(
          userIds.map(userId =>
            tx.run(
              zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one(),
            ),
          ),
        );

        // Delete the found mappings
        for (const mapping of mappingsToRemove) {
          if (mapping) {
            await tx.mutate.user_group_mappings.delete({
              id: mapping.id,
            });
          }
        }
      },
    ),
  },
  board: {
    update: defineMutator(
      z.object({
        boardId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        projectId: z.string().optional(),
        boardType: z.nativeEnum(BoardType).optional(),
        metadata: z.any().optional(),
        stages: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string(),
              eta: z.number().optional(),
              sequenceNumber: z.number(),
              defaultTicketStatusV2: z.string().optional(),
              prStatuses: z.array(z.nativeEnum(PRStatusEvent)).optional(),
              approverIds: z.array(z.string()).optional(),
              formId: z.string().optional(),
            }),
          )
          .optional(),
        timestamp: z.number(),
        stageIds: z.record(z.string(), z.string()).optional(),
        prStatusMappingIds: z.record(z.string(), z.string()).optional(), // Map "stageSeq-prStatus" -> mappingId
      }),
      async ({
        tx,
        ctx,
        args: {
          boardId,
          name,
          description,
          projectId,
          metadata,
          stages,
          timestamp,
          stageIds = {},
          prStatusMappingIds = {},
          boardType,
        },
      }) => {
        // Validate board exists
        const board = await tx.run(zql.boards.where('id', boardId).one());
        if (!board) {
          throw new Error('Board not found');
        }

        // Validate project exists if projectId is being changed
        if (projectId && projectId !== board.projectId) {
          const project = await tx.run(zql.projects.where('id', projectId).one());
          if (!project) {
            throw new Error('Project not found');
          }
        }

        // Check for duplicate name if name is being changed
        if (name && name !== board.name) {
          const existingBoard = await tx.run(zql.boards.where('name', name).one());
          if (existingBoard && existingBoard.id !== boardId) {
            throw new Error(`Board with name '${name}' already exists`);
          }
        }

        // Update board
        await tx.mutate.boards.update({
          id: boardId,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(projectId !== undefined && { projectId }),
          ...(boardType !== undefined && { boardType }),
          ...(metadata !== undefined && { metadata: metadata as ReadonlyJSONValue }),
          updatedBy: ctx.userID,
          updatedAt: timestamp,
        });

        // Update stages if provided
        if (stages) {
          const processedStageIds = new Set<string>();
          // Update or create stages
          const existingStages = await tx.run(zql.stages.where('boardId', boardId));
          const existingStageMap = new Map(existingStages.map(s => [s.id, s]));

          for (const stage of stages) {
            const stageId = stage.id || stageIds[stage.sequenceNumber];
            if (!stageId) {
              throw new Error(`stageId is required for stage at sequence ${stage.sequenceNumber}`);
            }

            processedStageIds.add(stageId);

            // Upsert the stage
            await tx.mutate.stages.upsert({
              id: stageId,
              name: stage.name,
              ...(stage.eta !== undefined && { eta: stage.eta }),
              sequenceNumber: stage.sequenceNumber,
              boardId: boardId,
              createdBy: existingStageMap.get(stageId)?.createdBy || ctx.userID,
              updatedBy: ctx.userID,
              createdAt: existingStageMap.get(stageId)?.createdAt || timestamp,
              updatedAt: timestamp,
              defaultTicketStatusV2:
                (stage.defaultTicketStatusV2 as TicketStatusV2) || TicketStatusV2.STARTED,
            });

            // Differential PR status mapping sync
            if (stage.prStatuses !== undefined) {
              // Fetch existing mappings for this stage
              const existingMappings = await tx.run(
                zql.stage_pr_status_mappings.where('stageId', stageId),
              );

              // Create sets for comparison
              const existingPRStatuses = new Set(existingMappings.map(m => m.prStatus));
              const newPRStatuses = new Set(stage.prStatuses);

              // Find mappings to delete (exist in DB but not in new array)
              const mappingsToDelete = existingMappings.filter(
                mapping => !newPRStatuses.has(mapping.prStatus),
              );

              // Find PR statuses to add (exist in new array but not in DB)
              const prStatusesToAdd = stage.prStatuses.filter(
                prStatus => !existingPRStatuses.has(prStatus),
              );

              // Delete only removed mappings
              for (const mapping of mappingsToDelete) {
                await tx.mutate.stage_pr_status_mappings.delete({
                  id: mapping.id,
                });
              }

              // Insert only new mappings
              for (const prStatus of prStatusesToAdd) {
                const mappingKey = `${stage.sequenceNumber}-${prStatus}`;
                const mappingId = prStatusMappingIds[mappingKey];
                if (!mappingId) {
                  throw new Error(
                    `prStatusMappingId is required for stage ${stage.sequenceNumber} and PR status ${prStatus}`,
                  );
                }
                await tx.mutate.stage_pr_status_mappings.insert({
                  id: mappingId,
                  stageId: stageId,
                  prStatus: prStatus,
                  createdAt: timestamp,
                });
              }
            }
          }

          // Delete stages that were removed (not in the new stages array)
          const stagesToDelete = existingStages.filter(stage => !processedStageIds.has(stage.id));

          for (const existingStage of stagesToDelete) {
            // Delete stage approvers for this stage first
            const existingApprovers = await tx.run(
              zql.stage_approvers.where('stageId', existingStage.id),
            );
            for (const approver of existingApprovers) {
              await tx.mutate.stage_approvers.delete({
                id: approver.id,
              });
            }

            // Delete form mappings for this stage
            const existingMappings = await tx.run(
              zql.forms_context_mapping
                .where('contextId', existingStage.id)
                .where('contextType', FormContextType.STAGE),
            );
            for (const mapping of existingMappings) {
              await tx.mutate.forms_context_mapping.delete({
                id: mapping.id,
              });
            }

            // Delete PR status mappings for this stage
            const prStatusMappings = await tx.run(
              zql.stage_pr_status_mappings.where('stageId', existingStage.id),
            );
            for (const mapping of prStatusMappings) {
              await tx.mutate.stage_pr_status_mappings.delete({
                id: mapping.id,
              });
            }

            // Delete the stage
            await tx.mutate.stages.delete({
              id: existingStage.id,
            });
          }

          // Delete all existing STAGE context form mappings for this board
          for (const stage of existingStages) {
            const existingMappings = await tx.run(
              zql.forms_context_mapping
                .where('contextId', stage.id)
                .where('contextType', FormContextType.STAGE),
            );
            for (const mapping of existingMappings) {
              await tx.mutate.forms_context_mapping.delete({
                id: mapping.id,
              });
            }
          }

          // Create new form mappings and stage approvers from stages array
          for (const stage of stages) {
            const stageId = stage.id || stageIds[stage.sequenceNumber];
            if (!stageId) {
              throw new Error(`stageId is required for stage at sequence ${stage.sequenceNumber}`);
            }

            // Handle stage form (optional)
            if (stage.formId) {
              await tx.mutate.forms_context_mapping.insert({
                id: `${stageId}-form-mapping`,
                contextId: stageId,
                contextType: FormContextType.STAGE,
                entityType: FormEntityType.TICKET,
                formId: stage.formId,
              });
            }

            // Handle stage approvers (optional)
            if (stage.approverIds && stage.approverIds.length > 0) {
              // Delete all existing approvers for this stage
              const existingApprovers = await tx.run(zql.stage_approvers.where('stageId', stageId));
              for (const existing of existingApprovers) {
                await tx.mutate.stage_approvers.delete({
                  id: existing.id,
                });
              }

              // Insert new approvers for this stage
              for (const approverId of stage.approverIds) {
                await tx.mutate.stage_approvers.insert({
                  id: `${stageId}-${approverId}`,
                  userId: approverId,
                  stageId: stageId,
                  createdAt: timestamp,
                });
              }
            }
          }
        }
      },
    ),
    delete: defineMutator(z.object({ boardId: z.string() }), async ({ tx, args: { boardId } }) => {
      // Validate board exists
      const board = await tx.run(zql.boards.where('id', boardId).one());
      if (!board) {
        throw new Error('Board not found');
      }

      // Check if board has tickets with terminal statuses (CANCELLED, COMPLETED)
      const terminalTickets = await tx.run(
        zql.tickets
          .where('boardId', boardId)
          .where(helpers =>
            helpers.or(
              helpers.cmp('statusV2', TicketStatusV2.CANCELLED),
              helpers.cmp('statusV2', TicketStatusV2.COMPLETED),
            ),
          ),
      );

      if (terminalTickets.length > 0) {
        throw new Error(
          'Cannot delete board with tickets in terminal status (CANCELLED or COMPLETED)',
        );
      }

      // Delete all stages first
      const stages = await tx.run(zql.stages.where('boardId', boardId));
      for (const stage of stages) {
        // Delete stage approvers for this stage
        const approvers = await tx.run(zql.stage_approvers.where('stageId', stage.id));
        for (const approver of approvers) {
          await tx.mutate.stage_approvers.delete({
            id: approver.id,
          });
        }

        // Delete PR status mappings for this stage
        const mappings = await tx.run(zql.stage_pr_status_mappings.where('stageId', stage.id));
        for (const mapping of mappings) {
          await tx.mutate.stage_pr_status_mappings.delete({
            id: mapping.id,
          });
        }

        // Delete the stage
        await tx.mutate.stages.delete({
          id: stage.id,
        });
      }

      // Delete board
      await tx.mutate.boards.delete({
        id: boardId,
      });
    }),
  },
  ticketTag: {
    create: defineMutator(
      z.object({ ticketId: z.string(), tagName: z.string(), tagId: z.string() }),
      async ({ tx, args: { ticketId, tagName, tagId } }) => {
        // Validate tag name
        if (!tagName || !tagName.trim()) {
          throw new Error('Tag name cannot be empty');
        }

        const trimmedTagName = tagName.trim();

        // Check if tag already exists for this ticket
        const existingTag = await tx.run(
          zql.ticket_tags.where('ticketId', ticketId).where('name', trimmedTagName).one(),
        );

        if (existingTag) {
          throw new Error('Tag already exists for this ticket');
        }

        // Create new tag
        await tx.mutate.ticket_tags.insert({
          id: tagId,
          name: trimmedTagName,
          ticketId,
        });
      },
    ),
    delete: defineMutator(z.object({ tagId: z.string() }), async ({ tx, args: { tagId } }) => {
      // Validate tag exists
      const tag = await tx.run(zql.ticket_tags.where('id', tagId).one());
      if (!tag) {
        throw new Error('Tag not found');
      }

      // Delete tag
      await tx.mutate.ticket_tags.delete({
        id: tagId,
      });
    }),
  },
  ticketStageRequest: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        stageId: z.string(),
        formId: z.string().optional(),
        status: z.nativeEnum(TicketStageRequestStatus),
        updatedBy: z.string(),
        updatedAt: z.number(),
        reviewedBy: z.string().optional(),
        requestActivityId: z.string().optional(),
        approvedActivityId: z.string().optional(),
        rejectedActivityId: z.string().optional(),
      }),
      async ({
        tx,
        args: {
          id,
          ticketId,
          stageId,
          formId,
          status,
          updatedBy,
          updatedAt,
          reviewedBy,
          requestActivityId,
          approvedActivityId,
          rejectedActivityId,
        },
      }) => {
        const existingApproval = await tx.run(zql.ticket_stage_requests.where('id', id).one());

        const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
        const stage = await tx.run(zql.stages.where('id', stageId).one());

        if (!ticket) {
          throw new Error('Ticket not found');
        }
        if (!stage) {
          throw new Error('Stage not found');
        }

        // Get actor name for activity messages
        const actor = await tx.run(zql.users.where('id', updatedBy).one());

        // Prepare payload - preserve immutable fields from existing record
        const payload = {
          id,
          ticketId,
          stageId,
          ...(formId && { formId }),
          status,
          updatedBy,
          updatedAt,
          ...(existingApproval
            ? {
                submittedBy: existingApproval.submittedBy,
                createdAt: existingApproval.createdAt,
              }
            : {
                submittedBy: updatedBy,
                createdAt: updatedAt,
              }),
          ...(reviewedBy !== undefined && { reviewedBy }),
        };

        // Upsert ticket stage request
        await tx.mutate.ticket_stage_requests.upsert(payload);

        // Handle activities based on whether this is create or update
        if (!existingApproval && requestActivityId) {
          // Create message for approval request
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'submitted the form for' : 'requested approval for';

          await tx.mutate.messages.insert({
            messageId: requestActivityId,
            conversationId: ticket.conversationId,
            senderId: updatedBy,
            content: `${actorName} ${actionText} ${stage.name}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: false,
            showInChannel: false,
            createdAt: payload.createdAt,
            metadata: {
              activityType: ActivityType.STAGE_CHANGE_APPROVED,
              isTicketActivity: true,
              fromStage: ticket.stageName,
              toStage: stage.name,
              hasForm,
            },
          });
        } else if (
          status === TicketStageRequestStatus.SUBMITTED &&
          existingApproval?.status === TicketStageRequestStatus.REJECTED &&
          requestActivityId
        ) {
          // Resubmitting a rejected request - create a new message
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm
            ? 'resubmitted the form for'
            : 'resubmitted the approval request for';

          await tx.mutate.messages.insert({
            messageId: requestActivityId,
            conversationId: ticket.conversationId,
            senderId: updatedBy,
            content: `${actorName} ${actionText} ${stage.name}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: false,
            showInChannel: false,
            createdAt: updatedAt,
            metadata: {
              activityType: ActivityType.STAGE_CHANGE_REQUEST,
              isTicketActivity: true,
              fromStage: ticket.stageName,
              toStage: stage.name,
              hasForm,
              isResubmission: true,
            },
          });
        } else if (
          status === TicketStageRequestStatus.APPROVED &&
          existingApproval?.status !== TicketStageRequestStatus.APPROVED &&
          approvedActivityId
        ) {
          // If status changed to approved, move ticket to the stage
          await tx.mutate.tickets.update({
            id: ticket.id,
            stageName: stage.name,
            ...(stage.defaultTicketStatusV2 && { statusV2: stage.defaultTicketStatusV2 }),
            updatedAt,
          });

          await updateTicketMdFromZero(tx, zql, ticket.id);

          // Create message for approval
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'approved the form for' : 'approved the stage change to';

          await tx.mutate.messages.insert({
            messageId: approvedActivityId,
            conversationId: ticket.conversationId,
            senderId: updatedBy,
            content: `${actorName} ${actionText} ${stage.name}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: false,
            showInChannel: false,
            createdAt: updatedAt,
            metadata: {
              activityType: ActivityType.STAGE_CHANGE_APPROVED,
              isTicketActivity: true,
              stageName: stage.name,
              hasForm,
            },
          });
        } else if (
          status === TicketStageRequestStatus.REJECTED &&
          existingApproval?.status !== TicketStageRequestStatus.REJECTED &&
          rejectedActivityId
        ) {
          // Create message for rejection
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'rejected the form for' : 'rejected the stage change to';

          await tx.mutate.messages.insert({
            messageId: rejectedActivityId,
            conversationId: ticket.conversationId,
            senderId: updatedBy,
            content: `${actorName} ${actionText} ${stage.name}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: false,
            showInChannel: false,
            createdAt: updatedAt,
            metadata: {
              activityType: ActivityType.STAGE_CHANGE_REJECTED,
              isTicketActivity: true,
              stageName: stage.name,
              hasForm,
            },
          });
        }
      },
    ),
    deleteByTicketId: defineMutator(
      z.object({
        ticketId: z.string(),
      }),
      async ({ tx, args: { ticketId } }) => {
        const requests = await tx.run(zql.ticket_stage_requests.where('ticketId', ticketId));

        for (const request of requests) {
          await tx.mutate.ticket_stage_requests.delete({ id: request.id });
        }
      },
    ),
  },
  ticketReference: {
    create: defineMutator(
      z.object({
        sourceTicketId: z.string(),
        targetTicketId: z.string(),
        relationType: z.nativeEnum(TicketReferenceRelation),
        timestamp: z.number(),
        referenceId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: { sourceTicketId, targetTicketId, relationType, timestamp, referenceId },
      }) => {
        const existingReference = await tx.run(
          zql.ticket_reference_mappings
            .where('sourceTicketId', sourceTicketId)
            .where('targetTicketId', targetTicketId)
            .where('relationType', relationType)
            .one(),
        );

        if (existingReference) {
          throw new Error('Ticket reference already exists');
        }

        await tx.mutate.ticket_reference_mappings.insert({
          id: referenceId,
          sourceTicketId,
          targetTicketId,
          relationType,
          createdBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    updateRelationType: defineMutator(
      z.object({
        id: z.string(),
        relationType: z.nativeEnum(TicketReferenceRelation),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, relationType, timestamp } }) => {
        const reference = await tx.run(zql.ticket_reference_mappings.where('id', id).one());
        if (!reference) {
          throw new Error('Ticket reference not found');
        }

        await tx.mutate.ticket_reference_mappings.update({
          id,
          relationType,
          updatedAt: timestamp,
        });
      },
    ),
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args: { id } }) => {
      const reference = await tx.run(zql.ticket_reference_mappings.where('id', id).one());
      if (!reference) {
        throw new Error('Ticket reference not found');
      }

      await tx.mutate.ticket_reference_mappings.delete({
        id,
      });
    }),
  },
  canvas: {
    create: defineMutator(
      z.object({
        id: z.string(),
        title: z.string(),
        channelId: z.string().optional(),
        viewAccessId: z.string().optional(),
        editAccessId: z.string().optional(),
        visibility: z.nativeEnum(CanvasVisibility).optional(),
        content: z.any().optional(),
        timestamp: z.number(),
        participantId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          title,
          channelId,
          viewAccessId,
          editAccessId,
          visibility,
          content,
          timestamp,
          participantId,
        },
      }) => {
        const now = timestamp;

        await tx.mutate.canvases.insert({
          id,
          title,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          content: content || [],
          channelId,
          createdBy: ctx.userID,
          viewAccessId,
          editAccessId,
          visibility: visibility || CanvasVisibility.PRIVATE,
          isTemplate: false,
          isCollaborative: false,
          docType: DocType.Canvas,
          lastEditedBy: ctx.userID,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {},
        });

        // Add creator as participant with OWNER role
        await tx.mutate.canvas_participants.insert({
          id: participantId,
          canvasId: id,
          userId: ctx.userID,
          role: CanvasRole.OWNER,
          joinedAt: now,
          updatedAt: now,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.any().optional(),
        visibility: z.nativeEnum(CanvasVisibility).optional(),
        isCollaborative: z.boolean().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, title, content, visibility, isCollaborative, timestamp } }) => {
        await tx.mutate.canvases.update({
          id,
          lastEditedBy: ctx.userID,
          lastEditedAt: timestamp,
          updatedAt: timestamp,
          ...(title !== undefined && { title }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          ...(content !== undefined && { content }),
          ...(visibility !== undefined && { visibility }),
          ...(isCollaborative !== undefined && { isCollaborative }),
        });
      },
    ),
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
      const canvas = await tx.run(zql.canvases.where('id', id).one());
      if (!canvas) {
        throw new Error('Canvas not found');
      }

      if (canvas.createdBy !== ctx.userID) {
        throw new Error('Only the creator can delete the canvas');
      }

      await tx.mutate.canvases.delete({ id });
    }),
    addParticipants: defineMutator(
      z.object({
        canvasId: z.string(),
        userIds: z.array(z.string()),
        role: z.nativeEnum(CanvasRole),
        timestamp: z.number(),
        participantIds: z.record(z.string(), z.string()), // Map userId -> participantId
      }),
      async ({ tx, ctx, args: { canvasId, userIds, role, timestamp, participantIds = {} } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error("Canvas doesn't exist");
        }

        // Check if requesting user is owner
        const requestingUserParticipant = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );

        const isOwner =
          canvas.createdBy === ctx.userID ||
          (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

        const isEditor =
          requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

        if (!isOwner && !isEditor) {
          throw new Error('Only canvas owners can add participants');
        }
        // Prevent editors from granting owner role
        if (isEditor && role === CanvasRole.OWNER) {
          throw new Error('Editors cannot grant owner role');
        }

        const now = timestamp;

        // Add each user as participant
        for (const userId of userIds) {
          // Check if user exists
          const user = await tx.run(zql.users.where('id', userId).one());
          if (!user) {
            continue;
          }

          // Check if already a participant
          const existingParticipant = await tx.run(
            zql.canvas_participants.where('canvasId', canvasId).where('userId', userId).one(),
          );

          if (existingParticipant) {
            continue;
          }

          const participantId = participantIds[userId];
          if (!participantId) {
            throw new Error(`participantId is required for user ${userId}`);
          }
          await tx.mutate.canvas_participants.insert({
            id: participantId,
            canvasId,
            userId,
            role,
            joinedAt: now,
            updatedAt: now,
          });
        }
      },
    ),
    removeParticipant: defineMutator(
      z.object({ canvasId: z.string(), userId: z.string() }),
      async ({ tx, ctx, args: { canvasId, userId } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error("Canvas doesn't exist");
        }

        // Check if requesting user is owner
        const requestingUserParticipant = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );

        const isOwner =
          canvas.createdBy === ctx.userID ||
          (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

        const isEditor =
          requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

        if (!isOwner && !isEditor) {
          throw new Error('Only canvas owners or editors can remove participants');
        }

        // Get target participant
        const targetParticipant = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', userId).one(),
        );

        if (!targetParticipant) {
          throw new Error('User is not a participant');
        }

        // Prevent removing yourself if you're the creator
        if (userId === ctx.userID && canvas.createdBy === ctx.userID) {
          throw new Error('Canvas creator cannot be removed');
        }

        // Prevent editors from removing owners
        if (isEditor && targetParticipant.role === CanvasRole.OWNER) {
          throw new Error('Editors cannot remove owners');
        }

        await tx.mutate.canvas_participants.delete({
          id: targetParticipant.id,
        });
      },
    ),
    updateParticipantRole: defineMutator(
      z.object({
        canvasId: z.string(),
        userId: z.string(),
        role: z.nativeEnum(CanvasRole),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { canvasId, userId, role, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error("Canvas doesn't exist");
        }

        // Check if requesting user is owner
        const requestingUserParticipant = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );

        const isOwner =
          canvas.createdBy === ctx.userID ||
          (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

        const isEditor =
          requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

        if (!isOwner && !isEditor) {
          throw new Error('Only canvas owners or editors can update participant roles');
        }

        // Get target participant
        const targetParticipant = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', userId).one(),
        );

        if (!targetParticipant) {
          throw new Error('User is not a participant');
        }

        // Prevent editors from granting owner role
        if (isEditor && role === CanvasRole.OWNER) {
          throw new Error('Editors cannot grant owner role');
        }
        // Prevent editors from modifying owners
        if (isEditor && targetParticipant.role === CanvasRole.OWNER) {
          throw new Error('Editors cannot modify owner roles');
        }

        // Prevent changing creator's role
        if (userId === canvas.createdBy) {
          throw new Error("Cannot change canvas creator's role");
        }

        await tx.mutate.canvas_participants.update({
          id: targetParticipant.id,
          role,
          updatedAt: timestamp,
        });
      },
    ),
  },
  bookmark: {
    add: defineMutator(
      z.object({
        entityId: z.string(),
        entityType: z.nativeEnum(BookmarkEntityType),
        bookmarkId: z.string(),
        timestamp: z.number(),
        metadata: z.any().optional(),
      }),
      async ({ tx, ctx, args: { entityId, entityType, bookmarkId, timestamp, metadata } }) => {
        const existing = await tx.run(
          // eslint-disable-next-line local-rules/require-is-deleted-filter
          bookmarkByEntityQuery(ctx.userID, entityId, entityType).one(),
        );

        if (existing) {
          if (existing.isDeleted || existing.isCompleted) {
            await tx.mutate.bookmarks.update({
              id: existing.id,
              isDeleted: false,
              isCompleted: false,
              updatedAt: timestamp,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              metadata: metadata ?? null,
            });
          }
          return;
        }

        await tx.mutate.bookmarks.insert({
          id: bookmarkId,
          userId: ctx.userID,
          entityId,
          entityType,
          createdAt: timestamp,
          updatedAt: timestamp,
          isDeleted: false,
          isCompleted: false,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          metadata,
        });
      },
    ),
    remove: defineMutator(
      z.object({
        entityId: z.string(),
        entityType: z.nativeEnum(BookmarkEntityType),
        timestamp: z.number(),
        markAsDone: z.boolean().optional(),
      }),
      async ({ tx, ctx, args: { entityId, entityType, timestamp, markAsDone } }) => {
        const bookmark = await tx.run(
          bookmarkByEntityQuery(ctx.userID, entityId, entityType)
            .where('isDeleted', false)
            .where('isCompleted', false)
            .one(),
        );

        if (!bookmark) {
          throw new Error('Bookmark not found');
        }

        await tx.mutate.bookmarks.update({
          id: bookmark.id,
          isDeleted: !markAsDone,
          isCompleted: !!markAsDone,
          updatedAt: timestamp,
          metadata: markAsDone
            ? buildCompletedBookmarkMetadata(bookmark.metadata, timestamp)
            : null,
        });
      },
    ),
    updateMetadata: defineMutator(
      z.object({
        entityId: z.string(),
        entityType: z.nativeEnum(BookmarkEntityType),
        metadata: z.any(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { entityId, entityType, metadata, timestamp } }) => {
        const bookmark = await tx.run(
          bookmarkByEntityQuery(ctx.userID, entityId, entityType)
            .where('isDeleted', false)
            .where('isCompleted', false)
            .one(),
        );

        if (!bookmark) {
          throw new Error('Bookmark not found');
        }

        await tx.mutate.bookmarks.update({
          id: bookmark.id,
          updatedAt: timestamp,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          metadata,
        });
      },
    ),
  },
  links: {
    create: defineMutator(
      z.object({
        id: z.string(),
        url: z.string(),
        title: z.string(),
        description: z.string().optional(),
        favicon: z.string().optional(),
        channelId: z.string(),
        visibility: z.enum(['DEFAULT', 'PERSONAL']),
        createdAt: z.number(),
        updatedAt: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { id, url, title, description, favicon, channelId, visibility, createdAt, updatedAt },
      }) => {
        // Check if link already exists for this user in this channel
        const existing = await tx.run(
          zql.links
            .where('createdBy', ctx.userID)
            .where('url', url)
            .where('channelId', channelId)
            .one(),
        );

        if (existing) {
          throw new Error('Link already exists');
        }

        await tx.mutate.links.insert({
          id,
          url,
          title,
          description: description ?? null,
          favicon: favicon ?? null,
          channelId,
          createdBy: ctx.userID,
          visibility: visibility === 'DEFAULT' ? LinkVisibility.DEFAULT : LinkVisibility.PERSONAL,
          createdAt,
          updatedAt,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        favicon: z.string().optional(),
        visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, title, description, favicon, visibility, updatedAt } }) => {
        const link = await tx.run(zql.links.where('id', id).one());

        if (!link) {
          throw new Error('Link not found');
        }

        if (link.createdBy !== ctx.userID) {
          throw new Error('Only link creator can update it');
        }

        await tx.mutate.links.update({
          id,
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(favicon !== undefined && { favicon }),
          ...(visibility !== undefined && {
            visibility: visibility === 'DEFAULT' ? LinkVisibility.DEFAULT : LinkVisibility.PERSONAL,
          }),
          updatedAt,
        });
      },
    ),
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
      const link = await tx.run(zql.links.where('id', id).one());

      if (!link) {
        throw new Error('Link not found');
      }

      if (link.createdBy !== ctx.userID) {
        throw new Error('Only link creator can delete it');
      }

      // Delete link (cascade will handle link_access)
      await tx.mutate.links.delete({ id });
    }),
    shareWith: defineMutator(
      z.object({
        linkId: z.string(),
        userIds: z.array(z.string()),
        accessIds: z.array(z.string()),
        createdAt: z.number(),
      }),
      async ({ tx, ctx, args: { linkId, userIds, accessIds, createdAt } }) => {
        const link = await tx.run(zql.links.where('id', linkId).one());

        if (!link) {
          throw new Error('Link not found');
        }

        if (link.createdBy !== ctx.userID) {
          throw new Error('Only link creator can share it');
        }

        // Add each user to link_access
        for (let i = 0; i < userIds.length; i++) {
          const userId = userIds[i];
          const accessId = accessIds[i];

          if (!userId || !accessId) {
            continue;
          }

          // Check if user exists
          const user = await tx.run(zql.users.where('id', userId).one());
          if (!user) {
            continue;
          }

          // Check if already has access
          const existingAccess = await tx.run(
            zql.link_access.where('linkId', linkId).where('userId', userId).one(),
          );

          if (existingAccess) {
            continue;
          }

          await tx.mutate.link_access.insert({
            id: accessId,
            linkId,
            userId,
            createdAt,
          });
        }
      },
    ),
    unshare: defineMutator(
      z.object({
        linkId: z.string(),
        userId: z.string(),
      }),
      async ({ tx, ctx, args: { linkId, userId } }) => {
        const link = await tx.run(zql.links.where('id', linkId).one());

        if (!link) {
          throw new Error('Link not found');
        }

        if (link.createdBy !== ctx.userID) {
          throw new Error('Only link creator can unshare it');
        }

        const access = await tx.run(
          zql.link_access.where('linkId', linkId).where('userId', userId).one(),
        );

        if (access) {
          await tx.mutate.link_access.delete({ id: access.id });
        }
      },
    ),
  },
  nudges: {
    dismiss: defineMutator(
      z.object({
        nudgeId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { nudgeId, timestamp } }) => {
        const nudge = await tx.run(zql.surface_nudges.where('id', nudgeId).one());
        if (!nudge) {
          throw new Error('Nudge not found');
        }

        if (nudge.state !== NudgeState.ACTIVE && nudge.state !== NudgeState.ACTED_ON) {
          return;
        }

        await tx.mutate.surface_nudges.update({
          id: nudgeId,
          state: NudgeState.DISMISSED,
          updatedAt: timestamp,
          surfaceNudgeCountId: null,
        });
        if (nudge.state === NudgeState.ACTIVE) {
          const countRow = nudge.surfaceNudgeCountId
            ? await tx.run(zql.surface_nudge_counts.where('id', nudge.surfaceNudgeCountId).one())
            : null;

          if (countRow) {
            if (countRow.nudgeCount <= 1) {
              await tx.mutate.surface_nudge_counts.delete({ id: countRow.id });
            } else {
              await tx.mutate.surface_nudge_counts.update({
                id: countRow.id,
                nudgeCount: countRow.nudgeCount - 1,
                updatedAt: timestamp,
              });
            }
          }
        }
      },
    ),
    act: defineMutator(
      z.object({
        nudgeId: z.string(),
        actionResult: z.any().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { nudgeId, actionResult, timestamp } }) => {
        const nudge = await tx.run(zql.surface_nudges.where('id', nudgeId).one());
        if (!nudge) {
          throw new Error('Nudge not found');
        }

        if (nudge.state !== NudgeState.ACTIVE) {
          return;
        }

        const existingActions =
          nudge.actions && typeof nudge.actions === 'object' && !Array.isArray(nudge.actions)
            ? (nudge.actions as Record<string, unknown>)
            : {};
        const actionBehavior = getNudgeActionBehavior(existingActions);
        const nextState =
          actionBehavior.onSuccess === 'dismissed'
            ? NudgeState.DISMISSED
            : actionBehavior.onSuccess === 'acted_on'
              ? NudgeState.ACTED_ON
              : nudge.state;
        const shouldPersistActionResult =
          actionBehavior.actionMode === 'write' && actionBehavior.onSuccess !== 'none';
        const shouldHideNudge = nextState !== NudgeState.ACTIVE;

        if (nextState !== nudge.state || (shouldPersistActionResult && actionResult)) {
          await tx.mutate.surface_nudges.update(
            shouldPersistActionResult && actionResult
              ? {
                  id: nudgeId,
                  state: nextState,
                  updatedAt: timestamp,
                  surfaceNudgeCountId: shouldHideNudge ? null : nudge.surfaceNudgeCountId,
                  actions: {
                    ...existingActions,
                    actionResult: actionResult as ReadonlyJSONValue,
                  },
                }
              : {
                  id: nudgeId,
                  state: nextState,
                  updatedAt: timestamp,
                  surfaceNudgeCountId: shouldHideNudge ? null : nudge.surfaceNudgeCountId,
                },
          );
        }
        if (nudge.state === NudgeState.ACTIVE && shouldHideNudge) {
          const countRow = nudge.surfaceNudgeCountId
            ? await tx.run(zql.surface_nudge_counts.where('id', nudge.surfaceNudgeCountId).one())
            : null;

          if (countRow) {
            if (countRow.nudgeCount <= 1) {
              await tx.mutate.surface_nudge_counts.delete({ id: countRow.id });
            } else {
              await tx.mutate.surface_nudge_counts.update({
                id: countRow.id,
                nudgeCount: countRow.nudgeCount - 1,
                updatedAt: timestamp,
              });
            }
          }
        }

        // Create surface_links row when action result has target info
        if (
          actionBehavior.createSurfaceLink &&
          actionResult &&
          typeof actionResult === 'object' &&
          !Array.isArray(actionResult)
        ) {
          const result = actionResult as Record<string, unknown>;
          const innerResult = result['result'] as Record<string, unknown> | undefined;

          if (innerResult) {
            const direction = getNudgeDirection(nudge.nudgeKind);
            if (direction) {
              const entityId =
                typeof innerResult['entityId'] === 'string' ? innerResult['entityId'] : undefined;

              if (entityId) {
                const linkId = `sl_${nudgeId}_${timestamp}`;
                await tx.mutate.surface_links.insert({
                  id: linkId,
                  sourceType: direction.from,
                  sourceId: nudge.sourceId,
                  targetType: direction.to,
                  targetId: entityId,
                  linkKind: SurfaceLinkKind.RELATES_TO,
                  createdBy: ctx.userID,
                  projectId: nudge.projectId,
                  createdAt: timestamp,
                });
              }
            }
          }
        }
      },
    ),
  },
  userProfile: {
    upsert: defineMutator(
      z.object({
        displayName: z.string().nullable().optional(),
        pronunciation: z.string().nullable().optional(),
        team: z.string().nullable().optional(),
        phoneNumber: z.string().nullable().optional(),
        dob: z.number().nullable().optional(),
        manager: z.string().nullable().optional(),
        timestamp: z.number(),
        profileId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          displayName,
          pronunciation,
          team,
          phoneNumber,
          dob,
          manager,
          timestamp,
          profileId: inputProfileId,
        },
      }) => {
        // Check if profile already exists to get the ID
        const existingProfile = await tx.run(zql.user_profiles.where('userId', ctx.userID).one());

        const profileId = existingProfile?.id || inputProfileId;
        if (!profileId) {
          throw new Error('profileId is required');
        }

        const profileData: {
          id: string;
          userId: string;
          displayName?: string | null;
          pronunciation?: string | null;
          team?: string | null;
          phoneNumber?: string | null;
          dob?: number | null;
          manager?: string | null;
          updatedAt: number;
          createdAt: number;
        } = {
          id: profileId,
          userId: ctx.userID,
          ...(displayName !== undefined && { displayName }),
          ...(pronunciation !== undefined && { pronunciation }),
          ...(team !== undefined && { team }),
          ...(phoneNumber !== undefined && { phoneNumber }),
          ...(dob !== undefined && { dob }),
          ...(manager !== undefined && { manager }),
          updatedAt: timestamp,
          createdAt: existingProfile ? existingProfile.createdAt || timestamp : timestamp,
        };

        await tx.mutate.user_profiles.upsert(profileData);

        // Update displayName on User table if provided
        if (displayName !== undefined) {
          await tx.mutate.users.update({
            id: ctx.userID,
            displayName,
            updatedAt: timestamp,
          });
        }
      },
    ),
  },
  userPresence: {
    upsert: defineMutator(
      z.object({
        statusEmoji: z.string().nullable().optional(),
        statusContent: z.string().nullable().optional(),
        statusExpiryAt: z.number().nullable().optional(),
        assignmentUnavailableUntil: z.number().nullable().optional(),
        notificationsPausedUntil: z.number().nullable().optional(),
        timestamp: z.number(),
        presenceId: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: {
          statusEmoji,
          statusContent,
          statusExpiryAt,
          assignmentUnavailableUntil,
          notificationsPausedUntil,
          timestamp,
          presenceId: inputPresenceId,
        },
      }) => {
        // Decode and validate emoji if provided
        let validatedEmoji: string | undefined;
        if (statusEmoji) {
          try {
            const decodedEmoji = decodeURIComponent(statusEmoji);
            if (!decodedEmoji.trim() || decodedEmoji.length > 100) {
              throw new Error('Invalid emoji encoding');
            }
            validatedEmoji = decodedEmoji;
          } catch (e) {
            if (e instanceof URIError) {
              throw new Error('Invalid emoji encoding');
            }
            throw e;
          }
        }

        // Check if user presence record exists
        const existingPresence = await tx.run(zql.user_presence.where('userId', ctx.userID).one());

        const presenceId = existingPresence?.id || inputPresenceId;
        if (!presenceId) {
          throw new Error('presenceId is required');
        }
        const now = timestamp;

        const presenceData = {
          id: presenceId,
          userId: ctx.userID,
          status: existingPresence?.status || UserPresenceStatus.OFFLINE,
          lastActiveAt: now,
          lastSeenAt: now,
          isManual: false,
          ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji || null }),
          ...(statusContent !== undefined && { statusContent }),
          ...(statusExpiryAt !== undefined && { statusExpiryAt }),
          ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil }),
          ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil }),
          updatedAt: now,
          createdAt: existingPresence ? existingPresence.createdAt || now : now,
        };

        await tx.mutate.user_presence.upsert(presenceData);

        // Dual-write presence display fields to users table for faster getUsers query
        await tx.mutate.users.update({
          id: ctx.userID,
          lastActiveAt: now,
          updatedAt: now,
          ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji || null }),
          ...(statusContent !== undefined && { statusContent }),
          ...(statusExpiryAt !== undefined && { statusExpiryAt }),
          ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil }),
          ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil }),
        });
      },
    ),
  },
  assignmentConfig: {
    batchUpdate: defineMutator(
      z.object({
        userGroupId: z.string(),
        userStates: z.array(
          z.object({
            userId: z.string(),
            onCall: z.boolean(),
            isActive: z.boolean(),
          }),
        ),
        userMappings: z
          .array(
            z.object({
              userId: z.string(),
              onCallSetNumbers: z.array(z.number()),
            }),
          )
          .optional(),
        boardWeight: z
          .object({
            boardId: z.string(),
            weight: z.number(),
            usePercentage: z.boolean(),
          })
          .optional(),
        expertiseMappings: z
          .object({
            boardId: z.string(),
            userConfigs: z.array(
              z.object({
                userId: z.string(),
                hasExpertise: z.boolean(),
                percentage: z.number(),
                maxTickets: z.number(),
              }),
            ),
          })
          .optional(),
        timestamp: z.number(),
        stateIds: z.record(z.string(), z.string()).optional(), // Map userId -> stateId
        complexityScoreId: z.string().optional(),
        mappingIds: z.record(z.string(), z.string()).optional(), // Map userId -> mappingId
      }),
      async ({
        tx,
        ctx,
        args: {
          userGroupId,
          userStates,
          userMappings,
          boardWeight,
          expertiseMappings,
          timestamp,
          stateIds = {},
          complexityScoreId,
          mappingIds = {},
        },
      }) => {
        const now = timestamp;

        // Validate user group exists
        const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
        if (!userGroup) {
          throw new Error('User group not found');
        }

        // Update user assignment states
        for (const state of userStates) {
          // Check if state already exists
          const existingState = await tx.run(
            zql.user_assignment_states
              .where('userId', state.userId)
              .where('userGroupId', userGroupId)
              .one(),
          );

          const stateId = existingState?.id || stateIds[state.userId];
          if (!stateId) {
            throw new Error(`stateId is required for user ${state.userId}`);
          }
          const isActiveForAssignment = state.isActive;

          const stateData = {
            id: stateId,
            userId: state.userId,
            userGroupId,
            onCall: state.onCall,
            isActiveForAssignment,
            createdBy: existingState?.createdBy ?? ctx.userID,
            updatedAt: now,
            createdAt: existingState?.createdAt ?? now,
          };

          await tx.mutate.user_assignment_states.upsert(stateData);
        }

        // Update user group mappings (set numbers) if provided
        if (userMappings) {
          for (const mapping of userMappings) {
            const existingMapping = await tx.run(
              zql.user_group_mappings
                .where('userId', mapping.userId)
                .where('userGroupId', userGroupId)
                .one(),
            );

            if (existingMapping) {
              await tx.mutate.user_group_mappings.update({
                id: existingMapping.id,
                onCallSetNumbers: mapping.onCallSetNumbers,
                updatedAt: now,
              });
            }
          }
        }

        // Update board complexity score if provided
        if (boardWeight) {
          if (boardWeight.weight < 1) {
            throw new Error('Weight must be at least 1');
          }

          const existingScore = await tx.run(
            zql.board_complexity_scores
              .where('userGroupId', userGroupId)
              .where('boardId', boardWeight.boardId)
              .one(),
          );

          if (existingScore) {
            await tx.mutate.board_complexity_scores.update({
              id: existingScore.id,
              weight: boardWeight.weight,
              usePercentage: boardWeight.usePercentage,
              updatedAt: now,
            });
          } else {
            const scoreId = complexityScoreId;
            if (!scoreId) {
              throw new Error(
                'complexityScoreId is required when creating a new board complexity score',
              );
            }
            await tx.mutate.board_complexity_scores.insert({
              id: scoreId,
              userGroupId,
              boardId: boardWeight.boardId,
              weight: boardWeight.weight,
              usePercentage: boardWeight.usePercentage,
              createdBy: ctx.userID,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        // Update expertise mappings if provided
        if (expertiseMappings) {
          // For each user in the group, check if they need expertise mapping
          for (const userConfig of expertiseMappings.userConfigs) {
            const existingMapping = await tx.run(
              zql.user_expertise_mappings
                .where('userId', userConfig.userId)
                .where('userGroupId', userGroupId)
                .where('boardId', expertiseMappings.boardId)
                .one(),
            );

            const needsSave =
              userConfig.hasExpertise ||
              userConfig.percentage !== 100 ||
              userConfig.maxTickets !== -1;

            if (needsSave) {
              const mappingId = existingMapping?.id || mappingIds[userConfig.userId];
              if (!mappingId) {
                throw new Error(`mappingId is required for user ${userConfig.userId}`);
              }
              const mappingData = {
                id: mappingId,
                userId: userConfig.userId,
                userGroupId,
                boardId: expertiseMappings.boardId,
                hasExpertise: userConfig.hasExpertise,
                percentage: userConfig.percentage,
                maxTickets: userConfig.maxTickets,
                updatedAt: now,
                createdBy: existingMapping?.createdBy ?? ctx.userID,
                createdAt: existingMapping?.createdAt ?? now,
              };

              await tx.mutate.user_expertise_mappings.upsert(mappingData);
            } else if (existingMapping) {
              // Remove mapping if no special configuration
              await tx.mutate.user_expertise_mappings.delete({
                id: existingMapping.id,
              });
            }
          }
        }
      },
    ),
    toggleGroupAutoRotation: defineMutator(
      z.object({
        userGroupId: z.string(),
        autoRotationEnabled: z.boolean(),
        rotationInterval: z.nativeEnum(RotationInterval).optional(),
        rotationStartDate: z.number().optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        args: { userGroupId, autoRotationEnabled, rotationInterval, rotationStartDate, timestamp },
      }) => {
        // Validate user group exists
        const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
        if (!userGroup) {
          throw new Error('User group not found');
        }

        // When enabling rotation, require interval and start date
        if (autoRotationEnabled && (!rotationInterval || !rotationStartDate)) {
          throw new Error(
            'rotationInterval and rotationStartDate are required when enabling rotation',
          );
        }

        // Update user group with rotation settings
        await tx.mutate.user_groups.update({
          id: userGroupId,
          autoRotationEnabled,
          rotationInterval: autoRotationEnabled ? rotationInterval : null,
          rotationStartDate: autoRotationEnabled ? rotationStartDate : null,
          updatedAt: timestamp,
        });
      },
    ),
  },
  repo: {
    create: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        baseBranch: z.array(z.string()),
        prefix: z.string(),
      }),
      async ({ tx, ctx, args: { id, name, url, baseBranch, prefix } }) => {
        // Check if repo with same URL already exists
        const existing = await tx.run(zql.repos.where('url', url).one());
        if (existing) {
          throw new Error(`Repo with URL '${url}' already exists`);
        }

        await tx.mutate.repos.insert({
          id,
          name,
          url,
          baseBranch,
          prefix,
          createdBy: ctx.userID,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        url: z.string().optional(),
        baseBranch: z.array(z.string()).optional(),
        prefix: z.string().optional(),
      }),
      async ({ tx, args: { id, name, url, baseBranch, prefix } }) => {
        const repo = await tx.run(zql.repos.where('id', id).one());
        if (!repo) {
          throw new Error('Repo not found');
        }

        await tx.mutate.repos.update({
          id,
          ...(name !== undefined && { name }),
          ...(url !== undefined && { url }),
          ...(baseBranch !== undefined && { baseBranch }),
          ...(prefix !== undefined && { prefix }),
        });
      },
    ),
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args: { id } }) => {
      const repo = await tx.run(zql.repos.where('id', id).one());
      if (!repo) {
        throw new Error('Repo not found');
      }

      await tx.mutate.repos.delete({ id });
    }),
    addBranch: defineMutator(
      z.object({ id: z.string(), branchName: z.string() }),
      async ({ tx, args: { id, branchName } }) => {
        const repo = await tx.run(zql.repos.where('id', id).one());
        if (!repo) {
          throw new Error('Repo not found');
        }

        const currentBranches = repo.baseBranch || [];
        if (!currentBranches.includes(branchName)) {
          const newBaseBranch = [...currentBranches, branchName];
          await tx.mutate.repos.update({
            id,
            baseBranch: newBaseBranch,
          });
        }
      },
    ),
  },
  form: {
    update: defineMutator(
      z.object({
        formId: z.string(),
        formDescription: z.string().optional(),
        fields: z
          .array(
            z.object({
              id: z.string().optional(), // Existing field ID for updates
              fieldName: z.string(),
              fieldType: z.nativeEnum(FormFieldType),
              fieldEnum: z.array(z.string()).optional(),
              isOptional: z.boolean().optional(),
            }),
          )
          .optional(),
        timestamp: z.number(),
        fieldIds: z.record(z.string(), z.string()).optional(), // Map field array index -> fieldId
      }),
      async ({ tx, ctx, args: { formId, formDescription, fields, timestamp, fieldIds = {} } }) => {
        // Validate form exists
        const form = await tx.run(zql.forms.where('id', formId).one());
        if (!form) {
          throw new Error('Form not found');
        }

        // Check if user is the form creator
        if (form.createdBy !== ctx.userID) {
          throw new Error('Only the form creator can update the form');
        }

        // Update form description if provided
        if (formDescription !== undefined) {
          await tx.mutate.forms.update({
            id: formId,
            formDescription: formDescription.trim() || undefined,
            updatedAt: timestamp,
          });
        }

        // Handle field operations if provided
        if (fields) {
          const existingFields = await tx.run(zql.form_fields.where('formId', formId));
          const fieldsToBeDeleted = existingFields.filter(
            field => !fields.map(f => f.id).includes(field.id),
          );

          for (const field of fieldsToBeDeleted) {
            // Delete the field
            await tx.mutate.form_fields.delete({
              id: field.id,
            });
          }

          for (const [index, field] of fields.entries()) {
            if (field.id) {
              // Check if field actually exists in the database
              const existingField = existingFields.find(f => f.id === field.id);

              if (existingField) {
                // Update existing field
                const updateData: {
                  id: string;
                  formId: string;
                  fieldName: string;
                  fieldType: FormFieldType;
                  updatedAt: number;
                  fieldEnum?: ReadonlyJSONValue;
                  isOptional?: boolean;
                } = {
                  id: field.id,
                  formId,
                  fieldName: field.fieldName.trim(),
                  fieldType: field.fieldType,
                  updatedAt: timestamp,
                };

                // Add fieldEnum if present
                if (field.fieldEnum && field.fieldEnum.length > 0) {
                  const nonEmptyOptions = field.fieldEnum.filter(opt => opt.trim() !== '');
                  if (nonEmptyOptions.length > 0) {
                    updateData.fieldEnum = nonEmptyOptions;
                  }
                }

                // Add isOptional if defined
                if (field.isOptional !== undefined) {
                  updateData.isOptional = field.isOptional;
                }

                await tx.mutate.form_fields.update(updateData);
              } else {
                // Field has ID but doesn't exist in DB - treat as new field
                const insertData: {
                  id: string;
                  formId: string;
                  fieldName: string;
                  fieldType: FormFieldType;
                  createdAt: number;
                  updatedAt: number;
                  fieldEnum?: ReadonlyJSONValue;
                  isOptional?: boolean;
                } = {
                  id: field.id,
                  formId,
                  fieldName: field.fieldName.trim(),
                  fieldType: field.fieldType,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                };

                // Add fieldEnum if present
                if (field.fieldEnum && field.fieldEnum.length > 0) {
                  const nonEmptyOptions = field.fieldEnum.filter(opt => opt.trim() !== '');
                  if (nonEmptyOptions.length > 0) {
                    insertData.fieldEnum = nonEmptyOptions;
                  }
                }

                // Add isOptional if defined
                if (field.isOptional !== undefined) {
                  insertData.isOptional = field.isOptional;
                }

                await tx.mutate.form_fields.insert(insertData);
              }
            } else {
              // Create new field
              const newFieldId = fieldIds[index];
              if (!newFieldId) {
                throw new Error(`fieldId is required for field at index ${index}`);
              }
              await tx.mutate.form_fields.insert({
                id: newFieldId,
                formId,
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                createdAt: timestamp,
                updatedAt: timestamp,
              });

              // Add fieldEnum if present
              if (field.fieldEnum && field.fieldEnum.length > 0) {
                const nonEmptyOptions = field.fieldEnum.filter(opt => opt.trim() !== '');
                if (nonEmptyOptions.length > 0) {
                  await tx.mutate.form_fields.update({
                    id: newFieldId,
                    fieldEnum: nonEmptyOptions,
                  });
                }
              }

              // Add isOptional if defined
              if (field.isOptional !== undefined) {
                await tx.mutate.form_fields.update({
                  id: newFieldId,
                  isOptional: field.isOptional,
                });
              }
            }
          }
        }
      },
    ),
  },
  formContextMapping: {
    upsert: defineMutator(
      z.object({
        contextId: z.string(),
        contextType: z.nativeEnum(FormContextType),
        entityType: z.nativeEnum(FormEntityType),
        formId: z.string(),
        mappingId: z.string(),
      }),
      async ({ tx, args: { contextId, contextType, entityType, formId, mappingId } }) => {
        // Check if a mapping already exists for this context
        const existingMapping = await tx.run(
          zql.forms_context_mapping
            .where('contextId', contextId)
            .where('contextType', contextType)
            .where('entityType', entityType)
            .one(),
        );

        if (existingMapping) {
          // Update existing mapping
          await tx.mutate.forms_context_mapping.update({
            id: existingMapping.id,
            formId,
          });
        } else {
          await tx.mutate.forms_context_mapping.insert({
            id: mappingId,
            contextId,
            contextType,
            entityType,
            formId,
          });
        }
      },
    ),
    delete: defineMutator(
      z.object({
        contextId: z.string(),
        contextType: z.nativeEnum(FormContextType),
        entityType: z.nativeEnum(FormEntityType),
      }),
      async ({ tx, args: { contextId, contextType, entityType } }) => {
        // Find and delete the mapping
        const existingMapping = await tx.run(
          zql.forms_context_mapping
            .where('contextId', contextId)
            .where('contextType', contextType)
            .where('entityType', entityType)
            .one(),
        );

        if (existingMapping) {
          await tx.mutate.forms_context_mapping.delete({
            id: existingMapping.id,
          });
        }
      },
    ),
  },
  formEntityValue: {
    create: defineMutator(
      z.object({
        id: z.string(),
        entityId: z.string(),
        entityType: z.nativeEnum(FormEntityType),
        fieldId: z.string(),
        newValue: z.array(z.string()),
        timestamp: z.number(),
        contextId: z.string().optional(),
      }),
      async ({
        tx,
        args: { id, entityId, entityType, fieldId, newValue, timestamp, contextId },
      }) => {
        // Fetch the form field to determine field type
        const formField = await tx.run(zql.form_fields.where('id', fieldId).one());

        if (!formField) {
          throw new Error('Form field not found');
        }

        const fieldType = formField.fieldType;

        // Determine actualFieldValue based on field type
        const isMultiValue =
          fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
        const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

        // Upsert the form entity value
        await tx.mutate.form_entity_values.insert({
          id,
          entityId,
          entityType,
          fieldId,
          formId: formField.formId,
          ...(contextId && { contextId }),
          fieldValue: '',
          actualFieldValue,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    update: defineMutator(
      z.object({
        formEntityValueId: z.string(),
        newValue: z.array(z.string()),
        updatedAt: z.number(),
      }),
      async ({ tx, args: { formEntityValueId, newValue, updatedAt } }) => {
        // Validate form entity value exists and get formField relation
        const formEntityValue = await tx.run(
          zql.form_entity_values.where('id', formEntityValueId).related('formField').one(),
        );

        if (!formEntityValue) {
          throw new Error('Form entity value not found');
        }

        const fieldType = formEntityValue.formField?.fieldType;

        // Determine what to store based on field type
        const isMultiValue =
          fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
        const valueToStore = isMultiValue
          ? newValue // Store array for MULTI_SELECT/USER (including empty arrays)
          : newValue[0] || null; // Store first element or null for other types

        await tx.mutate.form_entity_values.update({
          id: formEntityValueId,
          actualFieldValue: valueToStore,
          updatedAt,
        });
      },
    ),
  },
  dashboard: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        createdBy: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, name, description, createdBy, timestamp } }) => {
        const now = timestamp;

        const existingDashboard = await tx.run(zql.dashboards.where('id', id).one());

        await tx.mutate.dashboards.upsert({
          id: id,
          name: name.trim(),
          description: description?.trim(),
          createdBy: existingDashboard?.createdBy ?? createdBy,
          updatedAt: now,
          createdAt: existingDashboard?.createdAt ?? now,
        });
      },
    ),
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, args: { id } }) => {
        const mappings = await tx.run(zql.dashboard_queries_mapping.where('dashboardId', id));
        for (const mapping of mappings) {
          await tx.mutate.dashboard_queries_mapping.delete({ id: mapping.id });
          await tx.mutate.queries.delete({ id: mapping.queryId });
        }
        await tx.mutate.dashboards.delete({ id });
      },
    ),
  },
  query: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        title: z.string(),
        queryJson: z.any(),
        entityType: z.nativeEnum(FormEntityType),
        dashboardId: z.string().optional(),
        createdBy: z.string(),
        timestamp: z.number(),
        mappingId: z.string().optional(),
      }),
      async ({
        tx,
        args: { id, title, queryJson, entityType, dashboardId, createdBy, timestamp, mappingId },
      }) => {
        const now = timestamp;

        const existingQuery = await tx.run(zql.queries.where('id', id).one());

        await tx.mutate.queries.upsert({
          id: id,
          title: title.trim(),
          queryJson: queryJson as ReadonlyJSONValue,
          entityType,
          createdBy: existingQuery?.createdBy ?? createdBy,
          updatedAt: now,
          createdAt: existingQuery?.createdAt ?? now,
        });

        // If dashboardId is provided, create the mapping
        if (dashboardId) {
          // Check for duplicate mapping
          const duplicate = await tx.run(
            zql.dashboard_queries_mapping
              .where('dashboardId', dashboardId)
              .where('queryId', id)
              .one(),
          );
          if (!duplicate) {
            const newMappingId = mappingId;
            if (!newMappingId) {
              throw new Error('mappingId is required when creating a new dashboard query mapping');
            }
            await tx.mutate.dashboard_queries_mapping.insert({
              id: newMappingId,
              dashboardId,
              queryId: id,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      },
    ),
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, args: { id } }) => {
        const mappings = await tx.run(zql.dashboard_queries_mapping.where('queryId', id));
        for (const mapping of mappings) {
          await tx.mutate.dashboard_queries_mapping.delete({ id: mapping.id });
        }
        await tx.mutate.queries.delete({ id });
      },
    ),
  },
  emailDraft: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        channelId: z.string(),
        draftContent: z.string(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, conversationId, channelId, draftContent, updatedAt } }) => {
        const existing = await tx.run(
          zql.email_drafts
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          await tx.mutate.email_drafts.update({ id: existing.id, draftContent, updatedAt });
        } else {
          await tx.mutate.email_drafts.insert({
            id,
            conversationId,
            channelId,
            userId: ctx.userID,
            draftContent,
            createdAt: updatedAt,
            updatedAt,
          });
        }
      },
    ),
    delete: defineMutator(
      z.object({
        conversationId: z.string(),
      }),
      async ({ tx, ctx, args: { conversationId } }) => {
        const existing = await tx.run(
          zql.email_drafts
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          await tx.mutate.email_drafts.delete({ id: existing.id });
        }
      },
    ),
  },
  userPreference: {
    setChannelSortOrder: defineMutator(
      z.object({
        id: z.string(),
        channelSortOrder: z.nativeEnum(ChannelSortOrder),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, channelSortOrder, timestamp } }) => {
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            channelSortOrder,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            id,
            userId: ctx.userID,
            channelSortOrder,
            enterSendsMessage: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    setEnterSendsMessage: defineMutator(
      z.object({
        id: z.string(),
        enterSendsMessage: z.boolean(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, enterSendsMessage, timestamp } }) => {
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            enterSendsMessage,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
  },

  emailChannelPreference: {
    upsert: defineMutator(
      z.object({
        channelId: z.string(),
        ownerUserId: z.string().optional(),
        assigneeUserGroupId: z.string().optional().nullable(),
        sendAsEmail: z.string().optional().nullable(),
        defaultCc: z.string().optional().nullable(),
      }),
      async ({ tx, ctx, args: { channelId, ownerUserId, assigneeUserGroupId, sendAsEmail, defaultCc } }) => {
        const existing = await tx.run(
          zql.email_channel_preferences.where('channelId', channelId).one(),
        );
        if (existing) {
          await tx.mutate.email_channel_preferences.update({
            channelId,
            ...(ownerUserId !== undefined ? { ownerUserId } : {}),
            ...(assigneeUserGroupId !== undefined ? { assigneeUserGroupId } : {}),
            ...(sendAsEmail !== undefined ? { sendAsEmail } : {}),
            ...(defaultCc !== undefined ? { defaultCc } : {}),
          });
        } else {
          await tx.mutate.email_channel_preferences.insert({
            channelId,
            ownerUserId: ownerUserId ?? ctx.userID,
            assigneeUserGroupId: assigneeUserGroupId ?? null,
            sendAsEmail: sendAsEmail ?? null,
            classificationEnabled: false,
            defaultCc: defaultCc ?? null,
          });
        }
      },
    ),
    upsertClassificationConfig: defineMutator(
      z.object({
        channelId: z.string(),
        classificationEnabled: z.boolean(),
        classificationPrompt: z.string(),
        categoryField: z.string(),
        subCategoryField: z.string().optional().nullable(),
      }),
      async ({ tx, ctx, args }) => {
        const { channelId, classificationEnabled, classificationPrompt, categoryField, subCategoryField } = args;
        const existing = await tx.run(
          zql.email_channel_preferences.where('channelId', channelId).one(),
        );
        if (existing) {
          await tx.mutate.email_channel_preferences.update({
            channelId,
            classificationEnabled,
            classificationPrompt,
            categoryField,
            subCategoryField: subCategoryField ?? null,
          });
        } else {
          await tx.mutate.email_channel_preferences.insert({
            channelId,
            ownerUserId: ctx.userID,
            classificationEnabled,
            classificationPrompt,
            categoryField,
            subCategoryField: subCategoryField ?? null,
          });
        }
      },
    ),
  },

  classificationMapping: {
    create: defineMutator(
      z.object({
        id: z.string(),
        channelId: z.string(),
        category: z.string(),
        subCategory: z.string().optional().nullable(),
        userGroupId: z.string(),
        createdAt: z.number(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.classification_mappings.insert(args);
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        category: z.string().optional(),
        subCategory: z.string().optional().nullable(),
        userGroupId: z.string().optional(),
      }),
      async ({ tx, args: { id, ...fields } }) => {
        await tx.mutate.classification_mappings.update({ id, ...fields });
      },
    ),
    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, args: { id } }) => {
        await tx.mutate.classification_mappings.delete({ id });
      },
    ),
  },

  boardSlaPolicy: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        boardId: z.string(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
        responseHours: z.number().min(0),
        resolutionHours: z.number().min(0),
        businessHoursOnly: z.boolean(),
        timezone: z.string(),
        workdayStart: z.number().int().min(0).max(23),
        workdayEnd: z.number().int().min(1).max(24),
        isActive: z.boolean(),
      }),
      async ({
        tx,
        args: { id, boardId, priority, responseHours, resolutionHours, businessHoursOnly, timezone, workdayStart, workdayEnd, isActive },
      }) => {
        const now = Date.now();
        const existing = await tx.run(
          zql.board_sla_policies
            .where('boardId', boardId)
            .where('priority', priority as TicketPriority)
            .one(),
        );
        if (existing) {
          await tx.mutate.board_sla_policies.update({
            id: existing.id,
            responseHours,
            resolutionHours,
            businessHoursOnly,
            timezone,
            workdayStart,
            workdayEnd,
            isActive,
            updatedAt: now,
          });
        } else {
          await tx.mutate.board_sla_policies.insert({
            id,
            boardId,
            priority: priority as TicketPriority,
            responseHours,
            resolutionHours,
            businessHoursOnly,
            timezone,
            workdayStart,
            workdayEnd,
            isActive,
            createdAt: now,
            updatedAt: now,
          });
        }
      },
    ),
    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, args: { id } }) => {
        await tx.mutate.board_sla_policies.update({ id, isActive: false, updatedAt: Date.now() });
      },
    ),
  },

  emailRead: {
    markAsRead: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        lastReadEmailId: z.string(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, ticketId, lastReadEmailId, updatedAt } }) => {
        const existing = await tx.run(
          zql.email_reads
            .where('ticketId', ticketId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          if (existing.lastReadEmailId !== lastReadEmailId) {
            await tx.mutate.email_reads.update({
              id: existing.id,
              lastReadEmailId,
              updatedAt,
            });
          }
        } else {
          await tx.mutate.email_reads.insert({
            id,
            ticketId,
            userId: ctx.userID,
            lastReadEmailId,
            createdAt: updatedAt,
            updatedAt,
          });
        }
      },
    ),

    bulkMarkAsRead: defineMutator(
      z.object({
        items: z.array(
          z.object({
            id: z.string(),
            ticketId: z.string(),
            lastReadEmailId: z.string(),
          }),
        ),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { items, timestamp } }) => {
        if (items.length === 0) return;

        const ticketIds = items.map(i => i.ticketId);
        const existing = await tx.run(
          zql.email_reads
            .where('userId', ctx.userID)
            .where(h => h.cmp('ticketId', 'IN', ticketIds)),
        );
        const existingByTicket = new Map(existing.map(e => [e.ticketId, e]));

        await Promise.all(
          items.map(item => {
            const ex = existingByTicket.get(item.ticketId);
            if (ex) {
              if (ex.lastReadEmailId === item.lastReadEmailId) return;
              return tx.mutate.email_reads.update({
                id: ex.id,
                lastReadEmailId: item.lastReadEmailId,
                updatedAt: timestamp,
              });
            }
            return tx.mutate.email_reads.insert({
              id: item.id,
              ticketId: item.ticketId,
              userId: ctx.userID,
              lastReadEmailId: item.lastReadEmailId,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }),
        );
      },
    ),
  },

  cleanupStageApprovals: defineMutator(
    z.object({
      ticketId: z.string(),
      fromSequenceNumber: z.number(),
    }),
    async ({ tx, args: { ticketId, fromSequenceNumber } }) => {
      // Get all stages for this ticket's board
      const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const boardStages = await tx.run(zql.stages.where('boardId', ticket.boardId));
      const stagesToDelete = boardStages.filter(s => s.sequenceNumber > fromSequenceNumber);

      if (stagesToDelete.length === 0) {
        return;
      }

      const stageIdsToDelete = stagesToDelete.map(s => s.id);

      // Delete ticket stage requests for stages being moved past
      const requestsToDelete = await tx.run(
        zql.ticket_stage_requests
          .where('ticketId', ticketId)
          .where(helpers =>
            helpers.or(...stageIdsToDelete.map(stageId => helpers.cmp('stageId', stageId))),
          ),
      );

      for (const request of requestsToDelete) {
        await tx.mutate.ticket_stage_requests.delete({ id: request.id });
      }
    },
  ),
  resourceAccess: {
    grant: defineMutator(
      z.object({
        grants: z.array(
          z.object({
            id: z.string(),
            userId: z.string(),
            resourceId: z.string(),
            accessType: z.nativeEnum(AccessType),
          }),
        ),
        timestamp: z.number(),
      }),
      async ({ tx, args: { grants, timestamp } }) => {
        for (const grant of grants) {
          await tx.mutate.resource_access.insert({
            id: grant.id,
            userId: grant.userId,
            resourceId: grant.resourceId,
            accessType: grant.accessType as AccessType,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    revoke: defineMutator(
      z.object({
        ids: z.array(z.string()),
      }),
      async ({ tx, args: { ids } }) => {
        for (const id of ids) {
          await tx.mutate.resource_access.delete({ id });
        }
      },
    ),
    update: defineMutator(
      z.object({
        updates: z.array(
          z.object({
            id: z.string(),
            accessType: z.nativeEnum(AccessType),
          }),
        ),
        timestamp: z.number(),
      }),
      async ({ tx, args: { updates, timestamp } }) => {
        for (const update of updates) {
          await tx.mutate.resource_access.update({
            id: update.id,
            accessType: update.accessType as AccessType,
            updatedAt: timestamp,
          });
        }
      },
    ),
  },

  rca: {
    create: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        ownerId: z.string().optional(),
        title: z.string(),
        summary: z.string().optional(),
        rootCause: z.string().optional(),
        severity: z.nativeEnum(SEVERITY),
        bugTypeId: z.string(),
        categoryTypeId: z.string(),
        issueCategoryId: z.string().optional(),
        issueStartAt: z.number().optional().nullable(),
        status: z.nativeEnum(RCAStatus),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          ticketId,
          ownerId,
          title,
          summary,
          rootCause,
          severity,
          bugTypeId,
          categoryTypeId,
          issueCategoryId,
          issueStartAt,
          status,
          timestamp,
        },
      }) => {
        const resolvedOwnerId = ownerId || ctx.userID;

        await tx.mutate.rcas.insert({
          id,
          ticketId,
          ownerId: resolvedOwnerId,
          title,
          summary: summary || null,
          rootCause: rootCause || null,
          severity,
          bugTypeId,
          categoryTypeId,
          issueCategoryId: issueCategoryId ?? null,
          issueStartAt: issueStartAt ?? null,
          status,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        rootCause: z.string().optional(),
        severity: z.nativeEnum(SEVERITY).optional(),
        bugTypeId: z.string().optional(),
        categoryTypeId: z.string().optional(),
        issueCategoryId: z.string().optional(),
        issueStartAt: z.number().optional().nullable(),
        status: z.nativeEnum(RCAStatus).optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        args: {
          id,
          ticketId,
          title,
          summary,
          rootCause,
          severity,
          bugTypeId,
          categoryTypeId,
          issueCategoryId,
          issueStartAt,
          status,
          timestamp,
        },
      }) => {
        const rca = await tx.run(zql.rcas.where('id', id).one());
        if (!rca) {
          throw new Error('RCA not found');
        }

        await tx.mutate.rcas.update({
          id,
          ...(ticketId !== undefined && { ticketId }),
          ...(title !== undefined && { title }),
          ...(summary !== undefined && { summary }),
          ...(rootCause !== undefined && { rootCause }),
          ...(severity !== undefined && { severity }),
          ...(bugTypeId !== undefined && { bugTypeId }),
          ...(categoryTypeId !== undefined && { categoryTypeId }),
          ...(issueCategoryId !== undefined && { issueCategoryId }),
          ...(issueStartAt !== undefined && { issueStartAt }),
          ...(status !== undefined && { status }),
          updatedAt: timestamp,
        });
      },
    ),
  },
  recap: {
    saveSubscriptions: defineMutator(
      z.object({
        channelIds: z.array(z.string()),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelIds, timestamp } }) => {
        // Get existing channel user status for this user
        const existingStatuses = await tx.run(
          zql.channel_user_status.where('userId', ctx.userID).where('isDeleted', false),
        );

        const newChannelIds = new Set(channelIds);

        // Update isRecapSubscribed based on selection
        for (const status of existingStatuses) {
          const shouldSubscribe = newChannelIds.has(status.channelId);
          if (status.isRecapSubscribed !== shouldSubscribe) {
            await tx.mutate.channel_user_status.update({
              id: status.id,
              isRecapSubscribed: shouldSubscribe,
              updatedAt: timestamp,
            });
          }
        }
      },
    ),
    markSeen: defineMutator(
      z.object({
        recapDate: z.number(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { recapDate, timestamp } }) => {
        // Update all subscribed channel user statuses for this user with the seen date
        const statuses = await tx.run(
          zql.channel_user_status
            .where('userId', ctx.userID)
            .where('isRecapSubscribed', true)
            .where('isDeleted', false),
        );

        for (const status of statuses) {
          // Only update if the new date is more recent
          if (status.lastSeenRecapDate === null || status.lastSeenRecapDate < recapDate) {
            await tx.mutate.channel_user_status.update({
              id: status.id,
              lastSeenRecapDate: recapDate,
              updatedAt: timestamp,
            });
          }
        }
      },
    ),
    markChannelRecapAsRead: defineMutator(
      z.object({
        channelId: z.string(),
        recapDate: z.number(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, recapDate, timestamp } }) => {
        // Find the channel user status for this channel
        const status = await tx.run(
          zql.channel_user_status
            .where('userId', ctx.userID)
            .where('channelId', channelId)
            .where('isDeleted', false)
            .one(),
        );

        if (!status) {
          throw new Error('Channel user status not found for this channel');
        }

        // Only update if the new date is more recent
        if (status.lastSeenRecapDate === null || status.lastSeenRecapDate < recapDate) {
          await tx.mutate.channel_user_status.update({
            id: status.id,
            lastSeenRecapDate: recapDate,
            updatedAt: timestamp,
          });
        }
      },
    ),
    markChannelRecapAsUnread: defineMutator(
      z.object({
        channelId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, timestamp } }) => {
        // Find the channel user status for this channel
        const status = await tx.run(
          zql.channel_user_status
            .where('userId', ctx.userID)
            .where('channelId', channelId)
            .where('isDeleted', false)
            .one(),
        );

        if (!status) {
          throw new Error('Channel user status not found for this channel');
        }

        // Set lastSeenRecapDate to null to mark as unread
        await tx.mutate.channel_user_status.update({
          id: status.id,
          lastSeenRecapDate: null,
          updatedAt: timestamp,
        });
      },
    ),
    setCustomRecapPrompt: defineMutator(
      z.object({
        channelId: z.string(),
        prompt: z.string().nullable(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, prompt, timestamp: _timestamp } }) => {
        const status = await tx.run(
          zql.channel_user_status
            .where('userId', ctx.userID)
            .where('channelId', channelId)
            .where('isDeleted', false)
            .one(),
        );

        if (!status) {
          throw new Error('Channel user status not found for this channel');
        }

        await tx.mutate.channel_user_status.update({
          id: status.id,
          customRecapPrompt: prompt,
        });
      },
    ),
  },
  releaseAttribution: {
    create: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        releaseId: z.string(),
        releaseApplicationId: z.string().optional().nullable(),
        rootCauseTicketId: z.string().optional().nullable(),
        confidence: z.nativeEnum(AttributionConfidence),
        timestamp: z.number(),
      }),
      async ({
        tx,
        args: {
          id,
          ticketId,
          releaseId,
          releaseApplicationId,
          rootCauseTicketId,
          confidence,
          timestamp,
        },
      }) => {
        await tx.mutate.release_attributions.insert({
          id,
          ticketId,
          releaseId,
          releaseApplicationId: releaseApplicationId ?? null,
          rootCauseTicketId: rootCauseTicketId ?? null,
          confidence,
          createdAt: timestamp,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        releaseId: z.string().optional(),
        releaseApplicationId: z.string().optional().nullable(),
        rootCauseTicketId: z.string().optional().nullable(),
        confidence: z.nativeEnum(AttributionConfidence).optional(),
      }),
      async ({
        tx,
        args: { id, releaseId, releaseApplicationId, rootCauseTicketId, confidence },
      }) => {
        await tx.mutate.release_attributions.update({
          id,
          ...(releaseId !== undefined && { releaseId }),
          ...(releaseApplicationId !== undefined && { releaseApplicationId }),
          ...(rootCauseTicketId !== undefined && { rootCauseTicketId }),
          ...(confidence !== undefined && { confidence }),
        });
      },
    ),
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args: { id } }) => {
      await tx.mutate.release_attributions.delete({ id });
    }),
  },
  impact: {
    create: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        impactTypeId: z.string(),
        impact: z.string(),
        rcaId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, ticketId, impactTypeId, impact, rcaId, timestamp } }) => {
        if (!rcaId) {
          throw new Error('RCA ID is required for creating an impact');
        }

        await tx.mutate.impacts.insert({
          id,
          ticketId,
          impactTypeId,
          impact,
          rcaId: rcaId || null,
          createdAt: timestamp,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        impactTypeId: z.string().optional(),
        impact: z.string().optional(),
      }),
      async ({ tx, args: { id, impactTypeId, impact } }) => {
        await tx.mutate.impacts.update({
          id,
          ...(impactTypeId !== undefined && { impactTypeId }),
          ...(impact !== undefined && { impact }),
        });
      },
    ),
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, args: { id } }) => {
        await tx.mutate.impacts.delete({ id });
      },
    ),
  },
  coe: {
    create: defineMutator(
      z.object({
        id: z.string(),
        rcaId: z.string(),
        ownerId: z.string(),
        actionTypeId: z.string(),
        action: z.string(),
        status: z.nativeEnum(COEStatus),
        dueDate: z.number().optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        args: { id, rcaId, ownerId, actionTypeId, action, status, dueDate, timestamp },
      }) => {
        await tx.mutate.coes.insert({
          id,
          rcaId,
          ownerId,
          actionTypeId,
          action,
          status,
          dueDate: dueDate || null,
          createdAt: timestamp,
          completedAt: null,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        ownerId: z.string().optional(),
        actionTypeId: z.string().optional(),
        action: z.string().optional(),
        status: z.nativeEnum(COEStatus).optional(),
        dueDate: z.number().optional(),
        completedAt: z.number().optional(),
      }),
      async ({ tx, args: { id, ownerId, actionTypeId, action, status, dueDate, completedAt } }) => {
        await tx.mutate.coes.update({
          id,
          ...(ownerId !== undefined && { ownerId }),
          ...(actionTypeId !== undefined && { actionTypeId }),
          ...(action !== undefined && { action }),
          ...(status !== undefined && { status }),
          ...(dueDate !== undefined && { dueDate }),
          ...(completedAt !== undefined && { completedAt }),
        });
      },
    ),
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, args: { id } }) => {
        await tx.mutate.coes.delete({ id });
      },
    ),
  },
  savedUserConfiguration: {
    create: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        contextType: z.nativeEnum(SavedConfigContextType),
        contextId: z.string(),
        channelId: z.string(),
        visibility: z.nativeEnum(SavedConfigVisibility),
        timestamp: z.number(),
        values: z.array(
          z.object({
            id: z.string(),
            entityName: z.nativeEnum(SavedConfigEntityName),
            fieldName: z.string(),
            fieldValue: z.string(),
          }),
        ),
      }),
      async ({
        tx,
        ctx,
        args: { id, name, contextType, contextId, visibility, timestamp, values },
      }) => {
        const allUserConfigs = await tx.run(
          zql.saved_user_configurations.where('userId', ctx.userID).where('contextId', contextId),
        );
        if (allUserConfigs.some(c => c.name.toLowerCase() === name.toLowerCase())) {
          throw new Error('A saved view with this name already exists for this board');
        }

        await tx.mutate.saved_user_configurations.insert({
          id,
          userId: ctx.userID,
          name,
          contextType,
          contextId,
          visibility,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        for (const value of values) {
          await tx.mutate.saved_user_configuration_values.insert({
            id: value.id,
            configId: id,
            entityName: value.entityName,
            fieldName: value.fieldName,
            fieldValue: value.fieldValue,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    update: defineMutator(
      z.object({
        configId: z.string(),
        name: z.string().min(1).optional(),
        visibility: z.nativeEnum(SavedConfigVisibility).optional(),
        timestamp: z.number(),
        values: z
          .array(
            z.object({
              id: z.string(),
              entityName: z.nativeEnum(SavedConfigEntityName),
              fieldName: z.string(),
              fieldValue: z.string(),
            }),
          )
          .optional(),
      }),
      async ({ tx, ctx, args: { configId, name, visibility, timestamp, values } }) => {
        const config = await tx.run(zql.saved_user_configurations.where('id', configId).one());
        if (!config) {
          throw new Error('Saved view not found');
        }
        if (config.userId !== ctx.userID) {
          throw new Error('You can only edit your own saved views');
        }

        if (name && name.toLowerCase() !== config.name.toLowerCase()) {
          const allUserConfigs = await tx.run(
            zql.saved_user_configurations
              .where('userId', ctx.userID)
              .where('contextId', config.contextId),
          );
          if (
            allUserConfigs.some(
              c => c.id !== configId && c.name.toLowerCase() === name.toLowerCase(),
            )
          ) {
            throw new Error('A saved view with this name already exists for this board');
          }
        }

        await tx.mutate.saved_user_configurations.update({
          id: configId,
          ...(name !== undefined && { name }),
          ...(visibility !== undefined && { visibility }),
          updatedAt: timestamp,
        });

        if (values) {
          const existingValues = await tx.run(
            zql.saved_user_configuration_values.where('configId', configId),
          );
          for (const existing of existingValues) {
            await tx.mutate.saved_user_configuration_values.delete({ id: existing.id });
          }
          for (const value of values) {
            await tx.mutate.saved_user_configuration_values.insert({
              id: value.id,
              configId,
              entityName: value.entityName,
              fieldName: value.fieldName,
              fieldValue: value.fieldValue,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
        }
      },
    ),
    delete: defineMutator(
      z.object({
        configId: z.string(),
      }),
      async ({ tx, ctx, args: { configId } }) => {
        const config = await tx.run(zql.saved_user_configurations.where('id', configId).one());
        if (!config) {
          throw new Error('Saved view not found');
        }
        if (config.userId !== ctx.userID) {
          throw new Error('You can only delete your own saved views');
        }

        const existingValues = await tx.run(
          zql.saved_user_configuration_values.where('configId', configId),
        );
        for (const value of existingValues) {
          await tx.mutate.saved_user_configuration_values.delete({ id: value.id });
        }

        await tx.mutate.saved_user_configurations.delete({ id: configId });
      },
    ),
  },
  apps: {
    update: defineMutator(
      z.object({
        appId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        webhookUrl: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { appId, name, description, webhookUrl, timestamp } }) => {
        const app = await tx.run(zql.apps.where('id', appId).one());
        if (!app) {
          throw new Error('App not found');
        }

        const updateData: {
          id: string;
          updatedAt: number;
          name?: string;
          description?: string | null;
        } = {
          id: appId,
          updatedAt: timestamp,
        };

        if (name !== undefined) {
          updateData.name = name.trim();
        }
        if (description !== undefined) {
          updateData.description = description.trim() || null;
        }

        await tx.mutate.apps.update(updateData);

        // Update webhook URL in installed_apps table
        if (webhookUrl !== undefined) {
          const installations = await tx.run(zql.installed_apps.where('appId', appId));
          const firstInstallation = installations[0];
          if (firstInstallation) {
            const installedAppUpdateData: {
              id: string;
              updatedAt: number;
              webhookUrl?: string | null;
            } = {
              id: firstInstallation.id,
              updatedAt: timestamp,
            };
            if (webhookUrl !== undefined) {
              installedAppUpdateData.webhookUrl = webhookUrl.trim() || null;
            }
            await tx.mutate.installed_apps.update(installedAppUpdateData);
          }
        }
      },
    ),
  },
  emailSignature: {
    create: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        content: z.string(),
        timestamp: z.number(),
        isDefault: z.boolean().optional(),
      }),
      async ({ tx, ctx, args: { id, name, content, timestamp, isDefault } }) => {
        if (isDefault) {
          const allSignatures = await tx.run(zql.email_signatures.where('userId', ctx.userID));
          for (const sig of allSignatures) {
            if (sig.isDefault) {
              await tx.mutate.email_signatures.update({
                id: sig.id,
                isDefault: false,
                updatedAt: timestamp,
              });
            }
          }
        }

        await tx.mutate.email_signatures.insert({
          id,
          userId: ctx.userID,
          name,
          content,
          isDefault: isDefault ?? false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        content: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, content, timestamp } }) => {
        const existing = await tx.run(
          zql.email_signatures.where('id', id).where('userId', ctx.userID).one(),
        );
        if (!existing) {
          throw new Error('Email signature not found');
        }
        await tx.mutate.email_signatures.update({
          id,
          name,
          content,
          updatedAt: timestamp,
        });
      },
    ),
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, ctx, args: { id } }) => {
        const existing = await tx.run(
          zql.email_signatures.where('id', id).where('userId', ctx.userID).one(),
        );
        if (!existing) {
          throw new Error('Email signature not found');
        }
        await tx.mutate.email_signatures.delete({ id });
      },
    ),
    setDefault: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const existing = await tx.run(
          zql.email_signatures.where('id', id).where('userId', ctx.userID).one(),
        );
        if (!existing) {
          throw new Error('Email signature not found');
        }
        const allSignatures = await tx.run(zql.email_signatures.where('userId', ctx.userID));
        for (const sig of allSignatures) {
          if (sig.isDefault && sig.id !== id) {
            await tx.mutate.email_signatures.update({
              id: sig.id,
              isDefault: false,
              updatedAt: timestamp,
            });
          }
        }
        await tx.mutate.email_signatures.update({
          id,
          isDefault: true,
          updatedAt: timestamp,
        });
      },
    ),
  },
  workspace: {
    update: defineMutator(
      z.object({
        workspaceId: z.string(),
        timestamp: z.number(),
        updates: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
        }),
      }),
      async ({ tx, args: { workspaceId, timestamp, updates } }) => {
        await tx.mutate.workspaces.update({
          id: workspaceId,
          ...updates,
          updatedAt: timestamp,
        });
      },
    ),
  },
  users: {
    updateRole: defineMutator(
      z.object({
        workspaceId: z.string(),
        userId: z.string(),
        updates: z.object({
          role: z.enum([WorkspaceRole.ADMIN, WorkspaceRole.MEMBER]).optional(),
        }),
        timestamp: z.number(),
      }),
      async ({ tx, args: { userId, updates, timestamp } }) => {
        await tx.mutate.users.update({
          id: userId,
          ...updates,
          updatedAt: timestamp,
        });
      },
    ),
    remove: defineMutator(
      z.object({
        workspaceId: z.string(),
        userId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { userId, timestamp } }) => {
        await tx.mutate.users.update({
          id: userId,
          leftAt: timestamp,
        });
      },
    ),
  },
  org: {
    create: defineMutator(
      z.object({
        orgId: z.string(),
        orgName: z.string(),
        orgDescription: z.string().optional(),
        workspaceId: z.string(),
        workspaceOrgId: z.string(),
        memberId: z.string(),
        creatorEmail: z.string(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          orgId,
          orgName,
          orgDescription,
          workspaceId,
          workspaceOrgId,
          memberId,
          creatorEmail,
          timestamp,
        },
      }) => {
        // Insert organization
        await tx.mutate.organizations.insert({
          orgId,
          name: orgName,
          description: orgDescription || '',
          status: Status.ACTIVE,
          createdBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        // Link to workspace with ADMIN role
        await tx.mutate.workspace_organizations.insert({
          id: workspaceOrgId,
          workspaceId,
          orgId,
          role: WorkspaceRole.ADMIN,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        // Add the creator as an OrgMember with OWNER role (identified by email)
        await tx.mutate.org_members.insert({
          memberId,
          orgId,
          email: creatorEmail,
          role: OrgRole.OWNER,
          joinedAt: timestamp,
          userId: 'deprecated-placeholder', // Deprecated field, kept for backward compatibility
        });
      },
    ),
  },
  workspaceOrg: {
    add: defineMutator(
      z.object({
        workspaceId: z.string(),
        orgId: z.string(),
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { workspaceId, orgId, id, timestamp } }) => {
        // Check if there's a previously removed entry
        const existing = await tx.run(
          zql.workspace_organizations.where('workspaceId', workspaceId).where('orgId', orgId).one(),
        );

        if (existing) {
          // Reactivate the existing entry by clearing leftAt
          await tx.mutate.workspace_organizations.update({
            id: existing.id,
            leftAt: null,
            updatedAt: timestamp,
          });
        } else {
          // Create new entry
          await tx.mutate.workspace_organizations.insert({
            id,
            workspaceId,
            orgId,
            role: WorkspaceRole.MEMBER,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    remove: defineMutator(
      z.object({
        workspaceId: z.string(),
        orgId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { workspaceId, orgId, timestamp } }) => {
        const link = await tx.run(
          zql.workspace_organizations
            .where('workspaceId', workspaceId)
            .where('orgId', orgId)
            .where('leftAt', 'IS', null)
            .one(),
        );
        if (link) {
          await tx.mutate.workspace_organizations.update({
            id: link.id,
            leftAt: timestamp,
          });
        }
      },
    ),
  },
  invitation: {
    revoke: defineMutator(
      z.object({
        invitationId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { invitationId, timestamp } }) => {
        await tx.mutate.invitations.update({
          id: invitationId,
          expiredAt: timestamp,
        });
      },
    ),
  },
  orgMember: {
    add: defineMutator(
      z.object({
        memberId: z.string(),
        orgId: z.string(),
        email: z.string(),
        role: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { memberId, orgId, email, role, timestamp } }) => {
        // Reactivate a previously soft-deleted membership if one exists (matched by email)
        const existing = await tx.run(
          zql.org_members.where('orgId', orgId).where('email', email).one(),
        );
        if (existing) {
          await tx.mutate.org_members.update({
            memberId: existing.memberId,
            leftAt: null,
            joinedAt: timestamp,
          });
        } else {
          await tx.mutate.org_members.insert({
            memberId,
            orgId,
            email,
            role: role as OrgRole,
            joinedAt: timestamp,
            userId: 'deprecated-placeholder', // Deprecated field, kept for backward compatibility
          });
        }
      },
    ),
    remove: defineMutator(
      z.object({
        memberId: z.string(),
        timestamp: z.number(),
      }),
      // Soft-delete: set leftAt so the member is excluded from active queries
      async ({ tx, args: { memberId, timestamp } }) => {
        await tx.mutate.org_members.update({
          memberId,
          leftAt: timestamp,
        });
      },
    ),
  },

  delayedMessages: {
    /** Create a new scheduled message */
    create: defineMutator(
      z.object({
        id: z.string(),
        channelId: z.string(),
        conversationId: z.string().optional(),
        content: z.string(),
        scheduledFor: z.number(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { id, channelId, conversationId, content, scheduledFor, timestamp },
      }) => {
        if (scheduledFor <= Date.now()) {
          throw new Error('Scheduled time must be in the future');
        }

        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }
        if (channel.isArchived) {
          throw new Error('Channel is archived');
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!participant) {
          throw new Error('You are not a member of this channel');
        }

        const channelDrafts = await tx.run(
          zql.draft_messages
            .where("channelId", channelId)
            .where("userId", ctx.userID),
        );
        const existingDraft = channelDrafts.find(
          (d) =>
            d.conversationId === (conversationId ?? null) &&
            d.messageId === null,
        );

        const scheduledAttachments = existingDraft
          ? await tx.run(
              zql.message_attachments
                .where("entityId", existingDraft.id)
                .where("entityType", AttachmentEntityType.DRAFT),
            )
          : [];

        if (content.trim() === '' && scheduledAttachments.length === 0) {
          throw new Error('Message content is required');
        }

        const scheduleId = existingDraft?.id ?? id;

        await tx.mutate.delayed_messages.insert({
          id: scheduleId,
          channelId,
          conversationId: conversationId ?? null,
          senderId: ctx.userID,
          content: content.trim(),
          hasAttachment: scheduledAttachments.length > 0,
          scheduledFor,
          status: DelayedMessageStatus.PENDING,
          failureReason: null,
          sentAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        if (existingDraft) {
          await tx.mutate.draft_messages.delete({ id: existingDraft.id });
        }

        if (scheduledAttachments.length > 0) {
          for (const att of scheduledAttachments) {
            await tx.mutate.message_attachments.update({
              id: att.id,
              entityType: AttachmentEntityType.DELAYED_MESSAGE,
            });
          }
        }
      },
    ),

    /** Cancel a pending scheduled message */
    cancel: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const scheduled = await tx.run(
          zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one(),
        );

        if (!scheduled) {
          throw new Error('Scheduled message not found');
        }

        if (scheduled.status !== DelayedMessageStatus.PENDING) {
          throw new Error(`Cannot cancel a message with status: ${scheduled.status}`);
        }

        await tx.mutate.delayed_messages.update({
          id,
          status: DelayedMessageStatus.CANCELLED,
          updatedAt: timestamp,
        });
      },
    ),

    /** Update the scheduled time for a pending message */
    reschedule: defineMutator(
      z.object({
        id: z.string(),
        scheduledFor: z.number(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, scheduledFor, timestamp } }) => {
        if (scheduledFor <= Date.now()) {
          throw new Error('Scheduled time must be in the future');
        }

        const scheduled = await tx.run(
          zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one(),
        );

        if (!scheduled) {
          throw new Error('Scheduled message not found');
        }

        if (scheduled.status !== DelayedMessageStatus.PENDING) {
          throw new Error(`Cannot reschedule a message with status: ${scheduled.status}`);
        }

        await tx.mutate.delayed_messages.update({
          id,
          scheduledFor,
          updatedAt: timestamp,
        });
      },
    ),

    /** Edit the content of a pending scheduled message */
    edit: defineMutator(
      z.object({
        id: z.string(),
        content: z.string().min(1),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, content, updatedAt } }) => {
        const scheduled = await tx.run(
          zql.delayed_messages
            .where("id", id)
            .where("senderId", ctx.userID)
            .one(),
        );

        if (!scheduled) {
          throw new Error("Scheduled message not found");
        }

        if (scheduled.status !== DelayedMessageStatus.PENDING) {
          throw new Error(
            `Cannot edit a message with status: ${scheduled.status}`,
          );
        }

        if (scheduled.updatedAt !== updatedAt) {
          throw new Error(
            "Message was modified by another operation. Please refresh and try again.",
          );
        }

        await tx.mutate.delayed_messages.update({
          id,
          content: content.trim(),
          updatedAt,
        });
      },
    ),

    /** Convert a pending scheduled message to a draft */
    convertToDraft: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const scheduled = await tx.run(
          zql.delayed_messages
            .where("id", id)
            .where("senderId", ctx.userID)
            .one(),
        );

        if (!scheduled) {
          throw new Error("Scheduled message not found");
        }

        if (scheduled.status !== DelayedMessageStatus.PENDING) {
          throw new Error(
            `Cannot convert a message with status: ${scheduled.status} to draft`,
          );
        }

        const channelDrafts = await tx.run(
          zql.draft_messages
            .where("channelId", scheduled.channelId)
            .where("userId", ctx.userID),
        );
        const existingDraft = channelDrafts.find(
          (d) =>
            d.conversationId === (scheduled.conversationId ?? null) &&
            d.messageId === null,
        );

        const scheduledAttachments = await tx.run(
          zql.message_attachments
            .where("entityId", id)
            .where("entityType", AttachmentEntityType.DELAYED_MESSAGE),
        );
        const hasAttachment = scheduledAttachments.length > 0;

        if (existingDraft) {
          const existingAttachments = await tx.run(
            zql.message_attachments
              .where("entityId", existingDraft.id)
              .where("entityType", AttachmentEntityType.DRAFT),
          );
          for (const attachment of existingAttachments) {
            await tx.mutate.message_attachments.delete({ id: attachment.id });
          }
          await tx.mutate.draft_messages.delete({ id: existingDraft.id });
        }

        await tx.mutate.delayed_messages.delete({ id });

        await tx.mutate.draft_messages.insert({
          id,
          channelId: scheduled.channelId,
          conversationId: scheduled.conversationId,
          userId: ctx.userID,
          content: scheduled.content,
          hasAttachment,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        for (const att of scheduledAttachments) {
          await tx.mutate.message_attachments.update({
            id: att.id,
            entityType: AttachmentEntityType.DRAFT,
          });
        }
      },
    ),

    /** Send a pending scheduled message immediately */
    sendNow: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const scheduled = await tx.run(
          zql.delayed_messages
            .where("id", id)
            .where("senderId", ctx.userID)
            .one(),
        );

        if (!scheduled) {
          throw new Error("Scheduled message not found");
        }

        if (scheduled.status !== DelayedMessageStatus.PENDING) {
          throw new Error(
            `Cannot send now a message with status: ${scheduled.status}`,
          );
        }

        await tx.mutate.delayed_messages.update({
          id,
          updatedAt: timestamp,
          status: DelayedMessageStatus.SENDING,
        });
      },
    ),
  },

  draftMessages: {
    /** Delete a draft message by ID (only the owner can delete their own draft) */
    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        const draft = await tx.run(
          zql.draft_messages.where("id", id).where("userId", ctx.userID).one(),
        );
        if (!draft) {
          throw new Error("Draft not found");
        }
        await tx.mutate.draft_messages.delete({ id });
      },
    ),

    /** Edit a draft message content */
    edit: defineMutator(
      z.object({
        id: z.string(),
        content: z.string().min(1),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, content, timestamp } }) => {
        const draft = await tx.run(
          zql.draft_messages.where("id", id).where("userId", ctx.userID).one(),
        );
        if (!draft) {
          throw new Error("Draft not found");
        }
        await tx.mutate.draft_messages.update({
          id,
          content: content.trim(),
          updatedAt: timestamp,
        });
      },
    ),

    /** Send a draft message immediately (converts to sent message) */
    send: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id } }) => {
        const draft = await tx.run(
          zql.draft_messages.where("id", id).where("userId", ctx.userID).one(),
        );
        if (!draft) {
          throw new Error("Draft not found");
        }
        if (draft.content.trim() === "") {
          const draftAtts = await tx.run(
            zql.message_attachments
              .where("entityId", id)
              .where("entityType", AttachmentEntityType.DRAFT),
          );
          if (draftAtts.length === 0) {
            throw new Error("Cannot send empty draft");
          }
        }
        // Full implementation in backend - this validates and deletes draft
        await tx.mutate.draft_messages.delete({ id });
      },
    ),
  },
});
