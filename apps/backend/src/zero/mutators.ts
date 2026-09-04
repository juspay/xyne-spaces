import { ReadonlyJSONValue, Transaction, defineMutator, defineMutators, ApplicationError } from '@rocicorp/zero';
import { AutomationStatus } from '../automations/types/status';
import {
  ChannelRole,
  ChannelType,
  ChannelVisibility,
  MessageType,
  CallType,
  CallStatus,
  CallVisibility,
  RecurringCallSeriesStatus,
  CallOrigin,
  InvitationResponse,
  MeetingStatus,
  NotificationLevel,
  Schema,
  ChannelScopeType,
  ChannelAddUserPolicy,
  ChannelSortOrder,
  ChannelFilterMode,
  ConversationParticipation,
  TicketStatusV2,
  MailboxState,
  TicketPriority,
  ActivityType,
  TicketReferenceRelation,
  EmailMergeMode,
  AutoDraftMode,
  CanvasVisibility,
  CanvasRole,
  CanvasCommentThreadStatus,
  BookmarkEntityType,
  UserPresenceStatus,
  FormContextType,
  FormEntityType,
  QueryVisualizationType,
  DocType,
  ActivityClassification,
  PRStatusEvent,
  UserResponsibility,
  AccessType,
  BoardType,
  ReenterMode,
  VisitSlaMode,
  ApproverType,
  TicketStageRequestStatus,
  COEStatus,
  RCAStatus,
  SEVERITY,
  AttachmentEntityType,
  AttachmentUploadStatus,
  AttributionConfidence,
  BaseTicketType,
  isReleaseTicket,
  getNudgeActionBehavior,
  LinkVisibility,
  CollectionRole,
  NudgeState,
  SurfaceAreaType,
  SurfaceLinkKind,
  RotationInterval,
  ReleaseEventType,
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
  DraftOrigin,
  assertCanvasDestinationAccess,
  getCanvasFolderNameConflictMessage,
  rethrowCanvasFolderNameConflict,
  resolveCanvasHierarchy,
  parseFieldOptions,
  serializeFieldOptions,
  VCSProviderType,
  ReleaseTrackingMode,
  parseRepliesMd,
  addReplyToData,
  serializeRepliesMd,
  type CallParticipantMetadata,
  SUMMARY_PROMPT_MAX_LENGTH,
  MAX_NOTIFICATION_KEYWORDS,
  MAX_NOTIFICATION_KEYWORD_LENGTH,
  normalizeNotificationKeywords,
  isDeskChannelType,
  deskTypeForChannelType,
  Platform,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  createSdlcLinkSchema,
  entityLinkContextSchema,
  updateSubTicketsMdFromZero,
  linkSubTicketConversationToParentFromZero,
} from '@xyne/shared';
import {
  normalizeThreadTypeName,
  parseAppliedTags,
  serializeAppliedTags,
  type AppliedTag,
} from '@xyne/shared';
import {
  getThreadTypeVocabulary,
  recordVocabularyCandidate,
} from '@/services/messageClassification/vocabulary';
import {
  MessageArtifactStatus,
  parseSlashCommandArtifactMessage,
  withSlashCommandArtifactClosed,
} from '@xyne/shared';
import { isBaselineCanvasType, sdlcTrackStatusSchema } from '@xyne/shared';
import {
  FLOW_STAGE_NAMES,
  FlowPlanSchema,
  deserializeFlowPlan,
  serializeFlowPlan,
  validateFlowPlan,
} from '@xyne/shared';
import { stringFromFormValue } from '@xyne/shared/zero';
import {
  ATTACHMENT_STILL_UPLOADING,
  isAttachmentUploaded,
  isAttachmentUploadInFlight,
} from '@xyne/shared/zero/mutators';
import {
  validateFieldBranches,
  validateUniqueFieldNames,
  assertFieldIsCurrentlyActive,
} from './formsMutatorHelpers';
import { v4 as uuidv4 } from 'uuid';
import { extractAllMentions } from '@/utils/mentionParser';
import { getStorageService } from '@/services/storage';
import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketReassignmentQueue } from '@/queues/ticketReassignmentQueue';
import { userAssignmentStateService } from '@/services/userAssignmentStateService';
import { notificationService } from '@/services/notificationService';
import { sendAddAndRemoveParticipantsSystemMessage, sendCallSystemMessage, updateCallSystemMessageOnEnd } from '@/zero/utils/systemMessagesUtils';
import { addChannelParticipant, removeChannelParticipant } from '@/zero/utils/channelParticipantUtils';
import { convert } from 'html-to-text';
import { typingService } from '@/services/typingService';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { processMeetLinksFromChatMessage } from '@/services/meetLinkService';
import { bookmarkReminderService } from '@/services/bookmarkReminderService';
import { versionReleaseMappingService } from '@/services/release/versionReleaseMappingService';
import { releaseDevTicketNotifyService } from '@/services/release/releaseDevTicketNotifyService';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

import { nudgeRegistry } from '@/nudges/registry';
import { initializeRotationForGroup } from '@/utils/rotationEngine';
import { livekitService } from '@/services/liveKitService';
import { evaluateAssignmentRule, AssignmentType } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import { calculateETADeadline, calculateWorkingDurationMs } from '@/utils/etaCalculation';
import { DEFAULT_ROLE_NAME_TO_ENUM } from '@/utils/roleFrameworkUtils';
import { grantPermissionsForRole, syncResourceAdminAccess, syncOrgResourceAdminAccess } from '@/services/permissionMatrix';
import {
  deleteDraftEntityAttachments,
  deleteDelayedMessageEntityAttachments,
} from '@/zero/utils/attachmentEntityCleanup';
import { deliverDraftServerMessage } from '@/services/messageDeliveryService';
import { organizationDomainService } from '@/services/organizationDomainService';
// Data-driven visit versioning + ETA reset/continue decision for NON_LINEAR transitions.
import { decideVisitVersion, foldFormRowsToValues } from '@/services/stageTransition/visitVersioning';
import {
  executionOrchestrator,
  unifiedDMService,
  unifiedBotUserService,
} from '@/bots/unified/index.js';

import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import { zql } from './queries';
import { hasGuestChannelAccess } from './acl/core/guest-access';
import { hasProjectAdminAccess } from './acl/core/admin-access';
import vespaClient from '@/vespa/client';
import { fileSchema } from '@/vespa/src/types';
import {
  onFlowPlanUpdated,
  onFlowStepBacklogged,
  onFlowTicketStatusChanged,
} from '@/services/flowCascadeService';
import { validateFlowDecisionFields } from '@/zero/utils/flowPlanValidation';
import { getEncryptionProvider } from '@/services/encryption';

function sortCallParticipantsForPreview<T extends {
  id: string;
  invitedAt: number;
  isExternal?: boolean;
  respondedAt?: number | null;
  joinedAt?: number | null;
}>(left: T, right: T): number {
  const leftJoined = left.joinedAt != null;
  const rightJoined = right.joinedAt != null;

  if (leftJoined !== rightJoined) {
    return leftJoined ? -1 : 1;
  }

  if (leftJoined && rightJoined) {
    return (
      (left.joinedAt ?? Number.POSITIVE_INFINITY) -
        (right.joinedAt ?? Number.POSITIVE_INFINITY) ||
      (left.respondedAt ?? Number.POSITIVE_INFINITY) -
        (right.respondedAt ?? Number.POSITIVE_INFINITY) ||
      left.invitedAt - right.invitedAt ||
      left.id.localeCompare(right.id)
    );
  }

  return (
    (left.respondedAt ?? Number.POSITIVE_INFINITY) -
      (right.respondedAt ?? Number.POSITIVE_INFINITY) ||
    left.invitedAt - right.invitedAt ||
    left.id.localeCompare(right.id)
  );
}

async function updateCallParticipantPreview(
  tx: Transaction<Schema>,
  callId: string,
): Promise<void> {
  const participants = await tx.run(zql.call_participants.where('callId', callId));
  const sortedParticipants = participants.sort(sortCallParticipantsForPreview);
  const participantPreviewUserIds = JSON.stringify(
    sortedParticipants
      .filter(participant => !participant.isExternal)
      .slice(0, 4)
      .map(participant => ({
        userId: participant.userId,
        hasJoined: participant.joinedAt !== null,
      })),
  );

  await tx.mutate.calls.update({
    id: callId,
    participantCount: participants.length,
    participantPreviewUserIds,
  });
}

const storageService = getStorageService();

const serializeCanvasCommentMentionedUserIds = (mentionedUserIds: string[]): string =>
  JSON.stringify([...new Set(mentionedUserIds)]);

async function getCanvasThreadCommentCount(
  tx: Transaction<Schema>,
  threadId: string,
): Promise<number> {
  const comments = await tx.run(zql.canvas_comments.where('threadId', threadId));
  return comments.filter(comment => comment.deletedAt == null).length;
}

const XYNE_USER_IDS = new Set([
  'cmhesdd48001ghu4rc6bcb9m0', 'ou9fi7t9tmq2eeiss09km8j3',
  'vj6bzzhi4g1n7q3ikj26f9w1', 'ufvy4nv2jpi55f692hf7kq5e',
  're36aie8d05pbmeganqgae1l', 'glaq4trh8gtu3i0edm0gwzgq',
]);

export type AuthData = {
  sub: string;
  email: string;
  name: string;
  displayName?: string | null;
  workspaceId: string;
  orgId: string;
  role: string;
  orgRole: string;
  memberId: string;
};

export type ParticipantOperationType = 'participants_added' | 'participants_removed' | 'participants_joined';

// Shared helper for NON_LINEAR stage transitions: compute the ETA deadline from the visit's
// SLA mode (NONE / FIXED_HOURS / STAGE_DEFAULT). Visit-versioning logic (the new-version vs
// reuse decision and reset/continue clock control) now lives in visitVersioning.ts and is
// invoked by decideVisitVersion at each transition entry point.
function computeStageEtaDeadline(
  now: number,
  slaMode: VisitSlaMode,
  fixedEtaHours: number | null | undefined,
  stageDefaultEta: number | null | undefined,
): number {
  if (slaMode === VisitSlaMode.NONE) {
    return now;
  }
  if (slaMode === VisitSlaMode.FIXED_HOURS && fixedEtaHours && fixedEtaHours > 0) {
    return calculateETADeadline(new Date(now), fixedEtaHours).getTime();
  }
  return stageDefaultEta && stageDefaultEta > 0
    ? calculateETADeadline(new Date(now), stageDefaultEta).getTime()
    : now;
}

// Authorize a stage-request review (APPROVE/REJECT): only listed approvers may act, which also
// prevents self-approval. NON_LINEAR boards keep approvers on the transition edge; other boards
// keep them on the target stage. A user is an approver if they are listed as a USER approver OR
// they hold any role listed as a ROLE approver (via user_role_mappings). Throws if not authorized.
async function assertCanReviewStageRequest(
  tx: Transaction<Schema>,
  ticket: { boardId: string; stageName: string | null },
  stageId: string,
  userId: string,
): Promise<void> {
  const board = await tx.run(zql.boards.where('id', ticket.boardId).one());
  let approverIds: string[] = [];
  let roleIds: string[] = [];

  if (board?.boardType === BoardType.NON_LINEAR) {
    const currentStage = ticket.stageName
      ? await tx.run(
          zql.stages.where('boardId', ticket.boardId).where('name', ticket.stageName).one(),
        )
      : null;
    const transition = currentStage
      ? ((await tx.run(
          zql.stage_transitions
            .where('boardId', ticket.boardId)
            .where('fromStageId', currentStage.id)
            .where('toStageId', stageId)
            .one(),
        )) ?? null)
      : null;
    if (transition) {
      const transitionApprovers = await tx.run(
        zql.stage_approvers.where('transitionId', transition.id),
      );
      for (const a of transitionApprovers) {
        const type = a.approverType ?? ApproverType.USER;
        if (type === ApproverType.ROLE) {
          if (a.roleId) roleIds.push(a.roleId);
        } else if (a.userId) {
          approverIds.push(a.userId);
        }
      }
    }
  } else {
    const stageApprovers = await tx.run(zql.stage_approvers.where('stageId', stageId));
    for (const a of stageApprovers) {
      const type = a.approverType ?? ApproverType.USER;
      if (type === ApproverType.ROLE) {
        if (a.roleId) roleIds.push(a.roleId);
      } else if (a.userId) {
        approverIds.push(a.userId);
      }
    }
  }

  if (approverIds.includes(userId)) return;

  if (roleIds.length > 0) {
    const membership = await tx.run(
      zql.user_role_mappings
        .where('userId', userId)
        .where('roleId', 'IN', roleIds)
        .one(),
    );
    if (membership) return;

    const groupMembership = await tx.run(
      zql.user_group_mappings
        .where('userId', userId)
        .where('roleId', 'IN', roleIds)
        .one(),
    );
    if (groupMembership) return;
  }

  throw new Error('You are not authorized to approve or reject this stage request');
}

const FORM_VALUE_CHANGED_MESSAGE =
  'Form value changed. Review the latest form changes before saving.';

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
 * Mirrors collectionAccess.ts's resolveCollectionAccess read-side resolution,
 * via Zero's tx instead of Prisma so mutators see the transaction's own
 * consistent view. Membership is resolved at check-time, not fanned out into
 * per-member rows — one group/channel-scoped row keeps covering every
 * current+future member.
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

async function resolveMentionParticipantUserIds(
  tx: Transaction<Schema>,
  mentionedUserIds: string[],
  mentionedGroupIds: string[],
): Promise<string[]> {
  const resolvedUserIds = new Set(mentionedUserIds);

  if (mentionedGroupIds.length > 0) {
    const mappings = await tx.run(
      zql.user_group_mappings.where(({ cmp }) => cmp('userGroupId', 'IN', mentionedGroupIds)),
    );

    for (const mapping of mappings) {
      resolvedUserIds.add(mapping.userId);
    }
  }

  return [...resolvedUserIds];
}

async function addMentionedConversationParticipants(
  tx: Transaction<Schema>,
  workspaceId: string,
  conversationId: string,
  channelId: string | null | undefined,
  userIds: string[],
  joinedAt: number,
  lastReplyAt?: number | null,
): Promise<void> {
  const existingParticipants = await tx.run(
    zql.conversation_participants.where('conversationId', conversationId),
  );
  const existingParticipantMap = new Map(
    existingParticipants.map(participant => [participant.userId, participant])
  );

  for (const userId of userIds) {
    const existing = existingParticipantMap.get(userId);

    if (existing) {
      const shouldUpdateParticipationType = existing.participationType === null;
      const shouldUpdateIsSubscribed = !existing.isSubscribed;
      
      if (shouldUpdateParticipationType || shouldUpdateIsSubscribed || lastReplyAt != null) {
        await tx.mutate.conversation_participants.update({
          id: existing.id,
          ...(shouldUpdateParticipationType ? { participationType: ConversationParticipation.MENTIONED } : {}),
          ...(shouldUpdateIsSubscribed ? { isSubscribed: true } : {}),
          ...(lastReplyAt != null ? { lastReplyAt } : {}),
        });
      }
    } else {
      await tx.mutate.conversation_participants.insert({
        id: uuidv4(),
        workspaceId,
        conversationId,
        userId,
        participationType: ConversationParticipation.MENTIONED,
        isSubscribed: true,
        joinedAt,
        channelId,
        ...(lastReplyAt != null ? { lastReplyAt } : {}),
      });
      existingParticipantMap.set(userId, { id: 'temp', userId } as any);
    }
  }
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
): Promise<boolean> {
  if (canvas.createdBy === userId) return true;

  const participant = await tx.run(
    zql.canvas_participants
      .where('canvasId', canvas.id)
      .where('role', 'IN', [CanvasRole.EDITOR, CanvasRole.OWNER])
      .where(({ or, cmp, exists: ex }: any) =>
        or(
          cmp('userId', userId),
          ex('userGroup', (ug: any) =>
            ug.whereExists('userGroupMappings', (m: any) => m.where('userId', userId)),
          ),
          ex('channel', (ch: any) =>
            ch.whereExists('participants', (cp: any) => cp.where('userId', userId)),
          ),
        ),
      )
      .one(),
  );

  return Boolean(participant);
}

async function assertCanvasCommentEditAccess(
  tx: Transaction<Schema>,
  canvasId: string,
  userId: string,
  workspaceId: string,
): Promise<{ id: string; createdBy: string }> {
  const canvas = await tx.run(
    zql.canvases.where('id', canvasId).where('workspaceId', workspaceId).one(),
  );
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
  workspaceId: string,
): Promise<void> {
  if (thread.createdBy === userId) {
    return;
  }

  await assertCanvasCommentEditAccess(tx, thread.canvasId, userId, workspaceId);
}

/**
 * True when the board has auto-assignment enabled — either the new
 * `metadata.assignmentRoles` (non-empty) or the legacy `fullRoleAssignment`
 * boolean. Drives whether `assignFullRoles` runs vs the single-assignee
 * `evaluateAssignmentRule` path.
 */
function hasBoardAutoAssignment(metadata: BoardMetadata | undefined): boolean {
  if (!metadata) return false;
  if (Array.isArray(metadata.assignmentRoles) && metadata.assignmentRoles.length > 0) {
    return true;
  }
  return metadata.fullRoleAssignment === true;
}

/**
 * Handles the full-role-assignment path when a board has auto-assignment enabled
 * (either `metadata.assignmentRoles` non-empty → role-driven, or
 * `metadata.fullRoleAssignment === true` → legacy 5-enum fallback).
 * Persists the per-role ticket_assignments, sets ticket.assignedTo to the
 * primary assignee, and optionally logs an activity + system message.
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
    workspaceId,
    channelId,
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
    workspaceId: string;
    channelId?: string | null;
  }
): Promise<void> {
  logger.info(`[AUTO-ASSIGN] Board ${boardId} has auto-assignment enabled for ticket ${ticketId}`);

  const fullResult = await ticketAssignmentService.assignFullRolesToTicket({
    ticketId,
    userGroupId,
    boardId,
    createdBy,
    projectId,
    channelId: channelId ?? undefined,
  });

  const primaryUserId = primaryUserIdOf(fullResult);
  if (primaryUserId) {
    await tx.mutate.tickets.update({
      id: ticketId,
      assignedTo: primaryUserId,
      updatedBy: createdBy,
      updatedAt: timestamp,
    });

    if (activityId) {
      await tx.mutate.ticket_activities.insert({
        id: activityId,
        workspaceId,
        ticketId,
        updatedBy: createdBy,
        timestamp,
        activityType: ActivityType.ASSIGNED_TO,
        value: { oldValue: oldAssignedTo, newValue: primaryUserId },
        channelId: channelId ?? null,
      });
    }

    if (messageId && conversationId) {
      const assignedUser = await tx.run(zql.users.where('id', primaryUserId).one());
      if (assignedUser) {
        await tx.mutate.messages.insert({
          messageId,
          conversationId,
          senderId: createdBy,
          workspaceId,
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
    case TicketReferenceRelation.MERGED_INTO:
      return 'Merged into';
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
  workspaceId: string,
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
            userName: user.displayName || user.name,
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
        workspaceId,
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
        workspaceId,
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
        workspaceId,
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
        workspaceId,
        conversationId: newConversationId,
        userId: senderId,
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
        joinedAt: now,
        channelId: channelId,
      });

      logger.info(`✅ [NON-PARTICIPANT] Created new conversation ${newConversationId} with system message`);
    }
  } catch (error) {
    logger.error('❌ [NON-PARTICIPANT] Error creating non-participant system messages:', error);
    // Don't throw - let the message creation succeed even if system message fails
  }
}

export function createMutators(
  authData: AuthData,
  asyncTasks: Array<() => Promise<void>>,
  awaitedPostCommitTasks: Array<() => Promise<void>>,
) {
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
          error: error,
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
          error: error,
        });
      }
    });
  };

  return defineMutators({
    notificationSettings: {
       setChannelNotificationLevel: defineMutator(
         z.object({
           channelId: z.string(),
           desktopNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).nullable().optional(),
           mobileNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).nullable().optional(),
           threadReplyNotificationsEnabled: z.boolean().nullable().optional(),
           channelWideMentionsEnabled: z.boolean().nullable().optional(),
           timestamp: z.number(),
         }),
         async ({ tx, args: { channelId, desktopNotificationLevel, mobileNotificationLevel, threadReplyNotificationsEnabled, channelWideMentionsEnabled, timestamp } }) => {
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

            await tx.mutate.channel_user_status.update({
             id: userStatus.id,
             // undefined = not provided (don't touch), null = reset to inherit global, value = explicit override
             ...(desktopNotificationLevel !== undefined && { desktopNotificationLevel: desktopNotificationLevel ?? null }),
             ...(mobileNotificationLevel !== undefined && { mobileNotificationLevel: mobileNotificationLevel ?? null }),
             ...(threadReplyNotificationsEnabled !== undefined && { threadReplyNotificationsEnabled: threadReplyNotificationsEnabled ?? null }),
             ...(channelWideMentionsEnabled !== undefined && { channelWideMentionsEnabled: channelWideMentionsEnabled ?? null }),
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
          const newParticipants = [{ userId: authData.sub, userName: authData.displayName || authData.name }];
          const messageSender: AuthData = { name: "system", sub: "system", email: "", workspaceId: "", orgId: "", role: "", memberId: "", orgRole: "" }
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
            id: uuidv4(),
            conversationId: conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: timestamp,
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


            addedUsers.push(user);
          }

          // send system message for added participants
          const newParticipants = addedUsers.map((currUser) => ({
            userId: currUser.id,
            userName: currUser.displayName || currUser.name,
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
                userName: targetUser.displayName || targetUser.name,
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
      updateShowTicketsTabTicketsInChat: defineMutator(
        z.object({
          channelId: z.string(),
          show: z.boolean(),
        }),
        async ({ tx, args: { channelId, show } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          if (channel.scopeType !== ChannelScopeType.DEFAULT) {
            throw new Error('Can only update this setting for default channels');
          }

          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());
          if (channel.createdBy !== authData.sub && (!participant || participant.role !== ChannelRole.ADMIN)) {
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
        async ({ tx, args: { channelId, prompt } }) => {
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          const participant = await tx.run(zql.channel_participants
            .where('channelId', channelId)
            .where('userId', authData.sub)
            .one());
          if (channel.createdBy !== authData.sub && (!participant || participant.role !== ChannelRole.ADMIN)) {
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

          const channelDrafts = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', authData.sub)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
          );

          // Find the channel-level draft (conversationId === null)
          const draft = channelDrafts.find(d => d.conversationId === null);

          if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
            await tx.mutate.draft_messages.delete({ id: draft.id });
          } else if (draftMessage.trim() !== '') {
            await tx.mutate.draft_messages.upsert({
              workspaceId: authData.workspaceId,
              id: draft?.id || draftMessageId,
              conversationId: null,
              channelId,
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              origin: DraftOrigin.user,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
              userName: user.displayName || user.name,
            },
          });

          // Add creator as conversation participant
          await tx.mutate.conversation_participants.insert({
            workspaceId: authData.workspaceId,
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: now,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
      moveToSection: defineMutator(
        z.object({
          channelId: z.string(),
          sectionId: z.string().nullable(),
          position: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, sectionId, position, timestamp } }) => {
          const userStatus = await tx.run(
            zql.channel_user_status
              .where('channelId', channelId)
              .where('userId', authData.sub)
              .where('isDeleted', false)
              .one(),
          );

          if (!userStatus) {
            throw new Error('Not a channel participant');
          }

          if (sectionId) {
            const section = await tx.run(
              zql.channel_sections
                .where('id', sectionId)
                .where('userId', authData.sub)
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
        async ({ tx, args: { id, name, emoji, position, timestamp } }) => {
          // Reject a name this user already uses in this workspace (case-insensitive).
          const siblings = await tx.run(
            zql.channel_sections
              .where('userId', authData.sub)
              .where('workspaceId', authData.workspaceId)
              .where('isDeleted', false),
          );
          const normalized = name.trim().toLowerCase();
          if (siblings.some(s => s.name.trim().toLowerCase() === normalized)) {
            throw new Error('A section with this name already exists');
          }
          await tx.mutate.channel_sections.insert({
            id,
            userId: authData.sub,
            workspaceId: authData.workspaceId,
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
      // One mutator for rename/emoji, collapse state, reorder, and sort order (all are field updates).
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
          args: { id, name, emoji, isCollapsed, position, sortOrder, filterMode, timestamp },
        }) => {
          const section = await tx.run(
            zql.channel_sections.where('id', id).where('userId', authData.sub).where('isDeleted', false).one(),
          );
          if (!section) {
            throw new Error('Section not found');
          }
          if (name !== undefined) {
            // Reject renaming to a name another of this user's sections already uses.
            const normalized = name.trim().toLowerCase();
            const siblings = await tx.run(
              zql.channel_sections
                .where('userId', authData.sub)
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
        async ({ tx, args: { id, timestamp } }) => {
          const section = await tx.run(
            zql.channel_sections.where('id', id).where('userId', authData.sub).where('isDeleted', false).one(),
          );
          if (!section) {
            throw new Error('Section not found');
          }

          // Detach channels in this section so they fall back to the default group.
          const assigned = await tx.run(
            zql.channel_user_status.where('userId', authData.sub).where('sectionId', id),
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
    conversations: {
      send: defineMutator(
        z.object({
          channelId: z.string(),
          content: z.string(),
          type: z.nativeEnum(MessageType),
          conversationId: z.string(),
          messageId: z.string(),
          timestamp: z.number(),
          attachmentIds: z.array(z.string()).optional(),
          entityLinkContext: entityLinkContextSchema.optional(),
        }),
        async ({
          tx,
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

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          const now = timestamp;

          const participant = await tx.run(zql.channel_participants
            .where('userId', authData.sub)
            .where('channelId', channelId)
            .one());
          const channel = await tx.run(zql.channels.where('id', channelId).related('project').one());

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

          if (entityLinkContext) {
            const existingDiscussion = await tx.run(
              zql.sdlc_entity_links
                .where('channelId', channelId)
                .where('targetType', 'CONVERSATION')
                .where('targetId', conversationId)
                .where('relationType', 'DISCUSSION'),
            );
            if (existingDiscussion.length > 0) {
              throw new Error('Conversation already has an SDLC discussion owner');
            }
            if (entityLinkContext.sourceType === 'TRACK') {
              // A track has no scope column: its CHANNEL -> TRACK edge is the check.
              const trackEdge = await tx.run(
                zql.sdlc_entity_links
                  .where('channelId', channelId)
                  .where('targetType', 'TRACK')
                  .where('targetId', entityLinkContext.sourceId)
                  .where('relationType', SDLC_TRACK_MEMBERSHIP_RELATION)
                  .one(),
              );
              if (!trackEdge) {
                throw new Error('Invalid SDLC discussion owner');
              }
            } else {
              const [canvas, artifact] = await Promise.all([
                tx.run(zql.canvases.where('id', entityLinkContext.sourceId).one()),
                tx.run(zql.sdlc_artifacts.where('artifactId', entityLinkContext.sourceId).one()),
              ]);
              if (
                !canvas ||
                canvas.workspaceId !== authData.workspaceId ||
                canvas.channelId !== channelId ||
                !artifact
              ) {
                throw new Error('Invalid SDLC discussion owner');
              }
            }
          }

          await tx.mutate.conversations.insert({
            conversationId,
            channelId,
            workspaceId: authData.workspaceId,
            createdBy: authData.sub,
            initialMessageId: messageId,
            lastActivityAt: now,
            replyCount: 0,
            pinned: false,
            metadata: undefined,
            createdAt: now,
          });

          if (entityLinkContext) {
            await tx.mutate.sdlc_entity_links.insert({
              id: entityLinkContext.linkId,
              workspaceId: authData.workspaceId,
              channelId,
              sourceType: entityLinkContext.sourceType,
              sourceId: entityLinkContext.sourceId,
              targetType: 'CONVERSATION',
              targetId: conversationId,
              relationType: 'DISCUSSION',
              createdBy: authData.sub,
              createdAt: now,
            });
          }

          const message = {
            messageId,
            conversationId,
            workspaceId: authData.workspaceId,
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

          if (attachmentIds !== undefined) {
            // Explicit list from a pending-message-aware caller: transfer only
            // those ids, don't touch the draft row (client's clearContent owns it).
            if (attachmentIds.length > 0) {
              let attachedCount = 0;
              for (const attachmentId of attachmentIds) {
                const attachment = await tx.run(
                  zql.message_attachments.where('id', attachmentId).one(),
                );
                if (!attachment) continue;
                if (
                  attachment.entityType === AttachmentEntityType.CHAT &&
                  attachment.entityId === messageId
                ) {
                  attachedCount++;
                  continue;
                }
                if (!isAttachmentUploaded(attachment)) {
                  if (isAttachmentUploadInFlight(attachment)) {
                    throw new ApplicationError(ATTACHMENT_STILL_UPLOADING, {
                      details: { attachmentId },
                    });
                  }
                  continue;
                }
                await tx.mutate.message_attachments.update({
                  id: attachmentId,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId,
                });
                attachedCount++;
              }
              message.hasAttachment = attachedCount > 0;
            }
          } else {
            // Legacy path: scan the current draft and transfer everything.
            const channelDrafts = await tx.run(zql.draft_messages
              .where('channelId', channelId)
              .where('userId', authData.sub)
            .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))));

            const draft = channelDrafts.find(d => d.conversationId === null);

            if (draft) {
              const draftAttachments = await tx.run(zql.message_attachments
                .where('entityId', draft.id)
                .where('entityType', AttachmentEntityType.DRAFT));

              let attachedCount = 0;
              for (const attachment of draftAttachments) {
                if (!isAttachmentUploaded(attachment)) {
                  if (isAttachmentUploadInFlight(attachment)) {
                    throw new ApplicationError(ATTACHMENT_STILL_UPLOADING, {
                      details: { attachmentId: attachment.id },
                    });
                  }
                  continue;
                }
                await tx.mutate.message_attachments.update({
                  id: attachment.id,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId: conversationId,
                });
                attachedCount++;
              }

              await tx.mutate.draft_messages.delete({ id: draft.id });

              message.hasAttachment = attachedCount > 0;
            }
          }

          await tx.mutate.messages.insert(message);
          logger.info(`💬 [MUTATOR-CREATE-MESSAGE] Message ${message.messageId} created, type: ${type}`);

          if (type === MessageType.USER) {
            const userProfile = await tx.run(zql.user_profiles.where('userId', authData.sub).one());
            asyncTasks.push(async () => {
              try {
                logger.info('analytics_event', {
                  event: 'message_sent',
                  timestamp: new Date(timestamp).toISOString(),
                  userId: authData.sub,
                  userName: authData.name,
                  userTeam: userProfile?.team ?? null,
                  isXyne: (userProfile?.team?.includes('Xyne') || XYNE_USER_IDS.has(authData.sub)),
                  channelName: channel.name,
                  channelScopeType: channel.scopeType,
                  channelProjectName: channel.project?.name ?? null,
                  isMigrated: channel.isMigrated ?? false,
                });
              } catch (error) {
                logger.error('❌ [ANALYTICS] Failed to log message_sent:', error);
              }
            });
            if (channel.scopeType === ChannelScopeType.DEFAULT) {
              asyncTasks.push(async () => {
                try {
                  await processMeetLinksFromChatMessage(
                    message.content,
                    authData.workspaceId,
                    conversationId,
                    message.messageId,
                  );
                } catch (error) {
                  logger.error(`[MUTATOR-CREATE-MESSAGE] Failed to process meet links for message ${message.messageId}:`, error);
                }
              });
            }
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
            workspaceId: authData.workspaceId,
            id: uuidv4(),
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: now,
            channelId: channelId,
          });

          // Add mentioned users as MENTIONED participants within Zero transaction
          const mentions = extractAllMentions(content);
          logger.info('[MENTION]:', mentions.userIds.length, mentions.groupIds.length, messageId);
          const mentionParticipantUserIds = await resolveMentionParticipantUserIds(
            tx,
            mentions.userIds,
            mentions.groupIds,
          );
          const mentionRecipients = mentionParticipantUserIds.filter(userId => userId !== authData.sub);
          await addMentionedConversationParticipants(
            tx,
            authData.workspaceId,
            conversationId,
            channelId,
            mentionRecipients,
            now,
          );

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
            authData.workspaceId,
          );


          // Handle bot DM messages - trigger bot execution if this is a DM with a bot
          // Runs async after mutator returns to avoid blocking the response
          asyncTasks.push(async () => {
            if (channel.scopeType !== ChannelScopeType.DM || !user) return;
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
                      userName: user.displayName || user.name,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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

          // Copy attachments from the original message, preserving their display order.
          // Sort the source rows by the same comparator the UI uses, then stamp a
          // strictly increasing explicit position (and createdAt offset) on each clone
          // so the forwarded copy renders in the same order the sender saw.
          const orderedSourceAttachments = [...attachmentsArray]
            .filter((a): a is MessageAttachment => !!a)
            .sort(
              (a, b) =>
                ((a.position ?? Number.MAX_SAFE_INTEGER) -
                  (b.position ?? Number.MAX_SAFE_INTEGER)) ||
                (a.createdAt as number) - (b.createdAt as number) ||
                a.id.localeCompare(b.id),
            );
          for (const [index, attachment] of orderedSourceAttachments.entries()) {
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
              createdAt: now + index,
              position: index,
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
                  workspaceId: authData.workspaceId,
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
                      createdAt: now + j,
                      position: j,
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
            workspaceId: authData.workspaceId,
            id: conversationParticipantId,
            conversationId,
            userId: authData.sub,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: now,
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
            workspaceId: authData.workspaceId,
            id: participantId,
            conversationId,
            userId: authData.sub,
            participationType: null as any, // Manual subscription (null = not AUTHOR/MENTIONED)
            isSubscribed: true,
            joinedAt: timestamp,
            channelId: conversation.channelId,
            ...(trueLastReplyAt ? { lastReplyAt: trueLastReplyAt } : {}),
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
          childConversationId: z.string().optional(),
          attachmentIds: z.array(z.string()).optional(),
        }),
        async ({ tx, args: { conversationId, content, type, showInChannel = false, timestamp, messageId, childConversationId, attachmentIds } }) => {
          if (content === '') {
            throw new Error('Message content or files are required to start a conversation');
          }

          const conversation = await tx.run(zql.conversations
            .where('conversationId', conversationId)
            .one());
          if (!conversation) {
            throw new Error("Message doesn't belong to a conversation");
          }
          const [channel, participant, channelDrafts] = await Promise.all([
            tx.run(zql.channels.where('id', conversation.channelId).related('project').one()),
            tx.run(zql.channel_participants
              .where('userId', authData.sub)
              .where('channelId', conversation.channelId)
              .one()),
            tx.run(zql.draft_messages
              .where('channelId', conversation.channelId)
              .where('userId', authData.sub)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))),
          ]);
          if (!channel) {
            throw new Error("Channel doesn't exists");
          }

          if (participant === undefined && channel.visibility == ChannelVisibility.PRIVATE) {
            throw new Error('You need to be a participant for adding a conversations');
          }

          // One open artifact per thread. A thread is a single incident's workspace,
          // so a second /sev2 inside it would fork the responders across two cards
          // and two calls. The channel is unrestricted — that is where a genuinely
          // separate incident belongs.
          const outgoingArtifact = parseSlashCommandArtifactMessage(content);
          if (outgoingArtifact) {
            const openArtifact = await tx.run(zql.message_artifacts
              // channelId first: it is the only selective index on this table.
              .where('channelId', conversation.channelId)
              .where('conversationId', conversationId)
              .where('command', outgoingArtifact.definition.command)
              .where('status', MessageArtifactStatus.ACTIVE)
              .one());
            if (openArtifact) {
              throw new Error(`A ${outgoingArtifact.definition.badge} is already open in this thread`);
            }
          }

          const message = {
            messageId,
            conversationId,
            workspaceId: authData.workspaceId,
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

          if (attachmentIds !== undefined) {
            // Explicit list from a pending-message-aware caller: transfer only
            // those ids, don't touch the draft row (client's clearContent owns it).
            if (attachmentIds.length > 0) {
              let attachedCount = 0;
              for (const attachmentId of attachmentIds) {
                const attachment = await tx.run(
                  zql.message_attachments.where('id', attachmentId).one(),
                );
                if (!attachment) continue;
                if (
                  attachment.entityType === AttachmentEntityType.CHAT &&
                  attachment.entityId === messageId
                ) {
                  attachedCount++;
                  continue;
                }
                if (!isAttachmentUploaded(attachment)) {
                  if (isAttachmentUploadInFlight(attachment)) {
                    throw new ApplicationError(ATTACHMENT_STILL_UPLOADING, {
                      details: { attachmentId },
                    });
                  }
                  continue;
                }
                await tx.mutate.message_attachments.update({
                  id: attachmentId,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId,
                });
                attachedCount++;
              }
              message.hasAttachment = attachedCount > 0;
            }
          } else {
            const draft = channelDrafts.find(d => d.conversationId === conversationId);

            if (draft) {
              const draftAttachments = await tx.run(zql.message_attachments
                .where('entityId', draft.id)
                .where('entityType', AttachmentEntityType.DRAFT));

              let attachedCount = 0;
              for (const attachment of draftAttachments) {
                if (!isAttachmentUploaded(attachment)) {
                  if (isAttachmentUploadInFlight(attachment)) {
                    throw new ApplicationError(ATTACHMENT_STILL_UPLOADING, {
                      details: { attachmentId: attachment.id },
                    });
                  }
                  continue;
                }
                await tx.mutate.message_attachments.update({
                  id: attachment.id,
                  entityId: messageId,
                  entityType: AttachmentEntityType.CHAT,
                  conversationId: conversationId,
                });
                attachedCount++;
              }

              await tx.mutate.draft_messages.delete({ id: draft.id });

              message.hasAttachment = attachedCount > 0;
            }
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
            asyncTasks.push(async () => {
              try {
                const userProfile = await db.userProfile.findFirst({
                  where: { userId: authData.sub },
                  select: { team: true },
                });
                logger.info('analytics_event', {
                  event: 'message_sent',
                  timestamp: new Date(timestamp).toISOString(),
                  userId: authData.sub,
                  userName: authData.name,
                  userTeam: userProfile?.team ?? null,
                  isXyne: (userProfile?.team?.includes('Xyne') || XYNE_USER_IDS.has(authData.sub)),
                  channelName: channel.name,
                  channelScopeType: channel.scopeType,
                  channelProjectName: channel.project?.name ?? null,
                  isMigrated: channel.isMigrated ?? false,
                });
              } catch (error) {
                logger.error('❌ [ANALYTICS] Failed to log message_sent (reply):', error);
              }
            });
            if (channel.scopeType === ChannelScopeType.DEFAULT) {
              asyncTasks.push(async () => {
                try {
                  await processMeetLinksFromChatMessage(
                    message.content,
                    authData.workspaceId,
                    conversationId,
                    message.messageId,
                  );
                } catch (error) {
                  logger.error(`❌ [MUTATOR-CREATE-REPLY] Failed to process meet links for reply message ${message.messageId}:`, error);
                }
              });
            }
          }

          const repliesData = parseRepliesMd(conversation.replies_md);
          const updatedRepliesData = addReplyToData(repliesData, authData.sub);
          const updatedRepliesMd = serializeRepliesMd(updatedRepliesData);

          await tx.mutate.conversations.update({
            conversationId,
            replyCount: conversation.replyCount + 1,
            lastActivityAt: timestamp,
            ...(updatedRepliesMd !== conversation.replies_md && { replies_md: updatedRepliesMd }),
          });

          if (showInChannel) {
            if (!childConversationId) {
              throw new Error('Child conversation ID is required when showInChannel is true');
            }

            await tx.mutate.conversations.insert({
              conversationId: childConversationId,
              channelId: conversation.channelId,
              workspaceId: authData.workspaceId,
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
            // Upgrade to AUTHOR and ensure subscribed if they send a message, and ALWAYS update lastReplyAt for immediate UI bump
            const needsUpgrade = existingParticipant.participationType !== ConversationParticipation.AUTHOR;
            const needsResubscribe = !existingParticipant.isSubscribed;
            const needsUpdate = needsUpgrade || needsResubscribe || existingParticipant.lastReplyAt !== timestamp;
            
            if (needsUpdate) {
              await tx.mutate.conversation_participants.update({
                id: existingParticipant.id,
                ...(needsUpgrade ? { participationType: ConversationParticipation.AUTHOR } : {}),
                ...(needsResubscribe ? { isSubscribed: true } : {}),
                lastReplyAt: timestamp,
              });
            }
            // lastReadAt already updated before messages.insert — no duplicate write needed
          } else {
            // Add as new AUTHOR participant (lastReadAt set here since the early block
            // only updates existing participants)
            await tx.mutate.conversation_participants.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              conversationId,
              userId: authData.sub,
              participationType: ConversationParticipation.AUTHOR,
              isSubscribed: true,
              joinedAt: timestamp,
              channelId: conversation.channelId,
              lastReplyAt: timestamp,
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
                  workspaceId: authData.workspaceId,
                  id: uuidv4(),
                  conversationId,
                  userId: dmParticipant.userId,
                  participationType: ConversationParticipation.MENTIONED,
                  isSubscribed: true,
                  joinedAt: timestamp,
                  channelId: conversation.channelId,
                  lastReplyAt: timestamp,
                });
              }
            }
          }

          const user = await tx.run(zql.users.where('id', authData.sub).one());

          // Add mentioned users as MENTIONED participants within Zero transaction
          const mentions = extractAllMentions(content);
          const mentionParticipantUserIds = await resolveMentionParticipantUserIds(
            tx,
            mentions.userIds,
            mentions.groupIds,
          );
          await addMentionedConversationParticipants(
            tx,
            authData.workspaceId,
            conversationId,
            conversation.channelId,
            mentionParticipantUserIds,
            timestamp,
            timestamp,
          );

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
            authData.workspaceId,
          );


          // Handle bot DM replies - trigger bot execution if this is a DM with a bot
          // Runs async after mutator returns to avoid blocking the response
          asyncTasks.push(async () => {
            if (channel.scopeType !== ChannelScopeType.DM || !user) return;
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
                      userName: user.displayName || user.name,
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
          let newlyMentionedGroups: string[] = [];
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
            newlyMentionedGroups = newMentions.groupIds.filter(
              groupId => !oldMentions.groupIds.includes(groupId)
            );

            // Find users that are no longer mentioned (in old content but not in new)
            noLongerMentionedUsers = oldMentions.userIds.filter(
              userId => !newMentions.userIds.includes(userId)
            );
          }

          const now = Date.now();

          // Add newly mentioned users as MENTIONED participants
          // Look up conversation to get channelId for denormalized field
          const mentionConversation = (newlyMentionedUsers.length > 0 || newlyMentionedGroups.length > 0)
            ? await tx.run(zql.conversations.where('conversationId', message.conversationId).one())
            : null;
          if (newlyMentionedUsers.length > 0 || newlyMentionedGroups.length > 0) {
            const mentionParticipantUserIds = await resolveMentionParticipantUserIds(
              tx,
              newlyMentionedUsers,
              newlyMentionedGroups,
            );

            let trueLastReplyAt: number | undefined = undefined;
            if (mentionConversation && mentionConversation.replyCount > 0) {
              const latestReply = await tx.run(
                zql.messages
                  .where('conversationId', message.conversationId)
                  .where('messageId', '!=', mentionConversation.initialMessageId)
                  .orderBy('createdAt', 'desc')
                  .limit(1)
              );
              if (latestReply[0]) {
                trueLastReplyAt = latestReply[0].createdAt;
              }
            }

            await addMentionedConversationParticipants(
              tx,
              authData.workspaceId,
              message.conversationId,
              mentionConversation?.channelId,
              mentionParticipantUserIds,
              now,
              trueLastReplyAt,
            );
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
              workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
                countId: countIdToUse,
                count: 1,
                messageId,
                emojiName: decodedEmoji,
                updatedAt: timestamp,
              });
            }

            asyncTasks.push(async () => {
              try {
                logger.info('analytics_event', {
                  event: 'reaction_added',
                  timestamp: new Date(timestamp).toISOString(),
                  userId: authData.sub,
                });
              } catch (error) {
                logger.error('❌ [ANALYTICS] Failed to log reaction_added:', error);
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
        async ({ tx, args: { messageId, timestamp } }) => {
          const message = await tx.run(zql.messages.where('messageId', messageId).one());
          if (!message) {
            throw new Error('Message not available');
          }
          if (message.senderId !== authData.sub) {
            throw new Error('Only the author can close this incident');
          }

          const artifact = await tx.run(zql.message_artifacts.where('messageId', messageId).one());
          if (artifact && artifact.status !== MessageArtifactStatus.ACTIVE) {
            throw new Error('This incident is already closed');
          }

          const content = withSlashCommandArtifactClosed(message.content, {
            closedAt: timestamp,
            closedBy: authData.sub,
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
            workspaceId: authData.workspaceId,
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
                validUsers.push({ userId, userName: user.displayName || user.name });
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
              await deleteConversationWithParticipants(tx, systemMessageConversation.conversationId);
            }
          }

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

          // Clean up AUTHOR participant if this was their only message.
          // Exception: never remove the conversation creator — they are permanently
          // tied to the thread they started, even if they delete their initial message.
          const senderId = message.senderId;
          const isConversationCreator = senderId === conversation.createdBy;

          if (!isConversationCreator) {
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
              // Delete ghost root FIRST, before the conversation.
              if (isInitialMessageDeleted && otherMessages[0]) {
                await tx.mutate.messages.delete({ messageId: otherMessages[0].messageId });
              }
              await deleteConversationWithParticipants(tx, conversation.conversationId);
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
            workspaceId: authData.workspaceId,
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
            labels: [],
            markedItems: [],
            recordingParticipants: '[]',
            xyneManaged: false,
            visibility: CallVisibility.PRIVATE,
            metadata: {
              systemMessageId,
              conversationId,
            },
          });

          // Creator joins immediately
          await tx.mutate.call_participants.insert({
            workspaceId: authData.workspaceId,
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
                  workspaceId: authData.workspaceId,
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
                  workspaceId: authData.workspaceId,
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
              workspaceId: authData.workspaceId,
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
            if (scheduleStatus === CallStatus.ENDED) {
              await updateCallParticipantPreview(tx, call.id);
            }

            // Update system message with final call summary
            const callMetadata = call.metadata as { systemMessageId?: string } | null;
            if (callMetadata?.systemMessageId) {
              // Get participants who accepted (joined the call)
              const joinedParticipants = allParticipants
                .filter(p => p.joinedAt !== null)
                .map(p => ({
                  userId: p.userId,
                  userName: p.user?.displayName || p.user?.name || 'Unknown User',
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
          }
        },
      ),
      // Persist the notes-canvas id onto the call as soon as the user creates the
      // canvas mid-recording. The link is posted to the thread later by the automatic summary
      // pipeline (transcriptService.postSummaryAsReply), so it survives any stop path.
      linkNotesCanvas: defineMutator(
        z.object({ callId: z.string(), notesCanvasId: z.string().min(1) }),
        async ({ tx, args: { callId, notesCanvasId } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());
          if (!call) {
            throw new Error('Call not found');
          }
          if (call.createdByUserId !== authData.sub) {
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
      // ends (noteTakerTranscriptService.finalizeCallUpdates preserves these), so
      // entries are told apart by `type`. `timestampSeconds` is measured from the first
      // transcript line, matching how transcriptService.formatTranscript timestamps the
      // transcript itself.
      markMoment: defineMutator(
        z.object({
          callId: z.string(),
          type: z.literal('moment'),
          timestampSeconds: z.number().nonnegative(),
          text: z.string(),
        }),
        async ({ tx, args: { callId, type, timestampSeconds, text } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());
          if (!call) {
            throw new Error('Call not found');
          }
          if (call.createdByUserId !== authData.sub) {
            throw new Error('Access denied');
          }

          // tx.mutate can't write markedItems: Zero models the jsonb[] column as plain
          // json, so Postgres rejects the value. Appended after commit instead, as a
          // single statement since concurrent marks and the summary pipeline share the
          // column. See callRepository.appendMarkedItem.
          asyncTasks.push(async () => {
            try {
              const appended = await repositories.calls.appendMarkedItem(callId, {
                type,
                text,
                timestampSeconds,
              });
              if (!appended) {
                logger.warn('mark_moment_not_persisted', { callId, reason: 'call_not_found' });
              }
            } catch (error) {
              // allSettled swallows this, and the client's `.server` promise already
              // resolved success — a log line is the only trace the moment was lost.
              logger.error('mark_moment_append_failed', { callId, timestampSeconds, error });
            }
          });
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
                workspaceId: authData.workspaceId,
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
            try {
              await livekitService.sendParticipantsChanged(callId);
            } catch (error) {
              logger.error('livekit_participants_changed_failed', { callId, error });
            }
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
          await tx.mutate.call_participants.update({
            id: participantId,
            response: InvitationResponse.DECLINED,
            respondedAt: Date.now(),
          });
        }
      ),
      requestToJoin: defineMutator(
        z.object({
          callId: z.string(),
          participantId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { callId, participantId, timestamp } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());
          if (!call || call.status !== CallStatus.ACTIVE) {
            throw new Error('Call not found or not active');
          }

          const activeRequests = await tx.run(
            zql.call_participants
              .where('userId', authData.sub)
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
            zql.call_participants.where('callId', call.id).where('userId', authData.sub).one(),
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
              invitedBy: authData.sub,
              invitedAt: timestamp,
              respondedAt: null,
              joinedAt: null,
              leftAt: null,
            });
          } else {
            // Create new request
            await tx.mutate.call_participants.insert({
              workspaceId: authData.workspaceId,
              id: participantId,
              callId: call.id,
              userId: authData.sub,
              invitedBy: authData.sub,
              invitedAt: timestamp,
              response: InvitationResponse.REQUESTED,
              meetingStatus: MeetingStatus.PENDING,
              respondedAt: null,
              joinedAt: null,
              leftAt: null,
              isExternal: false,
            });
          }
        }
      ),
      cancelJoinRequest: defineMutator(
        z.object({
          callId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { callId, timestamp } }) => {
          const call = await tx.run(zql.calls.where('externalId', callId).one());
          if (!call) {
            throw new Error('Call not found');
          }

          const participant = await tx.run(
            zql.call_participants.where('callId', call.id).where('userId', authData.sub).one(),
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
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
              .one(),
          );

          if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
            await tx.mutate.draft_messages.delete({ id: draft.id });
          } else if (draftMessage.trim() !== '') {
            await tx.mutate.draft_messages.upsert({
              workspaceId: authData.workspaceId,
              id: draft?.id || draftMessageId,
              conversationId,
              channelId,
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              origin: DraftOrigin.user,
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
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
              .one(),
          );

          if (draft && draftMessage.trim() === '' && !draft.hasAttachment) {
            await tx.mutate.draft_messages.delete({ id: draft.id });
          } else if (draftMessage.trim() !== '') {
            await tx.mutate.draft_messages.upsert({
              workspaceId: authData.workspaceId,
              id: draft?.id || draftMessageId,
              conversationId,
              channelId,
              userId: authData.sub,
              content: draftMessage,
              hasAttachment: draft?.hasAttachment || false,
              origin: DraftOrigin.user,
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

            await tx.mutate.conversation_participants.insert({
              workspaceId: authData.workspaceId,
              id: participantId,
              conversationId,
              userId: authData.sub,
              joinedAt: timestamp,
              channelId: channelId,
              lastReadAt: timestamp,
              isSubscribed: false,
              participationType: null,
              ...(trueLastReplyAt ? { lastReplyAt: trueLastReplyAt } : {}),
            });
          } else {
            await tx.mutate.conversation_participants.update({
              id: participant.id,
              ...(participant.channelId !== channelId ? { channelId } : {}),
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
          const query = zql.activities
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

            const message = await tx.run(zql.messages.where('messageId', activity.messageId).one());
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

            if (existingParticipant) {
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

            const message = await tx.run(zql.messages.where('messageId', activity.messageId).one());
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

          const latestReply = await tx.run(
            zql.messages
              .where('conversationId', conversationId)
              .where('messageId', '!=', conversation.initialMessageId)
              .orderBy('createdAt', 'desc')
              .limit(1)
          );
          const trueLastReplyAt = latestReply[0] ? latestReply[0].createdAt : null;

          // Upsert conversation_participants state so marking unread also subscribes the user.
          const existingParticipant = await tx.run(
            zql.conversation_participants
              .where('conversationId', conversationId)
              .where('userId', authData.sub)
              .one(),
          );

          if (!existingParticipant) {
            await tx.mutate.conversation_participants.insert({
              workspaceId: authData.workspaceId,
              id: participantId,
              conversationId,
              userId: authData.sub,
              joinedAt: timestamp,
              channelId: conversation.channelId,
              lastReadAt: newLastReadAt,
              lastReplyAt: trueLastReplyAt,
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
          ticketType: z.string().optional(),
          userGroupId: z.string().nullable().optional(),
          eta: z.number().optional(),
          boardId: z.string().optional(),
          metadata: z.any().optional(),
          isArchived: z.boolean().optional(),
          kanbanPosition: z.string().nullable().optional(),
          updatedAt: z.number(),
        }),
        async ({ tx, args: params }) => {
          const ticket = await tx.run(zql.tickets.where('id', params.id).one());
          if (!ticket) throw new Error('Ticket not found');
          const currentBoard = await tx.run(zql.boards.where('id', ticket.boardId).one());
          if (
            currentBoard?.boardType === BoardType.FLOW &&
            (params.stageName !== undefined || params.statusV2 !== undefined)
          ) {
            if (!params.stageName) {
              throw new Error('Flow ticket status must change through a stage transition');
            }
            const [currentStage, targetStage, transitions] = await Promise.all([
              tx.run(
                zql.stages.where('boardId', ticket.boardId).where('name', ticket.stageName).one(),
              ),
              tx.run(
                zql.stages.where('boardId', ticket.boardId).where('name', params.stageName).one(),
              ),
              tx.run(zql.stage_transitions.where('boardId', ticket.boardId)),
            ]);
            if (!currentStage || !targetStage) {
              throw new Error('Flow ticket stage not found');
            }
            const allowed = transitions.some(
              transition =>
                transition.fromStageId === currentStage.id &&
                transition.toStageId === targetStage.id,
            );
            if (!allowed) throw new Error('This Flow stage transition is not allowed');
            if (
              params.statusV2 !== undefined &&
              params.statusV2 !== targetStage.defaultTicketStatusV2
            ) {
              throw new Error('Flow ticket status must match its target stage');
            }
            const flow = (ticket.metadata as { flow?: { planNodeId?: string; rootTicketId?: string } } | null)?.flow;
            if (params.stageName === FLOW_STAGE_NAMES.BACKLOG && !flow?.planNodeId) {
              throw new Error('The main Flow ticket cannot be moved to backlog');
            }
            if (
              params.stageName === FLOW_STAGE_NAMES.BACKLOG &&
              flow?.planNodeId &&
              currentBoard.flowPlan
            ) {
              const plan = deserializeFlowPlan(currentBoard.flowPlan);
              if (plan.decisions?.some(decision => decision.parentNodeId === flow.planNodeId)) {
                throw new Error(
                  'Conditional form steps cannot be moved to backlog. Submit the form to choose a path.',
                );
              }
            }
            if (flow?.planNodeId && flow.rootTicketId) {
              const root = await tx.run(zql.tickets.where('id', flow.rootTicketId).one());
              if (root?.statusV2 === TicketStatusV2.PAUSED) {
                throw new Error('Flow run is paused');
              }
            }
          }

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

          if ((isAssigneeChanging || isUserGroupChanging || isEtaChanging || isBoardChanging) && ticket.userGroupId) {
            // Get board to check if transfer is restricted
            const board = await tx.run(zql.boards.where("id", ticket.boardId).one());

            if (board?.metadata && typeof board.metadata === 'object') {
              const metadata = board.metadata as BoardMetadata;

              const controlRoleIds = Array.isArray(metadata.ticketControlRoleIds)
                ? metadata.ticketControlRoleIds
                : [];
              // Restriction fires when the board has ticketControlRoleIds set
              // (role-driven path) OR the legacy isAllowedToTransfer toggle is on
              // (enum fallback). Boards with neither are unrestricted.
              if (controlRoleIds.length > 0 || metadata.isAllowedToTransfer === true) {
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

                if (controlRoleIds.length > 0) {
                  // Role-driven: raw roleId membership. Works for custom roles.
                  if (!userGroupMapping.roleId || !controlRoleIds.includes(userGroupMapping.roleId)) {
                    throw new Error('Only users with a configured role can modify Assignee, ETA, Stage, or Board on this board');
                  }
                } else {
                  // Legacy enum fallback (only fires when isAllowedToTransfer===true).
                  const responsibility = userGroupMapping.responsibility;
                  if (responsibility !== UserResponsibility.MANAGER && responsibility !== UserResponsibility.TEAM_LEAD) {
                    throw new Error('Only users with MANAGER or TEAM_LEAD responsibility can modify Assignee, ETA, Stage, or Board on this board');
                  }
                }
              }
            }
          }

          const updateData: any = { updatedAt: params.updatedAt, updatedBy: authData.sub };
          const activities: any[] = [];
          const fields = ['title', 'description', 'statusV2', 'priority', 'stageName', 'assignedTo', 'userGroupId', 'eta', 'boardId', 'metadata', 'isArchived', 'kanbanPosition', 'ticketType'] as const;
          const oldAssignedTo = ticket.assignedTo;
          const oldBoardId = ticket.boardId;


          // Handle board transfer
          if (params.boardId !== undefined && params.boardId !== oldBoardId) {
            const now = Date.now();

            // Flow boards only receive tickets through the flow cascade or
            // "Start flow"; runs would break if tickets moved in or out.
            const targetBoard = await tx.run(zql.boards.where('id', params.boardId).one());
            if (targetBoard?.boardType === BoardType.FLOW) {
              throw new Error('Tickets cannot be moved onto a Flow board');
            }
            const sourceBoard = await tx.run(zql.boards.where('id', oldBoardId).one());
            if (sourceBoard?.boardType === BoardType.FLOW) {
              throw new Error('Tickets cannot be moved off a Flow board');
            }

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
                workspaceId: authData.workspaceId,
                id: newEntryId,
                ticketId: params.id,
                stageId: firstStage.id,
                version: 1,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: stageEtaDeadline,
                createdAt: now,
                updatedBy: authData.sub
              });
            }
            if (ticket.userGroupId) {
              // Fire and forget - retrigger autoassignment for the new board
              asyncTasks.push(async () => {
                try {
                  logger.info(`[MUTATOR-TICKET-UPDATE] Board changed from ${oldBoardId} to ${params.boardId}, retriggering autoassignment for userGroupId: ${ticket.userGroupId}`);

                  const newBoardId = params.boardId!;
                  const boardRow = await tx.run(zql.boards.where('id', newBoardId).one());
                  const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

                  if (hasBoardAutoAssignment(boardMetadata)) {
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
                      workspaceId: authData.workspaceId,
                      channelId: ticket.channelId,
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
                  logger.error('Failed to retrigger autoassignment for board change', error);
                }
              });
            }
          }

          // Flow-board cascade: instantiate the next plan steps / cascade-cancel
          // after this transaction commits (ticket creation cannot run inside
          // a Zero transaction).
          if (currentBoard?.boardType === BoardType.FLOW) {
            const movingToBacklog =
              params.stageName === FLOW_STAGE_NAMES.BACKLOG &&
              ticket.stageName !== FLOW_STAGE_NAMES.BACKLOG;
            if (movingToBacklog) {
              awaitedPostCommitTasks.push(async () => {
                await onFlowStepBacklogged({ ticketId: params.id, actorUserId: authData.sub });
              });
            } else if (params.statusV2 !== undefined && params.statusV2 !== ticket.statusV2) {
              const newStatus = params.statusV2 as TicketStatusV2;
              awaitedPostCommitTasks.push(async () => {
                await onFlowTicketStatusChanged({
                  ticketId: params.id,
                  newStatus,
                  actorUserId: authData.sub,
                });
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
              if (field === 'ticketType') activityType = 'TICKET_TYPE';

              activities.push({
                activityType,
                value: field === 'stageName'
                  ? { field: 'stageName', oldValue: ticket[field], newValue: params[field] }
                  : { oldValue: ticket[field], newValue: params[field] },
              });
            }
          }

          const flowSnapshot = (
            ticket.metadata as {
              flow?: {
                nodeSnapshot?: {
                  planNodeId?: string;
                  title?: string;
                  gate?: { type?: string; prompt?: string };
                };
              };
            } | null
          )?.flow?.nodeSnapshot;
          if (
            params.statusV2 === TicketStatusV2.COMPLETED &&
            ticket.statusV2 !== TicketStatusV2.COMPLETED &&
            flowSnapshot?.gate?.type === 'confirmation'
          ) {
            activities.push({
              activityType: ActivityType.METADATA,
              value: {
                field: 'flowConfirmation',
                planNodeId: flowSnapshot.planNodeId ?? null,
                prompt: flowSnapshot.gate.prompt?.trim() || null,
                confirmationText:
                  flowSnapshot.gate.prompt?.trim() || flowSnapshot.title?.trim() || null,
              },
            });
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
            // Guard: direct stageName changes on NON_LINEAR boards must use the nonLinear.transition mutator
            const board = await tx.run(zql.boards.where('id', ticket.boardId).one());
            if (board?.boardType === BoardType.NON_LINEAR) {
              throw new Error('Direct stage changes are not allowed on non-linear boards. Use the nonLinear.transition mutator.');
            }

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
                      workspaceId: authData.workspaceId,
                      id: newEntryId,
                      ticketId: params.id,
                      stageId: newStage.id,
                      version: 1,
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
                      workspaceId: authData.workspaceId,
                      id: newEntryId,
                      ticketId: params.id,
                      stageId: newStage.id,
                      version: 1,
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

          if (
            params.statusV2 === TicketStatusV2.COMPLETED
            && ticket.statusV2 !== TicketStatusV2.COMPLETED
            && isReleaseTicket(ticket.ticketType as BaseTicketType | null)
          ) {
            const completionTimestamp = new Date(params.updatedAt);
            asyncTasks.push(async () => {
              try {
                await versionReleaseMappingService.updateDeployedVersionOnCompletion(
                  params.id,
                  completionTimestamp,
                );
              } catch (error) {
                logger.error(
                  `[VersionReleaseMapping] failed to update deployedVersion for ticket ${params.id}:`,
                  error,
                );
              }
            });
          }

          // Mirror every release-ticket status change into the bundled dev
          // tickets' threads. Keyed on the canonical statusV2 (never on board
          // stage names — those are team-specific); the != guard means one
          // message per genuine transition.
          if (
            params.statusV2 !== undefined
            && params.statusV2 !== ticket.statusV2
            && isReleaseTicket(ticket.ticketType as BaseTicketType | null)
          ) {
            const newStatus = params.statusV2 as TicketStatusV2;
            asyncTasks.push(async () => {
              try {
                await releaseDevTicketNotifyService.notifyDevTicketsOnReleaseStatusChange({
                  releaseTicketId: params.id,
                  status: newStatus,
                  workspaceId: authData.workspaceId,
                });
              } catch (error) {
                logger.error(
                  `[ReleaseDevNotify] failed to notify dev tickets for release ${params.id}:`,
                  error,
                );
              }
            });
          }

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

                  if (hasBoardAutoAssignment(boardMetadata)) {
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
                      workspaceId: authData.workspaceId,
                      channelId: ticket.channelId,
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
                      workspaceId: authData.workspaceId,
                      id: activityId,
                      ticketId: params.id,
                      updatedBy: authData.sub,
                      timestamp: timestamp,
                      activityType: ActivityType.ASSIGNED_TO,
                      value: { oldValue: ticket.assignedTo, newValue: assignmentResult.assignedUserId },
                      channelId: ticket.channelId,
                    });

                  // Create system message if conversation exists
                  if (ticket.conversationId) {
                    const assignedUser = await tx.run(zql.users.where('id', assignmentResult.assignedUserId).one());
                    if (assignedUser) {
                      await tx.mutate.messages.insert({
                        messageId,
                        conversationId: ticket.conversationId,
                        workspaceId: authData.workspaceId,
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
          for (const activity of activities) {
            await tx.mutate.ticket_activities.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              ticketId: params.id,
              updatedBy: authData.sub,
              timestamp: Date.now(),
              activityType: activity.activityType as any,
              value: activity.value,
              channelId: ticket.channelId,
            });

            const user = await tx.run(zql.users.where('id', authData.sub).one());
            if (!user?.name && !user?.displayName) {
              throw new Error('User name is required but not available');
            }
            const userName = user.displayName || user.name;
            let activityMessage = '';

            if (activity.activityType === ActivityType.TITLE) {
              activityMessage = `${userName} updated the title`;
            } else if (activity.activityType === ActivityType.DESCRIPTION) {
              activityMessage = `${userName} updated the description`;
            } else if (activity.activityType === ActivityType.STATUS && activity.value.field === 'stageName') {
              activityMessage = `${userName} moved ticket from "${activity.value.oldValue}" to "${activity.value.newValue}"`;
            } else if (activity.activityType === ActivityType.ASSIGNED_TO) {
              if (activity.value.newValue) {
                const newAssignee = await tx.run(zql.users.where('id', activity.value.newValue).one());
                if (activity.value.newValue === authData.sub) {
                  activityMessage = `${userName} self-assigned the ticket`;
                } else {
                  activityMessage = `${userName} assigned to ${newAssignee?.displayName || newAssignee?.name || 'someone'}`;
                }
              } else {
                activityMessage = `${userName} unassigned the ticket`;
              }
            } else if (activity.activityType === ActivityType.PRIORITY) {
              activityMessage = `${userName} changed priority from ${activity.value.oldValue} to ${activity.value.newValue}`;
            } else if (activity.activityType === ActivityType.ETA) {
              const oldDate = activity.value.oldValue ? new Date(activity.value.oldValue).toLocaleDateString() : 'none';
              const newDate = activity.value.newValue ? new Date(activity.value.newValue).toLocaleDateString() : 'none';
              activityMessage = `${userName} updated ETA from ${oldDate} to ${newDate}`;
            } else if (activity.activityType === ActivityType.BOARD) {
              const oldBoard = await tx.run(zql.boards.where('id', activity.value.oldValue).one());
              const newBoard = await tx.run(zql.boards.where('id', activity.value.newValue).one());
              activityMessage = `${userName} moved ticket from board "${oldBoard?.name || activity.value.oldValue}" to "${newBoard?.name || activity.value.newValue}"`;
            } else if (activity.activityType === ActivityType.USER_GROUP_ID) {
              if (activity.value.newValue) {
                const newGroup = await tx.run(zql.user_groups.where('id', activity.value.newValue).one());
                activityMessage = `${userName} transferred the ticket to ${newGroup?.name || 'Unknown'}`;
              } else {
                const oldGroup = activity.value.oldValue ? await tx.run(zql.user_groups.where('id', activity.value.oldValue).one()) : null;
                activityMessage = `${userName} removed user group${oldGroup ? ` ${oldGroup.name}` : ''}`;
              }
            } else if (activity.activityType === ActivityType.IS_ARCHIVED) {
              activityMessage = `${userName} archived the ticket`;
            } else if (activity.activityType === ActivityType.TICKET_TYPE) {
              const oldType = activity.value.oldValue || 'none';
              const newType = activity.value.newValue || 'none';
              activityMessage = `${userName} changed ticket type from ${oldType} to ${newType}`;
            } else if (
              activity.activityType === ActivityType.METADATA &&
              activity.value.field === 'flowConfirmation'
            ) {
              const confirmationText = activity.value.confirmationText;
              activityMessage = confirmationText
                ? `${userName} confirmed “${confirmationText}”`
                : `${userName} completed the confirmation`;
            }

            if (activityMessage && ticket.conversationId) {
              await tx.mutate.messages.insert({
                messageId: uuidv4(),
                conversationId: ticket.conversationId,
                workspaceId: authData.workspaceId,
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
      archiveDeskTicket: defineMutator(
        z.object({
          id: z.string(),
          updatedAt: z.number(),
        }),
        async ({ tx, args: { id, updatedAt } }) => {
          const ticket = await tx.run(zql.tickets.where("id", id).one());
          if (!ticket) {
            throw new Error("Ticket not found");
          }

          if (ticket.workspaceId !== authData.workspaceId) {
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
            updatedBy: authData.sub,
          });

          await tx.mutate.ticket_activities.insert({
            workspaceId: authData.workspaceId,
            id: uuidv4(),
            ticketId: id,
            updatedBy: authData.sub,
            timestamp: updatedAt,
            activityType: ActivityType.IS_ARCHIVED,
            value: { oldValue: false, newValue: true },
            channelId: ticket.channelId,
          });

          if (ticket.conversationId) {
            const user = await tx.run(zql.users.where('id', authData.sub).one());
            const userName = user?.name || 'Someone';

            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: ticket.conversationId,
              workspaceId: authData.workspaceId,
              senderId: authData.sub,
              content: `${userName} archived the ticket`,
              msgType: MessageType.SYSTEM,
              hasAttachment: false,
              edited: false,
              isDeleted: false,
              isSent: true,
              showInChannel: false,
              createdAt: updatedAt,
              metadata: {
                activityType: ActivityType.IS_ARCHIVED,
                isTicketActivity: true,
              },
            });
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
            workspaceId: authData.workspaceId,
            id,
            ticketId: oldTicketStageEtaEntry?.ticketId ?? ticketId!,
            stageId: oldTicketStageEtaEntry?.stageId ?? stageId!,
            version: 1,
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
            workspaceId: authData.workspaceId,
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
            channelId: ticket.channelId,
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
              workspaceId: authData.workspaceId,
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
                activityType: ActivityType.STAGE_ETA,
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
          const parentAsSubTicket = await tx.run(
            zql.sub_tickets.where('mappedTicketId', ticketId).one(),
          );
          // Parent ticket is also needed below to denormalize channelId onto the activity.
          const parentTicket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (parentAsSubTicket) {
            const parentBoard = parentTicket
              ? await tx.run(zql.boards.where('id', parentTicket.boardId).one())
              : null;
            if (parentBoard?.boardType !== BoardType.FLOW) {
              throw new Error('Cannot create a sub-ticket under a sub-ticket');
            }
          }
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
            workspaceId: authData.workspaceId,
            id: mappingId,
            ticketId,
            subTicketId,
          });

          // Log activity and create system message
          const activityId = uuidv4();
          await tx.mutate.ticket_activities.insert({
            workspaceId: authData.workspaceId,
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
            channelId: parentTicket?.channelId ?? null,
          });

          // Create system message in conversation
          if (conversationId) {
            const user = await tx.run(zql.users.where('id', authData.sub).one());
            const userName = user?.name || 'Someone';
            const displayId = subTicketXyneId || subTicketId.substring(0, 8).toUpperCase();
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId,
              workspaceId: authData.workspaceId,
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

          // Only repositories that are in a hub block deletion: one registered
          // and never added to a hub has nothing to detach.
          const attachedSdlcRepository = await tx.run(
            zql.sdlc_entity_links
              .where('relationType', SDLC_MEMBERSHIP_RELATION)
              .where('targetType', 'REPOSITORY')
              .whereExists('channel', channel => channel.where('projectId', projectId))
              .one(),
          );
          if (attachedSdlcRepository) {
            throw new Error('Detach SDLC repositories before deleting their project');
          }

          // Delete project
          await tx.mutate.projects.delete({
            id: projectId,
          });
        },
      ),
      // Creates or updates one main release board and only the applications
      // explicitly owned by that board through Application.mainReleaseBoardId.
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
        async ({
          tx,
          args: {
            projectId,
            mainBoardId,
            mainBoardName: rawMainBoardName,
            vcsProvider,
            releaseTrackingMode,
            channelId,
            applications: rawApplications,
          },
        }) => {
          // Validate project exists
          const project = await tx.run(zql.projects.where('id', projectId).one());
          if (!project) {
            throw new Error('Project not found');
          }

          // Validate channel exists and belongs to this project
          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error('Channel not found');
          }
          if (channel.projectId !== projectId) {
            throw new Error('Channel does not belong to this project');
          }

          if (rawApplications.length === 0) {
            throw new Error('At least one application is required');
          }

          // ── Normalize all user-typed strings up-front ─────────────────────
          // Why: a single trailing space in `regex` previously caused commit
          // analysis to silently match zero files (bug discovered 2026-06-25).
          // Now: trim everything, drop empty path entries, and validate the
          // regex compiles BEFORE any DB write. Downstream code already does
          // some of these trims inline; those become no-ops on already-trimmed
          // strings.
          const mainBoardName = rawMainBoardName.trim();
          const applications = rawApplications.map(app => {
            const trimmedRegex = app.regex.trim();
            const trimmedName = app.name.trim();
            if (trimmedRegex !== '') {
              try {
                new RegExp(trimmedRegex);
              } catch (e) {
                const why = e instanceof Error ? e.message : 'unknown error';
                throw new Error(
                  `Invalid regex for application "${trimmedName || '(unnamed)'}": ${why}`,
                );
              }
            }
            return {
              ...app,
              name: trimmedName,
              boardName: app.boardName.trim(),
              repoUrl: app.repoUrl.trim().replace(/\/+$/, ''),
              regex: trimmedRegex,
              ownerTeam: app.ownerTeam.trim(),
              envPaths: app.envPaths.map(p => p.trim()).filter(Boolean),
              migrationPaths: app.migrationPaths.map(p => p.trim()).filter(Boolean),
            };
          });

          for (const app of applications) {
            if (app.regex === '') {
              throw new Error(
                `Application "${app.name || '(unnamed)'}" is missing its file-path regex`,
              );
            }
          }

          const normalizedApplicationNames = applications.map(app => app.name.trim());
          if (normalizedApplicationNames.some(name => !name)) {
            throw new Error('Application name is required');
          }
          if (new Set(normalizedApplicationNames).size !== normalizedApplicationNames.length) {
            throw new Error('Application names must be unique within a release group');
          }

          // One main release board represents one repository. A project can use
          // multiple repositories by creating multiple main release boards.
          const normalizedRepoUrls = new Set(
            applications.map(app => app.repoUrl.trim().replace(/\/+$/, '')),
          );
          if (normalizedRepoUrls.has('') || normalizedRepoUrls.size !== 1) {
            throw new Error('All applications in a release group must use the same repository URL');
          }

          if (!mainBoardName.trim()) {
            throw new Error('Main release board name is required');
          }
          for (const app of applications) {
            if (!app.boardName.trim()) {
              throw new Error('Application board name is required');
            }
            if (app.boardId === mainBoardId) {
              throw new Error('An application board cannot be the main release board');
            }
          }

          const appIds = applications.map(app => app.id);
          const appBoardIds = applications.map(app => app.boardId);
          const requestedBoardNames = [
            mainBoardName.trim(),
            ...applications.map(app => app.boardName.trim()),
          ];
          if (new Set(appIds).size !== appIds.length) {
            throw new Error('Application IDs must be unique');
          }
          if (new Set(appBoardIds).size !== appBoardIds.length) {
            throw new Error('Application board IDs must be unique');
          }
          if (new Set(requestedBoardNames).size !== requestedBoardNames.length) {
            throw new Error('Release board names must be unique within the project');
          }

          // Seed the GENERIC default stages on each new release board. This is
          // the workspace-agnostic prod default — deliberately minimal. A
          // workspace can customize stages afterward; e.g. the Xyne-Spaces local
          // lifecycle lives in backend/scripts/release-manager/seed-release-stages.ts and is
          // intentionally NOT shared with this default (workspace-specific seed
          // data stays scoped to that script).
          const seedReleaseStages = async (newBoardId: string, ts: number): Promise<void> => {
            const stages = [
              { name: 'BACKLOG', defaultTicketStatusV2: TicketStatusV2.TODO },
              { name: 'IN PROGRESS', defaultTicketStatusV2: TicketStatusV2.STARTED },
              { name: 'COMPLETED', defaultTicketStatusV2: TicketStatusV2.COMPLETED },
              { name: 'NOT REQUIRED', defaultTicketStatusV2: TicketStatusV2.CANCELLED },
            ];
            let currentMaxStageSequence = 0;
            for (const s of stages) {
              const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
                newBoardId,
                currentMaxStageSequence,
              );
              currentMaxStageSequence = Math.max(currentMaxStageSequence, sequenceNumber);
              await tx.mutate.stages.insert({
                workspaceId: authData.workspaceId,
                id: uuidv4(),
                name: s.name,
                sequenceNumber,
                defaultTicketStatusV2: s.defaultTicketStatusV2,
                boardId: newBoardId,
                createdBy: authData.sub,
                updatedBy: authData.sub,
                createdAt: ts,
                updatedAt: ts,
              });
            }
          };

          // Bind this release board group to the form selected by its main board's mode.
          // The Create Ticket modal reads one BOARD/TICKET mapping per board, so
          // switching modes updates the existing mapping instead of adding a second
          // form. The forms themselves are seed data (scripts/seed-release.ts).
          const releaseCommitFormName = 'xyne_release_specs_form';
          const releaseVersionFormName = 'xyne_release_version_specs_form';
          const targetReleaseFormName =
            releaseTrackingMode === ReleaseTrackingMode.VERSION
              ? releaseVersionFormName
              : releaseCommitFormName;
          let targetReleaseFormId: string | null = null;
          let releaseFormLookedUp = false;
          const ensureBoardFormMapping = async (boardId: string): Promise<void> => {
            if (!releaseFormLookedUp) {
              releaseFormLookedUp = true;
              const forms = await tx.run(
                zql.forms
                  .where('formName', targetReleaseFormName)
                  .where('contextType', FormContextType.BOARD)
                  .where('entityType', FormEntityType.TICKET)
                  .where('workspaceId', project.workspaceId),
              );
              targetReleaseFormId = forms[0]?.id ?? null;
            }
            if (!targetReleaseFormId) {
              throw new Error(
                `Release form "${targetReleaseFormName}" is not configured for this workspace. `
                + 'Run scripts/release-manager/seed-release.ts before creating release boards.',
              );
            }

            const existingMapping = await tx.run(
              zql.forms_context_mapping
                .where('contextId', boardId)
                .where('contextType', FormContextType.BOARD)
                .where('entityType', FormEntityType.TICKET)
                .one(),
            );

            if (existingMapping) {
              // Skip the no-op write: an unchanged mapping would still be
              // replicated to every client subscribed to forms_context_mapping.
              if (existingMapping.formId !== targetReleaseFormId) {
                await tx.mutate.forms_context_mapping.update({
                  id: existingMapping.id,
                  formId: targetReleaseFormId,
                });
              }
              return;
            }

            await tx.mutate.forms_context_mapping.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              formId: targetReleaseFormId,
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
            });
          };

          const deleteApplicationBoard = async (
            application: { id: string; boardId: string },
          ): Promise<void> => {
            const stages = await tx.run(zql.stages.where('boardId', application.boardId));
            for (const stage of stages) {
              const approvers = await tx.run(
                zql.stage_approvers.where('stageId', stage.id),
              );
              for (const approver of approvers) {
                await tx.mutate.stage_approvers.delete({ id: approver.id });
              }

              const prStatusMappings = await tx.run(
                zql.stage_pr_status_mappings.where('stageId', stage.id),
              );
              for (const mapping of prStatusMappings) {
                await tx.mutate.stage_pr_status_mappings.delete({ id: mapping.id });
              }

              const stageFormMappings = await tx.run(
                zql.forms_context_mapping
                  .where('contextId', stage.id)
                  .where('contextType', FormContextType.STAGE),
              );
              for (const mapping of stageFormMappings) {
                await tx.mutate.forms_context_mapping.delete({ id: mapping.id });
              }

              await tx.mutate.stages.delete({ id: stage.id });
            }

            const boardFormMappings = await tx.run(
              zql.forms_context_mapping
                .where('contextId', application.boardId)
                .where('contextType', FormContextType.BOARD),
            );
            for (const mapping of boardFormMappings) {
              await tx.mutate.forms_context_mapping.delete({ id: mapping.id });
            }

            await tx.mutate.applications.delete({ id: application.id });
            await tx.mutate.boards.delete({ id: application.boardId });
          };

          const existingMainBoard = await tx.run(zql.boards.where('id', mainBoardId).one());

          if (existingMainBoard) {
            if (
              existingMainBoard.projectId !== projectId
              || existingMainBoard.boardType !== BoardType.RELEASE
            ) {
              throw new Error('Main release board does not belong to this project');
            }
            if (!existingMainBoard.vcsProvider || !existingMainBoard.releaseTrackingMode) {
              throw new Error('The selected board is not a main release board');
            }

            await tx.mutate.boards.update({
              id: existingMainBoard.id,
              name: mainBoardName.trim(),
              vcsProvider,
              releaseTrackingMode,
              updatedBy: authData.sub,
              updatedAt: Date.now(),
            });
            await ensureBoardFormMapping(existingMainBoard.id);
          } else {
            const projectBoardTs = Date.now();
            await tx.mutate.boards.insert({
              id: mainBoardId,
              name: mainBoardName.trim(),
              projectId,
              workspaceId: project.workspaceId,
              createdBy: authData.sub,
              boardType: BoardType.RELEASE,
              vcsProvider,
              releaseTrackingMode,
              createdAt: projectBoardTs,
            });
            await seedReleaseStages(mainBoardId, projectBoardTs);
            await ensureBoardFormMapping(mainBoardId);
          }

          // Group-scoped edits only load applications owned by this main board.
          const existingApps = await tx.run(
            zql.applications.where('mainReleaseBoardId', mainBoardId),
          );
          const existingById = new Map(existingApps.map(app => [app.id, app]));
          const payloadApplicationIds = new Set(applications.map(app => app.id));

          for (const existing of existingApps) {
            if (!payloadApplicationIds.has(existing.id)) {
              // Existence probe only — materializing the board's whole ticket
              // set inside the push transaction just to throw is wasted work.
              const boardTicket = await tx.run(
                zql.tickets.where('boardId', existing.boardId).one(),
              );
              if (boardTicket) {
                throw new Error(
                  `Cannot remove application "${existing.name}" because its board has tickets`,
                );
              }
              await deleteApplicationBoard(existing);
            }
          }

          // One batched lookup instead of a per-application round-trip: the
          // update branch needs the board row, the insert branch needs an
          // id-collision check — both answered by the same IN query.
          const payloadBoardIds = applications.map(app => app.boardId);
          const payloadBoards = payloadBoardIds.length > 0
            ? await tx.run(zql.boards.where('id', 'IN', payloadBoardIds))
            : [];
          const payloadBoardById = new Map(payloadBoards.map(board => [board.id, board]));

          for (const appConfig of applications) {
            const existing = existingById.get(appConfig.id);

            if (existing) {
              if (existing.boardId !== appConfig.boardId) {
                throw new Error('An existing application cannot be moved to another board');
              }

              const applicationBoard = payloadBoardById.get(existing.boardId);
              if (
                !applicationBoard
                || applicationBoard.projectId !== projectId
                || applicationBoard.boardType !== BoardType.RELEASE
              ) {
                throw new Error(`Application board for "${appConfig.name}" is invalid`);
              }
              await tx.mutate.boards.update({
                id: applicationBoard.id,
                name: appConfig.boardName.trim(),
                updatedBy: authData.sub,
                updatedAt: Date.now(),
              });
              // No form mapping for application boards: release tickets are
              // only ever created on the main release board.

              await tx.mutate.applications.update({
                id: existing.id,
                name: appConfig.name.trim(),
                mainReleaseBoardId: mainBoardId,
                channelId,
                regex: appConfig.regex,
                repoUrl: appConfig.repoUrl.trim().replace(/\/+$/, ''),
                ownerTeam: appConfig.ownerTeam,
                envPaths: appConfig.envPaths,
                migrationPaths: appConfig.migrationPaths,
                updatedAt: Date.now(),
              });
              continue;
            }

            const boardName = appConfig.boardName.trim();
            const boardId = appConfig.boardId;
            const applicationId = appConfig.id;

            if (payloadBoardById.has(boardId)) {
              throw new Error(`Application board ID "${boardId}" already exists`);
            }

            const now = Date.now();
            await tx.mutate.boards.insert({
              id: boardId,
              name: boardName,
              projectId,
              workspaceId: project.workspaceId,
              createdBy: authData.sub,
              boardType: BoardType.RELEASE,
              createdAt: now,
            });
            await seedReleaseStages(boardId, now);
            // No form mapping for application boards: release tickets are
            // only ever created on the main release board.

            await tx.mutate.applications.insert({
              workspaceId: authData.workspaceId,
              id: applicationId,
              name: appConfig.name.trim(),
              projectId,
              boardId,
              mainReleaseBoardId: mainBoardId,
              channelId,
              regex: appConfig.regex,
              repoUrl: appConfig.repoUrl.trim().replace(/\/+$/, ''),
              ownerTeam: appConfig.ownerTeam,
              envPaths: appConfig.envPaths,
              migrationPaths: appConfig.migrationPaths,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
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
            ...(reassignOnUnavailable !== undefined && { reassignOnUnavailable }),
            ...(maxWorkload !== undefined && { maxWorkload }),
            updatedAt: timestamp,
          });

          if (userRoleUpdates) {
            const roleIdsToUpdate = [...new Set(Object.values(userRoleUpdates))];
            const roles = await tx.run(
              zql.roles.where('id', 'IN', roleIdsToUpdate).where('workspaceId', userGroup.workspaceId),
            );
            for (const [userId, roleId] of Object.entries(userRoleUpdates)) {
              const mapping = await tx.run(
                zql.user_group_mappings.where('userGroupId', userGroupId).where('userId', userId).one(),
              );
              if (mapping) {
                const role = roles.find(r => r.id === roleId);
                const responsibility = role ? DEFAULT_ROLE_NAME_TO_ENUM[role.name] : null;
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
            const responsibilities = [...new Set(Object.values(userResponsibilityUpdates))];
            const roleNames = responsibilities.map(r => r as string);
            const roles = await tx.run(
              zql.roles.where('name', 'IN', roleNames).where('workspaceId', userGroup.workspaceId),
            );
            for (const [userId, responsibility] of Object.entries(userResponsibilityUpdates)) {
              const mapping = await tx.run(
                zql.user_group_mappings.where('userGroupId', userGroupId).where('userId', userId).one(),
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
        z.object({ userGroupId: z.string(), userIds: z.array(z.string()), timestamp: z.number(), mappingIds: z.record(z.string(), z.string()), roleIds: z.array(z.string()).optional() }),
        async ({ tx, args: { userGroupId, userIds, timestamp, mappingIds, roleIds } }) => {
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          const users = await Promise.all(
            userIds.map(userId => tx.run(zql.users.where('id', userId).one()))
          );
          const allUsersExist = users.every(user => user !== undefined);
          if (!allUsersExist) {
            const foundUserIds = new Set(users.filter((u): u is NonNullable<typeof u> => u !== undefined).map(u => u.id));
            const notFound = userIds.filter(id => !foundUserIds.has(id));
            throw new Error(`Users with ids '${notFound.join(', ')}' not found`);
          }

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

          const userIdsToAdd = userIds.filter(userId => !existingUserIds.has(userId));

          const distinctRoleIds = roleIds
            ? [...new Set(roleIds.filter((r): r is string => Boolean(r)))]
            : [];
          const roles = distinctRoleIds.length
            ? await tx.run(zql.roles.where('id', 'IN', distinctRoleIds).where('workspaceId', userGroup.workspaceId))
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
              workspaceId: authData.workspaceId,
              id: uuidv4(),
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
          reassignTickets: z.boolean().optional(),
        }),
        async ({ tx, args: { userGroupId, userIds, reassignTickets } }) => {
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
          const removedUserIds: string[] = [];
          for (const mapping of mappingsToRemove) {
            if (mapping) {
              await tx.mutate.user_group_mappings.delete({
                id: mapping.id,
              });
              removedUserIds.push(mapping.userId);
            }
          }

          // Hand the removed members' open tickets off only once the delete has committed:
          // a queued reassignment cannot be cancelled, so it must never run for a removal
          // that rolled back. Same policy as the member pause flow - the group must allow it.
          if (
            reassignTickets &&
            userGroup.reassignOnUnavailable === true &&
            removedUserIds.length > 0
          ) {
            awaitedPostCommitTasks.push(async () => {
              // Per-user guard: one failed enqueue must not skip the rest.
              for (const removedUserId of removedUserIds) {
                try {
                  await ticketReassignmentQueue.scheduleReassignment(removedUserId, userGroupId);
                } catch (error) {
                  logger.error(
                    `❌ [TICKET-REASSIGNMENT] Failed to schedule handoff for removed user ${removedUserId} in group ${userGroupId}:`,
                    error
                  );
                }
              }
            });
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
        async ({ tx, args: { boardId, plan, timestamp } }) => {
          const board = await tx.run(zql.boards.where('id', boardId).one());
          if (!board) {
            throw new Error('Board not found');
          }
          if (board.boardType !== BoardType.FLOW) {
            throw new Error('Flow plans can only be set on Flow boards');
          }
          validateFlowPlan(plan);
          await validateFlowDecisionFields(tx, plan);
          await tx.mutate.boards.update({
            id: boardId,
            flowPlan: serializeFlowPlan(plan),
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });
          awaitedPostCommitTasks.push(async () => {
            await onFlowPlanUpdated({ boardId, actorUserId: authData.sub });
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
                    })
                  )
                  .optional(),
                formId: z.string().optional(),
                requestApprovalOnEntry: z.boolean().optional(),
              })
            )
            .optional(),
          timestamp: z.number(),
          stageIds: z.record(z.string(), z.string()).optional(),
          prStatusMappingIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({
          tx,
          args: {
            boardId,
            name,
            description,
            projectId,
            boardType,
            metadata,
            stages,
            timestamp,
            stageIds = {},
            prStatusMappingIds = {},
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
            updatedBy: authData.sub,
            updatedAt: timestamp,
          });

          // Update stages if provided
          if (stages) {
            // Validate that stages have at least one TODO, STARTED, and COMPLETED stage
            const hasTodo = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.TODO || s.defaultTicketStatusV2 === TicketStatusV2.TODO,
            );
            const hasStarted = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.STARTED ||
                s.defaultTicketStatusV2 === TicketStatusV2.STARTED,
            );
            const hasCompleted = stages.some(
              s =>
                s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED ||
                s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED,
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
            const resolvedStages = stages.map((stage, inputIndex) => {
              const stageId = stage.id || stageIds[stage.sequenceNumber];
              if (!stageId) {
                throw new Error(`stageId is required for stage at sequence ${stage.sequenceNumber}`);
              }
              return { stage, stageId, inputIndex };
            });
            const incomingStageIds = new Set(resolvedStages.map(({ stageId }) => stageId));

            // Reserve common-DB values for new stages before applying the
            // requested order. Existing values form the remaining sequence
            // pool, so reordering shifts those values instead of compacting
            // them to 1..N and filling deleted gaps.
            let currentMaxStageSequence = existingStages.reduce(
              (max, stage) => Math.max(max, stage.sequenceNumber),
              0,
            );
            const sequencePool = resolvedStages
              .filter(({ stageId }) => existingStageMap.has(stageId))
              .map(({ stageId }) => existingStageMap.get(stageId)!.sequenceNumber);

            for (const { stageId } of resolvedStages) {
              if (existingStageMap.has(stageId)) continue;

              const allocatedSequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
                boardId,
                currentMaxStageSequence,
              );
              currentMaxStageSequence = Math.max(
                currentMaxStageSequence,
                allocatedSequenceNumber,
              );
              sequencePool.push(allocatedSequenceNumber);
            }

            sequencePool.sort((left, right) => left - right);
            const orderedStages = [...resolvedStages].sort(
              (left, right) =>
                left.stage.sequenceNumber - right.stage.sequenceNumber ||
                left.inputIndex - right.inputIndex,
            );
            const assignedSequenceByStageId = new Map(
              orderedStages.map(({ stageId }, index) => [stageId, sequencePool[index]!] as const),
            );

            // 1. Update existing stages or insert new ones
            for (const { stage, stageId } of resolvedStages) {
              const assignedSequenceNumber = assignedSequenceByStageId.get(stageId);
              if (assignedSequenceNumber === undefined) {
                throw new Error(`sequenceNumber allocation is missing for stage ${stageId}`);
              }

              if (existingStageMap.has(stageId)) {
                // Update existing stage
                const existing = existingStageMap.get(stageId)!;
                // Only update if something changed
                if (
                  existing.name !== stage.name ||
                  existing.eta !== stage.eta ||
                  existing.sequenceNumber !== assignedSequenceNumber ||
                  existing.defaultTicketStatusV2 !== stage.defaultTicketStatusV2 ||
                  (existing.requestApprovalOnEntry ?? false) !==
                    (stage.requestApprovalOnEntry ?? false)
                ) {
                  await tx.mutate.stages.update({
                    id: stageId,
                    name: stage.name,
                    eta: stage.eta !== undefined ? stage.eta : null,
                    sequenceNumber: assignedSequenceNumber,
                    defaultTicketStatusV2:
                      (stage.defaultTicketStatusV2 as TicketStatusV2) || undefined,
                    requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
                    updatedBy: authData.sub,
                    updatedAt: now,
                  });
                }

                // Sync PR status mappings for this stage
                if (stage.prStatuses !== undefined) {
                  // Fetch existing mappings for this stage
                  const existingMappings = await tx.run(
                    zql.stage_pr_status_mappings.where('stageId', stageId)
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
                    const mappingKey = `${stage.sequenceNumber}-${prStatus}`;
                    await tx.mutate.stage_pr_status_mappings.insert({
                      workspaceId: authData.workspaceId,
                      id: prStatusMappingIds[mappingKey] ?? uuidv4(),
                      stageId,
                      prStatus: prStatus,
                      createdAt: now,
                    });
                  }
                }
              } else {
                // Insert new stage
                await tx.mutate.stages.insert({
                  workspaceId: authData.workspaceId,
                  id: stageId,
                  name: stage.name,
                  eta: stage.eta,
                  sequenceNumber: assignedSequenceNumber,
                  defaultTicketStatusV2:
                    (stage.defaultTicketStatusV2 as TicketStatusV2) || TicketStatusV2.STARTED,
                  requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
                  boardId: boardId,
                  createdBy: authData.sub,
                  updatedBy: authData.sub,
                  createdAt: now,
                  updatedAt: now,
                });

                // Create PR status mappings for new stage
                if (stage.prStatuses && stage.prStatuses.length > 0) {
                  for (const prStatus of stage.prStatuses) {
                    const mappingKey = `${stage.sequenceNumber}-${prStatus}`;
                    await tx.mutate.stage_pr_status_mappings.insert({
                      workspaceId: authData.workspaceId,
                      id: prStatusMappingIds[mappingKey] ?? uuidv4(),
                      stageId,
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
              let stageId: string | undefined = stage.id || stageIds[stage.sequenceNumber];
              if (!stageId && stage.sequenceNumber) {
                stageId = sequenceToStageId.get(String(stage.sequenceNumber));
              }

              if (!stageId) {
                continue;
              }

              // Create form mapping if formId is provided
              if (stage.formId) {
                await tx.mutate.forms_context_mapping.insert({
                  workspaceId: authData.workspaceId,
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
              if (normalizedApprovers.length > 0) {
                for (const entry of normalizedApprovers) {
                  await tx.mutate.stage_approvers.insert({
                    workspaceId: authData.workspaceId,
                    id: `${stageId}-${entry.approverType}-${entry.approverId}`,
                    ...(entry.approverType === ApproverType.ROLE
                      ? { roleId: entry.approverId }
                      : { userId: entry.approverId }),
                    approverType: entry.approverType,
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
            workspaceId: authData.workspaceId,
            id: tagId,
            name: trimmedTagName,
            ticketId,
          });

          // Dual-write to new tables for backward compatibility
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (ticket?.projectId) {
            const existingProjectTag = await tx.run(
              zql.project_tags
                .where('projectId', ticket.projectId)
                .where('name', trimmedTagName)
                .one(),
            );
            const projectTagId = existingProjectTag?.id || uuidv4();
            if (!existingProjectTag) {
              await tx.mutate.project_tags.insert({
                workspaceId: authData.workspaceId,
                id: projectTagId,
                name: trimmedTagName,
                projectId: ticket.projectId,
                createdAt: Date.now(),
              });
            }
            await tx.mutate.ticket_tag_mappings.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              ticketId,
              tagId: projectTagId,
              tagName: trimmedTagName,
              createdAt: Date.now(),
            });
          }
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

          // Dual-write: delete from new table
          const mapping = await tx.run(
            zql.ticket_tag_mappings
              .where('ticketId', tag.ticketId)
              .where('tagName', tag.name)
              .one(),
          );
          if (mapping) {
            await tx.mutate.ticket_tag_mappings.delete({ id: mapping.id });
          }
        },
      ),
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
        async ({ tx, args: { ticketId, tagName, tagId, projectTagId, mappingId, projectId } }) => {
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
              workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
                id: resolvedProjectTagId,
                name: trimmedTagName,
                projectId,
                createdAt: Date.now(),
              });
            }
            await tx.mutate.ticket_tag_mappings.insert({
              workspaceId: authData.workspaceId,
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
        z.object({ tagId: z.string(), mappingId: z.string() }),
        async ({ tx, args: { tagId, mappingId } }) => {
          const mapping = await tx.run(zql.ticket_tag_mappings.where('id', mappingId).one());
          if (mapping) {
            // Dual-write: delete from ticket_tags (old model)
            const legacyTag = await tx.run(
              zql.ticket_tags
                .where('ticketId', mapping.ticketId)
                .where('name', mapping.tagName)
                .one(),
            );
            if (legacyTag) {
              await tx.mutate.ticket_tags.delete({
                id: legacyTag.id,
              });
            }

            // Delete from ticket_tag_mappings (new model)
            await tx.mutate.ticket_tag_mappings.delete({
              id: mappingId,
            });
            return;
          }

          const legacyOnlyTag = await tx.run(zql.ticket_tags.where('id', tagId).one());
          if (legacyOnlyTag) {
            await tx.mutate.ticket_tags.delete({
              id: tagId,
            });
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            channelId: sourceTicket?.channelId ?? null,
          });

          const user = await tx.run(zql.users.where('id', ctx.userID).one());
          if (!user?.name && !user?.displayName) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || targetTicketId;
          const relationLabel = formatTicketReferenceRelationLabel(relationType);
          const activityMessage = `${user.displayName || user.name} added related ticket "${referenceTitle}" (${relationLabel})`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              workspaceId: authData.workspaceId,
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              senderId: ctx.userID,
              ...(sourceTicket?.workspaceId ? { workspaceId: sourceTicket.workspaceId } : {}),
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
            workspaceId: authData.workspaceId,
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
            channelId: sourceTicket?.channelId ?? null,
          });

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          if (!user?.name && !user?.displayName) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || reference.targetTicketId;
          const newLabel = formatTicketReferenceRelationLabel(relationType);
          const oldLabel = formatTicketReferenceRelationLabel(reference.relationType);
          const activityMessage = `${user.displayName || user.name} updated related ticket label from "${oldLabel}" to "${newLabel}" for "${referenceTitle}"`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            channelId: sourceTicket?.channelId ?? null,
          });

          const user = await tx.run(zql.users.where('id', authData.sub).one());
          if (!user?.name && !user?.displayName) {
            throw new Error('User name is required but not available');
          }
          const referenceTitle =
            targetTicket?.title || targetTicket?.xyneId || reference.targetTicketId;
          const relationLabel = formatTicketReferenceRelationLabel(reference.relationType);
          const activityMessage = `${user.displayName || user.name} removed related ticket "${referenceTitle}" (${relationLabel})`;

          if (activityMessage && sourceTicket?.conversationId) {
            await tx.mutate.messages.insert({
              messageId: uuidv4(),
              conversationId: sourceTicket.conversationId,
              workspaceId: authData.workspaceId,
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
        async ({ tx, args: { id, title, channelId, folderId, projectId, visibility, content, timestamp, participantId } }) => {
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
            workspaceId: authData.workspaceId,
            id,
            title,
            content: content || [],
            channelId: resolvedChannelId,
            folderId,
            projectId: resolvedProjectId,
            createdBy: authData.sub,
            visibility: visibility || CanvasVisibility.PRIVATE,
            isTemplate: false,
            isArchived: false,
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
            workspaceId: authData.workspaceId,
            id: participantId,
            canvasId: id,
            userId: authData.sub,
            role: CanvasRole.OWNER,
            joinedAt: now,
            updatedAt: now,
          });
          asyncTasks.push(async () => {
            try {
              logger.info('analytics_event', {
                event: 'canvas_created',
                timestamp: new Date(now).toISOString(),
                userId: authData.sub,
                userName: authData.name,
                docType: DocType.Canvas,
                isCollaborative: false,
              });
            } catch (error) {
              logger.error('❌ [ANALYTICS] Failed to log canvas_created', error);
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
              workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
        async ({ tx, args: { canvasId, channelId, role, participantId, timestamp } }) => {
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
            throw new Error('Only canvas owners or editors can add channel participants');
          }
          if (role === CanvasRole.OWNER && requestingUserParticipant?.role === CanvasRole.EDITOR) {
            throw new Error('Editors cannot grant owner role');
          }

          const channel = await tx.run(zql.channels.where('id', channelId).one());
          if (!channel) {
            throw new Error("Channel doesn't exist");
          }

          const actorChannelMembership = await tx.run(
            zql.channel_participants.where('channelId', channelId).where('userId', authData.sub).one(),
          );
          if (!actorChannelMembership) {
            throw new Error('You must be a member of this channel to add it as a canvas participant');
          }

          const existingChannelParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('channelId', channelId)
              .one(),
          );
          if (existingChannelParticipant) {
            return;
          }

          await tx.mutate.canvas_participants.insert({
            workspaceId: authData.workspaceId,
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
      removeChannelParticipant: defineMutator(
        z.object({
          canvasId: z.string(),
          channelId: z.string(),
        }),
        async ({ tx, args: { canvasId, channelId } }) => {
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
            throw new Error('Only canvas owners or editors can remove channel participants');
          }

          const actorChannelMembership = await tx.run(
            zql.channel_participants.where('channelId', channelId).where('userId', authData.sub).one(),
          );
          if (!actorChannelMembership) {
            throw new Error('You must be a member of this channel to remove it as a canvas participant');
          }

          const targetParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('channelId', channelId)
              .one(),
          );
          if (!targetParticipant) {
            throw new Error('Channel is not a participant');
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
      updateChannelParticipantRole: defineMutator(
        z.object({
          canvasId: z.string(),
          channelId: z.string(),
          role: z.nativeEnum(CanvasRole),
          timestamp: z.number(),
        }),
        async ({ tx, args: { canvasId, channelId, role, timestamp } }) => {
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
            throw new Error('Only canvas owners or editors can update channel participant roles');
          }
          if (requestingUserParticipant?.role === CanvasRole.EDITOR && role === CanvasRole.OWNER) {
            throw new Error('Editors cannot grant owner role');
          }

          const actorChannelMembership = await tx.run(
            zql.channel_participants.where('channelId', channelId).where('userId', authData.sub).one(),
          );
          if (!actorChannelMembership) {
            throw new Error('You must be a member of this channel to change its role on this canvas');
          }

          const targetParticipant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where('channelId', channelId)
              .one(),
          );
          if (!targetParticipant) {
            throw new Error('Channel is not a participant');
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
        async ({ tx, args: params }) => {
          const getGuestSharedCanvasEditRole = async (
            canvasId: string,
          ): Promise<CanvasRole | null> => {
            const requester = await tx.run(zql.users.where('id', authData.sub).one());
            if (!requester || requester.role !== WorkspaceRole.GUEST) {
              return null;
            }

            const guestCtx = {
              userID: authData.sub,
              workspaceId: requester.workspaceId,
              role: requester.role,
              orgRole: '',
              memberId: '',
            };

            const sharedParticipants = await tx.run(
              zql.canvas_participants.where('canvasId', canvasId),
            );

            let strongestRole: CanvasRole | null = null;
            const roleRank = (role: CanvasRole | null): number =>
              role === CanvasRole.OWNER ? 3 : role === CanvasRole.EDITOR ? 2 : role === CanvasRole.VIEWER ? 1 : 0;

            for (const sharedParticipant of sharedParticipants) {
              if (!sharedParticipant.channelId) continue;

              const hasAccess = await hasGuestChannelAccess(
                guestCtx,
                tx,
                sharedParticipant.channelId,
              );
              if (!hasAccess) continue;

              if (roleRank(sharedParticipant.role) > roleRank(strongestRole)) {
                strongestRole = sharedParticipant.role;
              }
            }

            return strongestRole;
          };

          // Verify user has edit access
          const canvas = await tx.run(zql.canvases.where('id', params.id).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const isMoveOperation =
            params.folderId !== undefined ||
            params.projectId !== undefined ||
            params.channelId !== undefined;

          const participant = await tx.run(zql.canvas_participants
            .where('canvasId', canvas.id)
            .where('userId', authData.sub)
            .one());
          const guestSharedRole = await getGuestSharedCanvasEditRole(canvas.id);

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
              (participant.role === CanvasRole.EDITOR || participant.role === CanvasRole.OWNER)) ||
            guestSharedRole === CanvasRole.EDITOR ||
            guestSharedRole === CanvasRole.OWNER;
          const sdlcArtifact = await tx.run(
            zql.sdlc_artifacts.where('artifactId', params.id).one(),
          );
          const isSdlcBaseline = isBaselineCanvasType(sdlcArtifact?.artifactType);

          if (!canEdit && !(isChannelAdmin && (isMoveOperation || isSdlcBaseline))) {
            throw new Error('You do not have permission to edit this canvas');
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

          // Analytics: isCollaborative is always false at creation and only flipped to true here
          const isEnablingCollaboration =
            params.isCollaborative === true && !canvas.isCollaborative;
          let collaborationCreatorName: string | null = null;
          if (isEnablingCollaboration) {
            const creator = await tx.run(zql.users.where('id', canvas.createdBy).one());
            collaborationCreatorName = creator?.name ?? null;
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
          if (isEnablingCollaboration) {
            asyncTasks.push(async () => {
              try {
                logger.info('analytics_event', {
                  event: 'canvas_collaboration_enabled',
                  timestamp: new Date(params.timestamp).toISOString(),
                  canvasId: canvas.id,
                  createdBy: canvas.createdBy,
                  creatorName: collaborationCreatorName,
                  enabledBy: authData.sub,
                });
              } catch (error) {
                logger.error('❌ [ANALYTICS] Failed to log canvas_collaboration_enabled:', error);
              }
            });
          }
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
        },
      ),
      archiveCanvas: defineMutator(
        z.object({
          canvasId: z.string(),
        }),
        async ({ tx, args: { canvasId } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          if (canvas.createdBy !== authData.sub) {
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
        async ({ tx, args: { canvasId } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          if (canvas.createdBy !== authData.sub) {
            throw new Error('Only the creator can unarchive the canvas');
          }

          await tx.mutate.canvases.update({
            id: canvasId,
            isArchived: false,
          });
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
        async ({ tx, args: { id, canvasId, timestamp } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const participant = await tx.run(
            zql.canvas_participants
              .where('canvasId', canvasId)
              .where(({ or, cmp, exists: ex }: any) =>
                or(
                  cmp('userId', authData.sub),
                  ex('userGroup', (ug: any) =>
                    ug.whereExists('userGroupMappings', (m: any) =>
                      m.where('userId', authData.sub),
                    ),
                  ),
                  ex('channel', (ch: any) =>
                    ch.whereExists('participants', (cp: any) =>
                      cp.where('userId', authData.sub),
                    ),
                  ),
                ),
              )
              .one(),
          );
          const hasAccess =
            canvas.createdBy === authData.sub ||
            !!participant ||
            canvas.visibility === CanvasVisibility.PUBLIC;

          if (!hasAccess) {
            throw new Error('You do not have access to this canvas');
          }

          const existingStatus = await tx.run(
            zql.canvas_user_status
              .where('canvasId', canvasId)
              .where('userId', authData.sub)
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
            workspaceId: authData.workspaceId,
            id,
            canvasId,
            userId: authData.sub,
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
        async ({ tx, args: { threadId, commentId, canvasId, blockId, anchorText, body, mentionedUserIds, timestamp } }) => {
          await assertCanvasCommentEditAccess(tx, canvasId, authData.sub, authData.workspaceId);

          await tx.mutate.canvas_comment_threads.insert({
            id: threadId,
            workspaceId: authData.workspaceId,
            canvasId,
            blockId,
            anchorText: anchorText || null,
            initialCommentId: commentId,
            commentCount: 1,
            status: CanvasCommentThreadStatus.OPEN,
            statusUpdatedBy: null,
            statusUpdatedAt: null,
            createdBy: authData.sub,
            createdAt: timestamp,
          });

          await tx.mutate.canvas_comments.insert({
            id: commentId,
            workspaceId: authData.workspaceId,
            threadId,
            canvasId,
            body,
            mentionedUserIds: serializeCanvasCommentMentionedUserIds(mentionedUserIds),
            isInitial: true,
            createdBy: authData.sub,
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
        async ({ tx, args: { commentId, threadId, canvasId, body, mentionedUserIds, timestamp } }) => {
          const thread = await tx.run(
            zql.canvas_comment_threads
              .where('id', threadId)
              .where('workspaceId', authData.workspaceId)
              .one(),
          );
          if (!thread || thread.canvasId !== canvasId) {
            throw new Error('Comment thread not found');
          }

          await assertCanvasCommentEditAccess(tx, canvasId, authData.sub, authData.workspaceId);

          await tx.mutate.canvas_comments.insert({
            id: commentId,
            workspaceId: authData.workspaceId,
            threadId,
            canvasId,
            body,
            mentionedUserIds: serializeCanvasCommentMentionedUserIds(mentionedUserIds),
            isInitial: false,
            createdBy: authData.sub,
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
              statusUpdatedBy: authData.sub,
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
        async ({ tx, args: { commentId, body, mentionedUserIds, timestamp } }) => {
          const comment = await tx.run(
            zql.canvas_comments
              .where('id', commentId)
              .where('workspaceId', authData.workspaceId)
              .one(),
          );
          if (!comment) {
            throw new Error('Comment not found');
          }
          if (comment.createdBy !== authData.sub) {
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
        async ({ tx, args: { commentId, timestamp } }) => {
          const comment = await tx.run(
            zql.canvas_comments
              .where('id', commentId)
              .where('workspaceId', authData.workspaceId)
              .one(),
          );
          if (!comment) {
            throw new Error('Comment not found');
          }
          if (comment.createdBy !== authData.sub) {
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

          const thread = await tx.run(
            zql.canvas_comment_threads
              .where('id', comment.threadId)
              .where('workspaceId', authData.workspaceId)
              .one(),
          );
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
        async ({ tx, args: { threadId, status, timestamp } }) => {
          const thread = await tx.run(
            zql.canvas_comment_threads
              .where('id', threadId)
              .where('workspaceId', authData.workspaceId)
              .one(),
          );
          if (!thread) {
            throw new Error('Comment thread not found');
          }

          await assertCanvasThreadManageAccess(tx, thread, authData.sub, authData.workspaceId);

          await tx.mutate.canvas_comment_threads.update({
            id: threadId,
            status,
            statusUpdatedBy: authData.sub,
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
        async ({ tx, args: { id, canvasId, name, content, contentHash, timestamp } }) => {
          const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const canEdit = await hasCanvasVersionEditAccess(tx, canvas, authData.sub);

          if (!canEdit) {
            throw new Error('You do not have permission to edit this canvas');
          }

          const existingVersion = await tx.run(
            zql.canvas_versions
              .where('canvasId', canvasId)
              .where('contentHash', contentHash)
              .one(),
          );

          if (existingVersion) {
            await tx.mutate.canvas_versions.update({
              id: existingVersion.id,
              updatedAt: timestamp,
            });
            return;
          }

          await tx.mutate.canvas_versions.insert({
            workspaceId: authData.workspaceId,
            id,
            canvasId,
            name: name.trim(),
            content,
            contentHash,
            createdBy: authData.sub,
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
        async ({ tx, args: { id, name } }) => {
          const version = await tx.run(zql.canvas_versions.where('id', id).one());
          if (!version) {
            throw new Error('Canvas version not found');
          }

          const canvas = await tx.run(zql.canvases.where('id', version.canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const canEdit = await hasCanvasVersionEditAccess(tx, canvas, authData.sub);

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
        async ({ tx, args: { id, timestamp } }) => {
          const version = await tx.run(zql.canvas_versions.where('id', id).one());
          if (!version) {
            throw new Error('Canvas version not found');
          }

          const canvas = await tx.run(zql.canvases.where('id', version.canvasId).one());
          if (!canvas) {
            throw new Error('Canvas not found');
          }

          const canEdit = await hasCanvasVersionEditAccess(tx, canvas, authData.sub);

          if (!canEdit) {
            throw new Error('You do not have permission to edit this canvas');
          }

          await tx.mutate.canvases.update({
            id: canvas.id,
            lastEditedBy: authData.sub,
            lastEditedAt: timestamp,
            updatedAt: timestamp,
            ...(!canvas.isCollaborative && { content: version.content }),
          });

          await tx.mutate.canvas_versions.update({
            id: version.id,
            updatedAt: timestamp,
          });

          if (canvas.isCollaborative) {
            asyncTasks.push(async () => {
              try {
                await syncToYSweet(canvas.id, version.content as unknown as BlockNoteBlock[], authData.sub);
              } catch (error) {
                logger.error('[MUTATOR-CANVAS-VERSION-RESTORE] Failed to sync Y-Sweet:', error);
              }
            });
          }
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

            if (projectId && channel.projectId != null && channel.projectId !== projectId) {
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
              workspaceId: authData.workspaceId,
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
                    ? folder.projectId
                      ? and(
                        cmp('projectId', '=', folder.projectId),
                        cmp('channelId', '=', folder.channelId),
                      )
                      : and(
                        cmp('projectId', 'IS', null),
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
            workspaceId: authData.workspaceId,
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
                workspaceId: ctx.workspaceId,
                sessionId: 'system',
                eventCategory: 'NUDGE',
                eventName: 'NUDGE_DISMISSED',
                url: '',
                triggerType: 'SYSTEM',
                platform: Platform.WEB,
                timestamp: new Date(timestamp),
                contextMetadata: {
                  nudgeId,
                  nudgeKind: nudge.nudgeKind,
                  sourceId: nudge.sourceId,
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
                    workspaceId: authData.workspaceId,
                    id: linkId,
                    sourceType: definition.direction.from as SurfaceAreaType,
                    sourceId: nudge.sourceId,
                    targetType: definition.direction.to as SurfaceAreaType,
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
            userId: authData.sub,
            ...(params.displayName !== undefined && { displayName: params.displayName }),
            ...(params.role !== undefined && { role: params.role }),
            ...(params.pronunciation !== undefined && { pronunciation: params.pronunciation }),
            ...(params.team !== undefined && { team: params.team }),
            ...(params.phoneNumber !== undefined && { phoneNumber: params.phoneNumber }),
            ...(params.dob !== undefined && { dob: params.dob }),
            ...(params.manager !== undefined && { manager: params.manager }),
            updatedAt: now,
            createdAt: existingProfile ? existingProfile.createdAt || now : now,
          };

          await tx.mutate.user_profiles.upsert({ ...profileData, workspaceId: authData.workspaceId });

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

          await tx.mutate.user_presence.upsert({ ...presenceData, workspaceId: authData.workspaceId });

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
              isNotified: z.boolean().optional(),
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
          reassignUserIds: z.array(z.string()).optional(),
        }),
        async ({ tx, args: { userGroupId, userStates, userMappings, boardWeight, expertiseMappings, timestamp, stateIds = {}, complexityScoreId, mappingIds = {}, reassignUserIds = [] } }) => {
          const now = timestamp;

          // Validate user group exists
          const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
          if (!userGroup) {
            throw new Error('User group not found');
          }

          // Members opted in to a ticket handoff whose deactivation this save actually
          // performs. Detected from the pre-write row rather than trusted from the client,
          // so a stale opt-in for someone already inactive queues nothing.
          const reassignOptIns = new Set(reassignUserIds);
          const handoffTargets: string[] = [];

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

            if (
              reassignOptIns.has(state.userId) &&
              existingState?.isActiveForAssignment === true &&
              !isActiveForAssignment
            ) {
              handoffTargets.push(state.userId);
            }

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

            await tx.mutate.user_assignment_states.upsert({ ...stateData, workspaceId: authData.workspaceId });
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
              if (!complexityScoreId) {
                throw new Error('complexityScoreId is required when creating a new board complexity score');
              }
              await tx.mutate.board_complexity_scores.insert({
                workspaceId: authData.workspaceId,
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

                await tx.mutate.user_expertise_mappings.upsert({ ...mappingData, workspaceId: authData.workspaceId });
              } else if (existingMapping) {
                // Remove mapping if no special configuration
                await tx.mutate.user_expertise_mappings.delete({
                  id: existingMapping.id,
                });
              }
            }
          }

          // Hand off after the states commit, so members deactivated in this same save
          // can't inherit each other's tickets and a rolled-back save queues nothing.
          // The service re-checks workspace, the group's reassignOnUnavailable setting
          // and membership against committed rows.
          if (handoffTargets.length > 0) {
            awaitedPostCommitTasks.push(async () => {
              for (const targetUserId of handoffTargets) {
                try {
                  const result = await userAssignmentStateService.reassignMemberTicketsInGroup(
                    targetUserId,
                    userGroupId,
                    authData.workspaceId,
                  );
                  if (!result.scheduled) {
                    logger.warn(
                      `⚠️ [TICKET-REASSIGNMENT] Handoff for deactivated user ${targetUserId} in group ${userGroupId} not scheduled: ${result.reason}`
                    );
                  }
                } catch (error) {
                  logger.error(
                    `❌ [TICKET-REASSIGNMENT] Failed to schedule handoff for deactivated user ${targetUserId} in group ${userGroupId}:`,
                    error
                  );
                }
              }
            });
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
            workspaceId: authData.workspaceId,
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
    sdlc: {
      createLink: defineMutator(
        createSdlcLinkSchema.extend({
          id: z.string(),
          channelId: z.string(),
          timestamp: z.number(),
        }),
        async ({ tx, args }) => {
          // Links belong to the hub. createSdlcLinkSchema already excludes the
          // membership relation, so this cannot forge a CHANNEL -> REPOSITORY edge.
          const participant = await tx.run(
            zql.channel_participants
              .where('channelId', args.channelId)
              .where('userId', authData.sub)
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
            workspaceId: authData.workspaceId,
            channelId: args.channelId,
            sourceType: args.sourceType,
            sourceId: args.sourceId,
            targetType: args.targetType,
            targetId: args.targetId,
            relationType: args.relationType,
            createdBy: authData.sub,
            createdAt: args.timestamp,
          });
        },
      ),
      deleteLink: defineMutator(
        z.object({ channelId: z.string(), linkId: z.string() }),
        async ({ tx, args: { channelId, linkId } }) => {
          const participant = await tx.run(
            zql.channel_participants
              .where('channelId', channelId)
              .where('userId', authData.sub)
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
        async ({ tx, args }) => {
          // Tracks belong to the hub, never to one repository in it.
          const participant = await tx.run(
            zql.channel_participants
              .where('channelId', args.channelId)
              .where('userId', authData.sub)
              .one(),
          );
          if (!participant) {
            throw new Error('Hub membership required');
          }
          await tx.mutate.sdlc_tracks.insert({
            id: args.id,
            workspaceId: authData.workspaceId,
            name: args.name,
            description: args.description,
            status: 'ACTIVE',
            createdBy: authData.sub,
            createdAt: args.timestamp,
            updatedAt: args.timestamp,
          });
          // The track carries no scope column; this edge is what places it in the hub.
          await tx.mutate.sdlc_entity_links.insert({
            id: args.linkId,
            workspaceId: authData.workspaceId,
            channelId: args.channelId,
            sourceType: 'CHANNEL',
            sourceId: args.channelId,
            targetType: 'TRACK',
            targetId: args.id,
            relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
            createdBy: authData.sub,
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
        async ({ tx, args }) => {
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
              .where('userId', authData.sub)
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
          fieldIds: z.record(z.string(), z.string()).optional(),
        }),
        async ({
          tx,
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
          // definition columns and are edited in place to keep ids + values stable.
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
            // Never compact field sequences on update/delete. Gaps are expected.
            let currentMaxFieldSequence = existingRows.reduce(
              (max, row) => Math.max(max, row.sequenceNumber ?? 0),
              0,
            );
            const allocateFieldSequence = async (): Promise<number> => {
              const allocated = await EntitySequenceService.getNextFormFieldSequence(
                formId,
                currentMaxFieldSequence,
              );
              currentMaxFieldSequence = Math.max(currentMaxFieldSequence, allocated);
              return allocated;
            };
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
                workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
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
              const sequenceNumber = await allocateFieldSequence();
              await tx.mutate.form_fields.insert({
                workspaceId: authData.workspaceId,
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
                const sequenceNumber = await allocateFieldSequence();
                await tx.mutate.form_fields.insert({
                  workspaceId: authData.workspaceId,
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
              workspaceId: authData.workspaceId,
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
          const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
          const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

          // DOC fields no longer require a claim here — the upload pipeline
          // (POST /attachments/upload from StageFormModal.handleSubmit) writes
          // the MessageAttachment row directly with entityType=FORM_ENTITY_VALUE
          // and entityId = this row's id (pre-allocated client-side). So by the
          // time we insert the form value row, the attachment is already
          // pointing at it correctly.

          // Upsert the form entity value
          await tx.mutate.form_entity_values.insert({
            workspaceId: authData.workspaceId,
            id,
            formId,
            entityId,
            entityType,
            fieldId: resolvedFieldId,
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

          if (entityType === FormEntityType.TICKET && fieldName === 'releaseVersion') {
            asyncTasks.push(async () => {
              try {
                await versionReleaseMappingService.syncTicketById(entityId);
              } catch (error) {
                logger.error('release_mapping_sync_failed', { entityId, error });
              }
            });
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
          // Resolve the field definition. fieldId may reference a new global_fields
          // definition or a legacy form_fields row.
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
          const fieldName = globalField?.fieldName ?? legacyField?.globalField?.fieldName ?? legacyField?.fieldName;
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
          const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
          const actualFieldValue = isMultiValue ? newValue : newValue[0] || null;

          // DOC fields no longer require a claim here — the upload pipeline
          // (POST /attachments/upload from StageFormModal.handleSubmit) writes
          // the MessageAttachment row directly with entityType=FORM_ENTITY_VALUE
          // and entityId = this row's id (pre-allocated client-side). So by the
          // time we insert the form value row, the attachment is already
          // pointing at it correctly.

          // Upsert the form entity value
          await tx.mutate.form_entity_values.insert({
            workspaceId: authData.workspaceId,
            id,
            formId,
            entityId,
            entityType,
            fieldId: resolvedFieldId,
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

          if (entityType === FormEntityType.TICKET && fieldName === 'releaseVersion') {
            asyncTasks.push(async () => {
              try {
                await versionReleaseMappingService.syncTicketById(entityId);
              } catch (error) {
                logger.error('release_mapping_sync_failed', { entityId, error });
              }
            });
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
          const isMultiValue = fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;
          const valueToStore = isMultiValue
            ? newValue              // Store array for MULTI_SELECT/USER (including empty arrays)
            : newValue[0] || null;  // Store first element or null for other types

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

          if (
            formEntityValue.entityType === FormEntityType.TICKET &&
            resolvedFieldName === 'releaseVersion'
          ) {
            asyncTasks.push(async () => {
              try {
                await versionReleaseMappingService.syncTicketById(formEntityValue.entityId);
              } catch (error) {
                logger.error('release_mapping_sync_failed', { entityId: formEntityValue.entityId, error });
              }
            });
          }
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
            workspaceId: authData.workspaceId,
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
              workspaceId: authData.workspaceId,
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
            // Merge: only overwrite fields explicitly provided, so body-only and
            // recipients-only saves don't clobber each other.
            await tx.mutate.email_drafts.update({
              id: existing.id,
              ...(draftContent !== undefined && { draftContent }),
              ...(attachmentIds !== undefined && { attachmentIds }),
              // Recipient columns are TEXT ("string only") — store a JSON-stringified string[].
              ...(toRecipients !== undefined && { toRecipients: JSON.stringify(toRecipients) }),
              ...(ccRecipients !== undefined && { ccRecipients: JSON.stringify(ccRecipients) }),
              ...(bccRecipients !== undefined && {
                bccRecipients: JSON.stringify(bccRecipients),
              }),
              updatedAt,
            });
          } else {
            await tx.mutate.email_drafts.insert({
              workspaceId: authData.workspaceId,
              id,
              conversationId,
              channelId,
              userId: ctx.userID,
              draftContent: draftContent ?? '',
              ...(attachmentIds !== undefined && { attachmentIds }),
              ...(toRecipients !== undefined && { toRecipients: JSON.stringify(toRecipients) }),
              ...(ccRecipients !== undefined && { ccRecipients: JSON.stringify(ccRecipients) }),
              ...(bccRecipients !== undefined && {
                bccRecipients: JSON.stringify(bccRecipients),
              }),
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
      // KEEP IN SYNC with shared. Compose drafts (no thread yet), keyed by draft id.
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
              workspaceId: authData.workspaceId,
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
    // KEEP IN SYNC with shared/src/zero/mutators.ts conversationLabel.
    // Gmail-style labels for desk/support conversations. Labels are private to their
    // creator: catalog is per-channel, per-user (createdBy); mappings attach to a thread.
    conversationLabel: {
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
          // Free-form, not z.enum: the workspace vocabulary is a starting point, and people
          // type their own. Length-capped so a tag stays a label rather than a paragraph.
          types: z.array(z.string().trim().min(1).max(40)),
          /**
           * What a newly invented tag means. Stored as the vocabulary candidate's
           * description, not on the thread — see the candidate write below.
           */
          note: z.string().trim().max(280).optional(),
          timestamp: z.number(),
        }),
        async ({ tx, ctx, args: { conversationId, types, note, timestamp } }) => {
          const conversation = await tx.run(
            zql.conversations.where('conversationId', conversationId).one(),
          );
          if (!conversation) throw new Error('Conversation not found');

          const existing = parseAppliedTags(conversation.threadType);
          const byName = new Map(existing.map(tag => [tag.name, tag]));

          // Normalise the names being ADDED, and only those. A name already on this thread is
          // passed through untouched: the caller resends the full set on every edit, so
          // normalising indiscriminately would silently rewrite tags applied long ago, on an
          // edit that had nothing to do with them, leaving the same tag spelled two ways
          // across the workspace.
          const desired = [
            ...new Set(
              types
                .map(raw => {
                  const trimmed = raw.trim();
                  return byName.has(trimmed) ? trimmed : normalizeThreadTypeName(trimmed);
                })
                .filter(Boolean),
            ),
          ];

          // A merge, never a replace. The caller sends the full desired set, but each tag
          // already there keeps its own provenance — who applied it and when. Rewriting them all
          // as freshly hand-applied would erase exactly the trail the tooltip exists to show.
          const next: AppliedTag[] = [];
          // Names THIS call applied fresh. Not the same as "every human tag on the thread":
          // a tag someone else added survives the merge with their `by` intact, and sweeping
          // those up would file a candidate crediting the wrong person every time anyone
          // touched the thread's tags.
          const addedNames: string[] = [];
          for (const name of desired) {
            const prior = byName.get(name);
            if (prior && !prior.removed) {
              next.push(prior);
              continue;
            }
            next.push({ name, at: timestamp, by: ctx.userID });
            addedNames.push(name);
          }

          // Dropped tags are tombstoned, not deleted: removal has to stay auditable, and a
          // deleted tag would look unclassified to the classifier and come straight back.
          const kept = new Set(desired);
          for (const tag of existing) {
            if (kept.has(tag.name)) continue;
            next.push(
              tag.removed ? tag : { ...tag, removed: true, at: timestamp, by: ctx.userID },
            );
          }

          await tx.mutate.conversations.update({
            conversationId,
            threadType: serializeAppliedTags(next),
          });

          // Backend copy only, like the refeed below: a free-form tag someone invented is
          // recorded as a vocabulary candidate for an admin to promote or drop. The tag is
          // already on the thread — this only governs whether the NAME becomes something the
          // picker offers and the classifier may assign.
          const workspaceIdForVocab = conversation.workspaceId;
          if (workspaceIdForVocab && addedNames.length > 0) {
            asyncTasks.push(async () => {
              const vocabulary = await getThreadTypeVocabulary(workspaceIdForVocab);
              const known = new Set(vocabulary.map(entry => entry.name));
              for (const name of addedNames) {
                if (known.has(name)) continue;
                // The note describes the tag, so it lands on the candidate as its
                // description — not copied onto every thread that carries the name.
                await recordVocabularyCandidate(workspaceIdForVocab, name, ctx.userID, note);
              }
            });
          }

          // Backend copy only. Zero collects no side-effect job for conversation updates
          // (SIDE_EFFECT_OPERATION_CONFIG lists insert/delete), and a thread's tags live on
          // the ROOT MESSAGE's Vespa doc — so without this a hand-applied tag never reaches
          // search. Deferred rather than awaited: a Redis round-trip inside the mutation
          // would hold the transaction open, and an unindexed tag must never fail the write.
          const { initialMessageId, workspaceId } = conversation;
          asyncTasks.push(async () => {
            try {
              await vespaQueue.addJob({
                schema: 'chat_message',
                jobType: 'feed',
                docId: initialMessageId,
                userId: ctx.userID,
                ...(workspaceId ? { workspaceId } : {}),
              });
            } catch (error) {
              logger.error('[threadTag] Failed to queue Vespa refeed', { conversationId, error });
            }
          });
        },
      ),
    },
    // KEEP IN SYNC with shared/src/zero/mutators.ts ticketMailbox.
    // Gmail-style per-user mailbox overlay over shared desk tickets. Sparse: a row exists
    // only once the agent acts; absence means { INBOX, not starred }.
    ticketMailbox: {
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
              workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
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
          let existingDraft = null;
          if (conversationId) {
            existingDraft = await tx.run(
              zql.draft_messages
                .where('channelId', channelId)
                .where('userId', authData.sub)
                .where('conversationId', conversationId)
                .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
                .one(),
            );
          } else {
            const channelDrafts = await tx.run(
              zql.draft_messages
                .where('channelId', channelId)
                .where('userId', authData.sub)
                .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))),
            );
            existingDraft = channelDrafts.find(draft => draft.conversationId === null);
          }

          const finalDraftMessageId = existingDraft?.id || draftMessageId;

          // 2. If no draft exists, upsert one atomically
          if (!existingDraft) {
            await tx.mutate.draft_messages.upsert({
              workspaceId: authData.workspaceId,
              id: draftMessageId,
              channelId,
              conversationId: conversationId || null,
              userId: authData.sub,
              content: content || '',
              hasAttachment: true,
              origin: DraftOrigin.user,
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
                  position: index,
                  createdBy: authData.sub,
                  url: '', // Will be populated after upload completes
                  uploadStatus: AttachmentUploadStatus.PENDING,
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
      clearContent: defineMutator(
        z.object({
          channelId: z.string(),
          conversationId: z.string().optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { channelId, conversationId, timestamp } }) => {
          // Called at send-time to detach the draft from the queued message:
          // zeroes content and hasAttachment so `markChannelAsViewed` can
          // garbage-collect the row on channel exit. The DRAFT-typed attachment
          // rows are left in place; the send mutator claims them by id when
          // it fires (immediate or on retry).
          const channelDrafts = await tx.run(
            zql.draft_messages
              .where('channelId', channelId)
              .where('userId', authData.sub)
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
    dashboardComponent: {
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
            workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
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
              try {
                const remainingMappings = await tx.run(
                  zql.dashboard_queries_mapping.where('dashboardId', dashboardId).orderBy('sequence', 'asc')
                );
                for (let i = 0; i < remainingMappings.length; i++) {
                  await tx.mutate.dashboard_queries_mapping.update({
                    id: remainingMappings[i].id,
                    sequence: i,
                  });
                }
              } catch (error) {
                logger.error('dashboard_query_resequence_failed', { dashboardId, error });
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
          comment: z.string().optional(),
          commentMessageId: z.string().optional(),
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
            comment,
            commentMessageId,
          },
        }) => {
          let existingApproval = await tx.run(zql.ticket_stage_requests.where('id', id).one());

          // Revisit: fall back to existing (ticketId, stageId) record if client sent a new UUID.
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

          // Authorize review: only listed approvers may APPROVE/REJECT (blocks self-approval).
          if (
            status === TicketStageRequestStatus.APPROVED ||
            status === TicketStageRequestStatus.REJECTED
          ) {
            await assertCanReviewStageRequest(tx, ticket, stageId, authData.sub);
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
          await tx.mutate.ticket_stage_requests.upsert({ ...payload, workspaceId: authData.workspaceId });

          // Handle activities based on whether this is create or update
          const isNewRequest = !existingApproval; // true only when no prior record existed (checked after fallback lookup)
          if (isNewRequest && requestActivityId) {
            // Create message for a fresh approval request
            const actorName = actor?.name || 'Someone';
            const hasForm = !!formId;
            const actionText = hasForm ? 'submitted the form for' : 'requested approval for';

            await tx.mutate.messages.insert({
              workspaceId: authData.workspaceId,
              messageId: requestActivityId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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
              workspaceId: authData.workspaceId,
              messageId: requestActivityId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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
              workspaceId: authData.workspaceId,
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
            const actionText = hasForm ? 'resubmitted the form for' : 'resubmitted the approval request for';

            await tx.mutate.messages.insert({
              workspaceId: authData.workspaceId,
              messageId: requestActivityId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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
            // Move the ticket to the approved stage.
            // For NON_LINEAR boards also manage visit ETAs; for DEFAULT/RELEASE boards a simple update suffices.
            const board = await tx.run(zql.boards.where('id', ticket.boardId).one());
            if (board?.boardType === BoardType.NON_LINEAR) {
              const now = updatedAt;
              const currentStageObj = await tx.run(
                zql.stages.where('boardId', ticket.boardId).where('name', ticket.stageName).one(),
              );
              const transition = currentStageObj
                ? ((await tx.run(
                    zql.stage_transitions
                      .where('boardId', ticket.boardId)
                      .where('fromStageId', currentStageObj.id)
                      .where('toStageId', stage.id)
                      .one(),
                  )) ?? null)
                : null;

              if (currentStageObj) {
                const currentStageId = currentStageObj.id;
                const ticketIdForEta = ticket.id;
                asyncTasks.push(async () => {
                  try {
                    const currentETAs = await tx.run(
                      zql.ticket_stage_eta
                        .where('ticketId', ticketIdForEta)
                        .where('stageId', currentStageId),
                    );
                    const activeETA = currentETAs.find(e => e.stageLeftAt === null);
                    if (activeETA) {
                      await tx.mutate.ticket_stage_eta.update({
                        id: activeETA.id,
                        stageLeftAt: now,
                        updatedAt: now,
                        updatedBy: authData.sub,
                      });
                    }
                  } catch (error) {
                    logger.error('stage_eta_close_failed', { ticketId: ticketIdForEta, stageId: currentStageId, error });
                  }
                });
              } else {
                // ticket.stageName is a required field, so an unresolvable current stage means it
                // references a stage that no longer exists on the board — corrupt state. Fail fast
                // rather than guessing which ETAs to close.
                throw new Error(
                  `Cannot approve stage change: ticket ${ticket.id} has an unresolvable current stage "${ticket.stageName}"`,
                );
              }

              const targetETAs = await tx.run(
                zql.ticket_stage_eta
                  .where('ticketId', ticket.id)
                  .where('stageId', stage.id),
              );
              const reenterMode = (transition?.onReenter as ReenterMode | undefined) ?? ReenterMode.RESET;
              const maxVisitIndex =
                targetETAs.length > 0 ? Math.max(...targetETAs.map(e => e.version ?? 1)) : 0;

              // Data-driven visit versioning (see visitVersioning.ts). In this approval path the
              // "submission" is the frontend's guessed rows (version > maxVisitIndex, created
              // before this visit's ETA exists); the "prior visit" is the rows at maxVisitIndex.
              const existingEtaIdAtMaxVersion =
                maxVisitIndex === 0
                  ? null
                  : (targetETAs
                      .filter(e => (e.version ?? 1) === maxVisitIndex)
                      .sort((a, b) => b.stageEnteredAt - a.stageEnteredAt)[0]?.id ?? null);

              // Build a fieldId → fieldName map from the transition's form so the stored rows
              // (keyed by fieldId) can be folded to the fieldName → value shape the comparison
              // helper expects. When the transition has no formId there is nothing to compare →
              // empty maps → equality → reuse path (safe default).
              let fieldIdToName = new Map<string, string>();
              if (transition?.formId) {
                const transitionFormFields = await tx.run(
                  zql.form_fields.where('formId', transition.formId).related('globalField'),
                );
                fieldIdToName = new Map(
                  transitionFormFields
                    .map(f => {
                      const resolvedId = f.globalFieldId ?? f.id;
                      const name = f.globalField?.fieldName ?? f.fieldName;
                      return name ? ([resolvedId, name] as const) : null;
                    })
                    .filter((entry): entry is readonly [string, string] => entry !== null),
                );
              }

              // Read all form values for (ticket, stage) once; both the guessed submission and
              // the prior visit's values come from this single read (also reused by the
              // normalize step below, so no extra query is introduced).
              const allFormValuesForVersioning = await tx.run(
                zql.form_entity_values
                  .where('entityId', ticket.id)
                  .where('contextId', stage.id),
              );
              // submittedValues = the frontend's guessed submission (version > maxVisitIndex).
              const guessedRows = allFormValuesForVersioning.filter(
                r => (r.version ?? 1) > maxVisitIndex,
              );
              const submittedValues = foldFormRowsToValues(guessedRows, fieldIdToName);
              // latestValues = the prior visit's values (version === maxVisitIndex). Empty when
              // there is no prior visit (maxVisitIndex === 0).
              const priorRows = allFormValuesForVersioning.filter(
                r => (r.version ?? 1) === maxVisitIndex,
              );
              const latestValues = foldFormRowsToValues(priorRows, fieldIdToName);

              const {
                newVersion: newVisitIndex,
                existingEtaId,
                isNewVersion,
                rebaseEta,
              } = decideVisitVersion({
                maxVersion: maxVisitIndex,
                existingEtaIdAtMaxVersion,
                submittedValues,
                latestValues,
                reenterMode,
              });

              const stageEtaDeadline = computeStageEtaDeadline(
                now,
                (transition?.visitSlaMode as VisitSlaMode | undefined) ?? VisitSlaMode.STAGE_DEFAULT,
                transition?.fixedEtaHours,
                stage.eta,
              );

              if (existingEtaId) {
                // REUSE (form unchanged): rebaseEta (RESET) restarts the clock; CONTINUE keeps it.
                if (rebaseEta) {
                  await tx.mutate.ticket_stage_eta.update({
                    id: existingEtaId,
                    stageEnteredAt: now,
                    stageLeftAt: null,
                    stageEta: stageEtaDeadline,
                    updatedAt: now,
                    updatedBy: authData.sub,
                  });
                } else {
                  // CONTINUE: only clear stageLeftAt (do NOT touch stageEnteredAt/stageEta).
                  await tx.mutate.ticket_stage_eta.update({
                    id: existingEtaId,
                    stageLeftAt: null,
                    updatedAt: now,
                    updatedBy: authData.sub,
                  });
                }
              } else {
                // NEW visit version (first visit, or form changed): insert a fresh ETA row at
                // newVisitIndex with a clock started from now.
                await tx.mutate.ticket_stage_eta.insert({
                  workspaceId: authData.workspaceId,
                  id: uuidv4(),
                  ticketId: ticket.id,
                  stageId: stage.id,
                  version: newVisitIndex,
                  stageEnteredAt: now,
                  stageLeftAt: null,
                  stageEta: stageEtaDeadline,
                  createdAt: now,
                  updatedBy: authData.sub,
                });
              }

              // Reconcile the frontend's guessed form-value versions (version > maxVisitIndex,
              // created before the ETA exists) to the authoritative newVisitIndex. NEW version:
              // re-stamp them up to newVisitIndex. REUSE: the guessed rows are identical to the
              // prior visit's rows at maxVisitIndex, so collapse them (delete + bump surviving row).
              const normalizeFormValueVersions = async () => {
                const allFormValues = await tx.run(
                  zql.form_entity_values
                    .where('entityId', ticket.id)
                    .where('contextId', stage.id),
                );
                // Identify THIS submission's values by version, not by timestamp.
                //
                // Every completed prior visit has an ETA, so its form values live at a version
                // <= maxVisitIndex. The frontend creates the current submission's values at a
                // GUESSED version (maxStageVersion + 1) before this visit's ETA exists, so the
                // only values with no ETA backing them — version > maxVisitIndex — are the
                // current submission's guesses. Re-stamp ONLY those to the authoritative
                // newVisitIndex. Values at version <= maxVisitIndex are real prior visits and
                // must never be moved or deleted — the old "updatedAt > prevLeftAt" heuristic
                // could mis-flag them, collapsing two visits onto one version (lost submissions).
                const staleValues = allFormValues.filter(
                  fv =>
                    (fv.version ?? 1) > maxVisitIndex &&
                    (fv.version ?? 1) !== newVisitIndex,
                );
                for (const fv of staleValues) {
                  const existingAtTarget = allFormValues.find(
                    other =>
                      other.id !== fv.id &&
                      other.fieldId === fv.fieldId &&
                      (other.version ?? 1) === newVisitIndex,
                  );
                  if (existingAtTarget) {
                    // newVisitIndex is already occupied for this field. NEW version: the
                    // occupant is a DIFFERENT visit's form — never overwrite it (leave this
                    // guessed row at its own version). REUSE: the occupant is the identical
                    // prior-visit row — delete the redundant guess and bump the survivor.
                    if (!isNewVersion) {
                      await tx.mutate.form_entity_values.delete({ id: fv.id });
                      await tx.mutate.form_entity_values.update({
                        id: existingAtTarget.id,
                        updatedAt: now,
                      });
                    }
                    continue;
                  }
                  await tx.mutate.form_entity_values.update({
                    id: fv.id,
                    version: newVisitIndex,
                    updatedAt: now,
                  });
                }
              };
              // Always run: leftover guessed rows (version > maxVisitIndex) would otherwise
              // orphan at a version above the reused one, violating the unique constraint on
              // re-entry and polluting the next version decision.
              await normalizeFormValueVersions();

              await tx.mutate.tickets.update({
                id: ticket.id,
                stageName: stage.name,
                ...(stage.defaultTicketStatusV2 && { statusV2: stage.defaultTicketStatusV2 }),
                updatedAt,
              });
            } else {
              await tx.mutate.tickets.update({
                id: ticket.id,
                stageName: stage.name,
                ...(stage.defaultTicketStatusV2 && { statusV2: stage.defaultTicketStatusV2 }),
                updatedAt,
              });
            }

            // Create message for approval
            const actorName = actor?.name || 'Someone';
            const hasForm = !!formId;
            const actionText = hasForm ? 'approved the form for' : 'approved the stage change to';

            await tx.mutate.messages.insert({
              workspaceId: authData.workspaceId,
              messageId: approvedActivityId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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
              workspaceId: authData.workspaceId,
              messageId: rejectedActivityId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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

          // Reviewer's comment, attached to APPROVE/REJECT decisions. Stored as
          // a regular USER message in the ticket conversation (so it renders
          // inline with the rest of the ticket timeline) and linked from the
          // request row via reviewerCommentMessageId for direct lookup from the
          // form modal. The content is prefixed with "Rejection comment:" /
          // "Approval comment:" so it reads sensibly in the ticket thread (the
          // action + actor are already carried by the sibling SYSTEM message
          // just above). The raw comment text is kept in metadata.rawComment
          // for places that want to display it without the prefix (e.g. the
          // modal's "Reason for rejection" block).
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
              workspaceId: authData.workspaceId,
              messageId: commentMessageId,
              conversationId: ticket.conversationId,
              senderId: updatedBy,
              ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
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
            workspaceId: authData.workspaceId,
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
              throw new Error('Application release sub-ticket not found');
            }

            const mapping = await tx.run(
              zql.ticket_sub_ticket_mappings
                .where('ticketId', releaseId)
                .where('subTicketId', releaseApplicationId)
                .one(),
            );
            if (!mapping) {
              throw new Error('Application release sub-ticket is not linked to this release ticket');
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
            workspaceId: authData.workspaceId,
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
              throw new Error('Application release sub-ticket not found');
            }

            const mapping = await tx.run(
              zql.ticket_sub_ticket_mappings
                .where('ticketId', effectiveReleaseId)
                .where('subTicketId', releaseApplicationId)
                .one(),
            );
            if (!mapping) {
              throw new Error('Application release sub-ticket is not linked to this release ticket');
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
    applicationReleaseTicket: {
      // Per-ticket ART testing update. A dev ticket's test/stage state is
      // single-sourced on the ticket (statusV2 / stageName) — ART no longer
      // stores a status column. testedAt toggles on terminal stages
      // (COMPLETED / CANCELLED) for every ART row associated with the dev
      // ticket; testedBy is NOT touched here (it's driven separately by
      // setTestedBy — the QA-assignment picker on the Testing tab). The live
      // dev ticket is resolved via ART.ticketId and updated in the same
      // mutation so the stage change reflects on the actual ticket.
      updateStatus: defineMutator(
        z.object({
          id: z.string(),
          stageName: z.string().optional(),
          defaultTicketStatusV2: z.nativeEnum(TicketStatusV2).optional(),
          failureReason: z.string().optional().nullable(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, stageName, defaultTicketStatusV2, failureReason, timestamp } }) => {
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

          // Only drive the dev ticket's status when a stage status was actually
          // supplied; otherwise leave statusV2 untouched (don't silently reset to TODO).
          const devTicket = await tx.run(zql.tickets.where('id', row.ticketId).one());
          if (devTicket) {
            await tx.mutate.tickets.update({
              id: devTicket.id,
              ...(defaultTicketStatusV2 !== undefined && { statusV2: defaultTicketStatusV2 }),
              ...(stageName !== undefined && { stageName }),
              updatedAt: timestamp,
            });
          }

          // Emit a TESTING event to the release timeline so the user can see
          // QA stage changes in the audit feed. Requires looking up the release
          // ticket for channelId/conversationId (ART doesn't store them).
          if (stageName) {
            const releaseTicket = await tx.run(
              zql.tickets.where('id', row.releaseId).one(),
            );
            if (releaseTicket) {
              const devTitle = devTicket?.title ?? 'dev ticket';
              const message = failureReason
                ? `${devTitle} → ${stageName} (reason: ${failureReason})`
                : `${devTitle} → ${stageName}`;
              await tx.mutate.release_events.insert({
                id: uuidv4(),
                workspaceId: authData.workspaceId,
                releaseId: row.releaseId,
                applicationReleaseId: row.applicationReleaseId ?? undefined,
                eventType: ReleaseEventType.TESTING,
                eventName: 'STAGE_CHANGED',
                message,
                userId: authData.sub,
                userName: authData.name,
                channelId: releaseTicket.channelId ?? '',
                conversationId: releaseTicket.conversationId,
                createdAt: timestamp,
              });
            }
          }
        },
      ),
      // Set the QA assigned to test this ART row. Independent of status; users
      // can assign before testing starts. Pass userId=null to unassign.
      setTestedBy: defineMutator(
        z.object({
          id: z.string(),
          userId: z.string().nullable(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, userId, timestamp } }) => {
          const row = await tx.run(zql.application_release_tickets.where('id', id).one());
          if (!row) {
            throw new Error('ART row not found');
          }
          // Reject dangling user references: only persist testedBy for a real
          // user (null clears the assignment).
          if (userId !== null) {
            const user = await tx.run(zql.users.where('id', userId).one());
            if (!user) {
              throw new Error('User not found');
            }
          }
          await tx.mutate.application_release_tickets.update({
            id,
            testedBy: userId,
            updatedAt: timestamp,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
                workspaceId: authData.workspaceId,
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
            workspaceId: authData.workspaceId,
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
              workspaceId: authData.workspaceId,
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
          isStarred: z.boolean().optional(),
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
        async ({ tx, args: { configId, name, visibility, isStarred, timestamp, values } }) => {
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
            ...(isStarred !== undefined && { isStarred }),
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
                workspaceId: authData.workspaceId,
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

          // Creator editing the template: webhook is written to the APP (template) and version
          // is bumped so installs see an Update prompt. (Per-install webhook edits go via REST.)
          const updateData: { id: string; updatedAt: number; version: number; name?: string; description?: string | null; webhookUrl?: string | null } = {
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
        }),
        async ({ tx, args: { id, name, content, timestamp } }) => {
          await tx.mutate.email_signatures.insert({
            workspaceId: authData.workspaceId,
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
        async ({ tx, args: { userId, workspaceId, updates, timestamp } }) => {
          // ACL check is handled by UsersACL
          await tx.mutate.users.update({
            id: userId,
            ...updates,
            updatedAt: timestamp,
          });

          if (updates.role !== undefined) {
            if (updates.role === WorkspaceRole.ADMIN) {
              // Promote: grant the full ADMIN permission matrix, same as invite-accept
              // (grantPermissionsForRole), so "becomes an admin" is consistent regardless
              // of whether the user was invited straight in as ADMIN or promoted later.
              const user = await tx.run(zql.users.where('id', userId).one());
              if (user) {
                const { email } = user;
                asyncTasks.push(() =>
                  grantPermissionsForRole(userId, email, WorkspaceRole.ADMIN, workspaceId),
                );
              }
            } else {
              // Demote: only revoke WORKSPACE. Deliberately not a full matrix revoke —
              // avoids stripping resource access that may have been granted independently
              // via the Roles screen (no provenance tracking exists to tell them apart).
              asyncTasks.push(() =>
                syncResourceAdminAccess(userId, 'WORKSPACE', false, authData.sub, workspaceId),
              );
            }
          }
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

          await getEncryptionProvider().initializeOrg(orgId);

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
            if (existing.leftAt) {
              await organizationDomainService.assertOrgMemberLimit(orgId, email);
            }
            await tx.mutate.org_members.update({
              memberId: existing.memberId,
              leftAt: null,
              joinedAt: timestamp,
            });
          } else {
            await organizationDomainService.assertOrgMemberLimit(orgId, email);
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

          if (updates.role !== undefined) {
            const member = await tx.run(zql.org_members.where('memberId', memberId).one());
            if (member) {
              const shouldHaveAccess = updates.role === OrgRole.ADMIN || updates.role === OrgRole.OWNER;
              const { orgId, email } = member;
              asyncTasks.push(() =>
                syncOrgResourceAdminAccess(orgId, email, shouldHaveAccess, authData.sub),
              );
            }
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
      setSidebarGroupPreference: defineMutator(
        z.object({
          id: z.string(),
          group: z.enum(['starred', 'channels', 'dms']),
          filterMode: z.nativeEnum(ChannelFilterMode).optional(),
          sortOrder: z.nativeEnum(ChannelSortOrder).optional(),
          timestamp: z.number(),
        }),
        async ({ tx, args: { id, group, filterMode, sortOrder, timestamp } }) => {
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
          const existing = await tx.run(zql.user_preferences.where('userId', authData.sub).one());
          if (existing) {
            await tx.mutate.user_preferences.update({
              id: existing.id,
              ...fields,
              updatedAt: timestamp,
            });
          } else {
            await tx.mutate.user_preferences.insert({
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
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
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
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
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
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
        async ({ tx, args: { id, allowThreadBroadcastMentions, timestamp } }) => {
          const existing = await tx.run(
            zql.user_preferences.where('userId', authData.sub).one(),
          );
          if (existing) {
            await tx.mutate.user_preferences.update({
              id: existing.id,
              allowThreadBroadcastMentions,
              updatedAt: timestamp,
            });
          } else {
            await tx.mutate.user_preferences.insert({
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
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
          globalDesktopNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
          globalMobileNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
          threadReplyNotificationsEnabled: z.boolean().optional(),
          channelWideMentionsEnabled: z.boolean().optional(),
          timestamp: z.number(),
        }),
        async ({
          tx,
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
            zql.user_preferences.where('userId', authData.sub).one(),
          );
          if (existing) {
            await tx.mutate.user_preferences.update({
              id: existing.id,
              ...(globalDesktopNotificationLevel !== undefined && { globalDesktopNotificationLevel: globalDesktopNotificationLevel as NotificationLevel }),
              ...(globalMobileNotificationLevel !== undefined && { globalMobileNotificationLevel: globalMobileNotificationLevel as NotificationLevel }),
              ...(threadReplyNotificationsEnabled !== undefined && { threadReplyNotificationsEnabled }),
              ...(channelWideMentionsEnabled !== undefined && { channelWideMentionsEnabled }),
              updatedAt: timestamp,
            });
          } else {
            await tx.mutate.user_preferences.insert({
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
              channelSortOrder: ChannelSortOrder.RECENCY,
              enterSendsMessage: true,
              allowThreadBroadcastMentions: false,
              globalDesktopNotificationLevel: (globalDesktopNotificationLevel ?? NotificationLevel.MENTIONS_ONLY) as NotificationLevel,
              globalMobileNotificationLevel: (globalMobileNotificationLevel ?? NotificationLevel.MENTIONS_ONLY) as NotificationLevel,
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
        async ({ tx, args: { id, keywords, timestamp } }) => {
          const notificationKeywords = JSON.stringify(normalizeNotificationKeywords(keywords));
          const existing = await tx.run(
            zql.user_preferences.where('userId', authData.sub).one(),
          );
          if (existing) {
            await tx.mutate.user_preferences.update({
              id: existing.id,
              notificationKeywords,
              updatedAt: timestamp,
            });
          } else {
            await tx.mutate.user_preferences.insert({
              workspaceId: authData.workspaceId,
              id,
              userId: authData.sub,
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
            const deskType = deskTypeForChannelType(channel?.type);
            await tx.mutate.email_channel_preferences.insert({
              workspaceId: authData.workspaceId,
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
              twoStepSendEnabled: twoStepSendEnabled ?? false,
              autoDraftMode: autoDraftMode ?? AutoDraftMode.OFF,
              deskType,
              autoDraftAgentSlug: autoDraftAgentSlug ?? null,
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
              workspaceId: authData.workspaceId,
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
              workspaceId: authData.workspaceId,
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
        async ({ tx, args }) => {
          await tx.mutate.classification_mappings.insert({ ...args, workspaceId: authData.workspaceId });
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
              workspaceId: authData.workspaceId,
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
        async ({ tx, args: { id, scopeType, scopeId, name, description, isPrivate, permissionId, timestamp } }) => {
          // Verify user is a channel participant (for CHANNEL scope)
          if (scopeType === 'CHANNEL') {
            const isParticipant = await tx.run(
              zql.channels
                .where('id', scopeId)
                .whereExists('participants', (p) => p.where('userId', authData.sub))
                .one(),
            );
            if (!isParticipant) {
              throw new Error('Collection creation failed: you must be a channel participant');
            }
          }

          // Check for existing non-deleted collection with same name in this scope
          const existingCollection = await db.collection.findFirst({
            where: { ownerId: authData.sub, name, scopeType, scopeId, deletedAt: null },
            select: { id: true },
          });
          if (existingCollection) {
            throw new Error(`Collection "${name}" already exists`);
          }

          await tx.mutate.collections.insert({
            workspaceId: authData.workspaceId,
            id,
            scopeType,
            scopeId,
            name,
            description: description ?? undefined,
            ownerId: authData.sub,
            isPrivate: isPrivate ?? false,
            rootCollectionId: id,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          // Add creator as OWNER in collection_permissions
          await tx.mutate.collection_permissions.insert({
            workspaceId: authData.workspaceId,
            id: permissionId,
            collectionId: id,
            userId: authData.sub,
            role: CollectionRole.OWNER,
            canShare: true,
            grantedBy: authData.sub,
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
        async ({ tx, args: { id, name, description, isPrivate, timestamp } }) => {
          const collection = await tx.run(zql.collections.where('id', id).one());
          if (!collection) {
            throw new Error('Collection not found');
          }

          // OWNER is a real, multi-holder role — the creator (ownerId) is a
          // separate, permanent label, not the sole authority. Either grants
          // full owner privilege here.
          const isCreator = collection.ownerId === authData.sub;
          const permissionRole = isCreator
            ? null
            : await resolveCollectionPermissionRole(tx, id, authData.sub);
          const canActAsOwner = isCreator || permissionRole === CollectionRole.OWNER;

          // Visibility is owner-only: flipping isPrivate changes who can see
          // the collection at all, so EDITOR permissions are not enough.
          if (isPrivate !== undefined && !canActAsOwner) {
            throw new Error('Collection update failed: only an owner can change visibility');
          }

          // Rename is owner-only too: collection names are surfaced wherever
          // the collection is referenced (sidebar, breadcrumbs, share UI),
          // so we treat the title the same as visibility — a property only
          // owners are allowed to change.
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
        async ({ tx, args: { id, timestamp } }) => {
          const collection = await tx.run(zql.collections.where('id', id).one());
          if (!collection) {
            throw new Error('Collection not found');
          }
          if (collection.ownerId !== authData.sub) {
            const permissionRole = await resolveCollectionPermissionRole(tx, id, authData.sub);
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

          // Queue Vespa delete jobs for all affected items
          for (const item of items) {
            const docItemId = item.id;
            asyncTasks.push(async () => {
              try {
                await vespaQueue.addJob({
                  schema: 'file',
                  docId: docItemId,
                  jobType: 'delete',
                  userId: authData.sub,
                });
              } catch (error) {
                logger.error(
                  `[MUTATOR-DELETE-COLLECTION] Failed to queue Vespa delete for item ${docItemId}:`,
                  error,
                );
              }
            });
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
        async ({ tx, args: { id, parentId, name, timestamp } }) => {
          const parentCollection = await tx.run(zql.collections.where('id', parentId).one());
          if (!parentCollection) {
            throw new Error('Collection not found');
          }

          // Verify EDITOR+ permission against the root collection (permissions only exist on root collections)
          const rootCollectionId = parentCollection.rootCollectionId ?? parentId;
          const isOwner = parentCollection.ownerId === authData.sub;
          if (!isOwner) {
            const permissionRole = await resolveCollectionPermissionRole(tx, rootCollectionId, authData.sub);
            if (!permissionRole || permissionRole === CollectionRole.VIEWER) {
              throw new Error('Folder creation failed: requires EDITOR or OWNER permission');
            }
          }

          await tx.mutate.collections.insert({
            workspaceId: authData.workspaceId,
            id,
            parentId,
            ownerId: authData.sub,
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
        async ({ tx, args: { id, collectionId, timestamp } }) => {
          const collection = await tx.run(zql.collections.where('id', collectionId).one());
          if (!collection) {
            throw new Error('Collection not found');
          }

          // Verify EDITOR+ permission against the root collection (permissions only exist on root collections)
          const rootCollectionId = collection.rootCollectionId ?? collectionId;
          const isOwner = collection.ownerId === authData.sub;
          if (!isOwner) {
            const permissionRole = await resolveCollectionPermissionRole(tx, rootCollectionId, authData.sub);
            if (!permissionRole || permissionRole === CollectionRole.VIEWER) {
              throw new Error('Item deletion failed: requires EDITOR or OWNER permission');
            }
          }

          // In the new design, folders are Collection rows and files are CollectionItem rows.
          const folder = await tx.run(zql.collections.where('id', id).one());
          if (folder) {
            // Deleting a folder: soft-delete the sub-collection and all its files
            await tx.mutate.collections.update({ id, deletedAt: timestamp });

            const folderItems = await tx.run(
              zql.collection_items.where('collectionId', id).where('deletedAt', 'IS', null),
            );
            for (const item of folderItems) {
              await tx.mutate.collection_items.update({ id: item.id, deletedAt: timestamp });
              asyncTasks.push(async () => {
                try {
                  await vespaQueue.addJob({
                    schema: 'file',
                    docId: item.id,
                    jobType: 'delete',
                    userId: authData.sub,
                  });
                } catch (error) {
                  logger.error(`[MUTATOR-DELETE-ITEM] Failed to queue Vespa delete for item ${item.id}:`, error);
                }
              });
            }
          } else {
            // Deleting a file
            await tx.mutate.collection_items.update({ id, deletedAt: timestamp });
            asyncTasks.push(async () => {
              try {
                await vespaQueue.addJob({
                  schema: 'file',
                  docId: id,
                  jobType: 'delete',
                  userId: authData.sub,
                });
              } catch (error) {
                logger.error(`[MUTATOR-DELETE-ITEM] Failed to queue Vespa delete for item ${id}:`, error);
              }
            });
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
        async ({ tx, args: { id, collectionId, name, timestamp } }) => {
          const collection = await tx.run(zql.collections.where('id', collectionId).one());
          if (!collection) {
            throw new Error('Collection not found');
          }

          // Verify EDITOR+ permission against the root collection (permissions only exist on root collections)
          const rootCollectionId = collection.rootCollectionId ?? collectionId;
          const isOwner = collection.ownerId === authData.sub;
          if (!isOwner) {
            const permissionRole = await resolveCollectionPermissionRole(tx, rootCollectionId, authData.sub);
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
        async ({ tx, args: { id, collectionId, userId, userGroupId, channelId, role, timestamp } }) => {
          const collection = await tx.run(zql.collections.where('id', collectionId).one());
          if (!collection) {
            throw new Error('Collection not found');
          }
    // OWNER is a real, multi-holder role (like EDITOR/VIEWER) — the creator
    // (collection.ownerId) is a separate, permanent, never-reassigned label,
    // not the sole authority. Anyone holding an OWNER permission row gets the
    // same full privilege as the creator here.
    const isCreator = collection.ownerId === authData.sub;
    const rootCollectionId = collection.rootCollectionId ?? collectionId;
    const granterRole = isCreator
      ? null
      : await resolveCollectionPermissionRole(tx, rootCollectionId, authData.sub);
    const granterIsOwner = isCreator || granterRole === CollectionRole.OWNER;

    // Anyone with an explicit role (Viewer/Editor/Owner) can share — there's
    // no separate delegated "canShare" permission. The only real limit is
    // role escalation: you can't grant a role higher than your own.
    if (!granterIsOwner) {
      if (!granterRole) {
        throw new Error('Permission grant failed: you do not have access to this collection');
      }
      if (role === CollectionRole.OWNER) {
        throw new Error('Permission grant failed: only an owner can grant OWNER role');
      }
      if (granterRole === CollectionRole.VIEWER && role !== CollectionRole.VIEWER) {
        throw new Error('Permission grant failed: VIEWERs can only grant VIEWER role');
      }
    }

    // Prevent sharing with the collection owner
    if (userId && userId === collection.ownerId) {
      throw new Error('Cannot share collection with its owner');
    }

    // A channel grant is always read-only — a channel can have many members,
    // so defaulting all of them to write access is a bigger blast radius
    // than a person or a curated group. Enforced server-side regardless of
    // what the UI sends.
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
              workspaceId: authData.workspaceId,
              id,
              collectionId,
              userId,
              userGroupId,
              channelId,
              role,
              canShare: false,
              grantedBy: authData.sub,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }

          // Sync updated permissions to Vespa for all files in the collection
          asyncTasks.push(async () => {
            try {
              const allPerms = await db.collectionPermission.findMany({
                where: { collectionId },
                select: { userId: true },
              });
              const newPermissions = allPerms
                .map(p => p.userId)
                .filter((id): id is string => id !== null);

              const files = await db.collectionItem.findMany({
                where: { rootCollectionId: collectionId, isLatest: true, deletedAt: null },
                select: { fileId: true },
              });

              await Promise.all(
                files.map(file =>
                  vespaClient.crudService.update(
                    [{ docId: file.fileId, fields: { permissions: newPermissions } }],
                    fileSchema,
                  ).catch(err => {
                    logger.warn(`[MUTATOR-GRANT-PERMISSION] Vespa update failed for ${file.fileId}`, {
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }),
                ),
              );
              logger.info(`[MUTATOR-GRANT-PERMISSION] Synced Vespa permissions for ${files.length} files in collection ${collectionId}`);
            } catch (error) {
              logger.error(`[MUTATOR-GRANT-PERMISSION] Failed to sync Vespa permissions for collection ${collectionId}:`, error);
            }
          });

          if (userId) {
            asyncTasks.push(async () => {
              try {
                const granterUser = await db.user.findUnique({
                  where: { id: authData.sub },
                  select: { name: true },
                });
                const senderName = granterUser?.name || authData.email;
                await notificationService.createNotification(userId, {
                  type: 'DIRECT_MESSAGE' as any,
                  title: 'Collection shared with you',
                  message: `"${collection.name}" was shared with you as ${role} by ${senderName}`,
                  actionUrl: `/knowledge-base`,
                  relatedEntityType: 'collection' as any,
                  relatedEntityId: collectionId,
                  metadata: {
                    notificationType: 'collection_shared',
                    collectionId,
                    collectionName: collection.name,
                    scopeType: collection.scopeType,
                    scopeId: collection.scopeId,
                    role,
                    sharedBy: senderName,
                    sharedById: authData.sub,
                  },
                });
              } catch (error) {
                logger.error(`[MUTATOR-GRANT-PERMISSION] Failed to send notification to user ${userId}:`, error);
              }
            });
          }
        },
      ),

      revokePermission: defineMutator(
        z.object({
          id: z.string(),
          collectionId: z.string(),
        }),
        async ({ tx, args: { id, collectionId } }) => {
          const collection = await tx.run(zql.collections.where('id', collectionId).one());
          if (!collection) {
            throw new Error('Collection not found');
          }
          if (collection.ownerId !== authData.sub) {
            const granterRole = await resolveCollectionPermissionRole(tx, collectionId, authData.sub);
            if (granterRole !== CollectionRole.OWNER) {
              throw new Error('Permission revoke failed: only an owner can revoke permissions');
            }
          }

          await tx.mutate.collection_permissions.delete({ id });

          // Sync updated permissions to Vespa for all files in the collection
          asyncTasks.push(async () => {
            try {
              const allPerms = await db.collectionPermission.findMany({
                where: { collectionId },
                select: { userId: true },
              });
              const newPermissions = allPerms
                .map(p => p.userId)
                .filter((id): id is string => id !== null);

              const files = await db.collectionItem.findMany({
                where: { rootCollectionId: collectionId, isLatest: true, deletedAt: null },
                select: { fileId: true },
              });

              await Promise.all(
                files.map(file =>
                  vespaClient.crudService.update(
                    [{ docId: file.fileId, fields: { permissions: newPermissions } }],
                    fileSchema,
                  ).catch(err => {
                    logger.warn(`[MUTATOR-REVOKE-PERMISSION] Vespa update failed for ${file.fileId}`, {
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }),
                ),
              );
              logger.info(`[MUTATOR-REVOKE-PERMISSION] Synced Vespa permissions for ${files.length} files in collection ${collectionId}`);
            } catch (error) {
              logger.error(`[MUTATOR-REVOKE-PERMISSION] Failed to sync Vespa permissions for collection ${collectionId}:`, error);
            }
          });
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
            workspaceId: authData.workspaceId,
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
            zql.draft_messages
              .where('channelId', scheduled.channelId)
              .where('userId', ctx.userID)
              .where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null)))
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
            workspaceId: authData.workspaceId,
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
          zql.draft_messages.where('id', id).where('userId', ctx.userID).where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))).one()
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
            zql.draft_messages.where('id', id).where('userId', ctx.userID).where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))).one()
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
            zql.draft_messages.where('id', id).where('userId', ctx.userID).where(({ or, cmp }) => or(cmp('origin', '=', DraftOrigin.user), cmp('origin', 'IS', null))).one()
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
                error: error,
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
                error: err,
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
                error: err,
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
                error: err,
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
                error: err,
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
                error: err,
              });
            }
          });
        },
      ),
      disable: defineMutator(
        z.object({
          id: z.string(),
          timestamp: z.number(),
          cancelQueued: z.boolean().optional(),
        }),
        async ({ tx, args: { id, timestamp, cancelQueued } }) => {
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
              await approvalService.toggleLive(id, authData.sub, AutomationStatus.DISABLED, {
                cancelQueued: cancelQueued ?? true,
              });
              logger.info(
                `[Mutator] automations.disable asyncTask OK id=${id} elapsedMs=${Date.now() - t0}`,
              );
            } catch (err) {
              logger.error('[Mutator] automations.disable asyncTask FAIL', {
                automationId: id,
                elapsedMs: Date.now() - t0,
                error: err,
              });
            }
          });
        },
      ),

      // Admin-only: permanently retire a live automation. ARCHIVED is gated to
      // admins by the workflows ACL, and the event-router only matches ACTIVE
      // rows, so archiving immediately stops it from firing.
      archive: defineMutator(
        z.object({ id: z.string(), timestamp: z.number() }),
        async ({ tx, args: { id, timestamp } }) => {
          logger.info(`[Mutator] automations.archive START id=${id}`);
          const existing = await tx.run(zql.workflows.where('id', id).one());
          if (!existing || existing.workflowType !== 'Automations') {
            logger.warn(`[Mutator] automations.archive REJECT id=${id} reason=not-found`);
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
          logger.info(`[Mutator] automations.archive OPTIMISTIC id=${id} status=ARCHIVED`);
        },
      ),
    },
    nonLinear: {
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
          // Caller-supplied timestamp — keeps client/server runs aligned (see nonLinear.transition).
          now: z.number(),
        }),
        async ({ tx, args: { boardId, transitions, now } }) => {
          const board = await tx.run(zql.boards.where('id', boardId).one());
          if (!board) throw new Error('Board not found');
          if (board.workspaceId !== authData.workspaceId) throw new Error('Board not found');

          // Editing a board's stage transitions/approvers rewrites the approval workflow,
          // which is a board-admin action — restrict to the board creator or a project
          // admin, mirroring BoardAcl.canUpdate.
          if (board.createdBy !== authData.sub && !(await hasProjectAdminAccess({ userID: authData.sub }, tx))) {
            throw new Error('Not authorized to edit board transitions');
          }

          // Validate the incoming edges before persisting. These guards prevent configs that
          // the runtime can't satisfy (and that the UI may not block on non-UI paths):
          //  - self-loops (fromStageId === toStageId) make no sense as a directed transition
          //  - requiresApproval with no approvers strands the ticket (no one can ever approve)
          //  - a formId must reference an existing form, else the form gate throws with a
          //    dangling id that resolves to no fields
          const formIdsToCheck = Array.from(
            new Set(transitions.map(t => t.formId).filter((f): f is string => f != null)),
          );
          const existingForms =
            formIdsToCheck.length > 0
              ? await tx.run(zql.forms.where('id', 'IN', formIdsToCheck))
              : [];
          const existingFormIds = new Set(existingForms.map(f => f.id));
          for (const t of transitions) {
            if (t.fromStageId != null && t.fromStageId === t.toStageId) {
              throw new Error('A stage transition cannot start and end at the same stage');
            }
            if (t.requiresApproval && (t.approvers?.length ?? 0) === 0) {
              throw new Error(
                'A transition that requires approval must have at least one approver',
              );
            }
            if (t.formId != null && !existingFormIds.has(t.formId)) {
              throw new Error(`Form "${t.formId}" referenced by a transition does not exist`);
            }
          }

          const existing = await tx.run(zql.stage_transitions.where('boardId', boardId));

          logger.info(`[MUTATOR-NON-LINEAR] stage transitions for board ${boardId} updated by ${authData.sub}`, {
            boardId,
            userId: authData.sub,
            oldTransitionIds: existing.map(t => t.id),
            newTransitionIds: transitions.map(t => t.id),
          });

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
              workspaceId: authData.workspaceId,
              id: t.id,
              boardId,
              ...(t.fromStageId != null && { fromStageId: t.fromStageId }),
              toStageId: t.toStageId,
              ...(t.formId != null && { formId: t.formId }),
              requiresApproval: t.requiresApproval ?? false,
              bypassApprovalForAutomation: t.bypassApprovalForAutomation ?? false,
              // On-entry auto-approval only makes sense for an approval-gated edge.
              // Coerce (rather than reject the whole save) so a stale flag left on a
              // non-approval edge can't block configuring the rest of the board.
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
                workspaceId: authData.workspaceId,
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

      /**
       * Execute a stage transition on a NON_LINEAR board via Zero.
       * Handles: form gate, visitIndex computation (CONTINUE/RESET), ETA management, form value persistence.
       * The frontend is responsible for showing the form modal before calling this mutator.
       * formValues being present signals the form was acknowledged (even if empty); undefined triggers the form gate.
       */
      transition: defineMutator(
        z.object({
          ticketId: z.string(),
          toStageName: z.string(),
          // Caller-supplied timestamp. Passed from the client so the optimistic and
          // authoritative (server) runs of this mutator persist identical timestamps.
          now: z.number(),
          // JSON-encoded Record<string, unknown> — encoding avoids ReadonlyJSONValue incompatibility
          formValuesJson: z.string().optional(),
        }),
        async ({ tx, args: { ticketId, toStageName, now, formValuesJson } }) => {
          const formValues: Record<string, unknown> | undefined = formValuesJson
            ? (JSON.parse(formValuesJson) as Record<string, unknown>)
            : undefined;
          const ticket = await tx.run(zql.tickets.where('id', ticketId).one());
          if (!ticket) throw new Error('Ticket not found');
          if (ticket.stageName === toStageName) return;

          // This mutator implements NON_LINEAR transition semantics only (form gate, approvals,
          // visit versioning). DEFAULT/RELEASE boards must use the standard stage-update path.
          const board = await tx.run(zql.boards.where('id', ticket.boardId).one());
          if (board?.boardType !== BoardType.NON_LINEAR) {
            throw new Error('nonLinear.transition is only valid for NON_LINEAR boards');
          }

          const targetStage = await tx.run(
            zql.stages.where('boardId', ticket.boardId).where('name', toStageName).one(),
          );
          if (!targetStage) throw new Error(`Stage "${toStageName}" not found`);

          const currentStage = await tx.run(
            zql.stages.where('boardId', ticket.boardId).where('name', ticket.stageName).one(),
          );

          // A NON_LINEAR board is edge-gated. Fetch the board's full transition set to tell
          // "no transitions anywhere" (legacy → unrestricted) from "board has edges but this
          // stage has zero outgoing edges" (terminal stage → block).
          const boardTransitions = await tx.run(
            zql.stage_transitions.where('boardId', ticket.boardId),
          );
          const boardHasTransitions = boardTransitions.length > 0;
          const outgoingTransitions = currentStage
            ? boardTransitions.filter(t => t.fromStageId === currentStage.id)
            : [];
          const transition = outgoingTransitions.find(t => t.toStageId === targetStage.id) ?? null;

          // Block moves that match no edge — but only when the board has a graph. A stage with
          // zero outgoing edges on a graphed board is terminal; with no graph at all, unrestricted.
          if (currentStage && boardHasTransitions && !transition) {
            throw new Error('This stage transition is not allowed');
          }

          // Approval gate: if this transition requires approval, only listed approvers may
          // execute it directly (self-approval path). Non-approvers must go through the
          // ticketStageRequest SUBMITTED → APPROVED flow handled by the upsert mutator.
          // Mirrors assertCanReviewStageRequest: a user is an approver if listed directly as a
          // USER approver, OR if they hold (directly or via group) a role listed as a ROLE approver.
          if (transition?.requiresApproval) {
            const approvers = await tx.run(
              zql.stage_approvers.where('transitionId', transition.id),
            );
            let isApprover = approvers.some(
              a => a.userId === authData.sub && (a.approverType ?? 'USER') === 'USER',
            );
            if (!isApprover) {
              const roleIds = approvers
                .filter(a => (a.approverType ?? 'USER') === 'ROLE' && a.roleId)
                .map(a => a.roleId as string);
              if (roleIds.length > 0) {
                const roleMembership = await tx.run(
                  zql.user_role_mappings
                    .where('userId', authData.sub)
                    .where('roleId', 'IN', roleIds)
                    .one(),
                );
                const groupMembership = roleMembership
                  ? null
                  : await tx.run(
                      zql.user_group_mappings
                        .where('userId', authData.sub)
                        .where('roleId', 'IN', roleIds)
                        .one(),
                    );
                isApprover = Boolean(roleMembership) || Boolean(groupMembership);
              }
            }
            if (!isApprover) {
              throw new Error('This transition requires approval');
            }
          }

          // Compute visitIndex before the form gate so the gate can scope to this specific visit.
          const targetETAs = await tx.run(
            zql.ticket_stage_eta
              .where('ticketId', ticketId)
              .where('stageId', targetStage.id),
          );

          // effectiveFormId is needed both for the form gate AND for building the fieldId→name
          // map used to read the prior visit's form values, so compute it here (earlier than the
          // gate) rather than after the version decision.
          // NOTE: null ?? X = X in JS, so we must NOT use ?. shorthand here — use explicit
          // transition === null check to avoid treating "transition found, formId=null" the
          // same as "no transition found".
          const effectiveFormId: string | null =
            transition === null ? null : (transition?.formId ?? null);

          // Data-driven visit versioning (see visitVersioning.ts): new version only when the
          // submitted form differs from the prior visit's; reset/continue governs only the clock.
          const maxVersion =
            targetETAs.length > 0 ? Math.max(...targetETAs.map(e => e.version ?? 1)) : 0;
          // The most recent ETA row at maxVersion (to reopen when reusing), or null if first visit.
          const existingEtaIdAtMaxVersion =
            maxVersion === 0
              ? null
              : (targetETAs
                  .filter(e => (e.version ?? 1) === maxVersion)
                  .sort((a, b) => b.stageEnteredAt - a.stageEnteredAt)[0]?.id ?? null);

          // submittedValues is fieldName → value (the UI sends it keyed by fieldName).
          const submittedValues: Record<string, unknown> = formValues ?? {};
          // latestValues is the prior visit's stored form at maxVersion, folded to fieldName →
          // value. Empty (no prior visit / no form on this edge) → equality → reuse path.
          let latestValues: Record<string, unknown> = {};
          if (maxVersion > 0 && effectiveFormId) {
            const priorFormFields = await tx.run(
              zql.form_fields.where('formId', effectiveFormId).related('globalField'),
            );
            const fieldIdToName = new Map(
              priorFormFields
                .map(f => {
                  const resolvedId = f.globalFieldId ?? f.id;
                  const name = f.globalField?.fieldName ?? f.fieldName;
                  return name ? ([resolvedId, name] as const) : null;
                })
                .filter((entry): entry is readonly [string, string] => entry !== null),
            );
            const priorRows = await tx.run(
              zql.form_entity_values
                .where('entityId', ticketId)
                .where('contextId', targetStage.id),
            );
            const rowsAtMaxVersion = priorRows.filter(r => (r.version ?? 1) === maxVersion);
            latestValues = foldFormRowsToValues(rowsAtMaxVersion, fieldIdToName);
          }

          const {
            newVersion: newVisitIndex,
            existingEtaId,
            rebaseEta,
          } = decideVisitVersion({
            maxVersion,
            existingEtaIdAtMaxVersion,
            submittedValues,
            latestValues,
            reenterMode: (transition?.onReenter as ReenterMode | undefined) ?? ReenterMode.RESET,
          });

          // Form gate: the form is configured on the EDGE, so every traversal of an edge
          // that has a formId must prompt the form — regardless of reenter mode or whether
          // values already exist for this visitIndex.
          //
          // formValues === undefined  → form not yet filled this call → gate (throw) so the
          //   client opens the modal. The client then re-fires this mutator WITH formValuesJson.
          // formValues provided        → form was acknowledged this call → gate passes.
          //
          // This mutator is only called WITHOUT formValues for the no-approver direct-move case
          // (the approval flow moves the ticket via ticketStageRequest.upsert, not here), so
          // there is no legitimate "values already exist → skip the form" case. A CONTINUE-reenter
          // edge keeps newVisitIndex stable, so the old hasFormValuesForVisit check matched the
          // prior visit's values and wrongly skipped the form on re-traversal — removed.
          //
          // effectiveFormId: use the matched transition's formId only. The form gate is
          // edge-specific — only the configured edge's formId should gate the transition.
          // When transition === null (unrestricted source, no matched edge), there is no
          // specific edge to enforce a form on, so effectiveFormId = null.
          if (effectiveFormId && formValues === undefined) {
            throw new ApplicationError('This transition requires a form to be submitted', {
              details: { formId: effectiveFormId },
            });
          }

          // `now` is supplied by the caller (see args schema) so client + server runs agree.

          const stageEtaDeadline = computeStageEtaDeadline(
            now,
            (transition?.visitSlaMode as VisitSlaMode | undefined) ?? VisitSlaMode.STAGE_DEFAULT,
            transition?.fixedEtaHours,
            targetStage.eta,
          );

          if (existingEtaId) {
            // REUSE (form unchanged): rebaseEta (RESET) restarts the clock; CONTINUE keeps it.
            if (rebaseEta) {
              await tx.mutate.ticket_stage_eta.update({
                id: existingEtaId,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: stageEtaDeadline,
                updatedAt: now,
                updatedBy: authData.sub,
              });
            } else {
              // CONTINUE: only clear stageLeftAt (do NOT touch stageEnteredAt/stageEta).
              await tx.mutate.ticket_stage_eta.update({
                id: existingEtaId,
                stageLeftAt: null,
                updatedAt: now,
                updatedBy: authData.sub,
              });
            }
          } else {
            // NEW visit version (first visit, or form changed): insert a fresh ETA row at
            // newVisitIndex with a clock started from now.
            await tx.mutate.ticket_stage_eta.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              ticketId,
              stageId: targetStage.id,
              version: newVisitIndex,
              stageEnteredAt: now,
              stageLeftAt: null,
              stageEta: stageEtaDeadline,
              createdAt: now,
              updatedBy: authData.sub,
            });
          }

          await tx.mutate.tickets.update({
            id: ticketId,
            stageName: toStageName,
            ...(targetStage.defaultTicketStatusV2 && {
              statusV2: targetStage.defaultTicketStatusV2,
            }),
            updatedAt: now,
          });

          // Defer the non-transactional side-effects (post-commit, via asyncTasks). All three
          // are safe here: the ETA close only touches stageLeftAt (the ticket_stage_eta handler
          // is stageEta-gated, so it no-ops); ticket_activities has no side-effect handler; and
          // the SYSTEM message's handler returns early for SYSTEM messages.
          // Capture the pre-move snapshot into locals so the closure is self-contained.
          const currentStageIdForEta = currentStage?.id ?? null;
          const targetStageId = targetStage.id;
          const conversationId = ticket.conversationId ?? null;
          const fromStageName = ticket.stageName;
          asyncTasks.push(async () => {
            try {
            // Close the prior stage's open ETA — or, if the current stage couldn't be resolved,
            // close any dangling open ETAs except the target's — so the ticket keeps one open visit.
            if (currentStageIdForEta) {
              const currentETAs = await tx.run(
                zql.ticket_stage_eta
                  .where('ticketId', ticketId)
                  .where('stageId', currentStageIdForEta),
              );
              const activeETA = currentETAs.find(e => e.stageLeftAt === null);
              if (activeETA) {
                await tx.mutate.ticket_stage_eta.update({
                  id: activeETA.id,
                  stageLeftAt: now,
                  updatedAt: now,
                  updatedBy: authData.sub,
                });
              }
            } else {
              const allOpenETAs = await tx.run(
                zql.ticket_stage_eta.where('ticketId', ticketId),
              );
              for (const e of allOpenETAs) {
                if (e.stageLeftAt === null && e.stageId !== targetStageId) {
                  await tx.mutate.ticket_stage_eta.update({
                    id: e.id,
                    stageLeftAt: now,
                    updatedAt: now,
                    updatedBy: authData.sub,
                  });
                }
              }
            }

            await tx.mutate.ticket_activities.insert({
              workspaceId: authData.workspaceId,
              id: uuidv4(),
              ticketId,
              updatedBy: authData.sub,
              timestamp: now,
              activityType: ActivityType.STATUS,
              value: { field: 'stageName', oldValue: fromStageName, newValue: toStageName },
              channelId: ticket.channelId,
            });

            if (conversationId) {
              const user = await tx.run(zql.users.where('id', authData.sub).one());
              const userName = user?.name || 'Someone';
              await tx.mutate.messages.insert({
                messageId: uuidv4(),
                conversationId,
                workspaceId: authData.workspaceId,
                senderId: authData.sub,
                content: `${userName} moved ticket from "${fromStageName}" to "${toStageName}"`,
                msgType: MessageType.SYSTEM,
                hasAttachment: false,
                edited: false,
                isDeleted: false,
                isSent: true,
                showInChannel: false,
                createdAt: now,
                metadata: {
                  activityType: ActivityType.STATUS,
                  isTicketActivity: true,
                },
              });
            }
            } catch (error) {
              logger.error('stage_transition_side_effects_failed', { ticketId, targetStageId, error });
            }
          });
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
        async ({ tx, args: { id, name, description, timestamp } }) => {
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
              .where('workspaceId', authData.workspaceId)
              .where('isActive', true)
              .one(),
          );
          if (existing) {
            throw new Error(`Role with name '${trimmedName}' already exists`);
          }

          await tx.mutate.roles.insert({
            id,
            workspaceId: authData.workspaceId,
            name: trimmedName,
            description: description ?? null,
            createdBy: authData.sub,
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
        async ({ tx, args: { id, name, description, timestamp } }) => {
          const role = await tx.run(zql.roles.where('id', id).one());
          if (!role) {
            throw new Error('Role not found');
          }
          if (!role.isActive) {
            throw new Error('Cannot update an inactive role');
          }

          if (name !== undefined) {
            const trimmedName = name.trim();
            if (!trimmedName) {
              throw new Error('Role name cannot be empty');
            }
            if (!/^[A-Z]+(_[A-Z]+)*$/.test(trimmedName)) {
              throw new Error('Role name can only contain uppercase letters and single underscores between words (e.g. XYNE_PM, APPROVER)');
            }
            if (trimmedName !== role.name) {
              const existing = await tx.run(
                zql.roles
                  .where('name', trimmedName)
                  .where('workspaceId', role.workspaceId)
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
        async ({ tx, args: { roleId, userIds, mappingIds, timestamp } }) => {
          if (userIds.length === 0) return;

          const role = await tx.run(zql.roles.where('id', roleId).one());
          if (!role) {
            throw new Error('Role not found');
          }
          if (!role.isActive) {
            throw new Error('Cannot add members to an inactive role');
          }

          const existing = await tx.run(
            zql.user_role_mappings.where('roleId', roleId).where('userId', 'IN', userIds),
          );
          const existingUserIds = new Set(existing.map(m => m.userId));
          const toAdd = userIds.filter(userId => !existingUserIds.has(userId));

          await Promise.all(
            toAdd.map(userId => {
              const mappingId = mappingIds[userId];
              if (!mappingId) {
                throw new Error(`mappingId is required for user ${userId}`);
              }
              return tx.mutate.user_role_mappings.insert({
                workspaceId: authData.workspaceId,
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
}
