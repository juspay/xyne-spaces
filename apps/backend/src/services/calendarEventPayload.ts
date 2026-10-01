/**
 * Calendar Event Payload (pure)
 *
 * The shared, I/O-free vocabulary for the two directions of calendar
 * integration: how Xyne marks an event as its own, how a join link is rendered
 * into a description, and what body is written when a Xyne-scheduled call is
 * pushed out to Google.
 *
 * Deliberately free of database, network and config imports so both the
 * inbound sync and the outbound push can depend on it without either dragging
 * in the other.
 */

import { createHash } from 'crypto';

/**
 * Value of the `xyneOrigin` extended property on a Calendar event that Xyne
 * created by pushing an internally scheduled call outward
 * (see callCalendarPushService).
 *
 * It is the loop-breaker for the two inbound passes. Both the sync (which
 * would mint a second, calendar-origin Call for an event Xyne already has a
 * Call for) and the link injector (which would treat it as a foreign event
 * needing a Xyne link grafted on) must leave these events alone. Xyne is the
 * source of truth for them; the calendar copy is the mirror, not the original.
 *
 * Written as both a private and a shared property. Private properties stay on
 * the organizer's copy of the event; only shared ones reach the copy on each
 * attendee's calendar, which is synced inbound just the same.
 */
export const XYNE_CALENDAR_ORIGIN_VALUE = 'xyne';

/** True when this event is Xyne's own outbound mirror of a scheduled call. */
export function isXyneOriginatedEvent(
  extendedProperties:
    | { private?: Record<string, string>; shared?: Record<string, string> }
    | undefined
): boolean {
  return (
    extendedProperties?.private?.xyneOrigin === XYNE_CALENDAR_ORIGIN_VALUE ||
    extendedProperties?.shared?.xyneOrigin === XYNE_CALENDAR_ORIGIN_VALUE
  );
}

/** Escapes a URL for safe use inside an HTML attribute in the event description. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface GoogleEventBodyParams {
  title: string;
  /** Organizer-authored agenda, if any. Rendered above the join block. */
  description?: string | null;
  roomLink: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  attendeeEmails: string[];
  callId: string;
  callExternalId: string;
}

/**
 * Google Calendar renders a small safe subset of HTML in the description on
 * both web and mobile, so the join link shows as a clickable "Join Xyne Call"
 * rather than a pasted URL — matching what the inbound link injector writes.
 */
function buildEventDescription(description: string | null | undefined, roomLink: string): string {
  const joinBlock = `<b>𝓧  <a href="${escapeHtmlAttribute(roomLink)}">Join Xyne Call</a></b>`;
  const agenda = description?.trim();
  return agenda ? `${agenda}\n\n${joinBlock}` : joinBlock;
}

/**
 * The Google event body for a Xyne-scheduled call.
 *
 * `xyneOrigin` is what keeps the push from feeding itself: the inbound sync
 * and the link injector both skip events carrying it, so the event this
 * creates never comes back around as a second Call. `shared` holds nothing
 * else — every attendee can read it, and the marker is all their copy needs.
 */
export function buildGoogleEventBody(params: GoogleEventBodyParams): Record<string, unknown> {
  return {
    summary: params.title,
    description: buildEventDescription(params.description, params.roomLink),
    start: { dateTime: params.startsAt.toISOString(), timeZone: params.timezone },
    end: { dateTime: params.endsAt.toISOString(), timeZone: params.timezone },
    attendees: params.attendeeEmails.map((email) => ({ email })),
    extendedProperties: {
      private: {
        xyneOrigin: XYNE_CALENDAR_ORIGIN_VALUE,
        xyneManaged: 'true',
        xyneCallId: params.callId,
        xyneCallExternalId: params.callExternalId,
        xyneRoomLink: params.roomLink,
      },
      shared: {
        xyneOrigin: XYNE_CALENDAR_ORIGIN_VALUE,
      },
    },
    reminders: { useDefault: true },
  };
}

/** Digest of the exact payload written to Google, used to skip no-op updates. */
export function hashEventBody(body: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(body)).digest('hex');
}
