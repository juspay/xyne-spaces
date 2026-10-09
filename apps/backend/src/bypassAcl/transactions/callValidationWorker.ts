import { transaction } from '../base';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { Call } from '@prisma/client';
import { endCall } from '@/bypassAcl/transactions/callRepository';


export function validateCallTx(callId: string, endedAt: Date, externalId: string, status: string, reason: string, call: Call) {
  return transaction(['Call', 'CallParticipant', 'Message', 'MessageArtifact', 'User'], 'validateCall: stale call end, preview refresh, artifact completion and system message update must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // End the call
    await endCall(repositories.calls, callId, endedAt, tx);

    logger.info(
      `[CallValidationWorker] [${externalId}] call_status_updated | from=${status}, to=ENDED, reason=${reason}`,
    );

    // Update system message if needed
    const messageUpdated = await updateCallSystemMessageIfNeeded({
      call,
      callId: externalId,
      endedAt,
      tx,
    });

    if (messageUpdated) {
      logger.info(`[CallValidationWorker] Updated system message for call ${externalId}`);
    }
  });
}
