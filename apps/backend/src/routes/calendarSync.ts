/**
 * Calendar Manual Sync Routes
 *
 * POST /api/calendar/sync/google     — queue a Google Calendar sync for current user
 * POST /api/calendar/sync/microsoft  — queue a Microsoft Calendar sync for current user
 * GET  /api/calendar/sync/provider   — return which calendar provider the current user has
 *
 * These endpoints only enqueue. Every write into the calls table happens in the
 * worker process, never here — see ENABLE_CALENDAR_SYNC_WORKER. That is what keeps
 * an environment whose API is deployed but whose worker is not (pre-prod) from
 * creating calendar rows of its own and colliding on the unique index once data
 * moves between environments.
 */

import express, { type Response } from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { enqueueGoogleCalendarManualSync } from '@/queues/googleCalendarSyncQueue';
import { enqueueMicrosoftCalendarManualSync } from '@/queues/microsoftCalendarSyncQueue';
import { pubSubWatchService } from '@/pubsub';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';
import { AuthProvider } from '@xyne/shared';

const router = express.Router();

function isCalendarAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient authentication scopes|insufficient.*scope|invalid_grant|unauthorized_client|no active .*session|no active .*calendar/i.test(
    message
  );
}

function hasCalendarRefreshToken(
  subscription: { credentials?: string } | null | undefined
): boolean {
  if (!subscription?.credentials) return false;
  return !!parseCalendarCredentials(subscription.credentials)?.refreshToken;
}

function sendCalendarReauthorizationError(res: Response, provider: 'Google' | 'Microsoft') {
  return res.status(500).json({
    success: false,
    error: 'calendar_reauth_required',
    message: `${provider} Calendar access needs to be reauthorized`,
  });
}

router.get('/provider', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);

    return res.json({ success: true, provider: user?.authProvider ?? null });
  } catch (err) {
    logger.error('[CALENDAR_SYNC][ROUTE] Failed to get provider:', err);
    return res.status(500).json({ success: false, error: 'Failed to determine calendar provider' });
  }
});

// POST /google — manually sync Google Calendar for the current user
router.post('/google', async (req, res) => {
  const userId = req.user!.id;
  try {
    const user = await repositories.users.findById(userId);
    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    if (user.authProvider !== AuthProvider.GOOGLE) {
      return res
        .status(400)
        .json({ success: false, error: 'User is not authenticated with Google' });
    }

    logger.info(
      `[CALENDAR_SYNC][GOOGLE][ROUTE] Manual sync triggered by user ${userId} (${user.email})`
    );

    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'GOOGLE'
    );

    if (!subscription || !hasCalendarRefreshToken(subscription)) {
      logger.warn(
        `[CALENDAR_SYNC][GOOGLE][ROUTE] Reauthorization required: missing calendar credentials`,
        {
          email: user.email,
        }
      );
      return sendCalendarReauthorizationError(res, 'Google');
    }

    const isWatchActive = subscription?.isActive === true && !!subscription.externalIdentifier;

    if (!isWatchActive) {
      logger.info(
        `[CALENDAR_SYNC][GOOGLE][ROUTE] Watch not active, setting up watch for ${user.email}`
      );
      try {
        const watchResult = await pubSubWatchService.setupSubscription('google-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
        logger.info(`[CALENDAR_SYNC][GOOGLE][ROUTE] Watch setup complete`, {
          email: user.email,
          channelId: watchResult.id,
          expiration: watchResult.expiration,
        });
      } catch (watchErr) {
        if (isCalendarAuthError(watchErr)) {
          logger.warn(`[CALENDAR_SYNC][GOOGLE][ROUTE] Reauthorization required`, {
            email: user.email,
            error: watchErr instanceof Error ? watchErr.message : String(watchErr),
          });
          return sendCalendarReauthorizationError(res, 'Google');
        }

        logger.warn(
          `[CALENDAR_SYNC][GOOGLE][ROUTE] Watch setup failed, continuing with manual sync only`,
          {
            email: user.email,
            error: watchErr instanceof Error ? watchErr.message : String(watchErr),
          }
        );
      }
    } else {
      logger.info(`[CALENDAR_SYNC][GOOGLE][ROUTE] Watch already active for ${user.email}`);
    }

    await enqueueGoogleCalendarManualSync(subscription.id);
    logger.info(`[CALENDAR_SYNC][GOOGLE][ROUTE] Manual sync queued`, {
      sourceId: subscription.id,
      userId,
      email: user.email,
    });
    return res.json({ success: true, message: 'Google Calendar sync started' });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_SYNC][GOOGLE][ROUTE] Manual sync failed for user ${userId}: ${raw}`);
    return res.status(500).json({ success: false, error: raw });
  }
});

// POST /microsoft — manually sync Microsoft Calendar for the current user
router.post('/microsoft', async (req, res) => {
  const userId = req.user!.id;
  try {
    const user = await repositories.users.findById(userId);
    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    if (user.authProvider !== AuthProvider.MICROSOFT) {
      return res
        .status(400)
        .json({ success: false, error: 'User is not authenticated with Microsoft' });
    }

    logger.info(
      `[CALENDAR_SYNC][MICROSOFT][ROUTE] Manual sync triggered by user ${userId} (${user.email})`
    );

    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'MICROSOFT'
    );

    if (!subscription || !hasCalendarRefreshToken(subscription)) {
      logger.warn(
        `[CALENDAR_SYNC][MICROSOFT][ROUTE] Reauthorization required: missing calendar credentials`,
        {
          email: user.email,
        }
      );
      return sendCalendarReauthorizationError(res, 'Microsoft');
    }

    const isSubscriptionActive =
      subscription?.isActive === true && !!subscription.externalIdentifier;

    if (!isSubscriptionActive) {
      logger.info(
        `[CALENDAR_SYNC][MICROSOFT][ROUTE] Subscription not active, creating for ${user.email}`
      );
      try {
        const subResult = await pubSubWatchService.setupSubscription('microsoft-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
        logger.info(`[CALENDAR_SYNC][MICROSOFT][ROUTE] Subscription created`, {
          email: user.email,
          subscriptionId: subResult.id,
          expiration: subResult.expiration,
        });
      } catch (subErr) {
        if (isCalendarAuthError(subErr)) {
          logger.warn(`[CALENDAR_SYNC][MICROSOFT][ROUTE] Reauthorization required`, {
            email: user.email,
            error: subErr instanceof Error ? subErr.message : String(subErr),
          });
          return sendCalendarReauthorizationError(res, 'Microsoft');
        }

        logger.warn(
          `[CALENDAR_SYNC][MICROSOFT][ROUTE] Subscription creation failed, continuing with manual sync only`,
          {
            email: user.email,
            error: subErr instanceof Error ? subErr.message : String(subErr),
          }
        );
      }
    } else {
      logger.info(
        `[CALENDAR_SYNC][MICROSOFT][ROUTE] Subscription already active for ${user.email}`
      );
    }

    await enqueueMicrosoftCalendarManualSync(subscription.id);
    logger.info(`[CALENDAR_SYNC][MICROSOFT][ROUTE] Manual sync queued`, {
      sourceId: subscription.id,
      userId,
      email: user.email,
    });
    return res.json({ success: true, message: 'Microsoft Calendar sync started' });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_SYNC][MICROSOFT][ROUTE] Manual sync failed for user ${userId}: ${raw}`);
    return res.status(500).json({ success: false, error: raw });
  }
});

export default router;
