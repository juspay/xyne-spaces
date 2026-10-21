import { transaction } from '../base';
import { LiveKitWebhookController } from '@/controllers/livekitWebhookController';
import { InvitationResponse } from '@xyne/shared';
import { updateParticipantResponse } from '@/bypassAcl/transactions/callRepository';


export function handleParticipantJoinedTx(self: LiveKitWebhookController, existingParticipant: any, now: Date) {
  return transaction(['CallParticipant'], 'handleParticipantJoined: call participant response update must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    await updateParticipantResponse(existingParticipant.id, InvitationResponse.ACCEPTED, now, tx);
  });
}
