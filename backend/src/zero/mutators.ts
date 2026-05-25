import { ReadonlyJSONValue, Transaction, defineMutator, defineMutators } from '@rocicorp/zero';
import { AutomationStatus } from '../automations/types/status';
import {
  ChannelRole,
  ChannelType,
  ChannelVisibility,
  MessageType,
  CallType,
  CallStatus,
  RecurringCallSeriesStatus,
  CallOrigin,
  InvitationResponse,
  MeetingStatus,
  Schema,
  ChannelScopeType,
  ChannelAddUserPolicy,
  ChannelSortOrder,
  ConversationParticipation,
  TicketStatusV2,
  TicketPriority,
  ActivityType,
  TicketReferenceRelation,
  EmailMergeMode,
  AutoDraftMode,
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
  COEStatus,
  RCAStatus,
  SEVERITY,
  AttachmentEntityType,
  AttributionConfidence,
  BaseTicketType,
  getNudgeActionBehavior,
  LinkVisibility,
  NudgeState,
  SurfaceAreaType,
  SurfaceLinkKind,
  RotationInterval,
  QueryVisualizationType,
  parseReactionsMd,
  removeReactionFromData,
  serializeReactionsMd,
  FormFieldType,
  MessageAttachment,
  createForwardedMessageXml,
  parseForwardedMessageXml,
  type BoardMetadata,
  SavedConfigContextType,
  SavedConfigVisibility,
  SavedConfigEntityName,
  WorkspaceRole,
  Status,
  OrgRole,
  DelayedMessageStatus,
  assertCanvasDestinationAccess,
  getCanvasFolderNameConflictMessage,
  rethrowCanvasFolderNameConflict,
  resolveCanvasHierarchy,
} from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { generatePlainTextContent } from "@/utils/contentUtils";
import { extractAllMentions } from '@/utils/mentionParser';
import { getStorageService } from '@/services/storage';
import { repositories } from '@/database/repositories';
import { sendAddAndRemoveParticipantsSystemMessage, sendCallSystemMessage, updateCallSystemMessageOnEnd } from '@/zero/utils/systemMessagesUtils';
import { addChannelParticipant, removeChannelParticipant } from '@/zero/utils/channelParticipantUtils';
import { convert } from 'html-to-text';
import { websocketService } from '@/services/websocketService';
import { typingService } from '@/services/typingService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { bookmarkReminderService } from '@/services/bookmarkReminderService';

import { nudgeRegistry } from '@/nudges/registry';
import { initializeRotationForGroup } from '@/utils/rotationEngine';
import { livekitService } from '@/services/liveKitService';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { calculateETADeadline, calculateWorkingDurationMs } from '@/utils/etaCalculation';
import {
  deleteDraftEntityAttachments,
  deleteDelayedMessageEntityAttachments,
} from '@/zero/utils/attachmentEntityCleanup';
import { deliverDraftServerMessage } from '@/services/messageDeliveryService';
import {
  executionOrchestrator,
  unifiedDMService,
  unifiedBotUserService,
} from '@/bots/unified/index.js';
import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import { zql } from './queries';

const storageService = getStorageService();

export type AuthData = {
  sub: string;
  email: string;
  name: string;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
};

export type ParticipantOperationType = 'participants_added' | 'participants_removed' | 'participants_joined';

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

async function decrementSurfaceNudgeCountRow(
  tx: Transaction<Schema>,
  surfaceNudgeCountId: string | null | undefined,
  timestamp: number,
): Promise<void> {
  if (!surfaceNudgeCountId) {
    return;
  }

  const countRow = await tx.run(zql.surface_nudge_counts.where('id', surfaceNudgeCountId).one());
  if (!countRow) {
    return;
  }

  if (countRow.nudgeCount <= 1) {
    await tx.mutate.surface_nudge_counts.delete({ id: countRow.id });
    return;
  }

  await tx.mutate.surface_nudge_counts.update({
    id: countRow.id,
    nudgeCount: countRow.nudgeCount - 1,
    updatedAt: timestamp,
  });
}

async function reopenClosedDmParticipants(
  tx: Transaction<Schema>,
  channelId: string,
  scopeType: string,
  timestamp: number
): Promise<void> {
  const isDM =
    scopeType === ChannelScopeType.DM ||
    scopeType === ChannelScopeType.GROUP_DM;

  if (!isDM) return;

  const closedParticipants = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('isDeleted', false)
    .where('isClosed', true));

  for (const participant of closedParticipants) {
    await tx.mutate.channel_user_status.update({
      id: participant.id,
      isClosed: false,
      updatedAt: timestamp,
    });
  }
}

async function assertCanvasChannelNotArchived(
  tx: Transaction<Schema>,
  channelId: string | null | undefined,
): Promise<void> {
  if (!channelId) {
    return;
  }

  const channel = await tx.run(zql.channels.where('id', channelId).one());
  if (!channel) {
    throw new Error('Channel not found');
  }

  if (channel.isArchived) {
    throw new Error('Channel is archived');
  }
}

/**
 * Handles the full-role-assignment path when a board has `fullRoleAssignment` enabled.
 * Assigns MANAGER, TEAM_LEAD, MEMBER (Dev), PR_REVIEWER, QA into ticket_assignments,
 * sets ticket.assignedTo = MEMBER, and optionally logs an activity + system message.
 */
async function assignFullRoles(
  tx: Transaction<Schema>,
  {
    ticketId,
    userGroupId,
    boardId,
    oldAssignedTo,
    conversationId,
    createdBy,
    creatorName,
    activityId,
    messageId,
    timestamp,
    projectId,
  }: {
    ticketId: string;
    userGroupId: string;
    boardId: string;
    oldAssignedTo: string | null | undefined;
    conversationId: string | null | undefined;
    createdBy: string;
    creatorName: string;
    activityId?: string;
    messageId?: string;
    timestamp: number;
    projectId?: string;
  }
): Promise<void> {
  logger.info(`[AUTO-ASSIGN] Board ${boardId} has fullRoleAssignment enabled for ticket ${ticketId}`);

  const fullResult = await ticketAssignmentService.assignFullRolesToTicket({
    ticketId,
    userGroupId,
    boardId,
    createdBy,
    projectId,
  });

  if (fullResult.member) {
    await tx.mutate.tickets.update({
      id: ticketId,
      assignedTo: fullResult.member,
      updatedBy: createdBy,
      updatedAt: timestamp,
    });

    if (activityId) {
      await tx.mutate.ticket_activities.insert({
        id: activityId,
        ticketId,
        updatedBy: createdBy,
        timestamp,
        activityType: ActivityType.ASSIGNED_TO,
        value: { oldValue: oldAssignedTo, newValue: fullResult.member },
      });
    }

    if (messageId && conversationId) {
      const assignedUser = await tx.run(zql.users.where('id', fullResult.member).one());
      if (assignedUser) {
        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: createdBy,
          content: `${creatorName} auto-assigned ticket to ${assignedUser.name} (full role assignment)`,
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

    logger.info(`[AUTO-ASSIGN] Full role assignment complete for ticket ${ticketId}`);
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

    const channelStatsForPolicy = channel ? await tx.run(zql.channel_stats.where('channelId', channel.id).one()) : null;
    const effectiveAddUserPolicy = channelStatsForPolicy?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
    const cannotAddUsers =
      channel?.scopeType !== ChannelScopeType.GROUP_DM &&
      senderParticipation?.role === ChannelRole.MEMBER &&
      effectiveAddUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY;

    const htmlContent = cannotAddUsers
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
          canAddUsers: !cannotAddUsers,
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
          canAddUsers: !cannotAddUsers,
        } as unknown as ReadonlyJSONValue,
      });

      // Add creator as conversation participant
      await tx.mutate.conversation_participants.insert({
        id: uuidv4(),
        conversationId: newConversationId,
        userId: senderId,
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
        joinedAt: now,
              lastReplyAt: now,
        channelId: channelId,
      });

      logger.info(`✅ [NON-PARTICIPANT] Created new conversation ${newConversationId} with system message`);
    }
  } catch (error) {
    logger.error('❌ [NON-PARTICIPANT] Error creating non-participant system messages:', error);
    // Don't throw - let the message creation succeed even if system message fails
  }
}


export function createMutators(authData: AuthData, asyncTasks: Array<() => Promise<void>>) {
  const bookmarkByEntityQuery = (entityId: string, entityType: BookmarkEntityType) =>
    zql.bookmarks
      .where('userId', authData.sub)
      .where('entityId', entityId)
      .where('entityType', entityType);

  const getBookmarkIncludingDeleted = async (
    tx: Transaction<Schema>,
    entityId: string,
    entityType: BookmarkEntityType,
  ) => {
    return tx.run(
      // eslint-disable-next-line local-rules/require-is-deleted-filter
      bookmarkByEntityQuery(entityId, entityType).one(),
    );
  };

  const getActiveBookmark = async (
    tx: Transaction<Schema>,
    entityId: string,
    entityType: BookmarkEntityType,
  ) => {
    return tx.run(
      bookmarkByEntityQuery(entityId, entityType)
        .where('isDeleted', false)
        .where('isCompleted', false)
        .one(),
    );
  };

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

  const enqueueBookmarkReminderSync = ({
    entityId,
    entityType,
    metadata,
    source,
  }: {
    entityId: string;
    entityType: BookmarkEntityType;
    metadata: unknown;
    source: string;
  }): void => {
    asyncTasks.push(async () => {
      try {
        await bookmarkReminderService.syncBookmarkReminder({
          userId: authData.sub,
          entityId,
          entityType,
          metadata,
          workspaceId: authData.workspaceId,
        });
      } catch (error) {
        logger.error('[Mutator] Failed to sync bookmark reminder job', {
          source,
          entityId,
          entityType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const enqueueBookmarkReminderCancel = ({
    entityId,
    entityType,
  }: {
    entityId: string;
    entityType: BookmarkEntityType;
  }): void => {
    asyncTasks.push(async () => {
      try {
        await bookmarkReminderService.cancelBookmarkReminder({
          userId: authData.sub,
          entityId,
          entityType,
        });
      } catch (error) {
        logger.error('[Mutator] Failed to cancel bookmark reminder job', {
          entityId,
          entityType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  return defineMutators({
    notificationSettings: {
      setChannelNotificationLevel: defineMutator(
        z.object({
          channelId: z.string(),
          desktopNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
          mobileNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, desktopNotificationLevel, mobileNotificationLevel, timestamp } }) => {
          // Get channel user status
          const userStatus = await tx.run(
            zql.channel_user_status
              .where('channelId', channelId)
              .where('isDeleted', false)
              .where('userId', authData.sub)
              .one()
          );

          if (!userStatus) {
            throw new Error('Not a channel participant');
          }

          logger.info(`[NOTIFICATION-SETTINGS] Setting channel notification for user ${authData.sub} in channel ${channelId}`, {
            desktopNotificationLevel,
            mobileNotificationLevel,
            timestamp,
            userId: authData.sub,
            channelId,
          });

          await tx.mutate.channel_user_status.update({
            id: userStatus.id,
            ...(desktopNotificationLevel !== undefined && { desktopNotificationLevel }),
            ...(mobileNotificationLevel !== undefined && { mobileNotificationLevel }),
            updatedAt: timestamp,
          });
        }
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
          const messageSender: AuthData = { name: "system", sub: "system", email: "", workspaceId: "", role: "", memberId: "", orgRole: "" }
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
          });

          await tx.mutate.channel_stats.update({
            channelId,
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
            isSubscribed: true,
            joinedAt: timestamp,
            lastReplyAt: timestamp,
            channelId: channelId,
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
          if (!participationOfRequestingUser) {
            throw new Error('You are not allowed to add someone');
          }

          if (channel.scopeType !== ChannelScopeType.GROUP_DM) {
            const channelStatsData = await tx.run(zql.channel_stats.where('channelId', channelId).one());
            const addUserPolicy = channelStatsData?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
            if (
              addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY &&
              participationOfRequestingUser.role === ChannelRole.MEMBER
            ) {
              throw new Error('Only admins can add users to this channel');
            }
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

            // // Update channel_user_status with timestamp
            // const userStatus = await tx.run(zql.channel_user_status
            //   .where('channelId', channelId)
            //   .where('userId', user.id)
            //   .one());

            // if (userStatus) {
            //   await tx.mutate.channel_user_status.update({
            //     id: userStatus.id,
            //     lastViewedAt: timestamp,
            //   });
            // }

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
        z.object({ targetUserId: z.string(), channelId: z.string(), updatedAt: z.number() }),
        async ({ tx, args: { targetUserId, channelId, updatedAt } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          const participationOfRequestingUser = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participationOfRequestingUser) {
            throw new Error('Only channel members can remove participants');
          }

          if (participationOfRequestingUser.role !== ChannelRole.ADMIN) {
            throw new Error('Only channel admins can remove participants');
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

          await removeChannelParticipant(tx, channelId, targetUserId, updatedAt);

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
        z.object({ channelId: z.string(), updatedAt: z.number() }),
        async ({ tx, args: { channelId, updatedAt } }) => {
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

          await removeChannelParticipant(tx, channelId, authData.sub, updatedAt);
        },
      ),
      updateAddUserPolicy: defineMutator(
        z.object({
          channelId: z.string(),
          policy: z.nativeEnum(ChannelAddUserPolicy),
        }),
        async ({ tx, args: { channelId, policy } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          if (channel.scopeType !== ChannelScopeType.DEFAULT) {
            throw new Error('Can only update add-user policy for default channels');
          }

          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());
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
        async ({ tx, args: { channelId } }) => {
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

          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());
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
          draftMessage: z.string(),
          draftMessageId: z.string(),
        }),
        async ({ tx, args: { channelId, conversationId, timestamp, draftMessage, draftMessageId } }) => {
          const participant = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
            .one());

          if (!participant) {
            throw new Error('Not a channel participant');
          }

          const conversationSeenCutoffAt = await getConversationSeenCutoffAt(tx, channelId, timestamp);


          const channel = await tx.run(zql.channels.where('id', channelId).one());
          const isEmailChannel = channel?.type === 'EMAIL';
          const updateData: any = {
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
          };
          if (!isEmailChannel) {
            updateData.unreadCount = 0;
          }

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
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', authData.sub),
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
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              updatedAt: timestamp,
              createdAt: draft?.createdAt || timestamp,
            });
          }

          const unreadActivities = await tx.run(
            zql.activities
              .where('userId', authData.sub)
              .where('isRead', false)
              .where('channelId', channelId),
          );

          if (unreadActivities.length === 0) {
            return;
          }


          const activityBySourceId = new Map(
            unreadActivities.map(a => [a.actionSourceId, a]),
          );
          const uniqueSourceIds = [...activityBySourceId.keys()];

          const messages = await tx.run(
            zql.messages
              .where('messageId', 'IN', uniqueSourceIds)
              .related('conversation'),
          );

          const messageByMessageId = new Map(
            messages.map(m => [m.messageId, m]),
          );

          for (const [sourceId, activity] of activityBySourceId) {
            const message = messageByMessageId.get(sourceId);
            if (message?.conversation?.initialMessageId === message?.messageId) {
              await tx.mutate.activities.update({
                id: activity.id,
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
        async ({ tx, args: { channelId, messageId, conversationId, timestamp } }) => {
          const participant = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
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
            conversationSeenCutoffAt: number;
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
              isRead: false
            });
          }
        },
      ),
      toggleStarred: defineMutator(
        z.object({ channelId: z.string(), updatedAt: z.number() }),
        async ({ tx, args: { channelId, updatedAt } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
            .one());

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
        async ({ tx, args: { channelId, updatedAt } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
            .one());

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
            isSubscribed: true,
            joinedAt: now,
              lastReplyAt: now,
            channelId: channelId,
          });
        },
      ),
      renameChannel: defineMutator(
        z.object({
          channelId: z.string(),
          name: z.string().min(2).max(80),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, name, timestamp } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          if (channel.scopeType !== ChannelScopeType.DEFAULT) {
            throw new Error('Only default channels can be renamed');
          }

          // Check if user is a participant
          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());

          if (!participant) {
            throw new Error('Only channel participants can rename the channel');
          }


          // Check for duplicate name
          const existingChannel = await tx.run(zql.channels.where('name', name).one());
          if (existingChannel && existingChannel.id !== channelId) {
            throw new Error('A channel with this name already exists');
          }

          await tx.mutate.channels.update({
            id: channelId,
            name,
            updatedAt: timestamp,
          });

        },
      ),
      reopenDm: defineMutator(
        z.object({ channelId: z.string(), updatedAt: z.number() }),
        async ({ tx, args: { channelId, updatedAt } }) => {
          const participation = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
            .one());

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
        async ({ tx, args: { channelId, boardId, updatedAt } }) => {
          const userStatus = await tx.run(zql.channel_user_status
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isDeleted', false)
            .one());

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
            isSubscribed: true,
            joinedAt: now,
              lastReplyAt: now,
            channelId: channelId,
          });
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
            throw new Error('Only channels can be unarchived');
          }

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          const archiveMessage = `archived #${channel.name}. The contents will still be browsable and available in search.`;

          // Create a new conversation for the archive message
          const conversationId = uuidv4();
          const messageId = uuidv4();
          const now = Date.now();

          await tx.mutate.conversations.insert({
            conversationId: conversationId,
            channelId,
            createdBy: authData.sub,
            createdAt: now,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
          });

          await tx.mutate.messages.insert({
            messageId,
            conversationId,
            senderId: authData.sub,
            content: archiveMessage,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: true,
            createdAt: now,
            metadata: {
              channelArchived: true,
              channelName: channel.name,
              archivedBy: user?.name || 'Unknown',
            },
          });

          await tx.mutate.channels.update({
            id: channelId,
            isArchived: true,
          });

          logger.info(`✅ [ARCHIVE-CHANNEL] Channel ${channelId} archived by ${authData.sub}`);
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

          if (!channel.isArchived) {
            throw new Error('Channel is not archived');
          }

          await tx.mutate.channels.update({
            id: channelId,
            isArchived: false,
          });

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          const unarchiveMessage = `unarchived #${channel.name}. The channel is now active again.`;

          // Create a new conversation for the unarchive message
          const conversationId = uuidv4();
          const messageId = uuidv4();
          const now = Date.now();

          await tx.mutate.conversations.insert({
            conversationId: conversationId,
            channelId,
            createdBy: authData.sub,
            createdAt: now,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
          });

          await tx.mutate.messages.insert({
            messageId,
            conversationId,
            senderId: authData.sub,
            content: unarchiveMessage,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: true,
            createdAt: now,
            metadata: {
              channelUnarchived: true,
              channelName: channel.name,
              unarchivedBy: user?.name || 'Unknown',
            },
          });

          logger.info(`✅ [UNARCHIVE-CHANNEL] Channel ${channelId} unarchived by ${authData.sub}`);
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
          timestamp: z.number(),
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
            .where('isDeleted', false)
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

          // Check for existing draft and transfer attachments
          const channelDrafts = await tx.run(zql.draft_messages
            .where('channelId', channelId)
            .where('userId', authData.sub));

          const draft = channelDrafts.find(d => d.conversationId === null);

          if (draft) {
            // Get attachments linked to this draft
            const draftAttachments = await tx.run(zql.message_attachments
              .where('entityId', draft.id)
              .where('entityType', AttachmentEntityType.DRAFT));

            // Transfer attachments to new message
            for (const attachment of draftAttachments) {
              await tx.mutate.message_attachments.update({
                id: attachment.id,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId: conversationId,
              });
            }

            await tx.mutate.draft_messages.delete({ id: draft.id });

            // Mark message as having attachments
            message.hasAttachment = draftAttachments.length > 0;
          }

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

          await tx.mutate.channel_stats.update({
            channelId: channel.id,
            lastActivityAt: now,
          });

          const conversationSeenCutoffAt = await getConversationSeenCutoffAt(tx, channel.id, now);
          await tx.mutate.channel_user_status.update({
            id: channelUserStatusParticipant.id,
            lastViewedAt: now,
            conversationSeenCutoffAt,
            lastViewedConversationId: conversationId,
            updatedAt: now,
          });

          // Auto-reopen DMs for all participants when a new conversation is started
          await reopenClosedDmParticipants(tx, channel.id, channel.scopeType, now);

          // Add conversation creator as MENTIONED participant
          await tx.mutate.conversation_participants.insert({
            id: uuidv4(),
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.MENTIONED,
            isSubscribed: true,
            joinedAt: now,
              lastReplyAt: now,
            channelId: channelId,
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
                  isSubscribed: true,
                  joinedAt: now,
              lastReplyAt: now,
                  channelId: channelId,
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
              workspaceId: authData.workspaceId,
              metadata: attachment.metadata, 
              createdAt: now,
              isDeleted: false,
            });
          }

          // --- Call Message Forwarding Specifics ---
          
          let replyCount = 0;
          const originalMetadata = originalMessage.metadata as Record<string, unknown> | undefined;
          const isCallMessage = originalMetadata?.['isCallMessage'] === true;
          
          // Define metadata for the new forwarded message
          if (isCallMessage) {
            const forwardedMessageMetadata = { ...(originalMessage.metadata as Record<string, unknown> || {}) };
            forwardedMessageMetadata['isCallMessage'] = true;
            if (originalMetadata?.['callId']) {
              forwardedMessageMetadata['callId'] = originalMetadata['callId'];
            }
            
            // Re-update the inserted message metadata with call indicators
            await tx.mutate.messages.update({
              messageId,
              metadata: forwardedMessageMetadata as any,
            });
          }

          // If it is a call message, we want to clone all non-user messages (like transcipts/summaries/system msg)
          if (isCallMessage) {
            // Get all system/bot thread messages from the original conversation
            const threadMessages = await tx.run(
              zql.messages
                .where('conversationId', originalMessage.conversationId)
            );

            // Filter for only BOT and SYSTEM messages
            const systemMessages = threadMessages.filter(msg => msg.msgType === MessageType.BOT || msg.msgType === MessageType.SYSTEM);

            replyCount = systemMessages.length;

            if (replyCount > 0) {
              // We'll just fetch them in the loop to be safe with zql limits if any
              for (let i = 0; i < systemMessages.length; i++) {
                const sysMsg = systemMessages[i]!;
                const clonedMessageId = uuidv4(); // Generate a new UUID for the duplicated message
                
                await tx.mutate.messages.insert({
                  messageId: clonedMessageId,
                  conversationId,
                  senderId: sysMsg.senderId,
                  content: sysMsg.content,
                  msgType: sysMsg.msgType,
                  hasAttachment: sysMsg.hasAttachment,
                  edited: sysMsg.edited,
                  isDeleted: sysMsg.isDeleted,
                  isSent: sysMsg.isSent,
                  showInChannel: sysMsg.showInChannel,
                  childConversationId: sysMsg.childConversationId,
                  createdAt: sysMsg.createdAt,
                  metadata: sysMsg.metadata as any,
                  visibleTo: sysMsg.visibleTo,
                });

                // If the system message had attachments, we need to clone the attachment references
                if (sysMsg.hasAttachment) {
                   const originalAtts = await tx.run(
                     zql.message_attachments
                      .where('entityId', sysMsg.messageId)
                      .where('entityType', AttachmentEntityType.CHAT)
                   );

                    for (let j = 0; j < originalAtts.length; j++) {
                      const attInfo = originalAtts[j]!;
                      await tx.mutate.message_attachments.insert({
                         id: uuidv4(),
                         entityId: clonedMessageId,
                         entityType: AttachmentEntityType.CHAT,
                         originalFilename: attInfo.originalFilename,
                         size: attInfo.size,
                         mimetype: attInfo.mimetype,
                         url: (attInfo as any).url || (attInfo as any).fileUrl || '',
                         thumbnailUrl: attInfo.thumbnailUrl,
                         uploadedByUserId: authData.sub,
                         createdBy: authData.sub,
                         storageProvider: (attInfo as any).storageProvider || config.fileStorage.provider,
                         conversationId: conversationId,
                         workspaceId: authData.workspaceId,
                         metadata: attInfo.metadata as any,
                         createdAt: now,
                        isDeleted: false,
                      });
                    }
                }
              }
            }
          }

          // Update reply count if bots were added
          if (replyCount > 0) {
            await tx.mutate.conversations.update({
               conversationId,
               replyCount
            });
          }

          // Update channel last activity in channel_stats
          await tx.mutate.channel_stats.update({
            channelId: targetChannelId,
            lastActivityAt: now,
          });

          // Update user's last viewed time
          const userStatus = await tx.run(
            zql.channel_user_status
              .where('channelId', targetChannelId)
              .where('userId', authData.sub)
              .where('isDeleted', false)
              .one()
          );
          if (userStatus) {
            const conversationSeenCutoffAt = await getConversationSeenCutoffAt(tx, targetChannelId, now);
            await tx.mutate.channel_user_status.update({
              id: userStatus.id,
              lastViewedAt: now,
              conversationSeenCutoffAt,
              lastViewedConversationId: conversationId,
              updatedAt: now,
            });
          }

          // Add creator as conversation participant
          await tx.mutate.conversation_participants.insert({
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: now,
              lastReplyAt: now,
            channelId: targetChannelId,
          });

          logger.info(
            `📤 [MUTATOR-FORWARD] Message ${originalMessageId} forwarded to channel ${targetChannelId} as ${messageId}`
          );
        }
      ),
      subscribeToConversation: defineMutator(
        z.object({
          conversationId: z.string(),
          timestamp: z.number(),
          participantId: z.string(),
        }),
        async ({ tx, args: { conversationId, timestamp, participantId } }) => {
          // Check if conversation exists
          const conversation = await tx.run(
            zql.conversations.where('conversationId', conversationId).one()
          );
          
          if (!conversation) {
            throw new Error('Conversation not found');
          }

          // Check if user is already a participant
          const existingParticipant = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one()
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
            userId: authData.sub,
            participationType: null as any, // Manual subscription (null = not AUTHOR/MENTIONED)
            isSubscribed: true,
            joinedAt: timestamp,
            lastReplyAt: timestamp,
            channelId: conversation.channelId,
          });
        }
      ),
      unsubscribeFromConversation: defineMutator(
        z.object({
          conversationId: z.string(),
        }),
        async ({ tx, args: { conversationId } }) => {
          // Find user's subscription
          const subscription = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one()
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

          // Check for existing draft and transfer attachments
          const channelDrafts = await tx.run(zql.draft_messages
            .where('channelId', conversation.channelId)
            .where('userId', authData.sub));

          const draft = channelDrafts.find(d => d.conversationId === conversationId);

          if (draft) {
            // Get attachments linked to this draft
            const draftAttachments = await tx.run(zql.message_attachments
              .where('entityId', draft.id)
              .where('entityType', AttachmentEntityType.DRAFT));

            // Transfer attachments to new message
            for (const attachment of draftAttachments) {
              await tx.mutate.message_attachments.update({
                id: attachment.id,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId: conversationId,
              });
            }

            await tx.mutate.draft_messages.delete({ id: draft.id });

            // Mark message as having attachments
            message.hasAttachment = draftAttachments.length > 0;
          }

          // Update sender's lastReadAt BEFORE inserting the message so Zero's reactive
          // store has the updated value in the same cycle as (or before) the message
          // appears — preventing the "New Messages" banner from flashing on the sender's
          // own message.
          const existingParticipantForLastRead = await tx.run(zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', authData.sub)
            .one());

          if (existingParticipantForLastRead) {
            await tx.mutate.conversation_participants.update({
              id: existingParticipantForLastRead.id,
              lastReadAt: timestamp,
            });
          }

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

          // Update lastReplyAt on all participants for this conversation
          // (denormalized for userConversationsPaginatedV2 query)
          const allParticipants = await tx.run(zql.conversation_participants
            .where('conversationId', conversationId));
          for (const p of allParticipants) {
            await tx.mutate.conversation_participants.update({
              id: p.id,
              lastReplyAt: timestamp,
            });
          }

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
            .where('isDeleted', false)
            .one());

          if (senderParticipation) {
            const conversationSeenCutoffAt = await getConversationSeenCutoffAt(
              tx,
              channel.id,
              timestamp,
            );
            await tx.mutate.channel_user_status.update({
              id: senderParticipation.id,
              lastViewedAt: timestamp,
              conversationSeenCutoffAt,
              updatedAt: timestamp,
            });
          }

          //Activity related updates

          // Auto-reopen DMs for all participants when a new message is sent
          await reopenClosedDmParticipants(tx, channel.id, channel.scopeType, timestamp);

          // Add or upgrade sender as AUTHOR participant in conversation.
          // lastReadAt is already updated before messages.insert above; here we only
          // handle participationType promotion and new participant insertion.
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
            // lastReadAt already updated before messages.insert — no duplicate write needed
          } else {
            // Add as new AUTHOR participant (lastReadAt set here since the early block
            // only updates existing participants)
            await tx.mutate.conversation_participants.insert({
              id: uuidv4(),
              conversationId,
              userId: authData.sub,
              participationType: ConversationParticipation.AUTHOR,
              isSubscribed: true,
              joinedAt: timestamp,
            lastReplyAt: timestamp,
              lastReadAt: timestamp,
              channelId: conversation.channelId,
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
                  isSubscribed: true,
                  joinedAt: timestamp,
            lastReplyAt: timestamp,
                  channelId: conversation.channelId,
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
                  isSubscribed: true,
                  joinedAt: timestamp,
            lastReplyAt: timestamp,
                  channelId: conversation.channelId,
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
          // Look up conversation to get channelId for denormalized field
          const mentionConversation = newlyMentionedUsers.length > 0
            ? await tx.run(zql.conversations.where('conversationId', message.conversationId).one())
            : null;
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
                  isSubscribed: true,
                  joinedAt: now,
              lastReplyAt: now,
                  channelId: mentionConversation?.channelId,
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
              const data = parseReactionsMd(message.reactions_md);
              const updatedData = removeReactionFromData(data, decodedEmoji, authData.sub);
              const updatedMd = serializeReactionsMd(updatedData);

              await tx.mutate.messages.update({
                messageId,
                reactions_md: updatedMd,
              });

              return;
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
            // Enforce addUserPolicy before adding anyone
            const channel = await tx.run(zql.channels.where('id', channelId).one());
            if (!channel) throw new Error('Channel not found');

            if (channel.scopeType !== ChannelScopeType.GROUP_DM) {
              const actionChannelStats = await tx.run(zql.channel_stats.where('channelId', channelId).one());
              const addUserPolicy = actionChannelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
              if (addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY) {
                const senderParticipation = await tx.run(
                  zql.channel_participants
                    .where('channelId', channelId)
                    .where('userId', authData.sub)
                    .one()
                );
                if (senderParticipation?.role === ChannelRole.MEMBER) {
                  throw new Error('Only admins can add users to this channel');
                }
              }
            }

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

          const channelCopies = await tx.run(zql.conversations
            .where('initialMessageId', messageId));

          for (const channelCopy of channelCopies) {
            if (channelCopy.conversationId === conversation.conversationId) {
              continue;
            }

            await tx.mutate.conversations.delete({
              conversationId: channelCopy.conversationId,
            });
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
                      await storageService.deleteFile(attachment.url);

                      // Also delete thumbnail if it exists
                      if (attachment.thumbnailUrl) {
                        await storageService.deleteFile(attachment.thumbnailUrl);
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

          if (
            attachment.entityType !== AttachmentEntityType.DRAFT &&
            attachment.entityType !== AttachmentEntityType.CHAT
          ) {
            await tx.mutate.message_attachments.delete({ id: attachmentId });
            asyncTasks.push(async () => {
              try {
                if (attachment.url) {
                  await storageService.deleteFile(attachment.url);
                  if (attachment.thumbnailUrl) {
                    await storageService.deleteFile(attachment.thumbnailUrl);
                  }
                }
              } catch (error) {
                logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
              }
            });
            return;
          }

          if (attachment.entityType === AttachmentEntityType.CHAT) {
            const message = await tx.run(zql.messages
              .where('messageId', attachment.entityId)
              .one());

            if (!message) {
              throw new Error("Attachment doesn't belong to a message");
            }

            if (message.senderId !== authData.sub) {
              throw new Error('Only sender of attachment can delete it');
            }

            // Soft-delete: mark the attachment as deleted instead of removing it
            await tx.mutate.message_attachments.update({
              id: attachmentId,
              isDeleted: true,
            });

            // Check if there are any remaining non-deleted attachments for this message
            const remainingAttachments = await tx.run(zql.message_attachments
              .where('entityId', message.messageId)
              .where('isDeleted', false));

            // Only update hasAttachment flag if no non-deleted attachments remain
            if (remainingAttachments.length === 0) {
              const plainText = convert(message.content, {
                wordwrap: false,
                preserveNewlines: false
              }).trim()

              if (plainText === '') {
                // All attachments are soft-deleted and message body is empty.
                // Keep the message so tombstones ("This file was deleted.") remain visible.
                // Do NOT delete the message.
              }
              // Note: we intentionally do NOT set hasAttachment: false — the soft-deleted
              // attachments still need to appear as tombstones in the UI.
            }
          } else {
            await tx.mutate.message_attachments.delete({ id: attachmentId });

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

          asyncTasks.push(async () => {
            // Delete attachment file from gcs
            try {
              if (attachment.url) {
                await storageService.deleteFile(attachment.url);

                // Also delete thumbnail if it exists
                if (attachment.thumbnailUrl) {
                  await storageService.deleteFile(attachment.thumbnailUrl);
                }
              }
            } catch (error) {
              logger.error(`Failed to delete GCS file for attachmentId ${attachment.id}:`, error);
            }
          });
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
            callOrigin: CallOrigin.CHANNEL,
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
            meetingStatus: MeetingStatus.ACCEPTED,
            isExternal: false,
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
                  meetingStatus: MeetingStatus.PENDING,
                  isExternal: false,
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
                  isExternal: false,
                  response: InvitationResponse.INVITED,
                  respondedAt: null,
                  joinedAt: null,
                  leftAt: null,
                  meetingStatus: MeetingStatus.PENDING,
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

          if (call.status !== CallStatus.ACTIVE && call.status !== CallStatus.SCHEDULED) {
            throw new Error('Call is not active');
          }

          const now = timestamp;

          // If call is SCHEDULED, create system message and mark as ACTIVE
          if (call.status === CallStatus.SCHEDULED) {
            const callMetadata = call.metadata as { systemMessageId?: string; conversationId?: string } | null;

            // Only create system message if conversationId doesn't exist
            if (!callMetadata?.conversationId) {
              const result = await sendCallSystemMessage(tx, {
                callExternalId: call.externalId,
                channelId: call.channelId ?? '',
                initiatorUserName: authData.name,
              });

              await tx.mutate.calls.update({
                id: call.id,
                status: CallStatus.ACTIVE,
                startedAt: now,
                lastActivityAt: now,
                updatedAt: now,
                metadata: {
                  systemMessageId: result.messageId,
                  conversationId: result.conversationId,
                },
              });
            } else {
              // Just update status, keep existing metadata
              await tx.mutate.calls.update({
                id: call.id,
                status: CallStatus.ACTIVE,
                startedAt: now,
                lastActivityAt: now,
                updatedAt: now,
              });
            }
          }

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
              meetingStatus: MeetingStatus.ACCEPTED,
              isExternal: false,
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
            // If endsAt exists and current time hasn't passed it, keep as SCHEDULED
            // Otherwise, mark as ENDED
            const scheduleStatus = call.endsAt && now < call.endsAt ? CallStatus.SCHEDULED : CallStatus.ENDED;
            const endedAt = now;

            await tx.mutate.calls.update({
              id: call.id,
              status: scheduleStatus,
              endedAt: now,
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

              const totalCount = joinedParticipants.length;

              if (totalCount > 0) {
                await updateCallSystemMessageOnEnd(tx, {
                  messageId: callMetadata.systemMessageId,
                  participants: joinedParticipants,
                  startedAt: call.startedAt,
                  totalCount,
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
                meetingStatus: MeetingStatus.PENDING,
                isExternal: false
              });
            }
          }

          // Notify all connected LiveKit clients that participants changed
          // This triggers RoomMetadataChanged so native apps can refresh the participant list
          asyncTasks.push(async () => {
            void livekitService.sendParticipantsChanged(callId);
          });
        },
      ),
      cancel: defineMutator(
        z.object({ callId: z.string(), timestamp: z.number(), cancelEntireSeries: z.boolean().optional() }),
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
        }
      ),
      approveLobbyRequest: defineMutator(
        z.object({ callId: z.string(), participantId: z.string() }),
        async ({ tx, args: { callId, participantId } }) => {
          const call = await tx.run(zql.calls.where('id', callId).one());
          if (!call) throw new Error('Call not found');
          if (call.createdByUserId !== authData.sub) {
            throw new Error('Only the call creator can admit participants');
          }
          await tx.mutate.call_participants.update({
            id: participantId,
            response: InvitationResponse.ACCEPTED,
            respondedAt: Date.now(),
          });
        }
      ),
      rejectLobbyRequest: defineMutator(
        z.object({ callId: z.string(), participantId: z.string() }),
        async ({ tx, args: { callId, participantId } }) => {
          const call = await tx.run(zql.calls.where('id', callId).one());
          if (!call) throw new Error('Call not found');
          if (call.createdByUserId !== authData.sub) {
            throw new Error('Only the call creator can decline participants');
          }
          await tx.mutate.call_participants.update({
            id: participantId,
            response: InvitationResponse.DECLINED,
            respondedAt: Date.now(),
          });
        }
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
          timestamp: z.number(),
        }),
        async ({ tx, args: { actorAction, classification, timestamp } }) => {
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
                .where('channelId', 'IN', uniqueChannelIds)
                .where('isDeleted', false),
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
        z.object({ conversationId: z.string(), draftMessage: z.string(), draftMessageId: z.string(), timestamp: z.number() }),
        async ({ tx, args: { conversationId, draftMessage, draftMessageId, timestamp } }) => {
          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          const channelId = conversation.channelId;

          const draft = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one(),
          );

          if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
            await tx.mutate.draft_messages.delete({ id: draft.id });
          } else if (draftMessage.trim() !== '') {
            await tx.mutate.draft_messages.upsert({
              id: draft?.id || draftMessageId,
              conversationId,
              channelId,
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              updatedAt: timestamp,
              createdAt: draft?.createdAt || timestamp,
            });
          }

          const unreadActivities = await tx.run(zql.activities
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .where('isRead', false)
            .where('actionSource', 'message'));

          if (unreadActivities.length === 0) {
            return;
          }

          const activityBySourceId = new Map(
            unreadActivities.map(a => [a.actionSourceId, a]),
          );
          const uniqueSourceIds = [...activityBySourceId.keys()];

          const messages = await tx.run(
            zql.messages
              .where('messageId', 'IN', uniqueSourceIds)
              .related('conversation'),
          );

          const messageByMessageId = new Map(
            messages.map(m => [m.messageId, m]),
          );

          for (const [sourceId, activity] of activityBySourceId) {
            const message = messageByMessageId.get(sourceId);
            if (message?.conversation?.initialMessageId !== message?.messageId) {
              await tx.mutate.activities.update({
                id: activity.id,
                isRead: true,
              });
            }
          }
        },
      ),
      markThreadActivitiesAsReadV2: defineMutator(
        z.object({ conversationId: z.string(), draftMessage: z.string(), draftMessageId: z.string(), timestamp: z.number(), participantId: z.string() }),
        async ({ tx, args: { conversationId, draftMessage, draftMessageId, timestamp, participantId } }) => {
          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          const channelId = conversation.channelId;

          // Query for drafts in this channel for this user (follows backend logic)
          const draft = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one(),
          );

          if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
            await tx.mutate.draft_messages.delete({ id: draft.id });
          } else if (draftMessage.trim() !== '') {
            await tx.mutate.draft_messages.upsert({
              id: draft?.id || draftMessageId,
              conversationId,
              channelId,
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              updatedAt: timestamp,
              createdAt: draft?.createdAt || timestamp,
            });
          }

                  // Update ConversationParticipant.lastReadAt to track when user last read this thread
          let participant = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one(),
          );

          if (!participant) {
            await tx.mutate.conversation_participants.insert({
              id: participantId,
              conversationId,
              userId: authData.sub,
              joinedAt: timestamp,
            lastReplyAt: timestamp,
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

          const messagesInConversation = await tx.run(
            zql.messages.where('conversationId', conversationId),
          );

          if (messagesInConversation.length === 0) {
            return;
          }

          const messageIdsInConversation = messagesInConversation.map(m => m.messageId);

          const unreadActivities = await tx.run(
            zql.activities
              .where('userId', authData.sub)
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
            messageData.map(data =>
              tx.run(zql.messages.where('messageId', data.sourceId).one()),
            ),
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
    conversation: {
      markThreadUnreadFrom: defineMutator(
        z.object({
          conversationId: z.string(),
          messageId: z.string(),
          participantId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { conversationId, messageId, participantId, timestamp } }) => {
          // Fetch the conversation
          const conversation = await tx.run(
            zql.conversations.where('conversationId', conversationId).one(),
          );
          if (!conversation) {
            logger.warn('[markThreadUnreadFrom] Conversation not found', { conversationId });
            return;
          }

          // Resolve the target message
          let message = await tx.run(zql.messages.where('messageId', messageId).one());
          if (!message) {
            logger.warn('[markThreadUnreadFrom] Message not found', { messageId });
            return;
          }

          // If root message selected in thread, start from the first reply instead
          if (messageId === conversation.initialMessageId) {
            const firstReplies = await tx.run(
              zql.messages
                .where('conversationId', conversationId)
                .where('messageId', '!=', conversation.initialMessageId)
                .orderBy('createdAt', 'asc')
                .limit(1),
            );
            if (!firstReplies[0]) return; // no replies yet, nothing to mark
            message = firstReplies[0];
          }

          const newLastReadAt = message.createdAt - 1;

          // Upsert conversation_participants.lastReadAt
          const existingParticipant = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one(),
          );

          if (!existingParticipant) {
            await tx.mutate.conversation_participants.insert({
              id: participantId,
              conversationId,
              userId: authData.sub,
              joinedAt: timestamp,
              channelId: conversation.channelId,
              lastReadAt: newLastReadAt,
              lastReplyAt: conversation.lastActivityAt,
              isSubscribed: true,
              participationType: null,
            });
          } else {
            await tx.mutate.conversation_participants.update({
              id: existingParticipant.id,
              lastReadAt: newLastReadAt,
            });
          }

          // Fetch all messages in the thread at/after the selected message,
          // then find activities pointing to those messages (mirrors markThreadActivitiesAsReadV2).
          // Using messageId IN avoids the replied_v2 createdAt staleness issue.
          const messagesAtOrAfter = await tx.run(
            zql.messages
              .where('conversationId', conversationId)
              .where('createdAt', '>=', message.createdAt),
          );
          const messageIds = messagesAtOrAfter.map(m => m.messageId);

          const threadActivities = messageIds.length > 0
            ? await tx.run(
                zql.activities
                  .where('userId', authData.sub)
                  .where('messageId', 'IN', messageIds),
              )
            : [];

          logger.info('[markThreadUnreadFrom] Thread activities to mark unread', {
            conversationId,
            messageId,
            count: threadActivities.length,
          });

          // Mark activities as unread sequentially
          const activitiesToMarkUnread = threadActivities.filter(a => a.isRead);
          for (const activity of activitiesToMarkUnread) {
            await tx.mutate.activities.update({
              id: activity.id,
              isRead: false,
            });
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
          isArchived: z.boolean().optional(),
          kanbanPosition: z.string().nullable().optional(),
          updatedAt: z.number(),
        }),
        async ({ tx, args: params }) => {
          const ticket = await tx.run(zql.tickets.where("id", params.id).one());
          if (!ticket) throw new Error("Ticket not found");

          const now = Date.now();
          if (params.eta !== undefined && params.eta !== null && params.eta < now) {
            throw new Error("ETA cannot be set to a past date");
          }
          
          if (params.isArchived === true && !ticket.isArchived) {
            if (ticket.statusV2 !== TicketStatusV2.COMPLETED && ticket.statusV2 !== TicketStatusV2.CANCELLED) {
              throw new Error('Ticket must be in Completed or Cancelled status to be archived');
            }
          }

          // ACL Business Logic: Check ticket transfer permission for assignedTo, userGroupId,
          // eta, stageName (which triggers stage ETA recalculation), or boardId changes
          const isAssigneeChanging = params.assignedTo !== undefined && params.assignedTo !== ticket.assignedTo;
          const isUserGroupChanging = params.userGroupId !== undefined && params.userGroupId !== ticket.userGroupId;
          const isEtaChanging = params.eta !== undefined && params.eta !== ticket.eta;
          const isBoardChanging = params.boardId !== undefined && params.boardId !== ticket.boardId;

          if ((isAssigneeChanging || isUserGroupChanging || isEtaChanging|| isBoardChanging) && ticket.userGroupId) {
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
                  throw new Error('Only users with MANAGER or TEAM_LEAD responsibility can modify Assignee, ETA, Stage, or Board on this board');
                }
              }
            }
          }

          const updateData: any = { updatedAt: params.updatedAt, updatedBy: authData.sub };
          const activities: any[] = [];
          const fields = ['title', 'description', 'statusV2', 'priority', 'stageName', 'assignedTo', 'userGroupId', 'eta', 'boardId', 'metadata', 'isArchived', 'kanbanPosition'] as const;
          const oldAssignedTo = ticket.assignedTo;
          const oldBoardId = ticket.boardId;

          
          // Handle board transfer
          if (params.boardId !== undefined && params.boardId !== oldBoardId) {
            const now = Date.now();

            // 1. Fetch all stages of the new board
            const newBoardStages = await tx.run(
              zql.stages
                .where('boardId', params.boardId)
                .orderBy('sequenceNumber', 'asc')
            );

            if (newBoardStages.length === 0) {
              throw new Error(`No stages found for board ${params.boardId}`);
            }

            const firstStage = newBoardStages[0];

            // 2. Calculate total ETA from new board's stages (same logic as ticket creation)
            const totalEtaHours = newBoardStages.reduce((sum, stage) => sum + (stage.eta || 0), 0);
            const newTicketEta = totalEtaHours > 0 
              ? calculateETADeadline(new Date(now), totalEtaHours).getTime() 
              : null;

            // 3. Update ticket with first stage and new ETA
            const existingTicketsInFirstStage = await tx.run(
              zql.tickets
                .where('boardId', params.boardId)
                .where('stageName', firstStage.name)
                .where('kanbanPosition', 'IS NOT', null)
                .orderBy('kanbanPosition', 'asc')
                .limit(1)
            );
            const firstWithPosition = existingTicketsInFirstStage[0];
            let newKanbanPosition: string;
            try {
              newKanbanPosition = generateKeyBetween(null, firstWithPosition?.kanbanPosition ?? null);
            } catch {
              newKanbanPosition = generateKeyBetween(null, null);
            }
            await tx.mutate.tickets.update({
              id: params.id,
              stageName: firstStage.name,
              ...(firstStage.defaultTicketStatusV2 && {
                statusV2: firstStage.defaultTicketStatusV2
              }),
              ...(newTicketEta && { eta: newTicketEta }),
              kanbanPosition: newKanbanPosition,
              updatedAt: now,
              updatedBy: authData.sub
            });

            // 4. Delete ALL old ticket_stage_eta entries
            const oldStageEtaEntries = await tx.run(
              zql.ticket_stage_eta.where('ticketId', params.id)
            );

            for (const entry of oldStageEtaEntries) {
              await tx.mutate.ticket_stage_eta.delete({ id: entry.id });
            }

            // 5. Create new stage ETA entry for first stage (if it has ETA)
            if (firstStage.eta !== null && firstStage.eta > 0) {
              const stageEtaDeadline = calculateETADeadline(new Date(now), firstStage.eta).getTime();
              const newEntryId = uuidv4();
              
              await tx.mutate.ticket_stage_eta.insert({
                id: newEntryId,
                ticketId: params.id,
                stageId: firstStage.id,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: stageEtaDeadline,
                createdAt: now,
                updatedBy: authData.sub
              });
            }
            if(ticket.userGroupId){
              // Fire and forget - retrigger autoassignment for the new board
              asyncTasks.push(async () => {
                try {
                  logger.info(`[MUTATOR-TICKET-UPDATE] Board changed from ${oldBoardId} to ${params.boardId}, retriggering autoassignment for userGroupId: ${ticket.userGroupId}`);

                  const newBoardId = params.boardId!;
                  const boardRow = await tx.run(zql.boards.where('id', newBoardId).one());
                  const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

                  if (boardMetadata?.fullRoleAssignment === true) {
                    await assignFullRoles(tx, {
                      ticketId: params.id,
                      userGroupId: ticket.userGroupId!,
                      boardId: newBoardId,
                      oldAssignedTo: ticket.assignedTo,
                      conversationId: null,
                      createdBy: authData.sub,
                      creatorName: authData.name,
                      timestamp: Date.now(),
                      projectId: ticket.projectId,
                    });
                  } else {
                    const assignmentResult = await evaluateAssignmentRule(ticket.userGroupId!, newBoardId, undefined, undefined, ticket.projectId);
                    if (assignmentResult.assignedUserId) {
                      logger.info(`[MUTATOR-TICKET-UPDATE] Autoassignment result: assigning to ${assignmentResult.assignedUserId}`);
                      
                      // Update the ticket with the auto-assigned user using tx.mutate
                      await tx.mutate.tickets.update({
                        id: params.id,
                        assignedTo: assignmentResult.assignedUserId,
                        updatedAt: Date.now(),
                        updatedBy: authData.sub,
                      });

                      // Sync workload for the newly assigned user (async, non-blocking)
                      asyncTasks.push(async () => {
                        try {
                          await syncUserWorkload(
                            assignmentResult.assignedUserId!,
                            ticket.userGroupId!,
                            newBoardId,
                            authData.sub
                          );
                        } catch (error) {
                          logger.error('[Workload Sync] Failed to sync workload after board change:', error);
                        }
                      });
                    }
                  }
                } catch (error) {
                  console.error(`[MUTATOR-TICKET-UPDATE] Failed to retrigger autoassignment for board change:`, error);
                }
              });
            }
          }

          // StatusV2 pause/unpause handling:
          // - Always track status change timestamp in statusUpdatedAt
          // - When leaving PAUSED (and ETA isn't explicitly set), push ETA forward by effective paused working duration.
          // - When ETA is manually changed while PAUSED, reset statusUpdatedAt to restart the pause timer
          if (params.statusV2 !== undefined && params.statusV2 !== ticket.statusV2 && params.boardId === undefined) {
            updateData.statusUpdatedAt = params.updatedAt;

            const isLeavingPaused =
              ticket.statusV2 === TicketStatusV2.PAUSED && params.statusV2 !== TicketStatusV2.PAUSED;

            if (isLeavingPaused && params.eta === undefined && ticket.eta) {
              const pausedAt = ticket.statusUpdatedAt ?? params.updatedAt;
              const pausedDurationMs = calculateWorkingDurationMs(
                new Date(pausedAt),
                new Date(params.updatedAt),
              );

              if (pausedDurationMs > 0) {
                const baseMs = Math.max(ticket.eta, pausedAt);
                const pausedHours = pausedDurationMs / (60 * 60 * 1000);
                updateData.eta = calculateETADeadline(new Date(baseMs), pausedHours).getTime();
              }
            }
          }

          // Reset pause timer if ETA is manually changed while ticket is PAUSED
          if (
            params.eta !== undefined &&
            params.eta !== ticket.eta &&
            ticket.statusV2 === TicketStatusV2.PAUSED
          ) {
            updateData.statusUpdatedAt = params.updatedAt;
          }

          for (const field of fields) {
            if (params[field] !== undefined && params[field] !== ticket[field]) {
              updateData[field] = params[field];
              if (field === 'kanbanPosition') continue;
              let activityType = field.toUpperCase();
              if (field === 'stageName') activityType = 'STATUS';
              if (field === 'statusV2') activityType = 'STATUS';
              if (field === 'assignedTo') activityType = 'ASSIGNED_TO';
              if (field === 'userGroupId') activityType = 'USER_GROUP_ID';
              if (field === 'eta') activityType = 'ETA';
              if (field === 'boardId') activityType = 'BOARD';
              if (field === 'isArchived') activityType = 'IS_ARCHIVED';

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
                if (newStage.eta !== null && newStage.eta > 0) {
                  if (existingEntry) {
                    // Re-entering a stage - reactivate it
                    const newStageEtaDeadline = calculateETADeadline(
                      new Date(existingEntry.stageEnteredAt),
                      newStage.eta // Add stage ETA hours
                    ).getTime();
                    await tx.mutate.ticket_stage_eta.update({
                      id: existingEntry.id,
                      stageLeftAt: null,
                      stageEta: newStageEtaDeadline,
                      updatedAt: now,
                      updatedBy: authData.sub
                    });
                  } else {
                    // First time entering this stage - create new entry only if stage has ETA
                      const newEntryId = uuidv4();
                      const stageEtaDeadline = calculateETADeadline(new Date(now), newStage.eta).getTime();
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
                  // Create new entry only if stage has ETA
                  if (newStage.eta !== null && newStage.eta > 0) {
                    const stageEtaDeadline = calculateETADeadline(new Date(now), newStage.eta).getTime();
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
          }

          await tx.mutate.tickets.update({ id: params.id, ...updateData });

          // Sync workload for assignedTo changes (async, non-blocking)
          if (params.assignedTo !== undefined && params.assignedTo !== oldAssignedTo && ticket.userGroupId && ticket.boardId) {
            const usersToSync = [oldAssignedTo, params.assignedTo].filter(Boolean) as string[];
            for (const userId of usersToSync) {
              asyncTasks.push(async () => {
                try {
                  await syncUserWorkload(userId, ticket.userGroupId!, ticket.boardId!, authData.sub);
                } catch (error) {
                  logger.error(`[Workload Sync] Failed for user ${userId}:`, error);
                }
              });
            }
          }

          // Sync workload for statusV2 changes that affect active task count (async, non-blocking)
          if (params.statusV2 !== undefined && params.statusV2 !== ticket.statusV2 && ticket.assignedTo && ticket.userGroupId && ticket.boardId) {
            const ACTIVE_STATUSES = ['TODO', 'STARTED'];
            const wasActive = ACTIVE_STATUSES.includes(ticket.statusV2);
            const isActive = ACTIVE_STATUSES.includes(params.statusV2);
            if (wasActive !== isActive) {
              asyncTasks.push(async () => {
                try {
                  await syncUserWorkload(ticket.assignedTo!, ticket.userGroupId!, ticket.boardId!, authData.sub);
                } catch (error) {
                  logger.error(`[Workload Sync] Failed after status change:`, error);
                }
              });
            }
          }

          // Auto-assign ticket when userGroupId changes
          if (params.userGroupId !== undefined && params.userGroupId !== ticket.userGroupId && params.userGroupId !== null) {
            // Generate IDs and use timestamp outside async task (common pattern)
            const activityId = uuidv4();
            const messageId = uuidv4();
            const timestamp = params.updatedAt;
            const creatorName = authData.name;
            // Use the new board if changed, otherwise use existing board
            const targetBoardId = params.boardId !== undefined ? params.boardId : ticket.boardId;

            asyncTasks.push(async () => {
              try {
                // Skip auto-assignment if no board is available
                if (!targetBoardId) {
                  logger.info(`[AUTO-ASSIGN] Skipping auto-assignment for ticket ${params.id}: no board available`);
                  return;
                }

                const boardRow = await tx.run(zql.boards.where('id', targetBoardId).one());
                const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

                if (boardMetadata?.fullRoleAssignment === true) {
                  await assignFullRoles(tx, {
                    ticketId: params.id,
                    userGroupId: params.userGroupId!,
                    boardId: targetBoardId,
                    oldAssignedTo: ticket.assignedTo,
                    conversationId: ticket.conversationId,
                    createdBy: authData.sub,
                    creatorName,
                    activityId,
                    messageId,
                    timestamp,
                    projectId: ticket.projectId,
                  });
                } else {
                const assignmentResult = await evaluateAssignmentRule(
                  params.userGroupId!,
                  targetBoardId,
                  AssignmentType.TICKET_ASSIGNEE,
                  undefined,
                  ticket.projectId
                );

                if (assignmentResult.assignedUserId) {
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
                    const assignedUser = await tx.run(zql.users.where('id', assignmentResult.assignedUserId).one());
                    if (assignedUser) {
                      await tx.mutate.messages.insert({
                        messageId,
                        conversationId: ticket.conversationId,
                        senderId: authData.sub,
                        content: `${creatorName} auto-assigned ticket to ${assignedUser.name}`,
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
                    logger.info(`siraj101 syncUserWorkload  5${assignmentResult.assignedUserId}`)
                    await syncUserWorkload(assignmentResult.assignedUserId, params.userGroupId!, targetBoardId, authData.sub);

                  logger.info(`[AUTO-ASSIGN] Ticket ${params.id} assigned to ${assignmentResult.assignedUserId} (group change)`);
                } else {
                  logger.info(`[AUTO-ASSIGN] No user assigned for ticket ${params.id}. Reason: ${assignmentResult.reason}`);
                  }
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
            } else if (activity.activityType === 'IS_ARCHIVED') {
              activityMessage = `${userName} archived the ticket`;
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

          // Sync workload for both old and new assignees (async, non-blocking)
          if (ticket.userGroupId && ticket.boardId) {
            const usersToSync = [oldAssignedTo, assignedTo].filter(Boolean) as string[];
            for (const userId of usersToSync) {
              asyncTasks.push(async () => {
                try {
                  await syncUserWorkload(userId, ticket.userGroupId!, ticket.boardId!, authData.sub);
                } catch (error) {
                  logger.error(`[Workload Sync] Failed for user ${userId} in assignment:`, error);
                }
              });
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
          ticketId: z.string().optional(),
          stageId: z.string().optional(),
        }),
        async ({ tx, args }) => {
          const { id, stageEta, updatedAt, ticketId, stageId } = args;

          const now = Date.now();
          if (stageEta < now) {
            throw new Error("Status Deadline cannot be set to a past date");
          }

          // 1. Fetch the OLD ticket stage ETA entry BEFORE updating
          const oldTicketStageEtaEntry = await tx.run(
            zql.ticket_stage_eta.where('id', id).one()
          );

          // Store the old value for activity logging
          const oldStageEta = oldTicketStageEtaEntry?.stageEta ?? null;

          // If entry doesn't exist, require ticketId and stageId
          if (!oldTicketStageEtaEntry && (!ticketId || !stageId)) {
            logger.warn('[MUTATOR] Ticket stage ETA entry not found and no ticketId/stageId provided');
            return;
          }

          // 2. Upsert the current stage ETA entry (will create if not exists, update if exists)
          await tx.mutate.ticket_stage_eta.upsert({
            id,
            ticketId: oldTicketStageEtaEntry?.ticketId ?? ticketId!,
            stageId: oldTicketStageEtaEntry?.stageId ?? stageId!,
            stageEnteredAt: oldTicketStageEtaEntry?.stageEnteredAt ?? now,
            stageLeftAt: null,
            stageEta,
            createdAt: oldTicketStageEtaEntry?.createdAt ?? now,
            updatedAt,
            updatedBy: authData.sub,
          });

          // 3. Use the old entry for other data
          const ticketStageEtaEntry = oldTicketStageEtaEntry ?? {
            id,
            ticketId: ticketId!,
            stageId: stageId!,
          } as any;

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

          // 7. Calculate total hours needed for future stages (only stages with ETA)
          const futureStagesHours = futureStages.reduce(
            (totalHours, stage) => totalHours + (stage.eta || 0),
            0
          );

          // 8. Get the NEW current stage deadline (what user just set)
          const currentStageDeadline = new Date(stageEta);

          // 9. Calculate overall ticket ETA only if there are future stages with ETA
          if (futureStagesHours > 0) {
            // Calculate overall ticket ETA using working hours logic
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
          } else {
            logger.info('[MUTATOR] No future stages with ETA, ticket ETA not updated', {
              ticketId: ticket.id,
              futureStagesHours,
            });
          }

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

            let activityMessage: string;
            if (oldStageEta === null) {
              // New entry - setting deadline for the first time
              const newDate = new Date(newStageEta).toLocaleDateString();
              activityMessage = `${userName} set "${currentStage.name}" stage deadline to ${newDate}`;
            } else {
              // Updating existing deadline
              const oldDate = new Date(oldStageEta).toLocaleDateString();
              const newDate = new Date(newStageEta).toLocaleDateString();
              activityMessage = `${userName} updated "${currentStage.name}" stage deadline from ${oldDate} to ${newDate}`;
            }

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
            workspaceId: authData.workspaceId,
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
            for (const [userId, responsibility] of Object.entries(userResponsibilityUpdates)) {
              const mapping = await tx.run(
                zql.user_group_mappings.where('userGroupId', userGroupId).where('userId', userId).one(),
              );
              if (mapping) {
                const oldResponsibility = mapping.responsibility;
                await tx.mutate.user_group_mappings.update({
                  id: mapping.id,
                  responsibility,
                  updatedAt: timestamp,
                });

                // Handle resource_access for USER-GROUPS based on role changes
                const wasManagerOrLead = oldResponsibility === UserResponsibility.MANAGER ||
                                         oldResponsibility === UserResponsibility.TEAM_LEAD;
                const isManagerOrLead = responsibility === UserResponsibility.MANAGER ||
                                        responsibility === UserResponsibility.TEAM_LEAD;

                if (!wasManagerOrLead && isManagerOrLead) {
                  // Upgraded to MANAGER/TEAM_LEAD → grant WRITE access
                  const userGroupsResource = await tx.run(zql.resources.where('name', 'USER-GROUPS').one());
                  if (userGroupsResource) {
                    const existingAccess = await tx.run(
                      zql.resource_access
                        .where('userId', userId)
                        .where('resourceId', userGroupsResource.id)
                    );
                    const hasWriteAccess = existingAccess.some(
                      a => a.accessType === AccessType.WRITE || a.accessType === AccessType.ADMIN
                    );
                    if (!hasWriteAccess) {
                      const now = Date.now();
                      await tx.mutate.resource_access.insert({
                        id: uuidv4(),
                        userId: userId,
                        resourceId: userGroupsResource.id,
                        accessType: AccessType.WRITE,
                        createdAt: now,
                        updatedAt: now,
                      });
                      logger.info(`[Mutator] Granted WRITE access to USER-GROUPS for user ${userId}`);
                    }
                  }
                } else if (wasManagerOrLead && !isManagerOrLead) {
                  // Downgraded from MANAGER/TEAM_LEAD → check if other MANAGER/TEAM_LEAD roles exist
                  const otherManagerMappings = await tx.run(
                    zql.user_group_mappings
                      .where('userId', userId)
                      .where('responsibility', 'IN', [UserResponsibility.MANAGER, UserResponsibility.TEAM_LEAD])
                  );
                  // Filter out current mapping (still has old value in transaction)
                  const hasOtherManagerRole = otherManagerMappings.some(m => m.id !== mapping.id);
                  if (!hasOtherManagerRole) {
                    // Revoke WRITE access
                    const userGroupsResource = await tx.run(zql.resources.where('name', 'USER-GROUPS').one());
                    if (userGroupsResource) {
                      const existingAccess = await tx.run(
                        zql.resource_access
                          .where('userId', userId)
                          .where('resourceId', userGroupsResource.id)
                          .where('accessType', AccessType.WRITE)
                          .one()
                      );
                      if (existingAccess) {
                        await tx.mutate.resource_access.delete({ id: existingAccess.id });
                        logger.info(`[Mutator] Revoked WRITE access to USER-GROUPS for user ${userId}`);
                      }
                    }
                  }
                }
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
      deactivate: defineMutator(
        z.object({ userGroupId: z.string(), timestamp: z.number() }),
        async ({ tx, args: { userGroupId, timestamp } }) => {
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }
          if (!userGroup.isActive) {
            throw new Error('User group is already deactivated');
          }

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
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }
          if (userGroup.isActive) {
            throw new Error('User group is already active');
          }

          await tx.mutate.user_groups.update({
            id: userGroupId,
            isActive: true,
            updatedAt: timestamp,
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
              })
            )
            .optional(),
          timestamp: z.number(),
          stageIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({ tx, args: { boardId, name, description, projectId, boardType, metadata, stages, timestamp, stageIds = {} } }) => {
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
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });

          // Update stages if provided
          if (stages) {
            // Validate that stages have at least one TODO, STARTED, and COMPLETED stage
            const hasTodo = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.TODO || s.defaultTicketStatusV2 === 'TODO',
            );
            const hasStarted = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.STARTED ||
                s.defaultTicketStatusV2 === 'STARTED',
            );
            const hasCompleted = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED ||
                s.defaultTicketStatusV2 === 'COMPLETED',
            );

            if (!hasTodo || !hasStarted || !hasCompleted) {
              throw new Error(
                'Board must have at least one TODO, one STARTED, and one COMPLETED stage',
              );
            }

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
                    eta: stage.eta !== undefined ? stage.eta : null,
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
          folderId: z.string().optional(),
          projectId: z.string().optional(),
          viewAccessId: z.string().optional(),
          editAccessId: z.string().optional(),
          visibility: z.nativeEnum(CanvasVisibility).optional(),
          content: z.any().optional(),
          timestamp: z.number(),
          participantId: z.string(),
        }),
        async ({ tx, args: { id, title, channelId, folderId, projectId, viewAccessId, editAccessId, visibility, content, timestamp, participantId } }) => {
          const now = timestamp;
          const {
            projectId: resolvedProjectId,
            channelId: resolvedChannelId,
          } = await resolveCanvasHierarchy({
            folderId,
            projectId,
            channelId,
            loadFolder: folderId => tx.run(zql.canvas_folders.where('id', folderId).one()),
            loadChannel: channelId => tx.run(zql.channels.where('id', channelId).one()),
          });

          await assertCanvasChannelNotArchived(tx, resolvedChannelId);

          await tx.mutate.canvases.insert({
            id,
            title,
            content: content || [],
            channelId: resolvedChannelId,
            folderId,
            projectId: resolvedProjectId,
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
      addGroupParticipant: defineMutator(
        z.object({
          canvasId: z.string(),
          userGroupId: z.string(),
          role: z.nativeEnum(CanvasRole),
          participantId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { canvasId, userGroupId, role, participantId, timestamp } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          const requestingUserParticipant = await tx.run(
            zql.canvas_participants.where('canvasId', canvasId).where('userId', authData.sub).one(),
          );

          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);
          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;

          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can add group participants');
          }
          if (role === CanvasRole.OWNER && requestingUserParticipant?.role === CanvasRole.EDITOR) {
            throw new Error('Editors cannot grant owner role');
          }

          const group = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!group || group.isActive === false) {
            throw new Error('User group does not exist or is deactivated');
          }

          const existingGroupParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('userGroupId', userGroupId)
              .one(),
          );
          if (existingGroupParticipant) {
            return;
          }

          await tx.mutate.canvas_participants.insert({
            id: participantId,
            canvasId,
            userId: null,
            userGroupId,
            channelId: null,
            role,
            joinedAt: timestamp,
            updatedAt: timestamp,
          });
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
      removeGroupParticipant: defineMutator(
        z.object({
          canvasId: z.string(),
          userGroupId: z.string(),
        }),
        async ({ tx, args: { canvasId, userGroupId } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          const requestingUserParticipant = await tx.run(
            zql.canvas_participants.where('canvasId', canvasId).where('userId', authData.sub).one(),
          );
          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);
          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;
          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can remove group participants');
          }

          const targetParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('userGroupId', userGroupId)
              .one(),
          );
          if (!targetParticipant) {
            throw new Error('Group is not a participant');
          }
          if (isEditor && targetParticipant.role === CanvasRole.OWNER) {
            throw new Error('Editors cannot remove owners');
          }

          await tx.mutate.canvas_participants.delete({ id: targetParticipant.id });
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
      updateGroupParticipantRole: defineMutator(
        z.object({
          canvasId: z.string(),
          userGroupId: z.string(),
          role: z.nativeEnum(CanvasRole),
          timestamp: z.number(),
        }),
        async ({ tx, args: { canvasId, userGroupId, role, timestamp } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error("Canvas doesn't exist");
          }

          const requestingUserParticipant = await tx.run(
            zql.canvas_participants.where('canvasId', canvasId).where('userId', authData.sub).one(),
          );
          const isOwner =
            canvas.createdBy === authData.sub ||
            (requestingUserParticipant && requestingUserParticipant.role === CanvasRole.OWNER);
          const isEditor =
            requestingUserParticipant && requestingUserParticipant.role === CanvasRole.EDITOR;
          if (!isOwner && !isEditor) {
            throw new Error('Only canvas owners or editors can update group participant roles');
          }
          if (requestingUserParticipant?.role === CanvasRole.EDITOR && role === CanvasRole.OWNER) {
            throw new Error('Editors cannot grant owner role');
          }

          const targetParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('userGroupId', userGroupId)
              .one(),
          );
          if (!targetParticipant) {
            throw new Error('Group is not a participant');
          }
          if (
            requestingUserParticipant?.role === CanvasRole.EDITOR &&
            targetParticipant.role === CanvasRole.OWNER
          ) {
            throw new Error('Editors cannot change owner roles');
          }

          await tx.mutate.canvas_participants.update({
            id: targetParticipant.id,
            role,
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
          folderId: z.string().nullable().optional(),
          projectId: z.string().nullable().optional(),
          channelId: z.string().nullable().optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: params }) => {
          // Verify user has edit access
          const canvas = await tx.run(zql.canvases.where('id', params.id).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const isEditLink = params.editAccessId && canvas.editAccessId === params.editAccessId;
          const isMoveOperation =
            params.folderId !== undefined ||
            params.projectId !== undefined ||
            params.channelId !== undefined;

          if (!isEditLink) {
            const participant = await tx.run(zql.canvas_participants
              .where('canvasId', canvas.id)
              .where('userId', authData.sub)
              .one());

            const currentFolder = canvas.folderId
              ? await tx.run(zql.canvas_folders.where('id', canvas.folderId).one())
              : null;
            const currentChannelId = canvas.channelId ?? currentFolder?.channelId ?? null;
            const isChannelAdmin = currentChannelId
              ? Boolean(
                  await tx.run(
                    zql.channel_participants
                      .where('channelId', currentChannelId)
                      .where('userId', authData.sub)
                      .where('role', ChannelRole.ADMIN)
                      .one(),
                  ),
                )
              : false;

            const canEdit =
              canvas.createdBy === authData.sub ||
              (participant &&
                (participant.role === CanvasRole.EDITOR || participant.role === CanvasRole.OWNER));

            if (!canEdit && !(isMoveOperation && isChannelAdmin)) {
              throw new Error('You do not have permission to edit this canvas');
            }
          }

          const {
            projectId: resolvedProjectId,
            channelId: resolvedChannelId,
          } = await resolveCanvasHierarchy({
            folderId: params.folderId,
            projectId: params.projectId,
            channelId: params.channelId,
            loadFolder: folderId => tx.run(zql.canvas_folders.where('id', folderId).one()),
            loadChannel: channelId => tx.run(zql.channels.where('id', channelId).one()),
          });

          if (isMoveOperation) {
            await assertCanvasDestinationAccess({
              projectId: resolvedProjectId,
              channelId: resolvedChannelId,
              loadChannel: channelId => tx.run(zql.channels.where('id', channelId).one()),
              isChannelMember: async channelId =>
                Boolean(
                  await tx.run(
                    zql.channel_participants
                      .where('channelId', channelId)
                      .where('userId', authData.sub)
                      .one(),
                  ),
                ),
              isProjectMember: async projectId =>
                Boolean(
                  await tx.run(
                    zql.channels
                      .where('projectId', projectId)
                      .whereExists('participants', p => p.where('userId', authData.sub))
                      .one(),
                  ),
                ),
            });
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
            ...(params.folderId !== undefined && { folderId: params.folderId }),
            ...(resolvedProjectId !== undefined && { projectId: resolvedProjectId }),
            ...(resolvedChannelId !== undefined && { channelId: resolvedChannelId }),
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
    canvasFolder: {
      create: defineMutator(
        z.object({
          id: z.string(),
          projectId: z.string().nullable().optional(),
          channelId: z.string().optional(),
          name: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, name, projectId, channelId, timestamp } }) => {
          const cleanName = name.trim();
          if (!cleanName) {
            throw new Error('Folder name is required');
          }

          if (!projectId && channelId) {
            throw new Error('Channel folders must belong to a project');
          }

          if (projectId) {
            const project = await tx.run(zql.projects.where('id', projectId).one());
            if (!project) {
              throw new Error('Project not found');
            }

            if (channelId) {
              const channel = await tx.run(zql.channels.where('id', channelId).one());
              if (!channel) {
                throw new Error('Channel not found');
              }

              if (channel.isArchived) {
                throw new Error('Channel is archived');
              }

              if (channel.projectId !== projectId) {
                throw new Error('Channel does not belong to project');
              }
            }
          }

          const duplicateNameMessage = getCanvasFolderNameConflictMessage(channelId, projectId);
          const existingFolder = await tx.run(
            zql.canvas_folders
            .where('name', cleanName)
            .where(({ and, cmp }) =>
              channelId
                ? and(cmp('projectId', '=', projectId as string), cmp('channelId', '=', channelId))
                : projectId
                  ? and(cmp('projectId', '=', projectId), cmp('channelId', 'IS', null))
                  : and(
                      cmp('projectId', 'IS', null),
                      cmp('channelId', 'IS', null),
                      cmp('createdBy', '=', authData.sub),
                    ),
            )
            .one(),
        );
          if (existingFolder) {
            throw new Error(duplicateNameMessage);
          }

          try {
            await tx.mutate.canvas_folders.insert({
              id,
              ...(projectId ? { projectId } : {}),
              ...(channelId ? { channelId } : {}),
              name: cleanName,
              createdBy: authData.sub,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          } catch (error) {
            rethrowCanvasFolderNameConflict(error, channelId, projectId);
          }
        },
      ),
      update: defineMutator(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          timestamp: z.number().optional(),
        }),
        async ({ tx, args: { id, name, timestamp } }) => {
          const folder = await tx.run(zql.canvas_folders.where('id', id).one());
          if (!folder) {
            throw new Error('Folder not found');
          }

          const isProjectDefaultFolder =
            folder.projectId != null && folder.channelId == null && folder.name === 'Default';
          if (isProjectDefaultFolder) {
            throw new Error('Default project folder cannot be renamed');
          }

          const isChannelAdmin = folder.channelId
            ? Boolean(
                await tx.run(
                  zql.channel_participants
                    .where('channelId', folder.channelId)
                    .where('userId', authData.sub)
                    .where('role', ChannelRole.ADMIN)
                    .one(),
                ),
              )
            : false;

          if (folder.createdBy !== authData.sub && !isChannelAdmin) {
            throw new Error(
              folder.channelId
                ? 'Only the creator or a channel admin can update this folder'
                : 'Only the creator can update this folder',
            );
          }

          const updates: { name?: string; updatedAt: number } = { updatedAt: timestamp || Date.now() };
          if (name !== undefined) {
            const cleanName = name.trim();
            if (!cleanName) {
              throw new Error('Folder name is required');
            }

            const duplicateNameMessage = getCanvasFolderNameConflictMessage(
              folder.channelId,
              folder.projectId,
            );
            const existingFolder = await tx.run(
              zql.canvas_folders
                .where('name', cleanName)
                .where(({ and, cmp }) =>
                  folder.channelId
                    ? and(
                        cmp('projectId', '=', folder.projectId as string),
                        cmp('channelId', '=', folder.channelId),
                      )
                    : folder.projectId
                      ? and(
                          cmp('projectId', '=', folder.projectId),
                          cmp('channelId', 'IS', null),
                        )
                      : and(
                          cmp('projectId', 'IS', null),
                          cmp('channelId', 'IS', null),
                          cmp('createdBy', '=', folder.createdBy),
                        ),
                )
                .one(),
            );
            if (existingFolder && existingFolder.id !== id) {
              throw new Error(duplicateNameMessage);
            }

            updates.name = cleanName;
          }

          try {
            await tx.mutate.canvas_folders.update({
              id,
              ...updates,
            });
          } catch (error) {
            rethrowCanvasFolderNameConflict(error, folder.channelId, folder.projectId);
          }
        },
      ),
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const folder = await tx.run(zql.canvas_folders.where('id', id).one());
          if (!folder) {
            throw new Error('Folder not found');
          }

          const isProjectDefaultFolder =
            folder.projectId != null && folder.channelId == null && folder.name === 'Default';
          if (isProjectDefaultFolder) {
            throw new Error('Default project folder cannot be deleted');
          }

          const isChannelAdmin = folder.channelId
            ? Boolean(
                await tx.run(
                  zql.channel_participants
                    .where('channelId', folder.channelId)
                    .where('userId', authData.sub)
                    .where('role', ChannelRole.ADMIN)
                    .one(),
                ),
              )
            : false;

          if (folder.createdBy !== authData.sub && !isChannelAdmin) {
            throw new Error(
              folder.channelId
                ? 'Only the creator or a channel admin can delete this folder'
                : 'Only the creator can delete this folder',
            );
          }

          const canvasesInFolder = await tx.run(zql.canvases.where('folderId', id));
          if (canvasesInFolder.length > 0) {
            throw new Error('Cannot delete folder with canvases. Move or delete canvases first.');
          }

          await tx.mutate.canvas_folders.delete({ id });
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
          const existing = await getBookmarkIncludingDeleted(tx, entityId, entityType);

          if (existing) {
            if (existing.isDeleted || existing.isCompleted) {
              await tx.mutate.bookmarks.update({
                id: existing.id,
                isDeleted: false,
                isCompleted: false,
                updatedAt: timestamp,
                metadata: metadata ?? null,
              });
            }

            enqueueBookmarkReminderSync({
              entityId,
              entityType,
              metadata:
                existing.isDeleted || existing.isCompleted
                  ? (metadata ?? null)
                  : existing.metadata,
              source: 'bookmark.add(existing)',
            });

            return;
          }

          await tx.mutate.bookmarks.insert({
            id: bookmarkId,
            userId: authData.sub,
            entityId,
            entityType,
            createdAt: timestamp,
            updatedAt: timestamp,
            isDeleted: false,
            isCompleted: false,
            metadata,
          });

          enqueueBookmarkReminderSync({
            entityId,
            entityType,
            metadata,
            source: 'bookmark.add(insert)',
          });
        },
      ),
      remove: defineMutator(
        z.object({
          entityId: z.string(),
          entityType: z.nativeEnum(BookmarkEntityType),
          timestamp: z.number().optional(),
          markAsDone: z.boolean().optional(),
        }),
        async ({ tx, args: { entityId, entityType, timestamp, markAsDone } }) => {
          const bookmark = await getActiveBookmark(tx, entityId, entityType);

          if (!bookmark) {
            throw new Error('Bookmark not found');
          }

          const eventTimestamp = timestamp ?? Date.now();

          await tx.mutate.bookmarks.update({
            id: bookmark.id,
            isDeleted: !markAsDone,
            isCompleted: !!markAsDone,
            updatedAt: eventTimestamp,
            metadata: markAsDone
              ? buildCompletedBookmarkMetadata(bookmark.metadata, eventTimestamp)
              : null,
          });

          enqueueBookmarkReminderCancel({
            entityId,
            entityType,
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
          const bookmark = await getActiveBookmark(tx, entityId, entityType);

          if (!bookmark) {
            throw new Error('Bookmark not found');
          }

          await tx.mutate.bookmarks.update({
            id: bookmark.id,
            metadata: metadata,
            updatedAt: Date.now(),
          });

          enqueueBookmarkReminderSync({
            entityId,
            entityType,
            metadata,
            source: 'bookmark.updateMetadata',
          });
        },
      ),
    },
    nudges: {
      dismiss: defineMutator(
        z.object({
          nudgeId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { nudgeId, timestamp } }) => {
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
            await decrementSurfaceNudgeCountRow(tx, nudge.surfaceNudgeCountId, timestamp);
          }

          // Emit UserActivityEvent for feedback loop
          try {
            const { db } = await import('@/database/client');
            await db.userActivityEvent.create({
              data: {
                userId: ctx.userID,
                sessionId: 'system',
                eventCategory: 'NUDGE',
                eventName: 'NUDGE_DISMISSED',
                url: '',
                triggerType: 'SYSTEM',
                platform: 'WEB',
                timestamp: new Date(timestamp),
                contextMetadata: {
                  nudgeId,
                  nudgeKind: nudge.nudgeKind,
                  sourceId: nudge.sourceId,
                  projectId: nudge.projectId,
                },
              },
            });
          } catch (err) {
            logger.warn('[Nudges.dismiss] Failed to emit activity event', { nudgeId, error: err });
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
            await decrementSurfaceNudgeCountRow(tx, nudge.surfaceNudgeCountId, timestamp);
          }

          // Create surface_links row when action result has target info
          if (
            actionBehavior.createSurfaceLink &&
            actionResult &&
            typeof actionResult === 'object' &&
            !Array.isArray(actionResult)
          ) {
            const result = actionResult as Record<string, unknown>;
            const resultData = result.result as Record<string, unknown> | undefined;

            if (resultData) {
              const definition = nudgeRegistry.getByKind(nudge.nudgeKind);
              if (definition) {
                const entityId = typeof resultData.entityId === 'string' ? resultData.entityId : undefined;

                if (entityId) {
                  const linkId = `sl_${nudgeId}_${timestamp}`;
                  await tx.mutate.surface_links.insert({
                    id: linkId,
                    sourceType: definition.direction.from as SurfaceAreaType,
                    sourceId: nudge.sourceId,
                    targetType: definition.direction.to as SurfaceAreaType,
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

          // Update displayName on User table if provided
          if (params.displayName !== undefined) {
            await tx.mutate.users.update({
              id: authData.sub,
              displayName: params.displayName,
              updatedAt: now,
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
        async ({ tx, args: { statusEmoji, statusContent, statusExpiryAt, assignmentUnavailableUntil, notificationsPausedUntil, timestamp, presenceId } }) => {
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
            status: existingPresence?.status || UserPresenceStatus.OFFLINE,
            lastActiveAt: now,
            lastSeenAt: now,
            isManual: false,
            ...(statusEmoji !== undefined && { statusEmoji: validatedEmoji || null }),
            ...(statusContent !== undefined && { statusContent: statusContent }),
            ...(statusExpiryAt !== undefined && { statusExpiryAt: statusExpiryAt }),
            ...(assignmentUnavailableUntil !== undefined && { assignmentUnavailableUntil: assignmentUnavailableUntil }),
            ...(notificationsPausedUntil !== undefined && { notificationsPausedUntil: notificationsPausedUntil }),
            updatedAt: now,
            createdAt: existingPresence ? existingPresence.createdAt || now : now,
          };

          await tx.mutate.user_presence.upsert(presenceData);

          // Dual-write presence display fields to users table for faster getUsers query
          await tx.mutate.users.update({
            id: authData.sub,
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
            })
          ),
          userMappings: z.array(
            z.object({
              userId: z.string(),
              onCallSetNumbers: z.array(z.number()),
            })
          ).optional(),
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
        async ({ tx, args: { userGroupId, userStates, userMappings, boardWeight, expertiseMappings, timestamp, stateIds = {}, complexityScoreId, mappingIds = {} } }) => {
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

          // Update user group mappings (set numbers) if provided
          if (userMappings) {
            for (const mapping of userMappings) {
              const existingMapping = await tx.run(
                zql.user_group_mappings
                  .where('userId', mapping.userId)
                  .where('userGroupId', userGroupId)
                  .one()
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
            throw new Error('rotationInterval and rotationStartDate are required when enabling rotation');
          }

          // Update user group with rotation settings
          await tx.mutate.user_groups.update({
            id: userGroupId,
            autoRotationEnabled,
            rotationInterval: autoRotationEnabled ? rotationInterval : null,
            rotationStartDate: autoRotationEnabled ? rotationStartDate : null,
            updatedAt: timestamp,
          });

          logger.info(
            `[TOGGLE-ROTATION] ${autoRotationEnabled ? 'Enabled' : 'Disabled'} rotation for group ${userGroupId}${autoRotationEnabled ? ` with interval ${rotationInterval}` : ''}.`
          );

          // If enabling rotation, immediately set set 1 as active
          if (autoRotationEnabled) {
            asyncTasks.push(async () => {
              try {
                await initializeRotationForGroup(userGroupId);
              } catch (error) {
                logger.error(`[TOGGLE-ROTATION] Failed to initialize rotation for group ${userGroupId}:`, error);
              }
            });
          } else {
            // When disabling rotation, onCallSetNumbers mappings are preserved
            // so users don't need to reconfigure when re-enabling
            logger.info(`[TOGGLE-ROTATION] Disabled rotation for group ${userGroupId} (set mappings preserved)`);
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
                    sequenceNumber: number;
                    updatedAt: number;
                    fieldEnum?: ReadonlyJSONValue;
                    isOptional?: boolean;
                  } = {
                    id: field.id,
                    formId,
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    sequenceNumber: index + 1,
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
                    sequenceNumber: number;
                    createdAt: number;
                    updatedAt: number;
                    fieldEnum?: ReadonlyJSONValue;
                    isOptional?: boolean;
                  } = {
                    id: field.id,
                    formId: formId,
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    sequenceNumber: index + 1,
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
                const newFieldId = fieldIds[index];
                if (!newFieldId) {
                  throw new Error(`fieldId is required for new field at index ${index}`);
                }
                const insertData: {
                  id: string;
                  formId: string;
                  fieldName: string;
                  fieldType: FormFieldType;
                  sequenceNumber: number;
                  createdAt: number;
                  updatedAt: number;
                  fieldEnum?: ReadonlyJSONValue;
                  isOptional?: boolean;
                } = {
                  id: newFieldId,
                  formId: formId,
                  fieldName: field.fieldName.trim(),
                  fieldType: field.fieldType,
                  sequenceNumber: index + 1,
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
            formId: formField.formId,
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
    emailDraft: {
    upsert: defineMutator(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        channelId: z.string(),
          draftContent: z.string(),
          attachmentIds: z.array(z.string()).optional(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, conversationId, channelId, draftContent, attachmentIds, updatedAt } }) => {
        const existing = await tx.run(
          zql.email_drafts
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );
          if (existing) {
            await tx.mutate.email_drafts.update({
              id: existing.id,
              draftContent,
              ...(attachmentIds !== undefined && { attachmentIds }),
              updatedAt,
            });
          } else {
            await tx.mutate.email_drafts.insert({
              id,
              conversationId,
              channelId,
              userId: ctx.userID,
              draftContent,
              ...(attachmentIds !== undefined && { attachmentIds }),
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
    emailRead: {
      // KEEP IN SYNC with shared/src/zero/mutators.ts emailRead.markAsRead.
      // The shared copy runs client-side (optimistic); this copy runs
      // server-side (authoritative). Diverging logic causes state drift.
      markAsRead: defineMutator(
        z.object({
          id: z.string(),
          ticketId: z.string(),
          lastReadEmailId: z.string(),
          updatedAt: z.number(),
        }),
        async ({ tx, ctx, args: { id, ticketId, lastReadEmailId, updatedAt } }) => {
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          const lastReadEmailAt = ticket?.lastEmailAt ?? updatedAt;
          const existing = await tx.run(
            zql.email_reads
              .where('ticketId', ticketId)
              .where('userId', ctx.userID)
              .one(),
          );
          if (existing) {
            const existingAt = existing.lastReadEmailAt;
            if (typeof existingAt !== 'number' || existingAt < lastReadEmailAt) {
              await tx.mutate.email_reads.update({
                id: existing.id,
                lastReadEmailId,
                lastReadEmailAt,
                updatedAt,
              });
            }
          } else {
            await tx.mutate.email_reads.insert({
              id,
              ticketId,
              userId: ctx.userID,
              lastReadEmailId,
              lastReadEmailAt,
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
            }),
          ),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { items, timestamp } }) => {
          if (items.length === 0) return;

          const ticketIds = items.map(i => i.ticketId);
          const tickets = await tx.run(
            zql.tickets
              .where(h => h.cmp('id', 'IN', ticketIds))
              .related('emails', q => q.orderBy('createdAt', 'desc').limit(1)),
          );
          const lastEmailAtByTicket = new Map(tickets.map(t => [t.id, t.lastEmailAt]));
          const latestEmailIdByTicket = new Map(
            tickets.map(t => {
              const emails = t.emails as ReadonlyArray<{ id: string }> | undefined;
              return [t.id, emails?.[0]?.id ?? null];
            }),
          );
          const existing = await tx.run(
            zql.email_reads
              .where('userId', ctx.userID)
              .where(h => h.cmp('ticketId', 'IN', ticketIds)),
          );
          const existingByTicket = new Map(existing.map(e => [e.ticketId, e]));

          await Promise.all(
            items.map(item => {
              const lastReadEmailAt = lastEmailAtByTicket.get(item.ticketId);
              if (typeof lastReadEmailAt !== 'number') return undefined;
              const lastReadEmailId = latestEmailIdByTicket.get(item.ticketId);
              if (!lastReadEmailId) return undefined;
              const ex = existingByTicket.get(item.ticketId);
              if (ex) {
                if (
                  typeof ex.lastReadEmailAt === 'number' &&
                  ex.lastReadEmailAt >= lastReadEmailAt
                ) {
                  return undefined;
                }
                return tx.mutate.email_reads.update({
                  id: ex.id,
                  lastReadEmailAt,
                  lastReadEmailId,
                  updatedAt: timestamp,
                });
              }
              return tx.mutate.email_reads.insert({
                id: item.id,
                ticketId: item.ticketId,
                userId: ctx.userID,
                lastReadEmailAt,
                lastReadEmailId,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }),
          );
        },
      ),
    },
    draft: {
      createAttachments: defineMutator(
        z.object({
          draftMessageId: z.string(),
          attachments: z.array(z.object({
            attachmentId: z.string(),
            originalFilename: z.string(),
            mimetype: z.string(),
            size: z.number(),
            width: z.number().optional(),
            height: z.number().optional(),
          })),
          channelId: z.string(),
          conversationId: z.string().optional(),
          content: z.string().optional(),
          timestamp: z.number(),
        }),
        async ({
          tx,
          args: {
            draftMessageId,
            attachments,
            channelId,
            conversationId,
            content,
            timestamp,
          },
        }) => {
          // 1. Check if draft exists for this channel/conversation/user
          let existingDraft = null;
          if (conversationId) {
            existingDraft = await tx.run(
              zql.draft_messages
                .where('channelId', channelId)
                .where('userId', authData.sub)
                .where('conversationId', conversationId)
                .one(),
            );
          } else {
            const channelDrafts = await tx.run(
              zql.draft_messages
                .where('channelId', channelId)
                .where('userId', authData.sub),
            );
            existingDraft = channelDrafts.find(draft => draft.conversationId === null);
          }

          const finalDraftMessageId = existingDraft?.id || draftMessageId;

          // 2. If no draft exists, upsert one atomically
          if (!existingDraft) {
            await tx.mutate.draft_messages.upsert({
              id: draftMessageId,
              channelId,
              conversationId: conversationId || null,
              userId: authData.sub,
              content: content || '',
              hasAttachment: true,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          } else {
            // Update draft's hasAttachment flag if not already set
            if (!existingDraft.hasAttachment) {
              await tx.mutate.draft_messages.update({
                id: existingDraft.id,
                content: content || existingDraft.content,
                hasAttachment: true,
              });
            }
          }

  
          for (const [index, attachment] of attachments.entries()) {
            const { attachmentId, mimetype, size, width, height } = attachment;
            const rawName = attachment.originalFilename || 'unnamed_file';
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

            const originalFilename = sanitizedBase + ext;

            const existingAttachment = await tx.run(
              zql.message_attachments.where('id', attachmentId).one(),
            );

            if (existingAttachment) {
              await tx.mutate.message_attachments.update({
                id: attachmentId,
                entityId: finalDraftMessageId,
                entityType: AttachmentEntityType.DRAFT,
                conversationId: conversationId || null,
                originalFilename,
                mimetype,
                size,
                width,
                height
              });
            } else {
              try {
                await tx.mutate.message_attachments.insert({
                  id: attachmentId,
                  entityType: AttachmentEntityType.DRAFT,
                  entityId: finalDraftMessageId,
                  storageProvider: '',
                  originalFilename,
                  mimetype,
                  size,
                  width,
                  height,
                  uploadedByUserId: authData.sub,
                  createdAt: timestamp + index,
                  createdBy: authData.sub,
                  url: '', // Will be populated after upload completes
                  metadata: null,
                  conversationId: conversationId || null,
                  isDeleted: false,
                  workspaceId: authData.workspaceId,
                });
              } catch (error) {
                // Ignore duplicate key errors - record already created by concurrent request
                if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint')) {
                  // Record already exists, nothing to do
                  logger.info("Skipping insert, record already exists")
                  continue;
                }
                throw error;
              }
            }
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
          entityType: z.nativeEnum(FormEntityType).optional(),
          targetEntity: z.string().optional(),
          visualType: z.string().optional(),
          dashboardId: z.string().optional(),
          createdBy: z.string(),
          timestamp: z.number(),
          mappingId: z.string().optional(),
        }),
        async ({ tx, args: { id, title, queryJson, entityType, targetEntity, visualType, dashboardId, createdBy, timestamp, mappingId } }) => {
          const now = timestamp;

          const existingQuery = await tx.run(zql.queries.where('id', id).one())

          await tx.mutate.queries.upsert({
            id: id,
            title: title.trim(),
            queryJson,
            entityType: entityType ?? null,
            targetEntity: targetEntity ?? null,
            visualType: visualType ? (visualType as QueryVisualizationType) : null,
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
              const existingMappings = await tx.run(
                zql.dashboard_queries_mapping.where('dashboardId', dashboardId),
              );
              await tx.mutate.dashboard_queries_mapping.insert({
                id: newMappingId,
                dashboardId,
                queryId: id,
                sequence: existingMappings.length,
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
          const mapping = await tx.run(zql.dashboard_queries_mapping.where('queryId', id).one());
          const dashboardId = mapping?.dashboardId;
          if (mapping) {
            await tx.mutate.dashboard_queries_mapping.delete({ id: mapping.id });
          }
          await tx.mutate.queries.delete({ id });

          if (dashboardId) {
            asyncTasks.push(async () => {
              const remainingMappings = await tx.run(
                zql.dashboard_queries_mapping.where('dashboardId', dashboardId).orderBy('sequence', 'asc')
              );
              for (let i = 0; i < remainingMappings.length; i++) {
                await tx.mutate.dashboard_queries_mapping.update({
                  id: remainingMappings[i].id,
                  sequence: i,
                });
              }
            });
          }
        },
      ),
      reorder: defineMutator(
        z.object({
          orderedMappingIds: z.array(z.string()),
          timestamp: z.number(),
        }),
        async ({ tx, args: { orderedMappingIds, timestamp } }) => {
          for (let i = 0; i < orderedMappingIds.length; i++) {
            const mappingId = orderedMappingIds[i]!;
            await tx.mutate.dashboard_queries_mapping.update({
              id: mappingId,
              sequence: i,
              updatedAt: timestamp,
            });
          }
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
      deleteByTicketId: defineMutator(
        z.object({
          ticketId: z.string(),
        }),
        async ({ tx, args: { ticketId } }) => {
          const requests = await tx.run(
            zql.ticket_stage_requests.where('ticketId', ticketId),
          );
          for (const request of requests) {
            await tx.mutate.ticket_stage_requests.delete({ id: request.id });
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
          // Validate ticket exists
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (!ticket) {
            throw new Error('Ticket not found');
          }

          // Use provided ownerId or fallback to authData.sub
          const resolvedOwnerId = ownerId || authData.sub;

          // Validate owner exists
          const owner = await tx.run(zql.users.where('id', resolvedOwnerId).one());
          if (!owner) {
            throw new Error('Owner not found');
          }

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

          // Validate owner exists if provided
          const owner = await tx.run(zql.users.where('id', authData.sub).one());
          if (!owner) {
            throw new Error('Owner not found');
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
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (!ticket) {
            throw new Error('Ticket not found');
          }

          const releaseTicket = await tx.run(zql.tickets.where('id', releaseId).one());
          if (!releaseTicket) {
            throw new Error('Release ticket not found');
          }
          if (releaseTicket.ticketType !== BaseTicketType.Release) {
            throw new Error('Only release tickets can be attributed');
          }

          if (releaseApplicationId) {
            const subTicket = await tx.run(zql.sub_tickets.where('id', releaseApplicationId).one());
            if (!subTicket) {
              throw new Error('Application release not found');
            }

            const mapping = await tx.run(
              zql.ticket_sub_ticket_mappings
                .where('ticketId', releaseId)
                .where('subTicketId', releaseApplicationId)
                .one(),
            );
            if (!mapping) {
              throw new Error('Application release is not linked to this release ticket');
            }
          }

          if (rootCauseTicketId) {
            const rootCauseTicket = await tx.run(
              zql.tickets.where('id', rootCauseTicketId).one(),
            );
            if (!rootCauseTicket) {
              throw new Error('Root cause ticket not found');
            }
          }

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
          const attribution = await tx.run(zql.release_attributions.where('id', id).one());
          if (!attribution) {
            throw new Error('Release attribution not found');
          }

          const effectiveReleaseId = releaseId ?? attribution.releaseId;
          if (releaseId) {
            const releaseTicket = await tx.run(zql.tickets.where('id', releaseId).one());
            if (!releaseTicket) {
              throw new Error('Release ticket not found');
            }
            if (releaseTicket.ticketType !== BaseTicketType.Release) {
              throw new Error('Only release tickets can be attributed');
            }
          }

          if (releaseApplicationId) {
            const subTicket = await tx.run(zql.sub_tickets.where('id', releaseApplicationId).one());
            if (!subTicket) {
              throw new Error('Application release not found');
            }

            const mapping = await tx.run(
              zql.ticket_sub_ticket_mappings
                .where('ticketId', effectiveReleaseId)
                .where('subTicketId', releaseApplicationId)
                .one(),
            );
            if (!mapping) {
              throw new Error('Application release is not linked to this release ticket');
            }
          }

          if (rootCauseTicketId) {
            const rootCauseTicket = await tx.run(
              zql.tickets.where('id', rootCauseTicketId).one(),
            );
            if (!rootCauseTicket) {
              throw new Error('Root cause ticket not found');
            }
          }

          await tx.mutate.release_attributions.update({
            id,
            ...(releaseId !== undefined && { releaseId }),
            ...(releaseApplicationId !== undefined && { releaseApplicationId }),
            ...(rootCauseTicketId !== undefined && { rootCauseTicketId }),
            ...(confidence !== undefined && { confidence }),
          });
        },
      ),
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const attribution = await tx.run(zql.release_attributions.where('id', id).one());
          if (!attribution) {
            throw new Error('Release attribution not found');
          }
          await tx.mutate.release_attributions.delete({ id });
        },
      ),
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
        async ({
          tx,
          args: {
            id,
            ticketId,
            impactTypeId,
            impact,
            rcaId,
            timestamp
          },
        }) => {

          if (!rcaId) {
            throw new Error('RCA ID is required for creating an impact');
          }
          // Validate RCA exists if provided
          const rca = await tx.run(zql.rcas.where('id', rcaId).one());
          if (!rca) {
            throw new Error('RCA not found');
          }
          // Validate ticket exists
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (!ticket) {
            throw new Error('Ticket not found');
          }

          await tx.mutate.impacts.insert({
            id,
            ticketId,
            impactTypeId,
            impact,
            rcaId,
            createdAt: timestamp
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
          const existingImpact = await tx.run(zql.impacts.where('id', id).one());
          if (!existingImpact) {
            throw new Error('Impact not found');
          }

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
          const existingImpact = await tx.run(zql.impacts.where('id', id).one());
          if (!existingImpact) {
            throw new Error('Impact not found');
          }

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
          args: {
            id,
            rcaId,
            ownerId,
            actionTypeId,
            action,
            status,
            dueDate,
            timestamp
          },
        }) => {
          // Validate RCA exists
          const rca = await tx.run(zql.rcas.where('id', rcaId).one());
          if (!rca) {
            throw new Error('RCA not found');
          }

          // Validate owner exists
          const owner = await tx.run(zql.users.where('id', ownerId).one());
          if (!owner) {
            throw new Error('Owner not found');
          }

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
        async ({
          tx,
          args: {
            id,
            ownerId,
            actionTypeId,
            action,
            status,
            dueDate,
            completedAt,
          },
        }) => {
          const coe = await tx.run(zql.coes.where('id', id).one());
          if (!coe) {
            throw new Error('COE not found');
          }


          // Validate owner exists if provided
          if (ownerId) {
            const owner = await tx.run(zql.users.where('id', ownerId).one());
            if (!owner) {
              throw new Error('Owner not found');
            }
          }

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
          const existingCoe = await tx.run(zql.coes.where('id', id).one());
          if (!existingCoe) {
            throw new Error('Coe not found');
          }

          await tx.mutate.coes.delete({ id });
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
          // Get all channel user status entries for this user
          const userChannelStatuses = await tx.run(
            zql.channel_user_status.where('userId', ctx.userID).where('isDeleted', false),
          );

          const newChannelIds = new Set(channelIds);

          // Update each channel user status with recap subscription state
          for (const status of userChannelStatuses) {
            const shouldSubscribe = newChannelIds.has(status.channelId);
            
            // Only update if the subscription state is changing
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
      setCustomRecapPrompt: defineMutator(
        z.object({
          channelId: z.string(),
          prompt: z.string().nullable(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { channelId, prompt, timestamp: _timestamp } }) => {
          const status = await tx.run(
            zql.channel_user_status.where('userId', ctx.userID).where('channelId', channelId).one(),
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
      markSeen: defineMutator(
        z.object({
          recapDate: z.number(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { recapDate, timestamp } }) => {
          // Update all subscribed channels for this user with the seen date
          const subscribedChannels = await tx.run(
            zql.channel_user_status
              .where('userId', ctx.userID)
              .where('isRecapSubscribed', true)
              .where('isDeleted', false),
          );

          for (const status of subscribedChannels) {
            // Only update if the new date is more recent
            if (
              status.lastSeenRecapDate === null ||
              status.lastSeenRecapDate < recapDate
            ) {
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
    },
    links: {
      create: defineMutator(
        z.object({
          id: z.string(),
          url: z.string().url(),
          title: z.string().min(1),
          description: z.string().optional(),
          favicon: z.string().optional(),
          channelId: z.string(),
          visibility: z.enum(['DEFAULT', 'PERSONAL']).default('DEFAULT'),
          createdAt: z.number(),
          updatedAt: z.number(),
        }),
        async ({ tx, ctx, args }) => {
          const { id, url, title, description, favicon, channelId, visibility, createdAt, updatedAt } = args;
          const userId = ctx.userID;

          // Check if link already exists for this user in this channel
          const existing = await tx.run(
            zql.links
              .where('createdBy', userId)
              .where('url', url)
              .where('channelId', channelId)
              .one()
          );

          if (existing) {
            throw new Error('Link already exists');
          }

          await tx.mutate.links.insert({
            id,
            url,
            title,
            description: description || null,
            favicon: favicon || null,
            channelId,
            createdBy: userId,
            visibility: visibility === 'DEFAULT' ? LinkVisibility.DEFAULT : LinkVisibility.PERSONAL,
            createdAt,
            updatedAt,
          });
        }
      ),

      update: defineMutator(
        z.object({
          id: z.string(),
          title: z.string().min(1).optional(),
          description: z.string().optional(),
          favicon: z.string().optional(),
          visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
          updatedAt: z.number(),
        }),
        async ({ tx, ctx, args }) => {
          const { id, title, description, favicon, visibility, updatedAt } = args;
          const userId = ctx.userID;

          // Verify ownership
          const link = await tx.run(zql.links.where('id', id).one());
          if (!link) {
            throw new Error('Link not found');
          }
          if (link.createdBy !== userId) {
            throw new Error('Not authorized to update this link');
          }

          const updates: Record<string, ReadonlyJSONValue> = {
            updatedAt,
          };

          if (title !== undefined) updates.title = title;
          if (description !== undefined) updates.description = description || null;
          if (favicon !== undefined) updates.favicon = favicon || null;
          if (visibility !== undefined) {
            updates.visibility = visibility === 'DEFAULT' ? LinkVisibility.DEFAULT : LinkVisibility.PERSONAL;
          }

          await tx.mutate.links.update({ id, ...updates });
        }
      ),

      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, ctx, args: { id } }) => {
          const userId = ctx.userID;

          // Verify ownership
          const link = await tx.run(zql.links.where('id', id).one());
          if (!link) {
            throw new Error('Link not found');
          }
          if (link.createdBy !== userId) {
            throw new Error('Not authorized to delete this link');
          }

          // Delete link (cascade will handle link_access)
          await tx.mutate.links.delete({ id });
        }
      ),

      shareWith: defineMutator(
        z.object({
          linkId: z.string(),
          userIds: z.array(z.string()),
          accessIds: z.array(z.string()),
          createdAt: z.number(),
        }),
        async ({ tx, ctx, args: { linkId, userIds, accessIds, createdAt } }) => {
          const userId = ctx.userID;

          // Verify ownership
          const link = await tx.run(zql.links.where('id', linkId).one());
          if (!link) {
            throw new Error('Link not found');
          }
          if (link.createdBy !== userId) {
            throw new Error('Not authorized to share this link');
          }

          // Add access for each user
          for (let i = 0; i < userIds.length; i++) {
            const targetUserId = userIds[i];
            const accessId = accessIds[i];

            // Check if already shared
            const existing = await tx.run(
              zql.link_access
                .where('linkId', linkId)
                .where('userId', targetUserId)
                .one()
            );

            if (!existing) {
              await tx.mutate.link_access.insert({
                id: accessId,
                linkId,
                userId: targetUserId,
                createdAt,
              });
            }
          }
        }
      ),

      unshare: defineMutator(
        z.object({
          linkId: z.string(),
          userId: z.string(),
        }),
        async ({ tx, ctx, args: { linkId, userId: targetUserId } }) => {
          const userId = ctx.userID;

          // Verify ownership
          const link = await tx.run(zql.links.where('id', linkId).one());
          if (!link) {
            throw new Error('Link not found');
          }
          if (link.createdBy !== userId) {
            throw new Error('Not authorized to unshare this link');
          }

          // Find and delete the access record
          const access = await tx.run(
            zql.link_access
              .where('linkId', linkId)
              .where('userId', targetUserId)
              .one()
          );

          if (access) {
            await tx.mutate.link_access.delete({ id: access.id });
          }
        }
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
            })
          ),
        }),
        async ({
          tx,
          args: { id, name, contextType, contextId, visibility, timestamp, values },
        }) => {
          // Check for duplicate name (case-insensitive) per user per contextId
          const allUserConfigs = await tx.run(
            zql.saved_user_configurations
              .where('userId', authData.sub)
              .where('contextId', contextId)
          );
          if (allUserConfigs.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            throw new Error('A saved view with this name already exists for this board');
          }

          await tx.mutate.saved_user_configurations.insert({
            id,
            userId: authData.sub,
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
            })
          };
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
              })
            )
            .optional(),
        }),
        async ({ tx, args: { configId, name, visibility, timestamp, values } }) => {
          const config = await tx.run(zql.saved_user_configurations.where('id', configId).one());
          if (!config) {
            throw new Error('Saved view not found');
          }
          if (config.userId !== authData.sub) {
            throw new Error('You can only edit your own saved views');
          }

          // If renaming, check for duplicate name (case-insensitive)
          if (name && name.toLowerCase() !== config.name.toLowerCase()) {
            const allUserConfigs = await tx.run(
              zql.saved_user_configurations
                .where('userId', authData.sub)
                .where('contextId', config.contextId)
            );
            if (allUserConfigs.some(c => c.id !== configId && c.name.toLowerCase() === name.toLowerCase())) {
              throw new Error('A saved view with this name already exists for this board');
            }
          }

          await tx.mutate.saved_user_configurations.update({
            id: configId,
            ...(name !== undefined && { name }),
            ...(visibility !== undefined && { visibility }),
            updatedAt: timestamp,
          });

          // Full replace of values if provided
          if (values) {
            const existingValues = await tx.run(
              zql.saved_user_configuration_values.where('configId', configId)
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
        }
      ),
      delete: defineMutator(
        z.object({
          configId: z.string(),
        }),
        async ({ tx, args: { configId } }) => {
          const config = await tx.run(zql.saved_user_configurations.where('id', configId).one());
          if (!config) {
            throw new Error('Saved view not found');
          }
          if (config.userId !== authData.sub) {
            throw new Error('You can only delete your own saved views');
          }

          // Delete all value rows first (cascade may handle this, but be explicit)
          const existingValues = await tx.run(
            zql.saved_user_configuration_values.where('configId', configId)
          );
          for (const value of existingValues) {
            await tx.mutate.saved_user_configuration_values.delete({ id: value.id });
          }

          await tx.mutate.saved_user_configurations.delete({ id: configId });
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
          // ACL check is handled by WorkspacesACL
          await tx.mutate.workspaces.update({
            id: workspaceId,
            ...updates,
            updatedAt: timestamp,
          });
        }
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

          const updateData: { id: string; updatedAt: number; name?: string; description?: string | null } = {
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
            if (installations.length > 0) {
              const installedAppUpdateData: { id: string; updatedAt: number; webhookUrl?: string | null } = {
                id: installations[0].id,
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
        }),
        async ({ tx, args: { id, name, content, timestamp } }) => {
          await tx.mutate.email_signatures.insert({
            id,
            userId: authData.sub,
            name,
            content,
            isDefault: false,
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
        async ({ tx, args: { id, name, content, timestamp } }) => {
          const existing = await tx.run(
            zql.email_signatures.where('id', id).where('userId', authData.sub).one(),
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
        async ({ tx, args: { id } }) => {
          const existing = await tx.run(
            zql.email_signatures.where('id', id).where('userId', authData.sub).one(),
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
        async ({ tx, args: { id, timestamp } }) => {
          const existing = await tx.run(
            zql.email_signatures.where('id', id).where('userId', authData.sub).one(),
          );
          if (!existing) {
            throw new Error('Email signature not found');
          }
          const allSignatures = await tx.run(
            zql.email_signatures.where('userId', authData.sub),
          );
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
          // ACL check is handled by UsersACL
          await tx.mutate.users.update({
            id: userId,
            ...updates,
            updatedAt: timestamp,
          });
        }
      ),

      remove: defineMutator(
        z.object({
          workspaceId: z.string(),
          userId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { userId, timestamp } }) => {
          // ACL check is handled by UsersACL
          await tx.mutate.users.update({
            id: userId,
            leftAt: timestamp,
            updatedAt: timestamp,
          });
        }
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
          timestamp: z.number(),
        }),
        async ({
          tx,
          args: { orgId, orgName, orgDescription, workspaceId, workspaceOrgId, memberId, timestamp },
        }) => {
          const admin = await tx.run(
            zql.users
              .where('id', authData.sub)
              .where('workspaceId', workspaceId)
              .where('role', WorkspaceRole.ADMIN)
              .where('leftAt', 'IS', null)
              .one(),
          );
          if (!admin) throw new Error('Admin access required');

          const existing = await tx.run(
            zql.organizations
              .where('name', orgName)
              .where('status', Status.ACTIVE)
              .one(),
          );
          if (existing) throw new Error('Organization name already exists');

          await tx.mutate.organizations.insert({
            orgId,
            name: orgName,
            description: orgDescription || '',
            status: Status.ACTIVE,
            createdBy: authData.sub,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          await tx.mutate.workspace_organizations.insert({
            id: workspaceOrgId,
            workspaceId,
            orgId,
            role: WorkspaceRole.ADMIN,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          await tx.mutate.org_members.insert({
            memberId,
            orgId,
            email: admin.email,
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
          const admin = await tx.run(
            zql.users
              .where('id', authData.sub)
              .where('workspaceId', workspaceId)
              .where('role', WorkspaceRole.ADMIN)
              .where('leftAt', 'IS', null)
              .one()
          );
          if (!admin) throw new Error('Admin access required');

          // Check if already linked (active)
          const existingActive = await tx.run(
            zql.workspace_organizations
              .where('workspaceId', workspaceId)
              .where('orgId', orgId)
              .where('leftAt', 'IS', null)
              .one()
          );
          if (existingActive) throw new Error('Organization already linked');

          // Check if there's a previously removed entry
          const existingRemoved = await tx.run(
            zql.workspace_organizations
              .where('workspaceId', workspaceId)
              .where('orgId', orgId)
              .one()
          );

          if (existingRemoved) {
            // Reactivate the existing entry by clearing leftAt
            await tx.mutate.workspace_organizations.update({
              id: existingRemoved.id,
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
        }
      ),
      remove: defineMutator(
        z.object({
          workspaceId: z.string(),
          orgId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { workspaceId, orgId, timestamp } }) => {
          const admin = await tx.run(
            zql.users
              .where('id', authData.sub)
              .where('workspaceId', workspaceId)
              .where('role', WorkspaceRole.ADMIN)
              .where('leftAt', 'IS', null)
              .one()
          );
          if (!admin) throw new Error('Admin access required');

          const link = await tx.run(
            zql.workspace_organizations
              .where('workspaceId', workspaceId)
              .where('orgId', orgId)
              .where('leftAt', 'IS', null)
              .one()
          );
          if (link) {
            await tx.mutate.workspace_organizations.update({
              id: link.id,
              leftAt: timestamp,
            });
          }
        }
      ),
    },
    invitation: {
      revoke: defineMutator(
        z.object({
          invitationId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { invitationId, timestamp } }) => {
          const invitation = await tx.run(
            zql.invitations.where('id', invitationId).one()
          );
          if (!invitation || !invitation.workspaceId) throw new Error('Invitation not found');

          const admin = await tx.run(
            zql.users
              .where('id', authData.sub)
              .where('workspaceId', invitation.workspaceId)
              .where('role', WorkspaceRole.ADMIN)
              .where('leftAt', 'IS', null)
              .one()
          );
          if (!admin) throw new Error('Admin access required');

          await tx.mutate.invitations.update({
            id: invitationId,
            expiredAt: timestamp,
          });
        }
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
          // Reactivate a previously soft-deleted membership if one exists
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
    userPreference: {
      setChannelSortOrder: defineMutator(
        z.object({
          id: z.string(),
          channelSortOrder: z.nativeEnum(ChannelSortOrder),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, channelSortOrder, timestamp } }) => {
          const existing = await tx.run(
            zql.user_preferences.where('userId', authData.sub).one(),
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
              userId: authData.sub,
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
        async ({ tx, args: { id, enterSendsMessage, timestamp } }) => {
          const existing = await tx.run(
            zql.user_preferences.where('userId', authData.sub).one(),
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
              userId: authData.sub,
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
          emailMergeMode: z.nativeEnum(EmailMergeMode).optional(),
          autoDraftMode: z.nativeEnum(AutoDraftMode).optional(),
        }),
        async ({
          tx,
          args: {
            channelId,
            ownerUserId,
            assigneeUserGroupId,
            sendAsEmail,
            defaultCc,
            emailMergeMode,
            autoDraftMode,
          },
        }) => {
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
              ...(emailMergeMode !== undefined ? { emailMergeMode } : {}),
              ...(autoDraftMode !== undefined ? { autoDraftMode } : {}),
            });
          } else {
            await tx.mutate.email_channel_preferences.insert({
              channelId,
              ownerUserId: ownerUserId ?? authData.sub,
              assigneeUserGroupId: assigneeUserGroupId ?? null,
              boardId: null,
              sendAsEmail: sendAsEmail ?? null,
              classificationEnabled: false,
              classificationPrompt: null,
              categoryField: null,
              subCategoryField: null,
              defaultCc: defaultCc ?? null,
              emailMergeMode: emailMergeMode ?? EmailMergeMode.ENABLED,
              autoDraftMode: autoDraftMode ?? AutoDraftMode.OFF,
              priorityClassificationEnabled: false,
              priorityClassificationPrompt: null,
              priorityClassificationThreshold: 0.5,
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
            assigneeUserGroupId: null,
            boardId: null,
            sendAsEmail: null,
            classificationEnabled,
            classificationPrompt,
            categoryField,
            subCategoryField: subCategoryField ?? null,
            defaultCc: null,
            autoDraftMode: AutoDraftMode.OFF,
            priorityClassificationEnabled: false,
            priorityClassificationPrompt: null,
            priorityClassificationThreshold: 0.5,
          });
        }
        },
      ),
      upsertPriorityClassificationConfig: defineMutator(
        z.object({
          channelId: z.string(),
          priorityClassificationEnabled: z.boolean(),
          priorityClassificationPrompt: z.string().optional().nullable(),
          priorityClassificationThreshold: z.number().optional(),
        }),
        async ({ tx, ctx, args }) => {
          const { channelId, priorityClassificationEnabled, priorityClassificationPrompt, priorityClassificationThreshold } = args;
          const existing = await tx.run(
            zql.email_channel_preferences.where('channelId', channelId).one(),
          );
          if (existing) {
            await tx.mutate.email_channel_preferences.update({
              channelId,
              priorityClassificationEnabled,
              priorityClassificationPrompt: priorityClassificationPrompt ?? null,
              priorityClassificationThreshold: priorityClassificationThreshold ?? 0.5,
            });
          } else {
          await tx.mutate.email_channel_preferences.insert({
            channelId,
            ownerUserId: ctx.userID,
            assigneeUserGroupId: null,
            boardId: null,
            sendAsEmail: null,
            classificationEnabled: false,
            classificationPrompt: null,
            categoryField: null,
            subCategoryField: null,
            defaultCc: null,
            autoDraftMode: AutoDraftMode.OFF,
            priorityClassificationEnabled,
            priorityClassificationPrompt: priorityClassificationPrompt ?? null,
            priorityClassificationThreshold: priorityClassificationThreshold ?? 0.5,
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
    delayedMessages: {
      /** Create a new delayed message */
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

      /** Cancel a pending delayed message */
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
            throw new Error('Delayed message not found');
          }

          if (scheduled.status !== DelayedMessageStatus.PENDING) {
            throw new Error(`Cannot cancel a message with status: ${scheduled.status}`);
          }

          await deleteDelayedMessageEntityAttachments(tx, asyncTasks, id);

          await tx.mutate.delayed_messages.update({
            id,
            status: DelayedMessageStatus.CANCELLED,
            hasAttachment: false,
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
          const scheduled = await tx.run(
            zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one(),
          );

          if (!scheduled) {
            throw new Error('Delayed message not found');
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
      edit: defineMutator(
        z.object({
          id: z.string(),
          content: z.string().min(1),
          updatedAt: z.number(),
        }),
        async ({ tx, ctx, args: { id, content, updatedAt } }) => {
          const scheduled = await tx.run(
            zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one()
          );

          if (!scheduled) {
            throw new Error('Delayed message not found');
          }

          if (scheduled.status !== DelayedMessageStatus.PENDING) {
            throw new Error(`Cannot edit a message with status: ${scheduled.status}`);
          }

          if (scheduled.updatedAt !== updatedAt) {
            throw new Error(
              'Message was modified by another operation. Please refresh and try again.'
            );
          }

          await tx.mutate.delayed_messages.update({
            id,
            content: content.trim(),
            updatedAt,
          });
        }
      ),

      convertToDraft: defineMutator(
        z.object({
          id: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { id, timestamp } }) => {
          const scheduled = await tx.run(
            zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one()
          );

          if (!scheduled) {
            throw new Error('Delayed message not found');
          }

          if (scheduled.status !== DelayedMessageStatus.PENDING) {
            throw new Error(`Cannot convert a message with status: ${scheduled.status} to draft`);
          }

          const channelDrafts = await tx.run(
            zql.draft_messages.where('channelId', scheduled.channelId).where('userId', ctx.userID)
          );
          const existingDraft = channelDrafts.find(
            (d) => d.conversationId === (scheduled.conversationId ?? null) && d.messageId === null
          );

          const scheduledAttachments = await tx.run(
            zql.message_attachments
              .where('entityId', id)
              .where('entityType', AttachmentEntityType.DELAYED_MESSAGE),
          );

          const hasAttachment = scheduledAttachments.length > 0;

          if (existingDraft) {
            await deleteDraftEntityAttachments(tx, asyncTasks, existingDraft.id);
            await tx.mutate.draft_messages.delete({ id: existingDraft.id });
          }

          await tx.mutate.delayed_messages.delete({ id });

          // Reuse scheduled id as draft id so message_attachments.entityId stays valid.
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
        }
      ),

      sendNow: defineMutator(
        z.object({
          id: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { id, timestamp } }) => {
          const scheduled = await tx.run(
            zql.delayed_messages.where('id', id).where('senderId', ctx.userID).one()
          );

          if (!scheduled) {
            throw new Error('Delayed message not found');
          }

          if (scheduled.status !== DelayedMessageStatus.PENDING) {
            throw new Error(`Cannot send now a message with status: ${scheduled.status}`);
          }

          await tx.mutate.delayed_messages.update({
            id,
            updatedAt: timestamp,
            status: DelayedMessageStatus.SENDING,
          });
        }
      ),
    },

    draftMessages: {
      /** Delete a draft message by ID (only the owner can delete their own draft) */
      delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
        const draft = await tx.run(
          zql.draft_messages.where('id', id).where('userId', ctx.userID).one()
        );
        if (!draft) {
          throw new Error('Draft not found');
        }
        await deleteDraftEntityAttachments(tx, asyncTasks, id);
        await tx.mutate.draft_messages.delete({ id });
      }),

      /** Edit a draft message content */
      edit: defineMutator(
        z.object({
          id: z.string(),
          content: z.string().min(1),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { id, content, timestamp } }) => {
          const draft = await tx.run(
            zql.draft_messages.where('id', id).where('userId', ctx.userID).one()
          );
          if (!draft) {
            throw new Error('Draft not found');
          }
          await tx.mutate.draft_messages.update({
            id,
            content: content.trim(),
            updatedAt: timestamp,
          });
        }
      ),

      /** Send a draft message immediately (converts to sent message) */
      send: defineMutator(
        z.object({
          id: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { id, timestamp } }) => {
          const draft = await tx.run(
            zql.draft_messages.where('id', id).where('userId', ctx.userID).one()
          );
          if (!draft) {
            throw new Error('Draft not found');
          }
          if (draft.content.trim() === '') {
            const draftAtts = await tx.run(
              zql.message_attachments
                .where('entityId', id)
                .where('entityType', AttachmentEntityType.DRAFT)
            );
            if (draftAtts.length === 0) {
              throw new Error('Cannot send empty draft');
            }
          }

          const channel = await tx.run(zql.channels.where('id', draft.channelId).one());
          if (!channel) {
            throw new Error('Channel not found');
          }
          if (channel.isArchived) {
            throw new Error('Channel is archived');
          }

          const participant = await tx.run(
            zql.channel_participants
              .where('channelId', draft.channelId)
              .where('userId', ctx.userID)
              .one(),
          );
          if (!participant) {
            throw new Error('You are no longer a member of this channel');
          }

          asyncTasks.push(async () => {
            try {
              await deliverDraftServerMessage({
                draftId: id,
                senderId: ctx.userID,
                timestamp,
              });
            } catch (error) {
              logger.error('[DRAFT-SEND] Failed to convert draft to sent message', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          });
        }
      ),
    },
    automations: {
      // Create a fresh PROPOSAL row. New automation: omit `automationSeriesId`, row
      // uses its own id as the lineage seed. Edit existing LIVE: pass
      // `automationSeriesId` from the LIVE row + a copy of its config/metadata.
      createProposal: defineMutator(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(80),
          configJson: z.string(),
          metadataJson: z.string(),
          eventType: z.string(),
          automationSeriesId: z.string().optional(),
          timestamp: z.number(),
        }),
        async ({
          ctx,
          tx,
          args: { id, name, configJson, metadataJson, eventType, automationSeriesId, timestamp },
        }) => {
          await tx.mutate.workflows.insert({
            id,
            workflowType: 'Automations',
            workflowName: name,
            eventType,
            status: 'DRAFT',
            automationSeriesId: automationSeriesId ?? id,
            context: configJson,
            metadata: metadataJson,
            ticketId: null,
            workspaceId: ctx.workspaceId,
            configuration: null,
            scheduledAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        },
      ),
      update: defineMutator(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(80).optional(),
          configJson: z.string().optional(),
          metadataJson: z.string().optional(),
          eventType: z.string().optional(),
          timestamp: z.number(),
        }),
        async ({
          tx,
          args: { id, name, configJson, metadataJson, eventType, timestamp },
        }) => {
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            throw new Error(`Automation "${id}" not found`);
          }
          if (existing.status !== 'DRAFT') {
            throw new Error(
              `Automation "${id}" is ${existing.status}; only DRAFT proposals can be edited.`,
            );
          }

          await tx.mutate.workflows.update({
            id,
            updatedAt: timestamp,
            ...(name !== undefined && { workflowName: name }),
            ...(metadataJson !== undefined && { metadata: metadataJson }),
            ...(configJson !== undefined && { context: configJson }),
            ...(configJson !== undefined && eventType !== undefined && { eventType }),
          });
          logger.info(`[Mutator] automations.update OK id=${id}`);
        },
      ),
      delete: defineMutator(
        z.object({ id: z.string() }),
        async ({ tx, args: { id } }) => {
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (existing && existing.workflowType === 'Automations' && existing.status !== 'DRAFT') {
            throw new Error(
              `Cannot delete "${id}": only DRAFT proposals can be deleted (status is ${existing.status}).`,
            );
          }
          await tx.mutate.workflows.delete({ id });
        },
      ),
      submitForApproval: defineMutator(
        z.object({ id: z.string(), timestamp: z.number() }),
        async ({ tx, args: { id, timestamp } }) => {
          logger.info(`[Mutator] automations.submitForApproval START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            throw new Error(`Automation "${id}" not found`);
          }
          await tx.mutate.workflows.update({
            id,
            status: 'PENDING_APPROVAL',
            updatedAt: timestamp,
          });
          asyncTasks.push(async () => {
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              await approvalService.submitForApproval(id, authData.sub);
              logger.info(`[Mutator] submitForApproval asyncTask OK id=${id}`);
            } catch (err) {
              logger.error('[Mutator] submitForApproval asyncTask FAIL', {
                automationId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
      revoke: defineMutator(
        z.object({ id: z.string(), timestamp: z.number() }),
        async ({ tx, args: { id, timestamp } }) => {
          logger.info(`[Mutator] automations.revoke START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            throw new Error(`Automation "${id}" not found`);
          }
          await tx.mutate.workflows.update({
            id,
            status: 'REVOKED',
            updatedAt: timestamp,
          });
          asyncTasks.push(async () => {
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              await approvalService.revoke(id, authData.sub);
              logger.info(`[Mutator] revoke asyncTask OK id=${id}`);
            } catch (err) {
              logger.error('[Mutator] revoke asyncTask FAIL', {
                automationId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
      approve: defineMutator(
        z.object({
          id: z.string(),
          note: z.string().nullable().optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, note, timestamp } }) => {
          logger.info(`[Mutator] automations.approve START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            throw new Error(`Automation "${id}" not found`);
          }
          await tx.mutate.workflows.update({
            id,
            status: 'DISABLED',
            updatedAt: timestamp,
          });
          asyncTasks.push(async () => {
            const t0 = Date.now();
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              const result = await approvalService.approve(id, authData.sub, note ?? null);
              logger.info(
                `[Mutator] approve asyncTask OK id=${id} autoRevokedCount=${result.autoRevoked.length} elapsedMs=${Date.now() - t0}`,
              );
            } catch (err) {
              logger.error('[Mutator] approve asyncTask FAIL', {
                automationId: id,
                elapsedMs: Date.now() - t0,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
      reject: defineMutator(
        z.object({
          id: z.string(),
          note: z.string().min(1),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, note, timestamp } }) => {
          logger.info(`[Mutator] automations.reject START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            throw new Error(`Automation "${id}" not found`);
          }
          await tx.mutate.workflows.update({
            id,
            status: 'REJECTED',
            updatedAt: timestamp,
          });
          asyncTasks.push(async () => {
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              await approvalService.reject(id, authData.sub, note);
              logger.info(`[Mutator] reject asyncTask OK id=${id}`);
            } catch (err) {
              logger.error('[Mutator] reject asyncTask FAIL', {
                automationId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
      activate: defineMutator(
        z.object({ id: z.string(), timestamp: z.number() }),
        async ({ tx, args: { id, timestamp } }) => {
          logger.info(`[Mutator] automations.activate START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            logger.warn(`[Mutator] automations.activate REJECT id=${id} reason=not-found`);
            throw new Error(`Automation "${id}" not found`);
          }
          if (existing.status !== 'ACTIVE' && existing.status !== 'DISABLED') {
            throw new Error(
              `Automation "${id}" is ${existing.status}; only LIVE rows can be activated.`,
            );
          }
          await tx.mutate.workflows.update({
            id,
            status: 'ACTIVE',
            updatedAt: timestamp,
          });
          logger.info(`[Mutator] automations.activate OPTIMISTIC id=${id} status=ACTIVE`);

          asyncTasks.push(async () => {
            const t0 = Date.now();
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              await approvalService.toggleLive(id, authData.sub, AutomationStatus.ACTIVE);
              logger.info(
                `[Mutator] automations.activate asyncTask OK id=${id} elapsedMs=${Date.now() - t0}`,
              );
            } catch (err) {
              logger.error('[Mutator] automations.activate asyncTask FAIL', {
                automationId: id,
                elapsedMs: Date.now() - t0,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
      disable: defineMutator(
        z.object({ id: z.string(), timestamp: z.number() }),
        async ({ tx, args: { id, timestamp } }) => {
          logger.info(`[Mutator] automations.disable START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            logger.warn(`[Mutator] automations.disable REJECT id=${id} reason=not-found`);
            throw new Error(`Automation "${id}" not found`);
          }
          if (existing.status !== 'ACTIVE' && existing.status !== 'DISABLED') {
            throw new Error(
              `Automation "${id}" is ${existing.status}; only LIVE rows can be disabled.`,
            );
          }
          await tx.mutate.workflows.update({
            id,
            status: 'DISABLED',
            updatedAt: timestamp,
          });
          logger.info(`[Mutator] automations.disable OPTIMISTIC id=${id} status=DISABLED`);

          asyncTasks.push(async () => {
            const t0 = Date.now();
            try {
              const { approvalService } = await import(
                '../automations/services/approval.service'
              );
              await approvalService.toggleLive(id, authData.sub, AutomationStatus.DISABLED);
              logger.info(
                `[Mutator] automations.disable asyncTask OK id=${id} elapsedMs=${Date.now() - t0}`,
              );
            } catch (err) {
              logger.error('[Mutator] automations.disable asyncTask FAIL', {
                automationId: id,
                elapsedMs: Date.now() - t0,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        },
      ),
    },
  });
}
