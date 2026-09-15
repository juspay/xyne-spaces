/**
 * v1 argument parsers: SDK operation id -> arguments its target expects.
 *
 * Only operations that need reshaping appear here; anything absent passes its
 * arguments through untouched. Three jobs, all of which exist so the client does
 * not have to know how Zero works:
 *
 *   1. Mint primary keys. Zero's optimistic-write model expects the writer to
 *      supply the id of a row it creates. v1 mints it and returns it, so the
 *      caller gets the id without inventing it.
 *   2. Stamp timestamps. These are *server* time. Taking them from the client's
 *      clock — as the old client-side registry did — meant a skewed laptop wrote
 *      skewed rows.
 *   3. Fill arguments that are required by a schema but meaningless to a caller:
 *      ACL hints like `isMember`, page defaults, `null` placeholders for optional
 *      filters that are nullable rather than omissible.
 */

import { randomUUID } from 'crypto';
import type { V1Parsed, V1Parser } from './types';

/** Server-side row id, in the same format Zero's own clients generate. */
function newId(): string {
  return randomUUID();
}

/** Epoch milliseconds, from the server clock. */
function now(): number {
  return Date.now();
}

/**
 * One fresh id per key, for mutators that create a row per element of a list —
 * inviting five people to a call needs five participant ids.
 */
function newIdMap(keys: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of keys) map[key] = newId();
  return map;
}

export const V1_PARSERS: Readonly<Record<string, V1Parser>> = {
  // ----- activities -----
  'activities.listPaginated': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      start: args.start ?? null,
      types: args.types ?? [],
    },
  }),
  'activities.markAsUnread': (args): V1Parsed => ({
    args: { activityId: args.activityId, timestamp: now() },
  }),
  'activities.markThreadAsRead': (args): V1Parsed => ({
    args: {
        conversationId: args.conversationId,
        draftMessage: args.draftMessage ?? '',
        draftMessageId: newId(),
        timestamp: now(),
        participantId: newId(),
      },
  }),
  'activities.markMissedCallsAsRead': (_args): V1Parsed => ({
    args: {},
  }),
  'activities.dismissNudge': (args): V1Parsed => ({
    args: { nudgeId: args.nudgeId, timestamp: now() },
  }),
  'activities.actOnNudge': (args): V1Parsed => ({
    args: {
      nudgeId: args.nudgeId,
      ...(args.actionResult !== undefined ? { actionResult: args.actionResult } : {}),
      timestamp: now(),
    },
  }),
  'activities.markAsReadByFilter': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- admin -----
  'admin.listAvailableOrgs': (_args): V1Parsed => ({
    args: {},
  }),
  'admin.updateWorkspace': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.createOrg': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.addOrgToWorkspace': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.removeOrgFromWorkspace': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.addOrgMember': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.updateOrgMemberRole': (args): V1Parsed => ({
    args: { memberId: args.memberId, updates: { role: args.role } },
  }),
  'admin.removeOrgMember': (args): V1Parsed => ({
    args: { memberId: args.memberId, timestamp: now() },
  }),
  'admin.updateUserRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.removeUser': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.revokeInvitation': (args): V1Parsed => ({
    args: { invitationId: args.invitationId, timestamp: now() },
  }),
  'admin.listRoles': (args): V1Parsed => ({
    args: {
      ...(args?.limit !== undefined ? { limit: args.limit } : {}),
      start: args?.start ?? null,
    },
  }),
  'admin.createRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.updateRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.addRoleMembers': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'admin.grantAccess': (args): V1Parsed => ({
    args: { grants: args.grants, timestamp: now() },
  }),
  'admin.updateAccess': (args): V1Parsed => ({
    args: { updates: args.updates, timestamp: now() },
  }),
  'admin.listInstalledApps': (args): V1Parsed => ({
    args: { limit: args?.limit ?? 50, start: args?.start ?? null },
  }),
  'admin.listOrgApps': (args): V1Parsed => ({
    args: {
        orgId: args.orgId,
        limit: args?.limit ?? 50,
        start: args?.start ?? null,
      },
  }),
  'admin.listMarketplaceApps': (args): V1Parsed => ({
    args: { limit: args?.limit ?? 50, start: args?.start ?? null },
  }),
  'admin.updateApp': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- automations -----
  'automations.listWorkflows': (args): V1Parsed => ({
    args: { limit: args?.limit ?? 50, start: args?.start ?? null },
  }),
  'automations.createProposal': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'automations.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'automations.submitForApproval': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'automations.revoke': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'automations.approve': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'automations.reject': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'automations.activate': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'automations.disable': (args): V1Parsed => ({
    args: {
      id: args.id,
      timestamp: now(),
      ...(args.cancelQueued !== undefined ? { cancelQueued: args.cancelQueued } : {}),
    },
  }),
  'automations.archive': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),

  // ----- boards -----
  'boards.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'boards.syncTransitions': (args): V1Parsed => ({
    args: {
      boardId: args.boardId,
      transitions: args.transitions,
      now: now(),
    },
  }),
  'boards.updateFlowPlan': (args): V1Parsed => ({
    args: {
        boardId: args.boardId,
        plan: args.plan,
        timestamp: now(),
      },
  }),

  // ----- calls -----
  'calls.listHistory': (args): V1Parsed => ({
    args: { limit: args.limit ?? 50, start: args.start ?? null },
  }),
  'calls.listSummaryTemplates': (_args): V1Parsed => ({
    args: {},
  }),
  'calls.listRecordings': (args): V1Parsed => ({
    args: { limit: args.limit ?? 50, start: args.start ?? null },
  }),
  'calls.listCreatedRecordings': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      start: args.start ?? null,
      // Required key, nullable value: the schema says `.nullable()`, not
      // `.optional()`, so it must be sent even when filtering by nobody.
      participantId: args.participantId ?? null,
    },
  }),
  'calls.listSharedRecordings': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      start: args.start ?? null,
      // Required key, nullable value: the schema says `.nullable()`, not
      // `.optional()`, so it must be sent even when filtering by nobody.
      participantId: args.participantId ?? null,
    },
  }),
  'calls.initiate': (args): V1Parsed => ({
    args: {
      callId: args.callId,
      channelId: args.channelId,
      callType: args.callType,
      externalId: args.externalId,
      roomLink: args.roomLink,
      timestamp: now(),
      creatorParticipantId: newId(),
      ...(args.targetUserIds
        ? {
            targetUserIds: args.targetUserIds,
            targetParticipantIds: newIdMap(args.targetUserIds),
          }
        : {}),
    },
  }),
  'calls.join': (args): V1Parsed => ({
    args: {
      callId: args.callId,
      timestamp: now(),
      participantId: newId(),
    },
  }),
  'calls.leave': (args): V1Parsed => ({
    args: { callId: args.callId, timestamp: now() },
  }),
  'calls.reject': (args): V1Parsed => ({
    args: { callId: args.callId, timestamp: now() },
  }),
  'calls.cancel': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'calls.invite': (args): V1Parsed => ({
    args: {
      callId: args.callId,
      userIds: args.userIds,
      timestamp: now(),
      participantIds: newIdMap(args.userIds),
    },
  }),
  'calls.requestToJoin': (args): V1Parsed => ({
    args: {
      callId: args.callId,
      participantId: newId(),
      timestamp: now(),
    },
  }),
  'calls.cancelJoinRequest': (args): V1Parsed => ({
    args: { callId: args.callId, timestamp: now() },
  }),

  // ----- canvases -----
  'canvases.list': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.includeQuartoDocs !== undefined
        ? { includeQuartoDocs: args.includeQuartoDocs }
        : {}),
      ...(args.direction ? { direction: args.direction } : {}),
    },
  }),
  'canvases.listQuartoDocs': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.direction ? { direction: args.direction } : {}),
    },
  }),
  'canvases.listByChannel': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.includeQuartoDocs !== undefined
        ? { includeQuartoDocs: args.includeQuartoDocs }
        : {}),
    },
  }),
  'canvases.listQuartoDocsByChannel': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    },
  }),
  'canvases.createFolder': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.updateFolder': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.create': (args): V1Parsed => ({
    args: {
      ...args,
      timestamp: now(),
      participantId: newId(),
      // Share-link tokens, minted up front so the canvas is shareable at once.
      viewAccessId: newId(),
      editAccessId: newId(),
    },
  }),
  'canvases.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.toggleStarred': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.addParticipants': (args): V1Parsed => ({
    args: {
      canvasId: args.canvasId,
      userIds: args.userIds,
      role: args.role,
      timestamp: now(),
      participantIds: args.userIds.map(() => newId()),
    },
  }),
  'canvases.addGroupParticipant': (args): V1Parsed => ({
    args: { ...args, participantId: newId(), timestamp: now() },
  }),
  'canvases.addChannelParticipant': (args): V1Parsed => ({
    args: { ...args, participantId: newId(), timestamp: now() },
  }),
  'canvases.updateParticipantRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.updateGroupParticipantRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.updateChannelParticipantRole': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.createCommentThread': (args): V1Parsed => ({
    args: {
      threadId: args.threadId,
      commentId: args.commentId,
      canvasId: args.canvasId,
      blockId: args.blockId,
      body: args.body,
      ...(args.anchorText ? { anchorText: args.anchorText } : {}),
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    },
  }),
  'canvases.replyToThread': (args): V1Parsed => ({
    args: {
      commentId: args.commentId,
      threadId: args.threadId,
      canvasId: args.canvasId,
      body: args.body,
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    },
  }),
  'canvases.updateComment': (args): V1Parsed => ({
    args: {
      commentId: args.commentId,
      body: args.body,
      mentionedUserIds: args.mentionedUserIds ?? [],
      timestamp: now(),
    },
  }),
  'canvases.deleteComment': (args): V1Parsed => ({
    args: { commentId: args.commentId, timestamp: now() },
  }),
  'canvases.setThreadStatus': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.saveVersion': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'canvases.restoreVersion': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),

  // ----- channels -----
  'channels.listAll': (args): V1Parsed => ({
    args: { updatedAt: args?.updatedAt },
  }),
  'channels.join': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      channelParticipantId: newId(),
      channelUserStatusId: newId(),
      timestamp: now(),
    },
  }),
  'channels.leave': (args): V1Parsed => ({
    args: { channelId: args.channelId, updatedAt: now() },
  }),
  'channels.addParticipants': (args): V1Parsed => ({
    args: {
        channelId: args.channelId,
        userIds: args.userIds,
        timestamp: now(),
        participantIds: newIdMap(args.userIds),
        userStatusIds: newIdMap(args.userIds),
      },
  }),
  'channels.removeParticipant': (args): V1Parsed => ({
    args: {
        channelId: args.channelId,
        targetUserId: args.userId,
        updatedAt: now(),
      },
  }),
  'channels.updateParticipantRole': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      targetUserId: args.userId,
      newRole: args.role,
      timestamp: now(),
      conversationId: newId(),
      messageId: newId(),
      conversationParticipantId: newId(),
    },
  }),
  'channels.rename': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      name: args.name,
      timestamp: now(),
    },
  }),
  'channels.updateDescription': (args): V1Parsed => ({
    args: {
        channelId: args.channelId,
        description: args.description,
        timestamp: now(),
        conversationId: newId(),
        messageId: newId(),
        conversationParticipantId: newId(),
      },
  }),
  'channels.toggleStarred': (args): V1Parsed => ({
    args: { channelId: args.channelId, updatedAt: now() },
  }),
  'channels.markAsViewed': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
      draftMessage: args.draftMessage ?? '',
      draftMessageId: newId(),
    },
  }),
  'channels.moveToSection': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      sectionId: args.sectionId,
      position: args.position,
      timestamp: now(),
    },
  }),
  'channels.createSection': (args): V1Parsed => ({
    args: {
      id: args.id,
      name: args.name,
      position: args.position,
      emoji: args.emoji ?? null,
      timestamp: now(),
    },
  }),
  'channels.updateSection': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'channels.removeSection': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'channels.closeDm': (args): V1Parsed => ({
    args: { channelId: args.channelId, updatedAt: now() },
  }),
  'channels.reopenDm': (args): V1Parsed => ({
    args: { channelId: args.channelId, updatedAt: now() },
  }),
  'channels.promoteToChannel': (args): V1Parsed => ({
    args: {
      ...args,
      conversationId: newId(),
      messageId: newId(),
      timestamp: now(),
    },
  }),
  'channels.markUnreadFrom': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'channels.setSelectedBoard': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'channels.listParticipantsPaginated': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    },
  }),

  // ----- collections -----
  'collections.list': (args): V1Parsed => ({
    args: { ...(args ?? {}) },
  }),
  'collections.listWithItems': (args): V1Parsed => ({
    args: { ...(args ?? {}) },
  }),
  'collections.create': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'collections.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'collections.delete': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'collections.createFolder': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'collections.renameItem': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'collections.deleteItem': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'collections.grantPermission': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- conversations -----
  'conversations.listByChannel': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      direction: args.direction ?? 'forward',
    },
  }),
  'conversations.listLatestByChannel': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 20,
    },
  }),
  'conversations.getWithChannel': (args): V1Parsed => ({
    args: {
      conversationId: args.conversationId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    },
  }),
  'conversations.getThread': (args): V1Parsed => ({
    args: {
      conversationId: args.conversationId,
      ...(args.channelId ? { channelId: args.channelId } : {}),
      isMember: args.isMember ?? true,
    },
  }),
  'conversations.listPinned': (args): V1Parsed => ({
    args: {
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      },
  }),
  'conversations.getLatest': (args): V1Parsed => ({
    args: {
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      },
  }),
  'conversations.listLabels': (args): V1Parsed => ({
    args: { isMember: true, ...args },
  }),
  'conversations.listAppliedLabels': (args): V1Parsed => ({
    args: { isMember: true, ...args },
  }),
  'conversations.create': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      content: args.content,
      type: args.type ?? 'USER',
      conversationId: args.conversationId,
      messageId: args.messageId,
      timestamp: now(),
      ...(args.attachmentIds ? { attachmentIds: args.attachmentIds } : {}),
    },
  }),
  'conversations.forwardMessage': (args): V1Parsed => ({
    args: {
      targetChannelId: args.targetChannelId,
      originalMessageId: args.originalMessageId,
      ...(args.optionalMessage ? { optionalMessage: args.optionalMessage } : {}),
      conversationId: args.conversationId,
      messageId: args.messageId,
      timestamp: now(),
      conversationParticipantId: newId(),
    },
  }),
  'conversations.subscribe': (args): V1Parsed => ({
    args: {
        conversationId: args.conversationId,
        timestamp: now(),
        participantId: newId(),
      },
  }),
  'conversations.markUnreadFrom': (args): V1Parsed => ({
    args: {
        conversationId: args.conversationId,
        messageId: args.messageId,
        participantId: newId(),
        timestamp: now(),
      },
  }),
  'conversations.getByTimestamp': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      timestamp: args.timestamp,
      isMember: args.isMember ?? true,
    },
  }),
  'conversations.listForUser': (args): V1Parsed => ({
    args: {
      userId: args.userId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    },
  }),
  'conversations.setTagTypes': (args): V1Parsed => ({
    args: {
      conversationId: args.conversationId,
      types: args.types,
      ...(args.note !== undefined ? { note: args.note } : {}),
      timestamp: now(),
    },
  }),

  // ----- dashboards -----
  'dashboards.upsert': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'dashboards.updateLayout': (args): V1Parsed => ({
    args: { updates: args.updates, timestamp: now() },
  }),
  'dashboards.upsertQuery': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'dashboards.reorderQueries': (args): V1Parsed => ({
    args: { orderedMappingIds: args.orderedMappingIds, timestamp: now() },
  }),

  // ----- email -----
  'email.listForConversations': (args): V1Parsed => ({
    args: {
      conversationIds: args.conversationIds,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    },
  }),
  'email.listSent': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.scope ? { scope: args.scope } : {}),
    },
  }),
  'email.listDrafts': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    },
  }),
  'email.getDraftForConversation': (args): V1Parsed => ({
    args: {
      conversationId: args.conversationId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    },
  }),
  'email.listLabels': (args): V1Parsed => ({
    args: { isMember: true, ...args },
  }),
  'email.saveDraft': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'email.saveComposeDraft': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'email.markAsRead': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'email.bulkMarkAsRead': (args): V1Parsed => ({
    args: { items: args.items, timestamp: now() },
  }),
  'email.createSignature': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'email.updateSignature': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'email.setDefaultSignature': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'email.createLabel': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'email.applyLabel': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- forms -----
  'forms.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'forms.createValue': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'forms.updateValue': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),

  // ----- incidents -----
  'incidents.listRcas': (args): V1Parsed => ({
    args: { limit: args?.limit ?? 50, start: args?.start ?? null },
  }),
  'incidents.listApplicationReleaseTickets': (args): V1Parsed => ({
    args: {
      releaseId: args.releaseId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    },
  }),
  'incidents.createRca': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.updateRca': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.createImpact': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.createAction': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.createAttribution': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.updateReleaseTicketStatus': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.setReleaseTicketTestedBy': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'incidents.listReleaseEvents': (args): V1Parsed => ({
    args: {
        releaseId: args.releaseId,
        limit: Math.min(args.limit ?? 50, 100),
      },
  }),

  // ----- messages -----
  'messages.listMine': (args): V1Parsed => ({
    args: {
        limit: args.limit ?? 50,
        start: args.start ?? null,
      },
  }),
  'messages.send': (args): V1Parsed => ({
    args: {
      conversationId: args.conversationId,
      content: args.content,
      type: args.type ?? 'USER',
      messageId: args.messageId,
      timestamp: now(),
      ...(args.showInChannel !== undefined
        ? { showInChannel: args.showInChannel, childConversationId: newId() }
        : {}),
      ...(args.attachmentIds ? { attachmentIds: args.attachmentIds } : {}),
    },
  }),
  'messages.react': (args): V1Parsed => ({
    args: {
      messageId: args.messageId,
      emojiName: args.emojiName,
      action: args.action,
      timestamp: now(),
      // Only meaningful when adding; harmless on remove, where the server
      // resolves the existing rows by (message, user, emoji).
      reactionId: newId(),
      countId: newId(),
    },
  }),
  'messages.setShowInChannel': (args): V1Parsed => ({
    args: {
        messageId: args.messageId,
        showInChannel: args.showInChannel,
        childConversationId: newId(),
        timestamp: now(),
      },
  }),
  'messages.closeSlashCommandArtifact': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'messages.listDrafts': (args): V1Parsed => ({
    args: { limit: args?.limit ?? 50 },
  }),
  'messages.editDraft': (args): V1Parsed => ({
    args: { id: args.id, content: args.content, timestamp: now() },
  }),
  'messages.sendDraft': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'messages.schedule': (args): V1Parsed => ({
    args: {
      id: args.id,
      channelId: args.channelId,
      content: args.content,
      scheduledFor: args.scheduledFor,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
    },
  }),
  'messages.cancelScheduled': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'messages.reschedule': (args): V1Parsed => ({
    args: {
        id: args.id,
        scheduledFor: args.scheduledFor,
        timestamp: now(),
      },
  }),
  'messages.editScheduled': (args): V1Parsed => ({
    args: { id: args.id, content: args.content, updatedAt: now() },
  }),
  'messages.sendScheduledNow': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'messages.scheduledToDraft': (args): V1Parsed => ({
    args: { id: args.id, timestamp: now() },
  }),
  'messages.listChannelAttachments': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      direction: args.direction ?? 'forward',
    },
  }),
  'messages.listScheduledPaginated': (args): V1Parsed => ({
    args: {
      limit: args.limit ?? 50,
      ...(args.statuses ? { statuses: args.statuses } : {}),
      start: args.start ?? null,
    },
  }),
  'messages.addDraftAttachments': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'messages.clearDraft': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- preferences -----
  'preferences.get': (_args): V1Parsed => ({
    args: {},
  }),
  'preferences.setNotificationSettings': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setNotificationKeywords': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setChannelNotifications': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setChannelSortOrder': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setSidebarGroup': (args): V1Parsed => ({
    args: {
      id: args.id,
      group: args.group,
      ...(args.filterMode ? { filterMode: args.filterMode } : {}),
      ...(args.sortOrder ? { sortOrder: args.sortOrder } : {}),
      timestamp: now(),
    },
  }),
  'preferences.setEnterSendsMessage': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setShowThreadTags': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.setAllowThreadBroadcastMentions': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.updateProfile': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.updatePresence': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.addBookmark': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.removeBookmark': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.createSavedView': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'preferences.updateSavedView': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- projects -----
  'projects.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- recaps -----
  'recaps.saveSubscriptions': (args): V1Parsed => ({
    args: { channelIds: args.channelIds, timestamp: now() },
  }),
  'recaps.setCustomPrompt': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'recaps.markSeen': (args): V1Parsed => ({
    args: { recapDate: args.recapDate, timestamp: now() },
  }),
  'recaps.markChannelRead': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'recaps.markChannelUnread': (args): V1Parsed => ({
    args: { channelId: args.channelId, timestamp: now() },
  }),

  // ----- supportTickets -----
  'supportTickets.list': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      dir: args.dir ?? 'forward',
      ...(args.assignedTo ? { assignedTo: args.assignedTo } : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      ...(args.stageName ? { stageName: args.stageName } : {}),
    },
  }),
  'supportTickets.listFiltered': (args): V1Parsed => ({
    args: {
      ...args,
      isMember: args.isMember ?? true,
      // Required by the query even when empty.
      dynamicFieldFilters: [],
    },
  }),
  'supportTickets.get': (args): V1Parsed => ({
    args: {
        id: args.id,
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      },
  }),
  'supportTickets.getByKey': (args): V1Parsed => ({
    args: {
      xyneId: args.xyneId,
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    },
  }),
  'supportTickets.getDetail': (args): V1Parsed => ({
    args: {
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      ...(args.id ? { id: args.id } : {}),
      ...(args.xyneId ? { xyneId: args.xyneId } : {}),
      isMember: args.isMember ?? true,
    },
  }),
  'supportTickets.listForEmailChannels': (args): V1Parsed => ({
    args: { ...(args ?? {}) },
  }),

  // ----- tickets -----
  'tickets.listKanban': (args): V1Parsed => ({
    args: {
      viewMode: args.viewMode,
      stageName: args.stageName ?? '',
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.columnType ? { columnType: args.columnType } : {}),
      ...(args.dir ? { dir: args.dir } : {}),
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.boardId ? { boardId: args.boardId } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      ...(args.groupId ? { groupId: args.groupId } : {}),
      ...(args.filters ? { filters: args.filters } : {}),
      ...(args.formEntityValueFieldIds
        ? { formEntityValueFieldIds: args.formEntityValueFieldIds }
        : {}),
      ...(args.showOverdueOnly !== undefined
        ? { showOverdueOnly: args.showOverdueOnly }
        : {}),
      ...(args.overdueReferenceTime !== undefined
        ? { overdueReferenceTime: args.overdueReferenceTime }
        : {}),
      ...(args.excludeFlowSteps !== undefined
        ? { excludeFlowSteps: args.excludeFlowSteps }
        : {}),
    },
  }),
  'tickets.listByChannelInWindow': (args): V1Parsed => ({
    args: {
      channelId: args.channelId,
      createdAtStart: args.createdAtStart,
      createdAtEnd: args.createdAtEnd,
      isMember: args.isMember ?? true,
    },
  }),
  'tickets.listActivitiesForTickets': (args): V1Parsed => ({
    args: {
      ticketIds: args.ticketIds,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    },
  }),
  'tickets.getMailbox': (args): V1Parsed => ({
    args: { isMember: true, ...args },
  }),
  'tickets.createSubTicket': (args): V1Parsed => ({
    args: {
      subTicketId: args.subTicketId,
      mappingId: args.mappingId,
      ticketId: args.ticketId,
      title: args.title,
      ...(args.description ? { description: args.description } : {}),
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
    },
  }),
  'tickets.updateSubTicket': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'tickets.update': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'tickets.assign': (args): V1Parsed => ({
    args: {
        ticketId: args.ticketId,
        assignedTo: args.assignedTo,
        timestamp: now(),
      },
  }),
  'tickets.archive': (args): V1Parsed => ({
    args: { id: args.id, updatedAt: now() },
  }),
  'tickets.setStageEta': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'tickets.addTag': (args): V1Parsed => ({
    args: {
        ticketId: args.ticketId,
        projectId: args.projectId,
        tagName: args.tagName,
        tagId: newId(),
        projectTagId: newId(),
        mappingId: newId(),
      },
  }),
  'tickets.addReference': (args): V1Parsed => ({
    args: {
      sourceTicketId: args.sourceTicketId,
      targetTicketId: args.targetTicketId,
      relationType: args.relationType,
      referenceId: newId(),
      timestamp: now(),
    },
  }),
  'tickets.updateReference': (args): V1Parsed => ({
    args: { id: args.id, relationType: args.relationType, timestamp: now() },
  }),
  'tickets.upsertStageRequest': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'tickets.transitionStage': (args): V1Parsed => ({
    args: {
      ticketId: args.ticketId,
      toStageName: args.toStageName,
      ...(args.formValuesJson ? { formValuesJson: args.formValuesJson } : {}),
      now: now(),
    },
  }),
  'tickets.setMailboxState': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'tickets.setMailboxStarred': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- userGroups -----
  'userGroups.search': (args): V1Parsed => ({
    args: { query: args.query, limit: args.limit ?? null },
  }),
  'userGroups.update': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'userGroups.deactivate': (args): V1Parsed => ({
    args: { userGroupId: args.userGroupId, timestamp: now() },
  }),
  'userGroups.reactivate': (args): V1Parsed => ({
    args: { userGroupId: args.userGroupId, timestamp: now() },
  }),
  'userGroups.addUsers': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'userGroups.updateAssignmentConfig': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),
  'userGroups.toggleAutoRotation': (args): V1Parsed => ({
    args: { ...args, timestamp: now() },
  }),

  // ----- workspace -----
  'workspace.createLink': (args): V1Parsed => ({
    args: { ...args, createdAt: now(), updatedAt: now() },
  }),
  'workspace.updateLink': (args): V1Parsed => ({
    args: { ...args, updatedAt: now() },
  }),
  'workspace.shareLink': (args): V1Parsed => ({
    args: { ...args, createdAt: now() },
  }),
  'workspace.createSdlcTrack': (args): V1Parsed => ({
    args: { id: newId(), timestamp: now(), ...args },
  }),
  'workspace.updateSdlcTrack': (args): V1Parsed => ({
    args: { timestamp: now(), ...args },
  }),
  'workspace.createClassificationMapping': (args): V1Parsed => ({
    args: { ...args, createdAt: now() },
  }),
};

/**
 * Shape one operation's arguments for its target.
 *
 * An operation with no parser forwards what it was given, which is the common
 * case: most catalog operations take exactly the arguments the SDK exposes.
 */
export function parseV1Args(op: string, args: unknown): V1Parsed {
  const parser = Object.prototype.hasOwnProperty.call(V1_PARSERS, op)
    ? V1_PARSERS[op]
    : undefined;
  if (!parser) return { args: args ?? {} };
  return parser((args ?? {}) as Record<string, unknown>);
}

export { newId, newIdMap, now };
