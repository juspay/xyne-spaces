import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
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
   * Validate call creation via webhook
   * Equivalent to CallsACL.canInsert
   */
  async canCreateCall(params: {
    channelId: string;
    createdBy: string;
    joiningUserId: string;
  }): Promise<{ valid: true } | { valid: false; reason: string }> {
    const { channelId, createdBy, joiningUserId } = params;

    // Verify channel exists
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      logger.error(`[Webhook ACL] Call creation failed: channel ${channelId} does not exist`);
      return {
        valid: false,
        reason: `Channel ${channelId} does not exist`,
      };
    }

    // Get channel participants
    const channelParticipants = await repositories.channelParticipants.getChannelParticipants(channelId);

    // Verify call creator is a channel participant
    const creatorIsParticipant = channelParticipants.some((cp) => cp.userId === createdBy);
    if (!creatorIsParticipant) {
      logger.error(
        `[Webhook ACL] Call creation failed: user ${createdBy} is not a participant of channel ${channelId}`
      );
      return {
        valid: false,
        reason: `User ${createdBy} is not a participant of channel ${channelId}`,
      };
    }

    // Verify joining user is a channel participant
    const joinerIsParticipant = channelParticipants.some((cp) => cp.userId === joiningUserId);
    if (!joinerIsParticipant) {
      logger.error(
        `[Webhook ACL] Call join failed: user ${joiningUserId} is not a participant of channel ${channelId}`
      );
      return {
        valid: false,
        reason: `User ${joiningUserId} is not a participant of channel ${channelId}`,
      };
    }

    return { valid: true };
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
