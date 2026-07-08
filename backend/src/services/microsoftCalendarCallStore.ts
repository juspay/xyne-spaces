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
import { repositories } from '@/database/repositories';
import { MAX_CALENDAR_EVENTS_PER_SYNC } from '@/services/calendarSyncConfig';
import {
  buildCalendarExternalId,
  buildCalendarExternalIdPrefix,
  normalizeCalendarOwnerEmail,
  upsertExternalCalendarCall,
  cancelRemovedExternalCalendarCalls,
  type CalendarOrganizer,
  type CalendarSyncTimeRange,
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
  '@removed'?: { reason: 'deleted' | 'changed' };
}

export interface MSCalListResponse {
  value: MSCalEvent[];
  '@odata.nextLink'?: string;
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function parseMSCalDateTime(dt?: MSCalDateTime): Date | undefined {
  if (!dt?.dateTime) return undefined;
  const raw = /[Z+\-]\d*$/.test(dt.dateTime) ? dt.dateTime : dt.dateTime + 'Z';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function resolveRoomLink(event: MSCalEvent): string | undefined {
  if (event.isOnlineMeeting) {
    const joinUrl = event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl;
    if (joinUrl) return joinUrl;
  }
  return event.webLink;
}

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
  userEmail: string,
): Promise<void> {
  const calendarOwnerEmail = normalizeCalendarOwnerEmail(userEmail);
  const externalId = buildCalendarExternalId('microsoft', userId, event.id);
  const now = new Date();

  const startsAt = parseMSCalDateTime(event.start);
  const endsAt = parseMSCalDateTime(event.end);
  const timezone = event.start?.timeZone ?? 'UTC';
  const status = event.isCancelled ? CallStatus.CANCELLED : CallStatus.SCHEDULED;
  const roomLink = resolveRoomLink(event);
  const callType = event.isOnlineMeeting ? CallType.VIDEO : CallType.AUDIO;

  const organizerEmail = event.organizer?.emailAddress?.address;

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
        provider: 'microsoft',
        calendarOwnerEmail,
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
  options?: { isFullSync?: boolean; timeRange?: CalendarSyncTimeRange; skipCancelRemoved?: boolean },
): Promise<void> {
  const isFullSync = options?.isFullSync ?? false;
  const eventsToStore = events.slice(0, MAX_CALENDAR_EVENTS_PER_SYNC);
  const hitStoreCap = eventsToStore.length < events.length;

  if (hitStoreCap) {
    logger.warn(
      `[MICROSOFT_CALENDAR_STORE] Capping store batch for ${userEmail}: ${events.length} -> ${eventsToStore.length}`,
    );
  }

  logger.info(`[MICROSOFT_CALENDAR_STORE] Storing ${eventsToStore.length} event(s) for ${userEmail} (fullSync=${isFullSync})`);

  for (const event of eventsToStore) {
    try {
      if (event['@removed']?.reason === 'deleted') {
        const externalId = buildCalendarExternalId('microsoft', userId, event.id);
        await repositories.calls.cancelByExternalId(externalId);
        continue;
      }
      await storeMsCalEventAsCall(event, userId, userEmail);
    } catch (err) {
      logger.error(
        `[MICROSOFT_CALENDAR_STORE] Failed to store event "${event.subject}" for ${userEmail}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (isFullSync && !options?.skipCancelRemoved && !hitStoreCap) {
    const externalIdPrefix = buildCalendarExternalIdPrefix('microsoft', userId);
    const fetchedExternalIds = new Set(
      eventsToStore.map(e => buildCalendarExternalId('microsoft', userId, e.id)),
    );
    await cancelRemovedExternalCalendarCalls(
      externalIdPrefix,
      CallOrigin.MICROSOFT_CALENDAR,
      fetchedExternalIds,
      'MICROSOFT_CALENDAR_STORE',
      options?.timeRange,
    );
  } else if (isFullSync && options?.skipCancelRemoved) {
    logger.warn(`[MICROSOFT_CALENDAR_STORE] Skipping removed-event cancellation because sync result was truncated upstream`);
  } else if (isFullSync && hitStoreCap) {
    logger.warn(`[MICROSOFT_CALENDAR_STORE] Skipping removed-event cancellation because store batch hit cap`);
  }
}
