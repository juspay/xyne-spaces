import type { PrismaClient } from '@prisma/client';
import { Prisma, CallParticipant } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { InvitationResponse, MeetingStatus, CallType, CallOrigin, CallStatus, MessageArtifactStatus, RingStatus, MessageType, TagMethod } from '@xyne/shared';
import { normalizeEmailList } from '@/utils/email';
import { refreshCallParticipantPreview } from '@/utils/callParticipantCountUtils';
import { DatabaseClient } from '@/database/client';
import type { Call } from '@prisma/client';
import { transaction } from '../base';
import { setSlashCommandArtifactLifecycle } from '@/database/repositories/messageArtifactRepository';
import { CallMetadata, CallRepository, CreateCallParticipantInput, parseRecordingParticipantIds, scheduledCallPillContent, scheduledCallPillMetadata } from '@/database/repositories/callRepository';
import { queueCallVespaFeed, CallVespaFeedSource } from '@/services/callVespaQueue';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { logger } from '@/utils/logger';
import { advisoryXactLock } from '@/bypassAcl/lockServices';
import { queueScheduledCallPillSync } from '@/services/scheduledCallPillSync';
export function linkArtifactToActiveCallTx(callId: string, metadata: any, artifactMessageId: string, channelId: string, callExternalId: string) {
  return transaction(['Call', 'Conversation', 'Message', 'MessageArtifact'], 'linkArtifactToActiveCall: call metadata link and artifact lifecycle activation must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    await tx.call.update({
      where: { id: callId },
      data: {
        metadata: {
          ...((metadata as CallMetadata | null) ?? {}),
          artifactMessageId,
        } as Prisma.InputJsonValue,
      },
    });

    await setSlashCommandArtifactLifecycle(tx, {
      messageId: artifactMessageId,
      channelId,
      status: MessageArtifactStatus.ACTIVE,
      callExternalId,
    });
  });
}
export function updateRecordingParticipantsTx(lockKey: string, externalId: string, action: string, userId: string) {
  return transaction(['Call'], 'updateRecordingParticipants: advisory-locked recording participant list update must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    await advisoryXactLock(tx, ['Call'],
      'call recording participants: serialize participant reconciliation for one call',
      lockKey);

    const call = await tx.call.findUnique({
      where: { externalId },
      select: { recordingParticipants: true },
    });
    if (!call) return false;

    const current = parseRecordingParticipantIds(call.recordingParticipants);
    const next =
      action === 'add'
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);

    await tx.call.update({
      where: { externalId },
      data: { recordingParticipants: JSON.stringify(next) },
    });
    return true;
  });
}
export function appendLabelsTx(lockKey: string, callId: string, labelIds: string[]) {
  return transaction(['Call', 'Tag'], 'appendLabels: advisory-locked call label merge and tag resolution must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    await advisoryXactLock(tx, ['Call'],
      'call labels: serialize label list read-modify-write for one call',
      lockKey);

    const call = await tx.call.findUnique({ where: { id: callId }, select: { labels: true } });
    if (!call) return;

    const relevantIds = [...new Set([...call.labels, ...labelIds])];
    const tags = await tx.tag.findMany({
      where: { id: { in: relevantIds }, sourceId: callId, isDeleted: false },
      select: { id: true, tag: true, method: true },
    });
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));

    const resolve = (id: string): { slug: string; method: TagMethod } => {
      const tag = tagById.get(id);
      return tag ? { slug: tag.tag, method: tag.method as TagMethod } : { slug: id, method: TagMethod.MANUAL };
    };

    const bySlug = new Map<string, string>();

    for (const id of call.labels) {
      const { slug, method } = resolve(id);
      if (method !== TagMethod.MANUAL) continue;
      bySlug.set(slug, id);
    }

    for (const id of labelIds) {
      const { slug } = resolve(id);
      if (bySlug.has(slug)) continue;
      bySlug.set(slug, id);
    }

    const labels = [...bySlug.values()];
    await tx.call.update({ where: { id: callId }, data: { labels } });
  });
}
export function createParticipantTx(data: CreateCallParticipantInput, workspaceId: string) {
  return transaction(['CallParticipant'], 'createParticipant: call participant creation must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    const result = await tx.callParticipant.create({
      data: {
        ...data,
        workspaceId,
      meetingStatus: data.meetingStatus ?? MeetingStatus.PENDING,
      },
    });
  queueCallVespaFeed(result.callId, { source: CallVespaFeedSource.CallRepositoryCreateParticipant });
    return result;
  });
}
export function handleParticipantLeaveTx(callExternalId: string, userId: string, self: CallRepository, leftAt: Date) {
  return transaction(['Call', 'CallParticipant', 'Conversation', 'Message', 'MessageArtifact', 'User'], 'handleParticipantLeave: participant leave, call end, preview refresh, artifact completion and system message update must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    // Find call inside transaction
    const call = await tx.call.findUnique({
      where: { externalId: callExternalId }
    });

    if (!call) {
      return { shouldEndCall: false, messageUpdated: false, call: null };
    }

    // Skip agent participants
    if (userId.startsWith('agent-')) {
      return { shouldEndCall: false, messageUpdated: false, call: null };
    }

    // Find participant by userId (works for both internal and external users)
    const existingParticipant = await tx.callParticipant.findFirst({
      where: {
        callId: call.id,
        userId: userId,
      },
      select: { id: true }
    });

    if (!existingParticipant) {
      return { shouldEndCall: false, messageUpdated: false, call: null };
    }

    // Mark participant as left
    await markParticipantAsLeft(existingParticipant.id, leftAt, tx);

    // Check active participants within the same transaction
    const activeCount = await countActiveParticipants(call.id, tx);

    let shouldEndCall = false;
    let messageUpdated = false;

    // End call if no active participants and not already ended
    if (activeCount === 0 && call.status !== CallStatus.ENDED) {
      // If endsAt is in the future this is a scheduled call - revert to SCHEDULED so it can be rejoined.
      // Only signal shouldEndCall=true when the call is truly ENDED so that missed-call
      // notifications and metrics are NOT fired for calls that are merely reverting to SCHEDULED.
      const finalStatus =
        call.endsAt && leftAt < call.endsAt ? CallStatus.SCHEDULED : CallStatus.ENDED;

      await tx.call.update({
        where: { id: call.id },
        data: { status: finalStatus, endedAt: leftAt },
      });
      shouldEndCall = finalStatus === CallStatus.ENDED;
      if (shouldEndCall) {
        await refreshCallParticipantPreview(tx, call.id);
        await self.syncArtifactLifecycle(tx, call, MessageArtifactStatus.COMPLETED, leftAt);
      }

      // Update system message whether the call is fully ended or just rescheduled
      messageUpdated = await updateCallSystemMessageIfNeeded({
        call,
        callId: callExternalId,
        endedAt: leftAt,
        tx,
      });
    }

    return { shouldEndCall, messageUpdated, call };
  });
}
export function handleRoomFinishedTx(callExternalId: string, endedAt: Date, self: CallRepository) {
  return transaction(['Call', 'CallParticipant', 'Conversation', 'Message', 'MessageArtifact', 'User'], 'handleRoomFinished: room-finish call end, conversation unlink, artifact completion and system message update must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    // Find call inside transaction
    const call = await tx.call.findUnique({
      where: { externalId: callExternalId }
    });

    if (!call) {
      return { shouldEndCall: false, messageUpdated: false, call: null };
    }

    let shouldEndCall = false;
    let messageUpdated = false;

    // Check and update call status if not already ended
    if (call.status !== CallStatus.ENDED) {
      // If endsAt is in the future this is a scheduled call - revert to SCHEDULED so it can be rejoined.
      // Only signal shouldEndCall=true when the call is truly ENDED so that metrics are NOT fired
      // for calls that are merely reverting to SCHEDULED.
      const finalStatus =
        call.endsAt && endedAt < call.endsAt ? CallStatus.SCHEDULED : CallStatus.ENDED;

      await tx.call.update({
        where: { id: call.id },
        data: { status: finalStatus, endedAt },
      });
      shouldEndCall = finalStatus === CallStatus.ENDED;
      if (shouldEndCall) {
        await refreshCallParticipantPreview(tx, call.id);
      }

      // Update system message whether the call is fully ended or just rescheduled
      messageUpdated = await updateCallSystemMessageIfNeeded({
        call,
        callId: callExternalId,
        endedAt,
        tx,
      });
    } else {
      // Call already ended - still try to update system message if needed
      messageUpdated = await updateCallSystemMessageIfNeeded({
        call,
        callId: callExternalId,
        endedAt,
        tx,
      });
    }

    if (call.status === CallStatus.ENDED || shouldEndCall) {
      await self.syncArtifactLifecycle(tx, call, MessageArtifactStatus.COMPLETED, endedAt);
    }

    // Clear conversation.callId when call ends (for conversation calls). Only if it
    // still points at this room: room_finished for a stale room can land after a
    // newer call has already started in the same conversation.
    const callMetadata = call.metadata as CallMetadata | null;
    if (callMetadata?.conversationId) {
      try {
        const { count } = await tx.conversation.updateMany({
          where: { conversationId: callMetadata.conversationId, callId: callExternalId },
          data: { callId: null },
        });
        if (count > 0) logger.info(`[handleRoomFinished] Cleared conversation.callId for conversation ${callMetadata.conversationId}`);
      } catch (err) {
        logger.error(`[handleRoomFinished] Failed to clear conversation.callId for conversation ${callMetadata.conversationId}`, err);
      }
    }

    return { shouldEndCall, messageUpdated, call };
  });
}
export function createLobbyRequestTx(id: string, callId: string, workspaceId: string, displayName: string) {
  return transaction(['CallParticipant'], 'createLobbyRequest: external lobby request participant creation must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    const participant = await tx.callParticipant.create({
      data: {
        id,
        callId,
        workspaceId,
      userId: id, // Use same value so LiveKit identity (= id) always matches userId
        invitedBy: 'external_request',
        invitedAt: new Date(),
        response: InvitationResponse.REQUESTED,
        isExternal: true,
        displayName,
        meetingStatus: MeetingStatus.PENDING,
      },
    });
    return participant;
  });
}
export function externalJoinTx(participantId: string) {
  return transaction(['CallParticipant'], 'externalJoin: external participant join timestamp update must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async tx => {
    const participant = await tx.callParticipant.update({
      where: { id: participantId },
      data: { joinedAt: new Date() },
    });
    return participant;
  });
}

export function activateScheduledCallTx(callParam: Call, workspaceId: string | undefined, initiatorName: string, now: Date) {
  return transaction(['Call', 'Conversation', 'Message'], 'activateScheduledCall: scheduled call activation with conversation and system message creation must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    // Re-read the call inside the transaction to ensure fresh data
    const call = await tx.call.findUnique({
      where: { id: callParam.id },
    });

    if (!call) {
      throw new Error(`Call ${callParam.id} not found`);
    }

    // Prefer the caller-supplied workspaceId, else inherit from the loaded call.
    const resolvedWorkspaceId = workspaceId ?? call.workspaceId;

    const callMetadata = call.metadata as {
      systemMessageId?: string;
      conversationId?: string;
    } | null;

    if (!callMetadata?.conversationId) {
      // First join: create conversation + system message, then activate.
      // Post to callUpdatesChannel when set (post-to-channel mode), otherwise to the call's own channel.
      const conversationId = uuidv4();
      const messageId = uuidv4();
      await createConversationAndSystemMessage(tx, {
        conversationId,
        messageId,
        workspaceId: resolvedWorkspaceId,
        channelId: call.callUpdatesChannel ?? call.channelId ?? '',
        callId: call.externalId,
        initiatorName,
      });

      await tx.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.ACTIVE,
          startedAt: now,
          lastActivityAt: now,
          updatedAt: now,
          // Merge (not replace) so calendar-derived fields already on the call
          // (organizer, attendees, provider, etc. — set by the calendar sync
          // upsert) survive activation instead of being wiped out.
          metadata: { ...(call.metadata as Prisma.InputJsonObject ?? {}), systemMessageId: messageId, conversationId },
        },
      });
    } else if (!callMetadata?.systemMessageId) {
      // Thread-linked scheduled call first join: thread conversation already exists,
      // just post a system message into it and activate.
      const messageId = uuidv4();
      const conversationId = callMetadata.conversationId;

      await tx.message.create({
        data: {
          messageId,
          conversationId,
          workspaceId: resolvedWorkspaceId,
          senderId: 'system',
          content: `${initiatorName} started a call`,
          msgType: MessageType.SYSTEM,
          showInChannel: false,
          metadata: {
            isCallMessage: true,
            callId: call.externalId,
            operation: 'call_active',
          },
        },
      });

      // Link the call to the existing conversation so the active-call pill renders
      await tx.conversation.update({
        where: { conversationId },
        data: {
          callId: call.externalId,
          lastActivityAt: now,
        },
      });

      await tx.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.ACTIVE,
          startedAt: now,
          lastActivityAt: now,
          updatedAt: now,
          metadata: { ...(call.metadata as Prisma.InputJsonObject ?? {}), systemMessageId: messageId, conversationId },
        },
      });
    } else {
      // Rejoin within the scheduled window — conversation already exists, just flip to ACTIVE.
      // Preserve startedAt from the first session so it reflects the actual start of the call;
      // endedAt is refreshed on every leave/room_finished, so the pair spans first join → last leave.
      // `startedAt` is NOT NULL with a DB default of creation time, so it cannot be used to detect
      // "never joined". `endedAt` is only ever written when a session ends, so a non-null endedAt is
      // the reliable signal that a prior session exists and startedAt must be kept.
      await tx.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.ACTIVE,
          startedAt: call.endedAt ? call.startedAt : now,
          lastActivityAt: now,
          updatedAt: now,
        },
      });

      // Re-link callId on the conversation so the active-call pill renders again
      if (callMetadata?.conversationId) {
        await tx.conversation.update({
          where: { conversationId: callMetadata.conversationId },
          data: {
            callId: call.externalId,
            lastActivityAt: now,
          },
        });
      }

      // Also properly reset the system message back to ACTIVE
      if (callMetadata?.systemMessageId) {
        await tx.message.update({
          where: { messageId: callMetadata.systemMessageId },
          data: {
            content: `${initiatorName} started a call`,
            metadata: {
              isCallMessage: true,
              callId: call.externalId,
              operation: 'call_active',
            }
          }
        });
      }
    }
  });
}

export function createCallWithParticipantsAndMessageTx(callId: string, roomName: string, wsId: string, createdBy: string, channelId: string, workspaceId: string | undefined, callType: CallType, roomLink: string, isHeadless: boolean, now: Date, callOrigin: CallOrigin | undefined, messageId: string, conversationId: string, artifactMessageId: string | undefined, agentName: string | undefined, dispatchStatus: string | undefined, self: CallRepository, channelParticipants: { userId: string; }[], joiningUserId: string) {
  return transaction(['Call', 'CallParticipant', 'ChannelStats', 'Conversation', 'Message', 'MessageArtifact', 'User'], 'createCallWithParticipantsAndMessage: call, participants, conversation, system message and channel stats must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
    // Create the call record with ACTIVE status
    const call = await tx.call.create({
      data: {
        id: callId,
        externalId: roomName,
        workspaceId: wsId,
        createdByUserId: createdBy,
        channelId,
        ...(workspaceId && { workspaceId }),
        callType,
        status: CallStatus.ACTIVE,
        roomLink,
        timezone: 'UTC',
        isRecurring: false,
        recordingEnabled: isHeadless,
        startedAt: now,
        lastActivityAt: now,
        callOrigin: callOrigin || CallOrigin.CHANNEL,
        metadata: {
          systemMessageId: messageId,
          conversationId,
          ...(artifactMessageId && { artifactMessageId }),
          ...(agentName && { agentName }),
          ...(dispatchStatus && { dispatchStatus }),
        },
      },
    });

    await self.syncArtifactLifecycle(tx, call, MessageArtifactStatus.ACTIVE);

    // Create call_participants: joining user as ACCEPTED, others as INVITED
    const invitedParticipantIds: string[] = [];

    for (const channelParticipant of channelParticipants) {
      const isJoiningUser = channelParticipant.userId === joiningUserId;
      const participantId = uuidv4();

      await tx.callParticipant.create({
        data: {
          id: participantId,
          callId: call.id,
          workspaceId: wsId,
          userId: channelParticipant.userId,
          invitedBy: createdBy,
          invitedAt: now,
          response: isJoiningUser ? InvitationResponse.ACCEPTED : InvitationResponse.INVITED,
          ringStatus: isJoiningUser ? null : RingStatus.CALLING,
          joinedAt: isJoiningUser ? now : null,
        },
      });

      if (!isJoiningUser) {
        invitedParticipantIds.push(participantId);
      }
    }

    // Get creator's name for the system message
    const user = await tx.user.findUnique({
      where: { id: createdBy },
      select: { name: true, displayName: true },
    });

    if (callOrigin === CallOrigin.CONVERSATION) {
      // For conversation-origin calls: find the existing conversation and link the call to it
      const existingConversation = await tx.conversation.findUnique({
        where: { conversationId },
      });

      if (existingConversation) {
        if (existingConversation.channelId !== channelId) {
          throw new Error(`Conversation ${conversationId} does not belong to channel ${channelId}`);
        }

        await tx.conversation.update({
          where: { conversationId },
          data: {
            callId: roomName,
            lastActivityAt: now,
          },
        });
      } else {
        throw new Error(`Conversation ${conversationId} not found for conversation call`);
      }

      // Create the system message directly (conversation already exists)
      await tx.message.create({
        data: {
          messageId,
          conversationId,
          workspaceId: wsId,
          senderId: 'system',
          content: `${user?.displayName || user?.name || 'Someone'} started a call`,
          msgType: MessageType.SYSTEM,
          showInChannel: false,
          metadata: {
            isCallMessage: true,
            callId: roomName,
            callType: callType,
            operation: 'call_active',
          },
        },
      });
    } else {
      // For channel-origin and headless calls: use shared helper to create conversation + system message
      await createConversationAndSystemMessage(tx, {
        conversationId,
        messageId,
        channelId,
        workspaceId: wsId,
        callId: roomName,
        callType,
        initiatorName: user?.displayName || user?.name || 'Someone',
        conversationMetadata: isHeadless
          ? { isHeadlessRecording: true, callId: roomName }
          : undefined,
      });
    }

    // Update channel last activity in channel_stats
    await tx.channelStats.upsert({
      where: { channelId },
      update: { lastActivityAt: now },
      create: { channelId, workspaceId: wsId, lastActivityAt: now },
    });

    return { call, invitedParticipantIds };
  });
}

export function updateScheduledCallTx(db: PrismaClient, title: string | undefined, startsAt: Date | undefined, endsAt: Date | undefined, channelId: string | undefined, metadata: Record<string, unknown> | undefined, callUpdatesChannel: string | null | undefined, callId: string, removeUserIds: string[] | undefined, addUserIds: string[] | undefined, invitedByUserId: string | undefined, externalInvitees: string[] | undefined) {
  return transaction(['Call', 'CallParticipant'], 'updateScheduledCall: scheduled call update with participant add, remove and preview refresh must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (startsAt !== undefined) updateData.startsAt = startsAt;
    if (endsAt !== undefined) updateData.endsAt = endsAt;
    if (channelId !== undefined) updateData.channelId = channelId;
    if (metadata !== undefined) updateData.metadata = metadata as Prisma.InputJsonValue;
    if (callUpdatesChannel !== undefined) updateData.callUpdatesChannel = callUpdatesChannel;

    const updatedCall = await tx.call.update({
      where: { id: callId },
      data: updateData,
    });

    if (removeUserIds && removeUserIds.length > 0) {
      await tx.callParticipant.deleteMany({
        where: { callId, userId: { in: removeUserIds } },
      });
    }

    if (addUserIds && addUserIds.length > 0) {
      await tx.callParticipant.createMany({
        data: addUserIds.map((userId) => ({
          id: uuidv4(),
          callId,
          workspaceId: updatedCall.workspaceId,
          userId,
          invitedBy: invitedByUserId ?? updatedCall.createdByUserId,
          invitedAt: new Date(),
          response: InvitationResponse.INVITED,
          meetingStatus: MeetingStatus.PENDING,
        })),
        skipDuplicates: true,
      });
    }

    if (externalInvitees !== undefined) {
      const normalizedExternalInvitees = normalizeEmailList(externalInvitees);

      if (normalizedExternalInvitees.length === 0) {
        await tx.callParticipant.deleteMany({
          where: {
            callId,
            isExternal: true,
            email: { not: null },
          },
        });
      } else {
        await tx.callParticipant.deleteMany({
          where: {
            callId,
            isExternal: true,
            AND: [
              { email: { not: null } },
              { email: { notIn: normalizedExternalInvitees } },
            ],
          },
        });

        await tx.callParticipant.createMany({
          data: normalizedExternalInvitees.map((email) => {
            const participantId = uuidv4();
            return {
              id: participantId,
              callId,
              workspaceId: updatedCall.workspaceId,
              userId: participantId,
              email,
              invitedBy: updatedCall.createdByUserId,
              invitedAt: new Date(),
              response: InvitationResponse.INVITED,
              meetingStatus: MeetingStatus.PENDING,
              displayName: email,
              isExternal: true,
            };
          }),
          skipDuplicates: true,
        });
      }
    }

    await refreshCallParticipantPreview(tx, callId);
    return updatedCall;
  });
}

export async function updateRecurringSeriesMeetingStatus(params: {
    recurringSeriesId: string;
    userId: string;
    meetingStatus: MeetingStatus;
    respondedAt: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<number> {
    const { recurringSeriesId, userId, meetingStatus, respondedAt, tx } = params;
    const client = tx || DatabaseClient.getInstance();

    const callIds = await client.call.findMany({
      where: {
        recurringSeriesId,
        status: CallStatus.SCHEDULED,
        startsAt: {
          gt: respondedAt,
        },
        participants: {
          some: { userId },
        },
      },
      select: { id: true },
    });

    const result = await client.callParticipant.updateMany({
      where: {
        userId,
        call: {
          recurringSeriesId,
          status: CallStatus.SCHEDULED,
          startsAt: {
            gt: respondedAt,
          },
        },
      },
      data: {
        meetingStatus,
        respondedAt,
      },
    });

    callIds.forEach((call) => queueCallVespaFeed(call.id, {
      source: CallVespaFeedSource.CallRepositoryUpdateRecurringSeriesMeetingStatus,
    }));

    return result.count;
  }

  /**
   * Update participant response and joinedAt timestamp
   * Requires a transaction client for atomic operations
   */
export async function updateParticipantResponse(participantId: string, response: InvitationResponse, joinedAt: Date, tx: Prisma.TransactionClient): Promise<CallParticipant> {
    const participant = await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        response,
        joinedAt
      }
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryUpdateParticipantResponse });
    return participant;
  }

  /**
   * Mark a participant as left
   * Requires a transaction client for atomic operations
   */
export async function markParticipantAsLeft(participantId: string, leftAt: Date, tx: Prisma.TransactionClient): Promise<CallParticipant> {
    const participant = await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        response: InvitationResponse.LEFT,
        leftAt
      }
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryMarkParticipantAsLeft });
    return participant;
  }

  /**
   * Count active participants in a call
   * Requires a transaction client for atomic operations
   */
export async function countActiveParticipants(callId: string, tx: Prisma.TransactionClient): Promise<number> {
    return await tx.callParticipant.count({
      where: {
        callId,
        response: InvitationResponse.ACCEPTED,
      }
    });
  }

  /**
   * End a call by updating its status
   * Requires a transaction client for atomic operations
   */
export async function endCall(self: CallRepository, callId: string, endedAt: Date, tx: Prisma.TransactionClient): Promise<void> {
    const call = await tx.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.ENDED,
        endedAt,
      }
    });
    await refreshCallParticipantPreview(tx, callId);
    await self.syncArtifactLifecycle(tx, call, MessageArtifactStatus.COMPLETED, endedAt);
    queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryEndCall });
    queueScheduledCallPillSync(callId, 'callRepository.endCall');
  }

  /**
   * Shared utility: create a conversation + system message inside an existing transaction.
   * Used by both `createCallWithParticipantsAndMessage` (new call) and
   * `activateScheduledCall` (SCHEDULED → ACTIVE transition).
   */
export async function createConversationAndSystemMessage(tx: Prisma.TransactionClient, params: {
      conversationId: string;
      messageId: string;
      channelId: string;
      workspaceId: string;
      callId: string;        // room externalId / roomName
      callType?: CallType;   // undefined ⇒ regular call
      initiatorName: string;
      conversationMetadata?: Prisma.InputJsonValue;
    }): Promise<void> {
    const { conversationId, messageId, channelId, workspaceId, callId, callType, initiatorName, conversationMetadata } = params;
    const isHeadless = callType === CallType.HEADLESS;

    await tx.conversation.create({
      data: {
        conversationId,
        channelId,
        workspaceId,
        createdBy: 'system',
        initialMessageId: messageId,
        ...(conversationMetadata ? { metadata: conversationMetadata } : {}),
      },
    });

        await tx.message.create({
          data: {
            messageId,
            conversationId,
            workspaceId,
            senderId: 'system',
        content: isHeadless ? 'Recording started' : `${initiatorName} started a call`,
        msgType: MessageType.SYSTEM,
        showInChannel: isHeadless ? true : false,
        metadata: {
          isCallMessage: true,
          callId,
          ...(callType ? { callType } : {}),
          operation: 'call_active',
          ...(isHeadless && { messageSubtype: 'call_started', isHeadlessRecording: true }),
        },
      },
    });
  }

export async function moveScheduledCallPillTx(callId: string, callExternalId: string, callTitle: string | null, newChannelId: string, workspaceId: string, senderId: string, senderName: string) {
  return transaction(['Call', 'Conversation', 'Message'], 'moveScheduledCallPill: retiring the old pill and creating the new one in the destination channel must commit atomically; tx is not ACL-wrapped', DatabaseClient.getInstance(), async (tx) => {
      // Re-read inside the transaction: the caller's snapshot predates the update, and
      // a concurrent channel edit would otherwise have its new pill orphaned.
      const current = await tx.call.findUnique({
        where: { id: callId },
        select: { metadata: true },
      });
      const existingPillId = (current?.metadata as CallMetadata | null)?.channelPillMessageId;

      let retiredConversationId: string | null = null;

      if (existingPillId) {
        const pill = await tx.message.findUnique({
          where: { messageId: existingPillId },
          select: { conversationId: true, conversation: { select: { initialMessageId: true } } },
        });
        if (pill && pill.conversation?.initialMessageId !== existingPillId) return null;

        // pill is null → message was already deleted; nothing to retire, but the
        // fresh pill should still be created in the destination channel.
        if (pill) {
          retiredConversationId = pill.conversationId;
          await retireScheduledCallPill(tx, {
            messageId: existingPillId,
            callExternalId,
            movedToChannelId: newChannelId,
            callTitle,
          });
        }
      }

      const created = await createScheduledCallPill(tx, {
        callId,
        callExternalId,
        channelId: newChannelId,
        workspaceId,
        senderId,
        senderName,
      });
      return { newConversationId: created?.conversationId ?? null, retiredConversationId };
  });
}

  /**
   * Post the read-only "upcoming call" pill into the call's channel.
   *
   * A plain Prisma write, not a Zero mutator, so scheduling does not mark the channel
   * unread for everyone — same as the existing call system message.
   *
   * Never writes `metadata.systemMessageId`: that belongs to `activateScheduledCall`,
   * and stamping it would stop the live "X started a call" message from posting.
   */
export async function createScheduledCallPill(tx: Prisma.TransactionClient, params: {
      callId: string;          // internal Call.id
      callExternalId: string;  // public id the card resolves the call by
      channelId: string;
      workspaceId: string;
      /** The organizer — the pill is attributed to them, like a ticket-creation message. */
      senderId: string;
      /** Organizer's display name, for the stored preview text. */
      senderName: string;
      /** Set for a thread-scheduled call; the pill goes in that thread, not a new one. */
      threadConversationId?: string | undefined;
    }): Promise<{ messageId: string; conversationId: string } | null> {
    const { callId, callExternalId, channelId, workspaceId, senderId, senderName, threadConversationId } =
      params;
    const messageId = uuidv4();
    const conversationId = threadConversationId ?? uuidv4();

    const snapshot = await tx.call.findUniqueOrThrow({
      where: { id: callId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        channelId: true,
        callOrigin: true,
        isRecurring: true,
        recurringSeriesId: true,
        callType: true,
      },
    });

    // A series is materialized 60 days ahead and replenished forever, so a pill per
    // instance would drip cards into the channel indefinitely. Note-taker recordings
    // are not meetings anyone joins. Calendar-origin calls are created and managed via
    // upsertExternalCalendarCall, not scheduleCall; they must never gain a pill even
    // if the move path reaches this function. Enforced here: single choke point.
    if (snapshot.callOrigin !== CallOrigin.CHANNEL && snapshot.callOrigin !== CallOrigin.CONVERSATION) return null;
    if (snapshot.isRecurring || snapshot.recurringSeriesId) return null;
    if (snapshot.callType === CallType.HEADLESS) return null;

    if (!threadConversationId) {
      // Its own conversation, so the pill is the initialMessage and renders as a
      // channel entry.
      await tx.conversation.create({
        data: {
          conversationId,
          channelId,
          workspaceId,
          createdBy: senderId,
          initialMessageId: messageId,
        },
      });
    }

    await tx.message.create({
      data: {
        messageId,
        conversationId,
        workspaceId,
        senderId,
        content: scheduledCallPillContent(senderName),
        msgType: MessageType.SYSTEM,
        showInChannel: false,
        metadata: scheduledCallPillMetadata(callExternalId, snapshot),
      },
    });

    // Merge, so calendar fields and the activation keys survive the stamp.
    const current = await tx.call.findUnique({
      where: { id: callId },
      select: { metadata: true },
    });

    await tx.call.update({
      where: { id: callId },
      data: {
        metadata: {
          ...((current?.metadata as Prisma.InputJsonObject) ?? {}),
          channelPillMessageId: messageId,
        },
      },
    });

    return { messageId, conversationId };
  }

  /**
   * Permanently retire a pill whose call moved channels. "Moved" is the one state the
   * card cannot derive, since moving back would make `call.channelId` match again.
   */
export async function retireScheduledCallPill(tx: Prisma.TransactionClient, params: {
      messageId: string;
      callExternalId: string;
      movedToChannelId: string;
      /** Snapshotted so the dead card still names the call it used to point at. */
      callTitle?: string | null;
    }): Promise<void> {
    await tx.message.update({
      where: { messageId: params.messageId },
      data: {
        metadata: {
          isScheduledCallPill: true,
          callId: params.callExternalId,
          operation: 'call_scheduled',
          retired: true,
          movedTo: params.movedToChannelId,
          ...(params.callTitle ? { movedCallTitle: params.callTitle } : {}),
        },
      },
    });
  }
