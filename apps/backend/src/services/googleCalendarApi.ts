/**
 * Google Calendar API Client
 *
 * Low-level fetch primitives for Google Calendar API.
 * No sync orchestration — only API calls and response parsing.
 */

import { type GCalEvent, type GCalListResponse } from '@/services/googleCalendarCallStore';
import { logger } from '@/utils/logger';

const TAG = '[CALENDAR_SYNC][GOOGLE][API]';

/** Thrown when a PATCH is rejected due to a stale etag (If-Match precondition failed). */
export class GoogleCalendarPatchConflictError extends Error {
  constructor(eventId: string) {
    super(`Google Calendar PATCH conflict (412) for event ${eventId}`);
    this.name = 'GoogleCalendarPatchConflictError';
  }
}

export async function getGoogleEventById(accessToken: string, eventId: string): Promise<GCalEvent> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }

  return (await res.json()) as GCalEvent;
}

/**
 * PATCH a single Google Calendar event owned by the connected (organizer)
 * user. Used by the Xyne Call Link Auto-Injection reconciler to replace/inject
 * the conference entry and description block. Callers own retry-on-conflict
 * decisions; this function only performs the network call and surfaces a
 * typed error for 412 so callers can distinguish "stale etag, re-evaluate
 * once" from other failures.
 */
export async function patchGoogleEvent(
  accessToken: string,
  eventId: string,
  body: Record<string, unknown>,
  options?: { conferenceDataVersion?: boolean; etag?: string }
): Promise<GCalEvent> {
  // This is a background reconciliation, not an organizer-authored update.
  // Suppress attendee emails; webhook delivery is unaffected by sendUpdates.
  const params = new URLSearchParams({ sendUpdates: 'none' });
  if (options?.conferenceDataVersion) {
    params.set('conferenceDataVersion', '1');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (options?.etag) {
    headers['If-Match'] = options.etag;
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (res.status === 412) {
    throw new GoogleCalendarPatchConflictError(eventId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }

  return (await res.json()) as GCalEvent;
}

interface CalendarFetchResult<TEvent> {
  events: TEvent[];
  truncated: boolean;
}

interface GoogleIncrementalChangesResult {
  events: GCalEvent[];
  nextSyncToken: string | null;
  nextPageToken: string | null;
  needsFullSync: boolean;
}

function googlePageSize(maxEvents?: number): string {
  return String(Math.max(1, Math.min(maxEvents ?? 2500, 2500)));
}

function appendWithLimit<T>(target: T[], items: T[], maxEvents?: number): boolean {
  if (maxEvents === undefined) {
    target.push(...items);
    return false;
  }

  const remaining = maxEvents - target.length;
  if (remaining <= 0) return items.length > 0;

  target.push(...items.slice(0, remaining));
  return items.length > remaining;
}

export async function fetchGoogleEventsInRange(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  maxEvents?: number
): Promise<CalendarFetchResult<GCalEvent>> {
  const events: GCalEvent[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: googlePageSize(maxEvents),
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar API ${res.status}: ${text}`);
    }

    const page = (await res.json()) as GCalListResponse;
    truncated = appendWithLimit(events, page.items ?? [], maxEvents) || truncated;
    pageToken = page.nextPageToken;
    if (maxEvents !== undefined && events.length >= maxEvents && pageToken) {
      truncated = true;
      pageToken = undefined;
    }
  } while (pageToken && !truncated);

  return { events, truncated: truncated || Boolean(pageToken) };
}

export async function fetchGoogleIncrementalChanges(
  accessToken: string,
  syncToken: string,
  options?: { maxEvents?: number; pageToken?: string }
): Promise<GoogleIncrementalChangesResult> {
  const params = new URLSearchParams({
    syncToken,
    singleEvents: 'true',
    maxResults: googlePageSize(options?.maxEvents),
    ...(options?.pageToken ? { pageToken: options.pageToken } : {}),
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (res.status === 410) {
    return { events: [], nextSyncToken: null, nextPageToken: null, needsFullSync: true };
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GCalListResponse & { nextSyncToken?: string };

  return {
    events: (data.items ?? []).slice(0, options?.maxEvents),
    nextSyncToken: data.nextSyncToken ?? null,
    nextPageToken: data.nextPageToken ?? null,
    needsFullSync: false,
  };
}

export async function fetchAllGoogleEventsForBaseline(
  accessToken: string,
  maxEvents?: number
): Promise<{ events: GCalEvent[]; nextSyncToken: string; truncated: boolean }> {
  const events: GCalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let totalEvents = 0;
  let eligibleEvents = 0;
  let truncated = false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1);

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar API ${res.status}: ${text}`);
    }

    const page = (await res.json()) as GCalListResponse & { nextSyncToken?: string };
    const pageItems = page.items ?? [];
    totalEvents += pageItems.length;

    const filtered = pageItems.filter((e) => {
      const start = e.start?.dateTime ?? e.start?.date;
      if (!start) return true;
      return new Date(start) >= cutoff;
    });

    eligibleEvents += filtered.length;
    truncated = appendWithLimit(events, filtered, maxEvents) || truncated;

    if (page.nextSyncToken) {
      nextSyncToken = page.nextSyncToken;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  if (!nextSyncToken) {
    throw new Error('No nextSyncToken in full sync response');
  }

  logger.info(
    `${TAG} Baseline fetch: ${totalEvents} total, ${eligibleEvents} after time filter, ${events.length} selected`
  );

  return { events, nextSyncToken, truncated };
}
