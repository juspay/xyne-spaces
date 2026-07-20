/**
 * Calendar Webhook Routes
 *
 * Handles push notifications from Google Calendar and Microsoft Graph.
 * These endpoints must be publicly accessible (no auth middleware).
 */

import { Router, Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';
import { googleCalendarSyncQueue } from '@/queues/googleCalendarSyncQueue';
import { microsoftCalendarSyncQueue } from '@/queues/microsoftCalendarSyncQueue';
import { GoogleCalendarWatchService } from '@/services/googleCalendarWatchService';
import { MicrosoftCalendarSubscriptionService } from '@/services/microsoftCalendarSubscriptionService';
import { redisService } from '@/services/redisService';

const router = Router();
const TAG = '[CalendarWebhook]';
const GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS = 15;
const GOOGLE_WEBHOOK_COALESCED_JOB_DELAY_MS = GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS * 1000;

async function shouldEnqueueGoogleSyncImmediately(channelId: string): Promise<boolean> {
  try {
    const redis = redisService.getClient();
    const key = `calendar:webhook:google:${channelId}:sync-coalesce`;
    const result = await redis.set(
      key,
      '1',
      'EX',
      GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS,
      'NX',
    );
    return result === 'OK';
  } catch (err) {
    logger.warn(`${TAG} Google webhook coalescing unavailable, allowing immediate enqueue`, {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

// ============================================================================
// Google Calendar Webhook
// ============================================================================

router.post('/google-calendar', async (req: Request, res: Response) => {
  logger.info(`${TAG} [DEBUG] Google webhook HIT`, {
    ip: req.ip,
    headers: {
      'x-goog-channel-id': req.headers['x-goog-channel-id'],
      'x-goog-resource-id': req.headers['x-goog-resource-id'],
      'x-goog-resource-state': req.headers['x-goog-resource-state'],
      'x-goog-message-number': req.headers['x-goog-message-number'],
      hasChannelToken: Boolean(req.headers['x-goog-channel-token']),
    },
    body: req.body,
    url: req.originalUrl,
    method: req.method,
  });

  try {
    const channelId = req.headers['x-goog-channel-id'] as string;
    const resourceId = req.headers['x-goog-resource-id'] as string;
    const resourceState = req.headers['x-goog-resource-state'] as string;
    const messageNumber = req.headers['x-goog-message-number'] as string;
    const channelToken = req.headers['x-goog-channel-token'] as string | undefined;

    logger.info(`${TAG} Google Calendar webhook received`, {
      channelId,
      resourceState,
      messageNumber,
    });

    if (!channelId || !resourceId) {
      logger.error(`${TAG} Missing required headers`, { channelId, resourceId });
      res.status(400).send('Missing required Google Calendar webhook headers');
      return;
    }

    const subscription = await GoogleCalendarWatchService.findSubscriptionByChannel(channelId);

    if (!subscription) {
      logger.error(`${TAG} No subscription found for channel`, { channelId });
      res.status(404).send('Unknown Google Calendar channel');
      return;
    }

    const creds = parseCalendarCredentials(subscription.credentials);
    if (!creds?.resourceId) {
      logger.error(`${TAG} Subscription missing stored resource ID`, { channelId });
      res.status(403).send('Invalid Google Calendar channel');
      return;
    }

    if (creds.resourceId !== resourceId) {
      logger.error(`${TAG} Resource ID mismatch`, {
        channelId,
        expected: creds.resourceId,
        received: resourceId,
      });
      res.status(403).send('Google Calendar resource mismatch');
      return;
    }

    if (creds.channelToken) {
      if (creds.channelToken !== channelToken) {
        logger.error(`${TAG} Channel token mismatch`, {
          channelId,
          hasToken: Boolean(channelToken),
        });
        res.status(403).send('Google Calendar channel token mismatch');
        return;
      }
    } else {
      logger.warn(`${TAG} Tokenless Google Calendar webhook accepted via legacy resourceId validation`, {
        channelId,
        email: subscription.displayName,
      });
    }

    res.status(200).send('OK');

    switch (resourceState) {
      case 'sync':
        logger.info(`${TAG} Sync notification received`, { channelId, email: subscription.displayName });
        break;

      case 'exists':
      case 'not_exists':
        logger.info(`${TAG} Event change detected`, {
          channelId,
          email: subscription.displayName,
          resourceState,
        });

        if (await shouldEnqueueGoogleSyncImmediately(channelId)) {
          logger.info(`${TAG} Enqueuing immediate Google Calendar sync`, {
            channelId,
            sourceId: subscription.id,
          });
          await googleCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
        } else {
          logger.warn(`${TAG} Google Calendar webhook burst coalesced`, {
            channelId,
            sourceId: subscription.id,
            delayMs: GOOGLE_WEBHOOK_COALESCED_JOB_DELAY_MS,
          });
          await googleCalendarSyncQueue.enqueueIncrementalSync(subscription.id, {
            delayMs: GOOGLE_WEBHOOK_COALESCED_JOB_DELAY_MS,
            jobIdSuffix: 'coalesced',
          });
        }
        break;

      default:
        logger.warn(`${TAG} Unknown resource state`, { resourceState, channelId });
    }
  } catch (error) {
    logger.error(`${TAG} Error handling Google Calendar webhook`, {
      error: error,
    });
    if (!res.headersSent) {
      res.status(500).send('Google Calendar webhook failed');
    }
  }
});

// ============================================================================
// Microsoft Graph Webhook
// ============================================================================

router.get('/microsoft-calendar', (req: Request, res: Response) => {
  const validationToken = req.query.validationToken as string;

  if (validationToken) {
    logger.info(`${TAG} Microsoft webhook validation (GET)`);
    res.status(200).type('text/plain').send(validationToken);
  } else {
    res.status(400).send('Missing validationToken');
  }
});

router.post('/microsoft-calendar', async (req: Request, res: Response) => {
  try {
    const validationToken = req.query.validationToken as string;
    if (validationToken) {
      logger.info(`${TAG} Microsoft webhook validation (POST)`);
      res.status(200).type('text/plain').send(validationToken);
      return;
    }

    let payload = req.body;

    if (Buffer.isBuffer(payload)) {
      try {
        const jsonString = payload.toString('utf-8');
        payload = JSON.parse(jsonString);
      } catch (parseErr) {
        logger.error(`${TAG} Failed to parse Buffer payload`, {
          error: parseErr,
          preview: payload.slice(0, 100).toString('hex'),
        });
        res.status(202).send('Accepted');
        return;
      }
    }

    if (!payload || !Array.isArray(payload.value)) {
      logger.error(`${TAG} Invalid notification payload`, {
        bodyType: typeof req.body,
        isBuffer: Buffer.isBuffer(req.body),
        bodyKeys: payload ? Object.keys(payload).slice(0, 10) : 'null',
      });
      res.status(202).send('Accepted');
      return;
    }

    res.status(202).send('Accepted');

    for (const notification of payload.value) {
      await processMicrosoftNotification(notification);
    }
  } catch (error) {
    logger.error(`${TAG} Error handling Microsoft Calendar webhook`, {
      error: error,
    });
  }
});

// ============================================================================
// Microsoft Notification Processing
// ============================================================================

interface MicrosoftNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  lifecycleEvent?: string;
  subscriptionExpirationDateTime?: string;
  tenantId?: string;
}

async function processMicrosoftNotification(notification: MicrosoftNotification): Promise<void> {
  try {
    if (notification.lifecycleEvent) {
      await processMicrosoftLifecycleNotification(notification);
      return;
    }

    const { subscriptionId, clientState } = notification;

    if (!subscriptionId) {
      logger.error(`${TAG} Notification missing subscriptionId`);
      return;
    }

    const subscription = await MicrosoftCalendarSubscriptionService.findSubscriptionByMsSubscriptionId(subscriptionId);

    if (!subscription) {
      logger.error(`${TAG} No subscription found`, { subscriptionId });
      return;
    }

    const creds = parseCalendarCredentials(subscription.credentials);
    if (creds?.clientState && creds.clientState !== clientState) {
      logger.error(`${TAG} ClientState mismatch`, {
        subscriptionId,
        expected: creds.clientState.substring(0, 8) + '...',
        received: clientState?.substring(0, 8) + '...',
      });
      return;
    }

    logger.info(`${TAG} Processing Microsoft notification`, {
      subscriptionId,
      email: subscription.displayName,
      changeType: notification.changeType,
    });

    await microsoftCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
  } catch (error) {
    logger.error(`${TAG} Error processing Microsoft notification`, {
      error: error,
    });
  }
}

async function processMicrosoftLifecycleNotification(
  notification: MicrosoftNotification,
): Promise<void> {
  const { subscriptionId, lifecycleEvent } = notification;

  logger.info(`${TAG} Microsoft lifecycle notification`, {
    subscriptionId,
    lifecycleEvent,
  });

  if (!subscriptionId) return;

  const subscription = await MicrosoftCalendarSubscriptionService.findSubscriptionByMsSubscriptionId(subscriptionId);

  if (!subscription) {
    logger.warn(`${TAG} Lifecycle notification for unknown subscription`, { subscriptionId });
    return;
  }

  switch (lifecycleEvent) {
    case 'reauthorizationRequired':
      try {
        await MicrosoftCalendarSubscriptionService.renewSubscriptionForSource(subscription.id);
        logger.info(`${TAG} Subscription reauthorized`, { email: subscription.displayName });
      } catch (err) {
        logger.error(`${TAG} Failed to reauthorize subscription`, {
          email: subscription.displayName,
          error: err,
        });

        await repositories.externalSources.markCalendarError(subscription.id);
      }
      break;

    case 'subscriptionRemoved':
      logger.warn(`${TAG} Subscription removed by system`, { email: subscription.displayName });

      await repositories.externalSources.markMicrosoftSubscriptionExpired(subscription.id);

      try {
        await MicrosoftCalendarSubscriptionService.createSubscriptionForSource(subscription.id);
        logger.info(`${TAG} Subscription recreated`, { email: subscription.displayName });
      } catch (err) {
        logger.error(`${TAG} Failed to recreate subscription`, {
          email: subscription.displayName,
          error: err,
        });
      }
      break;

    case 'missed':
      logger.warn(`${TAG} Notifications missed, enqueuing incremental sync`, { email: subscription.displayName });
      await microsoftCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
      break;

    default:
      logger.warn(`${TAG} Unknown lifecycle event`, { lifecycleEvent });
  }
}

export default router;
