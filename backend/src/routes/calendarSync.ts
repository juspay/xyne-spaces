/**
 * Calendar Manual Sync Routes
 *
 * POST /api/calendar/sync/google     — trigger Google Calendar sync for current user
 * POST /api/calendar/sync/microsoft  — trigger Microsoft Calendar sync for current user
 * GET  /api/calendar/sync/provider   — return which calendar provider the current user has
 */

import express from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { syncGoogleCalendarManually } from '@/queues/googleCalendarSyncQueue';
import { syncMicrosoftCalendarManually } from '@/queues/microsoftCalendarSyncQueue';
import { pubSubWatchService } from '@/pubsub';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';

const router = express.Router();

function isCalendarAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient authentication scopes|insufficient.*scope|invalid_grant|unauthorized_client|no active .*session|no active .*calendar/i.test(
    message,
  );
}

function hasCalendarRefreshToken(subscription: { credentials?: string } | null | undefined): boolean {
  if (!subscription?.credentials) return false;
  return !!parseCalendarCredentials(subscription.credentials)?.refreshToken;
}

router.get('/provider', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);

    return res.json({ success: true, provider: user?.authProvider ?? null });
  } catch (err) {
    logger.error('[CALENDAR_SYNC] Failed to get provider:', err);
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

    if (user.authProvider !== 'GOOGLE') {
      return res.status(400).json({ success: false, error: 'User is not authenticated with Google' });
    }

    logger.info(`[CALENDAR_SYNC] Manual Google sync triggered by user ${userId} (${user.email})`);

    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'GOOGLE',
    );

    if (!subscription || !hasCalendarRefreshToken(subscription)) {
      logger.warn(`[CALENDAR_SYNC] Google Calendar reauthorization required: missing calendar credentials`, {
        email: user.email,
      });
      return res.status(401).json({
        success: false,
        error: 'calendar_reauth_required',
        message: 'Google Calendar access needs to be reauthorized',
      });
    }

    const isWatchActive = subscription?.isActive === true && !!subscription.externalIdentifier;

    if (!isWatchActive) {
      logger.info(`[CALENDAR_SYNC] Google Calendar watch not active, setting up watch for ${user.email}`);
      try {
        const watchResult = await pubSubWatchService.setupSubscription('google-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
        logger.info(`[CALENDAR_SYNC] Watch setup complete`, {
          email: user.email,
          channelId: watchResult.id,
          expiration: watchResult.expiration,
        });
      } catch (watchErr) {
        if (isCalendarAuthError(watchErr)) {
          logger.warn(`[CALENDAR_SYNC] Google Calendar reauthorization required`, {
            email: user.email,
            error: watchErr instanceof Error ? watchErr.message : String(watchErr),
          });
          return res.status(401).json({
            success: false,
            error: 'calendar_reauth_required',
            message: 'Google Calendar access needs to be reauthorized',
          });
        }

        logger.warn(`[CALENDAR_SYNC] Watch setup failed, continuing with manual sync only`, {
          email: user.email,
          error: watchErr instanceof Error ? watchErr.message : String(watchErr),
        });
      }
    } else {
      logger.info(`[CALENDAR_SYNC] Google Calendar watch already active for ${user.email}`);
    }

    await syncGoogleCalendarManually(subscription.id);
    return res.json({ success: true, message: 'Google Calendar sync queued successfully' });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_SYNC] Manual Google sync failed for user ${userId}: ${raw}`);
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

    if (user.authProvider !== 'MICROSOFT') {
      return res.status(400).json({ success: false, error: 'User is not authenticated with Microsoft' });
    }

    logger.info(`[CALENDAR_SYNC] Manual Microsoft sync triggered by user ${userId} (${user.email})`);

    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'MICROSOFT',
    );

    if (!subscription || !hasCalendarRefreshToken(subscription)) {
      logger.warn(`[CALENDAR_SYNC] Microsoft Calendar reauthorization required: missing calendar credentials`, {
        email: user.email,
      });
      return res.status(401).json({
        success: false,
        error: 'calendar_reauth_required',
        message: 'Microsoft Calendar access needs to be reauthorized',
      });
    }

    const isSubscriptionActive = subscription?.isActive === true && !!subscription.externalIdentifier;

    if (!isSubscriptionActive) {
      logger.info(`[CALENDAR_SYNC] Microsoft Calendar subscription not active, creating for ${user.email}`);
      try {
        const subResult = await pubSubWatchService.setupSubscription('microsoft-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
        logger.info(`[CALENDAR_SYNC] Subscription created`, {
          email: user.email,
          subscriptionId: subResult.id,
          expiration: subResult.expiration,
        });
      } catch (subErr) {
        if (isCalendarAuthError(subErr)) {
          logger.warn(`[CALENDAR_SYNC] Microsoft Calendar reauthorization required`, {
            email: user.email,
            error: subErr instanceof Error ? subErr.message : String(subErr),
          });
          return res.status(401).json({
            success: false,
            error: 'calendar_reauth_required',
            message: 'Microsoft Calendar access needs to be reauthorized',
          });
        }

        logger.warn(`[CALENDAR_SYNC] Subscription creation failed, continuing with manual sync only`, {
          email: user.email,
          error: subErr instanceof Error ? subErr.message : String(subErr),
        });
      }
    } else {
      logger.info(`[CALENDAR_SYNC] Microsoft Calendar subscription already active for ${user.email}`);
    }

    await syncMicrosoftCalendarManually(subscription.id);
    return res.json({ success: true, message: 'Microsoft Calendar sync queued successfully' });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_SYNC] Manual Microsoft sync failed for user ${userId}: ${raw}`);
    return res.status(500).json({ success: false, error: raw });
  }
});

export default router;
