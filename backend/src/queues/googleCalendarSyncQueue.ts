/**
 * Google Calendar Sync Queue
 *
 * Bull cron job that runs every minute (configurable via GOOGLE_CALENDAR_SYNC_CRON).
 * For every active Google SSO UserSession it:
 *  1. Refreshes the access token if needed.
 *  2. Calls the Google Calendar API to fetch events for the next 30 days.
 *  3. Hands the raw events off to googleCalendarCallStore to persist them.
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { AuthProvider } from '@prisma/client';
import { storeGCalEventsAsCallsForUser, type GCalEvent, type GCalListResponse } from '@/services/googleCalendarCallStore';

const prisma = DatabaseClient.getInstance();

const GOOGLE_CALENDAR_SYNC_CRON =
  process.env.GOOGLE_CALENDAR_SYNC_CRON || '*/5 * * * *';

const LOOKAHEAD_DAYS = 30;

// ─── Calendar fetch ───────────────────────────────────────────────────────────

async function fetchGoogleCalendarEvents(accessToken: string): Promise<GCalEvent[]> {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + LOOKAHEAD_DAYS);

  const events: GCalEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar API ${res.status}: ${text}`);
    }

    const page = (await res.json()) as GCalListResponse;
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return events;
}

// ─── Token refresh ────────────────────────────────────────────────────────────

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ accessToken: string; accessTokenExpiry: Date }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }

  const tokens = (await res.json()) as { access_token: string; expires_in: number };

  return {
    accessToken: tokens.access_token,
    accessTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
  };
}

// ─── Per-session sync ─────────────────────────────────────────────────────────

interface GoogleSessionData {
  id: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiry: Date | null;
  user: { id: string; email: string };
}

async function syncSessionCalendar(session: GoogleSessionData): Promise<void> {
  let accessToken = session.accessToken;

  const isExpired =
    !accessToken ||
    !session.accessTokenExpiry ||
    new Date(session.accessTokenExpiry).getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

  if (isExpired) {
    const refreshed = await refreshGoogleToken(session.refreshToken);
    accessToken = refreshed.accessToken;

    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        accessToken: refreshed.accessToken,
        accessTokenExpiry: refreshed.accessTokenExpiry,
      },
    });
  }

  if (!accessToken) {
    throw new Error(`No access token available for session ${session.id}`);
  }

  const events = await fetchGoogleCalendarEvents(accessToken);

  logger.info(
    `[GOOGLE_CALENDAR] User ${session.user.email}: ${events.length} event(s) fetched`,
  );

  // Hand off to the store — all DB logic lives there
  await storeGCalEventsAsCallsForUser(events, session.user.id, session.user.email);
}

async function syncAllGoogleSsoCalendars(): Promise<void> {
  const sessions = await prisma.userSession.findMany({
    where: {
      status: 'ACTIVE',
      user: { authProvider: AuthProvider.GOOGLE },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      accessToken: true,
      accessTokenExpiry: true,
      refreshToken: true,
      user: { select: { id: true, email: true } },
    },
  });

  // Deduplicate: keep only the newest session per user
  const latestByUser = new Map<string, typeof sessions[number]>();
  for (const session of sessions) {
    if (!latestByUser.has(session.user.id)) {
      latestByUser.set(session.user.id, session);
    }
  }
  const uniqueSessions = Array.from(latestByUser.values());

  logger.info(`[GOOGLE_CALENDAR] Polling ${uniqueSessions.length} Google SSO session(s)`);

  for (const session of uniqueSessions) {
    try {
      await syncSessionCalendar(session);
    } catch (err) {
      logger.error(
        `[GOOGLE_CALENDAR] Failed for user ${session.user.email}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// ─── Queue setup ──────────────────────────────────────────────────────────────

class GoogleCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('google-calendar-sync', {
      redis: {
        ...redisService.getRedisConfig(),
        lazyConnect: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    return this.queue;
  }

  async initialize(): Promise<void> {
    const queue = await this.ensureQueue();
    if (this.workerInitialized) return;

    queue.process('sync-all', async () => {
      await syncAllGoogleSsoCalendars();
    });

    queue.on('failed', (job, err) => {
      logger.error('[GOOGLE_CALENDAR] Job failed', {
        jobName: job.name,
        jobId: job.id,
        error: err.message,
      });
    });

    queue.on('error', err => {
      logger.error('[GOOGLE_CALENDAR] Queue error:', err);
    });

    // Remove stale repeatable, then re-register
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'sync-all') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    await queue.add(
      'sync-all',
      {},
      {
        repeat: { cron: GOOGLE_CALENDAR_SYNC_CRON },
        jobId: 'google-calendar-scan-repeatable',
      },
    );

    this.workerInitialized = true;
    logger.info(
      `[GOOGLE_CALENDAR] Sync queue initialized (${GOOGLE_CALENDAR_SYNC_CRON})`,
    );
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.workerInitialized = false;
  }
}

export const googleCalendarSyncQueue = new GoogleCalendarSyncQueue();

/**
 * Manually trigger a Google Calendar sync for a single user.
 * Exposed for use by the manual-sync API endpoint.
 */
export async function syncGoogleCalendarForUser(userId: string): Promise<void> {
  const session = await prisma.userSession.findFirst({
    where: {
      status: 'ACTIVE',
      user: { id: userId, authProvider: AuthProvider.GOOGLE },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      accessToken: true,
      accessTokenExpiry: true,
      refreshToken: true,
      user: { select: { id: true, email: true } },
    },
  });

  if (!session) {
    throw new Error(`No active Google session found for user ${userId}`);
  }

  await syncSessionCalendar(session);
}
