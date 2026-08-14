/**
 * Xyne Call Link Injector (Xyne Call Link Auto-Injection reconciler)
 *
 * For every eligible event organized by a connected, allowlisted user:
 * creates/recovers a hosted Xyne Call, clears the existing (non-Xyne)
 * conference entry when every participant is internal (@juspay.in), and
 * always upserts the managed description link. Ineligible/ambiguous events
 * pass through untouched. One event failing must never abort the batch
 * (PRD §9).
 *
 * Note: Google Calendar's API rejects a custom addOn-type conference entry
 * from apps that aren't a registered conferencing partner (confirmed via a
 * live 400 "Invalid conference data" response) — so "replace" here means
 * clearing the stale entry, not rendering "Join Xyne Call" in the native
 * join UI. The Xyne link is always reachable via the description instead.
 *
 * Eligibility gates (in order):
 *  1. Has an id and organizer email; not cancelled; not an out-of-office /
 *     focus-time / working-location / Gmail-derived event (FR-5).
 *  2. The event's organizer email must equal the connected user's email —
 *     never patch an event where the user is only an attendee (FR-3).
 *  3. The organizer must be eligible per the Superposition-backed CAC config —
 *     either their email domain OR their UserProfile team is allowlisted (FR-2).
 * Internal-only vs external-participant classification (FR-4) is a
 * separate, hardcoded check against @juspay.in — distinct from the
 * allowlist above, which only gates whether Xyne acts on the event at all.
 */

import { type GCalEvent } from '@/services/googleCalendarCallStore';
import { type CalendarCredentials } from '@/services/calendarTokenRefresh';
import { isTeamEligible } from '@/services/calendarSyncConfig';
import { resolveXyneCallForEvent, resolveXyneChannelForUser } from '@/services/xyneCallService';
import {
  reconcileEventConference,
  escapeHtmlAttribute,
} from '@/services/calendarConferencePatcher';
import { buildCalendarExternalId } from '@/services/calendarCallStore.utils';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

const TAG = '[CALENDAR_SYNC][GOOGLE][XYNE_CALL_INJECTOR]';

const INTERNAL_PARTICIPANT_DOMAIN = 'juspay.in';
const SKIPPED_EVENT_TYPES = new Set(['outOfOffice', 'focusTime', 'workingLocation', 'fromGmail']);

type SkipReason =
  | 'missing_id_or_organizer'
  | 'cancelled'
  | 'unsupported_event_type'
  | 'not_organizer'
  | 'not_eligible';

function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function emailDomain(email: string | undefined): string | null {
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1];
  return domain && domain.length > 0 ? domain : null;
}

/** Fetches the organizer's team from UserProfile, if any. */
async function getUserTeam(userId: string): Promise<string | null> {
  const profile = await DatabaseClient.getInstance().userProfile.findUnique({
    where: { userId },
    select: { team: true },
  });
  return profile?.team ?? null;
}

function isEligibleShape(event: GCalEvent): SkipReason | null {
  if (!event.id || !event.organizer?.email) return 'missing_id_or_organizer';
  if (event.status === 'cancelled') return 'cancelled';
  if (event.eventType && SKIPPED_EVENT_TYPES.has(event.eventType)) return 'unsupported_event_type';
  return null;
}

/** Every organizer + attendee email must resolve to the internal domain. */
export function isInternalOnly(event: GCalEvent): boolean {
  const emails = [event.organizer?.email, ...(event.attendees ?? []).map((a) => a.email)];
  return emails.every((email) => emailDomain(email) === INTERNAL_PARTICIPANT_DOMAIN);
}

/** FR-7: is this event already correctly reconciled, so no patch is needed? */
function isAlreadyReconciled(
  event: GCalEvent,
  internalOnly: boolean,
  expectedCallId: string
): boolean {
  const priv = event.extendedProperties?.private;
  const roomLink = priv?.xyneRoomLink;
  if (priv?.xyneManaged !== 'true' || priv.xyneCallId !== expectedCallId || !roomLink) return false;

  const description = event.description ?? '';
  const descriptionHasLink =
    description.includes(roomLink) || description.includes(escapeHtmlAttribute(roomLink));
  if (!descriptionHasLink) return false;

  if (!internalOnly) return true; // conference entry is intentionally left untouched

  // Internal-only: reconciled means the stale (non-Xyne) conference entry has
  // been cleared — we can't set our own entry point (see module doc), so
  // there's nothing to match against, only an absence to confirm.
  const hasConferenceEntry = (event.conferenceData?.entryPoints ?? []).length > 0;
  return !hasConferenceEntry;
}

async function reconcileOne(
  event: GCalEvent,
  credentials: CalendarCredentials,
  userEmail: string,
  resolveChannelId: () => Promise<string>
): Promise<GCalEvent> {
  const shapeSkipReason = isEligibleShape(event);
  if (shapeSkipReason) {
    logger.info(`${TAG} Skipped`, { eventId: event.id, reason: shapeSkipReason });
    return event;
  }

  if (normalizeEmail(event.organizer?.email) !== normalizeEmail(userEmail)) {
    logger.info(`${TAG} Skipped`, {
      eventId: event.id,
      reason: 'not_organizer' satisfies SkipReason,
    });
    return event;
  }

  const internalOnly = isInternalOnly(event);
  const xyneCallId = buildCalendarExternalId('google', credentials.userId, event.id!);

  if (isAlreadyReconciled(event, internalOnly, xyneCallId)) {
    logger.info(`${TAG} Already reconciled, no patch needed`, { eventId: event.id, internalOnly });
    return event;
  }

  try {
    const { roomLink, isNew } = await resolveXyneCallForEvent(credentials.userId, event.id!);
    const channelId = await resolveChannelId();
    logger.info(`${TAG} ${isNew ? 'call_created' : 'call_recovered'}`, {
      eventId: event.id,
      internalOnly,
    });

    const patched = await reconcileEventConference(credentials.accessToken, event, {
      roomLink,
      xyneCallId,
      channelId,
      replaceConference: internalOnly,
    });

    logger.info(`${TAG} patched`, { eventId: event.id, internalOnly });
    return patched;
  } catch (err) {
    logger.error(`${TAG} patch_failed`, {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Per PRD: a failed patch must not mark the event as managed and must
    // not abort the batch — fall back to the unpatched event so the normal
    // (passive) storage pipeline still runs on it.
    return event;
  }
}

/**
 * Reconcile Xyne Call links for a batch of already-fetched Google Calendar
 * events. Returns events in the same order, patched where eligible and
 * unchanged otherwise. A single event's failure never aborts the batch.
 */
export async function reconcileXyneCallLinks(
  events: GCalEvent[],
  credentials: CalendarCredentials,
  userEmail: string,
  workspaceId: string
): Promise<GCalEvent[]> {
  if (events.length === 0) return events;

  // Team/config eligibility and the backing self-DM channel are constant for
  // the entire batch. Resolve eligibility once, and lazily memoize the channel
  // so an already-reconciled batch does not perform any channel work.
  let eligible: boolean;
  try {
    const team = await getUserTeam(credentials.userId);
    eligible = await isTeamEligible({ email: userEmail, team });
  } catch (err) {
    logger.error(`${TAG} Failed to resolve batch eligibility, storing original events`, {
      eventCount: events.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return events;
  }

  if (!eligible) {
    logger.info(`${TAG} Batch skipped`, {
      eventCount: events.length,
      reason: 'not_eligible' satisfies SkipReason,
    });
    return events;
  }

  let channelIdPromise: Promise<string> | undefined;
  const resolveChannelId = (): Promise<string> => {
    channelIdPromise ??= resolveXyneChannelForUser(credentials.userId, workspaceId);
    return channelIdPromise;
  };

  const results: GCalEvent[] = [];
  for (const event of events) {
    try {
      results.push(await reconcileOne(event, credentials, userEmail, resolveChannelId));
    } catch (err) {
      logger.error(`${TAG} Unexpected reconciliation error, storing original event`, {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push(event);
    }
  }
  return results;
}
