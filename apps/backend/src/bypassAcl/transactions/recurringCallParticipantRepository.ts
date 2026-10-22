import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { InvitationResponse, MeetingStatus, type CallRingNotification } from '@xyne/shared';
import { normalizeUserIds } from '@/database/repositories/recurringCallParticipantRepository';
import type { RecurringCallParticipantRepository } from '@/database/repositories/recurringCallParticipantRepository';
import { normalizeEmailList } from '@/utils/email';

  /**
   * Replace the series' internal participants with `userIds` (the organizer is always kept).
   * `invitedByUserId` is the editor and is stamped only on rows that did not exist before —
   * a participant who added someone must stay credited so they can remove them later, and
   * everyone else's original inviter must survive an edit by someone other than the organizer.
   * `ringNotification` likewise survives the rewrite: when omitted, existing rows keep theirs
   * and new rows take the organizer's, so an edit that doesn't touch it never resets it.
   */
export async function replaceInternalParticipants(self: RecurringCallParticipantRepository, params: {
    recurringSeriesId: string;
    organizerId: string;
    invitedByUserId?: string;
    userIds: string[];
    workspaceId: string;
    ringNotification?: CallRingNotification;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { recurringSeriesId, organizerId, invitedByUserId, userIds, workspaceId, ringNotification, tx } = params;
    const client = self.client(tx);
    const participantUserIds = normalizeUserIds(userIds, organizerId);
    const now = new Date();

    const existingParticipants = await self.findInternalParticipants(recurringSeriesId, tx);
    const existingInviters = new Map(existingParticipants.map(p => [p.userId, p.invitedBy]));
    const existingRingNotifications = new Map(existingParticipants.map(p => [p.userId, p.ringNotification]));
    const ringNotificationFor = (userId: string): string | null =>
      ringNotification ??
      (existingRingNotifications.has(userId)
        ? existingRingNotifications.get(userId)!
        : existingRingNotifications.get(organizerId) ?? null);

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
        ringNotification: ringNotificationFor(userId),
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
