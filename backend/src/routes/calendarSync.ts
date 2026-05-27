/**
 * Calendar Manual Sync Routes
 *
 * POST /api/calendar/sync/google     — trigger Google Calendar sync for current user
 * POST /api/calendar/sync/microsoft  — trigger Microsoft Calendar sync for current user
 * GET  /api/calendar/sync/provider   — return which calendar provider the current user has
 */

import express from 'express';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { syncGoogleCalendarForUser } from '@/queues/googleCalendarSyncQueue';
import { syncMicrosoftCalendarForUser } from '@/queues/microsoftCalendarSyncQueue';

const router = express.Router();
const prisma = DatabaseClient.getInstance();

// GET /provider — returns the auth provider for the current user
router.get('/provider', async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { authProvider: true },
    });

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
    logger.info(`[CALENDAR_SYNC] Manual Google sync triggered by user ${userId}`);
    await syncGoogleCalendarForUser(userId);
    return res.json({ success: true, message: 'Google Calendar synced successfully' });
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
    logger.info(`[CALENDAR_SYNC] Manual Microsoft sync triggered by user ${userId}`);
    await syncMicrosoftCalendarForUser(userId);
    return res.json({ success: true, message: 'Microsoft Calendar synced successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[CALENDAR_SYNC] Manual Microsoft sync failed for user ${userId}: ${message}`);
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
