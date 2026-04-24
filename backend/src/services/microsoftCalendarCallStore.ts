/**
 * Microsoft Calendar → Calls Store
 *
 * Receives raw MSCalEvent objects (already fetched by the sync queue) and
 * upserts them into the `calls` table so they are visible in the calendar view.
 * No CallParticipant rows are created — attendees are stored in metadata
 * and shown directly in the UI.
 */

import { logger } from '@/utils/logger';
import { CallOrigin, CallStatus, CallType, type Prisma } from '@prisma/client';
import {
  upsertExternalCalendarCall,
  cancelRemovedExternalCalendarCalls,
  type CalendarOrganizer,
} from './calendarCallStore.utils';

// ─── Types (re-exported so the queue file doesn't need its own copies) ────────

export interface MSCalAttendee {
  emailAddress?: { name?: string; address?: string };
  type?: string;
  status?: { response?: string; time?: string };
}

export interface MSCalDateTime {
  dateTime?: string;
  timeZone?: string;
}

export interface MSCalEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: MSCalDateTime;
  end?: MSCalDateTime;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: MSCalAttendee[];
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeetingUrl?: string;
  onlineMeeting?: { joinUrl?: string };
  webLink?: string;
}

export interface MSCalListResponse {
  value: MSCalEvent[];
  '@odata.nextLink'?: string;
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function parseMSCalDateTime(dt?: MSCalDateTime): Date | undefined {
  if (!dt?.dateTime) return undefined;
  // Graph API returns datetime without timezone suffix (e.g. "2026-04-21T10:30:00.0000000")
  // even when Prefer: UTC is sent. Append 'Z' to force UTC parsing since we always
  // request UTC from the API.
  const raw = /[Z+\-]\d*$/.test(dt.dateTime) ? dt.dateTime : dt.dateTime + 'Z';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function resolveRoomLink(event: MSCalEvent): string | undefined {
  // Prefer onlineMeeting.joinUrl (Teams), fall back to deprecated onlineMeetingUrl
  if (event.isOnlineMeeting) {
    const joinUrl = event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl;
    if (joinUrl) return joinUrl;
  }
  return event.webLink;
}

/**
 * Normalise an MS Graph attendee response to the Google Calendar responseStatus
 * vocabulary so the UI can render it consistently.
 */
function mapMsResponse(response?: string): string {
  switch (response) {
    case 'accepted':
    case 'organizer':
      return 'accepted';
    case 'tentativelyAccepted':
      return 'tentative';
    case 'declined':
      return 'declined';
    default:
      return 'needsAction';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function storeMsCalEventAsCall(
  event: MSCalEvent,
  userId: string,
): Promise<void> {
  const externalId = `mscal__${userId}__${event.id}`;
  const now = new Date();

  const startsAt = parseMSCalDateTime(event.start);
  const endsAt = parseMSCalDateTime(event.end);
  const timezone = event.start?.timeZone ?? 'UTC';
  const status = event.isCancelled ? CallStatus.CANCELLED : CallStatus.SCHEDULED;
  const roomLink = resolveRoomLink(event);
  const callType = event.isOnlineMeeting ? CallType.VIDEO : CallType.AUDIO;

  const organizerEmail = event.organizer?.emailAddress?.address;

  // Normalize attendees to the shared format, filtering out the organizer
  const attendees = (event.attendees ?? [])
    .filter(a => !organizerEmail || a.emailAddress?.address !== organizerEmail)
    .map(a => ({
      email: a.emailAddress?.address,
      displayName: a.emailAddress?.name,
      responseStatus: mapMsResponse(a.status?.response),
    }));

  const organizer: CalendarOrganizer | null = event.organizer?.emailAddress
    ? {
        ...(event.organizer.emailAddress.address !== undefined && { email: event.organizer.emailAddress.address }),
        ...(event.organizer.emailAddress.name !== undefined && { displayName: event.organizer.emailAddress.name }),
      }
    : null;

  await upsertExternalCalendarCall(
    {
      externalId,
      title: event.subject ?? '(No title)',
      description: event.bodyPreview?.slice(0, 2000) ?? undefined,
      createdByUserId: userId,
      callType,
      callOrigin: CallOrigin.MICROSOFT_CALENDAR,
      status,
      roomLink,
      startsAt,
      endsAt,
      timezone,
      metadata: {
        microsoftEventId: event.id,
        htmlLink: event.webLink ?? null,
        location: event.location?.displayName ?? null,
        organizer: organizer as Prisma.InputJsonObject | null,
        attendees: attendees as unknown as Prisma.InputJsonArray,
      } satisfies Prisma.InputJsonObject,
    },
    now,
  );
}

export async function storeMsCalEventsAsCallsForUser(
  events: MSCalEvent[],
  userId: string,
  userEmail: string,
): Promise<void> {
  logger.info(`[MICROSOFT_CALENDAR_STORE] Storing ${events.length} event(s) for ${userEmail}`);

  const fetchedExternalIds = new Set(
    events.map(e => `mscal__${userId}__${e.id}`),
  );

  for (const event of events) {
    try {
      await storeMsCalEventAsCall(event, userId);
    } catch (err) {
      logger.error(
        `[MICROSOFT_CALENDAR_STORE] Failed to store event "${event.subject}" for ${userEmail}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await cancelRemovedExternalCalendarCalls(
    userId,
    CallOrigin.MICROSOFT_CALENDAR,
    fetchedExternalIds,
    'MICROSOFT_CALENDAR_STORE',
  );
}
