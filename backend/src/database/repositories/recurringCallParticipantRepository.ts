import { v4 as uuidv4 } from 'uuid';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import {
  InvitationResponse,
  MeetingStatus,
  type Prisma,
  type RecurringCallParticipant,
} from '@prisma/client';
import { DatabaseClient } from '../client';
import { normalizeEmailList } from '@/utils/email';

function normalizeUserIds(userIds: string[] | undefined, organizerId: string): string[] {
  const normalized = [...new Set((userIds ?? []).map(id => id.trim()).filter(Boolean))];
  return normalized.includes(organizerId) ? normalized : [organizerId, ...normalized];
}

export class RecurringCallParticipantRepository {
  private client(tx?: Prisma.TransactionClient) {
    return tx ?? DatabaseClient.getInstance();
  }

  async replaceInternalParticipants(params: {
    recurringSeriesId: string;
    organizerId: string;
    userIds: string[];
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, userIds, tx } = params;
    const client = this.client(tx);
    const participantUserIds = normalizeUserIds(userIds, organizerId);
    const now = new Date();

    await client.recurringCallParticipant.deleteMany({
      where: {
        recurringSeriesId,
        isExternal: false,
      },
    });

    const workspaceId = await resolveWorkspaceIdFromModel(client, 'recurringCallSeries', { id: recurringSeriesId });

    await client.recurringCallParticipant.createMany({
      data: participantUserIds.map(userId => ({
        id: uuidv4(),
        recurringSeriesId,
        workspaceId,
        userId,
        invitedBy: organizerId,
        invitedAt: now,
        response: InvitationResponse.INVITED,
        meetingStatus: userId === organizerId ? MeetingStatus.ACCEPTED : MeetingStatus.PENDING,
        respondedAt: userId === organizerId ? now : null,
        isExternal: false,
      })),
      skipDuplicates: true,
    });
  }

  async clearInternalParticipants(params: {
    recurringSeriesId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, tx } = params;
    await this.client(tx).recurringCallParticipant.deleteMany({
      where: {
        recurringSeriesId,
        isExternal: false,
      },
    });
  }

  async replaceExternalInvitees(params: {
    recurringSeriesId: string;
    organizerId: string;
    externalInvitees: string[];
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, externalInvitees, tx } = params;
    const client = this.client(tx);
    const normalizedExternalInvitees = normalizeEmailList(externalInvitees);

    if (normalizedExternalInvitees.length === 0) {
      await client.recurringCallParticipant.deleteMany({
        where: {
          recurringSeriesId,
          isExternal: true,
        },
      });
      return;
    }

    await client.recurringCallParticipant.deleteMany({
      where: {
        recurringSeriesId,
        isExternal: true,
        OR: [
          { email: null },
          { email: { notIn: normalizedExternalInvitees } },
        ],
      },
    });

    const workspaceId = await resolveWorkspaceIdFromModel(client, 'recurringCallSeries', { id: recurringSeriesId });

    await client.recurringCallParticipant.createMany({
      data: normalizedExternalInvitees.map(email => {
        const participantId = uuidv4();
        return {
          id: participantId,
          recurringSeriesId,
          workspaceId,
          userId: participantId,
          invitedBy: organizerId,
          invitedAt: new Date(),
          response: InvitationResponse.INVITED,
          meetingStatus: MeetingStatus.PENDING,
          displayName: email,
          email,
          isExternal: true,
        };
      }),
      skipDuplicates: true,
    });
  }

  async findExternalInviteeEmails(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const participants = await this.client(tx).recurringCallParticipant.findMany({
      where: {
        recurringSeriesId,
        isExternal: true,
        email: { not: null },
      },
      select: {
        email: true,
      },
      orderBy: {
        invitedAt: 'asc',
      },
    });

    return participants
      .map(p => p.email)
      .filter((email): email is string => Boolean(email));
  }

  async findInternalParticipantUserIds(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const participants = await this.client(tx).recurringCallParticipant.findMany({
      where: {
        recurringSeriesId,
        isExternal: false,
      },
      select: {
        userId: true,
      },
      orderBy: {
        invitedAt: 'asc',
      },
    });

    return participants.map(p => p.userId);
  }

  async findInstanceSeed(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ targetUserIds?: string[]; externalInvitees: string[] }> {
    const internalParticipantUserIds = await this.findInternalParticipantUserIds(recurringSeriesId, tx);
    const externalInvitees = await this.findExternalInviteeEmails(recurringSeriesId, tx);

    return {
      targetUserIds: internalParticipantUserIds.length > 0
        ? internalParticipantUserIds
        : undefined,
      externalInvitees,
    };
  }

  async findBySeriesId(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RecurringCallParticipant[]> {
    return this.client(tx).recurringCallParticipant.findMany({
      where: { recurringSeriesId },
      orderBy: { invitedAt: 'asc' },
    });
  }
}
