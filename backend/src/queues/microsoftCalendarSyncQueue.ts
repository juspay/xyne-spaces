/**
 * Microsoft Calendar Sync Queue
 *
 * Bull cron job that runs every 5 minutes (configurable via MICROSOFT_CALENDAR_SYNC_CRON).
 * For every user who logged in via Microsoft SSO and has an active session with a refresh
 * token, it:
 *  1. Refreshes the access token if it is within 5 minutes of expiry.
 *  2. Calls the Microsoft Graph calendarView API to fetch events for the next 30 days.
 *  3. Writes the events to a .txt file on disk (one file per user).
 *
 * NOTE: Calendar access requires the Calendars.Read scope which was added to the Microsoft
 * SSO flow. Users who logged in before this change will need to log in again to grant the
 * new scope.
 */

import Bull from 'bull';
import { redisService } from '@/services/redisService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { AuthProvider } from '@prisma/client';
import { storeMsCalEventsAsCallsForUser, type MSCalEvent, type MSCalListResponse } from '@/services/microsoftCalendarCallStore';

const MICROSOFT_CALENDAR_SYNC_CRON =
  process.env.MICROSOFT_CALENDAR_SYNC_CRON || '*/5 * * * *';

const LOOKAHEAD_DAYS = 30;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const prisma = DatabaseClient.getInstance();

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshMicrosoftToken(
  refreshToken: string,
): Promise<{ accessToken: string; accessTokenExpiry: Date }> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  if (!clientId || !clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required');
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'openid email profile User.Read Calendars.Read offline_access',
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token refresh failed: ${res.status} ${text}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: tokens.access_token,
    accessTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
  };
}

// ─── Calendar fetch ───────────────────────────────────────────────────────────

async function fetchCalendarEvents(accessToken: string): Promise<MSCalEvent[]> {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + LOOKAHEAD_DAYS);

  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: future.toISOString(),
    $select:
      'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,webLink',
    $orderby: 'start/dateTime',
    $top: '100',
  });

  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;

  const events: MSCalEvent[] = [];

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="UTC"',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph calendarView ${res.status}: ${text}`);
    }

    const page = (await res.json()) as MSCalListResponse;
    events.push(...(page.value ?? []));
    url = page['@odata.nextLink'];
  }

  return events;
}

// ─── Per-user sync ────────────────────────────────────────────────────────────

interface SessionData {
  id: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiry: Date | null;
  user: { id: string; email: string };
}

async function syncUserCalendar(session: SessionData): Promise<void> {
  const { id: sessionId, user } = session;

  let accessToken = session.accessToken;
  let needsUpdate = false;

  const isExpired =
    !accessToken ||
    !session.accessTokenExpiry ||
    new Date(session.accessTokenExpiry).getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

  if (isExpired) {
    const refreshed = await refreshMicrosoftToken(session.refreshToken);
    accessToken = refreshed.accessToken;
    needsUpdate = true;

    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        accessToken: refreshed.accessToken,
        accessTokenExpiry: refreshed.accessTokenExpiry,
      },
    });
  }

  if (!accessToken) {
    throw new Error(`No access token available for session ${sessionId}`);
  }

  const events = await fetchCalendarEvents(accessToken);

  logger.info(
    `[MICROSOFT_CALENDAR] User ${user.email}: ${events.length} event(s) fetched${needsUpdate ? ' (token refreshed)' : ''}`,
  );

  await storeMsCalEventsAsCallsForUser(events, user.id, user.email);
}

// ─── Scan all Microsoft users ─────────────────────────────────────────────────

async function syncAllMicrosoftCalendars(): Promise<void> {
  const sessions = await prisma.userSession.findMany({
    where: {
      status: 'ACTIVE',
      user: { authProvider: AuthProvider.MICROSOFT },
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

  logger.info(`[MICROSOFT_CALENDAR] Polling ${uniqueSessions.length} Microsoft session(s)`);

  for (const session of uniqueSessions) {
    try {
      await syncUserCalendar(session);
    } catch (err) {
      logger.error(
        `[MICROSOFT_CALENDAR] Failed for user ${session.user.email}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// ─── Queue setup ──────────────────────────────────────────────────────────────

class MicrosoftCalendarSyncQueue {
  private queue: Bull.Queue | null = null;
  private workerInitialized = false;

  private async ensureQueue(): Promise<Bull.Queue> {
    if (this.queue) return this.queue;

    this.queue = new Bull('microsoft-calendar-sync', {
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
      await syncAllMicrosoftCalendars();
    });

    queue.on('failed', (job, err) => {
      logger.error('[MICROSOFT_CALENDAR] Job failed', {
        jobName: job.name,
        jobId: job.id,
        error: err.message,
      });
    });

    queue.on('error', err => {
      logger.error('[MICROSOFT_CALENDAR] Queue error:', err);
    });

    // Remove stale repeatable, then re-register
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'sync-all') {
        await queue.removeRepeatableByKey(job.key);
      }
    }

    // TODO: cron disabled — re-enable in dedicated PR
    // await queue.add(
    //   'sync-all',
    //   {},
    //   {
    //     repeat: { cron: MICROSOFT_CALENDAR_SYNC_CRON },
    //     jobId: 'microsoft-calendar-scan-repeatable',
    //   },
    // );

    this.workerInitialized = true;
    logger.info(
      `[MICROSOFT_CALENDAR] Sync queue initialized (${MICROSOFT_CALENDAR_SYNC_CRON})`,
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

export const microsoftCalendarSyncQueue = new MicrosoftCalendarSyncQueue();

/**
 * Manually trigger a Microsoft Calendar sync for a single user.
 * Exposed for use by the manual-sync API endpoint.
 */
export async function syncMicrosoftCalendarForUser(userId: string): Promise<void> {
  const session = await prisma.userSession.findFirst({
    where: {
      status: 'ACTIVE',
      user: { id: userId, authProvider: AuthProvider.MICROSOFT },
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
    throw new Error(`No active Microsoft session found for user ${userId}`);
  }

  await syncUserCalendar(session);
}
