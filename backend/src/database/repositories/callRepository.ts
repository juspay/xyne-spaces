import { DatabaseClient } from '../client';
import { v4 as uuidv4 } from 'uuid';
import { CallStatus, CallType, InvitationResponse, type Call, type CallParticipant, type Prisma } from '@prisma/client';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { repositories } from './index';

export type { Call, CallParticipant };

export interface CreateCallParticipantInput {
  id: string;
  callId: string;
  userId: string;
  invitedBy: string;
  invitedAt: Date;
  response: InvitationResponse;
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

export interface CreateCallInput {
  externalId: string;
  createdByUserId: string;
  channelId: string;
  callType: CallType;
  status: CallStatus;
  roomLink: string;
  timezone: string;
  isRecurring: boolean;
  recordingEnabled: boolean;
  startedAt: Date;
  title?: string;
  metadata?: any;
}

export class CallRepository {
  async create(data: CreateCallInput): Promise<Call> {
    const result = await DatabaseClient.getInstance().call.create({
      data: {
        ...data,
        lastActivityAt: data.startedAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return result;
  }

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
        status: CallStatus.ACTIVE
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
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
      data,
    });
    return result;
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
   * Handle participant leaving - marks participant as left and ends call if no active participants
   * Also updates system message within the transaction if call ends
   * Returns whether the call should be ended, if message was updated, and the call data
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
        await this.endCall(call.id, leftAt, tx);
        shouldEndCall = true;
        
        // Update system message when ending the call
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
   * Handle room finished - marks call as ended and updates system message
   * Returns whether the call was ended and if message was updated
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
        await this.endCall(call.id, endedAt, tx);
        shouldEndCall = true;
      }

      // Update system message regardless of whether call was just ended or already ended
      // This ensures message is updated even if call was already marked as ended
      messageUpdated = await updateCallSystemMessageIfNeeded({
        call,
        callId: callExternalId,
        endedAt: endedAt,
        tx,
      });

      return { shouldEndCall, messageUpdated, call };
    });
  }

  /**
   * Create initial call with all participants, conversation, and system message atomically
   * This is used when the first participant joins a room
   * Returns the call and list of invited participant IDs (excluding the joining user)
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
      now
    } = params;

    const isHeadless = callType === CallType.HEADLESS;

    return await DatabaseClient.getInstance().$transaction(async (tx) => {
      // Create the call record with ACTIVE status
      const call = await tx.call.create({
        data: {
          id: callId,
          externalId: roomName,
          createdByUserId: createdBy,
          channelId: channelId,
          callType: callType,
          status: CallStatus.ACTIVE,
          roomLink: roomLink,
          timezone: 'UTC',
          isRecurring: false,
          recordingEnabled: isHeadless,
          startedAt: now,
          lastActivityAt: now,
          metadata: {
            systemMessageId: messageId,
            conversationId: conversationId,
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
        
        // Track invited participants for notification
        if (!isJoiningUser) {
          invitedParticipantIds.push(participantId);
        }
      }

      // Get user info for message
      const user = await tx.user.findUnique({
        where: { id: createdBy },
        select: { name: true }
      });

      // Create conversation
      await tx.conversation.create({
        data: {
          conversationId,
          channelId: channelId,
          createdBy: 'system',
          initialMessageId: messageId,
          metadata: isHeadless ? {
            isHeadlessRecording: true,
            callId: roomName,
          } : undefined,
        },
      });

      // Create system message
      await tx.message.create({
        data: {
          messageId,
          conversationId,
          senderId: 'system',
          content: isHeadless ? `Recording started` : `${user?.name || 'Someone'} started a call`,
          msgType: 'SYSTEM',
          showInChannel: isHeadless ? true : false,
          metadata: {
            isCallMessage: true,
            callId: roomName,
            callType: callType,
            operation: 'call_active',
            ...(isHeadless && { messageSubtype: 'call_started', isHeadlessRecording: true }),
          },
        },
      });

      // Update channel last activity
      await tx.channel.update({
        where: { id: channelId },
        data: {
          lastActivityAt: now,
        },
      });

      return { call, invitedParticipantIds };
    });
  }

}
