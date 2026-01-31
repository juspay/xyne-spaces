import { DatabaseClient } from '../client';
import { CallStatus, CallType, type Call, type CallParticipant } from '@prisma/client';

export type { Call, CallParticipant };

export interface UpdateCallInput {
  status?: 'ACTIVE' | 'ENDED' | 'CANCELLED';
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
  status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
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

}
