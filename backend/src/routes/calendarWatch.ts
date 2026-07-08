/**
 * Calendar Watch Setup Routes
 *
 * POST /api/calendar/watch/google      — Setup Google Calendar push watch
 * POST /api/calendar/watch/microsoft   — Setup Microsoft Calendar push subscription
 * GET  /api/calendar/watch/status      — Check if calendar watch is active
 * DELETE /api/calendar/watch/:provider — Stop calendar watch
 */

import express from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';
import { pubSubWatchService } from '@/pubsub';
import { syncGoogleCalendarManually } from '@/queues/googleCalendarSyncQueue';
import { syncMicrosoftCalendarManually } from '@/queues/microsoftCalendarSyncQueue';

const router = express.Router();

type CalendarProvider = 'GOOGLE' | 'MICROSOFT';

function mapAuthProviderToCalendar(provider: string | undefined): CalendarProvider | null {
  if (provider === 'GOOGLE') return 'GOOGLE';
  if (provider === 'MICROSOFT') return 'MICROSOFT';
  return null;
}

// GET /status — Check if calendar watch is active for current user
router.get('/status', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);

    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    const provider = mapAuthProviderToCalendar(user.authProvider);

    if (!provider) {
      return res.json({
        success: true,
        isActive: false,
        message: 'User has no calendar-capable provider connected'
      });
    }

    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      provider,
    );

    const creds = subscription ? parseCalendarCredentials(subscription.credentials) : null;
    const isActive = subscription?.isActive === true && !!subscription.externalIdentifier;

    return res.json({
      success: true,
      isActive,
      provider: user.authProvider,
      expiresAt: creds?.expiration ? new Date(creds.expiration) : null,
    });
  } catch (err) {
    logger.error('[CALENDAR_WATCH] Failed to get watch status:', err);
    return res.status(500).json({ success: false, error: 'Failed to get watch status' });
  }
});

// POST /google — Setup Google Calendar watch
router.post('/google', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);

    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    if (user.authProvider !== 'GOOGLE') {
      return res.status(400).json({
        success: false,
        error: 'User is not authenticated with Google'
      });
    }

    logger.info(`[CALENDAR_WATCH] Setting up Google Calendar watch for ${user.email}`);
    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'GOOGLE',
    );
    if (!subscription) {
      return res.status(401).json({
        success: false,
        error: 'calendar_reauth_required',
        message: 'Google Calendar access needs to be reauthorized',
      });
    }

    const result = await pubSubWatchService.setupSubscription('google-calendar', {
      id: subscription.id,
      email: subscription.displayName,
    });

    logger.info(`[CALENDAR_WATCH] Google Calendar watch active, triggering initial sync`, {
      email: user.email,
      channelId: result.id,
      expiration: result.expiration,
    });

    await syncGoogleCalendarManually(subscription.id);

    return res.json({
      success: true,
      message: 'Google Calendar watch setup successfully. Initial sync queued.',
      expiresAt: result.expiration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_WATCH] Google Calendar watch setup failed: ${message}`);
    return res.status(500).json({ success: false, error: message });
  }
});

// POST /microsoft — Setup Microsoft Calendar subscription
router.post('/microsoft', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);

    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    if (user.authProvider !== 'MICROSOFT') {
      return res.status(400).json({
        success: false,
        error: 'User is not authenticated with Microsoft'
      });
    }

    logger.info(`[CALENDAR_WATCH] Setting up Microsoft Calendar subscription for ${user.email}`);
    const subscription = await repositories.externalSources.findCalendarSourceByOwner(
      userId,
      'MICROSOFT',
    );
    if (!subscription) {
      return res.status(401).json({
        success: false,
        error: 'calendar_reauth_required',
        message: 'Microsoft Calendar access needs to be reauthorized',
      });
    }

    const result = await pubSubWatchService.setupSubscription('microsoft-calendar', {
      id: subscription.id,
      email: subscription.displayName,
    });

    logger.info(`[CALENDAR_WATCH] Microsoft Calendar subscription active, triggering initial sync`, {
      email: user.email,
      subscriptionId: result.id,
      expiration: result.expiration,
    });

    await syncMicrosoftCalendarManually(subscription.id);

    return res.json({
      success: true,
      message: 'Microsoft Calendar subscription setup successfully. Initial sync queued.',
      expiresAt: result.expiration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_WATCH] Microsoft Calendar subscription setup failed: ${message}`);
    return res.status(500).json({ success: false, error: message });
  }
});

// DELETE /:provider — Stop calendar watch
router.delete('/:provider', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await repositories.users.findById(userId);
    const provider = req.params.provider;

    if (!user?.email) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    if (provider === 'google') {
      const subscription = await repositories.externalSources.findCalendarSourceByOwner(
        userId,
        'GOOGLE',
      );
      if (subscription) {
        await pubSubWatchService.stopSubscription('google-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
      }
      logger.info(`[CALENDAR_WATCH] Google Calendar watch stopped for ${user.email}`);
    } else if (provider === 'microsoft') {
      const subscription = await repositories.externalSources.findCalendarSourceByOwner(
        userId,
        'MICROSOFT',
      );
      if (subscription) {
        await pubSubWatchService.stopSubscription('microsoft-calendar', {
          id: subscription.id,
          email: subscription.displayName,
        });
      }
      logger.info(`[CALENDAR_WATCH] Microsoft Calendar subscription deleted for ${user.email}`);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid provider' });
    }

    return res.json({ success: true, message: `Calendar ${provider} watch stopped` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_WATCH] Failed to stop ${req.params.provider} watch: ${message}`);
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
