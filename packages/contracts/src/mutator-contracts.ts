import { z } from 'zod';
import {
  AccessType,
  ActivityClassification,
  AgentProactivityMode,
  AttributionConfidence,
  AutoDraftMode,
  BoardType,
  BookmarkEntityType,
  CallType,
  CanvasCommentThreadStatus,
  CanvasRole,
  CanvasVisibility,
  ChannelAddUserPolicy,
  ChannelFilterMode,
  ChannelRole,
  ChannelSortOrder,
  ChannelVisibility,
  COEStatus,
  CollectionRole,
  createSdlcLinkSchema,
  EmailMergeMode,
  entityLinkContextSchema,
  FlowPlanSchema,
  FormContextType,
  FormEntityType,
  FormFieldType,
  MailboxState,
  MAX_DUPLICATE_LOOKBACK_DAYS,
  MAX_DUPLICATE_SCOPE_FIELDS,
  MAX_NOTIFICATION_KEYWORD_LENGTH,
  MAX_NOTIFICATION_KEYWORDS,
  MAX_PUBLISHED_APP_ID_LENGTH,
  MessageType,
  OrgRole,
  PRStatusEvent,
  RCAStatus,
  ReleaseTrackingMode,
  RingStatus,
  RotationInterval,
  SavedConfigContextType,
  SavedConfigEntityName,
  SavedConfigVisibility,
  sdlcIconNameSchema,
  sdlcTrackStatusSchema,
  SEVERITY,
  TicketReferenceRelation,
  TicketStageRequestStatus,
  TicketStatusV2,
  upsertManyFormEntityValuesArgs,
  UserResponsibility,
  ViewAccessEntityType,
  WorkspaceRole,
} from '@xyne/shared';
import { defineRequestContract, type RequestContract } from './define.js';
import { derive } from './extractors.js';
import { unreadableString } from './unreadable-string.js';

/**
 * Every Zero mutator's request type, by mutator name: the zod schema of its args and
 * `sourceToDerived`. The backend mutator is `defineContractMutator('<name>', fn)` and gets its
 * args validated by this schema (`unreadableString()` fields as `UnreadableString`) and the facts
 * `sourceToDerived` lists.
 *
 * Each mutator also has a MUTATOR rule in the encryption service's database listing the args sent
 * as plaintext; the client encrypts every other one. The service refuses a mutation whose
 * contract and rule disagree, so a new arg is either listed there or `unreadableString()` here.
 */
export const mutatorContracts = {
  'activities.markActivitiesSeenByMessageId': defineRequestContract({
    schema: z.object({ messageId: z.string() }),
  }),

  'activities.markAsRead': defineRequestContract({
    schema: z.object({ activityId: z.string() }),
  }),

  'activities.markAsReadByFilter': defineRequestContract({
    schema: z.object({
      actorAction: z.string().optional(),
      classification: z.nativeEnum(ActivityClassification).optional(),
      channelIds: z.array(z.string()).optional(),
      timestamp: z.number(),
    }),
  }),

  'activities.markAsUnread': defineRequestContract({
    schema: z.object({ activityId: z.string(), timestamp: z.number() }),
  }),

  'activities.markMissedCallsAsRead': defineRequestContract({
    schema: z.object({}),
  }),

  /** Also saves the user's draft: `textIsEmpty` decides between deleting and saving it. */
  'activities.markThreadActivitiesAsReadV2': defineRequestContract({
    sourceToDerived: { draftMessage: { textIsEmpty: derive.textIsEmpty } },
    schema: z.object({
      conversationId: z.string(),
      draftMessage: unreadableString(),
      draftMessageId: z.string(),
      timestamp: z.number(),
      participantId: z.string(),
    }),
  }),

  'applicationReleaseTicket.setTestedBy': defineRequestContract({
    schema: z.object({
      id: z.string(),
      userId: z.string().nullable(),
      timestamp: z.number(),
    }),
  }),

  'applicationReleaseTicket.updateStatus': defineRequestContract({
    schema: z.object({
      id: z.string(),
      stageName: z.string().optional(),
      defaultTicketStatusV2: z.nativeEnum(TicketStatusV2).optional(),
      failureReason: z.string().optional().nullable(),
      timestamp: z.number(),
    }),
  }),

  'apps.update': defineRequestContract({
    schema: z.object({
      appId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      webhookUrl: z.string().optional(),
      timestamp: z.number(),
    }),
  }),

  'assignmentConfig.batchUpdate': defineRequestContract({
    schema: z.object({
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
        percentageWindowDays: z.number().int().min(1).max(90).optional(),
        percentageShareBasis: z.enum(['ALL', 'OPEN']).optional(),
        // Start of the first share window (ms); null clears it. Omit to keep the current start.
        percentageWindowStartAt: z.number().nullable().optional(),
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
  }),

  'assignmentConfig.toggleGroupAutoRotation': defineRequestContract({
    schema: z.object({
      userGroupId: z.string(),
      autoRotationEnabled: z.boolean(),
      rotationInterval: z.nativeEnum(RotationInterval).optional(),
      rotationStartDate: z.number().optional(),
      timestamp: z.number(),
    }),
  }),

  'automations.activate': defineRequestContract({
    schema: z.object({ id: z.string(), timestamp: z.number() }),
  }),

  'automations.approve': defineRequestContract({
    schema: z.object({
      id: z.string(),
      note: z.string().nullable().optional(),
      timestamp: z.number(),
    }),
  }),

  'automations.archive': defineRequestContract({
    schema: z.object({ id: z.string(), timestamp: z.number() }),
  }),

  'automations.createProposal': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).max(80),
      configJson: z.string(),
      metadataJson: z.string(),
      eventType: z.string(),
      automationSeriesId: z.string().optional(),
      timestamp: z.number(),
    }),
  }),

  'automations.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'automations.disable': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
      cancelQueued: z.boolean().optional(),
    }),
  }),

  'automations.reject': defineRequestContract({
    schema: z.object({
      id: z.string(),
      note: z.string().min(1),
      timestamp: z.number(),
    }),
  }),

  'automations.revoke': defineRequestContract({
    schema: z.object({ id: z.string(), timestamp: z.number() }),
  }),

  'automations.submitForApproval': defineRequestContract({
    schema: z.object({ id: z.string(), timestamp: z.number() }),
  }),

  'automations.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      configJson: z.string().optional(),
      metadataJson: z.string().optional(),
      eventType: z.string().optional(),
      timestamp: z.number(),
    }),
  }),

  'board.delete': defineRequestContract({
    schema: z.object({ boardId: z.string() }),
  }),

  'board.update': defineRequestContract({
    schema: z.object({
      boardId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      boardType: z.nativeEnum(BoardType).optional(),
      metadata: z.any().optional(),
      // Automatic ETA management. Merged into `metadata.etaManagement` below rather
      // than going through the raw `metadata` arg above, which is a whole-column
      // overwrite and would drop sibling keys.
      autoRecomputeEnabled: z.boolean().optional(),
      // Standard Path (NON_LINEAR only). Omitted = leave the existing path untouched;
      // [] explicitly clears it (disables Standard Path forecasting without changing
      // allowed transitions).
      standardPathStageIds: z.array(z.string()).optional(),
      // Release-board dev-ticket column picks. Merged into the freshly read metadata so a
      // stale client snapshot can't overwrite sibling keys (same reason as the ETA args).
      devTicketColumns: z.array(z.string()).optional(),
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
  }),

  'board.updateFlowPlan': defineRequestContract({
    schema: z.object({
      boardId: z.string(),
      plan: FlowPlanSchema,
      timestamp: z.number(),
    }),
  }),

  'boardSlaPolicy.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'boardSlaPolicy.upsert': defineRequestContract({
    schema: z.object({
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
  }),

  'bookmark.add': defineRequestContract({
    schema: z.object({
      entityId: z.string(),
      entityType: z.nativeEnum(BookmarkEntityType),
      metadata: z.any().optional(),
      timestamp: z.number(),
      bookmarkId: z.string(),
    }),
  }),

  'bookmark.remove': defineRequestContract({
    schema: z.object({
      entityId: z.string(),
      entityType: z.nativeEnum(BookmarkEntityType),
      timestamp: z.number().optional(),
      markAsDone: z.boolean().optional(),
    }),
  }),

  'bookmark.updateMetadata': defineRequestContract({
    schema: z.object({
      entityId: z.string(),
      entityType: z.nativeEnum(BookmarkEntityType),
      metadata: z.any(),
    }),
  }),

  'calls.approveLobbyRequest': defineRequestContract({
    schema: z.object({ callId: z.string(), participantId: z.string() }),
  }),

  'calls.cancel': defineRequestContract({
    schema: z.object({ callId: z.string(), timestamp: z.number(), cancelEntireSeries: z.boolean().optional() }),
  }),

  'calls.cancelJoinRequest': defineRequestContract({
    schema: z.object({
      callId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'calls.initiate': defineRequestContract({
    schema: z.object({
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
  }),

  'calls.invite': defineRequestContract({
    schema: z.object({ callId: z.string(), userIds: z.array(z.string()), timestamp: z.number(), participantIds: z.record(z.string(), z.string()) }),
  }),

  'calls.join': defineRequestContract({
    schema: z.object({
      callId: z.string(),
      timestamp: z.number(),
      participantId: z.string().optional()
    }),
  }),

  'calls.leave': defineRequestContract({
    schema: z.object({ callId: z.string(), timestamp: z.number() }),
  }),

  'calls.linkNotesCanvas': defineRequestContract({
    schema: z.object({ callId: z.string(), notesCanvasId: z.string().min(1) }),
  }),

  'calls.markMoment': defineRequestContract({
    schema: z.object({
      callId: z.string(),
      type: z.literal('moment'),
      timestampSeconds: z.number().nonnegative(),
      text: z.string(),
    }),
  }),

  'calls.reject': defineRequestContract({
    schema: z.object({ callId: z.string(), timestamp: z.number() }),
  }),

  'calls.rejectLobbyRequest': defineRequestContract({
    schema: z.object({ callId: z.string(), participantId: z.string() }),
  }),

  'calls.requestToJoin': defineRequestContract({
    schema: z.object({
      callId: z.string(),
      participantId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'calls.updateRingStatus': defineRequestContract({
    schema: z.object({ callId: z.string(), ringStatus: z.enum([RingStatus.RINGING, RingStatus.BUSY]) }),
  }),

  'canvas.addChannelParticipant': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      channelId: z.string(),
      role: z.nativeEnum(CanvasRole),
      participantId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvas.addGroupParticipant': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userGroupId: z.string(),
      role: z.nativeEnum(CanvasRole),
      participantId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvas.addParticipants': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userIds: z.array(z.string()),
      role: z.nativeEnum(CanvasRole),
      timestamp: z.number(),
      participantIds: z.record(z.string(), z.string()).optional(),
    }),
  }),

  'canvas.archiveCanvas': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
    }),
  }),

  'canvas.create': defineRequestContract({
    sourceToDerived: { title: {} },
    schema: z.object({
      id: z.string(),
      title: unreadableString(),
      channelId: z.string().optional(),
      folderId: z.string().optional(),
      projectId: z.string().optional(),
      visibility: z.nativeEnum(CanvasVisibility).optional(),
      content: z.any().optional(),
      timestamp: z.number(),
      participantId: z.string(),
      connectId: z.string().optional(),
      viewAccessId: z.string().optional(),
      editAccessId: z.string().optional(),
    }),
  }),

  'canvas.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'canvas.removeChannelParticipant': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      channelId: z.string(),
    }),
  }),

  'canvas.removeGroupParticipant': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userGroupId: z.string(),
    }),
  }),

  'canvas.removeParticipant': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userId: z.string(),
    }),
  }),

  'canvas.unarchiveCanvas': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
    }),
  }),

  'canvas.update': defineRequestContract({
    sourceToDerived: { title: {} },
    schema: z.object({
      id: z.string(),
      title: unreadableString().optional(),
      content: z.any().optional(),
      visibility: z.nativeEnum(CanvasVisibility).optional(),
      isCollaborative: z.boolean().optional(),
      folderId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      channelId: z.string().nullable().optional(),
      timestamp: z.number(),
      viewAccessId: z.string().optional(),
      editAccessId: z.string().optional(),
    }),
  }),

  'canvas.updateChannelParticipantRole': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      channelId: z.string(),
      role: z.nativeEnum(CanvasRole),
      timestamp: z.number(),
    }),
  }),

  'canvas.updateGroupParticipantRole': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userGroupId: z.string(),
      role: z.nativeEnum(CanvasRole),
      timestamp: z.number(),
    }),
  }),

  'canvas.updateParticipantRole': defineRequestContract({
    schema: z.object({
      canvasId: z.string(),
      userId: z.string(),
      role: z.nativeEnum(CanvasRole),
      timestamp: z.number(),
    }),
  }),

  /**
   * Mentions arrive separately as `mentionedUserIds`. `anchorText` lists one fact so that "no facts"
   * means it was empty (`anchorText || null`).
   */
  'canvasComment.createThread': defineRequestContract({
    sourceToDerived: {
      body: {},
      anchorText: { textLength: derive.textLength },
    },
    schema: z.object({
      threadId: z.string(),
      commentId: z.string(),
      canvasId: z.string(),
      blockId: z.string().min(1),
      anchorText: unreadableString().optional(),
      body: unreadableString(z.string().min(1)),
      mentionedUserIds: z.array(z.string()).default([]),
      timestamp: z.number(),
    }),
  }),

  'canvasComment.deleteComment': defineRequestContract({
    schema: z.object({
      commentId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvasComment.reply': defineRequestContract({
    sourceToDerived: { body: {} },
    schema: z.object({
      commentId: z.string(),
      threadId: z.string(),
      canvasId: z.string(),
      body: unreadableString(z.string().min(1)),
      mentionedUserIds: z.array(z.string()).default([]),
      timestamp: z.number(),
    }),
  }),

  'canvasComment.setThreadStatus': defineRequestContract({
    schema: z.object({
      threadId: z.string(),
      status: z.nativeEnum(CanvasCommentThreadStatus),
      timestamp: z.number(),
    }),
  }),

  'canvasComment.updateComment': defineRequestContract({
    sourceToDerived: { body: {} },
    schema: z.object({
      commentId: z.string(),
      body: unreadableString(z.string().min(1)),
      mentionedUserIds: z.array(z.string()).default([]),
      timestamp: z.number(),
    }),
  }),

  'canvasFolder.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      projectId: z.string().nullable().optional(),
      channelId: z.string().optional(),
      name: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvasFolder.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'canvasFolder.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      timestamp: z.number().optional(),
    }),
  }),

  'canvasUserStatus.toggleStarred': defineRequestContract({
    schema: z.object({
      id: z.string(),
      canvasId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvasVersion.rename': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).max(120),
    }),
  }),

  'canvasVersion.restore': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'canvasVersion.save': defineRequestContract({
    schema: z.object({
      id: z.string(),
      canvasId: z.string(),
      name: z.string().min(1).max(120),
      content: z.any(),
      contentHash: z.string().min(1),
      timestamp: z.number(),
    }),
  }),

  'channel.addParticipants': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      userIds: z.array(z.string()),
      timestamp: z.number(),
      participantIds: z.record(z.string(), z.string()), // Map userId -> participantId
      userStatusIds: z.record(z.string(), z.string()), // Map userId -> userStatusId
    }),
  }),

  'channel.archiveChannel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
    }),
  }),

  'channel.closeDm': defineRequestContract({
    schema: z.object({ channelId: z.string(), updatedAt: z.number() }),
  }),

  'channel.joinChannel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      channelParticipantId: z.string(),
      channelUserStatusId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'channel.leaveChannel': defineRequestContract({
    schema: z.object({ channelId: z.string(), updatedAt: z.number() }),
  }),

  'channel.linkBoards': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      // Ids are generated client-side (uuid) so the mutation stays idempotent
      // across optimistic apply + server replay.
      boards: z
        .array(z.object({ mappingId: z.string(), boardId: z.string() }))
        .min(1)
        .max(100),
      timestamp: z.number(),
    }),
  }),

  'channel.makeChannelPublic': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
    }),
  }),

  /** Also saves the user's draft: `textIsEmpty` decides between deleting and saving it. */
  'channel.markChannelAsViewed': defineRequestContract({
    sourceToDerived: { draftMessage: { textIsEmpty: derive.textIsEmpty } },
    schema: z.object({
      channelId: z.string(),
      conversationId: z.string().optional(),
      timestamp: z.number(),
      draftMessage: unreadableString().optional(),
      draftMessageId: z.string().optional(),
    }),
  }),

  'channel.markChannelUnreadFrom': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      messageId: z.string(),
      conversationId: z.string().optional(),
      timestamp: z.number(),
    }),
  }),

  'channel.moveManyToSection': defineRequestContract({
    schema: z.object({
      sectionId: z.string().nullable(),
      items: z
        .array(z.object({ channelId: z.string(), position: z.string() }))
        .min(1)
        .max(200),
      timestamp: z.number(),
    }),
  }),

  'channel.moveToSection': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      sectionId: z.string().nullable(),
      position: z.string(),
      timestamp: z.number(),
    }),
  }),

  'channel.promoteToChannel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      name: z.string().min(2).max(80),
      description: z.string().optional(),
      visibility: z.enum([ChannelVisibility.PUBLIC, ChannelVisibility.PRIVATE]),
      projectId: z.string(),
      conversationId: z.string(),
      messageId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'channel.publishApp': defineRequestContract({
    schema: z.object({
      id: z.string().min(1).max(64),
      channelId: z.string(),
      appId: z.string().min(1).max(MAX_PUBLISHED_APP_ID_LENGTH),
      timestamp: z.number(),
    }),
  }),

  'channel.removeParticipant': defineRequestContract({
    schema: z.object({ targetUserId: z.string(), channelId: z.string(), updatedAt: z.number() }),
  }),

  'channel.renameChannel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      name: z.string().min(2).max(80),
      timestamp: z.number(),
    }),
  }),

  'channel.reopenDm': defineRequestContract({
    schema: z.object({ channelId: z.string(), updatedAt: z.number() }),
  }),

  'channel.toggleStarred': defineRequestContract({
    schema: z.object({ channelId: z.string(), updatedAt: z.number() }),
  }),

  'channel.unarchiveChannel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
    }),
  }),

  'channel.unpublishApp': defineRequestContract({
    schema: z.object({ channelId: z.string(), appId: z.string().min(1).max(MAX_PUBLISHED_APP_ID_LENGTH) }),
  }),

  'channel.updateAddUserPolicy': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      policy: z.nativeEnum(ChannelAddUserPolicy),
    }),
  }),

  'channel.updateAgentProactivityMode': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      mode: z.nativeEnum(AgentProactivityMode),
    }),
  }),

  /**
   * `textIsEmpty` decides "no prompt"; `rawLength` checks the 20000 limit, which zod cannot measure
   * on ciphertext.
   */
  'channel.updateCallSummaryPrompt': defineRequestContract({
    sourceToDerived: { prompt: { textIsEmpty: derive.textIsEmpty, rawLength: derive.rawLength } },
    schema: z.object({
      channelId: z.string(),
      prompt: unreadableString().nullable(),
    }),
  }),

  'channel.updateDescription': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      description: z.string(),
      messageId: z.string(),
      conversationId: z.string(),
      timestamp: z.number(),
      conversationParticipantId: z.string(),
    }),
  }),

  'channel.updateParticipantRole': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      targetUserId: z.string(),
      newRole: z.nativeEnum(ChannelRole),
      timestamp: z.number(),
      conversationId: z.string(),
      messageId: z.string(),
      conversationParticipantId: z.string(),
    }),
  }),

  'channel.updateSelectedBoardId': defineRequestContract({
    schema: z.object({ channelId: z.string(), boardId: z.string().nullable(), updatedAt: z.number() }),
  }),

  'channel.updateShowTicketsTabTicketsInChat': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      show: z.boolean(),
    }),
  }),

  'channelSection.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string(),
      emoji: z.string().nullable().optional(),
      position: z.string(),
      filterMode: z.nativeEnum(ChannelFilterMode).nullable().optional(),
      timestamp: z.number(),
    }),
  }),

  'channelSection.remove': defineRequestContract({
    schema: z.object({ id: z.string(), timestamp: z.number() }),
  }),

  'channelSection.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      emoji: z.string().nullable().optional(),
      isCollapsed: z.boolean().optional(),
      position: z.string().optional(),
      sortOrder: z.nativeEnum(ChannelSortOrder).nullable().optional(),
      filterMode: z.nativeEnum(ChannelFilterMode).nullable().optional(),
      timestamp: z.number(),
    }),
  }),

  'classificationMapping.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      channelId: z.string(),
      category: z.string(),
      subCategory: z.string().optional().nullable(),
      userGroupId: z.string(),
      createdAt: z.number(),
    }),
  }),

  'classificationMapping.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'classificationMapping.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      category: z.string().optional(),
      subCategory: z.string().optional().nullable(),
      userGroupId: z.string().optional(),
    }),
  }),

  'cleanupStageApprovals': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
      fromSequenceNumber: z.number(),
    }),
  }),

  'coe.create': defineRequestContract({
    sourceToDerived: { action: {} },
    schema: z.object({
      id: z.string(),
      rcaId: z.string(),
      ownerId: z.string(),
      actionTypeId: z.string(),
      action: unreadableString(),
      status: z.nativeEnum(COEStatus),
      dueDate: z.number().optional(),
      timestamp: z.number(),
    }),
  }),

  'coe.delete': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  'coe.update': defineRequestContract({
    sourceToDerived: { action: {} },
    schema: z.object({
      id: z.string(),
      ownerId: z.string().optional(),
      actionTypeId: z.string().optional(),
      action: unreadableString().optional(),
      status: z.nativeEnum(COEStatus).optional(),
      dueDate: z.number().optional(),
      completedAt: z.number().optional(),
    }),
  }),

  'collection.createCollection': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      scopeType: z.string(),
      scopeId: z.string(),
      name: z.string(),
      description: unreadableString().nullable().optional(),
      isPrivate: z.boolean().optional(),
      permissionId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'collection.createFolder': defineRequestContract({
    schema: z.object({
      id: z.string(),
      parentId: z.string(),
      name: z.string(),
      timestamp: z.number(),
    }),
  }),

  'collection.deleteCollection': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'collection.deleteItem': defineRequestContract({
    schema: z.object({
      id: z.string(),
      collectionId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'collection.grantPermission': defineRequestContract({
    schema: z.object({
      id: z.string(),
      collectionId: z.string(),
      userId: z.string().optional(),
      userGroupId: z.string().optional(),
      channelId: z.string().optional(),
      role: z.nativeEnum(CollectionRole),
      timestamp: z.number(),
    }),
  }),

  'collection.renameItem': defineRequestContract({
    schema: z.object({
      id: z.string(),
      collectionId: z.string(),
      name: z.string(),
      timestamp: z.number(),
    }),
  }),

  'collection.revokePermission': defineRequestContract({
    schema: z.object({
      id: z.string(),
      collectionId: z.string(),
    }),
  }),

  'collection.updateCollection': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: unreadableString().nullable().optional(),
      isPrivate: z.boolean().optional(),
      timestamp: z.number(),
    }),
  }),

  'conversation.markThreadUnreadFrom': defineRequestContract({
    schema: z.object({
      conversationId: z.string(),
      messageId: z.string(),
      participantId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'conversationLabel.applyLabel': defineRequestContract({
    schema: z.object({
      labelId: z.string(),
      labelName: z.string(),
      color: z.string().optional(),
      conversationId: z.string(),
      channelId: z.string(),
      mappingId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'conversationLabel.createLabel': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().optional(),
      channelId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'conversationLabel.removeLabel': defineRequestContract({
    schema: z.object({ conversationId: z.string(), labelId: z.string() }),
  }),

  /**
   * Only what the forwarder wrote comes from the client: the server builds the forward from the
   * original message it reads itself (`forwardedMessageTemplate`). `rawLength` checks the 10000
   * limit.
   */
  'conversations.forwardMessage': defineRequestContract({
    sourceToDerived: {
      optionalMessage: { rawLength: derive.rawLength },
    },
    schema: z.object({
      targetChannelId: z.string(),
      originalMessageId: z.string(),
      optionalMessage: unreadableString().optional(),
      conversationId: z.string(),
      messageId: z.string(),
      timestamp: z.number(),
      conversationParticipantId: z.string(),
    }),
  }),

  /**
   * Starts a conversation. Mentions for the guest check and participants, Meet links, the bot
   * command; `mentionsChannel` / `mentionsHere`, `firstUrl` and `prLinks` are for the message side
   * effects (notifications, previews, PR approval button). No facts means the content was empty.
   */
  'conversations.send': defineRequestContract({
    sourceToDerived: {
      content: {
        userIds: derive.userIds,
        groupIds: derive.groupIds,
        handles: derive.handles,
        mentionsChannel: derive.mentionsChannel,
        mentionsHere: derive.mentionsHere,
        firstUrl: derive.firstUrl,
        prLinks: derive.prLinks,
        meetLinks: derive.meetLinks,
        commandName: derive.commandName,
        commandArgs: derive.commandArgs,
      },
    },
    schema: z.object({
      channelId: z.string(),
      content: unreadableString(),
      conversationId: z.string(),
      messageId: z.string(),
      timestamp: z.number(),
      type: z.nativeEnum(MessageType),
      attachmentIds: z.array(z.string()).optional(),
      entityLinkContext: entityLinkContextSchema.optional(),
    }),
  }),

  'conversations.subscribeToConversation': defineRequestContract({
    schema: z.object({
      conversationId: z.string(),
      timestamp: z.number(),
      participantId: z.string(),
    }),
  }),

  'conversations.togglePin': defineRequestContract({
    schema: z.object({ conversationId: z.string() }),
  }),

  'conversations.unsubscribeFromConversation': defineRequestContract({
    schema: z.object({
      conversationId: z.string(),
    }),
  }),

  'dashboard.delete': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  'dashboard.upsert': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      name: z.string(),
      description: unreadableString().optional(),
      createdBy: z.string(),
      timestamp: z.number(),
    }),
  }),

  'dashboardComponent.updatePositions': defineRequestContract({
    schema: z.object({
      updates: z.array(z.object({ id: z.string(), position: z.string() })).min(1),
      timestamp: z.number(),
    }),
  }),

  'delayedMessages.cancel': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'delayedMessages.convertToDraft': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  /** `textIsEmpty` decides "is it empty". */
  'delayedMessages.create': defineRequestContract({
    sourceToDerived: { content: { textIsEmpty: derive.textIsEmpty } },
    schema: z.object({
      id: z.string(),
      channelId: z.string(),
      conversationId: z.string().optional(),
      content: unreadableString(),
      scheduledFor: z.number(),
      timestamp: z.number(),
    }),
  }),

  'delayedMessages.edit': defineRequestContract({
    sourceToDerived: { content: {} },
    schema: z.object({
      id: z.string(),
      content: unreadableString(z.string().min(1)),
      updatedAt: z.number(),
    }),
  }),

  'delayedMessages.reschedule': defineRequestContract({
    schema: z.object({
      id: z.string(),
      scheduledFor: z.number(),
      timestamp: z.number(),
    }),
  }),

  'delayedMessages.sendNow': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'draft.clearContent': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      conversationId: z.string().optional(),
      timestamp: z.number(),
    }),
  }),

  /**
   * `content` lists one fact so that "no facts" means empty. The file names sit inside
   * `attachments`, which a contract cannot mark yet: they stay plaintext.
   */
  'draft.createAttachments': defineRequestContract({
    sourceToDerived: { content: { textLength: derive.textLength } },
    schema: z.object({
      draftMessageId: z.string(),
      attachments: z.array(
        z.object({
          attachmentId: z.string(),
          originalFilename: z.string(),
          mimetype: z.string(),
          size: z.number(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
      channelId: z.string(),
      conversationId: z.string().optional(),
      content: unreadableString().optional(),
      timestamp: z.number(),
    }),
  }),

  'draftMessages.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'draftMessages.edit': defineRequestContract({
    sourceToDerived: { content: {} },
    schema: z.object({
      id: z.string(),
      content: unreadableString(z.string().min(1)),
      timestamp: z.number(),
    }),
  }),

  'draftMessages.send': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'emailChannelPreference.upsert': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      ownerUserId: z.string().optional(),
      assigneeUserGroupId: z.string().optional().nullable(),
      sendAsEmail: z.string().optional().nullable(),
      dlAliases: z.string().optional().nullable(),
      defaultCc: z.string().optional().nullable(),
      emailMergeMode: z.nativeEnum(EmailMergeMode).optional(),
      twoStepSendEnabled: z.boolean().optional(),
      autoDraftMode: z.nativeEnum(AutoDraftMode).optional(),
      autoDraftAgentSlug: z.string().optional().nullable(),
      metricsEnabled: z.boolean().optional(),
      frtStageNames: z.string().optional().nullable(),
      metricsGuestVisibility: z.string().optional().nullable(),
      metricsMinAccess: z.nativeEnum(AccessType).optional().nullable(),
      appWebhookDeliveryEnabled: z.boolean().optional(),
      deskReportEnabled: z.boolean().optional(),
      deskReportAgentSlug: z.string().optional().nullable(),
      deskReportRangeDays: z.number().optional(),
      // Scoped duplicate detection config (see EmailChannelPreference.duplicateScopeConfig)
      duplicateScopeConfig: z
        .object({
          enabled: z.boolean(),
          scopeFieldGlobalIds: z.array(z.string()).max(MAX_DUPLICATE_SCOPE_FIELDS),
          lookbackDays: z.number().int().min(0).max(MAX_DUPLICATE_LOOKBACK_DAYS).nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  }),

  /** The audit log records only whether a prompt is set (zero/audit/config.ts). */
  'emailChannelPreference.upsertClassificationConfig': defineRequestContract({
    sourceToDerived: { classificationPrompt: {} },
    schema: z.object({
      channelId: z.string(),
      classificationEnabled: z.boolean(),
      classificationPrompt: unreadableString(),
      categoryField: z.string(),
      subCategoryField: z.string().optional().nullable(),
    }),
  }),

  'emailChannelPreference.upsertPriorityClassificationConfig': defineRequestContract({
    sourceToDerived: { priorityClassificationPrompt: {} },
    schema: z.object({
      channelId: z.string(),
      priorityClassificationEnabled: z.boolean(),
      priorityClassificationPrompt: unreadableString().optional().nullable(),
      priorityClassificationThreshold: z.number().optional(),
    }),
  }),

  'emailDraft.delete': defineRequestContract({
    schema: z.object({
      conversationId: z.string(),
    }),
  }),

  'emailDraft.deleteComposeDraft': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'emailDraft.upsert': defineRequestContract({
    sourceToDerived: { draftContent: {} },
    schema: z.object({
      id: z.string(),
      conversationId: z.string(),
      channelId: z.string(),
      draftContent: unreadableString().optional(),
      attachmentIds: z.array(z.string()).optional(),
      toRecipients: z.array(z.string()).optional(),
      ccRecipients: z.array(z.string()).optional(),
      bccRecipients: z.array(z.string()).optional(),
      updatedAt: z.number(),
    }),
  }),

  'emailDraft.upsertComposeDraft': defineRequestContract({
    sourceToDerived: { subject: {}, draftContent: {} },
    schema: z.object({
      id: z.string(),
      channelId: z.string(),
      subject: unreadableString().optional(),
      fromAddress: z.string().optional(),
      draftContent: unreadableString().optional(),
      attachmentIds: z.array(z.string()).optional(),
      toRecipients: z.array(z.string()).optional(),
      ccRecipients: z.array(z.string()).optional(),
      bccRecipients: z.array(z.string()).optional(),
      updatedAt: z.number(),
    }),
  }),

  'emailRead.bulkMarkAsRead': defineRequestContract({
    schema: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          ticketId: z.string(),
        }),
      ),
      timestamp: z.number(),
    }),
  }),

  'emailRead.bulkMarkAsUnread': defineRequestContract({
    schema: z.object({
      ticketIds: z.array(z.string()).max(50, 'Cannot mark more than 50 tickets at once'),
    }),
  }),

  'emailRead.markAsRead': defineRequestContract({
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      lastReadEmailId: z.string(),
      updatedAt: z.number(),
    }),
  }),

  'emailSignature.create': defineRequestContract({
    sourceToDerived: { content: {} },
    schema: z.object({
      id: z.string(),
      name: z.string(),
      content: unreadableString(),
      timestamp: z.number(),
    }),
  }),

  'emailSignature.delete': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  'emailSignature.setDefault': defineRequestContract({
    schema: z.object({
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'emailSignature.update': defineRequestContract({
    sourceToDerived: { content: {} },
    schema: z.object({
      id: z.string(),
      name: z.string(),
      content: unreadableString(),
      timestamp: z.number(),
    }),
  }),

  'form.update': defineRequestContract({
    schema: z.object({
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
  }),

  'formContextMapping.delete': defineRequestContract({
    schema: z.object({
      contextId: z.string(),
      contextType: z.nativeEnum(FormContextType),
      entityType: z.nativeEnum(FormEntityType),
    }),
  }),

  'formContextMapping.upsert': defineRequestContract({
    schema: z.object({
      contextId: z.string(),
      contextType: z.nativeEnum(FormContextType),
      entityType: z.nativeEnum(FormEntityType),
      formId: z.string(),
      mappingId: z.string(),
    }),
  }),

  'formEntityValue.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      entityId: z.string(),
      entityType: z.nativeEnum(FormEntityType),
      fieldId: z.string(),
      newValue: z.array(z.string()),
      timestamp: z.number(),
      contextId: z.string().optional(),
      version: z.number().optional(),
    }),
  }),

  'formEntityValue.createV2': defineRequestContract({
    schema: z.object({
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
  }),

  'formEntityValue.update': defineRequestContract({
    schema: z.object({
      formEntityValueId: z.string(),
      newValue: z.array(z.string()),
      updatedAt: z.number(),
      expectedValueUpdatedAt: z.number().nullable().optional(),
    }),
  }),

  'formEntityValue.upsertMany': defineRequestContract({
    schema: upsertManyFormEntityValuesArgs,
  }),

  'impact.create': defineRequestContract({
    sourceToDerived: { impact: {} },
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      impactTypeId: z.string(),
      impact: unreadableString(),
      rcaId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'impact.delete': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  'impact.update': defineRequestContract({
    sourceToDerived: { impact: {} },
    schema: z.object({
      id: z.string(),
      impactTypeId: z.string().optional(),
      impact: unreadableString().optional(),
    }),
  }),

  'invitation.revoke': defineRequestContract({
    schema: z.object({
      invitationId: z.string(),
      timestamp: z.number(),
    }),
  }),

  /**
   * `title` stays plaintext: the SDLC agent reads it. `description` lists one fact so that "no
   * facts" means it was empty (`description || null`).
   */
  'links.create': defineRequestContract({
    sourceToDerived: { description: { textLength: derive.textLength } },
    schema: z.object({
      id: z.string(),
      url: z.string().url(),
      title: z.string().min(1),
      description: unreadableString().optional(),
      favicon: z.string().optional(),
      channelId: z.string(),
      visibility: z.enum(['DEFAULT', 'PERSONAL']).default('DEFAULT'),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  }),

  'links.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'links.shareWith': defineRequestContract({
    schema: z.object({
      linkId: z.string(),
      userIds: z.array(z.string()),
      accessIds: z.array(z.string()),
      createdAt: z.number(),
    }),
  }),

  'links.unshare': defineRequestContract({
    schema: z.object({
      linkId: z.string(),
      userId: z.string(),
    }),
  }),

  'links.update': defineRequestContract({
    sourceToDerived: { description: { textLength: derive.textLength } },
    schema: z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      description: unreadableString().optional(),
      favicon: z.string().optional(),
      visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
      updatedAt: z.number(),
    }),
  }),

  'messageAttachment.delete': defineRequestContract({
    schema: z.object({ attachmentId: z.string() }),
  }),

  'messageAttachment.deleteMany': defineRequestContract({
    schema: z.object({ attachmentIds: z.array(z.string()) }),
  }),

  'messages.closeSlashCommandArtifact': defineRequestContract({
    schema: z.object({ messageId: z.string(), timestamp: z.number() }),
  }),

  'messages.delete': defineRequestContract({
    schema: z.object({ messageId: z.string() }),
  }),

  'messages.handleNonParticipantAction': defineRequestContract({
    schema: z.object({
      messageId: z.string(),
      action: z.enum(['add', 'add_all', 'ignore', 'ignore_all']),
      userIds: z.array(z.string()),
      channelId: z.string()
    }),
  }),

  'messages.react': defineRequestContract({
    schema: z.object({
      messageId: z.string(),
      emojiName: z.string(),
      action: z.enum(['add', 'remove']),
      timestamp: z.number(),
      reactionId: z.string().optional(),
      countId: z.string().optional(),
    }),
  }),

  /**
   * A reply in a thread. Mentions for the guest check and, by the participant rule, for who is
   * added; Meet links; the slash-command artifact, for the one-open-artifact-per-thread rule. No
   * facts means the content was empty.
   */
  'messages.send': defineRequestContract({
    sourceToDerived: {
      content: {
        userIds: derive.userIds,
        groupIds: derive.groupIds,
        handles: derive.handles,
        spanMentionUserIds: derive.spanMentionUserIds,
        spanMentionGroupIds: derive.spanMentionGroupIds,
        meetLinks: derive.meetLinks,
        slashArtifactCommand: derive.slashArtifactCommand,
      },
    },
    schema: z.object({
      conversationId: z.string(),
      content: unreadableString(),
      type: z.nativeEnum(MessageType),
      showInChannel: z.boolean().optional(),
      timestamp: z.number(),
      messageId: z.string(),
      childConversationId: z.string().optional(),
      attachmentIds: z.array(z.string()).optional(),
    }),
  }),

  /**
   * For a forwarded message `content` is only the new optional text: the server builds the edited
   * forward from the stored one (`forwardedMessageEditTemplate`). `forwardedMessageId` is set only
   * when the text is itself a forward's XML (an older client), which is refused. No facts means the
   * content was empty.
   */
  'messages.update': defineRequestContract({
    sourceToDerived: {
      content: {
        userIds: derive.userIds,
        groupIds: derive.groupIds,
        handles: derive.handles,
        spanMentionUserIds: derive.spanMentionUserIds,
        spanMentionGroupIds: derive.spanMentionGroupIds,
        forwardedMessageId: derive.forwardedMessageId,
      },
    },
    schema: z.object({
      messageId: z.string(),
      content: unreadableString().optional(),
    }),
  }),

  'messages.updateShowInChannel': defineRequestContract({
    schema: z.object({
      messageId: z.string(),
      showInChannel: z.boolean(),
      childConversationId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'nonLinear.syncTransitions': defineRequestContract({
    schema: z.object({
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
  }),

  'nonLinear.transition': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
      toStageName: z.string(),
      // Caller-supplied timestamp. Passed from the client so the optimistic and
      // authoritative (server) runs of this mutator persist identical timestamps.
      now: z.number(),
      // JSON-encoded Record<string, unknown> — encoding avoids ReadonlyJSONValue incompatibility
      formValuesJson: z.string().optional(),
    }),
  }),

  'notificationSettings.setChannelNotificationLevel': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      desktopNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).nullable().optional(),
      mobileNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).nullable().optional(),
      threadReplyNotificationsEnabled: z.boolean().nullable().optional(),
      channelWideMentionsEnabled: z.boolean().nullable().optional(),
      timestamp: z.number(),
    }),
  }),

  'nudges.act': defineRequestContract({
    schema: z.object({
      nudgeId: z.string(),
      actionResult: z.any().optional(),
      timestamp: z.number(),
    }),
  }),

  'nudges.dismiss': defineRequestContract({
    schema: z.object({
      nudgeId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'org.create': defineRequestContract({
    schema: z.object({
      orgId: z.string(),
      orgName: z.string(),
      orgDescription: z.string().optional(),
      workspaceId: z.string(),
      workspaceOrgId: z.string(),
      memberId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'orgMember.add': defineRequestContract({
    schema: z.object({
      memberId: z.string(),
      orgId: z.string(),
      email: z.string(),
      role: z.string(),
      timestamp: z.number(),
    }),
  }),

  'orgMember.remove': defineRequestContract({
    schema: z.object({
      memberId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'orgMember.updateRole': defineRequestContract({
    schema: z.object({
      memberId: z.string(),
      updates: z.object({
        role: z.enum([OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER]).optional(),
      }),
    }),
  }),

  'project.delete': defineRequestContract({
    schema: z.object({ projectId: z.string() }),
  }),

  'project.saveReleaseBoardConfig': defineRequestContract({
    schema: z.object({
      mainBoardId: z.string(),
      mainBoardName: z.string(),
      releaseTrackingMode: z.nativeEnum(ReleaseTrackingMode),
      channelId: z.string(),
      hubChannelId: z.string(),
      repoId: z.string(),
      applications: z.array(
        z.object({
          id: z.string(),
          boardId: z.string(),
          boardName: z.string(),
          name: z.string(),
          regex: z.string(),
          ownerTeam: z.string(),
          envPaths: z.array(z.string()),
          migrationPaths: z.array(z.string()),
        }),
      ),
    }),
  }),

  'project.update': defineRequestContract({
    schema: z.object({ projectId: z.string(), name: z.string().optional(), description: z.string().optional(), timestamp: z.number() }),
  }),

  'query.delete': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  'query.reorder': defineRequestContract({
    schema: z.object({
      orderedMappingIds: z.array(z.string()),
      timestamp: z.number(),
    }),
  }),

  'query.upsert': defineRequestContract({
    schema: z.object({
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
  }),

  /** `summary` and `rootCause` list one fact so that "no facts" means empty (`x || null`). */
  'rca.create': defineRequestContract({
    sourceToDerived: {
      title: {},
      summary: { textLength: derive.textLength },
      rootCause: { textLength: derive.textLength },
    },
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      ownerId: z.string().optional(),
      title: unreadableString(),
      summary: unreadableString().optional(),
      rootCause: unreadableString().optional(),
      severity: z.nativeEnum(SEVERITY),
      bugTypeId: z.string(),
      categoryTypeId: z.string(),
      issueCategoryId: z.string().optional(),
      issueStartAt: z.number().optional().nullable(),
      status: z.nativeEnum(RCAStatus),
      timestamp: z.number(),
    }),
  }),

  'rca.update': defineRequestContract({
    sourceToDerived: { title: {}, summary: {}, rootCause: {} },
    schema: z.object({
      id: z.string(),
      ticketId: z.string().optional(),
      title: unreadableString().optional(),
      summary: unreadableString().optional(),
      rootCause: unreadableString().optional(),
      severity: z.nativeEnum(SEVERITY).optional(),
      bugTypeId: z.string().optional(),
      categoryTypeId: z.string().optional(),
      issueCategoryId: z.string().optional(),
      issueStartAt: z.number().optional().nullable(),
      status: z.nativeEnum(RCAStatus).optional(),
      timestamp: z.number(),
    }),
  }),

  'recap.markChannelRecapAsRead': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      recapDate: z.number(),
      timestamp: z.number(),
    }),
  }),

  'recap.markChannelRecapAsUnread': defineRequestContract({
    schema: z.object({
      channelId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'recap.markSeen': defineRequestContract({
    schema: z.object({
      recapDate: z.number(),
      timestamp: z.number(),
    }),
  }),

  'recap.saveSubscriptions': defineRequestContract({
    schema: z.object({
      channelIds: z.array(z.string()),
      timestamp: z.number(),
    }),
  }),

  'recap.setCustomRecapPrompt': defineRequestContract({
    sourceToDerived: { prompt: {} },
    schema: z.object({
      channelId: z.string(),
      prompt: unreadableString().nullable(),
      timestamp: z.number(),
    }),
  }),

  'releaseAttribution.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      releaseId: z.string(),
      releaseApplicationId: z.string().optional().nullable(),
      rootCauseTicketId: z.string().optional().nullable(),
      confidence: z.nativeEnum(AttributionConfidence),
      timestamp: z.number(),
    }),
  }),

  'releaseAttribution.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'releaseAttribution.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      releaseId: z.string().optional(),
      releaseApplicationId: z.string().optional().nullable(),
      rootCauseTicketId: z.string().optional().nullable(),
      confidence: z.nativeEnum(AttributionConfidence).optional(),
    }),
  }),

  'repo.addBranch': defineRequestContract({
    schema: z.object({ id: z.string(), branchName: z.string() }),
  }),

  'repo.create': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      baseBranch: z.array(z.string()),
      prefix: z.string(),
    }),
  }),

  'repo.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'repo.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      url: z.string().optional(),
      baseBranch: z.array(z.string()).optional(),
      prefix: z.string().optional(),
    }),
  }),

  'resourceAccess.grant': defineRequestContract({
    schema: z.object({
      grants: z.array(z.object({
        id: z.string(),
        userId: z.string(),
        resourceId: z.string(),
        accessType: z.nativeEnum(AccessType),
      })),
      timestamp: z.number(),
    }),
  }),

  'resourceAccess.revoke': defineRequestContract({
    schema: z.object({
      ids: z.array(z.string()),
    }),
  }),

  'resourceAccess.update': defineRequestContract({
    schema: z.object({
      updates: z.array(z.object({
        id: z.string(),
        accessType: z.nativeEnum(AccessType),
      })),
      timestamp: z.number(),
    }),
  }),

  'role.addMembers': defineRequestContract({
    schema: z.object({
      roleId: z.string(),
      userIds: z.array(z.string()),
      mappingIds: z.record(z.string(), z.string()),
      timestamp: z.number(),
    }),
  }),

  'role.create': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      name: z.string(),
      description: unreadableString().optional(),
      timestamp: z.number(),
    }),
  }),

  'role.removeMembers': defineRequestContract({
    schema: z.object({
      mappingIds: z.array(z.string()),
    }),
  }),

  'role.update': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: unreadableString().optional(),
      timestamp: z.number(),
    }),
  }),

  'savedUserConfiguration.create': defineRequestContract({
    schema: z.object({
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
  }),

  'savedUserConfiguration.delete': defineRequestContract({
    schema: z.object({
      configId: z.string(),
    }),
  }),

  'savedUserConfiguration.update': defineRequestContract({
    schema: z.object({
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
  }),

  /**
   * `linkDescription` is the encrypted, top-level description; `link.description` is still accepted
   * (plaintext) from older clients. `rawLength` checks the 2000 limit.
   */
  'sdlc.addSdlcFolderItem': defineRequestContract({
    sourceToDerived: { linkDescription: { rawLength: derive.rawLength } },
    schema: z.object({
      itemType: z.enum(['ATTACHMENT', 'LINK']),
      itemId: z.string(),
      containmentLinkId: z.string(),
      flatLinkId: z.string(),
      channelId: z.string(),
      trackId: z.string(),
      parentType: z.enum(['TRACK', 'FOLDER']),
      parentId: z.string(),
      link: z
        .object({
          url: z.string().min(1),
          title: z.string().trim().min(1).max(300),
          description: z.string().trim().max(2000).optional(),
          favicon: z.string().optional(),
        })
        .optional(),
      linkDescription: unreadableString(z.string().trim()).optional(),
      timestamp: z.number(),
    }),
  }),

  'sdlc.createLink': defineRequestContract({
    schema: createSdlcLinkSchema.extend({
      id: z.string(),
      channelId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'sdlc.createSdlcFolder': defineRequestContract({
    schema: z.object({
      id: z.string(),
      containmentLinkId: z.string(),
      flatLinkId: z.string(),
      channelId: z.string(),
      trackId: z.string(),
      parentType: z.enum(['TRACK', 'FOLDER']),
      parentId: z.string(),
      name: z.string().trim().min(1).max(120),
      timestamp: z.number(),
    }),
  }),

  /**
   * `rawLength` checks the 2000 limit on the description, which zod cannot measure on ciphertext.
   */
  'sdlc.createTrack': defineRequestContract({
    sourceToDerived: { description: { rawLength: derive.rawLength } },
    schema: z.object({
      id: z.string(),
      linkId: z.string(),
      channelId: z.string(),
      name: z.string().trim().min(1).max(120),
      description: unreadableString(z.string().trim()).optional(),
      timestamp: z.number(),
    }),
  }),

  'sdlc.deleteLink': defineRequestContract({
    schema: z.object({ channelId: z.string(), linkId: z.string() }),
  }),

  'sdlc.moveSdlcItem': defineRequestContract({
    schema: z.object({
      linkId: z.string(),
      channelId: z.string(),
      itemType: z.enum(['FOLDER', 'CANVAS', 'LINK', 'ATTACHMENT']),
      itemId: z.string(),
      parentType: z.enum(['TRACK', 'FOLDER']),
      parentId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'sdlc.renameSdlcFolder': defineRequestContract({
    schema: z.object({
      folderId: z.string(),
      channelId: z.string(),
      name: z.string().trim().min(1).max(120),
      timestamp: z.number(),
    }),
  }),

  'sdlc.renameSdlcItem': defineRequestContract({
    schema: z.object({
      itemType: z.enum(['LINK', 'ATTACHMENT']),
      itemId: z.string(),
      channelId: z.string(),
      name: z.string().trim().min(1).max(300),
      timestamp: z.number(),
    }),
  }),

  'sdlc.setSdlcFolderIcon': defineRequestContract({
    schema: z.object({
      folderId: z.string(),
      channelId: z.string(),
      // Null goes back to the folder mark.
      icon: sdlcIconNameSchema.nullable(),
      timestamp: z.number(),
    }),
  }),

  /**
   * `rawLength` checks the 2000 limit on the description, which zod cannot measure on ciphertext.
   */
  'sdlc.updateTrack': defineRequestContract({
    sourceToDerived: { description: { rawLength: derive.rawLength } },
    schema: z.object({
      trackId: z.string(),
      name: z.string().trim().min(1).max(120).optional(),
      description: unreadableString(z.string().trim()).nullable().optional(),
      status: sdlcTrackStatusSchema.optional(),
      icon: sdlcIconNameSchema.nullable().optional(),
      timestamp: z.number(),
    }),
  }),

  /** `description` lists one fact so that "no facts" means it was empty (`description || null`). */
  'subTicket.create': defineRequestContract({
    sourceToDerived: {
      title: {},
      description: { textLength: derive.textLength },
    },
    schema: z.object({
      subTicketId: z.string(),
      mappingId: z.string(),
      timestamp: z.number(),
      title: unreadableString(),
      description: unreadableString().optional(),
      ticketId: z.string(),
      conversationId: z.string().optional(),
      subTicketXyneId: z.string().optional(),
    }),
  }),

  'subTicket.update': defineRequestContract({
    schema: z.object({
      subTicketId: z.string(),
      timestamp: z.number(),
      mappedTicketId: z.string().optional(),
      conversationId: z.string().optional(),
      assignedTo: z.string().optional().nullable(),
    }),
  }),

  'threadTag.setTypes': defineRequestContract({
    schema: z.object({
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
  }),

  'ticket.acknowledgeEtaRisk': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
      expectedFingerprint: z.string(),
      reason: z.string().min(1),
      clientTimestamp: z.number(),
    }),
  }),

  'ticket.archiveDeskTicket': defineRequestContract({
    schema: z.object({
      id: z.string(),
      updatedAt: z.number(),
    }),
  }),

  /**
   * Clients send `description` only when it changed (they compare the plaintext), so the server
   * treats "sent" as "changed".
   */
  'ticket.update': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      id: z.string(),
      title: z.string().optional(),
      description: unreadableString().optional(),
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
  }),

  'ticket.updateAssignment': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
      assignedTo: z.string().nullable(),
      timestamp: z.number(),
    }),
  }),

  'ticketMailbox.setStarred': defineRequestContract({
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      channelId: z.string(),
      starred: z.boolean(),
      timestamp: z.number(),
    }),
  }),

  'ticketMailbox.setState': defineRequestContract({
    schema: z.object({
      id: z.string(),
      ticketId: z.string(),
      channelId: z.string(),
      state: z.nativeEnum(MailboxState),
      timestamp: z.number(),
    }),
  }),

  'ticketReference.create': defineRequestContract({
    schema: z.object({
      sourceTicketId: z.string(),
      targetTicketId: z.string(),
      relationType: z.nativeEnum(TicketReferenceRelation),
      timestamp: z.number(),
      referenceId: z.string(),
    }),
  }),

  'ticketReference.delete': defineRequestContract({
    schema: z.object({ id: z.string() }),
  }),

  'ticketReference.updateRelationType': defineRequestContract({
    schema: z.object({
      id: z.string(),
      relationType: z.nativeEnum(TicketReferenceRelation),
      timestamp: z.number(),
    }),
  }),

  'ticketStageEta.update': defineRequestContract({
    schema: z.object({
      id: z.string(),
      stageEta: z.number(),
      updatedAt: z.number(),
      ticketId: z.string().optional(),
      stageId: z.string().optional(),
    }),
  }),

  'ticketStageRequest.deleteByTicketId': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
    }),
  }),

  'ticketStageRequest.upsert': defineRequestContract({
    schema: z.object({
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
  }),

  'ticketTag.create': defineRequestContract({
    schema: z.object({ ticketId: z.string(), tagName: z.string(), tagId: z.string() }),
  }),

  'ticketTag.delete': defineRequestContract({
    schema: z.object({ tagId: z.string() }),
  }),

  'ticketTagV2.create': defineRequestContract({
    schema: z.object({
      ticketId: z.string(),
      tagName: z.string(),
      tagId: z.string(),
      projectTagId: z.string(),
      mappingId: z.string(),
      projectId: z.string(),
    }),
  }),

  'ticketTagV2.delete': defineRequestContract({
    schema: z.object({ tagId: z.string(), mappingId: z.string() }),
  }),

  'userGroup.addUsers': defineRequestContract({
    schema: z.object({ userGroupId: z.string(), userIds: z.array(z.string()), timestamp: z.number(), mappingIds: z.record(z.string(), z.string()), roleIds: z.array(z.string()).optional() }),
  }),

  'userGroup.deactivate': defineRequestContract({
    schema: z.object({ userGroupId: z.string(), timestamp: z.number() }),
  }),

  'userGroup.delete': defineRequestContract({
    schema: z.object({ userGroupId: z.string() }),
  }),

  'userGroup.reactivate': defineRequestContract({
    schema: z.object({ userGroupId: z.string(), timestamp: z.number() }),
  }),

  'userGroup.removeUsers': defineRequestContract({
    schema: z.object({
      userGroupId: z.string(),
      userIds: z.array(z.string()),
      reassignTickets: z.boolean().optional(),
    }),
  }),

  'userGroup.update': defineRequestContract({
    schema: z.object({
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
  }),

  'userPreference.setAllowThreadBroadcastMentions': defineRequestContract({
    schema: z.object({
      id: z.string(),
      allowThreadBroadcastMentions: z.boolean(),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setChannelSortOrder': defineRequestContract({
    schema: z.object({
      id: z.string(),
      channelSortOrder: z.nativeEnum(ChannelSortOrder),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setEnterSendsMessage': defineRequestContract({
    schema: z.object({
      id: z.string(),
      enterSendsMessage: z.boolean(),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setGlobalNotificationSettings': defineRequestContract({
    schema: z.object({
      id: z.string(),
      globalDesktopNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
      globalMobileNotificationLevel: z.enum(['ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE']).optional(),
      threadReplyNotificationsEnabled: z.boolean().optional(),
      channelWideMentionsEnabled: z.boolean().optional(),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setNotificationKeywords': defineRequestContract({
    schema: z.object({
      id: z.string(),
      keywords: z.array(z.string().min(1).max(MAX_NOTIFICATION_KEYWORD_LENGTH)).max(MAX_NOTIFICATION_KEYWORDS),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setRecordingDefaultSummaryTemplate': defineRequestContract({
    schema: z.object({
      id: z.string(),
      // `null` clears the default so recordings go back to the automatic pick.
      recordingDefaultSummaryTemplateId: z.string().min(1).nullable(),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setShowThreadTags': defineRequestContract({
    schema: z.object({
      id: z.string(),
      showThreadTags: z.boolean(),
      timestamp: z.number(),
    }),
  }),

  'userPreference.setSidebarGroupPreference': defineRequestContract({
    schema: z.object({
      id: z.string(),
      group: z.enum(['starred', 'channels', 'dms']),
      filterMode: z.nativeEnum(ChannelFilterMode).optional(),
      sortOrder: z.nativeEnum(ChannelSortOrder).optional(),
      timestamp: z.number(),
    }),
  }),

  /** `statusContent` is stored in `user_presence` and in `users`. */
  'userPresence.upsert': defineRequestContract({
    sourceToDerived: { statusContent: {} },
    schema: z.object({
      statusEmoji: z.string().nullable().optional(),
      statusContent: unreadableString().nullable().optional(),
      statusExpiryAt: z.number().nullable().optional(),
      assignmentUnavailableUntil: z.number().nullable().optional(),
      notificationsPausedUntil: z.number().nullable().optional(),
      timestamp: z.number(),
      presenceId: z.string(),
    }),
  }),

  'userProfile.upsert': defineRequestContract({
    schema: z.object({
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
  }),

  'users.remove': defineRequestContract({
    schema: z.object({
      workspaceId: z.string(),
      userId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'users.updateRole': defineRequestContract({
    schema: z.object({
      workspaceId: z.string(),
      userId: z.string(),
      updates: z.object({
        role: z.enum([WorkspaceRole.ADMIN, WorkspaceRole.MEMBER]).optional(),
      }),
      timestamp: z.number(),
    }),
  }),

  'viewAccess.grant': defineRequestContract({
    schema: z.object({
      id: z.string(),
      viewId: z.string(),
      entityType: z.nativeEnum(ViewAccessEntityType),
      entityId: z.string(),
      timestamp: z.number(),
    }),
  }),

  'viewAccess.revoke': defineRequestContract({
    schema: z.object({
      id: z.string(),
    }),
  }),

  /**
   * `updates` is the old nested shape, still accepted from older clients; nothing in it is encrypted.
   */
  'workspace.update': defineRequestContract({
    sourceToDerived: { description: {} },
    schema: z.object({
      workspaceId: z.string(),
      timestamp: z.number(),
      name: z.string().optional(),
      description: unreadableString().optional(),
      updates: z
        .object({
          name: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
    }),
  }),

  'workspaceOrg.add': defineRequestContract({
    schema: z.object({
      workspaceId: z.string(),
      orgId: z.string(),
      id: z.string(),
      timestamp: z.number(),
    }),
  }),

  'workspaceOrg.remove': defineRequestContract({
    schema: z.object({
      workspaceId: z.string(),
      orgId: z.string(),
      timestamp: z.number(),
    }),
  }),
} satisfies Record<string, RequestContract>;

export type MutatorName = keyof typeof mutatorContracts;

export function isMutatorName(name: string): name is MutatorName {
  return Object.prototype.hasOwnProperty.call(mutatorContracts, name);
}
