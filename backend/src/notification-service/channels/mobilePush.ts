import { MobilePushJobData, NotificationDeliveryResult } from '../types';
import { fcmPushService } from '@/services/fcmService';
import { ApnsPayload, apnsService } from '@/services/apnsService';
import { logger } from '@/utils/logger';
import { getCallNotifications } from '@/services/otel';

export class MobilePushChannel {
  async deliver(job: MobilePushJobData): Promise<NotificationDeliveryResult> {
    const { token, voipToken, platform, payload, userId, appVersion } = job;

    logger.info('[MobilePush] Delivering push notification...', {
      userId,
      platform,
      notificationId: payload.notificationId,
      type: payload.type,
      voipToken: voipToken?.substring(0, 6),
      token: token?.substring(0, 6),
      appVersion: appVersion,
    });

    const isIncomingCall = payload.type === 'INCOMING_CALL';

    // Use APNS VoIP for incoming calls on iOS if voipToken is available
    if (isIncomingCall && platform === 'ios' && voipToken && apnsService.isSendEnabled()) {
      const success = await this.deliverApn(job);
      if (success) {
        return { success: true, deliveredAt: new Date() };
      } else {
        // Fallback to FCM if APNS fails
        return this.deliverFcm(job);
      }
    } else {
      // Default to FCM for non-APNS-VoIP scenarios
      return this.deliverFcm(job);
    }
  }

  private async deliverFcm(job: MobilePushJobData): Promise<NotificationDeliveryResult> {
    const { sessionId, token, platform, payload, userId, appVersion } = job;
    const isIncomingCall = payload.type === 'INCOMING_CALL';

    try {
      if (isIncomingCall) {
        getCallNotifications().add(1, { deliveryType: 'fcm', platform, status: 'created' });
      }

      // Check if FCM is enabled
      if (!fcmPushService.isSendEnabled()) {
        if (isIncomingCall) {
          getCallNotifications().add(1, { deliveryType: 'fcm', platform, status: 'failed', failureReason: 'disabled' });
        }
        logger.warn(`[MobilePush] FCM not enabled, skipping delivery`, {
          userId,
        });
        return {
          success: false,
          error: 'FCM service not enabled',
        };
      }

      // Use the public dispatch method
      await fcmPushService.dispatchToFcmDirect(token, {
        type: payload.type,
        title: payload.title,
        message: payload.message,
        notificationId: payload.notificationId,
        actionUrl: payload.actionUrl,
        relatedEntityType: payload.relatedEntityType,
        relatedEntityId: payload.relatedEntityId,
        metadata: payload.metadata,
        prefetchOnly: payload.prefetchOnly,
      }, platform, appVersion);

      if (isIncomingCall) {
        getCallNotifications().add(1, { deliveryType: 'fcm', platform, status: 'sent' });
      }

      logger.info('[MobilePush] ✅ Delivered push notification', {
        userId,
        platform,
        notificationId: payload.notificationId,
        appVersion: appVersion,
      });

      return {
        success: true,
        deliveredAt: new Date(),
      };
    } catch (error: any) {
      
      const errorCode = this.extractErrorCode(error);

      if (payload.type === 'INCOMING_CALL') {
        getCallNotifications().add(1, { deliveryType: 'fcm', platform, status: 'failed', failureReason: errorCode });
      }

      logger.error(`[MobilePush] ❌ Failed to deliver`, {
        userId,
        platform,
        errorCode,
        status: error.status,
        message: error.message,
        notificationId: payload.notificationId,
        appVersion,
      });

      // Clear invalid tokens
      const invalidTokenErrorCodes = [
        'UNREGISTERED',
        'INVALID_ARGUMENT',
        'NOT_FOUND',
        'UNSPECIFIED', // Often implies a bad request structure
        'SENDER_ID_MISMATCH'
      ];

      const isPermanentError = invalidTokenErrorCodes.includes(errorCode);
      
      if (isPermanentError) {
        try {
          // Only clear token if it's definitely invalid
          if (errorCode === 'UNREGISTERED' || errorCode === 'NOT_FOUND') {
            await fcmPushService.clearSessionPushToken(sessionId);
            logger.info('[MobilePush] Cleared invalid token for push notification');
          }
        } catch (clearError) {
          logger.error(`[MobilePush] Failed to clear session token`, {
            error: clearError,
          });
        }
      }

      return {
        success: false,
        error: error.message || 'Mobile push delivery failed',
        errorCode,
        isRetryable: !isPermanentError
      };
    }
  }

  private extractErrorCode(error: any): string {
    if (error.responseBody) {
      try {
        const parsed = JSON.parse(error.responseBody);
        const details = parsed?.error?.details;
        if (Array.isArray(details)) {
          for (const detail of details) {
            if (detail?.errorCode) {
              return detail.errorCode;
            }
          }
        }
        return parsed?.error?.status || 'UNKNOWN';
      } catch {
        return 'PARSE_ERROR';
      }
    }
    return 'UNKNOWN';
  }

  private async deliverApn(job: MobilePushJobData): Promise<boolean> {
    const { voipToken, payload, userId } = job;
    
    getCallNotifications().add(1, { deliveryType: 'apns', platform: 'ios', status: 'created' });

    try {
      logger.info(`[MobilePush] Using APNS VoIP for incoming call`, {
        userId,
        notificationId: payload.notificationId,
        appVersion: job.appVersion,
      });
      
      const apnsPayload: ApnsPayload = {
        type: payload.type,
        title: payload.title,
        message: payload.message,
        notificationId: payload.notificationId,
        actionUrl: payload.actionUrl,
        relatedEntityType: payload.relatedEntityType,
        relatedEntityId: payload.relatedEntityId,
        metadata: payload.metadata,
        callerName: (payload.metadata?.callerName as string) || 'Xyne Caller',
        handle: (payload.metadata?.callerId as string) || 'xyne-call',
      };

      if (!voipToken) {
        getCallNotifications().add(1, { deliveryType: 'apns', platform: 'ios', status: 'failed', failureReason: 'missing_token' });
        logger.error(`[MobilePush] Missing voipToken for APNS delivery`, { userId });
        return false;
      }

      const success = await apnsService.sendVoipPush(voipToken, apnsPayload);

      if (success) {
        getCallNotifications().add(1, { deliveryType: 'apns', platform: 'ios', status: 'sent' });
        logger.info(`[MobilePush] ✅ APNS delivered`, {
          userId,
          notificationId: payload.notificationId,
          appVersion: job.appVersion,
        });
        return true;
      } else {
        getCallNotifications().add(1, { deliveryType: 'apns', platform: 'ios', status: 'failed', failureReason: 'send_failed' });
        logger.info(`[MobilePush] APNS VoIP failed, falling back to FCM`, { userId, notificationId: payload.notificationId });
        return false;
      }
    } catch (error: any) {
      getCallNotifications().add(1, { deliveryType: 'apns', platform: 'ios', status: 'failed', failureReason: 'error' });
      logger.error(`[MobilePush] APNS VoIP error`, {
        error,
        userId,
        notificationId: payload.notificationId,
        appVersion: job.appVersion,
      });
      return false;
    }
  }
}
