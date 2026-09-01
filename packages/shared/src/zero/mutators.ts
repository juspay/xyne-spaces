import { ReadonlyJSONValue, Transaction, defineMutators, defineMutator } from '@rocicorp/zero';
import {
  ChannelRole,
  ChannelType,
  ChannelVisibility,
  MessageType,
  CallStatus,
  CallType,
  RecurringCallSeriesStatus,
  InvitationResponse,
  MeetingStatus,
  ChannelScopeType,
  ChannelAddUserPolicy,
  ChannelSortOrder,
  ChannelFilterMode,
  ConversationParticipation,
  TicketStatusV2,
  MailboxState,
  TicketPriority,
  TicketReferenceRelation,
  EmailMergeMode,
  AutoDraftMode,
  CanvasVisibility,
  CanvasRole,
  CanvasCommentThreadStatus,
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
  QueryVisualizationType,
  ActivityClassification,
  AccessType,
  BoardType,
  ReenterMode,
  VisitSlaMode,
  ApproverType,
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
  GuestEntity,
  WorkspaceRole,
  Status,
  OrgRole,
  DelayedMessageStatus,
  DraftOrigin,
  Schema,
  CollectionRole,
  VCSProviderType,
  ReleaseTrackingMode,
  MessageArtifactStatus,
} from './schema.js';
import { FlowPlanSchema, serializeFlowPlan, validateFlowPlan } from '../board-types/index.js';
import { createForwardedMessageXml, parseForwardedMessageXml } from '../forwardedMessage.js';
import { getNudgeActionBehavior } from '../nudges.js';
import {
  parseTicketMd,
  serializeInitialMessageMd,
  serializeParentMessageMd,
} from '../utils/activityMetadataParser.js';
import { THREAD_TYPE_NAMES } from '../tags/vocabularies.js';
import { assertCanvasDestinationAccess } from '../utils/canvasDestinationAccess.js';
import {
  getCanvasFolderNameConflictMessage,
  rethrowCanvasFolderNameConflict,
} from '../utils/canvasFolderNameConflict.js';
import { resolveCanvasHierarchy } from '../utils/canvasHierarchy.js';
import {
  SDLC_MEMBERSHIP_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  createSdlcLinkSchema,
  entityLinkContextSchema,
} from '../sdlc.js';
import { parseFieldOptions, serializeFieldOptions } from '../utils/formFieldOptions.js';
import {
  validateFieldBranches,
  validateUniqueFieldNames,
  assertFieldIsCurrentlyActive,
} from './formsMutatorHelpers.js';
import type { MessageType as MessageTypeEnum } from './schema.js';
import { extractAllMentions } from '../utils/mentionParser.js';
import {
  MAX_NOTIFICATION_KEYWORDS,
  MAX_NOTIFICATION_KEYWORD_LENGTH,
  normalizeNotificationKeywords,
} from '../utils/notificationKeywords.js';
import { isDeskChannelType, deskTypeForChannelType } from '../utils/channel.js';
import { DEFAULT_ROLE_NAME_TO_ENUM } from '../utils/roleFrameworkUtils.js';
import { SUMMARY_PROMPT_MAX_LENGTH } from '../templates/callSummary.js';
import { z } from 'zod';
import { isBaselineCanvasType, sdlcTrackStatusSchema } from '../sdlc.js';
import type { CallParticipantMetadata } from '../types/call.js';

const serializeCanvasCommentMentionedUserIds = (mentionedUserIds: string[]): string =>
  JSON.stringify([...new Set(mentionedUserIds)]);

async function getCanvasThreadCommentCount(
  tx: Transaction<Schema>,
  threadId: string,
): Promise<number> {
  const comments = await tx.run(zql.canvas_comments.where('threadId', threadId));
  return comments.filter(comment => comment.deletedAt == null).length;
}

const COLLECTION_ROLE_RANK: Record<CollectionRole, number> = {
  [CollectionRole.VIEWER]: 1,
  [CollectionRole.EDITOR]: 2,
  [CollectionRole.OWNER]: 3,
};

/**
 * Resolve a user's CollectionRole on a collection from its collection_permissions
 * rows, considering a direct grant (userId), a grant made to a group they
 * belong to (userGroupId), or a grant made to a channel they participate in
 * (channelId — always VIEWER, enforced at grant time, but still needs to be
 * visible here so a channel-only Viewer can exercise "any role can share").
 * Mirrors apps/backend's identical helper (and collectionAccess.ts's
 * resolveCollectionAccess) so the client's optimistic result agrees with the
 * server's authoritative one. Membership is resolved at check-time, not
 * fanned out into per-member rows.
 */
async function resolveCollectionPermissionRole(
  tx: Transaction<Schema>,
  collectionId: string,
  userId: string,
): Promise<CollectionRole | null> {
  const permissions = await tx.run(zql.collection_permissions.where('collectionId', collectionId));
  const groupIds = new Set(
    (await tx.run(zql.user_group_mappings.where('userId', userId))).map(m => m.userGroupId),
  );
  const channelIds = new Set(
    (await tx.run(zql.channel_participants.where('userId', userId))).map(cp => cp.channelId),
  );

  let role: CollectionRole | null = null;
  for (const p of permissions) {
    const matches =
      p.userId === userId ||
      (p.userGroupId !== null && groupIds.has(p.userGroupId)) ||
      (p.channelId !== null && channelIds.has(p.channelId));
    if (!matches) continue;
    const candidate = p.role as CollectionRole;
    if (!role || COLLECTION_ROLE_RANK[candidate] > COLLECTION_ROLE_RANK[role]) role = candidate;
  }
  return role;
}

/** Build initial_message_md from message data. Single helper for all conversation creation sites. */
function buildInitialMessageMd(msg: {
  messageId: string;
  conversationId: string;
  workspaceId?: string | null;
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
    workspaceId: msg.workspaceId ?? null,
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
  addReplyToData,
  buildRepliesMdFromMessages,
  isChatMessageType,
  parseRepliesMd,
  resolveMessage,
  serializeRepliesMd,
  updateReactionsMd,
  updateInitialMessageMdField,
  updateInitialMessageMdReaction,
} from './messageMetadata.js';
import {
  updateTicketMdFromZero,
  updateSubTicketsMdFromZero,
  linkSubTicketConversationToParentFromZero,
} from '../utils/ticketMetadata.js';
import {
  parseSlashCommandArtifactMessage,
  withSlashCommandArtifactClosed,
} from '../utils/slashCommandArtifact.js';
import { stringFromFormValue } from '../tickets/utils.js';

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

async function hasCanvasVersionEditAccess(
  tx: Transaction<Schema>,
  canvas: { id: string; createdBy: string },
  userId: string,
  ctx?: { role?: string; workspaceId?: string },
): Promise<boolean> {
  if (canvas.createdBy === userId) return true;

  const participants = await tx.run(
    zql.canvas_participants
      .where('canvasId', canvas.id)
      .where('role', 'IN', [CanvasRole.EDITOR, CanvasRole.OWNER]),
  );

  if (participants.length === 0) return false;

  // Direct user match — no query needed
  if (participants.some(p => p.userId === userId)) {
    return true;
  }

  // Batch: collect all userGroupIds and channelIds
  const userGroupIds = participants
    .map(p => p.userGroupId)
    .filter((id): id is string => Boolean(id));
  const channelIds = participants
    .map(p => p.channelId)
    .filter((id): id is string => Boolean(id));

  // Batch query: is the user a member of any of these groups?
  if (userGroupIds.length > 0) {
    const groupMapping = await tx.run(
      zql.user_group_mappings
        .where('userId', userId)
        .where(({ cmp }) => cmp('userGroupId', 'IN', userGroupIds)),
    );
    if (groupMapping.length > 0) {
      return true;
    }
  }

  // Batch query: is the user a participant in any of these channels?
  if (channelIds.length > 0) {
    const channelParticipantships = await tx.run(
      zql.channel_participants
        .where('userId', userId)
        .where(({ cmp }) => cmp('channelId', 'IN', channelIds)),
    );
    if (channelParticipantships.length > 0) {
      return true;
    }
  }

  if (ctx?.role !== WorkspaceRole.GUEST || !ctx.workspaceId) {
    return false;
  }

  // Batch query: does the guest have direct channel access to any of these channels?
  if (channelIds.length > 0) {
    const directGuestAccess = await tx.run(
      zql.guest_access
        .where('userId', userId)
        .where('workspaceId', ctx.workspaceId)
        .where('accessibleEntityType', GuestEntity.CHANNEL)
        .where(({ cmp }) => cmp('accessibleEntityId', 'IN', channelIds)),
    );
    if (directGuestAccess.length > 0) {
      return true;
    }
  }

  return false;
}

async function assertCanvasCommentEditAccess(
  tx: Transaction<Schema>,
  canvasId: string,
  userId: string,
): Promise<{ id: string; createdBy: string }> {
  const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
  if (!canvas) {
    throw new Error('Canvas not found');
  }

  const canEdit = await hasCanvasVersionEditAccess(tx, canvas, userId);
  if (!canEdit) {
    throw new Error('You do not have permission to comment on this canvas');
  }

  return canvas;
}

async function assertCanvasThreadManageAccess(
  tx: Transaction<Schema>,
  thread: { canvasId: string; createdBy: string },
  userId: string,
): Promise<void> {
  if (thread.createdBy === userId) {
    return;
  }

  await assertCanvasCommentEditAccess(tx, thread.canvasId, userId);
}

async function deleteConversationWithParticipants(
  tx: Transaction<Schema>,
  conversationId: string,
): Promise<void> {
  const participants = await tx.run(
    zql.conversation_participants.where('conversationId', conversationId),
  );

  await Promise.all(
    participants.map(participant =>
      tx.mutate.conversation_participants.delete({ id: participant.id })
    )
  );

  const discussionLinks = await tx.run(
    zql.sdlc_entity_links
      .where('targetType', 'CONVERSATION')
      .where('targetId', conversationId)
      .where('relationType', 'DISCUSSION'),
  );
  await Promise.all(
    discussionLinks.map(link => tx.mutate.sdlc_entity_links.delete({ id: link.id })),
  );

  await tx.mutate.conversations.delete({ conversationId });
}

const FORM_VALUE_CHANGED_MESSAGE =
  'Form value changed. Review the latest form changes before saving.';

export const mutators = defineMutators({
  notificationSettings: {
      setChannelNotificationLevel: defineMutator(
       z.object({
         channelId: z.string(),
         desktopNotificationLevel: z
           .enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE'])
           .nullable()
           .optional(),
         mobileNotificationLevel: z
           .enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE'])
           .nullable()
           .optional(),
         threadReplyNotificationsEnabled: z.boolean().nullable().optional(),
         channelWideMentionsEnabled: z.boolean().nullable().optional(),
         timestamp: z.number(),
       }),
      async ({
        tx,
        ctx,
        args: {
           channelId,
           desktopNotificationLevel,
           mobileNotificationLevel,
           threadReplyNotificationsEnabled,
           channelWideMentionsEnabled,
           timestamp,
         },
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
           // undefined = not provided (don't touch), null = reset to inherit global, value = explicit override
           ...(desktopNotificationLevel !== undefined && { desktopNotificationLevel: desktopNotificationLevel ?? null }),
           ...(mobileNotificationLevel !== undefined && { mobileNotificationLevel: mobileNotificationLevel ?? null }),
           ...(threadReplyNotificationsEnabled !== undefined && { threadReplyNotificationsEnabled: threadReplyNotificationsEnabled ?? null }),
           ...(channelWideMentionsEnabled !== undefined && { channelWideMentionsEnabled: channelWideMentionsEnabled ?? null }),
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
          workspaceId: _ctx.workspaceId,
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
            workspaceId: _ctx.workspaceId,
            id: channelUserStatusId,
            channelId: channelId,
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
            userId: _ctx.userID,
            isStarred: false,
            isClosed: false,
            unreadCount: 0,
            isRecapSubscribed: false,
            // null = inherit from UserPreference.globalDesktopNotificationLevel
            desktopNotificationLevel: null,
            mobileNotificationLevel: null,
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
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
            id: statusId,
            channelId: channelId,
            lastViewedAt: timestamp,
            conversationSeenCutoffAt,
            userId: user.id,
            isStarred: false,
            isClosed: false,
            unreadCount: 0,
            isRecapSubscribed: false,
            // null = inherit from UserPreference.globalDesktopNotificationLevel
            desktopNotificationLevel: null,
            mobileNotificationLevel: null,
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
    updateShowTicketsTabTicketsInChat: defineMutator(
      z.object({
        channelId: z.string(),
        show: z.boolean(),
      }),
      async ({ tx, ctx, args: { channelId, show } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        if (channel.scopeType !== ChannelScopeType.DEFAULT) {
          throw new Error('Can only update this setting for default channels');
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (channel.createdBy !== ctx.userID && (!participant || participant.role !== ChannelRole.ADMIN)) {
          throw new Error('Only channel admins or the owner can change Tickets-tab visibility');
        }

        await tx.mutate.channels.update({
          id: channelId,
          showTicketsTabTicketsInChat: show,
        });
      },
    ),
    updateCallSummaryPrompt: defineMutator(
      z.object({
        channelId: z.string(),
        prompt: z
          .string()
          .max(SUMMARY_PROMPT_MAX_LENGTH, 'Call summary template must be 20000 characters or less')
          .nullable(),
      }),
      async ({ tx, ctx, args: { channelId, prompt } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) {
          throw new Error("Channel doesn't exist");
        }

        const participant = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (channel.createdBy !== ctx.userID && (!participant || participant.role !== ChannelRole.ADMIN)) {
          throw new Error('Only channel admins or the owner can change call summary settings');
        }

        await tx.mutate.channels.update({
          id: channelId,
          callSummaryPrompt: prompt?.trim() ? prompt : null,
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
          zql.draft_messages
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
        );

        // Find the channel-level draft (conversationId === null)
        const draft = channelDrafts.find(d => d.conversationId === null);

        if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
          await tx.mutate.draft_messages.delete({ id: draft.id });
        } else if (draftMessage.trim() !== '') {
          await tx.mutate.draft_messages.upsert({
            workspaceId: ctx.workspaceId,
            id: draft?.id || draftMessageId,
            conversationId: null,
            channelId,
            userId: ctx.userID,
            content: draftMessage,
            hasAttachment: draft?.hasAttachment || false,
            origin: DraftOrigin.user,
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

        const activityBySourceId = new Map(
          unreadActivities.map(a => [a.actionSourceId, a]),
        );
        const uniqueSourceIds = [...activityBySourceId.keys()];

        // Batch fetch messages
        const foundMessages = await tx.run(
          zql.messages.where('messageId', 'IN', uniqueSourceIds),
        );
        const messageByMessageId = new Map(
          foundMessages.map(m => [m.messageId, m]),
        );

        // For messages not found, try resolveMessage fallback individually
        const missingIds = uniqueSourceIds.filter(id => !messageByMessageId.has(id));
        for (const id of missingIds) {
          const resolved = await resolveMessage(tx, id);
          if (resolved) {
            messageByMessageId.set(resolved.messageId, resolved);
          }
        }

        // Batch fetch conversations for all found messages
        const conversationIds = [...new Set(
          [...messageByMessageId.values()].map(m => m.conversationId),
        )];
        const conversations = await tx.run(
          zql.conversations.where('conversationId', 'IN', conversationIds),
        );
        const convByConversationId = new Map(
          conversations.map(c => [c.conversationId, c]),
        );

        for (const [sourceId, activity] of activityBySourceId) {
          const message = messageByMessageId.get(sourceId);
          if (!message) {
            continue;
          }
          const conv = convByConversationId.get(message.conversationId);
          if (conv?.initialMessageId === message.messageId) {
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
          isClosed: false,
          updatedAt,
        });
      },
    ),
    moveToSection: defineMutator(
      z.object({
        channelId: z.string(),
        sectionId: z.string().nullable(),
        position: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, sectionId, position, timestamp } }) => {
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

        // When assigning to a section, verify it belongs to the current user.
        if (sectionId) {
          const section = await tx.run(
            zql.channel_sections
              .where('id', sectionId)
              .where('userId', ctx.userID)
              .where('isDeleted', false)
              .one(),
          );
          if (!section) {
            throw new Error('Section not found');
          }
        }

        await tx.mutate.channel_user_status.update({
          id: userStatus.id,
          sectionId,
          sectionPosition: sectionId ? position : null,
          ...(sectionId ? { isStarred: false } : {}),
          updatedAt: timestamp,
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
            senderId: ctx.userID,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            createdAt: now,
          }),
        });

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
            senderId: ctx.userID,
            content: systemMessageContent,
            msgType: MessageType.SYSTEM,
            createdAt: now,
          }),
        });

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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
        attachmentIds: z.array(z.string()).optional(),
        entityLinkContext: entityLinkContextSchema.optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          channelId,
          content,
          type,
          conversationId,
          messageId,
          timestamp,
          attachmentIds,
          entityLinkContext,
        },
      }) => {
        if (content === '') {
          throw new Error('Message content or files are required to start a conversation');
        }

        const now = timestamp;

        let hasAttachments = false;
        if (attachmentIds !== undefined) {
          // Explicit attachment set from caller (pending-message-aware sends).
          // Transfer only these specific ids; leave any other draft attachments
          // alone so a concurrent compose isn't corrupted. Never delete the draft row.
          if (attachmentIds.length > 0) {
            hasAttachments = true;
            for (const attachmentId of attachmentIds) {
              const attachment = await tx.run(
                zql.message_attachments.where('id', attachmentId).one(),
              );
              if (!attachment) continue;
              if (
                attachment.entityType === AttachmentEntityType.CHAT &&
                attachment.entityId === messageId
              ) {
                continue;
              }
              await tx.mutate.message_attachments.update({
                id: attachmentId,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId,
              });
            }
          }
        } else {
          // Legacy path: scan the current draft and transfer everything.
          const channelDrafts = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', ctx.userID)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
          );
          const draft = channelDrafts.find(d => d.conversationId === null);

          if (draft) {
            const draftAttachments = await tx.run(
              zql.message_attachments
                .where('entityId', draft.id)
                .where('entityType', AttachmentEntityType.DRAFT),
            );

            if (draftAttachments.length > 0) {
              hasAttachments = true;
              for (const attachment of draftAttachments) {
                await tx.mutate.message_attachments.update({
                  id: attachment.id,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId: conversationId,
                });
              }
            }

            await tx.mutate.draft_messages.delete({
              id: draft.id,
            });
          }
        }

        await tx.mutate.conversations.insert({
          conversationId,
          channelId,
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
            senderId: ctx.userID,
            content: content.trim(),
            msgType: type,
            hasAttachment: hasAttachments,
            createdAt: now,
          }),
        });

        if (entityLinkContext) {
          await tx.mutate.sdlc_entity_links.insert({
            id: entityLinkContext.linkId,
            workspaceId: ctx.workspaceId,
            channelId,
            sourceType: entityLinkContext.sourceType,
            sourceId: entityLinkContext.sourceId,
            targetType: 'CONVERSATION',
            targetId: conversationId,
            relationType: 'DISCUSSION',
            createdBy: ctx.userID,
            createdAt: now,
          });
        }

        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          workspaceId: ctx.workspaceId,
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

        // Desk-ticket messages store content as '' (body lives in the email table).
        // Fall back to the ticket title from ticket_md so the forwarded bubble
        // shows something meaningful instead of a blank preview.
        if (!isReForwarding && !forwardedContent?.trim() && originalConversation?.ticket_md) {
          const parsed = parseTicketMd(originalConversation.ticket_md);
          if (parsed?.title) forwardedContent = parsed.title;
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
              workspaceId: ctx.workspaceId,
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
                  createdAt: (attInfo.createdAt || now) + j,
                  position: j,
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
          workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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

        let trueLastReplyAt: number | undefined = undefined;
        if (conversation.replyCount > 0) {
          const latestReply = await tx.run(
            zql.messages
              .where('conversationId', conversationId)
              .where('messageId', '!=', conversation.initialMessageId)
              .orderBy('createdAt', 'desc')
              .limit(1)
          );
          if (latestReply[0]) {
            trueLastReplyAt = latestReply[0].createdAt;
          }
        }

        // Create new manual subscription entry with null participationType
        await tx.mutate.conversation_participants.insert({
          workspaceId: ctx.workspaceId,
          id: participantId,
          conversationId,
          userId: ctx.userID,
          isSubscribed: true,
          joinedAt: timestamp,
          channelId: conversation.channelId,
          lastReplyAt: trueLastReplyAt || null,
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
        attachmentIds: z.array(z.string()).optional(),
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
          attachmentIds,
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

        // One open artifact per thread. A thread is a single incident's workspace,
        // so a second /sev2 inside it would fork the responders across two cards
        // and two calls. The channel is unrestricted — that is where a genuinely
        // separate incident belongs.
        const outgoingArtifact = parseSlashCommandArtifactMessage(content);
        if (outgoingArtifact) {
          const openArtifact = await tx.run(
            zql.message_artifacts
              // channelId first: it is the only selective index on this table.
              .where('channelId', conversation.channelId)
              .where('conversationId', conversationId)
              .where('command', outgoingArtifact.definition.command)
              .where('status', MessageArtifactStatus.ACTIVE)
              .one(),
          );
          if (openArtifact) {
            throw new Error(
              `A ${outgoingArtifact.definition.badge} is already open in this thread`,
            );
          }
        }

        let hasAttachments = false;
        if (attachmentIds !== undefined) {
          // Explicit list from a pending-message-aware caller: transfer only
          // those ids, leave any other DRAFT attachments alone, never touch
          // the draft row (the client's clearContent mutator owns draft state).
          if (attachmentIds.length > 0) {
            hasAttachments = true;
            for (const attachmentId of attachmentIds) {
              const attachment = await tx.run(
                zql.message_attachments.where('id', attachmentId).one(),
              );
              if (!attachment) continue;
              if (
                attachment.entityType === AttachmentEntityType.CHAT &&
                attachment.entityId === messageId
              ) {
                continue;
              }
              await tx.mutate.message_attachments.update({
                id: attachmentId,
                entityId: messageId,
                entityType: AttachmentEntityType.CHAT,
                conversationId,
              });
            }
          }
        } else {
          // Legacy path: scan the draft for this conversation and transfer everything.
          const channelDrafts = await tx.run(
            zql.draft_messages
              .where('channelId', conversation.channelId)
              .where('userId', ctx.userID)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
          );
          const draft = channelDrafts.find(d => d.conversationId === conversationId);

          if (draft) {
            const draftAttachments = await tx.run(
              zql.message_attachments
                .where('entityId', draft.id)
                .where('entityType', AttachmentEntityType.DRAFT),
            );

            if (draftAttachments.length > 0) {
              hasAttachments = true;
              for (const attachment of draftAttachments) {
                await tx.mutate.message_attachments.update({
                  id: attachment.id,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId: conversationId,
                });
              }
            }

            await tx.mutate.draft_messages.delete({
              id: draft.id,
            });
          }
        }

        const message = {
          messageId,
          conversationId,
          workspaceId: ctx.workspaceId,
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

        // Update sender's lastReadAt BEFORE inserting the message so Zero's reactive
        // store has the updated value in the same cycle as (or before) the message
        // appears — preventing the "New Messages" banner from flashing on the sender's
        // own message. Also upgrade MENTIONED → AUTHOR in the same update.
        const existingParticipant = await tx.run(
          zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (existingParticipant) {
          const needsUpgrade = existingParticipant.participationType !== ConversationParticipation.AUTHOR;
          const needsResubscribe = !existingParticipant.isSubscribed;
          const needsUpdate = needsUpgrade || needsResubscribe || existingParticipant.lastReplyAt !== timestamp || existingParticipant.lastReadAt !== timestamp;

          if (needsUpdate) {
            await tx.mutate.conversation_participants.update({
              id: existingParticipant.id,
              ...(needsUpgrade ? { participationType: ConversationParticipation.AUTHOR } : {}),
              ...(needsResubscribe ? { isSubscribed: true } : {}),
              lastReadAt: timestamp,
              lastReplyAt: timestamp,
            });
          }
        }

        await tx.mutate.messages.insert(message);

        if (type === MessageType.USER || type === MessageType.FORWARDED) {
          const repliesData = parseRepliesMd(conversation.replies_md);
          const updatedRepliesData = addReplyToData(repliesData, ctx.userID);
          const updatedRepliesMd = serializeRepliesMd(updatedRepliesData);

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
            workspaceId: ctx.workspaceId,
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
              workspaceId: ctx.workspaceId,
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
    /**
     * Close a slash-command artifact (e.g. decline a SEV2) without ever running
     * a call. Only the message's author may do it.
     *
     * Two writes, both required: the artifact row moves to a terminal status so
     * the banner and channel indicator clear for everyone, and the closed marker
     * is baked into the message's FlowJSON so the card still renders as finished
     * once the row has left the ACTIVE-only artifact subscription.
     */
    closeSlashCommandArtifact: defineMutator(
      z.object({ messageId: z.string(), timestamp: z.number() }),
      async ({ tx, ctx, args: { messageId, timestamp } }) => {
        const message = await resolveMessage(tx, messageId);
        if (!message) {
          throw new Error('Message not available');
        }
        if (message.senderId !== ctx.userID) {
          throw new Error('Only the author can close this incident');
        }
        if (!parseSlashCommandArtifactMessage(message.content)) {
          throw new Error('Message is not a slash command artifact');
        }

        const artifact = await tx.run(
          zql.message_artifacts.where('messageId', messageId).one(),
        );
        if (artifact && artifact.status !== MessageArtifactStatus.ACTIVE) {
          throw new Error('This incident is already closed');
        }

        const content = withSlashCommandArtifactClosed(message.content, {
          closedAt: timestamp,
          closedBy: ctx.userID,
        });
        if (!content) {
          throw new Error('Message is not a slash command artifact');
        }

        if (artifact) {
          await tx.mutate.message_artifacts.update({
            id: artifact.id,
            status: MessageArtifactStatus.CANCELLED,
            updatedAt: timestamp,
          });
        }
        // Deliberately not `edited: true` — closing is a lifecycle transition,
        // not an edit, and must not raise a "message edited" notification.
        await tx.mutate.messages.update({ messageId, content });
        await updateInitialMessageMdField(tx, { messageId }, { content });
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
              workspaceId: ctx.workspaceId,
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

        const channelCopies = await tx.run(zql.conversations.where('initialMessageId', messageId));

        for (const channelCopy of channelCopies) {
          if (channelCopy.conversationId === conversation.conversationId) {
            continue;
          }

          await deleteConversationWithParticipants(tx, channelCopy.conversationId);
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
            {
              isDeleted: true,
              content: '',
              hasAttachment: false,
              edited: false,
              link_preview_md: ''
            },
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
            // Delete ghost root FIRST, before the conversation (mirrors server-side fix).
            if (isInitialMessageDeleted && otherMessages[0]) {
              await tx.mutate.messages.delete({ messageId: otherMessages[0].messageId });
            }

            // Delete the conversation
            await deleteConversationWithParticipants(tx, conversation.conversationId);
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
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
              .one(),
          );
        } else {
          const channelDrafts = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', ctx.userID)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
          );
          existingDraft = channelDrafts.find(d => d.conversationId === null);
        }

        const finalDraftMessageId = existingDraft?.id || draftMessageId;

        // 2. If no draft exists, create one with the provided ID
        if (!existingDraft) {
          await tx.mutate.draft_messages.insert({
            workspaceId: ctx.workspaceId,
            id: draftMessageId,
            channelId,
            conversationId: conversationId || null,
            userId: ctx.userID,
            content: content || '',
            hasAttachment: true,
            origin: DraftOrigin.user,
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


        for (const [index, attachment] of attachments.entries()) {
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
              createdAt: timestamp + index,
              position: index,
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
    clearContent: defineMutator(
      z.object({
        channelId: z.string(),
        conversationId: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { channelId, conversationId, timestamp } }) => {
        // Called at send-time to detach the draft from the queued message:
        // zeroes content and hasAttachment so `markChannelAsViewed` can
        // garbage-collect the row on channel exit. The DRAFT-typed attachment
        // rows are left in place; the send mutator claims them by id when
        // it fires (immediate or on retry).
        const channelDrafts = await tx.run(
          zql.draft_messages
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
        );
        const draft = conversationId
          ? channelDrafts.find(d => d.conversationId === conversationId)
          : channelDrafts.find(d => d.conversationId === null);
        if (!draft) return;
        await tx.mutate.draft_messages.update({
          id: draft.id,
          content: '',
          hasAttachment: false,
          updatedAt: timestamp,
        });
      },
    ),
  },
  calls: {
    // Persist the notes-canvas id onto the call as soon as the user creates the
    // canvas mid-recording. The link is posted to the thread later by the automatic summary
    // pipeline (transcriptService.postSummaryAsReply), so it survives any stop path.
    linkNotesCanvas: defineMutator(
      z.object({ callId: z.string(), notesCanvasId: z.string().min(1) }),
      async ({ tx, ctx, args: { callId, notesCanvasId } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        // Headless recording calls are fetched over REST and are not synced into the
        // client's Zero cache, so the optimistic (client) pass won't find the row. Skip
        // it and let the authoritative server mutator perform the write against Postgres,
        // where the call always exists. (The server copy throws if the call is missing.)
        if (!call) {
          return;
        }
        if (call.createdByUserId !== ctx.userID) {
          throw new Error('Access denied');
        }
        const currentMetadata =
          call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
            ? (call.metadata as Record<string, unknown>)
            : {};
        await tx.mutate.calls.update({
          id: call.id,
          metadata: { ...currentMetadata, notesCanvasId },
        });
      },
    ),
    // Append a moment the user flagged mid-recording to Call.markedItems. The same
    // column holds the decisions/actions the summary pipeline extracts once the call
    // ends (which preserves these), so entries are told apart by `type`.
    // `timestampSeconds` is measured from the first transcript line, matching how
    // transcriptService.formatTranscript timestamps the transcript itself..
    
    markMoment: defineMutator(
      z.object({
        callId: z.string(),
        type: z.literal('moment'),
        timestampSeconds: z.number().nonnegative(),
        text: z.string(),
      }),
      async ({ tx, ctx, args: { callId, type, timestampSeconds, text } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        // Headless recording calls are fetched via the oats* named queries and may not
        // be synced into the client's optimistic cache. Skip and let the authoritative
        // server mutator perform the write against Postgres, where the call exists.
        if (!call) {
          return;
        }
        if (call.createdByUserId !== ctx.userID) {
          throw new Error('Access denied');
        }

        const markedItems = Array.isArray(call.markedItems) ? call.markedItems : [];
        await tx.mutate.calls.update({
          id: call.id,
          markedItems: [...markedItems, { type, text, timestampSeconds }],
        });
      },
    ),
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
              workspaceId: ctx.workspaceId,
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
    requestToJoin: defineMutator(
      z.object({
        callId: z.string(),
        participantId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { callId, participantId, timestamp } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        if (!call || call.status !== CallStatus.ACTIVE) {
          throw new Error('Call not found or not active');
        }

        const activeRequests = await tx.run(
          zql.call_participants
            .where('userId', ctx.userID)
            .where('response', InvitationResponse.REQUESTED)
            .related('call'),
        );

        for (const request of activeRequests) {
          if (request.callId === call.id || request.call?.status !== CallStatus.ACTIVE) {
            continue;
          }

          const metadata = request.metadata as CallParticipantMetadata | null;
          if (metadata?.removedByHost) {
            await tx.mutate.call_participants.update({
              id: request.id,
              response: InvitationResponse.DECLINED,
              respondedAt: timestamp,
              joinedAt: null,
              leftAt: timestamp,
            });
          } else {
            await tx.mutate.call_participants.delete({ id: request.id });
          }
        }

        // Check if participant already exists
        const existingParticipant = await tx.run(
          zql.call_participants.where('callId', call.id).where('userId', ctx.userID).one(),
        );

        if (existingParticipant) {
          // If already REQUESTED, INVITED, or ACCEPTED, no-op
          if (
            existingParticipant.response === InvitationResponse.REQUESTED ||
            existingParticipant.response === InvitationResponse.INVITED ||
            existingParticipant.response === InvitationResponse.ACCEPTED
          ) {
            return;
          }
          // Otherwise reset to REQUESTED (for DECLINED or LEFT)
          await tx.mutate.call_participants.update({
            id: existingParticipant.id,
            response: InvitationResponse.REQUESTED,
            invitedBy: ctx.userID,
            invitedAt: timestamp,
            respondedAt: null,
            joinedAt: null,
            leftAt: null,
          });
        } else {
          // Create new request
          await tx.mutate.call_participants.insert({
            workspaceId: ctx.workspaceId,
            id: participantId,
            callId: call.id,
            userId: ctx.userID,
            invitedBy: ctx.userID,
            invitedAt: timestamp,
            response: InvitationResponse.REQUESTED,
            meetingStatus: MeetingStatus.PENDING,
            respondedAt: null,
            joinedAt: null,
            leftAt: null,
            isExternal: false,
          });
        }
      },
    ),
    cancelJoinRequest: defineMutator(
      z.object({
        callId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { callId, timestamp } }) => {
        const call = await tx.run(zql.calls.where('externalId', callId).one());
        if (!call) {
          throw new Error('Call not found');
        }

        const participant = await tx.run(
          zql.call_participants.where('callId', call.id).where('userId', ctx.userID).one(),
        );

        if (!participant || participant.response !== InvitationResponse.REQUESTED) {
          return;
        }

        const metadata = participant.metadata as CallParticipantMetadata | null;
        if (metadata?.removedByHost) {
          await tx.mutate.call_participants.update({
            id: participant.id,
            response: InvitationResponse.DECLINED,
            respondedAt: timestamp,
            joinedAt: null,
            leftAt: timestamp,
          });
          return;
        }

        await tx.mutate.call_participants.delete({ id: participant.id });
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
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
            .one(),
        );

        if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
          await tx.mutate.draft_messages.delete({ id: draft.id });
        } else if (draftMessage.trim() !== '') {
          await tx.mutate.draft_messages.upsert({
            workspaceId: ctx.workspaceId,
            id: draft?.id || draftMessageId,
            conversationId,
            channelId,
            userId: ctx.userID,
            content: draftMessage,
            hasAttachment: draft?.hasAttachment || false,
            origin: DraftOrigin.user,
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
            const conversation = await tx.run(
              zql.conversations.where('conversationId', conversationId).one()
            );
            
            let trueLastReplyAt: number | undefined = undefined;
            if (conversation && conversation.replyCount > 0) {
              const latestReply = await tx.run(
                zql.messages
                  .where('conversationId', conversationId)
                  .where('messageId', '!=', conversation.initialMessageId)
                  .orderBy('createdAt', 'desc')
                  .limit(1)
              );
              if (latestReply[0]) {
                trueLastReplyAt = latestReply[0].createdAt;
              }
            }

            await tx.mutate.conversation_participants.insert({
              workspaceId: ctx.workspaceId,
              id: participantId,
              conversationId,
              userId: ctx.userID,
              joinedAt: timestamp,
              channelId,
              lastReadAt: timestamp,
              isSubscribed: false,
              participationType: null,
              lastReplyAt: trueLastReplyAt || null,
            });
          } else {
            await tx.mutate.conversation_participants.update({
              id: participant.id,
              ...(participant.channelId !== channelId ? { channelId } : {}),
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
    markAsUnread: defineMutator(
      z.object({ activityId: z.string(), timestamp: z.number() }),
      async ({ tx, ctx, args: { activityId, timestamp } }) => {
        // 1. FETCH & VALIDATE ACTIVITY
        const activity = await tx.run(zql.activities.where('id', activityId).one());

        if (!activity) {
          throw new Error('Activity not found');
        }

        if (activity.userId !== ctx.userID) {
          throw new Error('Not authorized to mark this activity as unread');
        }

        if (['reacted', 'removed'].includes(activity.actorAction)) {
          throw new Error('Cannot mark reactions as unread');
        }

        if (!activity.isRead) {
          return;
        }
        // TYPE A: REPLIES - Update lastReadAt
        if (['replied', 'replied_v2'].includes(activity.actorAction)) {
          if (!activity.messageId) {
            throw new Error('Reply activity missing messageId');
          }

          const message = await resolveMessage(tx, activity.messageId);
          if (!message) {
            throw new Error('Message not found');
          }

          const newLastReadAt = message.createdAt - 1;

          const existingParticipant = await tx.run(
            zql.conversation_participants
              .where('conversationId', message.conversationId)
              .where('userId', ctx.userID)
              .one(),
          );
          if (existingParticipant?.lastReadAt && newLastReadAt < existingParticipant.lastReadAt) {
            await tx.mutate.conversation_participants.update({
              id: existingParticipant.id,
              lastReadAt: newLastReadAt,
            });
          }

          await tx.mutate.activities.update({
            id: activityId,
            isRead: false,
          });

          return;
        }

        // TYPE B: DMs - Update lastViewedAt
        if (activity.actorAction === 'direct_message') {
          if (!activity.messageId) {
            throw new Error('DM activity missing messageId');
          }

          if (!activity.channelId) {
            throw new Error('DM activity missing channelId');
          }

          const message = await resolveMessage(tx, activity.messageId);
          if (!message) {
            throw new Error('Message not found');
          }

          const conversation = await tx.run(
            zql.conversations.where('conversationId', message.conversationId).one(),
          );

          if (!conversation) {
            throw new Error('Conversation not found');
          }

          const newLastViewedAt = conversation.createdAt - 1;

          const unreadConversations = await tx.run(
            zql.conversations
              .where('channelId', activity.channelId)
              .where('createdAt', '>', newLastViewedAt)
              .where('createdBy', '!=', ctx.userID),
          );

          const channelStatus = await tx.run(
            zql.channel_user_status
              .where('channelId', activity.channelId)
              .where('userId', ctx.userID)
              .where('isDeleted', false)
              .one(),
          );

          if (!channelStatus) {
            throw new Error('Channel status not found');
          }

          await tx.mutate.channel_user_status.update({
            id: channelStatus.id,
            lastViewedAt: newLastViewedAt,
            unreadCount: unreadConversations.length,
            conversationSeenCutoffAt: await getConversationSeenCutoffAt(
              tx,
              activity.channelId,
              newLastViewedAt,
            ),
            updatedAt: timestamp,
          });

          await tx.mutate.activities.update({
            id: activityId,
            isRead: false,
          });

          return;
        }

        // TYPE C: SIMPLE (Mentions, Calls, Tickets, Others)

        await tx.mutate.activities.update({
          id: activityId,
          isRead: false,
        });

        if (activity.channelId) {
          // Skip channel unread count for thread reply activities
          let isThreadReply = false
          if (activity.conversationId && activity.messageId) {
            const conversation = await tx.run(
              zql.conversations.where('conversationId', activity.conversationId).one(),
            )
            isThreadReply = !!(
              conversation?.initialMessageId &&
              conversation.initialMessageId !== activity.messageId
            )
          }

          if (!isThreadReply) {
            const channelStatus = await tx.run(
              zql.channel_user_status
                .where('channelId', activity.channelId)
                .where('userId', ctx.userID)
                .where('isDeleted', false)
                .one(),
            );

            if (channelStatus) {
              await tx.mutate.channel_user_status.update({
                id: channelStatus.id,
                unreadCount: (channelStatus.unreadCount || 0) + 1,
                updatedAt: timestamp,
              });
            }
          }
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
      async ({ tx, ctx, args: { conversationId, messageId, participantId, timestamp } }) => {
        // Fetch the conversation
        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );
        if (!conversation) return;

        // Resolve the target message
        let message = await resolveMessage(tx, messageId);
        if (!message) return;

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

        let trueLastReplyAt: number | undefined = undefined;
        if (conversation.replyCount > 0) {
          const latestReply = await tx.run(
            zql.messages
              .where('conversationId', conversationId)
              .where('messageId', '!=', conversation.initialMessageId)
              .orderBy('createdAt', 'desc')
              .limit(1),
          );
          if (latestReply[0]) {
            trueLastReplyAt = latestReply[0].createdAt;
          }
        }

        // Upsert conversation_participants state so marking unread also subscribes the user.
        const existingParticipant = await tx.run(
          zql.conversation_participants
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (!existingParticipant) {
          await tx.mutate.conversation_participants.insert({
            workspaceId: ctx.workspaceId,
            id: participantId,
            conversationId,
            userId: ctx.userID,
            joinedAt: timestamp,
            channelId: conversation.channelId,
            lastReadAt: newLastReadAt,
            lastReplyAt: trueLastReplyAt || null,
            isSubscribed: true,
            participationType: null,
          });
        } else {
          await tx.mutate.conversation_participants.update({
            id: existingParticipant.id,
            lastReadAt: newLastReadAt,
            isSubscribed: true,
            ...(existingParticipant.channelId !== conversation.channelId
              ? { channelId: conversation.channelId }
              : {}),
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
                .where('userId', ctx.userID)
                .where('messageId', 'IN', messageIds),
            )
          : [];

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
        ticketType: z.string().optional(),
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
          ticketType,
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
          ticketType?: string;
          userGroupId?: string;
          eta?: number;
          boardId?: string;
          metadata?: ReadonlyJSONValue;
          isArchived?: boolean;
          kanbanPosition?: string | null;
        }

        const currentTicket = await tx.run(zql.tickets.where('id', id).one());
        if (!currentTicket) throw new Error('Ticket not found');
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
        if (ticketType !== undefined) {
          updateData.ticketType = ticketType;
        }
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
    archiveDeskTicket: defineMutator(
      z.object({
        id: z.string(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args: { id, updatedAt } }) => {
        const ticket = await tx.run(zql.tickets.where('id', id).one());
        if (!ticket) {
          throw new Error('Ticket not found');
        }

        if (ticket.isArchived) {
          throw new Error('Ticket is already archived');
        }

        if (!ticket.channelId) {
          throw new Error('Ticket has no associated channel');
        }

        const channel = await tx.run(zql.channels.where('id', ticket.channelId).one());
        if (!channel || !isDeskChannelType(channel.type)) {
          throw new Error('Only Desk tickets can be archived from Desk');
        }

        await tx.mutate.tickets.update({
          id,
          isArchived: true,
          updatedAt,
          updatedBy: ctx.userID,
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
        const parentTicket = await tx.run(zql.tickets.where('id', ticketId).one());
        const parentBoard = parentTicket
          ? await tx.run(zql.boards.where('id', parentTicket.boardId).one())
          : null;
        if (parentBoard?.boardType !== BoardType.FLOW) {
          const parentAsSubTicket = await tx.run(
            zql.sub_tickets.where('mappedTicketId', ticketId).one(),
          );
          if (parentAsSubTicket) {
            throw new Error('Cannot create a sub-ticket under a sub-ticket');
          }
        }
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
          workspaceId: ctx.workspaceId,
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

        if (mappedTicketId !== undefined) {
          const mappings = (await tx.run(
            zql.ticket_sub_ticket_mappings.where('subTicketId', subTicketId),
          )) as Array<{ ticketId: string }>;
          for (const mapping of mappings) {
            await updateSubTicketsMdFromZero(tx, zql, mapping.ticketId);
          }
          if (mappedTicketId && mappings[0]) {
            await linkSubTicketConversationToParentFromZero(
              tx,
              zql,
              mappedTicketId,
              mappings[0].ticketId,
            );
          }
        }
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
    // Client-side context validation only. The caller supplies stable IDs so it
    // can continue directly into board editing after the server save succeeds.
    saveReleaseBoardConfig: defineMutator(
      z.object({
        projectId: z.string(),
        mainBoardId: z.string(),
        mainBoardName: z.string(),
        vcsProvider: z.nativeEnum(VCSProviderType),
        releaseTrackingMode: z.nativeEnum(ReleaseTrackingMode),
        channelId: z.string(),
        applications: z.array(
          z.object({
            id: z.string(),
            boardId: z.string(),
            boardName: z.string(),
            name: z.string(),
            regex: z.string(),
            repoUrl: z.string(),
            ownerTeam: z.string(),
            envPaths: z.array(z.string()),
            migrationPaths: z.array(z.string()),
          }),
        ),
      }),
      async ({ tx, args: { projectId } }) => {
        // Validate only against tables that are guaranteed-synced into the
        // client's Zero replica. `projects` is; `channels` is NOT — the
        // dashboard loads channels through a managed/fallback-hydrated query
        // (queries.userAllChannels via InitialStateLoader) into app state for
        // performance, so they are not reliably present in the replica that
        // this optimistic mutator reads. A `zql.channels` lookup here would
        // return undefined for a perfectly valid channel and make the
        // optimistic mutator throw "Channel not found", blocking the save
        // before the server ever runs. Channel existence and project ownership
        // are validated authoritatively in the backend mutator instead.
        const project = await tx.run(zql.projects.where('id', projectId).one());
        if (!project) {
          throw new Error('Project not found');
        }
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
        reassignOnUnavailable: z.boolean().optional(),
        maxWorkload: z.number().int().positive().nullable().optional(),
        userResponsibilityUpdates: z
          .record(z.string(), z.nativeEnum(UserResponsibility))
          .optional(),
        userRoleUpdates: z.record(z.string(), z.string()).optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          userGroupId,
          name,
          alias,
          description,
          reassignOnUnavailable,
          maxWorkload,
          userResponsibilityUpdates,
          userRoleUpdates,
          timestamp,
        },
      }) => {
        await tx.mutate.user_groups.update({
          id: userGroupId,
          ...(name !== undefined && { name }),
          ...(alias !== undefined && { alias }),
          ...(description !== undefined && { description }),
          ...(reassignOnUnavailable !== undefined && { reassignOnUnavailable }),
          ...(maxWorkload !== undefined && { maxWorkload }),
          updatedAt: timestamp,
        });

        if (userRoleUpdates) {
          const roleIdsToUpdate = [...new Set(Object.values(userRoleUpdates))];
          const roles = await tx.run(
            zql.roles.where('id', 'IN', roleIdsToUpdate).where('workspaceId', ctx.workspaceId),
          );
          for (const [userId, roleId] of Object.entries(userRoleUpdates)) {
            const mapping = await tx.run(
              zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one(),
            );
            if (mapping) {
              const role = roles.find(r => r.id === roleId);
              const responsibility = role ? DEFAULT_ROLE_NAME_TO_ENUM[role.name] : undefined;
              await tx.mutate.user_group_mappings.update({
                id: mapping.id,
                roleId,
                ...(responsibility ? { responsibility } : {}),
                updatedAt: timestamp,
              });
            }
          }
        }

        if (userResponsibilityUpdates) {
          const roleNames = [...new Set(Object.values(userResponsibilityUpdates).map(r => r as string))];
          const roles = await tx.run(
            zql.roles.where('name', 'IN', roleNames).where('workspaceId', ctx.workspaceId),
          );
          for (const [userId, responsibility] of Object.entries(userResponsibilityUpdates)) {
            const mapping = await tx.run(
              zql.user_group_mappings
                .where('userGroupId', userGroupId)
                .where('userId', userId)
                .one(),
            );
            if (mapping) {
              const role = roles.find(r => r.name === (responsibility as string));
              await tx.mutate.user_group_mappings.update({
                id: mapping.id,
                responsibility,
                ...(role ? { roleId: role.id } : {}),
                updatedAt: timestamp,
              });
            }
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
        roleIds: z.array(z.string()).optional(), // Parallel to userIds: roleIds[i] is the role for userIds[i]
      }),
      async ({ tx, ctx, args: { userGroupId, userIds, timestamp, mappingIds = {}, roleIds } }) => {
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

        const userIdsToAdd = userIds.filter(userId => !existingUserIds.has(userId));

        const distinctRoleIds = roleIds
          ? [...new Set(roleIds.filter((r): r is string => Boolean(r)))]
          : [];
        const roles = distinctRoleIds.length
          ? await tx.run(zql.roles.where('id', 'IN', distinctRoleIds).where('workspaceId', ctx.workspaceId))
          : [];

        for (const userId of userIdsToAdd) {
          const mappingId = mappingIds[userId];
          if (!mappingId) {
            throw new Error(`mappingId is required for user ${userId}`);
          }
          const index = userIds.indexOf(userId);
          const roleId = roleIds?.[index];
          const role = roleId ? roles.find(r => r.id === roleId) : undefined;
          const responsibility = role ? DEFAULT_ROLE_NAME_TO_ENUM[role.name] : undefined;
          await tx.mutate.user_group_mappings.insert({
            workspaceId: ctx.workspaceId,
            id: mappingId,
            userGroupId,
            userId,
            ...(roleId
              ? { roleId, ...(responsibility ? { responsibility } : {}) }
              : { responsibility: UserResponsibility.MEMBER }),
            onCallSetNumbers: [],
            isNotified: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    removeUsers: defineMutator(
      z.object({
        userGroupId: z.string(),
        userIds: z.array(z.string()),
        // Server-only: the server queues the ticket handoff after the delete commits.
        reassignTickets: z.boolean().optional(),
      }),
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
    updateFlowPlan: defineMutator(
      z.object({
        boardId: z.string(),
        plan: FlowPlanSchema,
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { boardId, plan, timestamp } }) => {
        const board = await tx.run(zql.boards.where('id', boardId).one());
        if (!board) {
          throw new Error('Board not found');
        }
        if (board.boardType !== BoardType.FLOW) {
          throw new Error('Flow plans can only be set on Flow boards');
        }
        validateFlowPlan(plan);
        await tx.mutate.boards.update({
          id: boardId,
          flowPlan: serializeFlowPlan(plan),
          updatedBy: ctx.userID,
          updatedAt: timestamp,
        });
      },
    ),
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
              approvers: z
                .array(
                  z.object({
                    approverId: z.string(),
                    approverType: z.enum(['USER', 'ROLE']),
                  }),
                )
                .optional(),
              formId: z.string().optional(),
              requestApprovalOnEntry: z.boolean().optional(),
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

        if (board.boardType === BoardType.RELEASE) {
          if (projectId !== undefined && projectId !== board.projectId) {
            throw new Error('Release boards cannot be moved to another project');
          }
          if (boardType !== undefined && boardType !== BoardType.RELEASE) {
            throw new Error('Release boards cannot be converted to a normal board');
          }
        }

        if (boardType !== undefined && boardType !== board.boardType) {
          if (board.boardType === BoardType.FLOW) {
            throw new Error('Flow boards cannot be converted to another board type');
          }
          if (boardType === BoardType.FLOW) {
            throw new Error('Existing boards cannot be converted to a Flow board');
          }
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
              workspaceId: ctx.workspaceId,
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
              requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
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
                  workspaceId: ctx.workspaceId,
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
                workspaceId: ctx.workspaceId,
                id: `${stageId}-form-mapping`,
                contextId: stageId,
                contextType: FormContextType.STAGE,
                entityType: FormEntityType.TICKET,
                formId: stage.formId,
              });
            }

            const normalizedApprovers = (stage.approvers ?? []).map(entry => ({
              approverId: entry.approverId,
              approverType: entry.approverType === ApproverType.ROLE ? ApproverType.ROLE : ApproverType.USER,
            }));
            if (stage.approverIds && stage.approverIds.length > 0) {
              for (const approverId of stage.approverIds) {
                normalizedApprovers.push({
                  approverId,
                  approverType: ApproverType.USER,
                });
              }
            }
            if (stage.approvers !== undefined || stage.approverIds !== undefined) {
              const existingApprovers = await tx.run(zql.stage_approvers.where('stageId', stageId));
              for (const existing of existingApprovers) {
                await tx.mutate.stage_approvers.delete({
                  id: existing.id,
                });
              }

              for (const entry of normalizedApprovers) {
                await tx.mutate.stage_approvers.insert({
                  workspaceId: ctx.workspaceId,
                  id: `${stageId}-${entry.approverType}-${entry.approverId}`,
                  ...(entry.approverType === ApproverType.ROLE
                    ? { roleId: entry.approverId }
                    : { userId: entry.approverId }),
                  approverType: entry.approverType,
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

      const [ownedApplication, applicationBoardOwner] = await Promise.all([
        tx.run(zql.applications.where('mainReleaseBoardId', boardId).one()),
        tx.run(zql.applications.where('boardId', boardId).one()),
      ]);
      if (ownedApplication || applicationBoardOwner) {
        throw new Error(
          'Cannot delete a release board while application ownership references it',
        );
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

      const transitions = await tx.run(zql.stage_transitions.where('boardId', boardId));
      for (const transition of transitions) {
        const transitionApprovers = await tx.run(
          zql.stage_approvers.where('transitionId', transition.id),
        );
        for (const approver of transitionApprovers) {
          await tx.mutate.stage_approvers.delete({
            id: approver.id,
          });
        }
        await tx.mutate.stage_transitions.delete({
          id: transition.id,
        });
      }

      const boardFormMappings = await tx.run(
        zql.forms_context_mapping
          .where('contextId', boardId)
          .where('contextType', FormContextType.BOARD),
      );
      for (const mapping of boardFormMappings) {
        await tx.mutate.forms_context_mapping.delete({
          id: mapping.id,
        });
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

        const formMappings = await tx.run(
          zql.forms_context_mapping
            .where('contextId', stage.id)
            .where('contextType', FormContextType.STAGE),
        );
        for (const mapping of formMappings) {
          await tx.mutate.forms_context_mapping.delete({
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
      async ({ tx, ctx, args: { ticketId, tagName, tagId } }) => {
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
          workspaceId: ctx.workspaceId,
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
  ticketTagV2: {
    create: defineMutator(
      z.object({
        ticketId: z.string(),
        tagName: z.string(),
        tagId: z.string(),
        projectTagId: z.string(),
        mappingId: z.string(),
        projectId: z.string(),
      }),
      async ({ tx, ctx, args: { ticketId, tagName, tagId, projectTagId, mappingId, projectId } }) => {
        if (!tagName || !tagName.trim()) {
          throw new Error('Tag name cannot be empty');
        }
        const trimmedTagName = tagName.trim();

        const existingTag = await tx.run(
          zql.ticket_tags.where('ticketId', ticketId).where('name', trimmedTagName).one(),
        );
        const existingMapping = await tx.run(
          zql.ticket_tag_mappings.where('ticketId', ticketId).where('tagName', trimmedTagName).one(),
        );

        if (existingTag && existingMapping) return;

        if (!existingTag) {
          await tx.mutate.ticket_tags.insert({
            workspaceId: ctx.workspaceId,
            id: tagId,
            name: trimmedTagName,
            ticketId,
          });
        }

        if (!existingMapping) {
          const existingProjectTag = await tx.run(
            zql.project_tags.where('projectId', projectId).where('name', trimmedTagName).one(),
          );
          const resolvedProjectTagId = existingProjectTag?.id || projectTagId;
          if (!existingProjectTag) {
            await tx.mutate.project_tags.insert({
              workspaceId: ctx.workspaceId,
              id: resolvedProjectTagId,
              name: trimmedTagName,
              projectId,
              createdAt: Date.now(),
            });
          }
          await tx.mutate.ticket_tag_mappings.insert({
            workspaceId: ctx.workspaceId,
            id: mappingId,
            ticketId,
            tagId: resolvedProjectTagId,
            tagName: trimmedTagName,
            createdAt: Date.now(),
          });
        }
      },
    ),
    delete: defineMutator(
      z.object({
        tagId: z.string(),
        mappingId: z.string(),
      }),
      async ({ tx, args: { tagId, mappingId } }) => {
        const mapping = await tx.run(zql.ticket_tag_mappings.where('id', mappingId).one());
        if (mapping) {
          const legacyTag = await tx.run(
            zql.ticket_tags
              .where('ticketId', mapping.ticketId)
              .where('name', mapping.tagName)
              .one(),
          );
          if (legacyTag) {
            await tx.mutate.ticket_tags.delete({ id: legacyTag.id });
          }
          await tx.mutate.ticket_tag_mappings.delete({ id: mappingId });
          return;
        }

        const legacyOnlyTag = await tx.run(zql.ticket_tags.where('id', tagId).one());
        if (legacyOnlyTag) {
          await tx.mutate.ticket_tags.delete({ id: tagId });
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
        comment: z.string().optional(),
        commentMessageId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
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
          comment,
          commentMessageId,
        },
      }) => {
        let existingApproval = await tx.run(zql.ticket_stage_requests.where('id', id).one());

        // Revisit safety: if no record found by the client-provided ID, fall back to any
        // existing record for (ticketId, stageId). The unique constraint on that pair means
        // a new-UUID INSERT would fail; reusing the existing ID converts it to an UPDATE.
        let effectiveId = id;
        if (!existingApproval) {
          const existingForTicketStage = await tx.run(
            zql.ticket_stage_requests
              .where('ticketId', ticketId)
              .where('stageId', stageId)
              .one(),
          );
          if (existingForTicketStage) {
            existingApproval = existingForTicketStage;
            effectiveId = existingForTicketStage.id;
          }
        }

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
          id: effectiveId,
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
          ...(commentMessageId !== undefined && { reviewerCommentMessageId: commentMessageId }),
        };

        // Upsert ticket stage request
        await tx.mutate.ticket_stage_requests.upsert({ ...payload, workspaceId: ctx.workspaceId });

        // Handle activities based on whether this is create or update
        const isNewRequest = !existingApproval; // true only when no prior record existed (checked after fallback lookup)
        if (isNewRequest && requestActivityId) {
          // Create message for a fresh approval request
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'submitted the form for' : 'requested approval for';

          await tx.mutate.messages.insert({
            workspaceId: ctx.workspaceId,
            messageId: requestActivityId,
            conversationId: ticket.conversationId,
            ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
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
          existingApproval?.status === TicketStageRequestStatus.DRAFT &&
          requestActivityId
        ) {
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'submitted the form for' : 'requested approval for';

          await tx.mutate.messages.insert({
            workspaceId: ctx.workspaceId,
            messageId: requestActivityId,
            conversationId: ticket.conversationId,
            ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
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
            },
          });
        } else if (
          status === TicketStageRequestStatus.SUBMITTED &&
          existingApproval?.status === TicketStageRequestStatus.APPROVED &&
          requestActivityId
        ) {
          // Revisit: transitioning from APPROVED → SUBMITTED (new visit to an already-visited stage)
          const actorName = actor?.name || 'Someone';
          const hasForm = !!formId;
          const actionText = hasForm ? 'submitted the form for' : 'requested approval for';

          await tx.mutate.messages.insert({
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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

        // Reviewer's comment, attached to APPROVE/REJECT decisions. Stored as a
        // regular USER message in the ticket conversation (so it renders inline
        // with the rest of the ticket timeline) and linked from the request row
        // via reviewerCommentMessageId for direct lookup from the form modal.
        // The content is prefixed with "Rejection comment:" / "Approval comment:"
        // so it reads sensibly in the ticket thread (the action + actor are
        // already carried by the sibling SYSTEM message just above). The raw
        // comment text is kept in metadata.rawComment for places that want to
        // display it without the prefix (e.g. the modal's "Reason for rejection"
        // block).
        if (
          comment &&
          commentMessageId &&
          (status === TicketStageRequestStatus.APPROVED ||
            status === TicketStageRequestStatus.REJECTED)
        ) {
          const commentLabel =
            status === TicketStageRequestStatus.REJECTED
              ? 'Rejection comment'
              : 'Approval comment';
          await tx.mutate.messages.insert({
            messageId: commentMessageId,
            conversationId: ticket.conversationId,
            workspaceId: ctx.workspaceId,
            senderId: updatedBy,
            content: `${commentLabel}: ${comment}`,
            msgType: MessageType.USER,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: updatedAt,
            metadata: {
              isTicketActivity: true,
              ticketStageRequestId: effectiveId,
              decision: status,
              rawComment: comment,
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
          workspaceId: ctx.workspaceId,
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
        folderId: z.string().optional(),
        projectId: z.string().optional(),
        visibility: z.nativeEnum(CanvasVisibility).optional(),
        content: z.any().optional(),
        timestamp: z.number(),
        participantId: z.string(),
        // Legacy fields (pre-XYNE-17290). Accepted so old clients don't get
        // Zod validation errors during a rolling deploy; intentionally
        // ignored — the canonical `id` is the only identity we write.
        viewAccessId: z.string().optional(),
        editAccessId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          title,
          channelId,
          folderId,
          projectId,
          visibility,
          content,
          timestamp,
          participantId,
        },
      }) => {
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
          workspaceId: ctx.workspaceId,
          id,
          title,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          content: content || [],
          channelId: resolvedChannelId,
          folderId,
          projectId: resolvedProjectId,
          createdBy: ctx.userID,
          visibility: visibility || CanvasVisibility.PRIVATE,
          isTemplate: false,
          isArchived: false,
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
          workspaceId: ctx.workspaceId,
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
        folderId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        channelId: z.string().nullable().optional(),
        timestamp: z.number(),
        // Legacy fields (pre-XYNE-17290). Accepted so old clients don't get
        // Zod validation errors during a rolling deploy; intentionally
        // ignored. Note: editAccessId no longer grants edit privileges —
        // authorization flows through the participant checks below.
        viewAccessId: z.string().optional(),
        editAccessId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: { id, title, content, visibility, isCollaborative, folderId, projectId, channelId, timestamp },
      }) => {
        const canvas = await tx.run(zql.canvases.where('id', id).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        const currentFolder = canvas.folderId
          ? await tx.run(zql.canvas_folders.where('id', canvas.folderId).one())
          : null;
        const currentChannelId = canvas.channelId ?? currentFolder?.channelId ?? null;
        const isChannelAdmin = currentChannelId
          ? Boolean(
            await tx.run(
              zql.channel_participants
                .where('channelId', currentChannelId)
                .where('userId', ctx.userID)
                .where('role', ChannelRole.ADMIN)
                .one(),
            ),
          )
          : false;
        const canEdit = await hasCanvasVersionEditAccess(tx, canvas, ctx.userID, {
          role: ctx.role,
          workspaceId: ctx.workspaceId,
        });
        const isMoveOperation =
          folderId !== undefined || projectId !== undefined || channelId !== undefined;
        const sdlcArtifact = await tx.run(zql.sdlc_artifacts.where('artifactId', id).one());
        const isSdlcBaseline = isBaselineCanvasType(sdlcArtifact?.artifactType);

        if (!canEdit && !(isChannelAdmin && (isMoveOperation || isSdlcBaseline))) {
          throw new Error('You do not have permission to edit this canvas');
        }
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
                    .where('userId', ctx.userID)
                    .one(),
                ),
              ),
            isProjectMember: async projectId =>
              Boolean(
                await tx.run(
                  zql.channels
                    .where('projectId', projectId)
                    .whereExists('participants', p => p.where('userId', ctx.userID))
                    .one(),
                ),
              ),
          });
        }

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
          ...(folderId !== undefined && { folderId }),
          ...(resolvedProjectId !== undefined && { projectId: resolvedProjectId }),
          ...(resolvedChannelId !== undefined && { channelId: resolvedChannelId }),
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

      const discussionLinks = await tx.run(
        zql.sdlc_entity_links
          .where('sourceType', 'CANVAS')
          .where('sourceId', id)
          .where('relationType', 'DISCUSSION'),
      );
      await Promise.all(
        discussionLinks.map(link => tx.mutate.sdlc_entity_links.delete({ id: link.id })),
      );

      await tx.mutate.canvases.delete({ id });
    }),
    archiveCanvas: defineMutator(
      z.object({
        canvasId: z.string(),
      }),
      async ({ tx, ctx, args: { canvasId } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        if (canvas.createdBy !== ctx.userID) {
          throw new Error('Only the creator can archive the canvas');
        }

        await tx.mutate.canvases.update({
          id: canvasId,
          isArchived: true,
        });
      },
    ),
    unarchiveCanvas: defineMutator(
      z.object({
        canvasId: z.string(),
      }),
      async ({ tx, ctx, args: { canvasId } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        if (canvas.createdBy !== ctx.userID) {
          throw new Error('Only the creator can unarchive the canvas');
        }

        await tx.mutate.canvases.update({
          id: canvasId,
          isArchived: false,
        });
      },
    ),
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
            workspaceId: ctx.workspaceId,
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
    addGroupParticipant: defineMutator(
      z.object({
        canvasId: z.string(),
        userGroupId: z.string(),
        role: z.nativeEnum(CanvasRole),
        participantId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { canvasId, userGroupId, role, participantId, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can add participants');
        if (isEditor && role === CanvasRole.OWNER) throw new Error('Editors cannot grant owner role');
        const existing = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userGroupId', userGroupId)
            .one(),
        );
        if (existing) return;
        await tx.mutate.canvas_participants.insert({
          workspaceId: ctx.workspaceId,
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
    addChannelParticipant: defineMutator(
      z.object({
        canvasId: z.string(),
        channelId: z.string(),
        role: z.nativeEnum(CanvasRole),
        participantId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { canvasId, channelId, role, participantId, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can add participants');
        if (isEditor && role === CanvasRole.OWNER) throw new Error('Editors cannot grant owner role');

        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) throw new Error("Channel doesn't exist");

        const actorInChannel = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!actorInChannel) {
          throw new Error('You must be a member of this channel to add it as a canvas participant');
        }

        const existing = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('channelId', channelId)
            .one(),
        );
        if (existing) return;

        await tx.mutate.canvas_participants.insert({
          workspaceId: ctx.workspaceId,
          id: participantId,
          canvasId,
          userId: null,
          userGroupId: null,
          channelId,
          role,
          joinedAt: timestamp,
          updatedAt: timestamp,
        });
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
    removeGroupParticipant: defineMutator(
      z.object({ canvasId: z.string(), userGroupId: z.string() }),
      async ({ tx, ctx, args: { canvasId, userGroupId } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can remove participants');
        const target = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userGroupId', userGroupId)
            .one(),
        );
        if (!target) throw new Error('Group is not a participant');
        if (isEditor && target.role === CanvasRole.OWNER) throw new Error('Editors cannot remove owners');
        await tx.mutate.canvas_participants.delete({ id: target.id });
      },
    ),
    removeChannelParticipant: defineMutator(
      z.object({ canvasId: z.string(), channelId: z.string() }),
      async ({ tx, ctx, args: { canvasId, channelId } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can remove participants');

        const actorInChannel = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!actorInChannel) {
          throw new Error('You must be a member of this channel to remove it as a canvas participant');
        }

        const target = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('channelId', channelId)
            .one(),
        );
        if (!target) throw new Error('Channel is not a participant');
        if (isEditor && target.role === CanvasRole.OWNER) throw new Error('Editors cannot remove owners');
        await tx.mutate.canvas_participants.delete({ id: target.id });
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
    updateGroupParticipantRole: defineMutator(
      z.object({
        canvasId: z.string(),
        userGroupId: z.string(),
        role: z.nativeEnum(CanvasRole),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { canvasId, userGroupId, role, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can update participant roles');
        if (isEditor && role === CanvasRole.OWNER) throw new Error('Editors cannot grant owner role');
        const target = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('userGroupId', userGroupId)
            .one(),
        );
        if (!target) throw new Error('Group is not a participant');
        if (isEditor && target.role === CanvasRole.OWNER) throw new Error('Editors cannot change owner roles');
        await tx.mutate.canvas_participants.update({ id: target.id, role, updatedAt: timestamp });
      },
    ),
    updateChannelParticipantRole: defineMutator(
      z.object({
        canvasId: z.string(),
        channelId: z.string(),
        role: z.nativeEnum(CanvasRole),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { canvasId, channelId, role, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) throw new Error("Canvas doesn't exist");
        const requester = await tx.run(
          zql.canvas_participants.where('canvasId', canvasId).where('userId', ctx.userID).one(),
        );
        const isOwner =
          canvas.createdBy === ctx.userID || (requester && requester.role === CanvasRole.OWNER);
        const isEditor = requester && requester.role === CanvasRole.EDITOR;
        if (!isOwner && !isEditor) throw new Error('Only canvas owners or editors can update participant roles');
        if (isEditor && role === CanvasRole.OWNER) throw new Error('Editors cannot grant owner role');

        const actorInChannel = await tx.run(
          zql.channel_participants.where('channelId', channelId).where('userId', ctx.userID).one(),
        );
        if (!actorInChannel) {
          throw new Error('You must be a member of this channel to change its role on this canvas');
        }

        const target = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where('channelId', channelId)
            .one(),
        );
        if (!target) throw new Error('Channel is not a participant');
        if (isEditor && target.role === CanvasRole.OWNER) throw new Error('Editors cannot change owner roles');
        await tx.mutate.canvas_participants.update({ id: target.id, role, updatedAt: timestamp });
      },
    ),
  },
  canvasUserStatus: {
    toggleStarred: defineMutator(
      z.object({
        id: z.string(),
        canvasId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, canvasId, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        const participant = await tx.run(
          zql.canvas_participants
            .where('canvasId', canvasId)
            .where(({ or, cmp, exists: ex }: any) =>
              or(
                cmp('userId', ctx.userID),
                ex('userGroup', (ug: any) =>
                  ug.whereExists('userGroupMappings', (m: any) => m.where('userId', ctx.userID)),
                ),
                ex('channel', (ch: any) =>
                  ch.whereExists('participants', (cp: any) => cp.where('userId', ctx.userID)),
                ),
              ),
            )
            .one(),
        );
        const hasAccess =
          canvas.createdBy === ctx.userID ||
          !!participant ||
          canvas.visibility === CanvasVisibility.PUBLIC;

        if (!hasAccess) {
          throw new Error('You do not have access to this canvas');
        }

        const existingStatus = await tx.run(
          zql.canvas_user_status
            .where('canvasId', canvasId)
            .where('userId', ctx.userID)
            .one(),
        );

        if (existingStatus) {
          await tx.mutate.canvas_user_status.update({
            id: existingStatus.id,
            isStarred: !existingStatus.isStarred,
            updatedAt: timestamp,
          });
          return;
        }

        await tx.mutate.canvas_user_status.insert({
          workspaceId: ctx.workspaceId,
          id,
          canvasId,
          userId: ctx.userID,
          isStarred: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
  },
  canvasComment: {
    createThread: defineMutator(
      z.object({
        threadId: z.string(),
        commentId: z.string(),
        canvasId: z.string(),
        blockId: z.string().min(1),
        anchorText: z.string().optional(),
        body: z.string().min(1),
        mentionedUserIds: z.array(z.string()).default([]),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { threadId, commentId, canvasId, blockId, anchorText, body, mentionedUserIds, timestamp } }) => {
        await assertCanvasCommentEditAccess(tx, canvasId, ctx.userID);

        await tx.mutate.canvas_comment_threads.insert({
          id: threadId,
          canvasId,
          blockId,
          anchorText: anchorText || null,
          initialCommentId: commentId,
          commentCount: 1,
          status: CanvasCommentThreadStatus.OPEN,
          statusUpdatedBy: null,
          statusUpdatedAt: null,
          createdBy: ctx.userID,
          createdAt: timestamp,
        });

        await tx.mutate.canvas_comments.insert({
          id: commentId,
          threadId,
          canvasId,
          body,
          mentionedUserIds: serializeCanvasCommentMentionedUserIds(mentionedUserIds),
          isInitial: true,
          createdBy: ctx.userID,
          editedAt: null,
          deletedAt: null,
          createdAt: timestamp,
        });
      },
    ),
    reply: defineMutator(
      z.object({
        commentId: z.string(),
        threadId: z.string(),
        canvasId: z.string(),
        body: z.string().min(1),
        mentionedUserIds: z.array(z.string()).default([]),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { commentId, threadId, canvasId, body, mentionedUserIds, timestamp } }) => {
        const thread = await tx.run(zql.canvas_comment_threads.where('id', threadId).one());
        if (!thread || thread.canvasId !== canvasId) {
          throw new Error('Comment thread not found');
        }

        await assertCanvasCommentEditAccess(tx, canvasId, ctx.userID);

        await tx.mutate.canvas_comments.insert({
          id: commentId,
          threadId,
          canvasId,
          body,
          mentionedUserIds: serializeCanvasCommentMentionedUserIds(mentionedUserIds),
          isInitial: false,
          createdBy: ctx.userID,
          editedAt: null,
          deletedAt: null,
          createdAt: timestamp,
        });

        const commentCount = await getCanvasThreadCommentCount(tx, threadId);

        if (thread.status === CanvasCommentThreadStatus.RESOLVED) {
          await tx.mutate.canvas_comment_threads.update({
            id: threadId,
            commentCount,
            status: CanvasCommentThreadStatus.OPEN,
            statusUpdatedBy: ctx.userID,
            statusUpdatedAt: timestamp,
          });
        } else {
          await tx.mutate.canvas_comment_threads.update({
            id: threadId,
            commentCount,
          });
        }
      },
    ),
    updateComment: defineMutator(
      z.object({
        commentId: z.string(),
        body: z.string().min(1),
        mentionedUserIds: z.array(z.string()).default([]),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { commentId, body, mentionedUserIds, timestamp } }) => {
        const comment = await tx.run(zql.canvas_comments.where('id', commentId).one());
        if (!comment) {
          throw new Error('Comment not found');
        }
        if (comment.createdBy !== ctx.userID) {
          throw new Error('Only the comment author can edit this comment');
        }
        if (comment.deletedAt) {
          throw new Error('Deleted comments cannot be edited');
        }

        await tx.mutate.canvas_comments.update({
          id: commentId,
          body,
          mentionedUserIds: serializeCanvasCommentMentionedUserIds(mentionedUserIds),
          editedAt: timestamp,
        });
      },
    ),
    deleteComment: defineMutator(
      z.object({
        commentId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { commentId, timestamp } }) => {
        const comment = await tx.run(zql.canvas_comments.where('id', commentId).one());
        if (!comment) {
          throw new Error('Comment not found');
        }
        if (comment.createdBy !== ctx.userID) {
          throw new Error('Only the comment author can delete this comment');
        }
        if (comment.deletedAt) {
          return;
        }

        await tx.mutate.canvas_comments.update({
          id: commentId,
          body: '',
          mentionedUserIds: '[]',
          deletedAt: timestamp,
        });

        const thread = await tx.run(zql.canvas_comment_threads.where('id', comment.threadId).one());
        if (thread) {
          const commentCount = await getCanvasThreadCommentCount(tx, comment.threadId);
          await tx.mutate.canvas_comment_threads.update({
            id: comment.threadId,
            commentCount,
          });
        }
      },
    ),
    setThreadStatus: defineMutator(
      z.object({
        threadId: z.string(),
        status: z.nativeEnum(CanvasCommentThreadStatus),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { threadId, status, timestamp } }) => {
        const thread = await tx.run(zql.canvas_comment_threads.where('id', threadId).one());
        if (!thread) {
          throw new Error('Comment thread not found');
        }

        await assertCanvasThreadManageAccess(tx, thread, ctx.userID);

        await tx.mutate.canvas_comment_threads.update({
          id: threadId,
          status,
          statusUpdatedBy: ctx.userID,
          statusUpdatedAt: timestamp,
        });
      },
    ),
  },
  canvasVersion: {
    save: defineMutator(
      z.object({
        id: z.string(),
        canvasId: z.string(),
        name: z.string().min(1).max(120),
        content: z.any(),
        contentHash: z.string().min(1),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, canvasId, name, content, contentHash, timestamp } }) => {
        const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        const canEdit = await hasCanvasVersionEditAccess(tx, canvas, ctx.userID, {
          role: ctx.role,
          workspaceId: ctx.workspaceId,
        });

        if (!canEdit) {
          throw new Error('You do not have permission to edit this canvas');
        }

        const existingVersion = await tx.run(
          zql.canvas_versions.where('canvasId', canvasId).where('contentHash', contentHash).one(),
        );

        if (existingVersion) {
          await tx.mutate.canvas_versions.update({
            id: existingVersion.id,
            updatedAt: timestamp,
          });
          return;
        }

        await tx.mutate.canvas_versions.insert({
          workspaceId: ctx.workspaceId,
          id,
          canvasId,
          name: name.trim(),
          content,
          contentHash,
          createdBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    rename: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
      }),
      async ({ tx, ctx, args: { id, name } }) => {
        const version = await tx.run(zql.canvas_versions.where('id', id).one());
        if (!version) {
          throw new Error('Canvas version not found');
        }

        const canvas = await tx.run(zql.canvases.where('id', version.canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        const canEdit = await hasCanvasVersionEditAccess(tx, canvas, ctx.userID, {
          role: ctx.role,
          workspaceId: ctx.workspaceId,
        });

        if (!canEdit) {
          throw new Error('You do not have permission to edit this canvas');
        }

        await tx.mutate.canvas_versions.update({
          id: version.id,
          name: name.trim(),
        });
      },
    ),
    restore: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const version = await tx.run(zql.canvas_versions.where('id', id).one());
        if (!version) {
          throw new Error('Canvas version not found');
        }

        const canvas = await tx.run(zql.canvases.where('id', version.canvasId).one());
        if (!canvas) {
          throw new Error('Canvas not found');
        }

        const canEdit = await hasCanvasVersionEditAccess(tx, canvas, ctx.userID, {
          role: ctx.role,
          workspaceId: ctx.workspaceId,
        });

        if (!canEdit) {
          throw new Error('You do not have permission to edit this canvas');
        }

        await tx.mutate.canvases.update({
          id: canvas.id,
          lastEditedBy: ctx.userID,
          lastEditedAt: timestamp,
          updatedAt: timestamp,
          ...(!canvas.isCollaborative && { content: version.content }),
        });

        await tx.mutate.canvas_versions.update({
          id: version.id,
          updatedAt: timestamp,
        });
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
      async ({ tx, ctx, args: { id, projectId, channelId, name, timestamp } }) => {
        const cleanName = name.trim();
        if (!cleanName) {
          throw new Error('Folder name is required');
        }

        // Channel folders no longer require a project (the channel canvas UI has
        // no project grouping), but the channel itself must still be valid and
        // not archived. A projectId is optional; when present it must match.
        if (channelId) {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error('Channel not found');
          }

          if (channel.isArchived) {
            throw new Error('Channel is archived');
          }

          if (projectId && channel.projectId !== projectId) {
            throw new Error('Channel does not belong to project');
          }
        }

        if (projectId) {
          const project = await tx.run(zql.projects.where('id', projectId).one());
          if (!project) {
            throw new Error('Project not found');
          }
        }

        const duplicateNameMessage = getCanvasFolderNameConflictMessage(channelId, projectId);
        const existingFolder = await tx.run(
          zql.canvas_folders
            .where('name', cleanName)
            .where(({ and, cmp }) =>
              channelId
                ? projectId
                  ? and(cmp('projectId', '=', projectId), cmp('channelId', '=', channelId))
                  : and(cmp('projectId', 'IS', null), cmp('channelId', '=', channelId))
                : projectId
                  ? and(cmp('projectId', '=', projectId), cmp('channelId', 'IS', null))
                  : and(
                    cmp('projectId', 'IS', null),
                    cmp('channelId', 'IS', null),
                    cmp('createdBy', '=', ctx.userID),
                  ),
            )
            .one(),
        );
        if (existingFolder) {
          throw new Error(duplicateNameMessage);
        }

        try {
          await tx.mutate.canvas_folders.insert({
            workspaceId: ctx.workspaceId,
            id,
            ...(projectId ? { projectId } : {}),
            ...(channelId ? { channelId } : {}),
            name: cleanName,
            createdBy: ctx.userID,
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
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, timestamp } }) => {
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
                .where('userId', ctx.userID)
                .where('role', ChannelRole.ADMIN)
                .one(),
            ),
          )
          : false;

        if (folder.createdBy !== ctx.userID && !isChannelAdmin) {
          throw new Error(
            folder.channelId
              ? 'Only the folder creator or a channel admin can update it'
              : 'Only the folder creator can update it',
          );
        }

        const updates: { name?: string; updatedAt: number } = { updatedAt: timestamp };
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
                  ? folder.projectId
                    ? and(
                      cmp('projectId', '=', folder.projectId),
                      cmp('channelId', '=', folder.channelId),
                    )
                    : and(cmp('projectId', 'IS', null), cmp('channelId', '=', folder.channelId))
                  : folder.projectId
                    ? and(cmp('projectId', '=', folder.projectId), cmp('channelId', 'IS', null))
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
    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
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
              .where('userId', ctx.userID)
              .where('role', ChannelRole.ADMIN)
              .one(),
          ),
        )
        : false;

      if (folder.createdBy !== ctx.userID && !isChannelAdmin) {
        throw new Error(
          folder.channelId
            ? 'Only the folder creator or a channel admin can delete it'
            : 'Only the folder creator can delete it',
        );
      }

      const canvasesInFolder = await tx.run(zql.canvases.where('folderId', id));
      if (canvasesInFolder.length > 0) {
        throw new Error('Cannot delete folder with canvases. Move or delete canvases first.');
      }

      await tx.mutate.canvas_folders.delete({ id });
    }),
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
          workspaceId: ctx.workspaceId,
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
  channelSection: {
    create: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        emoji: z.string().nullable().optional(),
        position: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, emoji, position, timestamp } }) => {
        // Reject a name this user already uses in this workspace (case-insensitive).
        const siblings = await tx.run(
          zql.channel_sections
            .where('userId', ctx.userID)
            .where('workspaceId', ctx.workspaceId)
            .where('isDeleted', false),
        );
        const normalized = name.trim().toLowerCase();
        if (siblings.some(s => s.name.trim().toLowerCase() === normalized)) {
          throw new Error('A section with this name already exists');
        }
        await tx.mutate.channel_sections.insert({
          id,
          userId: ctx.userID,
          workspaceId: ctx.workspaceId,
          name,
          emoji: emoji ?? null,
          position,
          isCollapsed: false,
          isDeleted: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    // One mutator for rename/emoji, collapse state, and reorder (all are field updates).
    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        emoji: z.string().nullable().optional(),
        isCollapsed: z.boolean().optional(),
        position: z.string().optional(),
        sortOrder: z.nativeEnum(ChannelSortOrder).nullable().optional(),
        filterMode: z.nativeEnum(ChannelFilterMode).nullable().optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { id, name, emoji, isCollapsed, position, sortOrder, filterMode, timestamp },
      }) => {
        const section = await tx.run(
          zql.channel_sections.where('id', id).where('userId', ctx.userID).where('isDeleted', false).one(),
        );
        if (!section) {
          throw new Error('Section not found');
        }
        if (name !== undefined) {
          // Reject renaming to a name another of this user's sections already uses.
          const normalized = name.trim().toLowerCase();
          const siblings = await tx.run(
            zql.channel_sections
              .where('userId', ctx.userID)
              .where('workspaceId', section.workspaceId)
              .where('isDeleted', false),
          );
          if (siblings.some(s => s.id !== id && s.name.trim().toLowerCase() === normalized)) {
            throw new Error('A section with this name already exists');
          }
        }
        await tx.mutate.channel_sections.update({
          id,
          ...(name !== undefined && { name }),
          ...(emoji !== undefined && { emoji: emoji ?? null }),
          ...(isCollapsed !== undefined && { isCollapsed }),
          ...(position !== undefined && { position }),
          ...(sortOrder !== undefined && { sortOrder: sortOrder ?? null }),
          ...(filterMode !== undefined && { filterMode: filterMode ?? null }),
          updatedAt: timestamp,
        });
      },
    ),
    remove: defineMutator(
      z.object({ id: z.string(), timestamp: z.number() }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const section = await tx.run(
          zql.channel_sections.where('id', id).where('userId', ctx.userID).where('isDeleted', false).one(),
        );
        if (!section) {
          throw new Error('Section not found');
        }

        // Detach channels assigned to this section so they fall back to the default group.
        const assigned = await tx.run(
          zql.channel_user_status.where('userId', ctx.userID).where('sectionId', id),
        );
        for (const status of assigned) {
          await tx.mutate.channel_user_status.update({
            id: status.id,
            sectionId: null,
            sectionPosition: null,
            updatedAt: timestamp,
          });
        }

        await tx.mutate.channel_sections.update({ id, isDeleted: true, updatedAt: timestamp });
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
                  workspaceId: ctx.workspaceId,
                  id: linkId,
                  sourceType: direction.from,
                  sourceId: nudge.sourceId,
                  targetType: direction.to,
                  targetId: entityId,
                  linkKind: SurfaceLinkKind.RELATES_TO,
                  createdBy: ctx.userID,
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
        role: z.string().nullable().optional(),
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
          role,
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
          role?: string | null;
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
          ...(role !== undefined && { role }),
          ...(pronunciation !== undefined && { pronunciation }),
          ...(team !== undefined && { team }),
          ...(phoneNumber !== undefined && { phoneNumber }),
          ...(dob !== undefined && { dob }),
          ...(manager !== undefined && { manager }),
          updatedAt: timestamp,
          createdAt: existingProfile ? existingProfile.createdAt || timestamp : timestamp,
        };

        await tx.mutate.user_profiles.upsert({ ...profileData, workspaceId: ctx.workspaceId });

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

        await tx.mutate.user_presence.upsert({ ...presenceData, workspaceId: ctx.workspaceId });

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
              isNotified: z.boolean().optional(),
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
        // Server-only: members opted in to a ticket handoff on deactivation. The server
        // queues it after the states commit; the client optimistic run ignores it.
        reassignUserIds: z.array(z.string()).optional(),
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

          await tx.mutate.user_assignment_states.upsert({ ...stateData, workspaceId: ctx.workspaceId });
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
                ...(mapping.isNotified !== undefined && { isNotified: mapping.isNotified }),
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
              workspaceId: ctx.workspaceId,
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

              await tx.mutate.user_expertise_mappings.upsert({ ...mappingData, workspaceId: ctx.workspaceId });
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
          workspaceId: ctx.workspaceId,
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
  sdlc: {
    createLink: defineMutator(
      createSdlcLinkSchema.extend({
        id: z.string(),
        channelId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args }) => {
        // Links belong to the hub. createSdlcLinkSchema already excludes the
        // membership relation, so this cannot forge a CHANNEL -> REPOSITORY edge.
        const participant = await tx.run(
          zql.channel_participants
            .where('channelId', args.channelId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (!participant) {
          throw new Error('Hub membership required');
        }
        const sourceExists =
          args.sourceType === 'CANVAS'
            ? Boolean(
                await tx.run(
                  zql.canvases.where('id', args.sourceId).where('channelId', args.channelId).one(),
                ),
              )
            : args.sourceType === 'TICKET'
              ? Boolean(
                  await tx.run(
                    zql.tickets.where('id', args.sourceId).where('channelId', args.channelId).one(),
                  ),
                )
              : args.sourceType === 'CHANNEL'
                ? args.sourceId === args.channelId
                : false;
        if (!sourceExists) {
          throw new Error('Relationship source does not belong to this SDLC hub');
        }
        await tx.mutate.sdlc_entity_links.insert({
          id: args.id,
          workspaceId: ctx.workspaceId,
          channelId: args.channelId,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          targetType: args.targetType,
          targetId: args.targetId,
          relationType: args.relationType,
          createdBy: ctx.userID,
          createdAt: args.timestamp,
        });
      },
    ),
    deleteLink: defineMutator(
      z.object({ channelId: z.string(), linkId: z.string() }),
      async ({ tx, ctx, args: { channelId, linkId } }) => {
        const participant = await tx.run(
          zql.channel_participants
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (!participant) {
          throw new Error('Hub membership required');
        }
        const link = await tx.run(
          zql.sdlc_entity_links.where('id', linkId).where('channelId', channelId).one(),
        );
        if (!link) {
          throw new Error('SDLC relationship not found');
        }
        // Structural edges are not content: repository membership is detached through
        // the hub API, track membership only with the track. The mutation ACL agrees.
        if ((SDLC_STRUCTURAL_RELATIONS as readonly string[]).includes(link.relationType)) {
          throw new Error('Structural SDLC edges are not deleted through the link API');
        }
        await tx.mutate.sdlc_entity_links.delete({ id: linkId });
      },
    ),

    createTrack: defineMutator(
      z.object({
        id: z.string(),
        linkId: z.string(),
        channelId: z.string(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args }) => {
        // Tracks belong to the hub, never to one repository in it.
        const participant = await tx.run(
          zql.channel_participants
            .where('channelId', args.channelId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (!participant) {
          throw new Error('Hub membership required');
        }
        await tx.mutate.sdlc_tracks.insert({
          id: args.id,
          workspaceId: ctx.workspaceId,
          name: args.name,
          description: args.description,
          status: 'ACTIVE',
          createdBy: ctx.userID,
          createdAt: args.timestamp,
          updatedAt: args.timestamp,
        });
        // The track carries no scope column; this edge is what places it in the hub.
        await tx.mutate.sdlc_entity_links.insert({
          id: args.linkId,
          workspaceId: ctx.workspaceId,
          channelId: args.channelId,
          sourceType: 'CHANNEL',
          sourceId: args.channelId,
          targetType: 'TRACK',
          targetId: args.id,
          relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
          createdBy: ctx.userID,
          createdAt: args.timestamp,
        });
      },
    ),
    updateTrack: defineMutator(
      z.object({
        trackId: z.string(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        status: sdlcTrackStatusSchema.optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args }) => {
        const track = await tx.run(zql.sdlc_tracks.where('id', args.trackId).one());
        if (!track) {
          throw new Error('SDLC track not found');
        }
        const membership = await tx.run(
          zql.sdlc_entity_links
            .where('targetType', 'TRACK')
            .where('targetId', args.trackId)
            .where('relationType', SDLC_TRACK_MEMBERSHIP_RELATION)
            .one(),
        );
        if (!membership?.channelId) {
          throw new Error('SDLC channel not found');
        }
        const channelId = membership.channelId;
        const participant = await tx.run(
          zql.channel_participants
            .where('channelId', channelId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (!participant) {
          throw new Error('Repository membership required');
        }
        await tx.mutate.sdlc_tracks.update({
          id: args.trackId,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.status !== undefined ? { status: args.status } : {}),
          updatedAt: args.timestamp,
        });
      },
    ),
  },
  form: {
    update: defineMutator(
      z.object({
        formId: z.string(),
        projectId: z.string().optional(),
        formDescription: z.string().optional(),
        fields: z
          .array(
            z.object({
              id: z.string().optional(), // Existing resolved definition id (global or legacy) when editing
              membershipId: z.string().optional(), // client id for the form_fields membership row
              fieldName: z.string(),
              fieldType: z.nativeEnum(FormFieldType),
              fieldEnum: z.array(z.string()).optional(),
              fieldOptions: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
              isOptional: z.boolean().optional(),
              parentOptionId: z.string().nullable().optional(),
            }),
          )
          .optional(),
        timestamp: z.number(),
        // Legacy clients pass new form_fields ids by field array index.
        fieldIds: z.record(z.string(), z.string()).optional(),
      }),
      async ({
        tx,
        ctx,
        args: { formId, projectId, formDescription, fields, timestamp, fieldIds = {} },
      }) => {
        // Validate form exists
        const form = await tx.run(zql.forms.where('id', formId).one());
        if (!form) {
          throw new Error('Form not found');
        }

        // Update form description if provided
        if (formDescription !== undefined) {
          await tx.mutate.forms.update({
            id: formId,
            formDescription: formDescription.trim() || undefined,
            updatedAt: timestamp,
          });
        }

        // Handle field operations if provided.
        // New definitions live in global_fields (project-scoped); form_fields holds
        // per-form membership. Legacy (deployed) form_fields rows carry their own
        // definition columns and are edited in place to keep their ids + values stable.
        if (fields) {
          const now = timestamp;
          const workspaceId = form.workspaceId;
          const existingRows = await tx.run(zql.form_fields.where('formId', formId));
          const resolveScopedProjectId = async (): Promise<string | undefined> => {
            const validateProject = async (candidateProjectId: string): Promise<string> => {
              const project = await tx.run(zql.projects.where('id', candidateProjectId).one());
              if (!project || project.workspaceId !== workspaceId) {
                throw new Error('Project not found for form');
              }
              return candidateProjectId;
            };

            if (projectId) {
              return validateProject(projectId);
            }
            const mappings = await tx.run(zql.forms_context_mapping.where('formId', formId));
            for (const mapping of mappings) {
              if (mapping.contextType === FormContextType.BOARD) {
                const board = await tx.run(zql.boards.where('id', mapping.contextId).one());
                if (board?.workspaceId === workspaceId) return board.projectId;
              }
              if (mapping.contextType === FormContextType.STAGE) {
                const stage = await tx.run(zql.stages.where('id', mapping.contextId).one());
                if (!stage) continue;
                const board = await tx.run(zql.boards.where('id', stage.boardId).one());
                if (board?.workspaceId === workspaceId) return board.projectId;
              }
            }

            return undefined;
          };
          const scopedProjectId = await resolveScopedProjectId();
          const existingById = new Map(existingRows.map(row => [row.id, row]));
          const existingByGlobalId = new Map(
            existingRows
              .filter(row => row.globalFieldId)
              .map(row => [row.globalFieldId as string, row]),
          );
          const keptRowIds = new Set<string>();
          // Existing fields retain their number; deletes leave gaps.
          let currentMaxFieldSequence = existingRows.reduce(
            (max, row) => Math.max(max, row.sequenceNumber ?? 0),
            0,
          );
          const allocateFieldSequence = (): number => ++currentMaxFieldSequence;
          const serializeGlobalFieldEnum = (value: string[] | null | undefined): string | null =>
            value && value.length > 0 ? JSON.stringify(value) : null;

          validateUniqueFieldNames(fields);
          validateFieldBranches(fields.map(f => ({ ...f, fieldEnum: f.fieldOptions ?? f.fieldEnum })));

          const ensureLegacyGlobalDefinition = async (
            row: (typeof existingRows)[number],
            projectId: string,
          ): Promise<string | undefined> => {
            if (row.globalFieldId) {
              return row.globalFieldId;
            }
            if (!row.fieldName || !row.fieldType) {
              return undefined;
            }

            const found = await tx.run(
              zql.global_fields
                .where('projectId', projectId)
                .where('fieldName', row.fieldName)
                .where('fieldType', row.fieldType)
                .one(),
            );
            if (found) {
              return found.id;
            }

            await tx.mutate.global_fields.insert({
              workspaceId: ctx.workspaceId,
              id: row.id,
              projectId,
              fieldName: row.fieldName,
              fieldType: row.fieldType,
              ...(row.fieldEnum ? { fieldEnum: JSON.stringify(row.fieldEnum) } : {}),
              ...(row.fieldOptions ? { fieldOptions: row.fieldOptions } : {}),
              createdAt: now,
              updatedAt: now,
            });
            return row.id;
          };

          const ensureGlobalField = async (
            candidateId: string,
            fieldName: string,
            fieldType: FormFieldType,
            fieldEnum: ReadonlyJSONValue | undefined,
            fieldOptions: string | null,
            projectId: string,
          ): Promise<string> => {
            const found = await tx.run(
              zql.global_fields
                .where('projectId', projectId)
                .where('fieldName', fieldName)
                .where('fieldType', fieldType)
                .one(),
            );
            if (found) {
              if (fieldEnum) {
                await tx.mutate.global_fields.update({
                  id: found.id,
                  fieldEnum: serializeGlobalFieldEnum(fieldEnum as string[] | undefined),
                  fieldOptions: fieldOptions ?? null,
                  updatedAt: now,
                });
              }
              return found.id;
            }
            await tx.mutate.global_fields.insert({
              workspaceId: ctx.workspaceId,
              id: candidateId,
              projectId,
              fieldName,
              fieldType,
              ...(fieldEnum ? { fieldEnum: serializeGlobalFieldEnum(fieldEnum as string[] | undefined) } : {}),
              ...(fieldOptions ? { fieldOptions } : {}),
              createdAt: now,
              updatedAt: now,
            });
            return candidateId;
          };

          const ensureLegacyFieldDefinition = async (
            candidateId: string,
            formId: string,
            fieldName: string,
            fieldType: FormFieldType,
            fieldEnum: ReadonlyJSONValue | undefined,
            fieldOptions: string | null,
            isOptional: boolean,
            parentOptionId: string | null,
          ): Promise<string> => {
            const found = await tx.run(
              zql.form_fields
                .where('formId', formId)
                .where('fieldName', fieldName)
                .one(),
            );
            if (found) {
              await tx.mutate.form_fields.update({
                id: found.id,
                globalFieldId: null,
                fieldName,
                fieldType,
                fieldEnum: fieldEnum ?? null,
                fieldOptions: fieldOptions ?? null,
                isOptional,
                parentOptionId,
                updatedAt: now,
              });
              return found.id;
            }
            const sequenceNumber = allocateFieldSequence();
            await tx.mutate.form_fields.insert({
              workspaceId: ctx.workspaceId,
              id: candidateId,
              formId,
              globalFieldId: null,
              fieldName,
              fieldType,
              fieldEnum: fieldEnum ?? null,
              fieldOptions: fieldOptions ?? null,
              isOptional,
              sequenceNumber,
              parentOptionId,
              createdAt: now,
              updatedAt: now,
            });
            return candidateId;
          };

          for (const [index, field] of fields.entries()) {
            const isOptional = field.isOptional ?? false;
            const fieldName = field.fieldName.trim();
            const cleanedOptions = field.fieldOptions
              ?.map(opt => ({ id: opt.id, value: opt.value.trim() }))
              .filter(opt => opt.value !== '');
            const cleanedValues = cleanedOptions
              ? cleanedOptions.map(opt => opt.value)
              : field.fieldEnum?.map(v => v.trim()).filter(v => v !== '');
            const fieldOptions = serializeFieldOptions(cleanedOptions);
            const fieldEnum =
              cleanedValues && cleanedValues.length > 0
                ? (cleanedValues as ReadonlyJSONValue)
                : undefined;
            const legacyFieldId = field.id ?? fieldIds[index];

            // Editing a legacy row in place (keeps its id + saved values stable).
            if (legacyFieldId) {
              if (!field.membershipId) {
                const rowId = await ensureLegacyFieldDefinition(
                  legacyFieldId,
                  formId,
                  fieldName,
                  field.fieldType,
                  fieldEnum,
                  fieldOptions,
                  isOptional,
                  field.parentOptionId ?? null,
                );
                keptRowIds.add(rowId);
                continue;
              }

              const legacyRow = existingById.get(legacyFieldId);
              if (legacyRow && !legacyRow.globalFieldId) {
                await tx.mutate.form_fields.update({
                  id: legacyRow.id,
                  fieldName,
                  fieldType: field.fieldType,
                  fieldEnum: fieldEnum ?? null,
                  fieldOptions: fieldOptions ?? null,
                  isOptional,
                  parentOptionId: field.parentOptionId ?? null,
                  updatedAt: now,
                });
                keptRowIds.add(legacyRow.id);
                continue;
              }
            }

            // Resolve the global definition id.
            let definitionId = field.id ?? fieldIds[index];
            if (definitionId) {
              const existingGlobal = await tx.run(zql.global_fields.where('id', definitionId).one());
              if (existingGlobal) {
                if (scopedProjectId && existingGlobal.projectId !== scopedProjectId) {
                  throw new Error(`Field ${field.id} does not belong to this form`);
                }

                const oldOptionIds = new Set(
                  parseFieldOptions(existingGlobal.fieldOptions ?? existingGlobal.fieldEnum).map(o => o.id),
                );
                const newOptionIds = new Set((cleanedOptions ?? []).map(o => o.id));
                const removedOptionIds = [...oldOptionIds].filter(id => !newOptionIds.has(id));
                if (removedOptionIds.length > 0) {
                  const dependentRows = await tx.run(
                    zql.form_fields.where('parentOptionId', 'IN', removedOptionIds),
                  );
                  if (dependentRows.some(row => row.formId !== formId)) {
                    throw new Error(
                      `An option on "${fieldName}" can't be removed — a nested field on another board depends on it.`,
                    );
                  }
                }
                await tx.mutate.global_fields.update({
                  id: definitionId,
                  fieldName,
                  fieldType: field.fieldType,
                  fieldEnum: serializeGlobalFieldEnum(fieldEnum as string[] | undefined),
                  fieldOptions: fieldOptions ?? null,
                  updatedAt: now,
                });
              } else if(scopedProjectId) {
                definitionId = await ensureGlobalField(definitionId, fieldName, field.fieldType, fieldEnum, fieldOptions, scopedProjectId);
              } else {
                definitionId = await ensureLegacyFieldDefinition(
                  legacyFieldId,
                  formId,
                  fieldName,
                  field.fieldType,
                  fieldEnum,
                  fieldOptions,
                  isOptional,
                  field.parentOptionId ?? null,
                );
                keptRowIds.add(definitionId);
              }
            } else {
              continue;
            }

            // Upsert the per-form membership row.
            const existingMembership = existingByGlobalId.get(definitionId);
            if (existingMembership) {
              await tx.mutate.form_fields.update({
                id: existingMembership.id,
                globalFieldId: definitionId,
                fieldName: null,
                fieldType: null,
                fieldEnum: null,
                fieldOptions: null,
                isOptional,
                parentOptionId: field.parentOptionId ?? null,
                updatedAt: now,
              });
              keptRowIds.add(existingMembership.id);
            } else if (field.membershipId) {
              const sequenceNumber = allocateFieldSequence();
              await tx.mutate.form_fields.insert({
                workspaceId: ctx.workspaceId,
                id: field.membershipId,
                formId,
                globalFieldId: definitionId,
                isOptional,
                sequenceNumber,
                parentOptionId: field.parentOptionId ?? null,
                createdAt: now,
                updatedAt: now,
              });
              keptRowIds.add(field.membershipId);
            }
          }

          // Remove membership rows that are no longer present.
          for (const row of existingRows) {
            if (keptRowIds.has(row.id)) {
              continue;
            }
            if (!scopedProjectId) {
              if (row.globalFieldId) {
                await tx.mutate.form_fields.delete({ id: row.id });
                continue;
              }

              const legacyValues = await tx.run(
                zql.form_entity_values.where('formId', formId).where('fieldId', row.id),
              );
              if (legacyValues.length > 0) {
                throw new Error(`Cannot delete field "${row.fieldName ?? row.id}" because it has saved values`);
              }
              await tx.mutate.form_fields.delete({ id: row.id });
              continue;
            }
            const definitionId = await ensureLegacyGlobalDefinition(row, scopedProjectId);
            if (definitionId && definitionId !== row.id) {
              const legacyValues = await tx.run(
                zql.form_entity_values.where('formId', formId).where('fieldId', row.id),
              );
              for (const value of legacyValues) {
                await tx.mutate.form_entity_values.update({
                  id: value.id,
                  fieldId: definitionId,
                  updatedAt: now,
                });
              }

            }

            await tx.mutate.form_fields.delete({ id: row.id });
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
      async ({ tx, ctx, args: { contextId, contextType, entityType, formId, mappingId } }) => {
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
            workspaceId: ctx.workspaceId,
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
        version: z.number().optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          entityId,
          entityType,
          fieldId,
          newValue,
          timestamp,
          contextId,
          version,
        },
      }) => {
        // Legacy create path: older clients only know form_fields ids, so resolve
        // formId from the legacy row. global fields must use createV2.
        const legacyField = await tx.run(
          zql.form_fields.where('id', fieldId).related('globalField').one(),
        );
        const resolvedFieldId = legacyField?.globalFieldId ?? legacyField?.id;
        const fieldType = legacyField?.globalField?.fieldType ?? legacyField?.fieldType;
        if (!legacyField || !resolvedFieldId || !fieldType) {
          throw new Error('Form field not found, cannot make an entry');
        }
        const formId = legacyField.formId;
        const fieldName = legacyField.globalField?.fieldName ?? legacyField.fieldName ?? 'Field';

        await assertFieldIsCurrentlyActive(
          tx,
          {
            id: resolvedFieldId,
            formId,
            fieldName,
            parentOptionId: legacyField.parentOptionId,
          },
          entityId,
          entityType,
        );

        // Determine actualFieldValue based on field type
        const isMultiValue =
          fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
        const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

        // Upsert the form entity value
        await tx.mutate.form_entity_values.insert({
          workspaceId: ctx.workspaceId,
          id,
          entityId,
          entityType,
          fieldId: resolvedFieldId,
          formId,
          ...(contextId && { contextId }),
          version: version ?? 1,
          fieldValue: '',
          actualFieldValue,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        const nextAttachmentId =
          fieldType === FormFieldType.DOC ? stringFromFormValue(actualFieldValue) : null;
        if (entityType === FormEntityType.TICKET && fieldType === FormFieldType.DOC && nextAttachmentId) {
          const nextAttachment = await tx.run(zql.message_attachments.where('id', nextAttachmentId).one());
          if (
            nextAttachment &&
            (nextAttachment.entityId !== id ||
              nextAttachment.entityType !== AttachmentEntityType.FORM_ENTITY_VALUE)
          ) {
            throw new Error('Attachment is not bound to this form value');
          }
        }
      },
    ),
    createV2: defineMutator(
      z.object({
        id: z.string(),
        entityId: z.string(),
        entityType: z.nativeEnum(FormEntityType),
        fieldId: z.string(),
        formId: z.string(),
        newValue: z.array(z.string()),
        timestamp: z.number(),
        contextId: z.string().optional(),
        version: z.number().optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          entityId,
          entityType,
          fieldId,
          formId,
          newValue,
          timestamp,
          contextId,
          version,
        },
      }) => {
        // Resolve the field type from the definition. fieldId may reference a new
        // global_fields definition or a legacy form_fields row.
        const globalField = await tx.run(zql.global_fields.where('id', fieldId).one());
        const legacyField = globalField
          ? null
          : await tx.run(zql.form_fields.where('id', fieldId).related('globalField').one());

        const resolvedFieldId = globalField?.id ?? legacyField?.globalFieldId ?? legacyField?.id;
        const fieldType = globalField?.fieldType ?? legacyField?.globalField?.fieldType ?? legacyField?.fieldType;
        if (!resolvedFieldId || !fieldType) {
          throw new Error('Form field not found');
        }
        let membership: any = null;
        if (globalField) {
          membership = await tx.run(
            zql.form_fields
              .where('formId', formId)
              .where('globalFieldId', globalField.id)
              .related('globalField')
              .one(),
          );
          if (!membership) {
            throw new Error('Form field not found in this form');
          }
        } else if (legacyField?.formId !== formId) {
          throw new Error('Form field not found in this form');
        } else {
          membership = legacyField;
        }
        const fieldName =
          globalField?.fieldName ?? legacyField?.globalField?.fieldName ?? legacyField?.fieldName;
        await assertFieldIsCurrentlyActive(
          tx,
          {
            id: resolvedFieldId,
            formId,
            fieldName: fieldName ?? 'Field',
            parentOptionId: membership?.parentOptionId,
          },
          entityId,
          entityType,
        );

        // Determine actualFieldValue based on field type
        const isMultiValue =
          fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
        const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

        // Upsert the form entity value
        await tx.mutate.form_entity_values.insert({
          workspaceId: ctx.workspaceId,
          id,
          entityId,
          entityType,
          fieldId: resolvedFieldId,
          formId,
          ...(contextId && { contextId }),
          version: version ?? 1,
          fieldValue: '',
          actualFieldValue,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        const nextAttachmentId =
          fieldType === FormFieldType.DOC ? stringFromFormValue(actualFieldValue) : null;
        if (entityType === FormEntityType.TICKET && fieldType === FormFieldType.DOC && nextAttachmentId) {
          const nextAttachment = await tx.run(zql.message_attachments.where('id', nextAttachmentId).one());
          if (
            nextAttachment &&
            (nextAttachment.entityId !== id ||
              nextAttachment.entityType !== AttachmentEntityType.FORM_ENTITY_VALUE)
          ) {
            throw new Error('Attachment is not bound to this form value');
          }
        }
      },
    ),
    update: defineMutator(
      z.object({
        formEntityValueId: z.string(),
        newValue: z.array(z.string()),
        updatedAt: z.number(),
        expectedValueUpdatedAt: z.number().nullable().optional(),
      }),
      async ({
        tx,
        args: {
          formEntityValueId,
          newValue,
          updatedAt,
          expectedValueUpdatedAt,
        },
      }) => {
        // Validate form entity value exists and get formField relation
        const formEntityValue = await tx.run(
          zql.form_entity_values
            .where('id', formEntityValueId)
            .related('formField')
            .related('globalField')
            .one(),
        );

        if (!formEntityValue) {
          throw new Error('Form entity value not found');
        }

        if (
          expectedValueUpdatedAt !== undefined &&
          (formEntityValue.updatedAt ?? null) !== expectedValueUpdatedAt
        ) {
          throw new Error(FORM_VALUE_CHANGED_MESSAGE);
        }

        const fieldType = formEntityValue.globalField?.fieldType ?? formEntityValue.formField?.fieldType;
        const resolvedFieldName =
          formEntityValue.globalField?.fieldName ?? formEntityValue.formField?.fieldName;
        const membership = formEntityValue.formField
          ?? (formEntityValue.globalField
            ? await tx.run(
              zql.form_fields
                .where('formId', formEntityValue.formId)
                .where('globalFieldId', formEntityValue.globalField.id)
                .related('globalField')
                .one(),
            )
            : null);
        if (membership) {
          await assertFieldIsCurrentlyActive(
            tx,
            {
              id: membership.globalFieldId ?? membership.id,
              formId: membership.formId,
              fieldName:
                (membership as { globalField?: { fieldName?: string | null } }).globalField?.fieldName
                ?? membership.fieldName
                ?? resolvedFieldName
                ?? 'Field',
              parentOptionId: membership.parentOptionId,
            },
            formEntityValue.entityId,
            formEntityValue.entityType,
          );
        }

        // Determine what to store based on field type
        const isMultiValue =
          fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
        const valueToStore = isMultiValue
          ? newValue // Store array for MULTI_SELECT/USER (including empty arrays)
          : newValue[0] || null; // Store first element or null for other types

        const nextDocAttachmentId =
          fieldType === FormFieldType.DOC ? stringFromFormValue(valueToStore) : null;
        if (
          formEntityValue.entityType === FormEntityType.TICKET &&
          fieldType === FormFieldType.DOC &&
          nextDocAttachmentId
        ) {
          const nextAttachment = await tx.run(
            zql.message_attachments.where('id', nextDocAttachmentId).one(),
          );
          if (
            nextAttachment &&
            (nextAttachment.entityId !== formEntityValueId ||
              nextAttachment.entityType !== AttachmentEntityType.FORM_ENTITY_VALUE)
          ) {
            throw new Error('Attachment is not bound to this form value');
          }
        }

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
      async ({ tx, ctx, args: { id, name, description, createdBy, timestamp } }) => {
        const now = timestamp;

        const existingDashboard = await tx.run(zql.dashboards.where('id', id).one());

        await tx.mutate.dashboards.upsert({
          workspaceId: ctx.workspaceId,
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
        entityType: z.nativeEnum(FormEntityType).optional(),
        targetEntity: z.string().optional(),
        visualType: z.string().optional(),
        position: z.string().optional(),
        dashboardId: z.string().optional(),
        createdBy: z.string(),
        timestamp: z.number(),
        mappingId: z.string().optional(),
      }),
      async ({
        tx,
        ctx,
        args: { id, title, queryJson, entityType, targetEntity, visualType, position, dashboardId, createdBy, timestamp, mappingId },
      }) => {
        const now = timestamp;

        const existingQuery = await tx.run(zql.queries.where('id', id).one());

        await tx.mutate.queries.upsert({
          workspaceId: ctx.workspaceId,
          id: id,
          title: title.trim(),
          queryJson: queryJson as ReadonlyJSONValue,
          entityType: entityType ?? null,
          targetEntity: targetEntity ?? null,
          visualType: (visualType as QueryVisualizationType | undefined) ?? null,
          ...(position !== undefined && { position }),
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
              workspaceId: ctx.workspaceId,
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
        const mappings = await tx.run(zql.dashboard_queries_mapping.where('queryId', id));
        for (const mapping of mappings) {
          await tx.mutate.dashboard_queries_mapping.delete({ id: mapping.id });
        }
        await tx.mutate.queries.delete({ id });
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
  dashboardComponent: {
    // Batched position update from AnalyticsDashboard drag/resize. Guard-free to
    // match the sibling query.* mutators (reorder/upsert) on this branch.
    updatePositions: defineMutator(
      z.object({
        updates: z.array(z.object({ id: z.string(), position: z.string() })).min(1),
        timestamp: z.number(),
      }),
      async ({ tx, args: { updates, timestamp } }) => {
        for (const u of updates) {
          await tx.mutate.queries.update({
            id: u.id,
            position: u.position,
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
        draftContent: z.string().optional(),
        attachmentIds: z.array(z.string()).optional(),
        toRecipients: z.array(z.string()).optional(),
        ccRecipients: z.array(z.string()).optional(),
        bccRecipients: z.array(z.string()).optional(),
        updatedAt: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          conversationId,
          channelId,
          draftContent,
          attachmentIds,
          toRecipients,
          ccRecipients,
          bccRecipients,
          updatedAt,
        },
      }) => {
        const existing = await tx.run(
          zql.email_drafts
            .where('conversationId', conversationId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          // Merge: only overwrite fields that were explicitly provided, so a body-only
          // save and a recipients-only save don't clobber each other.
          await tx.mutate.email_drafts.update({
            id: existing.id,
            ...(draftContent !== undefined && { draftContent }),
            ...(attachmentIds !== undefined && { attachmentIds }),
            // Recipient columns are TEXT ("string only") — store a JSON-stringified string[].
            ...(toRecipients !== undefined && { toRecipients: JSON.stringify(toRecipients) }),
            ...(ccRecipients !== undefined && { ccRecipients: JSON.stringify(ccRecipients) }),
            ...(bccRecipients !== undefined && { bccRecipients: JSON.stringify(bccRecipients) }),
            updatedAt,
          });
        } else {
          await tx.mutate.email_drafts.insert({
            workspaceId: ctx.workspaceId,
            id,
            conversationId,
            channelId,
            userId: ctx.userID,
            draftContent: draftContent ?? '',
            ...(attachmentIds !== undefined && { attachmentIds }),
            ...(toRecipients !== undefined && { toRecipients: JSON.stringify(toRecipients) }),
            ...(ccRecipients !== undefined && { ccRecipients: JSON.stringify(ccRecipients) }),
            ...(bccRecipients !== undefined && { bccRecipients: JSON.stringify(bccRecipients) }),
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
    // Compose drafts (brand-new emails, no thread yet). Keyed by the draft id, since
    // conversationId is null and would collide across many compose drafts per user.
    // Merge-update so partial saves (body vs recipients vs subject) don't clobber.
    upsertComposeDraft: defineMutator(
      z.object({
        id: z.string(),
        channelId: z.string(),
        subject: z.string().optional(),
        fromAddress: z.string().optional(),
        draftContent: z.string().optional(),
        attachmentIds: z.array(z.string()).optional(),
        toRecipients: z.array(z.string()).optional(),
        ccRecipients: z.array(z.string()).optional(),
        bccRecipients: z.array(z.string()).optional(),
        updatedAt: z.number(),
      }),
      async ({ tx, ctx, args }) => {
        const existing = await tx.run(zql.email_drafts.where('id', args.id).one());
        // Owner-only on the update path (mirrors deleteComposeDraft and the reply upsert):
        // ids are client-supplied, so never let one user's id overwrite another user's row.
        if (existing && existing.userId !== ctx.userID) return;
        if (existing) {
          await tx.mutate.email_drafts.update({
            id: args.id,
            ...(args.subject !== undefined && { subject: args.subject }),
            ...(args.fromAddress !== undefined && { fromAddress: args.fromAddress }),
            ...(args.draftContent !== undefined && { draftContent: args.draftContent }),
            ...(args.attachmentIds !== undefined && { attachmentIds: args.attachmentIds }),
            // Recipient columns are TEXT ("string only") — store a JSON-stringified string[].
            ...(args.toRecipients !== undefined && {
              toRecipients: JSON.stringify(args.toRecipients),
            }),
            ...(args.ccRecipients !== undefined && {
              ccRecipients: JSON.stringify(args.ccRecipients),
            }),
            ...(args.bccRecipients !== undefined && {
              bccRecipients: JSON.stringify(args.bccRecipients),
            }),
            updatedAt: args.updatedAt,
          });
        } else {
          await tx.mutate.email_drafts.insert({
            workspaceId: ctx.workspaceId,
            id: args.id,
            channelId: args.channelId,
            userId: ctx.userID,
            draftContent: args.draftContent ?? '',
            ...(args.subject !== undefined && { subject: args.subject }),
            ...(args.fromAddress !== undefined && { fromAddress: args.fromAddress }),
            ...(args.attachmentIds !== undefined && { attachmentIds: args.attachmentIds }),
            ...(args.toRecipients !== undefined && {
              toRecipients: JSON.stringify(args.toRecipients),
            }),
            ...(args.ccRecipients !== undefined && {
              ccRecipients: JSON.stringify(args.ccRecipients),
            }),
            ...(args.bccRecipients !== undefined && {
              bccRecipients: JSON.stringify(args.bccRecipients),
            }),
            createdAt: args.updatedAt,
            updatedAt: args.updatedAt,
          });
        }
      },
    ),
    deleteComposeDraft: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        const existing = await tx.run(zql.email_drafts.where('id', id).one());
        if (existing && existing.userId === ctx.userID) {
          await tx.mutate.email_drafts.delete({ id });
        }
      },
    ),
  },
  // Gmail-style labels for desk/support email conversations. Labels are private to the
  // agent who created them: the catalog is per-channel, per-user (createdBy), and
  // mappings attach a label to a conversation (email thread).
  conversationLabel: {
    // Create a new label in the user's catalog for this channel (no conversation attached yet).
    createLabel: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string().optional(),
        channelId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, color, channelId, timestamp } }) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Label name cannot be empty');

        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) throw new Error('Channel not found');

        const existing = await tx.run(
          zql.conversation_labels
            .where('channelId', channelId)
            .where('createdBy', ctx.userID)
            .where('name', trimmed)
            .one(),
        );
        if (existing) throw new Error('A label with this name already exists');

        await tx.mutate.conversation_labels.insert({
          id,
          name: trimmed,
          ...(color ? { color } : {}),
          channelId,
          workspaceId: channel.workspaceId,
          createdBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),
    // Apply a label to a conversation. Creates the catalog label if it doesn't yet
    // exist (mirrors Gmail "Label as → Create new"), then inserts the mapping.
    applyLabel: defineMutator(
      z.object({
        labelId: z.string(),
        labelName: z.string(),
        color: z.string().optional(),
        conversationId: z.string(),
        channelId: z.string(),
        mappingId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args }) => {
        const trimmed = args.labelName.trim();
        if (!trimmed) throw new Error('Label name cannot be empty');

        const channel = await tx.run(zql.channels.where('id', args.channelId).one());
        if (!channel) throw new Error('Channel not found');

        // Resolve an existing catalog label by name, or create it.
        let labelId = args.labelId;
        const now = args.timestamp;
        const existingLabel = await tx.run(
          zql.conversation_labels
            .where('channelId', args.channelId)
            .where('createdBy', ctx.userID)
            .where('name', trimmed)
            .one(),
        );
        if (existingLabel) {
          labelId = existingLabel.id;
        } else {
          await tx.mutate.conversation_labels.insert({
            id: labelId,
            name: trimmed,
            ...(args.color ? { color: args.color } : {}),
            channelId: args.channelId,
            workspaceId: channel.workspaceId,
            createdBy: ctx.userID,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Idempotent: don't double-apply the same label to a conversation.
        const existingMapping = await tx.run(
          zql.conversation_label_mappings
            .where('conversationId', args.conversationId)
            .where('labelId', labelId)
            .one(),
        );
        if (existingMapping) return;

        await tx.mutate.conversation_label_mappings.insert({
          id: args.mappingId,
          labelId,
          labelName: trimmed,
          conversationId: args.conversationId,
          channelId: args.channelId,
          workspaceId: channel.workspaceId,
          createdBy: ctx.userID,
          createdAt: now,
        });
      },
    ),
    // Remove a label from a conversation (deletes only the mapping, not the catalog label).
    // Scoped to the caller so an agent can only remove their own mapping.
    removeLabel: defineMutator(
      z.object({ conversationId: z.string(), labelId: z.string() }),
      async ({ tx, ctx, args: { conversationId, labelId } }) => {
        const existing = await tx.run(
          zql.conversation_label_mappings
            .where('conversationId', conversationId)
            .where('labelId', labelId)
            .where('createdBy', ctx.userID)
            .one(),
        );
        if (existing) {
          await tx.mutate.conversation_label_mappings.delete({ id: existing.id });
        }
      },
    ),
  },
  // Thread types — what kind of thread this is, as a stringified JSON array on the
  // conversation row. The caller sends the FULL desired set: the column is one value, so a
  // partial update would be a read-modify-write race.
  //
  // KEEP IN SYNC with apps/backend/src/zero/mutators.ts threadTag.
  threadTag: {
    setTypes: defineMutator(
      z.object({
        conversationId: z.string(),
        // Free-form, not z.enum: the built-in vocabulary is a starting point, and projects
        // add their own. Length-capped so a tag stays a label rather than a paragraph.
        types: z.array(z.string().trim().min(1).max(40)),
      }),
      async ({ tx, args: { conversationId, types } }) => {
        const conversation = await tx.run(
          zql.conversations.where('conversationId', conversationId).one(),
        );
        if (!conversation) throw new Error('Conversation not found');

        // Built-in types first in vocabulary order, then custom ones alphabetically, so
        // chips render in a stable order regardless of the order they were picked.
        const rank = (name: string): number => {
          const i = (THREAD_TYPE_NAMES as readonly string[]).indexOf(name);
          return i === -1 ? THREAD_TYPE_NAMES.length : i;
        };
        const unique = [...new Set(types.map(t => t.trim()).filter(Boolean))].sort(
          (a, b) => rank(a) - rank(b) || a.localeCompare(b),
        );


        // '[]' rather than null when cleared: null means "never classified" and the
        // classifier would re-derive it on its next pass.
        await tx.mutate.conversations.update({
          conversationId,
          threadType: unique.length > 0 ? JSON.stringify(unique) : '[]',
        });
      },
    ),
  },
  // Gmail-style mailbox overlay (per-user, per-desk) over shared desk tickets. Sparse:
  // a row exists only once the agent acts; absence means { INBOX, not starred }. The
  // ticket stays shared at the channel level.
  ticketMailbox: {
    // Upsert the caller's mailbox state for a ticket (archive/spam/trash/restore-to-inbox).
    setState: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        channelId: z.string(),
        state: z.nativeEnum(MailboxState),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, ticketId, channelId, state, timestamp } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) throw new Error('Channel not found');

        const existing = await tx.run(
          zql.ticket_user_mailbox
            .where('ticketId', ticketId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          await tx.mutate.ticket_user_mailbox.update({
            id: existing.id,
            state,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.ticket_user_mailbox.insert({
            id,
            ticketId,
            userId: ctx.userID,
            channelId,
            workspaceId: channel.workspaceId,
            state,
            starred: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    // Upsert the caller's star flag for a ticket (additive — keeps the mailbox state).
    setStarred: defineMutator(
      z.object({
        id: z.string(),
        ticketId: z.string(),
        channelId: z.string(),
        starred: z.boolean(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, ticketId, channelId, starred, timestamp } }) => {
        const channel = await tx.run(zql.channels.where('id', channelId).one());
        if (!channel) throw new Error('Channel not found');

        const existing = await tx.run(
          zql.ticket_user_mailbox
            .where('ticketId', ticketId)
            .where('userId', ctx.userID)
            .one(),
        );
        if (existing) {
          await tx.mutate.ticket_user_mailbox.update({
            id: existing.id,
            starred,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.ticket_user_mailbox.insert({
            id,
            ticketId,
            userId: ctx.userID,
            channelId,
            workspaceId: channel.workspaceId,
            state: MailboxState.INBOX,
            starred,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
  },
  userPreference: {
    setSidebarGroupPreference: defineMutator(
      z.object({
        id: z.string(),
        group: z.enum(['starred', 'channels', 'dms']),
        filterMode: z.nativeEnum(ChannelFilterMode).optional(),
        sortOrder: z.nativeEnum(ChannelSortOrder).optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, group, filterMode, sortOrder, timestamp } }) => {
        const filterField = {
          starred: 'starredFilterMode',
          channels: 'channelFilterMode',
          dms: 'dmFilterMode',
        }[group];
        const sortField = {
          starred: 'starredSortOrder',
          channels: 'channelSortOrder',
          dms: 'dmSortOrder',
        }[group];
        const fields = {
          ...(filterMode !== undefined && { [filterField]: filterMode }),
          ...(sortOrder !== undefined && { [sortField]: sortOrder }),
        };
        const existing = await tx.run(zql.user_preferences.where('userId', ctx.userID).one());
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            ...fields,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage: true,
            allowThreadBroadcastMentions: false,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            showThreadTags: false,
            ...fields,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
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
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder,
            enterSendsMessage: true,
            allowThreadBroadcastMentions: false,
            globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            notificationKeywords: '[]',
            showThreadTags: false,
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
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage,
            allowThreadBroadcastMentions: false,
            globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            notificationKeywords: '[]',
            showThreadTags: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    setShowThreadTags: defineMutator(
      z.object({
        id: z.string(),
        showThreadTags: z.boolean(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, showThreadTags, timestamp } }) => {
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            showThreadTags,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage: true,
            allowThreadBroadcastMentions: false,
            globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            notificationKeywords: '[]',
            showThreadTags,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    setAllowThreadBroadcastMentions: defineMutator(
      z.object({
        id: z.string(),
        allowThreadBroadcastMentions: z.boolean(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, allowThreadBroadcastMentions, timestamp } }) => {
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            allowThreadBroadcastMentions,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage: true,
            allowThreadBroadcastMentions,
            globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            notificationKeywords: '[]',
            showThreadTags: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    setGlobalNotificationSettings: defineMutator(
      z.object({
        id: z.string(),
        globalDesktopNotificationLevel: z.nativeEnum(NotificationLevel).optional(),
        globalMobileNotificationLevel: z.nativeEnum(NotificationLevel).optional(),
        threadReplyNotificationsEnabled: z.boolean().optional(),
        channelWideMentionsEnabled: z.boolean().optional(),
        timestamp: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: {
          id,
          globalDesktopNotificationLevel,
          globalMobileNotificationLevel,
          threadReplyNotificationsEnabled,
          channelWideMentionsEnabled,
          timestamp,
        },
      }) => {
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            ...(globalDesktopNotificationLevel !== undefined && { globalDesktopNotificationLevel }),
            ...(globalMobileNotificationLevel !== undefined && { globalMobileNotificationLevel }),
            ...(threadReplyNotificationsEnabled !== undefined && { threadReplyNotificationsEnabled }),
            ...(channelWideMentionsEnabled !== undefined && { channelWideMentionsEnabled }),
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage: true,
            allowThreadBroadcastMentions: false,
            globalDesktopNotificationLevel: globalDesktopNotificationLevel ?? NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: globalMobileNotificationLevel ?? NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: threadReplyNotificationsEnabled ?? true,
            channelWideMentionsEnabled: channelWideMentionsEnabled ?? true,
            notificationKeywords: '[]',
            showThreadTags: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),
    setNotificationKeywords: defineMutator(
      z.object({
        id: z.string(),
        keywords: z.array(z.string().min(1).max(MAX_NOTIFICATION_KEYWORD_LENGTH)).max(MAX_NOTIFICATION_KEYWORDS),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, keywords, timestamp } }) => {
        const notificationKeywords = JSON.stringify(normalizeNotificationKeywords(keywords));
        const existing = await tx.run(
          zql.user_preferences.where('userId', ctx.userID).one(),
        );
        if (existing) {
          await tx.mutate.user_preferences.update({
            id: existing.id,
            notificationKeywords,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.user_preferences.insert({
            workspaceId: ctx.workspaceId,
            id,
            userId: ctx.userID,
            channelSortOrder: ChannelSortOrder.RECENCY,
            enterSendsMessage: true,
            allowThreadBroadcastMentions: false,
            globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
            threadReplyNotificationsEnabled: true,
            channelWideMentionsEnabled: true,
            notificationKeywords,
            showThreadTags: false,
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
        twoStepSendEnabled: z.boolean().optional(),
        autoDraftMode: z.nativeEnum(AutoDraftMode).optional(),
        autoDraftAgentSlug: z.string().optional().nullable(),
        metricsEnabled: z.boolean().optional(),
        frtStageNames: z.string().optional().nullable(),
        appWebhookDeliveryEnabled: z.boolean().optional(),
        deskReportEnabled: z.boolean().optional(),
        deskReportAgentSlug: z.string().optional().nullable(),
        deskReportRangeDays: z.number().optional(),
      }),
      async ({
        tx,
        ctx,
        args: {
          channelId,
          ownerUserId,
          assigneeUserGroupId,
          sendAsEmail,
          defaultCc,
          emailMergeMode,
          twoStepSendEnabled,
          autoDraftMode,
          autoDraftAgentSlug,
          metricsEnabled,
          frtStageNames,
          appWebhookDeliveryEnabled,
          deskReportEnabled,
          deskReportAgentSlug,
          deskReportRangeDays,
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
            ...(twoStepSendEnabled !== undefined ? { twoStepSendEnabled } : {}),
            ...(autoDraftMode !== undefined ? { autoDraftMode } : {}),
            ...(autoDraftAgentSlug !== undefined ? { autoDraftAgentSlug } : {}),
            ...(metricsEnabled !== undefined ? { metricsEnabled } : {}),
            ...(frtStageNames !== undefined ? { frtStageNames } : {}),
            ...(appWebhookDeliveryEnabled !== undefined ? { appWebhookDeliveryEnabled } : {}),
            ...(deskReportEnabled !== undefined ? { deskReportEnabled } : {}),
            ...(deskReportAgentSlug !== undefined ? { deskReportAgentSlug } : {}),
            ...(deskReportRangeDays !== undefined ? { deskReportRangeDays } : {}),
          });
        } else {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          await tx.mutate.email_channel_preferences.insert({
            workspaceId: ctx.workspaceId,
            channelId,
            ownerUserId: ownerUserId ?? ctx.userID,
            assigneeUserGroupId: assigneeUserGroupId ?? null,
            boardId: null,
            sendAsEmail: sendAsEmail ?? null,
            classificationEnabled: false,
            classificationPrompt: null,
            categoryField: null,
            subCategoryField: null,
            defaultCc: defaultCc ?? null,
            emailMergeMode: emailMergeMode ?? EmailMergeMode.ENABLED,
            twoStepSendEnabled: twoStepSendEnabled ?? false,
            autoDraftMode: autoDraftMode ?? AutoDraftMode.OFF,
            autoDraftAgentSlug: autoDraftAgentSlug ?? null,
            deskType: deskTypeForChannelType(channel?.type),
            priorityClassificationEnabled: false,
            priorityClassificationPrompt: null,
            priorityClassificationThreshold: 0.5,
            metricsEnabled: metricsEnabled ?? false,
            frtStageNames: frtStageNames ?? null,
            appWebhookDeliveryEnabled: appWebhookDeliveryEnabled ?? true,
            deskReportEnabled: deskReportEnabled ?? false,
            deskReportAgentSlug: deskReportAgentSlug ?? null,
            deskReportRangeDays: deskReportRangeDays ?? 1,
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
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          await tx.mutate.email_channel_preferences.insert({
            workspaceId: ctx.workspaceId,
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
            deskType: deskTypeForChannelType(channel?.type),
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
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          await tx.mutate.email_channel_preferences.insert({
            workspaceId: ctx.workspaceId,
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
            deskType: deskTypeForChannelType(channel?.type),
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
      async ({ tx, ctx, args }) => {
        await tx.mutate.classification_mappings.insert({ ...args, workspaceId: ctx.workspaceId });
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
        ctx,
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
            workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
              workspaceId: ctx.workspaceId,
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

    bulkMarkAsUnread: defineMutator(
      z.object({
        ticketIds: z.array(z.string()).max(50, 'Cannot mark more than 50 tickets at once'),
      }),
      async ({ tx, ctx, args: { ticketIds } }) => {
        if (ticketIds.length === 0) return;
        const existing = await tx.run(
          zql.email_reads
            .where('userId', ctx.userID)
            .where(h => h.cmp('ticketId', 'IN', ticketIds)),
        );
        await Promise.all(existing.map(e => tx.mutate.email_reads.delete({ id: e.id })));
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
      async ({ tx, ctx, args: { grants, timestamp } }) => {
        for (const grant of grants) {
          await tx.mutate.resource_access.insert({
            workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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
        ctx,
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
          workspaceId: ctx.workspaceId,
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
  applicationReleaseTicket: {
    // Per-ticket ART testing update (Testing tab on the release detail page).
    // A dev ticket's test/stage state is single-sourced on the ticket
    // (statusV2 / stageName) — ART no longer stores a status column. testedAt
    // toggles on terminal stages (COMPLETED / CANCELLED) for every ART row
    // associated with the dev ticket. Also mirrors the stage change onto the
    // live dev ticket, resolving it via ART.ticketId.
    updateStatus: defineMutator(
      z.object({
        id: z.string(),
        stageName: z.string().optional(),
        defaultTicketStatusV2: z.nativeEnum(TicketStatusV2).optional(),
        failureReason: z.string().optional().nullable(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, stageName, defaultTicketStatusV2, failureReason, timestamp } }) => {
        const row = await tx.run(zql.application_release_tickets.where('id', id).one());
        if (!row) {
          throw new Error('ART row not found');
        }

        // testedAt is set once the ticket reaches a terminal stage.
        const isTested =
          defaultTicketStatusV2 === TicketStatusV2.COMPLETED ||
          defaultTicketStatusV2 === TicketStatusV2.CANCELLED;

        const relatedRows = await tx.run(
          zql.application_release_tickets.where('ticketId', row.ticketId),
        );
        for (const relatedRow of relatedRows) {
          await tx.mutate.application_release_tickets.update({
            id: relatedRow.id,
            ...(isTested ? { testedAt: timestamp } : { testedAt: null }),
            ...(failureReason !== undefined && { failureReason }),
            updatedAt: timestamp,
          });
        }

        const devTicket = await tx.run(zql.tickets.where('id', row.ticketId).one());
        if (devTicket) {
          // Only update the dev ticket client-side if the caller is a participant
          // in its channel. If not (e.g. release manager updating a stub from the
          // release screen), skip the optimistic update — the server-side side
          // effect will handle it without ACL restrictions.
          const isParticipant = devTicket.channelId
            ? Boolean(
              await tx.run(
                zql.channel_participants
                  .where('channelId', devTicket.channelId)
                  .where('userId', ctx.userID)
                  .one(),
              ),
            )
            : false;
          if (isParticipant) {
            await tx.mutate.tickets.update({
              id: devTicket.id,
              ...(defaultTicketStatusV2 !== undefined && { statusV2: defaultTicketStatusV2 }),
              ...(stageName !== undefined && { stageName }),
              updatedAt: timestamp,
            });
          }
        }
      },
    ),
    // QA assignment for the row. Optimistic stub — backend validates the ART exists.
    setTestedBy: defineMutator(
      z.object({
        id: z.string(),
        userId: z.string().nullable(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, userId } }) => {
        await tx.mutate.application_release_tickets.update({
          id,
          testedBy: userId,
        });
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
      async ({ tx, ctx, args: { id, ticketId, impactTypeId, impact, rcaId, timestamp } }) => {
        if (!rcaId) {
          throw new Error('RCA ID is required for creating an impact');
        }

        await tx.mutate.impacts.insert({
          workspaceId: ctx.workspaceId,
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
        ctx,
        args: { id, rcaId, ownerId, actionTypeId, action, status, dueDate, timestamp },
      }) => {
        await tx.mutate.coes.insert({
          workspaceId: ctx.workspaceId,
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
          workspaceId: ctx.workspaceId,
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
            workspaceId: ctx.workspaceId,
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
        isStarred: z.boolean().optional(),
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
      async ({ tx, ctx, args: { configId, name, visibility, isStarred, timestamp, values } }) => {
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
          ...(isStarred !== undefined && { isStarred }),
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
              workspaceId: ctx.workspaceId,
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

        // Creator editing the template: webhook is written to the APP (template) and version
        // is bumped so installs see an Update prompt. (Per-install webhook edits go via REST.)
        const updateData: {
          id: string;
          updatedAt: number;
          version: number;
          name?: string;
          description?: string | null;
          webhookUrl?: string | null;
        } = {
          id: appId,
          updatedAt: timestamp,
          version: (app.version ?? 0) + 1,
        };

        if (name !== undefined) {
          updateData.name = name.trim();
        }
        if (description !== undefined) {
          updateData.description = description.trim() || null;
        }
        if (webhookUrl !== undefined) {
          updateData.webhookUrl = webhookUrl.trim() || null;
        }

        await tx.mutate.apps.update(updateData);
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
          workspaceId: ctx.workspaceId,
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
    updateRole: defineMutator(
      z.object({
        memberId: z.string(),
        updates: z.object({
          role: z.enum([OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER]).optional(),
        }),
      }),
      async ({ tx, args: { memberId, updates } }) => {
        await tx.mutate.org_members.update({
          memberId,
          ...updates,
        });
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
            .where("userId", ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
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
          workspaceId: ctx.workspaceId,
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
            .where("userId", ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
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
          workspaceId: ctx.workspaceId,
          id,
          channelId: scheduled.channelId,
          conversationId: scheduled.conversationId,
          userId: ctx.userID,
          content: scheduled.content,
          hasAttachment,
          origin: DraftOrigin.user,
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
          zql.draft_messages
            .where("id", id)
            .where("userId", ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
            .one(),
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
          zql.draft_messages
            .where("id", id)
            .where("userId", ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
            .one(),
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
          zql.draft_messages
            .where("id", id)
            .where("userId", ctx.userID)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
            .one(),
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
  // ---------------------------------------------------------------------------
  // Automations — pure DB writes on the `workflows` table for the rows where
  // `workflowType === 'Automations'`. Activate / disable stay on REST because
  // they have trigger-register side-effects (CRON Bull job lifecycle). Manual
  // fire stays on REST (Bull job enqueue).
  // ---------------------------------------------------------------------------
  automations: {
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
        /** Pre-stringified updated config (`AutomationConfig`). */
        configJson: z.string().optional(),
        /** Pre-stringified updated metadata blob (full replacement of `{description, createdById}`). */
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
      },
    ),
    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, args: { id } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (existing && existing.workflowType === 'Automations') {
          if (existing.status !== 'DRAFT') {
            throw new Error(
              `Cannot delete "${id}": only DRAFT proposals can be deleted (status is ${existing.status}).`,
            );
          }
        }
        await tx.mutate.workflows.delete({ id });
      },
    ),
    submitForApproval: defineMutator(
      z.object({ id: z.string(), timestamp: z.number() }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
          throw new Error(`Automation "${id}" not found`);
        }
        if (existing.status !== 'DRAFT') {
          throw new Error(
            `Automation "${id}" is ${existing.status}; only DRAFT proposals can be submitted.`,
          );
        }
        await tx.mutate.workflows.update({
          id,
          status: 'PENDING_APPROVAL',
          updatedAt: timestamp,
        });
      },
    ),
    revoke: defineMutator(
      z.object({ id: z.string(), timestamp: z.number() }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
          throw new Error(`Automation "${id}" not found`);
        }
        if (existing.status !== 'PENDING_APPROVAL') {
          throw new Error(
            `Automation "${id}" is ${existing.status}; only PENDING_APPROVAL proposals can be revoked.`,
          );
        }
        await tx.mutate.workflows.update({
          id,
          status: 'REVOKED',
          updatedAt: timestamp,
        });
      },
    ),
    approve: defineMutator(
      z.object({
        id: z.string(),
        note: z.string().nullable().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
          throw new Error(`Automation "${id}" not found`);
        }
        await tx.mutate.workflows.update({
          id,
          status: 'DISABLED',
          updatedAt: timestamp,
        });
      },
    ),
    reject: defineMutator(
      z.object({
        id: z.string(),
        note: z.string().min(1),
        timestamp: z.number(),
      }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
          throw new Error(`Automation "${id}" not found`);
        }
        if (existing.status !== 'PENDING_APPROVAL') {
          throw new Error(
            `Automation "${id}" is ${existing.status}; only PENDING_APPROVAL proposals can be rejected.`,
          );
        }
        await tx.mutate.workflows.update({
          id,
          status: 'REJECTED',
          updatedAt: timestamp,
        });
      },
    ),
    activate: defineMutator(
      z.object({ id: z.string(), timestamp: z.number() }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
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
      },
    ),
    disable: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        cancelQueued: z.boolean().optional(),
      }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
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
      },
    ),

    // Admin-only: permanently retire a live automation. ARCHIVED is gated to
    // admins by the workflows ACL, and the event-router only matches ACTIVE
    // rows, so archiving immediately stops it from firing.
    archive: defineMutator(
      z.object({ id: z.string(), timestamp: z.number() }),
      async ({ tx, args: { id, timestamp } }) => {
        const existing = await tx.run(zql.workflows.where('id', id).one());
        if (!existing || existing.workflowType !== 'Automations') {
          throw new Error(`Automation "${id}" not found`);
        }
        if (existing.status !== 'ACTIVE' && existing.status !== 'DISABLED') {
          throw new Error(
            `Automation "${id}" is ${existing.status}; only LIVE rows can be archived.`,
          );
        }
        await tx.mutate.workflows.update({
          id,
          status: 'ARCHIVED',
          updatedAt: timestamp,
        });
      },
    ),
  },

  collection: {
    createCollection: defineMutator(
      z.object({
        id: z.string(),
        scopeType: z.string(),
        scopeId: z.string(),
        name: z.string(),
        description: z.string().nullable().optional(),
        isPrivate: z.boolean().optional(),
        permissionId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, scopeType, scopeId, name, description, isPrivate, permissionId, timestamp } }) => {
        // Check for existing non-deleted collection with same name in this scope
        const existingCollection = await tx.run(
          zql.collections
            .where('scopeType', scopeType)
            .where('scopeId', scopeId)
            .where('name', name)
            .where('deletedAt', 'IS', null)
            .one(),
        );
        if (existingCollection) {
          throw new Error(`Collection "${name}" already exists`);
        }

        await tx.mutate.collections.insert({
          workspaceId: ctx.workspaceId,
          id,
          scopeType,
          scopeId,
          name,
          description: description ?? undefined,
          ownerId: ctx.userID,
          isPrivate: isPrivate ?? false,
          rootCollectionId: id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        // Add creator as OWNER in collection_permissions
        await tx.mutate.collection_permissions.insert({
          workspaceId: ctx.workspaceId,
          id: permissionId,
          collectionId: id,
          userId: ctx.userID,
          role: CollectionRole.OWNER,
          canShare: true,
          grantedBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),

    updateCollection: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        isPrivate: z.boolean().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, description, isPrivate, timestamp } }) => {
        const collection = await tx.run(zql.collections.where('id', id).one());
        if (!collection) {
          throw new Error('Collection not found');
        }

        // OWNER is a real, multi-holder role — the creator (ownerId) is a
        // separate, permanent label, not the sole authority. Either grants
        // full owner privilege here.
        const isCreator = collection.ownerId === ctx.userID;
        const permissionRole = isCreator
          ? null
          : await resolveCollectionPermissionRole(tx, id, ctx.userID);
        const canActAsOwner = isCreator || permissionRole === CollectionRole.OWNER;

        // Visibility is owner-only: changing isPrivate flips who can see the
        // collection at all, so EDITOR permissions are not enough.
        if (isPrivate !== undefined && !canActAsOwner) {
          throw new Error('Collection update failed: only an owner can change visibility');
        }

        // Rename is owner-only too: collection names are surfaced wherever the
        // collection is referenced (sidebar, breadcrumbs, share UI), so we
        // treat the title the same as visibility — a property only owners
        // are allowed to change.
        if (name !== undefined && !canActAsOwner) {
          throw new Error('Collection update failed: only an owner can rename the collection');
        }

        // Verify OWNER or EDITOR permission for name/description edits
        if (!canActAsOwner && (!permissionRole || permissionRole === CollectionRole.VIEWER)) {
          throw new Error('Collection update failed: requires EDITOR or OWNER permission');
        }

        await tx.mutate.collections.update({
          id,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description: description ?? undefined }),
          ...(isPrivate !== undefined && { isPrivate }),
          updatedAt: timestamp,
        });
      },
    ),

    deleteCollection: defineMutator(
      z.object({
        id: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, timestamp } }) => {
        const collection = await tx.run(zql.collections.where('id', id).one());
        if (!collection) {
          throw new Error('Collection not found');
        }
        if (collection.ownerId !== ctx.userID) {
          const permissionRole = await resolveCollectionPermissionRole(tx, id, ctx.userID);
          if (permissionRole !== CollectionRole.OWNER) {
            throw new Error('Collection deletion failed: only an owner can delete a collection');
          }
        }

        await tx.mutate.collections.update({
          id,
          deletedAt: timestamp,
        });

        // Cascade soft-delete to all items in the collection
        const items = await tx.run(
          zql.collection_items.where('collectionId', id).where('deletedAt', 'IS', null),
        );

        for (const item of items) {
          await tx.mutate.collection_items.update({ id: item.id, deletedAt: timestamp });
        }
      },
    ),

    createFolder: defineMutator(
      z.object({
        id: z.string(),
        parentId: z.string(),
        name: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, parentId, name, timestamp } }) => {
        const parentCollection = await tx.run(zql.collections.where('id', parentId).one());
        if (!parentCollection) {
          throw new Error('Collection not found');
        }

        // Verify EDITOR+ permission against the root collection (permissions only exist on root collections)
        const rootCollectionId = parentCollection.rootCollectionId ?? parentId;
        const isOwner = parentCollection.ownerId === ctx.userID;
        if (!isOwner) {
          const permissionRole = await resolveCollectionPermissionRole(tx, rootCollectionId, ctx.userID);
          if (!permissionRole || permissionRole === CollectionRole.VIEWER) {
            throw new Error('Folder creation failed: requires EDITOR or OWNER permission');
          }
        }

        await tx.mutate.collections.insert({
          workspaceId: ctx.workspaceId,
          id,
          parentId,
          ownerId: ctx.userID,
          name,
          scopeType: parentCollection.scopeType,
          scopeId: parentCollection.scopeId,
          isPrivate: parentCollection.isPrivate,
          rootCollectionId: parentCollection.rootCollectionId ?? parentId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    ),

    deleteItem: defineMutator(
      z.object({
        id: z.string(),
        collectionId: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, collectionId, timestamp } }) => {
        const collection = await tx.run(zql.collections.where('id', collectionId).one());
        if (!collection) {
          throw new Error('Collection not found');
        }

        // Verify EDITOR+ permission
        const isOwner = collection.ownerId === ctx.userID;
        if (!isOwner) {
          const permissionRole = await resolveCollectionPermissionRole(tx, collectionId, ctx.userID);
          if (!permissionRole || permissionRole === CollectionRole.VIEWER) {
            throw new Error('Item deletion failed: requires EDITOR or OWNER permission');
          }
        }

        // In the new design, folders are Collection rows and files are CollectionItem rows.
        const folder = await tx.run(zql.collections.where('id', id).one());
        if (folder) {
          await tx.mutate.collections.update({ id, deletedAt: timestamp });
        } else {
          await tx.mutate.collection_items.update({ id, deletedAt: timestamp });
        }
      },
    ),

    renameItem: defineMutator(
      z.object({
        id: z.string(),
        collectionId: z.string(),
        name: z.string(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, collectionId, name, timestamp } }) => {
        const collection = await tx.run(zql.collections.where('id', collectionId).one());
        if (!collection) {
          throw new Error('Collection not found');
        }

        // Verify EDITOR+ permission
        const isOwner = collection.ownerId === ctx.userID;
        if (!isOwner) {
          const permissionRole = await resolveCollectionPermissionRole(tx, collectionId, ctx.userID);
          if (!permissionRole || permissionRole === CollectionRole.VIEWER) {
            throw new Error('Item rename failed: requires EDITOR or OWNER permission');
          }
        }

        // In the new design, folders are Collection rows and files are CollectionItem rows.
        const folder = await tx.run(zql.collections.where('id', id).one());
        if (folder) {
          await tx.mutate.collections.update({ id, name, updatedAt: timestamp });
        } else {
          await tx.mutate.collection_items.update({ id, name, updatedAt: timestamp });
        }
      },
    ),

    grantPermission: defineMutator(
      z.object({
        id: z.string(),
        collectionId: z.string(),
        userId: z.string().optional(),
        userGroupId: z.string().optional(),
        channelId: z.string().optional(),
        role: z.nativeEnum(CollectionRole),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, collectionId, userId, userGroupId, channelId, role, timestamp } }) => {
        const collection = await tx.run(zql.collections.where('id', collectionId).one());
        if (!collection) {
          throw new Error('Collection not found');
        }
        if (collection.ownerId !== ctx.userID) {
          // Anyone with an explicit role (Viewer/Editor/Owner) can share —
          // there's no separate delegated "canShare" permission.
          const granterRole = await resolveCollectionPermissionRole(tx, collectionId, ctx.userID);
          if (!granterRole) {
            throw new Error('Permission grant failed: you do not have access to this collection');
          }
        }

        // Prevent sharing with the collection owner
        if (userId && userId === collection.ownerId) {
          throw new Error('Cannot share collection with its owner');
        }

        // A channel grant is always read-only — a channel can have many
        // members, so defaulting all of them to write access is a bigger
        // blast radius than a person or a curated group.
        if (channelId && role !== CollectionRole.VIEWER) {
          throw new Error('Permission grant failed: channel grants are read-only (Viewer)');
        }

        const existing = userId
          ? await tx.run(
              zql.collection_permissions
                .where('collectionId', collectionId)
                .where('userId', userId)
                .one(),
            )
          : userGroupId
            ? await tx.run(
                zql.collection_permissions
                  .where('collectionId', collectionId)
                  .where('userGroupId', userGroupId)
                  .one(),
              )
            : channelId
              ? await tx.run(
                  zql.collection_permissions
                    .where('collectionId', collectionId)
                    .where('channelId', channelId)
                    .one(),
                )
              : null;

        if (existing) {
          await tx.mutate.collection_permissions.update({
            id: existing.id,
            role,
            // Dead field — nothing reads canShare anymore (sharing is
            // purely role-based, see the escalation check above). Kept at
            // the Prisma column default since it's still NOT NULL; not
            // threaded through as a caller-supplied argument.
            canShare: false,
            updatedAt: timestamp,
          });
        } else {
          await tx.mutate.collection_permissions.insert({
            workspaceId: ctx.workspaceId,
            id,
            collectionId,
            userId,
            userGroupId,
            channelId,
            role,
            canShare: false,
            grantedBy: ctx.userID,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
    ),

    revokePermission: defineMutator(
      z.object({
        id: z.string(),
        collectionId: z.string(),
      }),
      async ({ tx, ctx, args: { id, collectionId } }) => {
        const collection = await tx.run(zql.collections.where('id', collectionId).one());
        if (!collection) {
          throw new Error('Collection not found');
        }
        if (collection.ownerId !== ctx.userID) {
          const granterRole = await resolveCollectionPermissionRole(tx, collectionId, ctx.userID);
          if (granterRole !== CollectionRole.OWNER) {
            throw new Error('Permission revoke failed: only an owner can revoke permissions');
          }
        }

        await tx.mutate.collection_permissions.delete({ id });
      },
    ),
  },
  nonLinear: {
    /**
     * Client-side optimistic mutator for NON_LINEAR board stage transitions.
     * Immediately updates ticket.stageName so the UI reflects the move without waiting for
     * the server-side Zero mutator to execute (which handles ETA, form values, validation).
     */
    transition: defineMutator(
      z.object({
        ticketId: z.string(),
        toStageName: z.string(),
        // Caller-supplied timestamp. Zero replays this mutator on both the client (optimistic)
        // and the server (authoritative) with the same args, so passing `now` keeps the two runs
        // consistent instead of each calling Date.now() and diverging.
        now: z.number(),
        formValuesJson: z.string().optional(),
      }),
      async ({ tx, args: { ticketId, toStageName, now } }) => {
        const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
        if (!ticket || ticket.stageName === toStageName) return;
        // Mirror the server mutator: also advance statusV2 from the target stage's default so the
        // optimistic UI doesn't briefly show a stale status before the server run lands.
        const targetStage = await tx.run(
          zql.stages.where('boardId', ticket.boardId).where('name', toStageName).one(),
        );
        if (!targetStage) return;

        await tx.mutate.tickets.update({
          id: ticketId,
          stageName: toStageName,
          ...(targetStage.defaultTicketStatusV2 && {
            statusV2: targetStage.defaultTicketStatusV2,
          }),
          updatedAt: now,
        });
      },
    ),

    syncTransitions: defineMutator(
      z.object({
        boardId: z.string(),
        transitions: z.array(
          z.object({
            id: z.string(),
            fromStageId: z.string().nullable().optional(),
            toStageId: z.string(),
            formId: z.string().nullable().optional(),
            requiresApproval: z.boolean().optional(),
            bypassApprovalForAutomation: z.boolean().optional(),
            requestApprovalOnEntry: z.boolean().optional(),
            visitSlaMode: z.string().optional(),
            fixedEtaHours: z.number().nullable().optional(),
            onReenter: z.string().optional(),
            approvers: z
              .array(
                z.object({
                  id: z.string(),
                  approverId: z.string(),
                  approverType: z.string(),
                }),
              )
              .optional(),
          }),
        ),
        // Caller-supplied timestamp — see nonLinear.transition. Keeps client/server runs aligned.
        now: z.number(),
      }),
      async ({ tx, ctx, args: { boardId, transitions, now } }) => {

        // Optimistically replace local Zero cache: delete existing then insert new.
        const existing = await tx.run(zql.stage_transitions.where('boardId', boardId));
        for (const t of existing) {
          const approvers = await tx.run(
            zql.stage_approvers.where('transitionId', t.id),
          );
          for (const a of approvers) {
            await tx.mutate.stage_approvers.delete({ id: a.id });
          }
          await tx.mutate.stage_transitions.delete({ id: t.id });
        }

        for (const t of transitions) {
          await tx.mutate.stage_transitions.insert({
            workspaceId: ctx.workspaceId,
            id: t.id,
            boardId,
            ...(t.fromStageId != null && { fromStageId: t.fromStageId }),
            toStageId: t.toStageId,
            ...(t.formId != null && { formId: t.formId }),
            requiresApproval: t.requiresApproval ?? false,
            bypassApprovalForAutomation: t.bypassApprovalForAutomation ?? false,
            // Coerce off when the edge isn't approval-gated (mirrors the server).
            requestApprovalOnEntry: (t.requestApprovalOnEntry ?? false) && (t.requiresApproval ?? false),
            visitSlaMode: (t.visitSlaMode as VisitSlaMode) ?? VisitSlaMode.STAGE_DEFAULT,
            ...(t.fixedEtaHours != null && { fixedEtaHours: t.fixedEtaHours }),
            onReenter: (t.onReenter as ReenterMode) ?? ReenterMode.RESET,
            createdAt: now,
            updatedAt: now,
          });
          for (const a of t.approvers ?? []) {
            const approverType = (a.approverType as ApproverType) ?? ApproverType.USER;
            await tx.mutate.stage_approvers.insert({
              workspaceId: ctx.workspaceId,
              id: a.id,
              transitionId: t.id,
              // roleId holds the identifier for ROLE approvers, userId for USER approvers
              ...(approverType === ApproverType.ROLE
                ? { roleId: a.approverId }
                : { userId: a.approverId }),
              approverType,
              createdAt: now,
            });
          }
        }
      },
    ),
  },
  role: {
    create: defineMutator(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, description, timestamp } }) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          throw new Error('Role name cannot be empty');
        }
        if (!/^[A-Z]+(_[A-Z]+)*$/.test(trimmedName)) {
          throw new Error('Role name can only contain uppercase letters and single underscores between words (e.g. XYNE_PM, APPROVER)');
        }

        const existing = await tx.run(
          zql.roles
            .where('name', trimmedName)
            .where('workspaceId', ctx.workspaceId)
            .where('isActive', true)
            .one(),
        );
        if (existing) {
          throw new Error(`Role with name '${trimmedName}' already exists`);
        }

        await tx.mutate.roles.insert({
          id,
          workspaceId: ctx.workspaceId,
          name: trimmedName,
          description: description ?? null,
          createdBy: ctx.userID,
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: true,
        });
      },
    ),
    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, description, timestamp } }) => {
        if (name !== undefined) {
          const trimmedName = name.trim();
          if (!trimmedName) {
            throw new Error('Role name cannot be empty');
          }
          if (!/^[A-Z]+(_[A-Z]+)*$/.test(trimmedName)) {
            throw new Error('Role name can only contain uppercase letters and single underscores between words (e.g. XYNE_PM, APPROVER)');
          }
          if (trimmedName !== name) {
            const existing = await tx.run(
              zql.roles
                .where('name', trimmedName)
                .where('workspaceId', ctx.workspaceId)
                .where('isActive', true)
                .one(),
            );
            if (existing && existing.id !== id) {
              throw new Error(`Role with name '${trimmedName}' already exists`);
            }
          }
        }
        await tx.mutate.roles.update({
          id,
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description }),
          updatedAt: timestamp,
        });
      },
    ),
    addMembers: defineMutator(
      z.object({
        roleId: z.string(),
        userIds: z.array(z.string()),
        mappingIds: z.record(z.string(), z.string()),
        timestamp: z.number(),
      }),
      async ({ tx, ctx, args: { roleId, userIds, mappingIds, timestamp } }) => {
        if (userIds.length === 0) return;
        await Promise.all(
          userIds.map(userId => {
            const mappingId = mappingIds[userId];
            if (!mappingId) {
              throw new Error(`mappingId is required for user ${userId}`);
            }
            return tx.mutate.user_role_mappings.insert({
              workspaceId: ctx.workspaceId,
              id: mappingId,
              roleId,
              userId,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }),
        );
      },
    ),
    removeMembers: defineMutator(
      z.object({
        mappingIds: z.array(z.string()),
      }),
      async ({ tx, args: { mappingIds } }) => {
        if (mappingIds.length === 0) return;
        await Promise.all(
          mappingIds.map(mappingId => tx.mutate.user_role_mappings.delete({ id: mappingId })),
        );
      },
    ),
  },
});
