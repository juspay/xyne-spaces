/**
 * Google Calendar → Calls Store
 *
 * Receives raw GCalEvent objects (already fetched by the sync queue) and
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


// ─── Types ────────────────────────────────────────────────────────────────────

export interface GCalDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GCalAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

export interface GCalEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
  location?: string;
  status?: string;
  htmlLink?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GCalAttendee[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
}

export interface GCalListResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function parseGCalDateTime(dt?: GCalDateTime): Date | undefined {
  if (!dt) return undefined;
  const raw = dt.dateTime ?? dt.date;
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function resolveRoomLink(event: GCalEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink;
  const videoEntry = event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video');
  if (videoEntry?.uri) return videoEntry.uri;
  return event.htmlLink;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function storeGCalEventAsCall(event: GCalEvent, userId: string): Promise<void> {
  if (!event.id) return;

  const now = new Date();
  const externalId = `gcal__${userId}__${event.id}`;
  const startsAt = parseGCalDateTime(event.start);
  const endsAt = parseGCalDateTime(event.end);
  const roomLink = resolveRoomLink(event);
  const status = event.status === 'cancelled' ? CallStatus.CANCELLED : CallStatus.SCHEDULED;
  const organizerEmail = event.organizer?.email;

  const organizer: CalendarOrganizer | null = event.organizer
    ? {
        ...(event.organizer.email !== undefined && { email: event.organizer.email }),
        ...(event.organizer.displayName !== undefined && { displayName: event.organizer.displayName }),
        ...(event.organizer.self !== undefined && { self: event.organizer.self }),
      }
    : null;

  const attendees = (event.attendees ?? []).filter(
    a => !organizerEmail || a.email !== organizerEmail,
  );

  await upsertExternalCalendarCall(
    {
      externalId,
      title: event.summary ?? '(No title)',
      description: event.description
        ? event.description.replace(/<[^>]*>/g, '').slice(0, 2000)
        : undefined,
      createdByUserId: userId,
      callType: roomLink ? CallType.VIDEO : CallType.AUDIO,
      callOrigin: CallOrigin.GOOGLE_CALENDAR,
      status,
      roomLink,
      startsAt,
      endsAt,
      timezone: event.start?.timeZone ?? 'UTC',
      metadata: {
        googleEventId: event.id,
        htmlLink: event.htmlLink ?? null,
        location: event.location ?? null,
        organizer: organizer as Prisma.InputJsonObject | null,
        attendees: attendees as unknown as Prisma.InputJsonArray,
      } satisfies Prisma.InputJsonObject,
    },
    now,
  );
}

export async function storeGCalEventsAsCallsForUser(
  events: GCalEvent[],
  userId: string,
  userEmail: string,
): Promise<void> {
  logger.info(`[GOOGLE_CALENDAR_STORE] Storing ${events.length} event(s) for ${userEmail}`);

  const fetchedExternalIds = new Set(
    events.filter(e => e.id).map(e => `gcal__${userId}__${e.id}`),
  );

  for (const event of events) {
    try {
      await storeGCalEventAsCall(event, userId);
    } catch (err) {
      logger.error(
        `[GOOGLE_CALENDAR_STORE] Failed to store event "${event.summary}" for ${userEmail}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await cancelRemovedExternalCalendarCalls(
    userId,
    CallOrigin.GOOGLE_CALENDAR,
    fetchedExternalIds,
    'GOOGLE_CALENDAR_STORE',
  );
}
