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
const GOOGLE_TAG = '[CALENDAR_SYNC][GOOGLE][WEBHOOK]';
const MICROSOFT_TAG = '[CALENDAR_SYNC][MICROSOFT][WEBHOOK]';
const GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS = 15;
const GOOGLE_WEBHOOK_COALESCED_JOB_DELAY_MS = GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS * 1000;

async function shouldEnqueueGoogleSyncImmediately(channelId: string): Promise<boolean> {
  try {
    const redis = redisService.getClient();
    const key = `calendar:webhook:google:${channelId}:sync-coalesce`;
    const result = await redis.set(key, '1', 'EX', GOOGLE_WEBHOOK_COALESCE_WINDOW_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    logger.warn(`${GOOGLE_TAG} Webhook coalescing unavailable, allowing immediate enqueue`, {
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
  logger.info(`${GOOGLE_TAG} [DEBUG] Webhook HIT`, {
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

    logger.info(`${GOOGLE_TAG} Webhook received`, {
      channelId,
      resourceState,
      messageNumber,
    });

    if (!channelId || !resourceId) {
      logger.error(`${GOOGLE_TAG} Missing required headers`, { channelId, resourceId });
      res.status(400).send('Missing required Google Calendar webhook headers');
      return;
    }

    const subscription = await GoogleCalendarWatchService.findSubscriptionByChannel(channelId);

    if (!subscription) {
      logger.error(`${GOOGLE_TAG} No subscription found for channel`, { channelId });
      res.status(404).send('Unknown Google Calendar channel');
      return;
    }

    const creds = parseCalendarCredentials(subscription.credentials);
    if (!creds?.resourceId) {
      logger.error(`${GOOGLE_TAG} Subscription missing stored resource ID`, { channelId });
      res.status(403).send('Invalid Google Calendar channel');
      return;
    }

    if (creds.resourceId !== resourceId) {
      logger.error(`${GOOGLE_TAG} Resource ID mismatch`, {
        channelId,
        expected: creds.resourceId,
        received: resourceId,
      });
      res.status(403).send('Google Calendar resource mismatch');
      return;
    }

    if (creds.channelToken) {
      if (creds.channelToken !== channelToken) {
        logger.error(`${GOOGLE_TAG} Channel token mismatch`, {
          channelId,
          hasToken: Boolean(channelToken),
        });
        res.status(403).send('Google Calendar channel token mismatch');
        return;
      }
    } else {
      logger.warn(`${GOOGLE_TAG} Tokenless webhook accepted via legacy resourceId validation`, {
        channelId,
        email: subscription.displayName,
      });
    }

    res.status(200).send('OK');

    switch (resourceState) {
      case 'sync':
        logger.info(`${GOOGLE_TAG} Sync notification received`, {
          channelId,
          email: subscription.displayName,
        });
        break;

      case 'exists':
      case 'not_exists':
        logger.info(`${GOOGLE_TAG} Event change detected`, {
          channelId,
          email: subscription.displayName,
          resourceState,
        });

        if (await shouldEnqueueGoogleSyncImmediately(channelId)) {
          logger.info(`${GOOGLE_TAG} Enqueuing immediate incremental sync`, {
            channelId,
            sourceId: subscription.id,
          });
          await googleCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
        } else {
          logger.warn(`${GOOGLE_TAG} Webhook burst coalesced`, {
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
        logger.warn(`${GOOGLE_TAG} Unknown resource state`, { resourceState, channelId });
    }
  } catch (error) {
    logger.error(`${GOOGLE_TAG} Error handling webhook`, {
      error: error instanceof Error ? error.message : String(error),
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
  const validationToken = req.query.validationToken;

  if (typeof validationToken === 'string' && validationToken.length > 0) {
    logger.info(`${MICROSOFT_TAG} Webhook validation (GET)`);
    res.status(200).type('text/plain').send(validationToken);
  } else {
    res.status(400).send('Missing validationToken');
  }
});

router.post('/microsoft-calendar', async (req: Request, res: Response) => {
  try {
    const validationToken = req.query.validationToken;
    if (typeof validationToken === 'string' && validationToken.length > 0) {
      logger.info(`${MICROSOFT_TAG} Webhook validation (POST)`);
      res.status(200).type('text/plain').send(validationToken);
      return;
    }

    let payload: unknown = req.body;

    if (Buffer.isBuffer(payload)) {
      // Keep a Buffer-typed reference: `payload` is reassigned to the parsed JSON below, which
      // widens its type, so the error branch must log from this known Buffer, not `payload`.
      const rawBuf = payload;
      try {
        const jsonString = rawBuf.toString('utf-8');
        payload = JSON.parse(jsonString);
      } catch (parseErr) {
        logger.error(`${MICROSOFT_TAG} Failed to parse Buffer payload`, {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          preview: rawBuf.slice(0, 100).toString('hex'),
        });
        res.status(202).send('Accepted');
        return;
      }
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Array.isArray((payload as { value?: unknown }).value)
    ) {
      logger.error(`${MICROSOFT_TAG} Invalid notification payload`, {
        bodyType: typeof req.body,
        isBuffer: Buffer.isBuffer(req.body),
        bodyKeys:
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? Object.keys(payload).slice(0, 10)
            : 'null',
      });
      res.status(202).send('Accepted');
      return;
    }

    const notifications = (payload as { value: unknown[] }).value;

    res.status(202).send('Accepted');

    for (const notification of notifications) {
      await processMicrosoftNotification(notification);
    }
  } catch (error) {
    logger.error(`${MICROSOFT_TAG} Error handling webhook`, {
      error: error instanceof Error ? error.message : String(error),
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
      logger.error(`${MICROSOFT_TAG} Notification missing subscriptionId`);
      return;
    }

    const subscription =
      await MicrosoftCalendarSubscriptionService.findSubscriptionByMsSubscriptionId(subscriptionId);

    if (!subscription) {
      logger.error(`${MICROSOFT_TAG} No subscription found`, { subscriptionId });
      return;
    }

    const creds = parseCalendarCredentials(subscription.credentials);
    if (creds?.clientState && creds.clientState !== clientState) {
      logger.error(`${MICROSOFT_TAG} ClientState mismatch`, {
        subscriptionId,
        expected: creds.clientState.substring(0, 8) + '...',
        received: clientState?.substring(0, 8) + '...',
      });
      return;
    }

    logger.info(`${MICROSOFT_TAG} Processing notification`, {
      subscriptionId,
      sourceId: subscription.id,
      email: subscription.displayName,
      changeType: notification.changeType,
    });

    await microsoftCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
  } catch (error) {
    logger.error(`${MICROSOFT_TAG} Error processing notification`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processMicrosoftLifecycleNotification(
  notification: MicrosoftNotification
): Promise<void> {
  const { subscriptionId, lifecycleEvent } = notification;

  logger.info(`${MICROSOFT_TAG} Lifecycle notification`, {
    subscriptionId,
    lifecycleEvent,
  });

  if (!subscriptionId) return;

  const subscription =
    await MicrosoftCalendarSubscriptionService.findSubscriptionByMsSubscriptionId(subscriptionId);

  if (!subscription) {
    logger.warn(`${MICROSOFT_TAG} Lifecycle notification for unknown subscription`, {
      subscriptionId,
    });
    return;
  }

  logger.info(`${MICROSOFT_TAG} Lifecycle subscription resolved`, {
    subscriptionId,
    sourceId: subscription.id,
    email: subscription.displayName,
    lifecycleEvent,
  });

  switch (lifecycleEvent) {
    case 'reauthorizationRequired':
      try {
        await MicrosoftCalendarSubscriptionService.renewSubscriptionForSource(subscription.id);
        logger.info(`${MICROSOFT_TAG} Subscription reauthorized`, {
          email: subscription.displayName,
        });
      } catch (err) {
        logger.error(`${MICROSOFT_TAG} Failed to reauthorize subscription`, {
          email: subscription.displayName,
          error: err,
        });

        await repositories.externalSources.markCalendarError(subscription.id);
      }
      break;

    case 'subscriptionRemoved':
      logger.warn(`${MICROSOFT_TAG} Subscription removed by system`, {
        email: subscription.displayName,
      });

      await repositories.externalSources.markMicrosoftSubscriptionExpired(subscription.id);

      try {
        await MicrosoftCalendarSubscriptionService.createSubscriptionForSource(subscription.id);
        logger.info(`${MICROSOFT_TAG} Subscription recreated`, { email: subscription.displayName });
      } catch (err) {
        logger.error(`${MICROSOFT_TAG} Failed to recreate subscription`, {
          email: subscription.displayName,
          error: err,
        });
      }
      break;

    case 'missed':
      logger.warn(`${MICROSOFT_TAG} Notifications missed, enqueuing incremental sync`, {
        email: subscription.displayName,
      });
      await microsoftCalendarSyncQueue.enqueueIncrementalSync(subscription.id);
      break;

    default:
      logger.warn(`${MICROSOFT_TAG} Unknown lifecycle event`, { lifecycleEvent });
  }
}

export default router;
