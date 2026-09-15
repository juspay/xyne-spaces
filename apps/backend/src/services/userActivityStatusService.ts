import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { CallStatus, InvitationResponse, UserActivityStatus } from '@xyne/shared';

class UserActivityStatusService {
  async isUserInAnyActiveCall(userId: string): Promise<boolean> {
    const participant = await db.callParticipant.findFirst({
      where: {
        userId,
        response: InvitationResponse.ACCEPTED,
        call: { status: CallStatus.ACTIVE },
      },
      select: { id: true },
    });

    return participant !== null;
  }

  async markInCall(userId: string): Promise<void> {
    try {
      // updateMany, not update: external participants have no users row and update would throw
      const { count } = await db.user.updateMany({
        where: { id: userId },
        data: { activityStatus: UserActivityStatus.IN_CALL },
      });

      if (count === 0) {
        logger.debug(
          `[UserActivityStatus] No user row for ${userId} — skipping IN_CALL (external participant?)`,
        );
        return;
      }

      logger.info(`[UserActivityStatus] activity_status_updated | user=${userId}, to=IN_CALL`);
    } catch (error) {
      logger.error(`[UserActivityStatus] Failed to mark user ${userId} as IN_CALL:`, error);
    }
  }

  async clearInCall(userId: string): Promise<void> {
    try {
      if (await this.isUserInAnyActiveCall(userId)) {
        logger.debug(
          `[UserActivityStatus] Keeping IN_CALL for user ${userId} — still joined to another active call`,
        );
        return;
      }

      const { count } = await db.user.updateMany({
        where: { id: userId, activityStatus: UserActivityStatus.IN_CALL },
        data: { activityStatus: null },
      });

      if (count > 0) {
        logger.info(`[UserActivityStatus] activity_status_updated | user=${userId}, from=IN_CALL, to=null`);
      }
    } catch (error) {
      logger.error(`[UserActivityStatus] Failed to clear IN_CALL for user ${userId}:`, error);
    }
  }

  async clearInCallForEndedCall(callId: string): Promise<void> {
    try {
      const participants = await db.callParticipant.findMany({
        where: { callId, response: InvitationResponse.ACCEPTED },
        select: { userId: true },
      });

      await Promise.all(participants.map((participant) => this.clearInCall(participant.userId)));
    } catch (error) {
      logger.error(`[UserActivityStatus] Failed to clear IN_CALL for ended call ${callId}:`, error);
    }
  }

  async reconcileInCallUsers(batchSize: number): Promise<number> {
    const flagged = await db.user.findMany({
      where: { activityStatus: UserActivityStatus.IN_CALL },
      select: { id: true },
      take: batchSize,
    });

    if (flagged.length === 0) return 0;

    let cleared = 0;

    for (const { id: userId } of flagged) {
      try {
        if (await this.isUserInAnyActiveCall(userId)) continue;

        const { count } = await db.user.updateMany({
          where: { id: userId, activityStatus: UserActivityStatus.IN_CALL },
          data: { activityStatus: null },
        });

        if (count > 0) {
          cleared += 1;
          logger.info(
            `[UserActivityStatus] activity_status_updated | user=${userId}, from=IN_CALL, to=null, reason=stale_reconcile`,
          );
        }
      } catch (error) {
        logger.error(`[UserActivityStatus] Failed to reconcile IN_CALL for user ${userId}:`, error);
      }
    }

    return cleared;
  }
}

export const userActivityStatusService = new UserActivityStatusService();
