/**
 * Microsoft Graph Calendar API Client
 *
 * Low-level fetch primitives for Microsoft Graph Calendar API.
 * No sync orchestration — only API calls and response parsing.
 */

import { type MSCalEvent, type MSCalListResponse } from '@/services/microsoftCalendarCallStore';

const GRAPH_SELECT = 'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,webLink';

interface CalendarFetchResult<TEvent> {
  events: TEvent[];
  truncated: boolean;
}

interface MicrosoftDeltaChangesResult {
  events: MSCalEvent[];
  newDeltaLink: string | null;
  nextLink: string | null;
  needsFullSync: boolean;
}

function graphPageSize(maxEvents?: number): string {
  return String(Math.max(1, Math.min(maxEvents ?? 100, 100)));
}

function graphPreferHeader(maxEvents?: number): string {
  return `odata.maxpagesize=${graphPageSize(maxEvents)}, outlook.timezone="UTC"`;
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

export async function fetchMicrosoftEventsInRange(
  accessToken: string,
  startDateTime: Date,
  endDateTime: Date,
  maxEvents?: number,
): Promise<CalendarFetchResult<MSCalEvent>> {
  const params = new URLSearchParams({
    startDateTime: startDateTime.toISOString(),
    endDateTime: endDateTime.toISOString(),
    $select: GRAPH_SELECT,
    $orderby: 'start/dateTime',
    $top: graphPageSize(maxEvents),
  });

  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;

  const events: MSCalEvent[] = [];
  let truncated = false;

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
    truncated = appendWithLimit(events, page.value ?? [], maxEvents) || truncated;
    url = page['@odata.nextLink'];
    if (maxEvents !== undefined && events.length >= maxEvents && url) {
      truncated = true;
      url = undefined;
    }
    if (truncated) break;
  }

  return { events, truncated: truncated || Boolean(url) };
}

export async function fetchMicrosoftDeltaChanges(
  accessToken: string,
  deltaLink: string,
  maxEvents?: number,
): Promise<MicrosoftDeltaChangesResult> {
  const res = await fetch(deltaLink, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: graphPreferHeader(maxEvents),
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 410) {
    return { events: [], newDeltaLink: null, nextLink: null, needsFullSync: true };
  }

  if (!res.ok) {
    const text = await res.text();
    if (text.includes('syncState') || text.includes('resync')) {
      return { events: [], newDeltaLink: null, nextLink: null, needsFullSync: true };
    }
    throw new Error(`Graph delta query ${res.status}: ${text}`);
  }

  const page = (await res.json()) as MSCalListResponse & { '@odata.deltaLink'?: string; '@odata.nextLink'?: string };
  const events = (page.value ?? []).slice(0, maxEvents);

  if (page['@odata.deltaLink']) {
    return {
      events,
      newDeltaLink: page['@odata.deltaLink'],
      nextLink: null,
      needsFullSync: false,
    };
  }

  if (page['@odata.nextLink']) {
    return {
      events,
      newDeltaLink: null,
      nextLink: page['@odata.nextLink'],
      needsFullSync: false,
    };
  }

  return { events: [], newDeltaLink: null, nextLink: null, needsFullSync: true };
}

export async function fetchAllMicrosoftEventsForBaseline(
  accessToken: string,
  lookaheadDays: number,
  maxEvents?: number,
): Promise<{ events: MSCalEvent[]; deltaLink: string; truncated: boolean }> {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + lookaheadDays);

  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: future.toISOString(),
    $select: GRAPH_SELECT,
  });

  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendarView/delta?${params.toString()}`;
  const events: MSCalEvent[] = [];
  let truncated = false;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: graphPreferHeader(maxEvents),
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph delta query ${res.status}: ${text}`);
    }

    const page = (await res.json()) as MSCalListResponse & { '@odata.deltaLink'?: string; '@odata.nextLink'?: string };
    truncated = appendWithLimit(events, page.value ?? [], maxEvents) || truncated;

    if (page['@odata.deltaLink']) {
      return { events, deltaLink: page['@odata.deltaLink'], truncated };
    }

    url = page['@odata.nextLink'];
  }

  throw new Error('No deltaLink returned from initial delta query');
}
