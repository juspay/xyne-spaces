import { ReadonlyJSONValue, Transaction, defineMutator, defineMutators } from '@rocicorp/zero';
import {
  ChannelRole,
  ChannelVisibility,
  MessageType,
  CallType,
  CallStatus,
  InvitationResponse,
  Schema,
  ChannelScopeType,
  ConversationParticipation,
  TicketStatusV2,
  ActivityType,
  TicketReferenceRelation,
  CanvasVisibility,
  CanvasRole,
  BookmarkEntityType,
  UserPresenceStatus,
  FormContextType,
  FormEntityType,
  DocType,
  ActivityClassification,
  PRStatusEvent,
  UserResponsibility,
  AccessType,
  BoardType,
  TicketStageRequestStatus,
} from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { ConversationController } from "@/controllers/conversationController";
import { generatePlainTextContent } from "@/utils/contentUtils";
import { extractAllMentions } from '@/utils/mentionParser';
import { gcsService } from '@/services/gcsService';
import { repositories } from '@/database/repositories';
import { sendAddAndRemoveParticipantsSystemMessage, sendCallSystemMessage, updateCallSystemMessageOnEnd } from '@/zero/utils/systemMessagesUtils';
import { addChannelParticipant, removeChannelParticipant } from '@/zero/utils/channelParticipantUtils';
import { convert } from 'html-to-text';
import { websocketService } from '@/services/websocketService';
import { typingService } from '@/services/typingService';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { logger } from '@/utils/logger';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { calculateETADeadline } from '@/utils/etaCalculation';

import {
  executionOrchestrator,
  unifiedDMService,
  unifiedBotUserService,
} from '@/bots/unified/index.js';
import { z } from 'zod';
import { zql } from './queries';
import { FormFieldType, MessageAttachment, createForwardedMessageXml, parseForwardedMessageXml, type BoardMetadata } from '@xyne/shared';

export type AuthData = {
  sub: string;
  email: string;
  name: string;
};

export type ParticipantOperationType = 'participants_added' | 'participants_removed' | 'participants_joined';

const conversationController = new ConversationController();

async function reopenClosedDmParticipants(
  tx: Transaction<Schema>,
  channelId: string,
  scopeType: string
): Promise<void> {
  const isDM =
    scopeType === ChannelScopeType.DM ||
    scopeType === ChannelScopeType.GROUP_DM;

  if (!isDM) return;

  const closedParticipants = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('isClosed', true));

  for (const participant of closedParticipants) {
    await tx.mutate.channel_user_status.update({
      id: participant.id,
      isClosed: false,
    });
  }
}

const formatTicketReferenceRelationLabel = (relationType: TicketReferenceRelation): string => {
  switch (relationType) {
    case TicketReferenceRelation.DUPLICATE_CONFIRMED:
      return 'Duplicate';
    case TicketReferenceRelation.DUPLICATE_POSSIBLE:
      return 'Possible duplicate';
    case TicketReferenceRelation.LINKED:
    default:
      return 'Linked';
  }
};

/**
 * Helper to sync workload mappings for users when ticket assignment changes
 */
async function syncUserWorkloadMapping(
  tx: Transaction<Schema>,
  userId: string,
  ticket: { userGroupId: string; boardId: string },
  createdBy: string
): Promise<void> {
  // Count active tickets for this user
  const userTickets = await tx.run(
    zql.tickets
      .where('assignedTo', userId)
      .where('boardId', ticket.boardId)
      .where('userGroupId', ticket.userGroupId)
  );

  const activeTasks = userTickets.filter(
    (t: any) => t.status === 'NEW' || t.status === 'IN_PROGRESS'
  ).length;

  const totalTasks = userTickets.length;

  // Check if mapping exists
  const existingMapping = await tx.run(
    zql.user_workload_mappings
      .where('userId', userId)
      .where('userGroupId', ticket.userGroupId)
      .where('boardId', ticket.boardId)
      .one()
  );

  if (existingMapping) {
    await tx.mutate.user_workload_mappings.update({
      id: existingMapping.id,
      activeTasks,
      totalTasks,
      updatedAt: Date.now(),
    });
  } else {
    await tx.mutate.user_workload_mappings.insert({
      id: uuidv4(),
      userId,
      userGroupId: ticket.userGroupId,
      boardId: ticket.boardId,
      activeTasks,
      totalTasks,
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

/**
 * Helper to create system messages for non-participant mentions within Zero transaction
 * This ensures the system messages are synced to all clients via Zero replication
 */
async function createNonParticipantSystemMessages(
  tx: Transaction<Schema>,
  mentionedUserIds: string[],
  mentionedGroupIds: string[],
  channelId: string,
  conversationId: string,
  senderId: string,
  isThreadReply: boolean,
  scopeType: string,
): Promise<void> {
  try {
    if (mentionedUserIds.length === 0 && mentionedGroupIds.length === 0) {
      return;
    }

    if (scopeType == ChannelScopeType.DM) {
      return
    }

    logger.info(`🔍 [NON-PARTICIPANT] Checking ${mentionedUserIds.length} users and ${mentionedGroupIds.length} groups in channel ${channelId}`);

    // Get channel and sender participation for role-based messaging
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    const senderParticipation = await tx.run(zql.channel_participants
      .where('channelId', channelId)
      .where('userId', senderId)
      .one());

    // Fetch group members for all mentioned groups
    const groupMemberIds: string[] = [];
    for (const groupId of mentionedGroupIds) {
      const mappings = await tx.run(zql.user_group_mappings.where('userGroupId', groupId));
      const memberIds = mappings.map(m => m.userId);
      groupMemberIds.push(...memberIds);
      logger.info(`👥 [NON-PARTICIPANT] Group ${groupId} has ${memberIds.length} members`);
    }

    // Combine individual user IDs with group member user IDs and deduplicate
    const allMentionedUserIds = [...new Set([...mentionedUserIds, ...groupMemberIds])];

    // Check which mentioned users are NOT channel participants
    const nonParticipants: Array<{ userId: string; userName: string }> = [];

    for (const userId of allMentionedUserIds) {
      const participant = await tx.run(zql.channel_participants
        .where('channelId', channelId)
        .where('userId', userId)
        .one());

      if (!participant) {
        // User is not a participant - get their name
        const user = await tx.run(zql.users.where('id', userId).one());
        if (user) {
          nonParticipants.push({
            userId: user.id,
            userName: user.name,
          });
          logger.info(`🚫 [NON-PARTICIPANT] User ${user.name} (${userId}) is not in channel ${channelId}`);
        }
      }
    }

    if (nonParticipants.length === 0) {
      logger.info(`✅ [NON-PARTICIPANT] All mentioned users are channel participants`);
      return;
    }

    logger.info(`📝 [NON-PARTICIPANT] Creating system message for ${nonParticipants.length} non-participants`);

    // Generate HTML content with mentions (matching format of regular messages)
    const mentionSpans = nonParticipants.map(np =>
      `<span data-mention="true" data-mention-type="user" data-user-id="${np.userId}" data-username="${np.userName}" class="mention-text">${np.userName}</span>`
    ).join(', ');

    const isMemberInPrivateChannel = channel?.visibility === ChannelVisibility.PRIVATE &&
      senderParticipation?.role === ChannelRole.MEMBER &&
      channel?.scopeType !== ChannelScopeType.GROUP_DM;

    const htmlContent = isMemberInPrivateChannel
      ? `<p>You mentioned ${mentionSpans} but they are not in this channel. Ask an admin to add them.</p>`
      : `<p>You mentioned ${mentionSpans} but they are not in this channel.</p>`;

    const now = Date.now();

    if (isThreadReply) {
      // Thread Reply: Add system message to the SAME thread
      logger.info(`📝 [NON-PARTICIPANT] Adding to existing thread: ${conversationId}`);

      const systemMessageId = uuidv4();

      await tx.mutate.messages.insert({
        messageId: systemMessageId,
        conversationId: conversationId,
        senderId: 'user',
        content: htmlContent,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        showInChannel: false,
        createdAt: now,
        visibleTo: senderId,
        isDeleted: false,
        isSent: true,
        metadata: {
          messageSubtype: 'user_not_in_channel',
          mentionedUsers: nonParticipants.map(np => ({
            userId: np.userId,
          })),
          channelId,
          canAddUsers: !isMemberInPrivateChannel,
        } as unknown as ReadonlyJSONValue,
      });

      logger.info(`✅ [NON-PARTICIPANT] Added system message to thread ${conversationId}`);
    } else {
      // Channel Message: Create a NEW conversation for the system message
      logger.info(`📝 [NON-PARTICIPANT] Creating new conversation in channel`);

      const newConversationId = uuidv4();
      const systemMessageId = uuidv4();

      // Create new conversation for system message
      await tx.mutate.conversations.insert({
        conversationId: newConversationId,
        channelId,
        createdBy: 'user',
        initialMessageId: systemMessageId,
        lastActivityAt: now,
        replyCount: 0,
        pinned: false,
        metadata: undefined,
        createdAt: now,
      });

      // Create the system message
      await tx.mutate.messages.insert({
        messageId: systemMessageId,
        conversationId: newConversationId,
        senderId: 'user',
        content: htmlContent,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        showInChannel: false,
        createdAt: now,
        visibleTo: senderId,
        isDeleted: false,
        isSent: true,
        metadata: {
          messageSubtype: 'user_not_in_channel',
          mentionedUsers: nonParticipants.map(np => ({
            userId: np.userId,
          })),
          channelId,
          canAddUsers: !isMemberInPrivateChannel,
        } as unknown as ReadonlyJSONValue,
      });

      // Add creator as conversation participant
      await tx.mutate.conversation_participants.insert({
        id: uuidv4(),
        conversationId: newConversationId,
        userId: senderId,
        participationType: ConversationParticipation.AUTHOR,
        joinedAt: now,
      });

      logger.info(`✅ [NON-PARTICIPANT] Created new conversation ${newConversationId} with system message`);
    }
  } catch (error) {
    logger.error('❌ [NON-PARTICIPANT] Error creating non-participant system messages:', error);
    // Don't throw - let the message creation succeed even if system message fails
  }
}

export function createMutators(authData: AuthData, asyncTasks: Array<() => Promise<void>>) {
  return defineMutators({
    channel: {
      joinChannel: defineMutator(
        z.object({
          channelId: z.string(),
          channelParticipantId: z.string(),
          channelUserStatusId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, channelParticipantId, channelUserStatusId, timestamp } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          // Check if channel is public
          if (channel.visibility !== ChannelVisibility.PUBLIC) {
            throw new Error('Can only join public channels');
          }

          const joiningUser = await tx.run(zql.users.where('id', authData.sub).one());
          if (!joiningUser) {
            throw new Error('Invalid user requesting to join');
          }

          // Check if user is already a participant
          const existingParticipant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (existingParticipant) {
            throw new Error('You are already a member of this channel');
          }

          await addChannelParticipant(tx, channelId, authData.sub, ChannelRole.MEMBER, channelParticipantId, channelUserStatusId, timestamp);

          // send system message for joined participants
          const newParticipants = [{ userId: authData.sub, userName: authData.name }];
          const messageSender: AuthData = { name: "system", sub: "system", email: "" }
          await sendAddAndRemoveParticipantsSystemMessage(tx, { channel, newParticipants, authData: messageSender, operationType: 'participants_joined' })
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
        async ({
          tx,
          args: { channelId, name, description, visibility, projectId, conversationId, messageId, timestamp },
        }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error('Channel not found');
          }

          if (channel.scopeType !== ChannelScopeType.GROUP_DM) {
            throw new Error('Only GROUP_DM channels can be promoted to a regular channel');
          }

          const participant = await tx.run(
            zql.channel_participants.where('channelId', channelId).where('userId', authData.sub).one(),
          );

          if (!participant) {
            throw new Error('You are not a participant of this channel');
          }

          const existingChannel = await tx.run(zql.channels.where('name', name).one());
          if (existingChannel && existingChannel.id !== channelId) {
            throw new Error('A channel with this name already exists');
          }

          await tx.mutate.channels.update({
            id: channelId,
            scopeType: ChannelScopeType.DEFAULT,
            name: name,
            description: description || null,
            visibility: visibility,
            projectId: projectId,
            updatedAt: timestamp,
            lastActivityAt: timestamp,
          });

          await tx.mutate.conversations.insert({
            conversationId: conversationId,
            channelId: channelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: timestamp,
            replyCount: 0,
            pinned: false,
            createdAt: timestamp,
          });

          const systemContent = `This group DM was promoted to a channel by ${authData.name}`;
          await tx.mutate.messages.insert({
            messageId: messageId,
            conversationId: conversationId,
            senderId: authData.sub,
            content: systemContent,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: timestamp,
            metadata: {
              operationType: 'group_dm_promoted',
              promotedBy: authData.sub,
              newName: name,
              newVisibility: visibility,
              newProjectId: projectId,
            },
          });

          await tx.mutate.conversation_participants.insert({
            id: uuidv4(),
            conversationId: conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            joinedAt: timestamp,
          });
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
        async ({ tx, args: { userIds, channelId, timestamp, participantIds, userStatusIds } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exists");
          }
          const requestingUser = await tx.run(zql.users.where('id', authData.sub).one());
          if (!requestingUser) {
            throw new Error('Invalid user requesting to join');
          }

          const participationOfRequestingUser = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());
          if (
            !participationOfRequestingUser ||
            (channel.visibility === ChannelVisibility.PRIVATE &&
              participationOfRequestingUser.role === ChannelRole.MEMBER &&
              channel.scopeType !== ChannelScopeType.GROUP_DM)
          ) {
            throw new Error('You are not allowed to add someone');
          }

          const users = await Promise.all(
            userIds.map((id) => tx.run(zql.users.where('id', id).one()))
          );
          const validUsers = users.filter((user) => user !== undefined);

          const addedUsers = [];
          for (const user of validUsers) {
            const generatedParticipantId = participantIds[user.id];
            if (!generatedParticipantId) {
              throw new Error(`participantId is required for user ${user.id}`);
            }
            const generatedStatusId = userStatusIds[user.id];
            if (!generatedStatusId) {
              throw new Error(`userStatusId is required for user ${user.id}`);
            }
            const { added, participantId } = await addChannelParticipant(tx, channelId, user.id, ChannelRole.MEMBER, generatedParticipantId, generatedStatusId, timestamp);

            if (!added) {
              continue; // Already a participant
            }

            await tx.mutate.channel_participants.update({
              id: participantId,
              lastViewedAt: timestamp,
              isStarred: false,
              isClosed: false,
            });

            // Update channel_user_status with timestamp
            const userStatus = await tx.run(zql.channel_user_status
              .where('channelId', channelId)
              .where('userId', user.id)
              .one());

            if (userStatus) {
              await tx.mutate.channel_user_status.update({
                id: userStatus.id,
                lastViewedAt: timestamp,
              });
            }

            addedUsers.push(user);
          }

          // send system message for added participants
          const newParticipants = addedUsers.map((currUser) => ({
            userId: currUser.id,
            userName: currUser.name,
          }));
          await sendAddAndRemoveParticipantsSystemMessage(tx, {
            channel,
            newParticipants,
            authData,
            operationType: 'participants_added'
          });
        },
      ),
      removeParticipant: defineMutator(
        z.object({ targetUserId: z.string(), channelId: z.string() }),
        async ({ tx, args: { targetUserId, channelId } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          // Check if channel is private
          if (
            channel.visibility !== ChannelVisibility.PRIVATE ||
            channel.scopeType !== ChannelScopeType.DEFAULT
          ) {
            throw new Error('Participants can only be removed from private channels');
          }

          // Check if requesting user is a participant and has ADMIN role
          const participationOfRequestingUser = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participationOfRequestingUser) {
            throw new Error('Only channel members can remove participants from private channels');
          }

          // Only admins can remove participants
          if (participationOfRequestingUser.role !== ChannelRole.ADMIN) {
            throw new Error('Only channel admins can remove participants from channels');
          }

          // Check if target user exists to enforce data integrity
          const targetUser = await tx.run(zql.users.where('id', targetUserId).one());
          if (!targetUser) {
            throw new Error('Target user not found, cannot remove participant due to data inconsistency.');
          }

          // Check if target user is actually a participant
          const targetParticipant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', targetUserId)
            .one());

          if (!targetParticipant) {
            throw new Error('User is not a participant in this channel');
          }

          // Prevent removing yourself
          if (targetUserId === authData.sub) {
            throw new Error('Cannot remove yourself from the channel');
          }

          // Prevent removing the channel creator
          if (targetUserId === channel.createdBy) {
            throw new Error('Cannot remove the channel creator');
          }

          await removeChannelParticipant(tx, channelId, targetUserId);

          // Send system message for removed participant
          if (targetUser) {
            await sendAddAndRemoveParticipantsSystemMessage(tx, {
              channel,
              newParticipants: [{
                userId: targetUser.id,
                userName: targetUser.name,
              }],
              authData,
              operationType: 'participants_removed'
            });
          }
        },
      ),
      leaveChannel: defineMutator(
        z.object({ channelId: z.string() }),
        async ({ tx, args: { channelId } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error('Channel not found');
          }

          // Check if user is participant
          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participant) {
            throw new Error('Not a channel participant');
          }

          // Don't allow channel creator to leave if there are other participants
          if (channel.createdBy === authData.sub) {
            const participants = await tx.run(zql.channel_participants
              .where('channelId', channelId));

            if (participants.length > 1) {
              throw new Error('Channel creator cannot leave while other participants remain');
            }
          }

          await removeChannelParticipant(tx, channelId, authData.sub);
        },
      ),
      markChannelAsViewed: defineMutator(
        z.object({
          channelId: z.string(),
          conversationId: z.string().optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, conversationId, timestamp } }) => {
          const participant = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participant) {
            throw new Error('Not a channel participant');
          }

          const updateData: any = {
            lastViewedAt: timestamp,
            unreadCount: 0,
          };

          if (conversationId) {
            updateData.lastViewedConversationId = conversationId;
          }

          await tx.mutate.channel_user_status.update({
            id: participant.id,
            ...updateData,
          });

          const unreadActivities = await tx.run(
            zql.activities
              .where('userId', authData.sub)
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
            messageIds.map(messagePair =>
              tx.run(zql.messages.where('messageId', messagePair.sourceId).related('conversation').one()),
            ),
          );

          for (const [index, message] of messages.entries()) {
            if (message?.conversation?.initialMessageId === message?.messageId) {
              await tx.mutate.activities.update({
                id: messageIds[index].activityId,
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
        }),
        async ({ tx, args: { channelId, messageId, conversationId } }) => {
          const participant = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participant) {
            throw new Error(`User ${authData.sub} is not a participant of channel ${channelId}`);
          }

          // Validate message exists
          let message = await tx.run(zql.messages.where('messageId', messageId).one());
          if (!message) {
            throw new Error(`Message ${messageId} not found`);
          }

          // If the message is from the current user, find the nearest message from another user
          if (message.senderId === authData.sub) {
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
                .where('createdBy', '!=', authData.sub)
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
                  .where('createdBy', '!=', authData.sub)
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
            const targetMessage = await tx.run(
              zql.messages.where('messageId', targetConversation.initialMessageId).one(),
            );

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
              .where('userId', authData.sub)
              .where('channelId', channelId)
              .where('createdAt', '>', newLastViewedAt)
              .related('message', m => m.related('conversation'))
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
                .where('createdBy', '!=', authData.sub),
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
          } = {
            lastViewedAt: newLastViewedAt,
            unreadCount: unreadCount,
          };

          if (conversationId) {
            updateData.lastViewedConversationId = conversationId;
          }

          // Update Channel status
          await tx.mutate.channel_user_status.update({
            id: participant.id,
            ...updateData,
          });

          // Mark root activities unread sequentially for safer transaction handling
          // We only update activities that are currently marked as read
          const activitiesToMarkUnread = rootActivities.filter(a => a.isRead);
          for (const activity of activitiesToMarkUnread) {
            await tx.mutate.activities.update({
              id: activity.id,
              isRead: false
            });
          }
        },
      ),
      toggleStarred: defineMutator(
        z.object({ channelId: z.string() }),
        async ({ tx, args: { channelId } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participation) {
            throw new Error('Not a channel participant');
          }

          await tx.mutate.channel_user_status.update({
            id: participation.id,
            isStarred: !participation.isStarred,
          });
        },
      ),
      closeDm: defineMutator(
        z.object({ channelId: z.string() }),
        async ({ tx, args: { channelId } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participation) {
            throw new Error('Not a channel participant');
          }

          await tx.mutate.channel_user_status.update({
            id: participation.id,
            isClosed: true,
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
        async ({ tx, args: { channelId, description, messageId, conversationId, timestamp, conversationParticipantId } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          // Check if user is a participant
          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participant) {
            throw new Error('Only channel participants can update the description');
          }

          // Get user info for system message
          const user = await tx.run(zql.users.where('id', authData.sub).one());
          if (!user) {
            throw new Error('User not found');
          }

          await tx.mutate.channels.update({
            id: channelId,
            description: description,
          });

          const now = timestamp;

          // Create conversation for the system message
          await tx.mutate.conversations.insert({
            conversationId,
            channelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
            metadata: undefined,
            createdAt: now,
          });

          // Create the system message
          const systemMessageContent = `set the channel description to: ${description}`;

          await tx.mutate.messages.insert({
            messageId,
            conversationId,
            senderId: authData.sub,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            showInChannel: false,
            createdAt: now,
            isSent: true,
            metadata: {
              operationType: 'description_updated',
              newDescription: description,
              userId: authData.sub,
              userName: user.name,
            },
          });

          // Add creator as conversation participant
          await tx.mutate.conversation_participants.insert({
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            joinedAt: now,
          });
        },
      ),
      reopenDm: defineMutator(
        z.object({ channelId: z.string() }),
        async ({ tx, args: { channelId } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participation) {
            throw new Error('Not a channel participant');
          }

          await tx.mutate.channel_user_status.update({
            id: participation.id,
            isClosed: false,
          });
        },
      ),
      updateSelectedBoardId: defineMutator(
        z.object({ channelId: z.string(), boardId: z.string().nullable() }),
        async ({ tx, args: { channelId, boardId } }) => {
          const userStatus = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!userStatus) {
            throw new Error('No channel user status found');
          }

          await tx.mutate.channel_user_status.update({
            id: userStatus.id,
            selectedBoardId: boardId,
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
        async ({ tx, args: { channelId, targetUserId, newRole, timestamp, conversationId, messageId, conversationParticipantId } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          // Check if requesting user is a participant
          const requestingUserParticipation = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!requestingUserParticipation) {
            throw new Error('You are not a participant in this channel');
          }

          // Check if requesting user has admin privileges (ADMIN role or channel creator)
          const requestingUserIsAdmin =
            requestingUserParticipation.role === ChannelRole.ADMIN ||
            channel.createdBy === authData.sub;

          if (!requestingUserIsAdmin) {
            throw new Error('Only channel admins can update participant roles');
          }

          // Prevent updating your own role
          if (targetUserId === authData.sub) {
            throw new Error('Cannot update your own role');
          }

          // Prevent changing the channel creator's role
          if (targetUserId === channel.createdBy) {
            throw new Error('Cannot change the channel creator\'s role');
          }

          // Check if target user is a participant
          const targetParticipant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', targetUserId)
            .one());

          if (!targetParticipant) {
            throw new Error('Target user is not a participant in this channel');
          }

          // Update the participant's role
          await tx.mutate.channel_participants.update({
            id: targetParticipant.id,
            role: newRole,
          });

          // Get user info for system message
          const requestingUser = await tx.run(zql.users.where('id', authData.sub).one());
          const targetUser = await tx.run(zql.users.where('id', targetUserId).one());

          if (!requestingUser || !targetUser) {
            throw new Error('User information not found');
          }

          const now = timestamp;

          // Create conversation for the system message
          await tx.mutate.conversations.insert({
            conversationId,
            channelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
            metadata: undefined,
            createdAt: now,
          });

          // Create the system message
          const systemMessageContent = `changed ${targetUser.name}'s role to ${newRole}`;

          await tx.mutate.messages.insert({
            messageId,
            conversationId,
            senderId: authData.sub,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            showInChannel: false,
            createdAt: now,
            isSent: true,
            metadata: {
              operationType: 'role_updated',
              targetUserId: targetUserId,
              targetUserName: targetUser.name,
              oldRole: targetParticipant.role,
              newRole: newRole,
              updatedBy: authData.sub,
              updatedByName: requestingUser.name,
            },
          });

          // Add creator as conversation participant
          await tx.mutate.conversation_participants.insert({
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            joinedAt: now,
          });
        },
      ),
    },
    conversations: {
      send: defineMutator(
        z.object({
          channelId: z.string(),
          content: z.string(),
          type: z.nativeEnum(MessageType),
          conversationId: z.string(),
          messageId: z.string(),
          timestamp: z.number()
        }),
        async ({ tx, args: { channelId, content, type, conversationId, messageId, timestamp } }) => {
          if (content === '') {
            throw new Error('Message content or files are required to start a conversation');
          }

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          const now = timestamp;

          const participant = await tx.run(zql.channel_participants
            .where('userId', authData.sub)
            .where('channelId', channelId)
            .one());
          const channel = await tx.run(zql.channels.where('id', channelId).one());

          const channelUserStatusParticipant = await tx.run(zql.channel_user_status
            .where('userId', authData.sub)
            .where('channelId', channelId)
            .one());

          if (channel === undefined) {
            throw new Error("Channel doesn't exist");
          }

          if (participant === undefined || channelUserStatusParticipant === undefined) {
            throw new Error('You need to be a participant for adding a conversations');
          }


          await tx.mutate.conversations.insert({
            conversationId,
            channelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
            metadata: undefined,
            createdAt: now,
          });

          const plainTextContent = generatePlainTextContent(content.trim());
          const message = {
            messageId,
            conversationId,
            senderId: authData.sub,
            content: content.trim(),
            msgType: type,
            hasAttachment: false,
            edited: false,
            showInChannel: false,
            createdAt: now,
            metadata: undefined,
            visibleTo: null,
            isDeleted: false,
            isSent: true
          };

          await tx.mutate.messages.insert(message);
          logger.info(`💬 [MUTATOR-CREATE-MESSAGE] Message ${message.messageId} created, type: ${type}`);

          if (type === MessageType.USER) {
            logger.info(`📊 [MUTATOR-CREATE-MESSAGE] Scheduling message count increment for USER message ${message.messageId}`);
            asyncTasks.push(async () => {
              try {
                logger.info(`⬆️ [MUTATOR-CREATE-MESSAGE] Executing message count increment for message ${message.messageId}`);
                await websocketService.incrementTodayMessageCount();
                logger.info(`✅ [MUTATOR-CREATE-MESSAGE] Message count incremented successfully for message ${message.messageId}`);
              } catch (error) {
                logger.error(`❌ [MUTATOR-CREATE-MESSAGE] Failed to increment today message count for message ${message.messageId}:`, error);
              }
            });
            // Track user activity using Redis Set - O(1) operation, no DB query
            asyncTasks.push(async () => {
              try {
                await websocketService.trackUserActivity(authData.sub);
              } catch (error) {
                logger.error(`❌ [MUTATOR-CREATE-MESSAGE] Failed to track user activity for message ${message.messageId}:`, error);
              }
            });
          }

          await tx.mutate.channels.update({
            id: channel.id,
            lastActivityAt: now,
          });

          await tx.mutate.channel_user_status.update({
            id: channelUserStatusParticipant.id,
            lastViewedAt: now,
            lastViewedConversationId: conversationId,
          });

          // Auto-reopen DMs for all participants when a new conversation is started
          await reopenClosedDmParticipants(tx, channel.id, channel.scopeType);

          // Add conversation creator as MENTIONED participant
          await tx.mutate.conversation_participants.insert({
            id: uuidv4(),
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.MENTIONED,
            joinedAt: now,
          });

          // Add mentioned users as MENTIONED participants within Zero transaction
          const mentions = extractAllMentions(content);
          logger.info('[MENTION]:', mentions.userIds.length, mentions.groupIds.length, messageId);

          if (mentions.userIds.length > 0) {
            for (const userId of mentions.userIds) {
              // Skip if this is the author (already added above)
              if (userId === authData.sub) {
                continue;
              }

              // Check if user is already a participant
              const existingParticipant = await tx.run(zql.conversation_participants
                .where('conversationId', conversationId)
                .where('userId', userId)
                .one());

              // Only add if not already a participant
              if (!existingParticipant) {
                await tx.mutate.conversation_participants.insert({
                  id: uuidv4(),
                  conversationId,
                  userId,
                  participationType: ConversationParticipation.MENTIONED,
                  joinedAt: now,
                });
              }
            }
          }

          // Create non-participant system messages within Zero transaction
          await createNonParticipantSystemMessages(
            tx,
            mentions.userIds,
            mentions.groupIds,
            channelId,
            conversationId,
            authData.sub,
            false, // isThreadReply = false for initial channel messages
            channel.scopeType,
          );

          asyncTasks.push(async () => {
            if (message === undefined || user === undefined) return;

            // Fetch and update link metadata asynchronously
            if (content && type === MessageType.USER) {
              try {
                const linkMetadata = await conversationController.fetchLinkPreviewMetadata(content);
                if (linkMetadata) {
                  await repositories.messages.update(message.messageId, {
                    metadata: linkMetadata as any,
                  });
                  logger.info(
                    `✅ [LINK-METADATA] Updated message ${message.messageId} with link preview`
                  );
                }
              } catch (error) {
                logger.error(
                  `❌ [LINK-METADATA] Failed to fetch link metadata for message ${message.messageId}:`,
                  error
                );
                // Don't throw - message creation should succeed even if link preview fails
              }
            }

            // Create search index entry
            try {
              await repositories.messageSearch.upsert(
                message.messageId,
                plainTextContent
              );
            } catch (error) {
              logger.error('Failed to create message search index:', error);
            }
          });

          // Handle bot DM messages - trigger bot execution if this is a DM with a bot
          // Runs async after mutator returns to avoid blocking the response
          asyncTasks.push(async () => {
            if (channel.scopeType !== 'DM' || !user) return;
            try {
              // Check if there's a bot in this DM channel
              const botUserId = await unifiedDMService.getBotInDM(channel.id);
              if (botUserId) {
                // Get bot definition to get the bot ID
                const botDefinition = await unifiedBotUserService.getBotDefinition(botUserId);
                if (botDefinition) {
                  // Start "bot is typing" indicator
                  const botTypingUser = {
                    userId: botUserId,
                    userName: botDefinition.name,
                    userEmail: botDefinition.email,
                  };
                  const typingUsers = await typingService.startTypingInConversation(conversationId, botTypingUser);
                  await typingService.broadcastTypingUpdate(conversationId, typingUsers, false, 'typing_start');

                  try {
                    // Execute bot - this creates the bot response message
                    const result = await executionOrchestrator.execute({
                      botId: botDefinition.id,
                      message: content,
                      channelId: channel.id,
                      conversationId,
                      userMessageId: message.messageId,
                      userId: user.id,
                      userEmail: user.email,
                      userName: user.name,
                      sessionId: undefined, // New conversation, no session yet
                    });

                    // Consume the stream to trigger bot processing and message persistence
                    if (result.stream) {
                      for await (const event of result.stream) {
                        if (event.type === 'error') {
                          logger.error(`[MUTATOR-BOT-NEW-DM] Bot error for message ${message.messageId}:`, event.error);
                        }
                      }
                    }
                  } finally {
                    // Stop "bot is typing" indicator
                    const remainingTypingUsers = await typingService.stopTypingInConversation(conversationId, botUserId);
                    await typingService.broadcastTypingUpdate(conversationId, remainingTypingUsers, false, 'typing_stop');
                  }
                }
              }
            } catch (botError) {
              logger.error(`[MUTATOR-BOT-NEW-DM] Failed to execute bot for message ${message.messageId}:`, botError);
            }
          });
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
          optionalMessage: z.string().max(10000, 'Optional message too long').optional(),
          conversationId: z.string(),
          messageId: z.string(),
          timestamp: z.number(),
          conversationParticipantId: z.string()
        }),
        async ({
          tx,
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
              .where('userId', authData.sub)
              .one()
          );
          if (!participation) {
            throw new Error('You are not a participant of the target channel');
          }

          // Get the original message
          const originalMessage = await tx.run(
            zql.messages.where('messageId', originalMessageId).one()
          );
          if (!originalMessage) {
            throw new Error('Original message not found');
          }

          // Get original sender info
          const originalSender = await tx.run(
            zql.users.where('id', originalMessage.senderId).one()
          );

          // Get original message's conversation to find the channel
          const originalConversation = await tx.run(
            zql.conversations.where('conversationId', originalMessage.conversationId).one()
          );

          // Verify user is a participant of the origin channel (where the message is being forwarded from)
          if (originalConversation?.channelId) {
            const originParticipation = await tx.run(
              zql.channel_participants
                .where('channelId', originalConversation.channelId)
                .where('userId', authData.sub)
                .one()
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

          // Get original message attachments (only if not using optionalText)
          const originalAttachments = useOptionalText
            ? []
            : await tx.run(zql.message_attachments.where('entityId', originalMessageId));

          const now = timestamp;

          // Create conversation for the forwarded message
          await tx.mutate.conversations.insert({
            conversationId,
            channelId: targetChannelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
            metadata: undefined,
            createdAt: now,
          });

          // Create the forwarded message with XML content structure
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const attachmentsArray = originalAttachments as MessageAttachment[];

          // Create XML content for the forwarded message
          const xmlContent = createForwardedMessageXml({
            originalMessageId,
            originalSenderId: originalMessage.senderId,
            originalSenderName: originalSender?.name || 'Unknown User',
            originalCreatedAt: originalMessage.createdAt as number,
            originalChannelId: originalConversation?.channelId || null,
            originalConversationId: originalMessage.conversationId,
            optionalText: optionalMessage || null,
            content: forwardedContent,
          });

          await tx.mutate.messages.insert({
            messageId,
            conversationId,
            senderId: authData.sub,
            content: xmlContent,
            msgType: MessageType.FORWARDED,
            hasAttachment: attachmentsArray.length > 0,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: now,
            metadata: undefined,
          });

          // Copy attachments from the original message
          for (const attachment of attachmentsArray) {
            if (!attachment) continue;
            await tx.mutate.message_attachments.insert({
              id: uuidv4(),
              entityId: messageId,
              entityType: attachment.entityType,
              originalFilename: attachment.originalFilename,
              size: attachment.size,
              mimetype: attachment.mimetype,
              url: attachment.url,
              thumbnailUrl: attachment.thumbnailUrl,
              uploadedByUserId: authData.sub,
              createdBy: authData.sub,
              storageProvider: attachment.storageProvider,
              conversationId: conversationId,
              metadata: attachment.metadata,
              createdAt: now,
            });
          }

          // Update channel last activity
          await tx.mutate.channels.update({
            id: targetChannelId,
            lastActivityAt: now,
          });

          // Update user's last viewed time
          const userStatus = await tx.run(
            zql.channel_user_status
              .where('channelId', targetChannelId)
              .where('userId', authData.sub)
              .one()
          );
          if (userStatus) {
            await tx.mutate.channel_user_status.update({
              id: userStatus.id,
              lastViewedAt: now,
              lastViewedConversationId: conversationId,
            });
          }

          // Add creator as conversation participant
          await tx.mutate.conversation_participants.insert({
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            joinedAt: now,
          });

          logger.info(
            `📤 [MUTATOR-FORWARD] Message ${originalMessageId} forwarded to channel ${targetChannelId} as ${messageId}`
          );
        }
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
          childConversationId: z.string().optional()
        }),
        async ({ tx, args: { conversationId, content, type, showInChannel = false, timestamp, messageId, childConversationId } }) => {
          if (content === '') {
            throw new Error('Message content or files are required to start a conversation');
          }

          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());
          if (!conversation) {
            throw new Error("Message doesn't belong to a conversation");
          }
          const channel = await tx.run(zql.channels.where('id', conversation.channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exists");
          }
          const participant = await tx.run(zql.channel_participants
            .where('userId', authData.sub)
            .where('channelId', conversation.channelId)
            .one());

          if (participant === undefined && channel.visibility == ChannelVisibility.PRIVATE) {
            throw new Error('You need to be a participant for adding a conversations');
          }

          const plainTextContent = generatePlainTextContent(content.trim());
          const message = {
            messageId,
            conversationId,
            senderId: authData.sub,
            content: content.trim(),
            msgType: type,
            hasAttachment: false,
            edited: false,
            showInChannel,
            createdAt: timestamp,
            childConversationId: showInChannel ? childConversationId : null,
            metadata: null,
            visibleTo: null,
            isDeleted: false,
            isSent: true
          };

          await tx.mutate.messages.insert(message);
          logger.info(`💬 [MUTATOR-CREATE-REPLY] Reply message ${message.messageId} created in conversation ${conversationId}, type: ${type}`);

          if (type === MessageType.USER) {
            logger.info(`📊 [MUTATOR-CREATE-REPLY] Scheduling message count increment for USER reply message ${message.messageId}`);
            asyncTasks.push(async () => {
              try {
                logger.info(`⬆️ [MUTATOR-CREATE-REPLY] Executing message count increment for reply message ${message.messageId}`);
                await websocketService.incrementTodayMessageCount();
                logger.info(`✅ [MUTATOR-CREATE-REPLY] Message count incremented successfully for reply message ${message.messageId}`);
              } catch (error) {
                logger.error(`❌ [MUTATOR-CREATE-REPLY] Failed to increment today message count for reply message ${message.messageId}:`, error);
              }
            });
            // Track user activity using Redis Set - O(1) operation, no DB query
            asyncTasks.push(async () => {
              try {
                await websocketService.trackUserActivity(authData.sub);
              } catch (error) {
                logger.error(`❌ [MUTATOR-CREATE-REPLY] Failed to track user activity for reply message ${message.messageId}:`, error);
              }
            });
          }

          await tx.mutate.conversations.update({
            conversationId,
            replyCount: conversation.replyCount + 1,
            lastActivityAt: timestamp,
          });

          if (showInChannel) {
            if (!childConversationId) {
              throw new Error('Child conversation ID is required when showInChannel is true');
            }

            await tx.mutate.conversations.insert({
              conversationId: childConversationId,
              channelId: conversation.channelId,
              createdBy: authData.sub,
              initialMessageId: messageId,
              parentMessageId: conversation.initialMessageId,
              lastActivityAt: timestamp,
              replyCount: 0,
              pinned: false,
              createdAt: timestamp,
            });
          }

          const mostRecentPrevMsg = await tx.run(zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '<', message.createdAt)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .one());

          if (mostRecentPrevMsg?.showInChannel && mostRecentPrevMsg.childConversationId) {
            await tx.mutate.conversations.update({
              conversationId: mostRecentPrevMsg.childConversationId,
              replyCount: 1,
            });
          }

          const senderParticipation = await tx.run(zql.channel_user_status
            .where('channelId', channel.id)
            .where('userId', authData.sub)
            .one());

          if (senderParticipation) {
            await tx.mutate.channel_user_status.update({
              id: senderParticipation.id,
              lastViewedAt: timestamp,
            });
          }

          //Activity related updates

          // Auto-reopen DMs for all participants when a new message is sent
          await reopenClosedDmParticipants(tx, channel.id, channel.scopeType);

          // Add or upgrade sender as AUTHOR participant in conversation
          const existingParticipant = await tx.run(zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', authData.sub)
            .one());

          if (existingParticipant) {
            // Upgrade to AUTHOR if they were only MENTIONED
            if (existingParticipant.participationType === ConversationParticipation.MENTIONED) {
              await tx.mutate.conversation_participants.update({
                id: existingParticipant.id,
                participationType: ConversationParticipation.AUTHOR,
              });
            }
          } else {
            // Add as new AUTHOR participant
            await tx.mutate.conversation_participants.insert({
              id: uuidv4(),
              conversationId,
              userId: authData.sub,
              participationType: ConversationParticipation.AUTHOR,
              joinedAt: timestamp,
            });
          }

          // For private DM threads, add the DM participant to conversation_participants
          if (channel.scopeType === ChannelScopeType.DM) {
            const dmParticipants = await tx.run(zql.channel_participants
              .where('channelId', channel.id));

            for (const dmParticipant of dmParticipants) {
              // Skip if this is the sender 
              if (dmParticipant.userId === authData.sub) {
                continue;
              }

              // Check if user is already a conversation participant
              const existingConvParticipant = await tx.run(zql.conversation_participants
                .where('conversationId', conversationId)
                .where('userId', dmParticipant.userId)
                .one());

              // Only add if not already a participant
              if (!existingConvParticipant) {
                await tx.mutate.conversation_participants.insert({
                  id: uuidv4(),
                  conversationId,
                  userId: dmParticipant.userId,
                  participationType: ConversationParticipation.MENTIONED,
                  joinedAt: timestamp,
                });
              }
            }
          }

          const user = await tx.run(zql.users.where('id', authData.sub).one());

          // Add mentioned users as MENTIONED participants within Zero transaction
          const mentions = extractAllMentions(content);

          if (mentions.userIds.length > 0) {
            for (const userId of mentions.userIds) {
              // Check if user is already a participant (could be AUTHOR or MENTIONED)
              const existingMentionedParticipant = await tx.run(zql.conversation_participants
                .where('conversationId', conversationId)
                .where('userId', userId)
                .one());

              // Only add if not already a participant
              if (!existingMentionedParticipant) {
                await tx.mutate.conversation_participants.insert({
                  id: uuidv4(),
                  conversationId,
                  userId,
                  participationType: ConversationParticipation.MENTIONED,
                  joinedAt: timestamp,
                });
              }
            }
          }

          // Create non-participant system messages within Zero transaction for thread replies
          await createNonParticipantSystemMessages(
            tx,
            mentions.userIds,
            mentions.groupIds,
            channel.id,
            conversationId,
            authData.sub,
            true, // isThreadReply = true for thread messages
            channel.scopeType,
          );

          asyncTasks.push(async () => {

            if (message === undefined || user === undefined) return;

            // Fetch and update link metadata asynchronously
            if (content && type === MessageType.USER) {
              try {
                const linkMetadata = await conversationController.fetchLinkPreviewMetadata(content);
                if (linkMetadata) {
                  await repositories.messages.update(message.messageId, {
                    metadata: linkMetadata as any,
                  });
                  logger.info(
                    `✅ [LINK-METADATA] Updated reply message ${message.messageId} with link preview`
                  );
                }
              } catch (error) {
                logger.error(
                  `❌ [LINK-METADATA] Failed to fetch link metadata for reply message ${message.messageId}:`,
                  error
                );
                // Don't throw - message creation should succeed even if link preview fails
              }
            }

            // Create search index entry
            try {
              await repositories.messageSearch.upsert(
                message.messageId,
                plainTextContent
              );
            } catch (error) {
              logger.error('Failed to create message search index:', error);
            }
          });

          // Handle bot DM replies - trigger bot execution if this is a DM with a bot
          // Runs async after mutator returns to avoid blocking the response
          asyncTasks.push(async () => {
            if (channel.scopeType !== 'DM' || !user) return;
            try {
              // Check if there's a bot in this DM channel
              const botUserId = await unifiedDMService.getBotInDM(channel.id);
              if (botUserId) {
                // Get bot definition to get the bot ID
                const botDefinition = await unifiedBotUserService.getBotDefinition(botUserId);
                if (botDefinition) {
                  // Get session ID from conversation metadata for context continuity
                  const convMetadata = conversation.metadata as Record<string, unknown> | undefined;
                  const sessionId = convMetadata?.session_id as string | undefined;

                  // Start "bot is typing" indicator
                  const botTypingUser = {
                    userId: botUserId,
                    userName: botDefinition.name,
                    userEmail: botDefinition.email,
                  };
                  const typingUsers = await typingService.startTypingInConversation(conversationId, botTypingUser);
                  await typingService.broadcastTypingUpdate(conversationId, typingUsers, false, 'typing_start');

                  try {
                    // Execute bot - this creates the bot response message
                    const result = await executionOrchestrator.execute({
                      botId: botDefinition.id,
                      message: content,
                      channelId: channel.id,
                      conversationId,
                      userMessageId: message.messageId,
                      userId: user.id,
                      userEmail: user.email,
                      userName: user.name,
                      sessionId,
                    });

                    // Consume the stream to trigger bot processing and message persistence
                    if (result.stream) {
                      for await (const event of result.stream) {
                        // Stream events are processed internally by wrapWithPersistence
                        // which handles message creation and updates
                        if (event.type === 'error') {
                          logger.error(`[MUTATOR-BOT-REPLY] Bot error for message ${message.messageId}:`, event.error);
                        }
                      }
                    }
                  } finally {
                    // Stop "bot is typing" indicator
                    const remainingTypingUsers = await typingService.stopTypingInConversation(conversationId, botUserId);
                    await typingService.broadcastTypingUpdate(conversationId, remainingTypingUsers, false, 'typing_stop');
                  }
                }
              }
            } catch (botError) {
              logger.error(`[MUTATOR-BOT-REPLY] Failed to execute bot for message ${message.messageId}:`, botError);
            }
          });
        },
      ),
      update: defineMutator(
        z.object({ messageId: z.string(), content: z.string().optional() }),
        async ({ tx, args: { messageId, content } }) => {
          const message = await tx.run(zql.messages.where('messageId', messageId).one());
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
          // Regular messages and bot messages can only be edited by sender
          if (message.msgType === MessageType.SYSTEM) {
            // System messages can be updated by any channel participant (for metadata updates)
            // Skip sender check for system messages
          } else {
            // For regular and bot messages, only sender can edit
            if (message.senderId !== authData.sub) {
              throw new Error('Only the sender can edit the messages');
            }
            if (message.msgType === MessageType.BOT) {
              throw new Error('BOT Messages cannot be edited');
            }
          }

          // Only process mention changes if content is being updated
          let newlyMentionedUsers: string[] = [];
          let noLongerMentionedUsers: string[] = [];

          if (content !== undefined) {
            // For forwarded messages, parse XML to extract mentions from optionalText
            // For regular messages, extract mentions from the message content
            let oldContentToCheck = message.content;
            if (isForwardedMessage) {
              const parsedForwarded = parseForwardedMessageXml(message.content);
              oldContentToCheck = parsedForwarded?.optionalText || '';
            }

            // Extract mentions from old and new content
            const oldMentions = extractAllMentions(oldContentToCheck);
            const newMentions = extractAllMentions(content);

            // Find users that are newly mentioned (in new content but not in old)
            newlyMentionedUsers = newMentions.userIds.filter(
              userId => !oldMentions.userIds.includes(userId)
            );

            // Find users that are no longer mentioned (in old content but not in new)
            noLongerMentionedUsers = oldMentions.userIds.filter(
              userId => !newMentions.userIds.includes(userId)
            );
          }

          const now = Date.now();

          // Add newly mentioned users as MENTIONED participants
          if (newlyMentionedUsers.length > 0) {
            for (const userId of newlyMentionedUsers) {
              // Check if user is already a participant (could be AUTHOR or MENTIONED)
              const existingParticipant = await tx.run(zql.conversation_participants
                .where('conversationId', message.conversationId)
                .where('userId', userId)
                .one());

              // Only add if not already a participant
              if (!existingParticipant) {
                await tx.mutate.conversation_participants.insert({
                  id: uuidv4(),
                  conversationId: message.conversationId,
                  userId,
                  participationType: ConversationParticipation.MENTIONED,
                  joinedAt: now,
                });
              }
            }
          }

          // Remove users who are no longer mentioned (only if they're MENTIONED type)
          if (noLongerMentionedUsers.length > 0) {
            // Get all OTHER messages in the conversation (excluding the one being updated)
            const allMessages = await tx.run(zql.messages
              .where('conversationId', message.conversationId));

            const otherMessages = allMessages.filter(m => m.messageId !== messageId);

            for (const userId of noLongerMentionedUsers) {
              // Check if user is still mentioned in any other message
              const stillMentioned = otherMessages.some((msg) => {
                const msgMentions = extractAllMentions(msg.content);
                return msgMentions.userIds.includes(userId);
              });

              // If not mentioned elsewhere, check if they're a MENTIONED participant and remove them
              if (!stillMentioned) {
                const participant = await tx.run(zql.conversation_participants
                  .where('conversationId', message.conversationId)
                  .where('userId', userId)
                  .one());

                // Only delete if they're MENTIONED type (keep AUTHOR participants)
                if (participant && participant.participationType === ConversationParticipation.MENTIONED) {
                  await tx.mutate.conversation_participants.delete({
                    id: participant.id
                  });
                }
              }
            }
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
              }
            } else {
              // For regular messages, update the content directly
              await tx.mutate.messages.update({
                messageId,
                content,
                edited: true,
              });
            }
          }

          if (content !== undefined) {
            asyncTasks.push(async () => {
              try {
                // For forwarded messages, index both the forwarded content and the optionalText
                // For regular messages, just index the content
                let contentToIndex = content;
                if (isForwardedMessage) {
                  const parsedForwarded = parseForwardedMessageXml(message.content);
                  contentToIndex = `${parsedForwarded?.content || ''} ${content}`.trim();
                }
                await repositories.messageSearch.upsert(
                  messageId,
                  generatePlainTextContent(contentToIndex)
                );
              } catch (error) {
                logger.error('Failed to update message search index:', error);
              }
            });
          }
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
        async ({ tx, args: { messageId, emojiName, action, timestamp, reactionId, countId } }) => {
          const decodedEmoji = decodeURIComponent(emojiName);
          if (!decodedEmoji.trim() || decodedEmoji.length > 100) {
            throw new Error('Invalid Emoji');
          }
          const message = await tx.run(zql.messages
            .where('messageId', messageId)
            .where(({ or, cmp }) =>
              or(
                cmp('visibleTo', 'IS', null),
                cmp('visibleTo', '=', authData.sub)
              )
            )
            .one());
          if (!message) {
            throw new Error('Message not available');
          }
          const conversationId = message.conversationId;
          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());
          if (!conversation) {
            throw new Error("Message doesn't belong to a conversation");
          }
          const participation = await tx.run(zql.channel_participants
            .where('userId', authData.sub)
            .where('channelId', conversation.channelId)
            .one());
          if (!participation) {
            throw new Error('Only member of the channel can react to a message');
          }

          const reaction = await tx.run(zql.reaction_counts
            .where('messageId', messageId)
            .where('emojiName', decodedEmoji)
            .one());

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
              userId: authData.sub,
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

            // Track user activity using Redis Set - O(1) operation, no DB query
            asyncTasks.push(async () => {
              try {
                await websocketService.trackUserActivity(authData.sub);
              } catch (error) {
                logger.error(`❌ [MUTATOR-REACT] Failed to track user activity for reaction add:`, error);
              }
            });

          } else if (action === 'remove') {
            const reactionRow = await tx.run(zql.reactions
              .where('emojiName', decodedEmoji)
              .where('messageId', messageId)
              .where('userId', authData.sub)
              .one());
            if (!reactionRow) {
              throw new Error('Reaction not found');
            }
            if (authData.sub != reactionRow?.userId) {
              throw Error("Can't remove other user reaction");
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

            // Activity creation now handled by activity injection system
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
        async ({ tx, args: { messageId, showInChannel, childConversationId, timestamp } }) => {
          if (!showInChannel) {
            throw new Error('This action only supports sending messages to the channel.');
          }
          const message = await tx.run(zql.messages
            .where('messageId', messageId)
            .where(({ or, cmp }) =>
              or(
                cmp('visibleTo', 'IS', null),
                cmp('visibleTo', '=', authData.sub)
              )
            )
            .one());
          if (!message) {
            throw new Error('Unauthorized');
          }
          if (message.senderId !== authData.sub) {
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
          const conversation = await tx.run(zql.conversations
            .where('conversationId', message.conversationId)
            .one());

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          const messagesAfterThis = await tx.run(zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '>', message.createdAt));

          const hasNewerReplies = messagesAfterThis.length > 0;

          const now = timestamp;

          // Create a new conversation for this message in the channel (like send does)
          await tx.mutate.conversations.insert({
            conversationId: childConversationId,
            channelId: conversation.channelId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            parentMessageId: conversation.initialMessageId,
            lastActivityAt: now,
            replyCount: hasNewerReplies ? 1 : 0,
            pinned: false,
            createdAt: now,
          });

          // Update the message with the child conversation ID
          await tx.mutate.messages.update({
            messageId,
            childConversationId: childConversationId,
          });

        },
      ),
      handleNonParticipantAction: defineMutator(
        z.object({
          messageId: z.string(),
          action: z.enum(['add', 'add_all', 'ignore', 'ignore_all']),
          userIds: z.array(z.string()),
          channelId: z.string()
        }),
        async ({ tx, args: { messageId, action, userIds, channelId } }) => {
          // Get and validate the system message with visibility filter
          const message = await tx.run(zql.messages
            .where('messageId', messageId)
            .where('visibleTo', authData.sub)
            .one());

          if (!message || message.msgType !== MessageType.SYSTEM) {
            throw new Error('Invalid system message');
          }

          const metadata = message.metadata as any;
          if (metadata?.messageSubtype !== 'user_not_in_channel') {
            throw new Error('Not a non-participant message');
          }

          // 3️⃣ Perform the action
          if (action === 'add' || action === 'add_all') {
            // Add users to channel (with validation)
            const validUsers = [];

            for (const userId of userIds) {
              // Verify user exists
              const user = await tx.run(zql.users.where('id', userId).one());
              if (!user) continue;

              const participantId = uuidv4();
              const channelUserStatusId = uuidv4();

              // Use utility function to properly add participant and update count
              const { added } = await addChannelParticipant(tx, channelId, userId, ChannelRole.MEMBER, participantId, channelUserStatusId, Date.now());

              if (added) {
                validUsers.push({ userId, userName: user.name });
              }
            }

            // Send system message for added participants
            if (validUsers.length > 0) {
              const channel = await tx.run(zql.channels.where('id', channelId).one());
              if (channel) {
                await sendAddAndRemoveParticipantsSystemMessage(tx, {
                  channel,
                  newParticipants: validUsers,
                  authData,
                  operationType: 'participants_added',
                });
              }
            }
          }

          // 4️⃣ Delete the system message after taking action
          logger.info(`🗑️ [NON-PARTICIPANT] Deleting system message ${messageId} after action`);

          // Get the conversation for this system message
          const systemMessageConversation = await tx.run(zql.conversations
            .where('conversationId', message.conversationId)
            .one());
          // Delete the system message
          await tx.mutate.messages.delete({ messageId });

          // Update conversation if this was the initial message
          if (systemMessageConversation) {
            if (systemMessageConversation.initialMessageId === messageId) {
              // This was the initial message - delete the entire conversation
              await tx.mutate.conversations.delete({
                conversationId: systemMessageConversation.conversationId
              });
            }
          }

          // Clean up asynchronously
          asyncTasks.push(async () => {
            try {
              // Delete from search index
              await repositories.messageSearch.delete(messageId);
            } catch (error) {
              logger.error('Failed to cleanup system message after non-participant action:', error);
            }
          });
        },
      ),
      delete: defineMutator(
        z.object({ messageId: z.string() }),
        async ({ tx, args: { messageId } }) => {
          const message = await tx.run(zql.messages.where("messageId", messageId).one());

          if (!message) {
            throw new Error('Message not available');
          }

          // Check if this is a non-participant system message
          const metadata = message.metadata as any;
          const isNonParticipantMessage = metadata?.messageSubtype === 'user_not_in_channel';

          if (message.senderId !== authData.sub && !isNonParticipantMessage) {
            throw new Error('Only sender of message can delete it');
          }

          const conversation = await tx.run(zql.conversations
            .where('conversationId', message.conversationId)
            .one());
          if (!conversation) {
            throw new Error("Message doesn't belong to a conversation");
          }

          const participation = await tx.run(zql.channel_participants
            .where('userId', authData.sub)
            .where('channelId', conversation.channelId)
            .one());
          if (!participation) {
            throw new Error('You have to be a member to delete a message');
          }

          const attachments = await tx.run(zql.message_attachments.where('entityId', messageId));
          const reactions = await tx.run(zql.reactions.where('messageId', messageId));
          const reactionCounts = await tx.run(zql.reaction_counts.where('messageId', messageId));

          await Promise.all(
            attachments.map(async (attachment) => {
              await tx.mutate.message_attachments.delete({
                id: attachment.id,
              });
            })
          );

          await Promise.all(
            reactions.map(async (reaction) => {
              await tx.mutate.reactions.delete({
                reactionId: reaction.reactionId,
              });
            })
          );

          await Promise.all(
            reactionCounts.map(async (count) => {
              await tx.mutate.reaction_counts.delete({
                countId: count.countId,
              });
            })
          );

          // Get all OTHER messages in the conversation (excluding the one being deleted)
          const allMessages = await tx.run(zql.messages
            .where('conversationId', message.conversationId));

          const otherMessages = allMessages.filter(m => m.messageId !== messageId);

          const isInitialMessage = conversation.initialMessageId === messageId;
          const hasReplies = otherMessages.length > 0;
          const shouldSoftDelete = isInitialMessage && hasReplies;

          // Clean up MENTIONED participants within Zero transaction
          const mentions = extractAllMentions(message.content);

          if (mentions.userIds.length > 0) {
            // For each mentioned user, check if they're still mentioned elsewhere
            for (const userId of mentions.userIds) {
              // Check if user is still mentioned in any other message
              const stillMentioned = otherMessages.some((msg) => {
                const msgMentions = extractAllMentions(msg.content);
                return msgMentions.userIds.includes(userId);
              });

              // If not mentioned elsewhere, check if they're a MENTIONED participant and remove them
              if (!stillMentioned && userId !== conversation.createdBy) {
                const participant = await tx.run(zql.conversation_participants
                  .where('conversationId', message.conversationId)
                  .where('userId', userId)
                  .one());

                // Only delete if they're MENTIONED type (keep AUTHOR participants for now)
                if (participant && participant.participationType === ConversationParticipation.MENTIONED) {
                  await tx.mutate.conversation_participants.delete({
                    id: participant.id
                  });
                }
              }
            }
          }

          // Clean up AUTHOR participant if this was their only message
          const senderId = message.senderId;

          // Check if sender has any other messages in this conversation
          const otherMessagesFromSender = otherMessages.filter(
            msg => msg.senderId === senderId
          );

          // If this was their only message, remove their AUTHOR participant
          if (otherMessagesFromSender.length === 0) {
            const senderParticipant = await tx.run(zql.conversation_participants
              .where('conversationId', message.conversationId)
              .where('userId', senderId)
              .one());

            // Remove AUTHOR participant (they have no more messages)
            if (senderParticipant && senderParticipant.participationType === ConversationParticipation.AUTHOR) {
              await tx.mutate.conversation_participants.delete({
                id: senderParticipant.id
              });
            }
          }

          // Handle showInChannel viewNewerReplies updates when deleting a message
          // Check if there are any messages after this one with showInChannel=true
          const messagesAfterThis = await tx.run(zql.messages
            .where('conversationId', message.conversationId)
            .where('createdAt', '>', message.createdAt)
            .limit(1)
            .one());

          // If no messages below, check for a message above
          if (!messagesAfterThis) {
            const messageAbove = await tx.run(zql.messages
              .where('conversationId', message.conversationId)
              .where('createdAt', '<', message.createdAt)
              .orderBy('createdAt', 'desc')
              .limit(1)
              .one());

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
            });
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
              if (isInitialMessageDeleted) {
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

          // 6. Async Side Effects
          asyncTasks.push(async () => {
            // Delete from search index
            try {
              await repositories.messageSearch.delete(messageId);
            } catch (error) {
              logger.error('Failed to delete from message search index:', error);
            }

            // Delete attachment files from GCS if any attachments exist
            if (attachments.length > 0) {
              await Promise.allSettled(
                attachments.map(async (attachment) => {
                  try {
                    if (attachment.url) {
                      await gcsService.deleteFile(attachment.url);

                      // Also delete thumbnail if it exists
                      if (attachment.thumbnailUrl) {
                        await gcsService.deleteFile(attachment.thumbnailUrl);
                      }
                    }
                  } catch (error) {
                    // Don't throw - continue deleting other files even if one fails
                    logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
                  }
                })
              );
            }
          });
        },
      ),
    },
    messageAttachment: {
      delete: defineMutator(
        z.object({ attachmentId: z.string() }),
        async ({ tx, args: { attachmentId } }) => {
          const attachment = await tx.run(zql.message_attachments
            .where('id', attachmentId)
            .one());

          if (!attachment) {
            throw new Error("Attachment doesn't exist");
          }

          const message = await tx.run(zql.messages
            .where('messageId', attachment.entityId)
            .one());

          if (!message) {
            throw new Error("Attachment doesn't belong to a message");
          }

          if (message.senderId !== authData.sub) {
            throw new Error('Only sender of attachment can delete it');
          }

          await tx.mutate.message_attachments.delete({ id: attachmentId });

          // Check if there are any remaining attachments for this message
          const remainingAttachments = await tx.run(zql.message_attachments
            .where('entityId', message.messageId));

          // Only set hasAttachment to false if no attachments remain
          if (remainingAttachments.length === 0) {
            await tx.mutate.messages.update({
              messageId: message.messageId,
              hasAttachment: false,
            });

            const plainText = convert(message.content, {
              wordwrap: false,
              preserveNewlines: false
            }).trim()

            if (plainText === '') {
              // Delete message if content is empty and has no attachments
              await tx.mutate.messages.delete({
                messageId: message.messageId,
              })
            }
            else {
              // Keep message but set hasAttachment to false
              await tx.mutate.messages.update({
                messageId: message.messageId,
                hasAttachment: false
              })
            }
          }

          asyncTasks.push(async () => {
            // Delete attachment file from gcs
            try {
              if (attachment.url) {
                await gcsService.deleteFile(attachment.url);

                // Also delete thumbnail if it exists
                if (attachment.thumbnailUrl) {
                  await gcsService.deleteFile(attachment.thumbnailUrl);
                }
              }
            } catch (error) {
              logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
            }
          });
        },
      ),
    },
    calls: {
      initiate: defineMutator(
        z.object({
          channelId: z.string(),
          callType: z.nativeEnum(CallType),
          targetUserIds: z.array(z.string()).optional(),
          externalId: z.string(),
          roomLink: z.string(),
          timestamp: z.number(),
          callId: z.string(),
          creatorParticipantId: z.string(),
          targetParticipantIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({ tx, args: { channelId, callType, targetUserIds, externalId, roomLink, timestamp, callId, creatorParticipantId, targetParticipantIds = {} } }) => {
          const now = timestamp;

          // Create system message for the call (will be shown as overlay while active)
          const { messageId: systemMessageId, conversationId } = await sendCallSystemMessage(tx, {
            callExternalId: externalId,
            channelId,
            initiatorUserName: authData.name,
          });

          await tx.mutate.calls.insert({
            id: callId,
            externalId,
            createdByUserId: authData.sub,
            channelId,
            callType,
            status: CallStatus.ACTIVE,
            roomLink,
            timezone: 'UTC',
            isRecurring: false,
            recordingEnabled: false,
            startedAt: now,
            lastActivityAt: now,
            createdAt: now,
            updatedAt: now,
            metadata: {
              systemMessageId,
              conversationId,
            },
          });

          // Creator joins immediately
          await tx.mutate.call_participants.insert({
            id: creatorParticipantId,
            callId: callId,
            userId: authData.sub,
            invitedBy: authData.sub,
            invitedAt: now,
            response: InvitationResponse.ACCEPTED,
            respondedAt: now,
            joinedAt: now,
            leftAt: null,
          });

          // Invite specific users or all channel participants
          if (targetUserIds && targetUserIds.length > 0) {
            // Invite specific target users
            for (const userId of targetUserIds) {
              if (userId !== authData.sub) {
                const participantId = targetParticipantIds[userId];
                if (!participantId) {
                  throw new Error(`participantId is required for user ${userId}`);
                }
                await tx.mutate.call_participants.insert({
                  id: participantId,
                  callId: callId,
                  userId,
                  invitedBy: authData.sub,
                  invitedAt: now,
                  response: InvitationResponse.INVITED,
                  respondedAt: null,
                  joinedAt: null,
                  leftAt: null,
                });
              }
            }
          } else {
            // Invite all channel participants
            const channelParticipants = await tx.run(zql.channel_participants
              .where('channelId', channelId));

            for (const participant of channelParticipants) {
              if (participant.userId !== authData.sub) {

                await tx.mutate.call_participants.insert({
                  id: uuidv4(),
                  callId,
                  userId: participant.userId,
                  invitedBy: authData.sub,
                  invitedAt: now,
                  response: InvitationResponse.INVITED,
                  respondedAt: null,
                  joinedAt: null,
                  leftAt: null,
                });
              }
            }
          }
        },
      ),
      join: defineMutator(
        z.object({
          callId: z.string(),
          timestamp: z.number(),
          participantId: z.string().optional()
        }),
        async ({ tx, args: { callId, timestamp, participantId } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());

          if (!call) {
            throw new Error('Call not found');
          }

          if (call.status !== CallStatus.ACTIVE) {
            throw new Error('Call is not active');
          }

          const now = timestamp;

          const existingParticipant = await tx.run(zql.call_participants
            .where('callId', call.id)
            .where('userId', authData.sub)
            .one());

          if (existingParticipant) {
            await tx.mutate.call_participants.update({
              id: existingParticipant.id,
              response: InvitationResponse.ACCEPTED,
              respondedAt: now,
              joinedAt: now,
              leftAt: null,
            });
          } else {
            const newParticipantId = participantId;
            if (!newParticipantId) {
              throw new Error('participantId is required when joining a call');
            }
            await tx.mutate.call_participants.insert({
              id: newParticipantId,
              callId: call.id,
              userId: authData.sub,
              invitedBy: authData.sub,
              invitedAt: now,
              response: InvitationResponse.ACCEPTED,
              respondedAt: now,
              joinedAt: now,
              leftAt: null,
            });
          }
        },
      ),
      leave: defineMutator(
        z.object({ callId: z.string(), timestamp: z.number() }),
        async ({ tx, args: { callId, timestamp } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());

          if (!call) {
            throw new Error('Call not found');
          }

          const participant = await tx.run(zql.call_participants
            .where('callId', call.id)
            .where('userId', authData.sub)
            .one());

          if (!participant || participant.leftAt !== null) {
            return;
          }

          const now = timestamp;

          await tx.mutate.call_participants.update({
            id: participant.id,
            // Keep status as ACCEPTED (or whatever it was) to indicate they did join
            leftAt: now,
          });

          // Fetch all participants once with user relation
          const allParticipants = await tx.run(zql.call_participants
            .where('callId', call.id)
            .related('user'));

          // Filter active participants (ACCEPTED and not left)
          const activeParticipants = allParticipants.filter(
            p => p.response === InvitationResponse.ACCEPTED && p.leftAt === null
          );

          // If no active participants remain, end the call and update system message
          if (activeParticipants.length === 0) {
            const endedAt = now;

            await tx.mutate.calls.update({
              id: call.id,
              status: CallStatus.ENDED,
              endedAt,
              updatedAt: now,
            });

            // Update system message with final call summary
            const callMetadata = call.metadata as { systemMessageId?: string } | null;
            if (callMetadata?.systemMessageId) {
              // Get participants who accepted (joined the call)
              const joinedParticipants = allParticipants
                .filter(p => p.joinedAt !== null)
                .map(p => ({
                  userId: p.userId,
                  userName: p.user?.name || 'Unknown User',
                }));

              if (joinedParticipants.length > 0) {
                await updateCallSystemMessageOnEnd(tx, {
                  messageId: callMetadata.systemMessageId,
                  participants: joinedParticipants,
                  startedAt: call.startedAt,
                  endedAt,
                  callId: call.externalId,
                  currentUserId: authData.sub,
                });
              }
            }

            // Increment call count and add duration only for calls lasting > 60 seconds
            const callDurationSeconds = (endedAt - call.startedAt) / 1000;
            if (callDurationSeconds > 60) {
              // Convert duration to minutes (rounded to 1 decimal place)
              const callDurationMinutes = Math.round((callDurationSeconds / 60) * 10) / 10;

              asyncTasks.push(async () => {
                try {
                  await Promise.all([
                    websocketService.incrementTodayCallCount(),
                    websocketService.addCallDuration(callDurationMinutes)
                  ]);
                  logger.info(`Successfully updated call metrics (duration: ${callDurationMinutes}m)`);
                } catch (error) {
                  logger.error('Failed to update call metrics in Zero mutator:', error);
                }
              });
            }

          }
        },
      ),
      reject: defineMutator(
        z.object({ callId: z.string(), timestamp: z.number() }),
        async ({ tx, args: { callId, timestamp } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());

          if (!call) {
            throw new Error('Call not found');
          }

          const participant = await tx.run(zql.call_participants
            .where('callId', call.id)
            .where('userId', authData.sub)
            .one());

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
        z.object({ callId: z.string(), userIds: z.array(z.string()), timestamp: z.number(), participantIds: z.record(z.string(), z.string()) }),
        async ({ tx, args: { callId, userIds, timestamp, participantIds = {} } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());
          if (!call || call.status !== CallStatus.ACTIVE) {
            throw new Error('Call not found');
          }

          const now = timestamp;

          // Invite each user
          for (const userId of userIds) {
            // Check if user already has a participant record
            const existingParticipant = await tx.run(zql.call_participants
              .where('callId', call.id)
              .where('userId', userId)
              .one());

            if (existingParticipant) {
              // Re-invite: reset to INVITED status (works for declined or left users)
              if (existingParticipant.response !== InvitationResponse.ACCEPTED || existingParticipant.leftAt !== null) {
                await tx.mutate.call_participants.update({
                  id: existingParticipant.id,
                  response: InvitationResponse.INVITED,
                  invitedBy: authData.sub,
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
                userId,
                invitedBy: authData.sub,
                invitedAt: now,
                response: InvitationResponse.INVITED,
                respondedAt: null,
                joinedAt: null,
                leftAt: null,
              });
            }
          }
        },
      ),
    },
    activities: {
      markAsRead: defineMutator(
        z.object({ activityId: z.string() }),
        async ({ tx, args: { activityId } }) => {
          const activity = await tx.run(zql.activities.where('id', activityId).one());

          if (!activity) {
            throw new Error('Activity not found');
          }

          if (activity.userId !== authData.sub) {
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
        }),
        async ({ tx, args: { actorAction, classification } }) => {
          let query = zql.activities
            .where('userId', authData.sub)
            .where('isRead', false);

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
                .where('userId', authData.sub)
                .where('channelId', 'IN', uniqueChannelIds),
            );
            await Promise.all(
              channelUserStatuses.map(channelStatus => {
                const readCount = channelIdCounts.get(channelStatus.channelId) || 0;
                const newUnreadCount = Math.max(0, channelStatus.unreadCount - readCount);
                return tx.mutate.channel_user_status.update({
                  id: channelStatus.id,
                  unreadCount: newUnreadCount,
                });
              }),
            );
          }
        },
      ),
      markActivitiesSeenByMessageId: defineMutator(
        z.object({ messageId: z.string() }),
        async ({ tx, args: { messageId } }) => {
          const messageActivities = await tx.run(zql.activities
            .where(({ or, cmp }) => or(
              cmp('actionSource', 'message'),
              cmp('actionSource', 'missed_call')
            ))
            .where('actionSourceId', messageId)
            .where('userId', authData.sub));

          for (const activity of messageActivities) {
            if (!activity.isRead) {
              await tx.mutate.activities.update({
                id: activity.id,
                isRead: true,
              });
            }
          }

          // Step 2: Get all reactions for this message
          const reactions = await tx.run(zql.reactions.where('messageId', messageId));

          // Step 3: Mark all reaction activities as read for these reactions
          for (const reaction of reactions) {
            const reactionActivities = await tx.run(zql.activities
              .where('actionSource', 'reaction')
              .where('actionSourceId', reaction.reactionId));

            for (const activity of reactionActivities) {
              if (!activity.isRead) {
                await tx.mutate.activities.update({
                  id: activity.id,
                  isRead: true,
                });
              }
            }
          }
        },
      ),
      markThreadActivitiesAsRead: defineMutator(
        z.object({ conversationId: z.string() }),
        async ({ tx, args: { conversationId } }) => {
          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          const channelId = conversation.channelId;

          const unreadActivities = await tx.run(zql.activities
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isRead', false)
            .where('actionSource', 'message'));

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
            messageIds.map(messagePair =>
              tx.run(zql.messages.where('messageId', messagePair.sourceId).related('conversation').one()),
            ),
          );

          for (const [index, message] of messages.entries()) {
            if (message?.conversation?.initialMessageId !== message?.messageId) {
              await tx.mutate.activities.update({
                id: messageIds[index].activityId,
                isRead: true,
              });
            }
          }
        },
      ),
      markMissedCallsAsRead: defineMutator(
        z.object({}),
        async ({ tx, ctx, }) => {
          let query = zql.activities
            .where('userId', ctx.userID)
            .where('actorAction', 'missed_call')
            .where('isRead', false);

          const unreadMissedCalls = await tx.run(query);

          if (unreadMissedCalls.length > 0) {
            await Promise.all(unreadMissedCalls.map(activity =>
              tx.mutate.activities.update({
                id: activity.id,
                isRead: true,
              })
            ));
          }
        },
      ),
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
          updatedAt: z.number(),
        }),
        async ({ tx, args: params }) => {
          const ticket = await tx.run(zql.tickets.where("id", params.id).one());
          if (!ticket) throw new Error("Ticket not found");

          // ACL Business Logic: Check ticket transfer permission for assignedTo or userGroupId changes
          const isAssigneeChanging = params.assignedTo !== undefined && params.assignedTo !== ticket.assignedTo;
          const isUserGroupChanging = params.userGroupId !== undefined && params.userGroupId !== ticket.userGroupId;

          if ((isAssigneeChanging || isUserGroupChanging) && ticket.userGroupId) {
            // Get board to check if transfer is restricted
            const board = await tx.run(zql.boards.where("id", ticket.boardId).one());

            if (board?.metadata && typeof board.metadata === 'object') {
              const metadata = board.metadata as BoardMetadata;

              // If board has transfer restriction enabled
              if (metadata.isAllowedToTransfer === true) {
                // User must be part of the current user group with proper responsibility
                const userGroupMapping = await tx.run(
                  zql.user_group_mappings
                    .where("userId", authData.sub)
                    .where("userGroupId", ticket.userGroupId)
                    .one()
                );

                if (!userGroupMapping) {
                  throw new Error('You must be a member of the current user group to modify this ticket');
                }

                // Check responsibility from the mapping
                const responsibility = userGroupMapping.responsibility;
                if (responsibility !== UserResponsibility.MANAGER && responsibility !== UserResponsibility.TEAM_LEAD) {
                  throw new Error('Only users with MANAGER or TEAM_LEAD responsibility can modify ticket assignment or transfer tickets on this board');
                }
              }
            }
          }

          const updateData: any = { updatedAt: params.updatedAt, updatedBy: authData.sub };
          const activities: any[] = [];
          const fields = ['title', 'description', 'statusV2', 'priority', 'stageName', 'assignedTo', 'userGroupId', 'eta', 'boardId', 'metadata'] as const;
          const oldAssignedTo = ticket.assignedTo;
          const oldBoardId = ticket.boardId;

          for (const field of fields) {
            if (params[field] !== undefined && params[field] !== ticket[field]) {
              updateData[field] = params[field];
              let activityType = field.toUpperCase();
              if (field === 'stageName') activityType = 'STATUS';
              if (field === 'statusV2') activityType = 'STATUS';
              if (field === 'assignedTo') activityType = 'ASSIGNED_TO';
              if (field === 'userGroupId') activityType = 'USER_GROUP_ID';
              if (field === 'eta') activityType = 'ETA';
              if (field === 'boardId') activityType = 'BOARD';

              activities.push({
                activityType,
                value: field === 'stageName'
                  ? { field: 'stageName', oldValue: ticket[field], newValue: params[field] }
                  : { oldValue: ticket[field], newValue: params[field] },
              });
            }
          }


          const subTickets = await tx.run(zql.sub_tickets.where("mappedTicketId", params.id).one());

          if (subTickets) {
            let progression: string | undefined = undefined;
            if (params.stageName) {
              const stages = await tx.run(zql.stages.where("boardId", ticket.boardId).orderBy("sequenceNumber", "asc"));
              const stageNumber = stages.findIndex(v => v.name === params.stageName);
              if (stageNumber !== -1) {
                progression = `${stageNumber + 1}/${stages.length}`;
              }
            }
            if (params.assignedTo || progression) {
              await tx.mutate.sub_tickets.update({
                id: subTickets.id,
                assignedTo: params.assignedTo ? params.assignedTo : subTickets.assignedTo,
                stageProgression: progression ? progression : subTickets.stageProgression
              });
            }
          }

          // STAGE HISTORY TRACKING: Track stage transitions in ticket_stage_eta table
          if (params.stageName !== undefined && params.stageName !== ticket.stageName) {

            // Fetch current and target stages to determine movement direction
            const oldStage = await tx.run(zql.stages.where('boardId', ticket.boardId).where('name', ticket.stageName).one());
            const newStage = await tx.run(zql.stages.where('boardId', ticket.boardId).where('name', params.stageName).one());

            if (!newStage) {
              logger.warn('[MUTATOR-STAGE-HISTORY] Target stage not found', {
                ticketId: params.id,
                stageName: params.stageName,
                boardId: ticket.boardId
              });
            } else {
              const isForwardMovement = !oldStage || newStage.sequenceNumber > oldStage.sequenceNumber;
              const now = Date.now();

              if (isForwardMovement) {
                // FORWARD MOVEMENT: Mark old stage as left, create/reactivate new stage entry

                // 1. Mark current stage as left (if exists)
                if (oldStage) {
                  const activeEntries = await tx.run(
                    zql.ticket_stage_eta
                      .where('ticketId', params.id)
                      .where('stageId', oldStage.id)
                  );

                  const activeEntry = activeEntries.find(e => e.stageLeftAt === null);
                  if (activeEntry) {
                    await tx.mutate.ticket_stage_eta.update({
                      id: activeEntry.id,
                      stageLeftAt: now,
                      updatedAt: now,
                      updatedBy: authData.sub
                    });
                  }
                }

                // 2. Check if target stage entry already exists (re-entry case)
                const existingEntries = await tx.run(
                  zql.ticket_stage_eta
                    .where('ticketId', params.id)
                    .where('stageId', newStage.id)
                );

                const existingEntry = existingEntries[0]; // Get first entry if exists

                if (existingEntry) {
                  // Re-entering a stage - reactivate it
                  await tx.mutate.ticket_stage_eta.update({
                    id: existingEntry.id,
                    stageLeftAt: null,
                    updatedAt: now,
                    updatedBy: authData.sub
                  });
                } else {
                  // First time entering this stage - create new entry
                  const newEntryId = uuidv4();
                  const stageEtaDeadline = now + newStage.eta * 60 * 60 * 1000;
                  await tx.mutate.ticket_stage_eta.insert({
                    id: newEntryId,
                    ticketId: params.id,
                    stageId: newStage.id,
                    stageEnteredAt: now,
                    stageLeftAt: null,
                    stageEta: stageEtaDeadline,
                    createdAt: now,
                    updatedBy: authData.sub
                  });

                }
              } else {
                // BACKWARD MOVEMENT: Delete all forward stage entries, reactivate target

                // 1. Get all stages with sequenceNumber > target
                const forwardStages = await tx.run(
                  zql.stages
                    .where('boardId', ticket.boardId)
                );
                
                const forwardStageIds = forwardStages
                  .filter(s => s.sequenceNumber > newStage.sequenceNumber)
                  .map(s => s.id);
                
                // 2. Delete all entries for forward stages
                if (forwardStageIds.length > 0) {
                  const allStageEntries = await tx.run(
                    zql.ticket_stage_eta.where('ticketId', params.id)
                  );

                  for (const entry of allStageEntries) {
                    if (forwardStageIds.includes(entry.stageId)) {
                      await tx.mutate.ticket_stage_eta.delete({ id: entry.id });
                    }
                  }
                }

                // 3. Reactivate target stage entry (or create if doesn't exist)
                const targetEntries = await tx.run(
                  zql.ticket_stage_eta
                    .where('ticketId', params.id)
                    .where('stageId', newStage.id)
                );

                const targetEntry = targetEntries[0];

                if (targetEntry) {
                  await tx.mutate.ticket_stage_eta.update({
                    id: targetEntry.id,
                    stageLeftAt: null,
                    updatedAt: now,
                    updatedBy: authData.sub
                  });
                } else {
                  // Create new entry if it didn't exist
                  const stageEtaDeadline = now + newStage.eta * 60 * 60 * 1000;
                  const newEntryId = uuidv4();
                  await tx.mutate.ticket_stage_eta.insert({
                    id: newEntryId,
                    ticketId: params.id,
                    stageId: newStage.id,
                    stageEnteredAt: now,
                    stageLeftAt: null,
                    stageEta: stageEtaDeadline,
                    createdAt: now,
                    updatedBy: authData.sub
                  });
                }
              }
            }
          }

          await tx.mutate.tickets.update({ id: params.id, ...updateData });

          // Sync workload mappings if assignedTo changed
          if (params.assignedTo !== undefined && params.assignedTo !== oldAssignedTo && ticket.userGroupId && ticket.boardId) {
            const usersToSync = [oldAssignedTo, params.assignedTo].filter(Boolean) as string[];

            for (const userId of usersToSync) {
              await syncUserWorkloadMapping(tx, userId, ticket, authData.sub);
            }
          }

          // Handle board change - retrigger autoassignment
          if (params.boardId !== undefined && params.boardId !== oldBoardId && ticket.userGroupId) {
            // Fire and forget - retrigger autoassignment for the new board
            asyncTasks.push(async () => {
              try {
                logger.info(`[MUTATOR-TICKET-UPDATE] Board changed from ${oldBoardId} to ${params.boardId}, retriggering autoassignment for userGroupId: ${ticket.userGroupId}`);

                const assignmentResult = await evaluateAssignmentRule(ticket.userGroupId, params.boardId!);

                if (assignmentResult.assignedUserId) {
                  logger.info(`[MUTATOR-TICKET-UPDATE] Autoassignment result: assigning to ${assignmentResult.assignedUserId}`);

                  // Update the ticket with the auto-assigned user using tx.mutate
                  await tx.mutate.tickets.update({
                    id: params.id,
                    assignedTo: assignmentResult.assignedUserId,
                    updatedAt: Date.now(),
                    updatedBy: authData.sub,
                  });

                  // Sync workload for new assigned user with new board
                  const newBoardId = params.boardId!;
                  await syncUserWorkloadMapping(tx, assignmentResult.assignedUserId, { userGroupId: ticket.userGroupId, boardId: newBoardId }, authData.sub);
                }
              } catch (error) {
                console.error(`[MUTATOR-TICKET-UPDATE] Failed to retrigger autoassignment for board change:`, error);
              }
            });
          }

          // Auto-assign ticket when userGroupId changes
          if (params.userGroupId !== undefined && params.userGroupId !== ticket.userGroupId && params.userGroupId !== null) {
            // Generate IDs and use timestamp outside async task (common pattern)
            const activityId = uuidv4();
            const messageId = uuidv4();
            const timestamp = params.updatedAt;

            asyncTasks.push(async () => {
              try {
                const assignmentResult = await ticketAssignmentService.assignTicket({
                  userGroupId: params.userGroupId!,
                });

                if (assignmentResult) {
                  await tx.mutate.tickets.update({
                    id: params.id,
                    assignedTo: assignmentResult.assignedUserId,
                    updatedBy: authData.sub,
                    updatedAt: timestamp,
                  });

                  // Add to activities for tracking
                  await tx.mutate.ticket_activities.insert({
                    id: activityId,
                    ticketId: params.id,
                    updatedBy: authData.sub,
                    timestamp: timestamp,
                    activityType: ActivityType.ASSIGNED_TO,
                    value: { oldValue: ticket.assignedTo, newValue: assignmentResult.assignedUserId },
                  });

                  // Create system message if conversation exists
                  if (ticket.conversationId) {
                    const user = await tx.run(zql.users.where('id', authData.sub).one());
                    const assignedUser = await tx.run(zql.users.where('id', assignmentResult.assignedUserId).one());

                    if (user && assignedUser) {
                      await tx.mutate.messages.insert({
                        messageId: messageId,
                        conversationId: ticket.conversationId,
                        senderId: authData.sub,
                        content: `${user.name} auto-assigned ticket to ${assignedUser.name}`,
                        msgType: MessageType.SYSTEM,
                        hasAttachment: false,
                        edited: false,
                        isDeleted: false,
                        isSent: true,
                        showInChannel: false,
                        createdAt: timestamp,
                        metadata: {
                          activityType: ActivityType.ASSIGNED_TO,
                          isTicketActivity: true,
                        },
                      });
                    }
                  }

                  // Sync workload mapping using Prisma (like Zoho tickets do)
                  if (ticket.boardId) {
                    await syncUserWorkload(
                      assignmentResult.assignedUserId,
                      params.userGroupId!,
                      ticket.boardId,
                      authData.sub
                    );
                  }

                  logger.info(`[AUTO-ASSIGN] Ticket ${params.id} assigned to ${assignmentResult.assignedUserId}: ${assignmentResult.reason}`);
                }
              } catch (error) {
                logger.error(`[AUTO-ASSIGN] Failed to auto-assign ticket ${params.id}:`, error);
              }
            });
          }

          // Track user activity using Redis Set - O(1) operation, no DB query
          asyncTasks.push(async () => {
            try {
              await websocketService.trackUserActivity(authData.sub);
            } catch (error) {
              logger.error(`❌ [MUTATOR-TICKET-UPDATE] Failed to track user activity:`, error);
            }
          });

          for (const activity of activities) {
            await tx.mutate.ticket_activities.insert({
              id: uuidv4(),
              ticketId: params.id,
              updatedBy: authData.sub,
              timestamp: Date.now(),
              activityType: activity.activityType as any,
              value: activity.value,
            });

            const user = await tx.run(zql.users.where('id', authData.sub).one());
            if (!user?.name) {
              throw new Error('User name is required but not available');
            }
            const userName = user.name;
            let activityMessage = '';

            if (activity.activityType === 'TITLE') {
              activityMessage = `${userName} updated the title`;
            } else if (activity.activityType === 'DESCRIPTION') {
              activityMessage = `${userName} updated the description`;
            } else if (activity.activityType === 'STATUS' && activity.value.field === 'stageName') {
              activityMessage = `${userName} moved ticket from "${activity.value.oldValue}" to "${activity.value.newValue}"`;
            } else if (activity.activityType === 'ASSIGNED_TO') {
              if (activity.value.newValue) {
                const newAssignee = await tx.run(zql.users.where('id', activity.value.newValue).one());
                if (activity.value.newValue === authData.sub) {
                  activityMessage = `${userName} self-assigned the ticket`;
                } else {
                  activityMessage = `${userName} assigned to ${newAssignee?.name || 'someone'}`;
                }
              } else {
                activityMessage = `${userName} unassigned the ticket`;
              }
            } else if (activity.activityType === 'PRIORITY') {
              activityMessage = `${userName} changed priority from ${activity.value.oldValue} to ${activity.value.newValue}`;
            } else if (activity.activityType === 'ETA') {
              const oldDate = activity.value.oldValue ? new Date(activity.value.oldValue).toLocaleDateString() : 'none';
              const newDate = activity.value.newValue ? new Date(activity.value.newValue).toLocaleDateString() : 'none';
              activityMessage = `${userName} updated ETA from ${oldDate} to ${newDate}`;
            } else if (activity.activityType === 'BOARD') {
              const oldBoard = await tx.run(zql.boards.where('id', activity.value.oldValue).one());
              const newBoard = await tx.run(zql.boards.where('id', activity.value.newValue).one());
              activityMessage = `${userName} moved ticket from board "${oldBoard?.name || activity.value.oldValue}" to "${newBoard?.name || activity.value.newValue}"`;
            } else if (activity.activityType === 'USER_GROUP_ID') {
              if (activity.value.newValue) {
                const newGroup = await tx.run(zql.user_groups.where('id', activity.value.newValue).one());
                activityMessage = `${userName} transferred the ticket to ${newGroup?.name || 'Unknown'}`;
              } else {
                const oldGroup = activity.value.oldValue ? await tx.run(zql.user_groups.where('id', activity.value.oldValue).one()) : null;
                activityMessage = `${userName} removed user group${oldGroup ? ` ${oldGroup.name}` : ''}`;
              }
            }

            if (activityMessage && ticket.conversationId) {
              await tx.mutate.messages.insert({
                messageId: uuidv4(),
                conversationId: ticket.conversationId,
                senderId: authData.sub,
                content: activityMessage,
                msgType: MessageType.SYSTEM,
                hasAttachment: false,
                edited: false,
                isDeleted: false,
                isSent: true,
                showInChannel: false,
                createdAt: Date.now(),
                metadata: {
                  activityType: activity.activityType,
                  isTicketActivity: true,
                },
              });
            }
          }
        },
      ),
      updateAssignment: defineMutator(
        z.object({
          ticketId: z.string(),
          assignedTo: z.string().nullable(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { ticketId, assignedTo, timestamp } }) => {
          // Validate ticket exists
          const ticket = await tx.run(zql.tickets.where("id", ticketId).one());
          if (!ticket) {
            throw new Error("Ticket not found");
          }

          const oldAssignedTo = ticket.assignedTo;

          // Update ticket assignment
          await tx.mutate.tickets.update({
            id: ticketId,
            assignedTo,
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });

          const subTickets = await tx.run(zql.sub_tickets.where("mappedTicketId", ticketId).one());
          if (subTickets && assignedTo !== null) {
            await tx.mutate.sub_tickets.update({
              id: subTickets.id,
              assignedTo: assignedTo
            })
          }

          // Sync workload mappings for both old and new assignees
          if (ticket.userGroupId && ticket.boardId) {
            const usersToSync = [oldAssignedTo, assignedTo].filter(Boolean) as string[];

            for (const userId of usersToSync) {
              await syncUserWorkloadMapping(tx, userId, ticket, authData.sub);
            }
          }

          // Track user activity using Redis Set - O(1) operation, no DB query
          asyncTasks.push(async () => {
            try {
              await websocketService.trackUserActivity(authData.sub);
            } catch (error) {
              logger.error(`❌ [MUTATOR-TICKET-ASSIGNMENT] Failed to track user activity:`, error);
            }
          });
        },
      ),
    },
    ticketStageEta: {
      update: defineMutator(
        z.object({
          id: z.string(),
          stageEta: z.number(),
          updatedAt: z.number(),
        }),
        async ({ tx, args }) => {
          const { id, stageEta, updatedAt } = args;

          // 1. Fetch the OLD ticket stage ETA entry BEFORE updating
          const oldTicketStageEtaEntry = await tx.run(
            zql.ticket_stage_eta.where('id', id).one()
          );

          if (!oldTicketStageEtaEntry) return;

          // Store the old value for activity logging
          const oldStageEta = oldTicketStageEtaEntry.stageEta;

          // 2. Update the current stage ETA entry
          await tx.mutate.ticket_stage_eta.update({
            id,
            stageEta,
            updatedAt,
            updatedBy: authData.sub,
          });

          // 3. Use the old entry for other data (ticketId, stageId don't change)
          const ticketStageEtaEntry = oldTicketStageEtaEntry;

          // 3. Fetch the associated ticket
          const ticket = await tx.run(
            zql.tickets.where('id', ticketStageEtaEntry.ticketId).one()
          );

          if (!ticket) return;

          // 4. Fetch the current stage details
          const currentStage = await tx.run(
            zql.stages.where('id', ticketStageEtaEntry.stageId).one()
          );

          if (!currentStage) return;

          // 5. Fetch ALL stages for this board
          const allBoardStages = await tx.run(
            zql.stages.where('boardId', ticket.boardId)
          );

          // 6. Filter to get FUTURE stages (after current stage)
          const futureStages = allBoardStages
            .filter(stage => stage.sequenceNumber > currentStage.sequenceNumber)
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

          // 7. Calculate total hours needed for future stages
          const futureStagesHours = futureStages.reduce(
            (totalHours, stage) => totalHours + stage.eta, 
            0
          );

          // 8. Get the NEW current stage deadline (what user just set)
          const currentStageDeadline = new Date(stageEta);

          // 9. Calculate overall ticket ETA using working hours logic
          // Starting from: current stage deadline
          // Adding: working hours for all future stages
          const overallTicketEta = calculateETADeadline(
            currentStageDeadline,  // Start from user's new deadline for current stage
            futureStagesHours      // Add working hours for future stages
          );

          // 10. Update the ticket's overall ETA
          await tx.mutate.tickets.update({
            id: ticket.id,
            eta: overallTicketEta.getTime(),
            updatedAt: Date.now(),
          });

          logger.info('[MUTATOR] Updated ticket ETA', {
            ticketId: ticket.id,
            currentStageDeadline: currentStageDeadline.toISOString(),
            futureStagesHours,
            newOverallEta: overallTicketEta.toISOString(),
          });

          // 11. Create ticket activity for stage ETA change
          const newStageEta = stageEta;

          await tx.mutate.ticket_activities.insert({
            id: uuidv4(),
            ticketId: ticket.id,
            updatedBy: authData.sub,
            timestamp: Date.now(),
            activityType: ActivityType.STAGE_ETA,
            value: {
              stageName: currentStage.name,
              oldValue: oldStageEta,
              newValue: newStageEta,
            },
          });

          // 12. Create system message in ticket conversation
          if (ticket.conversationId) {
            const user = await tx.run(zql.users.where('id', authData.sub).one());
            const userName = user?.name || 'Someone';
            const oldDate = new Date(oldStageEta).toLocaleDateString();
            const newDate = new Date(newStageEta).toLocaleDateString();
            const activityMessage = `${userName} updated "${currentStage.name}" stage deadline from ${oldDate} to ${newDate}`;

            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: ticket.conversationId,
              senderId: authData.sub,
              content: activityMessage,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: Date.now(),
              metadata: {
                activityType: 'STAGE_ETA',
                isTicketActivity: true,
              },
            });
          }
        }
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
        async ({ tx, args: { subTicketId, mappingId, timestamp, title, description, ticketId, conversationId, subTicketXyneId } }) => {
          // Create the subticket
          await tx.mutate.sub_tickets.insert({
            id: subTicketId,
            title,
            description: description || null,
            mappedTicketId: null,
            createdBy: authData.sub,
            updatedBy: authData.sub,
            conversationId: conversationId || null,
            createdAt: timestamp,
            updatedAt: timestamp,
            stageProgression: null,
            assignedTo: null,
          });

          // Create the mapping
          await tx.mutate.ticket_sub_ticket_mappings.insert({
            id: mappingId,
            ticketId,
            subTicketId,
          });

          // Log activity and create system message
          const activityId = uuidv4();
          await tx.mutate.ticket_activities.insert({
            id: activityId,
            ticketId,
            activityType: ActivityType.SUBTICKET_CREATED,
            updatedBy: authData.sub,
            timestamp,
            value: {
              subTicketId,
              subTicketTitle: title,
              subTicketXyneId,
            },
          });

          // Create system message in conversation
          if (conversationId) {
            const user = await tx.run(zql.users.where('id', authData.sub).one());
            const userName = user?.name || 'Someone';
            const displayId = subTicketXyneId || subTicketId.substring(0, 8).toUpperCase();
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId,
              senderId: authData.sub,
              content: `${userName} created subticket ${displayId}`,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: timestamp,
              metadata: {
                activityType: ActivityType.SUBTICKET_CREATED,
                isTicketActivity: true,
              },
            });
          }
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
        async ({ tx, args: { subTicketId, timestamp, mappedTicketId, conversationId, assignedTo } }) => {
          // Update the subticket
          await tx.mutate.sub_tickets.update({
            id: subTicketId,
            ...(mappedTicketId !== undefined && { mappedTicketId }),
            ...(conversationId !== undefined && { conversationId }),
            ...(assignedTo !== undefined && { assignedTo }),
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });
        },
      ),
    },
    project: {
      update: defineMutator(
        z.object({ projectId: z.string(), name: z.string().optional(), description: z.string().optional(), timestamp: z.number() }),
        async ({ tx, args: { projectId, name, description, timestamp } }) => {
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
            updatedBy: authData.sub,
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
        z.object({ userGroupId: z.string(), name: z.string().optional(), alias: z.string().optional(), description: z.string().optional(), userResponsibilityUpdates: z.record(z.string(), z.nativeEnum(UserResponsibility)).optional(), timestamp: z.number() }),
        async ({ tx, args: { userGroupId, name, alias, description, userResponsibilityUpdates, timestamp } }) => {
          // Get all user groups to check for duplicates in a single query
          const allUserGroups = await tx.run(zql.user_groups);

          // Find the current user group
          const userGroup = allUserGroups.find(ug => ug.id === userGroupId);
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Check for duplicate name if name is being changed
          if (name && name !== userGroup.name) {
            const existingUserGroup = allUserGroups.find(ug => ug.name === name);
            if (existingUserGroup && existingUserGroup.id !== userGroupId) {
              throw new Error(`User group with name '${name}' already exists`);
            }
          }

          // Check for duplicate alias if alias is being changed
          if (alias && alias !== userGroup.alias) {
            if (!/^[a-z0-9_-]+$/.test(alias)) {
              throw new Error('Alias can only contain lowercase letters, numbers, hyphens, and underscores');
            }
            const existingUserGroup = allUserGroups.find(ug => ug.alias === alias);
            if (existingUserGroup && existingUserGroup.id !== userGroupId) {
              throw new Error(`User group with alias '${alias}' already exists`);
            }
          }

          // Update user group
          await tx.mutate.user_groups.update({
            id: userGroupId,
            ...(name !== undefined && { name }),
            ...(alias !== undefined && { alias }),
            ...(description !== undefined && { description }),
            updatedAt: timestamp,
          });

          // Update user responsibilities if provided
          if (userResponsibilityUpdates) {
            // Check if current user has permission to update responsibilities
            const currentUserMapping = await tx.run(
              zql.user_group_mappings.where('userGroupId', userGroupId).where('userId', authData.sub).one(),
            );

            if (!currentUserMapping) {
              throw new Error('You must be a member of this group to update responsibilities');
            }

            if (currentUserMapping.responsibility !== 'MANAGER' && currentUserMapping.responsibility !== 'TEAM_LEAD') {
              throw new Error('Only users with MANAGER or TEAM_LEAD responsibility can update user responsibilities');
            }

            for (const [userId, responsibility] of Object.entries(userResponsibilityUpdates)) {
              const mapping = await tx.run(
                zql.user_group_mappings.where('userGroupId', userGroupId).where('userId', userId).one(),
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
            const updatedMappings = await tx.run(zql.user_group_mappings.where('userGroupId', userGroupId));
            const hasLeadership = updatedMappings.some(
              m => m.responsibility === 'MANAGER' || m.responsibility === 'TEAM_LEAD'
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
          // Validate user group exists
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Check if user group has tickets with terminal statuses (CANCELLED, COMPLETED)
          const terminalTickets = await tx.run(zql.tickets
            .where('userGroupId', userGroupId)
            .where(helpers =>
              helpers.or(
                helpers.cmp('statusV2', TicketStatusV2.CANCELLED),
                helpers.cmp('statusV2', TicketStatusV2.COMPLETED),
              ),
            ));

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

          // Then, delete the user group itself
          await tx.mutate.user_groups.delete({
            id: userGroupId,
          });
        },
      ),
      addUsers: defineMutator(
        z.object({ userGroupId: z.string(), userIds: z.array(z.string()), timestamp: z.number(), mappingIds: z.record(z.string(), z.string()) }),
        async ({ tx, args: { userGroupId, userIds, timestamp, mappingIds } }) => {
          // Validate user group exists
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Fetch all users to validate they exist
          const users = await Promise.all(
            userIds.map(userId => tx.run(zql.users.where('id', userId).one()))
          );
          const allUsersExist = users.every(user => user !== undefined);
          if (!allUsersExist) {
            const foundUserIds = new Set(users.filter((u): u is NonNullable<typeof u> => u !== undefined).map(u => u.id));
            const notFound = userIds.filter(id => !foundUserIds.has(id));
            throw new Error(`Users with ids '${notFound.join(', ')}' not found`);
          }

          // Fetch existing mappings to avoid duplicates
          const existingMappings = await Promise.all(
            userIds.map(userId =>
              tx.run(zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one())
            )
          );
          const existingUserIds = new Set(
            existingMappings.filter((m): m is NonNullable<typeof m> => m !== undefined).map(m => m.userId)
          );

          // Filter out users who are already in the group
          const userIdsToAdd = userIds.filter(userId => !existingUserIds.has(userId));

          // Add new users
          for (const userId of userIdsToAdd) {
            const mappingId = mappingIds[userId];
            if (!mappingId) {
              throw new Error(`mappingId is required for user ${userId}`);
            }
            await tx.mutate.user_group_mappings.insert({
              id: uuidv4(),
              userGroupId,
              userId,
              responsibility: UserResponsibility.MEMBER,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
        },
      ),
      removeUsers: defineMutator(
        z.object({ userGroupId: z.string(), userIds: z.array(z.string()) }),
        async ({ tx, args: { userGroupId, userIds } }) => {
          // Validate user group exists
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Find all mappings to be removed in a single query
          const mappingsToRemove = await Promise.all(
            userIds.map(userId =>
              tx.run(zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one())
            )
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
          projectId: z.string().optional(),
          boardType: z.nativeEnum(BoardType).optional(),
          metadata: z.any().optional(),
          stages: z
            .array(
              z.object({
                id: z.string().optional(),
                name: z.string(),
                eta: z.number(),
                sequenceNumber: z.number(),
                defaultTicketStatusV2: z.string().optional(),
                prStatuses: z.array(z.nativeEnum(PRStatusEvent)).optional(),
                approverIds: z.array(z.string()).optional(),
                formId: z.string().optional(),
              })
            )
            .optional(),
          timestamp: z.number(),
          stageIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({ tx, args: { boardId, name, projectId, boardType, metadata, stages, timestamp, stageIds = {} } }) => {
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
            ...(projectId !== undefined && { projectId }),
            ...(boardType !== undefined && { boardType }),
            ...(metadata !== undefined && { metadata: metadata as ReadonlyJSONValue }),
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });

          // Update stages if provided
          if (stages) {
            const existingStages = await tx.run(zql.stages.where('boardId', boardId));
            const now = timestamp;

            // Create maps for efficient lookup
            const existingStageMap = new Map(existingStages.map(s => [s.id, s]));
            const incomingStageIds = new Set(stages.filter(s => s.id).map(s => s.id!));

            // 1. Update existing stages or insert new ones
            for (const stage of stages) {
              if (stage.id && existingStageMap.has(stage.id)) {
                // Update existing stage
                const existing = existingStageMap.get(stage.id)!;
                // Only update if something changed
                if (
                  existing.name !== stage.name ||
                  existing.eta !== stage.eta ||
                  existing.sequenceNumber !== stage.sequenceNumber ||
                  existing.defaultTicketStatusV2 !== stage.defaultTicketStatusV2
                ) {
                  await tx.mutate.stages.update({
                    id: stage.id,
                    name: stage.name,
                    eta: stage.eta,
                    sequenceNumber: stage.sequenceNumber,
                    defaultTicketStatusV2:
                      (stage.defaultTicketStatusV2 as TicketStatusV2) || undefined,
                    updatedBy: authData.sub,
                    updatedAt: now,
                  });
                }

                // Sync PR status mappings for this stage
                if (stage.prStatuses !== undefined) {
                  // Fetch existing mappings for this stage
                  const existingMappings = await tx.run(
                    zql.stage_pr_status_mappings.where('stageId', stage.id)
                  );

                  // Create sets for comparison
                  const existingPRStatuses = new Set(existingMappings.map(m => m.prStatus));
                  const newPRStatuses = new Set(stage.prStatuses);

                  // Find mappings to delete (exist in DB but not in new array)
                  const mappingsToDelete = existingMappings.filter(
                    mapping => !newPRStatuses.has(mapping.prStatus)
                  );

                  // Find PR statuses to add (exist in new array but not in DB)
                  const prStatusesToAdd = stage.prStatuses.filter(
                    prStatus => !existingPRStatuses.has(prStatus)
                  );

                  // Delete only removed mappings
                  for (const mapping of mappingsToDelete) {
                    await tx.mutate.stage_pr_status_mappings.delete({
                      id: mapping.id,
                    });
                  }

                  // Insert only new mappings
                  for (const prStatus of prStatusesToAdd) {
                    await tx.mutate.stage_pr_status_mappings.insert({
                      id: uuidv4(),
                      stageId: stage.id,
                      prStatus: prStatus,
                      createdAt: now,
                    });
                  }
                }
              } else {
                // Insert new stage
                const newStageId = stageIds[stage.sequenceNumber];
                if (!newStageId) {
                  throw new Error(`stageId is required for stage at sequence ${stage.sequenceNumber}`);
                }
                await tx.mutate.stages.insert({
                  id: newStageId,
                  name: stage.name,
                  eta: stage.eta,
                  sequenceNumber: stage.sequenceNumber,
                  defaultTicketStatusV2:
                    (stage.defaultTicketStatusV2 as TicketStatusV2) || TicketStatusV2.STARTED,
                  boardId: boardId,
                  createdBy: authData.sub,
                  updatedBy: authData.sub,
                  createdAt: now,
                  updatedAt: now,
                });

                // Create PR status mappings for new stage
                if (stage.prStatuses && stage.prStatuses.length > 0) {
                  for (const prStatus of stage.prStatuses) {
                    await tx.mutate.stage_pr_status_mappings.insert({
                      id: uuidv4(),
                      stageId: stage.id || uuidv4(),
                      prStatus: prStatus,
                      createdAt: now,
                    });
                  }
                }
              }
            }

            // 2. Delete stages that are no longer present
            for (const existingStage of existingStages) {
              if (!incomingStageIds.has(existingStage.id)) {
                // Delete stage approvers first
                const existingApprovers = await tx.run(
                  zql.stage_approvers.where('stageId', existingStage.id)
                );
                for (const approver of existingApprovers) {
                  await tx.mutate.stage_approvers.delete({
                    id: approver.id,
                  });
                }

                // Delete PR status mappings
                const existingMappings = await tx.run(
                  zql.stage_pr_status_mappings.where('stageId', existingStage.id)
                );
                for (const mapping of existingMappings) {
                  await tx.mutate.stage_pr_status_mappings.delete({
                    id: mapping.id,
                  });
                }

                // Then delete the stage
                await tx.mutate.stages.delete({
                  id: existingStage.id,
                });
              }
            }

            // First, delete all existing STAGE context form mappings for this board
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

            // Process formId and approvers from stages array
            // Get all stages (both existing and newly created)
            const allStages = await tx.run(zql.stages.where('boardId', boardId));
            const sequenceToStageId = new Map(allStages.map(s => [String(s.sequenceNumber), s.id]));

            for (const stage of stages) {
              // Resolve stageId
              let stageId = stage.id;
              if (!stageId && stage.sequenceNumber) {
                stageId = sequenceToStageId.get(String(stage.sequenceNumber));
              }

              if (!stageId) {
                continue;
              }

              // Create form mapping if formId is provided
              if (stage.formId) {
                await tx.mutate.forms_context_mapping.insert({
                  id: `${stageId}-form-mapping`,
                  contextId: stageId,
                  contextType: FormContextType.STAGE,
                  entityType: FormEntityType.TICKET,
                  formId: stage.formId,
                });
              }

              // Delete all existing approvers for this stage
              const existingApprovers = await tx.run(
                zql.stage_approvers.where('stageId', stageId),
              );
              for (const existing of existingApprovers) {
                await tx.mutate.stage_approvers.delete({
                  id: existing.id,
                });
              }

              // Insert new approvers if provided
              if (stage.approverIds && stage.approverIds.length > 0) {
                for (const approverId of stage.approverIds) {
                  await tx.mutate.stage_approvers.insert({
                    id: `${stageId}-${approverId}`,
                    userId: approverId,
                    stageId: stageId,
                    createdAt: now,
                  });
                }
              }
            }
          }
        }
      ),
      delete: defineMutator(
        z.object({ boardId: z.string() }),
        async ({ tx, args: { boardId } }) => {
          // Validate board exists
          const board = await tx.run(zql.boards.where('id', boardId).one());
          if (!board) {
            throw new Error('Board not found');
          }

          // Check if board has tickets with terminal statuses (CANCELLED, COMPLETED)
          const terminalTickets = await tx.run(zql.tickets
            .where('boardId', boardId)
            .where(({ or, cmp }) =>
              or(
                cmp('statusV2', TicketStatusV2.CANCELLED),
                cmp('statusV2', TicketStatusV2.COMPLETED),
              ),
            ));

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
        },
      ),
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
          const existingTag = await tx.run(zql.ticket_tags
            .where('ticketId', ticketId)
            .where('name', trimmedTagName)
            .one());

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
      delete: defineMutator(
        z.object({ tagId: z.string() }),
        async ({ tx, args: { tagId } }) => {
          // Validate tag exists
          const tag = await tx.run(zql.ticket_tags.where('id', tagId).one());
          if (!tag) {
            throw new Error('Tag not found');
          }

          // Delete tag
          await tx.mutate.ticket_tags.delete({
            id: tagId,
          });
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
        async ({ tx, ctx, args: { sourceTicketId, targetTicketId, relationType, timestamp, referenceId } }) => {
          const existingReference = await tx.run(zql.ticket_reference_mappings
            .where('sourceTicketId', sourceTicketId)
            .where('targetTicketId', targetTicketId)
            .where('relationType', relationType)
            .one());

          if (existingReference) {
            throw new Error('Ticket reference already exists');
          }

          const now = timestamp;

          await tx.mutate.ticket_reference_mappings.insert({
            id: referenceId,
            sourceTicketId,
            targetTicketId,
            relationType,
            createdBy: ctx.userID,
            createdAt: now,
            updatedAt: now,
          });

          const targetTicket = await tx.run(zql.tickets.where('id', targetTicketId).one());
          const sourceTicket = await tx.run(zql.tickets.where('id', sourceTicketId).one());

          await tx.mutate.ticket_activities.insert({
            id: uuidv4(),
            ticketId: sourceTicketId,
            updatedBy: ctx.userID,
            timestamp: now,
            activityType: ActivityType.REFERENCE_TICKET,
            value: {
              action: 'created',
              relationType,
              targetTicketId,
              targetTicketTitle: targetTicket?.title ?? null,
              targetTicketXyneId: targetTicket?.xyneId ?? null,
            },
          });

          const user = await tx.run(zql.users.where('id', ctx.userID).one());
          if (!user?.name) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || targetTicketId;
          const relationLabel = formatTicketReferenceRelationLabel(relationType);
          const activityMessage = `${user.name} added related ticket "${referenceTitle}" (${relationLabel})`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              senderId: ctx.userID,
              content: activityMessage,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: now,
              metadata: {
                activityType: ActivityType.REFERENCE_TICKET,
                isTicketActivity: true,
              },
            });
          }
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

          const targetTicket = await tx.run(
            zql.tickets.where('id', reference.targetTicketId).one(),
          );
          const sourceTicket = await tx.run(
            zql.tickets.where('id', reference.sourceTicketId).one(),
          );

          await tx.mutate.ticket_activities.insert({
            id: uuidv4(),
            ticketId: reference.sourceTicketId,
            updatedBy: authData.sub,
            timestamp: timestamp,
            activityType: ActivityType.REFERENCE_TICKET,
            value: {
              action: 'updated',
              relationType,
              oldRelationType: reference.relationType,
              targetTicketId: reference.targetTicketId,
              targetTicketTitle: targetTicket?.title ?? null,
              targetTicketXyneId: targetTicket?.xyneId ?? null,
            },
          });

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          if (!user?.name) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || reference.targetTicketId;
          const newLabel = formatTicketReferenceRelationLabel(relationType);
          const oldLabel = formatTicketReferenceRelationLabel(reference.relationType);
          const activityMessage = `${user.name} updated related ticket label from "${oldLabel}" to "${newLabel}" for "${referenceTitle}"`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              senderId: authData.sub,
              content: activityMessage,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: timestamp,
              metadata: {
                activityType: ActivityType.REFERENCE_TICKET,
                isTicketActivity: true,
              },
            });
          }
        },
      ),
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const reference = await tx.run(zql.ticket_reference_mappings.where('id', id).one());
          if (!reference) {
            throw new Error('Ticket reference not found');
          }

          await tx.mutate.ticket_reference_mappings.delete({
            id,
          });

          const targetTicket = await tx.run(
            zql.tickets.where('id', reference.targetTicketId).one(),
          );
          const sourceTicket = await tx.run(
            zql.tickets.where('id', reference.sourceTicketId).one(),
          );

          await tx.mutate.ticket_activities.insert({
            id: uuidv4(),
            ticketId: reference.sourceTicketId,
            updatedBy: authData.sub,
            timestamp: Date.now(),
            activityType: ActivityType.REFERENCE_TICKET,
            value: {
              action: 'removed',
              relationType: reference.relationType,
              targetTicketId: reference.targetTicketId,
              targetTicketTitle: targetTicket?.title ?? null,
              targetTicketXyneId: targetTicket?.xyneId ?? null,
            },
          });

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          if (!user?.name) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || reference.targetTicketId;
          const relationLabel = formatTicketReferenceRelationLabel(reference.relationType);
          const activityMessage = `${user.name} removed related ticket "${referenceTitle}" (${relationLabel})`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              senderId: authData.sub,
              content: activityMessage,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: Date.now(),
              metadata: {
                activityType: ActivityType.REFERENCE_TICKET,
                isTicketActivity: true,
              },
            });
          }
        },
      ),
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
        async ({ tx, args: { id, title, channelId, viewAccessId, editAccessId, visibility, content, timestamp, participantId } }) => {
          const now = timestamp;

          await tx.mutate.canvases.insert({
            id,
            title,
            content: content || [],
            channelId,
            createdBy: authData.sub,
            viewAccessId,
            editAccessId,
            visibility: visibility || CanvasVisibility.PRIVATE,
            isTemplate: false,
            isCollaborative: false,
            docType: DocType.Canvas,
            lastEditedBy: authData.sub,
            lastEditedAt: now,
            createdAt: now,
            updatedAt: now,
            metadata: {},
          });

          // Add creator as participant with OWNER role
          await tx.mutate.canvas_participants.insert({
            id: participantId,
            canvasId: id,
            userId: authData.sub,
            role: CanvasRole.OWNER,
            joinedAt: now,
            updatedAt: now,
          });

          // Track user activity using Redis Set - O(1) operation, no DB query
          asyncTasks.push(async () => {
            try {
              await websocketService.trackUserActivity(authData.sub);
            } catch (error) {
              logger.error(`❌ [MUTATOR-CANVAS-CREATE] Failed to track user activity:`, error);
            }
          });
        },
      ),
      addParticipants: defineMutator(
        z.object({
          canvasId: z.string(),
          userIds: z.array(z.string()),
          role: z.nativeEnum(CanvasRole),
          timestamp: z.number(),
          participantIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({ tx, args: { canvasId, userIds, role, timestamp, participantIds = {} } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          // Check if requesting user is owner
          const requestingUserParticipant = await tx.run(zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userId', authData.sub)
            .one());

          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can add participants');
          }

          // Prevent editors from adding OWNERS
          if (role === CanvasRole.OWNER && requestingUserParticipant?.role === CanvasRole.EDITOR) {
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
            const existingParticipant = await tx.run(zql.canvas_participants
              .where('canvasId', canvasId)
              .where('userId', userId)
              .one());

            if (existingParticipant) {
              continue;
            }

            const canvasParticipantId = participantIds[userId];
            if (!canvasParticipantId) {
              throw new Error(`participantId is required for user ${userId}`);
            }
            await tx.mutate.canvas_participants.insert({
              id: canvasParticipantId,
              canvasId: canvasId,
              userId: userId,
              role: role,
              joinedAt: now,
              updatedAt: now,
            });
          }
        },
      ),
      removeParticipant: defineMutator(
        z.object({
          canvasId: z.string(),
          userId: z.string(),
        }),
        async ({ tx, args: { canvasId, userId } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          // Check if requesting user is owner
          const requestingUserParticipant = await tx.run(zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userId', authData.sub)
            .one());

          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can remove participants');
          }

          // Get target participant
          const targetParticipant = await tx.run(zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userId', userId)
            .one());

          if (!targetParticipant) {
            throw new Error('User is not a participant');
          }

          // Prevent removing yourself if you're the creator
          if (userId === authData.sub && canvas.createdBy === authData.sub) {
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
        async ({ tx, args: { canvasId, userId, role, timestamp } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          // Check if requesting user is owner
          const requestingUserParticipant = await tx.run(zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userId', authData.sub)
            .one());

          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);

          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can update participant roles');
          }

          if (requestingUserParticipant?.role === CanvasRole.EDITOR && role === CanvasRole.OWNER) {
            throw new Error('Editors cannot grant owner role');
          }

          // Get target participant
          const targetParticipant = await tx.run(zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userId', userId)
            .one());

          if (!targetParticipant) {
            throw new Error('User is not a participant');
          }
          if (
            requestingUserParticipant?.role === CanvasRole.EDITOR &&
            targetParticipant.role == CanvasRole.OWNER
          ) {
            throw new Error('Editors cannot change owner roles');
          }

          // Prevent changing creator's role
          if (userId === canvas.createdBy) {
            throw new Error("Cannot change canvas creator's role");
          }

          await tx.mutate.canvas_participants.update({
            id: targetParticipant.id,
            role: role,
            updatedAt: timestamp,
          });
        },
      ),
      update: defineMutator(
        z.object({
          id: z.string(),
          title: z.string().optional(),
          editAccessId: z.string().optional(),
          content: z.any().optional(),
          visibility: z.nativeEnum(CanvasVisibility).optional(),
          isCollaborative: z.boolean().optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: params }) => {
          // Verify user has edit access
          const canvas = await tx.run(zql.canvases.where('id', params.id).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const isEditLink = params.editAccessId && canvas.editAccessId === params.editAccessId;

          if (!isEditLink) {
            const participant = await tx.run(zql.canvas_participants
              .where('canvasId', canvas.id)
              .where('userId', authData.sub)
              .one());

            const canEdit =
              canvas.createdBy === authData.sub ||
              (participant &&
                (participant.role === CanvasRole.EDITOR || participant.role === CanvasRole.OWNER));

            if (!canEdit) {
              throw new Error('You do not have permission to edit this canvas');
            }
          }

          await tx.mutate.canvases.update({
            id: canvas.id,
            lastEditedBy: authData.sub,
            lastEditedAt: params.timestamp,
            updatedAt: params.timestamp,
            ...(params.title !== undefined && { title: params.title }),
            ...(params.content !== undefined && { content: params.content }),
            ...(params.visibility !== undefined && { visibility: params.visibility }),
            ...(params.isCollaborative !== undefined && { isCollaborative: params.isCollaborative }),
          });

          // Track user activity using Redis Set - O(1) operation, no DB query
          asyncTasks.push(async () => {
            try {
              await websocketService.trackUserActivity(authData.sub);
            } catch (error) {
              logger.error(`❌ [MUTATOR-CANVAS-UPDATE] Failed to track user activity:`, error);
            }
          });
        },
      ),
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const canvas = await tx.run(zql.canvases.where('id', id).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          if (canvas.createdBy !== authData.sub) {
            throw new Error('Only the creator can delete the canvas');
          }

          await tx.mutate.canvases.delete({ id });
        },
      ),
    },
    bookmark: {
      add: defineMutator(
        z.object({
          entityId: z.string(),
          entityType: z.nativeEnum(BookmarkEntityType),
          metadata: z.any().optional(),
          timestamp: z.number(),
          bookmarkId: z.string(),
        }),
        async ({ tx, args: { entityId, entityType, metadata, timestamp, bookmarkId } }) => {
          // Check if bookmark already exists
          const existing = await tx.run(zql.bookmarks
            .where('userId', authData.sub)
            .where('entityId', entityId)
            .where('entityType', entityType)
            .one());

          if (existing) {
            logger.info('[Mutator] Bookmark already exists, skipping');
            return; // Silently return instead of throwing error
          }

          await tx.mutate.bookmarks.insert({
            id: bookmarkId,
            userId: authData.sub,
            entityId: entityId,
            entityType: entityType,
            createdAt: timestamp,
            metadata: metadata,
          });
        },
      ),
      remove: defineMutator(
        z.object({
          entityId: z.string(),
          entityType: z.nativeEnum(BookmarkEntityType),
        }),
        async ({ tx, args: { entityId, entityType } }) => {
          const bookmark = await tx.run(zql.bookmarks
            .where('userId', authData.sub)
            .where('entityId', entityId)
            .where('entityType', entityType)
            .one());

          if (!bookmark) {
            throw new Error('Bookmark not found');
          }

          await tx.mutate.bookmarks.delete({
            id: bookmark.id,
          });
        },
      ),
      updateMetadata: defineMutator(
        z.object({
          entityId: z.string(),
          entityType: z.nativeEnum(BookmarkEntityType),
          metadata: z.any(),
        }),
        async ({ tx, args: { entityId, entityType, metadata } }) => {
          const bookmark = await tx.run(zql.bookmarks
            .where('userId', authData.sub)
            .where('entityId', entityId)
            .where('entityType', entityType)
            .one());

          if (!bookmark) {
            throw new Error('Bookmark not found');
          }

          await tx.mutate.bookmarks.update({
            id: bookmark.id,
            metadata: metadata,
          });
        },
      ),
    },
    nudges: {
      dismiss: defineMutator(
        z.object({
          nudgeId: z.string(),
        }),
        async ({ tx, args: { nudgeId } }) => {
          const nudge = await tx.run(zql.proactive_nudges.where('id', nudgeId).one());
          if (!nudge) {
            throw new Error('Nudge not found');
          }

          if (nudge.state !== 'ACTIVE') {
            return;
          }

          await tx.mutate.proactive_nudges.update({
            id: nudgeId,
            state: 'DISMISSED',
          });

          const message = await tx.run(zql.messages.where('messageId', nudge.messageId).one());
          if (!message) {
            return;
          }

          const activeNudges = await tx.run(
            zql.proactive_nudges.where('messageId', nudge.messageId).where('state', 'ACTIVE')
          );
          await tx.mutate.messages.update({
            messageId: message.messageId,
            nudgeCount: activeNudges.length,
          });
        },
      ),
      act: defineMutator(
        z.object({
          nudgeId: z.string(),
          actionResult: z.any().optional(),
        }),
        async ({ tx, args: { nudgeId, actionResult } }) => {
          const nudge = await tx.run(zql.proactive_nudges.where('id', nudgeId).one());
          if (!nudge) {
            throw new Error('Nudge not found');
          }

          if (nudge.state !== 'ACTIVE') {
            return;
          }

          const existingActions =
            nudge.actions && typeof nudge.actions === 'object' && !Array.isArray(nudge.actions)
              ? (nudge.actions as Record<string, unknown>)
              : {};

          await tx.mutate.proactive_nudges.update(
            actionResult
              ? {
                  id: nudgeId,
                  state: 'ACTED_ON',
                  actions: {
                    ...existingActions,
                    actionResult: actionResult as ReadonlyJSONValue,
                  },
                }
              : {
                  id: nudgeId,
                  state: 'ACTED_ON',
                }
          );

          const message = await tx.run(zql.messages.where('messageId', nudge.messageId).one());
          if (!message) {
            return;
          }

          const activeNudges = await tx.run(
            zql.proactive_nudges.where('messageId', nudge.messageId).where('state', 'ACTIVE')
          );
          await tx.mutate.messages.update({
            messageId: message.messageId,
            nudgeCount: activeNudges.length,
          });
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
        async ({ tx, args: params }) => {
          // Check if profile already exists to get the ID
          const existingProfile = await tx.run(zql.user_profiles
            .where('userId', authData.sub)
            .one());

          const profileId = existingProfile?.id || params.profileId;
          if (!profileId) {
            throw new Error('profileId is required');
          }
          const now = params.timestamp;

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
            userId: authData.sub,
            ...(params.displayName !== undefined && { displayName: params.displayName }),
            ...(params.pronunciation !== undefined && { pronunciation: params.pronunciation }),
            ...(params.team !== undefined && { team: params.team }),
            ...(params.phoneNumber !== undefined && { phoneNumber: params.phoneNumber }),
            ...(params.dob !== undefined && { dob: params.dob }),
            ...(params.manager !== undefined && { manager: params.manager }),
            updatedAt: now,
            createdAt: existingProfile ? existingProfile.createdAt || now : now,
          };

          await tx.mutate.user_profiles.upsert(profileData);
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
          timestamp: z.number(),
          presenceId: z.string(),
        }),
        async ({ tx, args: { statusEmoji, statusContent, statusExpiryAt, assignmentUnavailableUntil, timestamp, presenceId } }) => {
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
          const existingPresence = await tx.run(zql.user_presence
            .where('userId', authData.sub)
            .one());

          const actualPresenceId = existingPresence?.id || presenceId;
          if (!actualPresenceId) {
            throw new Error('presenceId is required');
          }
          const now = timestamp;

          const presenceData = {
            id: actualPresenceId,
            userId: authData.sub,
            status: UserPresenceStatus.ONLINE, // Default status
            lastActiveAt: now,
            lastSeenAt: now,
            isManual: false,
            ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji || null }),
            ...(statusContent !== undefined && { statusContent: statusContent }),
            ...(statusExpiryAt !== undefined && { statusExpiryAt: statusExpiryAt }),
            ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil: assignmentUnavailableUntil }),
            updatedAt: now,
            createdAt: existingPresence ? existingPresence.createdAt || now : now,
          };

          await tx.mutate.user_presence.upsert(presenceData);
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
            })
          ),
          boardWeight: z.object({
            boardId: z.string(),
            weight: z.number(),
            usePercentage: z.boolean(),
          }).optional(),
          expertiseMappings: z.object({
            boardId: z.string(),
            userConfigs: z.array(
              z.object({
                userId: z.string(),
                hasExpertise: z.boolean(),
                percentage: z.number(),
                maxTickets: z.number(),
              })
            ),
          }).optional(),
          timestamp: z.number(),
          stateIds: z.record(z.string(), z.string()).optional(),
          complexityScoreId: z.string().optional(),
          mappingIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({ tx, args: { userGroupId, userStates, boardWeight, expertiseMappings, timestamp, stateIds = {}, complexityScoreId, mappingIds = {} } }) => {
          const now = timestamp;

          // Validate user group exists
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Update user assignment states
          for (const state of userStates) {
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
              createdBy: existingState?.createdBy ?? authData.sub,
              updatedAt: now,
              createdAt: existingState?.createdAt ?? now,
            };

            await tx.mutate.user_assignment_states.upsert(stateData);
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
              if (!complexityScoreId) {
                throw new Error('complexityScoreId is required when creating a new board complexity score');
              }
              await tx.mutate.board_complexity_scores.insert({
                id: complexityScoreId,
                userGroupId,
                boardId: boardWeight.boardId,
                weight: boardWeight.weight,
                usePercentage: boardWeight.usePercentage,
                createdBy: authData.sub,
                createdAt: now,
                updatedAt: now,
              });
            }
          }

          // Update expertise mappings if provided
          if (expertiseMappings) {
            for (const userConfig of expertiseMappings.userConfigs) {
              const existingMapping = await tx.run(
                zql.user_expertise_mappings
                  .where('userId', userConfig.userId)
                  .where('userGroupId', userGroupId)
                  .where('boardId', expertiseMappings.boardId)
                  .one(),
              );

              // Check if needs save (any non-default values)
              const needsSave = userConfig.hasExpertise ||
                userConfig.percentage !== 100 ||
                userConfig.maxTickets !== -1;

              if (needsSave) {
                // Upsert: update if exists, insert if not
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
                  createdBy: existingMapping?.createdBy ?? authData.sub,
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
        async ({ tx, args: { id, name, url, baseBranch, prefix } }) => {
          await tx.mutate.repos.insert({
            id,
            name,
            url,
            baseBranch,
            prefix,
            createdBy: authData.sub,
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
            throw new Error('Repository not found');
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
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const repo = await tx.run(zql.repos.where('id', id).one());
          if (!repo) {
            throw new Error('Repository not found');
          }
          await tx.mutate.repos.delete({ id });
        },
      ),
      addBranch: defineMutator(
        z.object({ id: z.string(), branchName: z.string() }),
        async ({ tx, args: { id, branchName } }) => {
          const repo = await tx.run(zql.repos.where('id', id).one());
          if (!repo) {
            throw new Error('Repository not found');
          }
          const currentBranches = (repo.baseBranch as string[]) || [];
          if (!currentBranches.includes(branchName)) {
            await tx.mutate.repos.update({
              id,
              baseBranch: [...currentBranches, branchName],
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
          fieldIds: z.record(z.string(), z.string()).optional(),
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
            const fieldsToBeDeleted = existingFields.filter(field => !fields.map(f => f.id).includes(field.id))

            const now = timestamp;

            for (const field of fieldsToBeDeleted) {
              // Delete the field
              await tx.mutate.form_fields.delete({
                id: field.id,
              });
            }

            for (const field of fields) {
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
                    updatedAt: now,
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
                    formId: formId,
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    createdAt: now,
                    updatedAt: now,
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
                const newFieldId = fieldIds[existingFields.length];
                if (!newFieldId) {
                  throw new Error(`fieldId is required for new field at index ${existingFields.length}`);
                }
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
                  id: newFieldId,
                  formId: formId,
                  fieldName: field.fieldName.trim(),
                  fieldType: field.fieldType,
                  createdAt: now,
                  updatedAt: now,
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
        async ({ tx, args: { id, entityId, entityType, fieldId, newValue, timestamp, contextId } }) => {
          // Fetch the form field to determine field type
          const formField = await tx.run(zql.form_fields.where('id', fieldId).one());

          if (!formField) {
            throw new Error('Form field not found');
          }

          const fieldType = formField.fieldType;

          // Determine actualFieldValue based on field type
          const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
          const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

          // Upsert the form entity value
          await tx.mutate.form_entity_values.insert({
            id,
            entityId,
            entityType,
            fieldId,
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
            zql.form_entity_values
              .where('id', formEntityValueId)
              .related('formField')
              .one(),
          );

          if (!formEntityValue) {
            throw new Error('Form entity value not found');
          }

          const fieldType = formEntityValue.formField?.fieldType;

          // Determine what to store based on field type
          const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
          const valueToStore = isMultiValue
            ? newValue              // Store array for MULTI_SELECT/USER (including empty arrays)
            : newValue[0] || null;  // Store first element or null for other types

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

          const existingDashboard = await tx.run(zql.dashboards.where('id', id).one())

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
  resourceAccess: {
    grant: defineMutator(
      z.object({
        grants: z.array(z.object({
          id: z.string(),
          userId: z.string(),
          resourceId: z.string(),
          accessType: z.nativeEnum(AccessType),
        })),
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
        updates: z.array(z.object({
          id: z.string(),
          accessType: z.nativeEnum(AccessType),
        })),
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
        async ({ tx, args: { id, title, queryJson, entityType, dashboardId, createdBy, timestamp, mappingId } }) => {
          const now = timestamp;

          const existingQuery = await tx.run(zql.queries.where('id', id).one())

          await tx.mutate.queries.upsert({
            id: id,
            title: title.trim(),
            queryJson,
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
                activityType: ActivityType.STAGE_CHANGE_REQUEST,
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
            const actionText = hasForm ? 'resubmitted the form for' : 'resubmitted the approval request for';

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
            .where(({ or, cmp }) =>
              or(
                ...stageIdsToDelete.map(stageId => cmp('stageId', stageId)),
              ),
            ),
        );

        for (const request of requestsToDelete) {
          await tx.mutate.ticket_stage_requests.delete({ id: request.id });
        }
      },
    ),
  });
}
