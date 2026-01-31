import apn from '@parse/node-apn';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export type ApnsPayload = {
  title: string;
  message: string;
  type: string;
  notificationId?: string;
  callerName?: string;
  handle?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  uuid?: string;
};

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

class ApnsService {
  private provider?: apn.Provider;
  private bundleId?: string;
  private logger = logger.child({ module: 'ApnsService' });

  constructor() {
    if (config.apns.keyId && config.apns.teamId && config.apns.p8Base64 && config.apns.bundleId) {
      try {
        const p8Content = Buffer.from(config.apns.p8Base64, 'base64').toString('utf8');
        const tokenConfig = {
          key: p8Content,
          keyId: config.apns.keyId,
          teamId: config.apns.teamId,
        };

        this.provider = new apn.Provider({
          token: tokenConfig,
          production: isProduction,
          requestTimeout: 10000,
        });

        this.bundleId = config.apns.bundleId;
        this.logger.info('APNS VoIP and Standard services initialized using split providers');
      } catch (error) {
        this.logger.error('Failed to initialize APNS service', error);
      }
    } else {
      this.logger.warn('APNS services disabled: Missing configuration');
    }
  }

  isSendEnabled(): boolean {
    return !!this.provider;
  }

  async sendVoipPush(token: string, payload: ApnsPayload): Promise<boolean> {
    if (!this.provider || !this.bundleId) {
      this.logger.warn('APNS voipProvider or bundleId not initialized, skipping VoIP push');
      return false;
    }

    try {
      const notification = new apn.Notification();

      notification.topic = `${this.bundleId}.voip`;
      notification.priority = 10;
      notification.pushType = 'voip';
      notification.expiry = Math.floor(Date.now() / 1000) + 3600;

      // Use the call's externalId as the UUID for CallKit
      // This allows the app to join the call using the UUID when user accepts
      const uuid = payload.relatedEntityId || payload.uuid || crypto.randomUUID();

      const apnsPayload = {
        ...payload,
        uuid,
      };

      notification.payload = apnsPayload;

      const result = await this.provider.send(notification, token);

      if (result.failed.length > 0) {
        this.logger.warn('APNS VoIP push failed details', {
          notificationId: payload.notificationId,
          error: result.failed[0].error?.message,
          status: result.failed[0].status,
        });
        return false;
      }

      this.logger.info('APNS VoIP push sent', {
        notificationId: payload.notificationId,
        uuid,
        relatedEntityId: payload.relatedEntityId,
      });

      return true;
    } catch (error) {
      this.logger.error('Error sending APNS VoIP push', {
        notificationId: payload.notificationId,
        error,
      });
      return false;
    }
  }

  async sendStandardPush(token: string, payload: ApnsPayload): Promise<boolean> {
    if (!this.provider || !this.bundleId) {
      this.logger.warn('APNS provider or bundleId not initialized, skipping standard push');
      return false;
    }

    try {
      const bundleId = this.bundleId;
      const notification = new apn.Notification();

      notification.topic = bundleId;
      notification.priority = 5; // Reduced priority for background
      notification.pushType = 'background';
      notification.contentAvailable = true;

      if (payload.title || payload.message) {
        notification.priority = 10;
        notification.pushType = 'alert';
        notification.alert = {
          title: payload.title,
          body: payload.message,
        };
        notification.sound = 'default';
      }

      notification.payload = {
        ...payload,
      };
      
      const result = await this.provider.send(notification, token);

      if (result.failed.length > 0) {
        this.logger.warn('Standard APNS push failed', {
          notificationId: payload.notificationId,
          error: result.failed[0].error?.message,
        });
        return false;
      }

      this.logger.info('Standard APNS push sent', {
        notificationId: payload.notificationId,
      });

      return true;
    } catch (error) {
      this.logger.error('Error sending standard APNS push', {
        notificationId: payload.notificationId,
        error,
      });
      return false;
    }
  }
}

export const apnsService = new ApnsService();
