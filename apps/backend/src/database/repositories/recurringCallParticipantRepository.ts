import { v4 as uuidv4 } from 'uuid';
import { type Prisma, type RecurringCallParticipant } from '@prisma/client';
import { InvitationResponse, MeetingStatus } from '@xyne/shared';
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

  /**
   * Replace the series' internal participants with `userIds` (the organizer is always kept).
   * `invitedByUserId` is the editor and is stamped only on rows that did not exist before —
   * a participant who added someone must stay credited so they can remove them later, and
   * everyone else's original inviter must survive an edit by someone other than the organizer.
   */
  async replaceInternalParticipants(params: {
    recurringSeriesId: string;
    organizerId: string;
    invitedByUserId?: string;
    userIds: string[];
    workspaceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, invitedByUserId, userIds, workspaceId, tx } = params;
    const client = this.client(tx);
    const participantUserIds = normalizeUserIds(userIds, organizerId);
    const now = new Date();

    const existingInviters = new Map(
      (await this.findInternalParticipants(recurringSeriesId, tx)).map(p => [p.userId, p.invitedBy]),
    );

    await client.recurringCallParticipant.deleteMany({
      where: {
        recurringSeriesId,
        isExternal: false,
      },
    });


    await client.recurringCallParticipant.createMany({
      data: participantUserIds.map(userId => ({
        id: uuidv4(),
        recurringSeriesId,
        workspaceId,
        userId,
        invitedBy: existingInviters.get(userId) ?? invitedByUserId ?? organizerId,
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
    workspaceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, externalInvitees, workspaceId, tx } = params;
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

  /** Internal participants with the user who invited each of them. */
  async findInternalParticipants(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ userId: string; invitedBy: string }>> {
    return this.client(tx).recurringCallParticipant.findMany({
      where: {
        recurringSeriesId,
        isExternal: false,
      },
      select: {
        userId: true,
        invitedBy: true,
      },
      orderBy: {
        invitedAt: 'asc',
      },
    });
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

  /**
   * Everything a generated occurrence needs to mirror the series' invite list, including
   * each participant's inviter — without it every new instance would credit the organizer
   * for everyone, and a participant editor could no longer remove people they added.
   */
  async findInstanceSeed(
    recurringSeriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    targetUserIds?: string[];
    participantInviters: Record<string, string>;
    externalInvitees: string[];
  }> {
    const internalParticipants = await this.findInternalParticipants(recurringSeriesId, tx);
    const externalInvitees = await this.findExternalInviteeEmails(recurringSeriesId, tx);

    return {
      targetUserIds: internalParticipants.length > 0
        ? internalParticipants.map(p => p.userId)
        : undefined,
      participantInviters: Object.fromEntries(
        internalParticipants.map(p => [p.userId, p.invitedBy]),
      ),
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
