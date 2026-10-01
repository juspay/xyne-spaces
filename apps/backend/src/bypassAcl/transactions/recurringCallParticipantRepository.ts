import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { InvitationResponse, MeetingStatus } from '@xyne/shared';
import { normalizeUserIds } from '@/database/repositories/recurringCallParticipantRepository';
import type { RecurringCallParticipantRepository } from '@/database/repositories/recurringCallParticipantRepository';
import { normalizeEmailList } from '@/utils/email';

  /**
   * Replace the series' internal participants with `userIds` (the organizer is always kept).
   * `invitedByUserId` is the editor and is stamped only on rows that did not exist before —
   * a participant who added someone must stay credited so they can remove them later, and
   * everyone else's original inviter must survive an edit by someone other than the organizer.
   */
export async function replaceInternalParticipants(self: RecurringCallParticipantRepository, params: {
    recurringSeriesId: string;
    organizerId: string;
    invitedByUserId?: string;
    userIds: string[];
    workspaceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, invitedByUserId, userIds, workspaceId, tx } = params;
    const client = self.client(tx);
    const participantUserIds = normalizeUserIds(userIds, organizerId);
    const now = new Date();

    const existingInviters = new Map(
      (await self.findInternalParticipants(recurringSeriesId, tx)).map(p => [p.userId, p.invitedBy]),
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

export async function replaceExternalInvitees(self: RecurringCallParticipantRepository, params: {
    recurringSeriesId: string;
    organizerId: string;
    externalInvitees: string[];
    workspaceId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, externalInvitees, workspaceId, tx } = params;
    const client = self.client(tx);
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
