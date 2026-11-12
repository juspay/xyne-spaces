import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { Call } from '@prisma/client';

/**
 * ACL validation for LiveKit webhook operations
 * Equivalent to Zero ACL but for webhook-initiated database operations
 */
export class LiveKitWebhookACL {
  private get db() {
    return DatabaseClient.getInstance();
  }

  /**
   * Validate call status update (ending call, participant leaving)
   * Equivalent to CallsACL.canUpdate for status/endedAt
   */
  async canUpdateCallStatus(params: {
    callExternalId: string;
    userId: string;
  }): Promise<{ valid: true; call: Call } | { valid: false; reason: string }> {
    const { callExternalId, userId } = params;

    // Find call by external ID
    const call = await this.db.call.findUnique({
      where: { externalId: callExternalId },
    });

    if (!call) {
      logger.warn(`[Webhook ACL] Call not found: ${callExternalId}`);
      return {
        valid: false,
        reason: `Call ${callExternalId} does not exist`,
      };
    }

    // Verify user is a call participant
    const isParticipant = await this.db.callParticipant.findFirst({
      where: {
        callId: call.id,
        userId: userId,
      },
    });

    if (!isParticipant) {
      logger.error(
        `[Webhook ACL] Call update failed: user ${userId} is not a participant of call ${callExternalId}`
      );
      return {
        valid: false,
        reason: `User ${userId} is not a participant of call ${callExternalId}`,
      };
    }

    return { valid: true, call };
  }
}

export const livekitWebhookACL = new LiveKitWebhookACL();
