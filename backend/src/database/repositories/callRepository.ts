import { DatabaseClient } from '../client';
import { v4 as uuidv4 } from 'uuid';
import {
  CallOrigin,
  CallStatus,
  CallType,
  InvitationResponse,
  MeetingStatus,
  type Call,
  type CallParticipant,
  type Prisma,
} from '@prisma/client';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { repositories } from './index';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';

export type { Call, CallParticipant };

export interface CreateCallParticipantInput {
  id: string;
  callId: string;
  userId: string;
  invitedBy: string;
  invitedAt: Date;
  response: InvitationResponse;
  meetingStatus?: MeetingStatus;
  respondedAt?: Date | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
}

export interface UpdateCallInput {
  status?: CallStatus;
  endedAt?: Date;
  lastActivityAt?: Date;
  roomLink?: string;
  metadata?: any;
  aiSummary?: string;
  title?: string;
  transcript?: string;
  startedAt?: Date;
}

export interface CreateCallWithParticipantsInput {
  callId: string;
  externalId: string;
  title: string;
  createdByUserId: string;
  channelId: string;
  callType: CallType;
  callOrigin: CallOrigin;
  roomLink: string;
  timezone: string;
  isRecurring: boolean;
  recurringSeriesId?: string;
  startsAt: Date;
  endsAt: Date;
}

export class CallRepository {
  async findByExternalId(externalId: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findUnique({
      where: { externalId }
    });
    return result;
  }

  async findActiveCallByChannelId(channelId: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findFirst({
      where: {
        channelId,
        status: CallStatus.ACTIVE,
        callOrigin: CallOrigin.CHANNEL,
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
  }


  async findActiveCallByChannelIdAndConversationId(
    channelId: string,
    conversationId: string
  ): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findFirst({
      where: {
        channelId,
        status: CallStatus.ACTIVE,
        callOrigin: CallOrigin.CONVERSATION,
        metadata: {
          path: ['conversationId'],
          equals: conversationId
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
  }

  /**
   * Find an active call belonging to a recurring series.
   * Used when a participant tries to join via an old series link so we can
   * redirect them to the currently-live instance instead.
   */
  async findActiveCallByRecurringSeriesId(recurringSeriesId: string): Promise<Call | null> {
    return await DatabaseClient.getInstance().call.findFirst({
      where: {
        recurringSeriesId,
        status: CallStatus.ACTIVE,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  /**
   * Find the most recently scheduled call instance for a recurring series.
   * Used as a fallback when there is no active call — gives the participant
   * credentials for the latest/upcoming occurrence.
   */
  async findLatestCallByRecurringSeriesId(recurringSeriesId: string): Promise<Call | null> {
    return await DatabaseClient.getInstance().call.findFirst({
      where: {
        recurringSeriesId,
      },
      orderBy: {
        startsAt: 'desc',
      },
    });
  }

  async findAllActiveCalls(): Promise<Call[]> {
    const result = await DatabaseClient.getInstance().call.findMany({
      where: {
        status: CallStatus.ACTIVE,
      },
    });
    return result;
  }

  async update(id: string, data: UpdateCallInput): Promise<Call> {
    const result = await DatabaseClient.getInstance().call.update({
      where: { id },
      data
    });
    return result;
  }

  async findById(id: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findUnique({
      where: { id }
    });
    return result;
  }

  async findByUserAndType(userId: string, callType: CallType): Promise<Call[]> {
    const result = await DatabaseClient.getInstance().call.findMany({
      where: {
        createdByUserId: userId,
        callType
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
  }

  async delete(id: string): Promise<void> {
    await DatabaseClient.getInstance().call.delete({
      where: { id }
    });
  }

  async findParticipant(callId: string, userId: string): Promise<CallParticipant | null> {
    const result = await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        callId,
        userId,
      },
    });
    return result;
  }

  async createParticipant(data: CreateCallParticipantInput): Promise<CallParticipant> {
    const result = await DatabaseClient.getInstance().callParticipant.create({
      data: {
        ...data,
        meetingStatus: data.meetingStatus ?? MeetingStatus.PENDING,
      },
    });
    return result;
  }

  async updateParticipantMeetingStatus(
    participantId: string,
    meetingStatus: MeetingStatus,
    respondedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<CallParticipant> {
    return await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        meetingStatus,
        respondedAt,
      },
    });
  }

  async updateRecurringSeriesMeetingStatus(params: {
    recurringSeriesId: string;
    userId: string;
    meetingStatus: MeetingStatus;
    respondedAt: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<number> {
    const { recurringSeriesId, userId, meetingStatus, respondedAt, tx } = params;
    const client = tx || DatabaseClient.getInstance();

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

    return result.count;
  }

  /**
   * Create a SCHEDULED call together with its participants in a single transaction.
   * Used by both one-time scheduled calls and recurring series instances.
   * Channel participants are fetched first (outside the transaction) and then
   * written atomically alongside the call record.
   * Returns the callId and the list of invited participant userIds.
   */
  async createCallWithParticipants(
    params: CreateCallWithParticipantsInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ callId: string; participantUserIds: string[] }> {
    const channelParticipants = await repositories.channelParticipants.getChannelParticipants(
      params.channelId,
    );

    await tx.call.create({
      data: {
        id: params.callId,
        externalId: params.externalId,
        title: params.title,
        createdByUserId: params.createdByUserId,
        channelId: params.channelId,
        callType: params.callType,
        callOrigin: params.callOrigin,
        status: CallStatus.SCHEDULED,
        timezone: params.timezone,
        isRecurring: params.isRecurring,
        ...(params.recurringSeriesId && { recurringSeriesId: params.recurringSeriesId }),
        recordingEnabled: false,
        roomLink: params.roomLink,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    await tx.callParticipant.createMany({
      data: channelParticipants.map((p) => ({
        id: uuidv4(),
        callId: params.callId,
        userId: p.userId,
        invitedBy: params.createdByUserId,
        invitedAt: new Date(),
        response: InvitationResponse.INVITED,
        meetingStatus: p.userId === params.createdByUserId ? MeetingStatus.ACCEPTED : MeetingStatus.PENDING,
        respondedAt: p.userId === params.createdByUserId ? new Date() : null,
        joinedAt: null,
        leftAt: null,
      })),
    });

    return {
      callId: params.callId,
      participantUserIds: channelParticipants.map((p) => p.userId),
    };
  }

  /**
   * Get all participants for a call
   */
  async findParticipants(callId: string): Promise<Array<{ userId: string }>> {
    return await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
      },
      select: {
        userId: true,
      },
    });
  }

  /**
   * Get all participants for a call with their response status.
   * Used to check for active participants when auto-ending calls.
   * - ACCEPTED: participant is currently in the call
   * - LEFT: participant joined and has left the call
   * - INVITED: participant has not yet joined
   */
  async findParticipantsWithStatus(callId: string): Promise<Array<{ userId: string; response: InvitationResponse | null }>> {
    return await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
      },
      select: {
        userId: true,
        response: true,
      },
    });
  }

  /**
   * Get all participant IDs for a call matching a specific response
   */
  async getParticipantIdsByResponse(callId: string, response: InvitationResponse): Promise<string[]> {
    const participants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        response,
      },
      select: {
        userId: true,
      },
    });
    return participants.map((p) => p.userId);
  }

  /**
   * Get up to 3 participants who joined the call (with user names) and total count
   * Now uses the smaller utility methods with transaction support
   * Requires a transaction client for atomic operations
   */
  async getJoinedParticipants(
    callId: string,
    tx: Prisma.TransactionClient
  ): Promise<{ participants: Array<{ userId: string; userName: string }>; totalCount: number }> {
    // Use the utility methods
    const joinedParticipants = await this.getLeftParticipants(callId, 3, tx);
    const totalCount = await this.countLeftParticipants(callId, tx);

    if (totalCount === 0) return { participants: [], totalCount: 0 };

    // Get user names
    const userIds = joinedParticipants.map(p => p.userId);
    const users = await repositories.users.getUserNamesByIds(userIds, tx);

    const userMap = new Map(users.map(u => [u.id, u.name]));

    return {
      participants: joinedParticipants.map(p => ({
        userId: p.userId,
        userName: userMap.get(p.userId) ?? 'Unknown User',
      })),
      totalCount,
    };
  }

  /**
   * Mark all active participants as left for a call
   * @param tx - Optional transaction client for atomic operations
   */
  async markAllParticipantsAsLeft(
    callId: string,
    leftAt: Date,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx || DatabaseClient.getInstance();
    await client.callParticipant.updateMany({
      where: {
        callId,
        leftAt: null,
      },
      data: {
        response: InvitationResponse.LEFT,
        leftAt,
      },
    });
  }

  /**
   * Update participant response and joinedAt timestamp
   * Requires a transaction client for atomic operations
   */
  async updateParticipantResponse(
    participantId: string,
    response: InvitationResponse,
    joinedAt: Date,
    tx: Prisma.TransactionClient
  ): Promise<CallParticipant> {
    return await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        response,
        joinedAt
      }
    });
  }

  /**
   * Mark a participant as left
   * Requires a transaction client for atomic operations
   */
  async markParticipantAsLeft(
    participantId: string,
    leftAt: Date,
    tx: Prisma.TransactionClient
  ): Promise<CallParticipant> {
    return await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        response: InvitationResponse.LEFT,
        leftAt
      }
    });
  }

  /**
   * Count active participants in a call
   * Requires a transaction client for atomic operations
   */
  async countActiveParticipants(
    callId: string,
    tx: Prisma.TransactionClient
  ): Promise<number> {
    return await tx.callParticipant.count({
      where: {
        callId,
        response: InvitationResponse.ACCEPTED,
      }
    });
  }

  /**
   * Get participants who left a call (up to specified limit)
   * Requires a transaction client for atomic operations
   */
  async getLeftParticipants(
    callId: string,
    limit: number,
    tx: Prisma.TransactionClient
  ): Promise<Array<{ userId: string }>> {
    return await tx.callParticipant.findMany({
      where: {
        callId,
        response: InvitationResponse.LEFT,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      take: limit,
      select: {
        userId: true,
      }
    });
  }

  /**
   * Count participants who left a call
   * Requires a transaction client for atomic operations
   */
  async countLeftParticipants(
    callId: string,
    tx: Prisma.TransactionClient
  ): Promise<number> {
    return await tx.callParticipant.count({
      where: {
        callId,
        response: InvitationResponse.LEFT,
      },
    });
  }

  /**
   * End a call by updating its status
   * Requires a transaction client for atomic operations
   */
  async endCall(
    callId: string,
    endedAt: Date,
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await tx.call.update({
      where: { id: callId },
      data: {
        status: CallStatus.ENDED,
        endedAt,
      }
    });
  }

  /**
   * Handle participant leaving - marks participant as left and ends call if no active participants.
   * If the call has a future endsAt (scheduled call), reverts to SCHEDULED instead of ENDED
   * so participants can rejoin. Also updates system message within the transaction if call ends.
   * Returns whether the call should be ended, if message was updated, and the call data.
   */
  async handleParticipantLeave(
    params: {
      callExternalId: string;
      userId: string;
      leftAt: Date;
    }
  ): Promise<{ shouldEndCall: boolean; messageUpdated: boolean; call: Call | null }> {
    const { callExternalId, userId, leftAt } = params;

    return await DatabaseClient.getInstance().$transaction(async (tx) => {
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

      // Find participant
      const existingParticipant = await tx.callParticipant.findFirst({
        where: {
          callId: call.id,
          userId: userId
        },
        select: { id: true }
      });

      if (!existingParticipant) {
        return { shouldEndCall: false, messageUpdated: false, call: null };
      }

      // Mark participant as left
      await this.markParticipantAsLeft(existingParticipant.id, leftAt, tx);

      // Check active participants within the same transaction
      const activeCount = await this.countActiveParticipants(call.id, tx);

      let shouldEndCall = false;
      let messageUpdated = false;

      // End call if no active participants and not already ended
      if (activeCount === 0 && call.status !== CallStatus.ENDED) {
        // If endsAt is in the future this is a scheduled call - revert to SCHEDULED so it can be rejoined
        // Otherwise mark as permanently ENDED
        const finalStatus =
          call.endsAt && leftAt < call.endsAt ? CallStatus.SCHEDULED : CallStatus.ENDED;

        await tx.call.update({
          where: { id: call.id },
          data: { status: finalStatus, endedAt: leftAt },
        });
        shouldEndCall = true;

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

  /**
   * Handle room finished - marks call as ended (or SCHEDULED if still within its window) and updates system message.
   * Returns whether the call was ended and if message was updated.
   */
  async handleRoomFinished(
    params: {
      callExternalId: string;
      endedAt: Date;
    }
  ): Promise<{ shouldEndCall: boolean; messageUpdated: boolean; call: Call | null }> {
    const { callExternalId, endedAt } = params;

    return await DatabaseClient.getInstance().$transaction(async (tx) => {
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
        // If endsAt is in the future this is a scheduled call - revert to SCHEDULED so it can be rejoined
        // Otherwise mark as permanently ENDED
        const finalStatus =
          call.endsAt && endedAt < call.endsAt ? CallStatus.SCHEDULED : CallStatus.ENDED;

        await tx.call.update({
          where: { id: call.id },
          data: { status: finalStatus, endedAt },
        });
        shouldEndCall = true;

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

      // Clear conversation.callId when call ends (for conversation calls)
      const callMetadata = call.metadata as { conversationId?: string } | null;
      if (callMetadata?.conversationId) {
        try {
          await tx.conversation.update({
            where: { conversationId: callMetadata.conversationId },
            data: { callId: null },
          });
          logger.info(`[handleRoomFinished] Cleared conversation.callId for conversation ${callMetadata.conversationId}`);
        } catch (err) {
          logger.error(`[handleRoomFinished] Failed to clear conversation.callId for conversation ${callMetadata.conversationId}`, err);
        }
      }

      return { shouldEndCall, messageUpdated, call };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Shared utility: create a conversation + system message inside an existing transaction.
   * Used by both `createCallWithParticipantsAndMessage` (new call) and
   * `activateScheduledCall` (SCHEDULED → ACTIVE transition).
   */
  private async createConversationAndSystemMessage(
    tx: Prisma.TransactionClient,
    params: {
      conversationId: string;
      messageId: string;
      channelId: string;
      callId: string;        // room externalId / roomName
      callType?: CallType;   // undefined ⇒ regular call
      initiatorName: string;
      conversationMetadata?: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    const { conversationId, messageId, channelId, callId, callType, initiatorName, conversationMetadata } = params;
    const isHeadless = callType === CallType.HEADLESS;

    await tx.conversation.create({
      data: {
        conversationId,
        channelId,
        createdBy: 'system',
        initialMessageId: messageId,
        ...(conversationMetadata ? { metadata: conversationMetadata } : {}),
      },
    });

    await tx.message.create({
      data: {
        messageId,
        conversationId,
        senderId: 'system',
        content: isHeadless ? 'Recording started' : `${initiatorName} started a call`,
        msgType: 'SYSTEM',
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

  // ─────────────────────────────────────────────────────────────────────────
  // Public composite methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Activate a SCHEDULED call when the first participant joins.
   *
   * Two cases handled inside a single $transaction:
   *  1. No conversation yet → create conversation + system message, flip to ACTIVE.
   *  2. Conversation already exists (rejoin within the window) → flip to ACTIVE only.
   *
   * Returns the fresh call record after the update.
   */
  async activateScheduledCall(params: {
    call: Call;
    initiatorName: string;
    now: Date;
  }): Promise<void> {
    const { call: callParam, initiatorName, now } = params;

    await DatabaseClient.getInstance().$transaction(async (tx) => {
      // Re-read the call inside the transaction to ensure fresh data
      const call = await tx.call.findUnique({
        where: { id: callParam.id },
      });

      if (!call) {
        throw new Error(`Call ${callParam.id} not found`);
      }

      const callMetadata = call.metadata as {
        systemMessageId?: string;
        conversationId?: string;
      } | null;

      if (!callMetadata?.conversationId) {
        // First join: create conversation + system message, then activate
        const conversationId = uuidv4();
        const messageId = uuidv4();
        await this.createConversationAndSystemMessage(tx, {
          conversationId,
          messageId,
          channelId: call.channelId,
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
            metadata: { systemMessageId: messageId, conversationId },
          },
        });
      } else {
        // Rejoin within the scheduled window — conversation already exists, just flip to ACTIVE
        await tx.call.update({
          where: { id: call.id },
          data: {
            status: CallStatus.ACTIVE,
            startedAt: now,
            lastActivityAt: now,
            updatedAt: now,
          },
        });

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

    // Sync eagerly so initial_message_md is populated before the response returns.
    // The middleware also covers this via setImmediate, but the deferred sync is too
    // late for clients that render the channel immediately after the call is created.
    const activatedCallMeta = (await DatabaseClient.getInstance().call.findUnique({
      where: { id: callParam.id },
      select: { metadata: true },
    }))?.metadata as { conversationId?: string } | null;
    if (activatedCallMeta?.conversationId) {
      await messageMetadataService.syncInitialMessageMd(activatedCallMeta.conversationId);
    }
  }

  /**
   * Create initial call with all participants, conversation, and system message atomically.
   * This is used when the first participant joins a brand-new room.
   * Returns the call and list of invited participant IDs (excluding the joining user).
   */
  async createCallWithParticipantsAndMessage(
    params: {
      callId: string;
      roomName: string;
      channelId: string;
      createdBy: string;
      callType: CallType;
      roomLink: string;
      joiningUserId: string;
      channelParticipants: Array<{ userId: string }>;
      conversationId: string;
      messageId: string;
      now: Date;
      callOrigin?: CallOrigin;
    }
  ): Promise<{ call: Call; invitedParticipantIds: string[] }> {
    const {
      callId,
      roomName,
      channelId,
      createdBy,
      callType,
      roomLink,
      joiningUserId,
      channelParticipants,
      conversationId,
      messageId,
      now,
      callOrigin
    } = params;

    const isHeadless = callType === CallType.HEADLESS;

    const result = await DatabaseClient.getInstance().$transaction(async (tx) => {
      // Create the call record with ACTIVE status
      const call = await tx.call.create({
        data: {
          id: callId,
          externalId: roomName,
          createdByUserId: createdBy,
          channelId,
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
          },
        },
      });

      // Create call_participants: joining user as ACCEPTED, others as INVITED
      const invitedParticipantIds: string[] = [];

      for (const channelParticipant of channelParticipants) {
        const isJoiningUser = channelParticipant.userId === joiningUserId;
        const participantId = uuidv4();

        await tx.callParticipant.create({
          data: {
            id: participantId,
            callId: call.id,
            userId: channelParticipant.userId,
            invitedBy: createdBy,
            invitedAt: now,
            response: isJoiningUser ? InvitationResponse.ACCEPTED : InvitationResponse.INVITED,
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
        select: { name: true },
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
            senderId: 'system',
            content: `${user?.name || 'Someone'} started a call`,
            msgType: 'SYSTEM',
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
        await this.createConversationAndSystemMessage(tx, {
          conversationId,
          messageId,
          channelId,
          callId: roomName,
          callType,
          initiatorName: user?.name || 'Someone',
          conversationMetadata: isHeadless
            ? { isHeadlessRecording: true, callId: roomName }
            : undefined,
        });
      }

      // Update channel last activity in channel_stats
      await tx.channelStats.upsert({
        where: { channelId },
        update: { lastActivityAt: now },
        create: { channelId, lastActivityAt: now },
      });

      return { call, invitedParticipantIds };
    });

    await messageMetadataService.syncInitialMessageMd(conversationId);

    return result;
  }

  /**
   * Get all participants for a call with their user details
   * Used for building mention maps in documents
   */
  async getCallParticipantsWithUserDetails(
    callExternalId: string
  ): Promise<Array<{ userId: string; userName: string; userEmail: string; userPicture: string | null }>> {
    // Get call by external ID
    const call = await this.findByExternalId(callExternalId);
    if (!call) {
      return [];
    }

    // Get all call participants using repository method
    const callParticipants = await this.findParticipants(call.id);

    // Get user IDs
    const userIds = callParticipants.map(p => p.userId);

    if (userIds.length === 0) {
      return [];
    }

    // Batch fetch all user details using repository method
    const users = await repositories.users.findMany({
      where: { id: { in: userIds } },
    });

    return users.map(user => ({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userPicture: user.picture,
    }));
  }

  /**
   * Get all participants for a call with their user details and response status.
   * Used by the native Participants screen to categorize attendees vs invited.
   */
  async getParticipantsInfo(
    callExternalId: string
  ): Promise<Array<{
    userId: string;
    userName: string;
    userEmail: string;
    userPicture: string | null;
    response: InvitationResponse | null;
    meetingStatus: MeetingStatus;
    joinedAt: Date | null;
    leftAt: Date | null;
  }>> {
    const call = await this.findByExternalId(callExternalId);
    if (!call) {
      logger.info(`[getParticipantsInfo] No call found for externalId: ${callExternalId}`);
      return [];
    }

    logger.info(`[getParticipantsInfo] Resolved call: externalId=${callExternalId}, internalId=${call.id}`);

    // Fetch participants with response status
    const callParticipants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: { callId: call.id },
      select: {
        userId: true,
        response: true,
        meetingStatus: true,
        joinedAt: true,
        leftAt: true,
      },
    });

    logger.info(`[getParticipantsInfo] Found ${callParticipants.length} call_participant records for callId=${call.id}, userIds: ${callParticipants.map(p => p.userId).join(', ')}`);

    const userIds = callParticipants.map(p => p.userId);
    if (userIds.length === 0) {
      return [];
    }

    // Batch fetch all user details
    const users = await repositories.users.findMany({
      where: { id: { in: userIds } },
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    return callParticipants.map(p => {
      const user = userMap.get(p.userId);
      return {
        userId: p.userId,
        userName: user?.name ?? 'Unknown',
        userEmail: user?.email ?? '',
        userPicture: user?.picture ?? null,
        response: p.response,
        meetingStatus: p.meetingStatus,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      };
    });
  }

  /**
   * Update a SCHEDULED call's fields and manage participant delta.
   * Only modifies fields that are explicitly provided.
   * Participant changes: addUserIds are added (skipping duplicates), removeUserIds are deleted.
   */
  async updateScheduledCall(params: {
    callId: string;
    title?: string;
    startsAt?: Date;
    endsAt?: Date;
    channelId?: string;
    addUserIds?: string[];
    removeUserIds?: string[];
  }): Promise<Call> {
    const { callId, title, startsAt, endsAt, channelId, addUserIds, removeUserIds } = params;
    const db = DatabaseClient.getInstance();

    return await db.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (startsAt !== undefined) updateData.startsAt = startsAt;
      if (endsAt !== undefined) updateData.endsAt = endsAt;
      if (channelId !== undefined) updateData.channelId = channelId;

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
            userId,
            invitedBy: updatedCall.createdByUserId,
            invitedAt: new Date(),
            response: InvitationResponse.INVITED,
            meetingStatus: MeetingStatus.PENDING,
          })),
          skipDuplicates: true,
        });
      }

      return updatedCall;
    });
  }

}
