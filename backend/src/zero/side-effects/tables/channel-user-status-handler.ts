import { notificationService } from '@/services/notificationService';
import { BaseSideEffectHandler } from '../base-handler';
import type { ChannelUserStatusPreviousValue, SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { NotificationType } from '@prisma/client';


/**
 * When a user's channel_user_status row is updated with a new lastViewedAt,
 * send a silent data-only FCM push to their mobile sessions so the
 * notification tray for that channel can be cleared.
 */
export class ChannelUserStatusSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as ChannelUserStatusPreviousValue | undefined;
    const args = job.args as { lastViewedAt?: number; unreadCount?: number } | undefined;

    if (!prev) {
      return;
    }

    const hasReadClear =
      args?.unreadCount === 0 && prev.unreadCount > 0;

    if (!hasReadClear) return;

    try {
      await notificationService.createNotification(prev.userId, {
        title: 'Silent notification', 
        message: 'silent notification',
        type: NotificationType.CHANNEL_READ,
        metadata: {
          channelId: prev.channelId,
        }
      }, { sendDesktop: true, sendMobile: true, isSilent: true})
      logger.info(
        `[SideEffect] Sent CHANNEL_READ FCM for user ${prev.userId}, channel ${prev.channelId}`
      );
    } catch (error) {
      logger.error(`[SideEffect] Failed to send CHANNEL_READ FCM:`, error);
    }
  }
}
