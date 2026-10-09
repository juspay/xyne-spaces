import { transaction } from '../base';
import type { Call, Prisma } from '@prisma/client';
import { CallStatus, InvitationResponse, MeetingStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { CALENDAR_CALL_ORIGINS, isRecording } from '@/utils/callTypeUtils';
import { recordingSharingService } from '@/services/recordingSharingService';


type TransferredCall = Pick<Call, 'id' | 'externalId' | 'status' | 'callOrigin' | 'metadata' | 'transcript'>;

/** The series' other SCHEDULED instances, i.e. everything the owner change sweeps besides the named call. */
function findOtherScheduledSeriesCalls(tx: Prisma.TransactionClient, seriesId: string, excludeCallId: string): Promise<TransferredCall[]> {
  return tx.call.findMany({
    where: {
      recurringSeriesId: seriesId,
      status: CallStatus.SCHEDULED,
      id: { not: excludeCallId },
      callOrigin: { notIn: [...CALENDAR_CALL_ORIGINS] },
    },
    select: { id: true, externalId: true, status: true, callOrigin: true, metadata: true, transcript: true },
  });
}

/** Hands the series to the new owner and returns its other SCHEDULED instances to move with it. */
async function transferSeriesTx(tx: Prisma.TransactionClient, call: Call, seriesId: string, newOwnerUserId: string): Promise<TransferredCall[]> {
  await repositories.recurringCallSeries.update(seriesId, { organizerId: newOwnerUserId }, tx);
  const now = new Date();
  await tx.recurringCallParticipant.upsert({
    where: { recurringSeriesId_userId: { recurringSeriesId: seriesId, userId: newOwnerUserId } },
    create: {
      recurringSeriesId: seriesId,
      workspaceId: call.workspaceId,
      userId: newOwnerUserId,
      invitedBy: call.createdByUserId,
      invitedAt: now,
      response: InvitationResponse.INVITED,
      meetingStatus: MeetingStatus.ACCEPTED,
      respondedAt: now,
      isExternal: false,
    },
    update: { meetingStatus: MeetingStatus.ACCEPTED, respondedAt: now },
  });
  return findOtherScheduledSeriesCalls(tx, seriesId, call.id);
}

/**
 * Calls admin panel owner change: rewrite the call (and, with `seriesId`, the series
 * organizer and every future SCHEDULED instance) to `newOwnerUserId`. Returns the calls
 * moved so the caller can run the post-commit side effects.
 */
export function transferOwnershipTx(call: Call, newOwnerUserId: string, seriesId: string | null): Promise<TransferredCall[]> {
  return transaction(['Call', 'CallParticipant', 'RecurringCallSeries', 'RecurringCallParticipant', 'EntityAccess'], 'callAdmin.transferOwnership: series organizer, instance owners, participant rows and the previous owner\'s recording share must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const seriesCalls = seriesId ? await transferSeriesTx(tx, call, seriesId, newOwnerUserId) : [];
    const calls: TransferredCall[] = [call, ...seriesCalls];
    await repositories.calls.transferOwnership(calls.map((transferredCall) => transferredCall.id), newOwnerUserId, tx);
    // Recording access ignores participants, so the old owner needs an explicit share.
    if (isRecording(call) && call.createdByUserId !== newOwnerUserId) {
      await recordingSharingService.grantPreviousOwnerView(tx, call.id, call.createdByUserId);
    }
    return calls;
  },
  // A daily series keeps ~60 future instances, each a few writes.
  { timeout: 60_000 });
}
