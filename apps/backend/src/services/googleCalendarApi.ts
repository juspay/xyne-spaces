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

/**
 * Thrown when the event no longer exists on Google (404) or was already
 * deleted (410). Callers that mirror a Xyne row onto Calendar treat this as
 * "the remote copy is gone" and either re-create it or drop their stored
 * event id, rather than failing the job forever.
 */
export class GoogleCalendarEventGoneError extends Error {
  constructor(eventId: string) {
    super(`Google Calendar event ${eventId} no longer exists`);
    this.name = 'GoogleCalendarEventGoneError';
  }
}

/** Who Google emails when a write changes an event. */
export type GoogleSendUpdates = 'all' | 'externalOnly' | 'none';

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
 * the conference entry and description block, and by the outbound push to
 * update an event Xyne itself created. Callers own retry-on-conflict
 * decisions; this function only performs the network call and surfaces a
 * typed error for 412 so callers can distinguish "stale etag, re-evaluate
 * once" from other failures.
 *
 * `sendUpdates` defaults to 'none': the reconciler is a background pass, not
 * an organizer-authored change, so it must not email attendees. The outbound
 * push passes 'all' because there the edit *is* the organizer's own.
 */
export async function patchGoogleEvent(
  accessToken: string,
  eventId: string,
  body: Record<string, unknown>,
  options?: { conferenceDataVersion?: boolean; etag?: string; sendUpdates?: GoogleSendUpdates }
): Promise<GCalEvent> {
  // Webhook delivery is unaffected by sendUpdates.
  const params = new URLSearchParams({ sendUpdates: options?.sendUpdates ?? 'none' });
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

  if (res.status === 404 || res.status === 410) {
    throw new GoogleCalendarEventGoneError(eventId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }

  return (await res.json()) as GCalEvent;
}

/**
 * Create a Google Calendar event on the connected user's primary calendar.
 * Used by the outbound push so a call scheduled inside Xyne shows up on the
 * organizer's calendar — and, via `attendees` + `sendUpdates: 'all'`, on every
 * invitee's calendar, including people who never connected Xyne.
 */
export async function insertGoogleEvent(
  accessToken: string,
  body: Record<string, unknown>,
  options?: { sendUpdates?: GoogleSendUpdates }
): Promise<GCalEvent> {
  const params = new URLSearchParams({ sendUpdates: options?.sendUpdates ?? 'all' });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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
 * Delete an event from the connected user's primary calendar. A 404/410 means
 * someone already removed it, which is the state the caller wanted, so it
 * resolves instead of throwing.
 */
export async function deleteGoogleEvent(
  accessToken: string,
  eventId: string,
  options?: { sendUpdates?: GoogleSendUpdates }
): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: options?.sendUpdates ?? 'all' });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (res.ok || res.status === 404 || res.status === 410) return;

  const text = await res.text();
  throw new Error(`Google Calendar API ${res.status}: ${text}`);
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
