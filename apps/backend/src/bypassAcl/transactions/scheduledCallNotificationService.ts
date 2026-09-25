import { transaction } from '../base';
import { MeetingStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { updateRecurringSeriesMeetingStatus } from '@/bypassAcl/transactions/callRepository';
export async function updateParticipantMeetingStatusTx(participantId: string, meetingStatus: MeetingStatus, respondedAt: Date, isSeries: boolean, recurringSeriesId: string | undefined, updatedCount: number, userId: string) {
  const result = await transaction(['Call', 'CallParticipant'], 'updateParticipantMeetingStatus: single response plus series-wide response fan-out must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await repositories.calls.updateParticipantMeetingStatus(participantId, meetingStatus, respondedAt, tx);

    if (isSeries && recurringSeriesId) {
      updatedCount = await updateRecurringSeriesMeetingStatus({
        recurringSeriesId,
        userId,
        meetingStatus,
        respondedAt,
        tx,
      });
    }
  });
  return { result, updatedCount };
}
