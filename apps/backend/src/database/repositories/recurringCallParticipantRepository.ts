
import { type Prisma, type RecurringCallParticipant } from '@prisma/client';
import { DatabaseClient } from '../client';

export function normalizeUserIds(userIds: string[] | undefined, organizerId: string): string[] {
  const normalized = [...new Set((userIds ?? []).map(id => id.trim()).filter(Boolean))];
  return normalized.includes(organizerId) ? normalized : [organizerId, ...normalized];
}

export class RecurringCallParticipantRepository {
  client(tx?: Prisma.TransactionClient) {
    return tx ?? DatabaseClient.getInstance();
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
