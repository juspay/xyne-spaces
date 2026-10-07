import { transaction } from '../base';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { MeetingStatus } from '@xyne/shared';
import { updateRecurringSeriesMeetingStatus } from '@/bypassAcl/transactions/callRepository';


export function hideCallTx(participant: any, now: Date, isSeries: boolean | undefined, call: any, userId: string) {
  return transaction(['Call', 'CallParticipant'], 'hideCall: participant hide and recurring series hide must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await repositories.calls.updateParticipantMeetingStatus(
      participant.id,
      MeetingStatus.HIDDEN,
      now,
      tx,
    );

    if (isSeries && call.recurringSeriesId) {
      return updateRecurringSeriesMeetingStatus({
        recurringSeriesId: call.recurringSeriesId,
        userId,
        meetingStatus: MeetingStatus.HIDDEN,
        respondedAt: now,
        tx,
      });
    }

    return 1;
  });
}
