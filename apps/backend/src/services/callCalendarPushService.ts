/**
 * Outbound Google Calendar Push (Xyne → Calendar)
 *
 * The mirror image of the inbound calendar sync. A call scheduled inside Xyne
 * exists only in Xyne, so it never appears on anyone's calendar — people don't
 * join a pre-scheduled call they were never blocked out for. This service
 * writes such a call onto the ORGANIZER's primary Google Calendar with every
 * participant as an attendee, so Google fans the invite out to internal
 * members and external invitees alike, including people who never connected
 * Xyne.
 *
 * Reconciliation, not commands: `syncCallToGoogleCalendar(callId)` reads the
 * call's current state and makes Google match it, so the same job is safe to
 * run on create, on edit, on cancel, and on retry.
 *   SCHEDULED   → create the event, or patch the one already pushed
 *   CANCELLED   → delete the event and forget its id
 *   ACTIVE/ENDED→ leave Google alone; the meeting is happening or happened,
 *                 and yanking it off calendars mid-call helps nobody
 *
 * Gating (PRD "whoever has an active source"): the organizer must have an
 * ACTIVE Google calendar ExternalSource. No source means no push and no error
 * — the call still lives in Xyne exactly as it does today.
 *
 * Only Xyne-native calls are pushed. A call whose origin is already a calendar
 * (GOOGLE_CALENDAR / MICROSOFT_CALENDAR) came FROM that calendar; pushing it
 * back would duplicate the event it was derived from.
 */

import { AuthProvider, CallOrigin, CallStatus } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import type {
  CallMetadata,
  GoogleCalendarPushState,
} from '@/database/repositories/callRepository';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  deleteGoogleEvent,
  insertGoogleEvent,
  patchGoogleEvent,
  GoogleCalendarEventGoneError,
} from '@/services/googleCalendarApi';
import { buildGoogleEventBody, hashEventBody } from '@/services/calendarEventPayload';
import { normalizeCalendarOwnerEmail } from '@/services/calendarCallStore.utils';
import { runAsServiceActor, runAsSystem } from '@/database/tenant/context';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';

const TAG = '[CALENDAR_PUSH][GOOGLE]';

/** Origins that Xyne owns end-to-end, and may therefore mirror outward. */
const PUSHABLE_ORIGINS = new Set<string>([CallOrigin.CHANNEL, CallOrigin.CONVERSATION]);

/**
 * Attendees for the invite: every internal participant plus every external
 * invitee, minus the organizer (Google puts them on the event as its owner).
 * Deduped case-insensitively so a member invited both by channel membership
 * and by email address is not listed twice.
 */
async function resolveAttendeeEmails(callId: string, organizerEmail: string): Promise<string[]> {
  const [participants, externalEmails] = await Promise.all([
    repositories.calls.findParticipants(callId),
    repositories.calls.findExternalInviteeEmails(callId),
  ]);

  const internalUsers = await repositories.users.getEmailsByIds(
    participants.map((p) => p.userId),
  );

  const organizer = normalizeCalendarOwnerEmail(organizerEmail);
  const seen = new Set<string>([organizer]);
  const attendees: string[] = [];

  for (const email of [...internalUsers.map((u) => u.email), ...externalEmails]) {
    const normalized = normalizeCalendarOwnerEmail(email);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    attendees.push(normalized);
  }

  // Sorted so an unchanged guest list always produces the same event body,
  // and therefore the same content hash, whatever order the rows came back in.
  return attendees.sort();
}

/**
 * The organizer's ACTIVE Google calendar connection, with a fresh access
 * token. Null when they never connected, disconnected, or the source was
 * deactivated by a permanent auth failure — all of which mean "don't push".
 */
async function resolveOrganizerCredentials(organizerUserId: string) {
  const source = await repositories.externalSources.findCalendarSourceByOwner(
    organizerUserId,
    'GOOGLE',
  );

  if (!source) return null;
  if (!source.isActive) {
    logger.info(`${TAG} Organizer's Google calendar source is inactive; skipping push`, {
      organizerUserId,
      sourceId: source.id,
    });
    return null;
  }

  const credentials = await getCalendarCredentialsBySourceId(source.id, AuthProvider.GOOGLE);
  if (!credentials) {
    logger.warn(`${TAG} No usable Google credentials for organizer; skipping push`, {
      organizerUserId,
      sourceId: source.id,
    });
    return null;
  }

  return { sourceId: source.id, credentials };
}

/** Remove the mirrored event, then forget it so a later re-push starts clean. */
async function removePushedEvent(
  callId: string,
  pushState: GoogleCalendarPushState,
  organizerUserId: string,
): Promise<void> {
  const resolved = await resolveOrganizerCredentials(organizerUserId);

  if (!resolved) {
    // Without a live connection the event cannot be withdrawn from Google.
    // Keep the stored id: if the organizer reconnects, the next sync for this
    // call still knows which event to delete.
    logger.warn(`${TAG} Cannot delete pushed event — organizer has no active source`, {
      callId,
      eventId: pushState.eventId,
    });
    return;
  }

  await deleteGoogleEvent(resolved.credentials.accessToken, pushState.eventId, {
    sendUpdates: 'all',
  });
  await repositories.calls.setGoogleCalendarPushState(callId, null);

  logger.info(`${TAG} Deleted pushed event`, { callId, eventId: pushState.eventId });
}

/**
 * Make the organizer's Google Calendar match this call's current state.
 * Safe to call repeatedly; safe to call for calls that will never push.
 *
 * Returns the `updatedAt` of the row it reconciled against, so a caller can
 * tell whether the call was edited again while this ran, or null when there
 * was no such row.
 */
export async function syncCallToGoogleCalendar(callId: string): Promise<Date | null> {
  // The job carries only a call id, so the row's own workspaceId is read
  // cross-workspace first and every later query runs inside that scope.
  const call = await runAsSystem(() => repositories.calls.findForCalendarPush(callId));

  if (!call) {
    logger.warn(`${TAG} Call not found; nothing to sync`, { callId });
    return null;
  }

  if (!PUSHABLE_ORIGINS.has(call.callOrigin)) return call.updatedAt;

  await runAsServiceActor(call.createdByUserId, call.workspaceId, async () => {
    const pushState = (call.metadata as CallMetadata | null)?.googleCalendarPush ?? null;

    if (call.status === CallStatus.CANCELLED) {
      if (pushState) await removePushedEvent(call.id, pushState, call.createdByUserId);
      return;
    }

    // Only a still-scheduled call is written or rewritten. Once it is live or
    // over, the calendar entry stays exactly as the attendees last saw it.
    if (call.status !== CallStatus.SCHEDULED) return;

    if (!call.startsAt || !call.endsAt) {
      logger.info(`${TAG} Call has no start/end; nothing to put on a calendar`, { callId });
      return;
    }

    const organizer = await repositories.users.findById(call.createdByUserId);
    if (!organizer?.email) {
      logger.warn(`${TAG} Organizer has no email; skipping push`, {
        callId,
        organizerUserId: call.createdByUserId,
      });
      return;
    }

    const resolved = await resolveOrganizerCredentials(call.createdByUserId);
    if (!resolved) return;

    const attendeeEmails = await resolveAttendeeEmails(call.id, organizer.email);
    const body = buildGoogleEventBody({
      title: call.title ?? 'Xyne Call',
      description: call.description,
      // Every scheduled call is created with a roomLink; derive it from the
      // public id rather than emit a dead "Join" link if one is ever missing.
      roomLink: call.roomLink ?? buildCallInviteUrl(call.externalId),
      startsAt: call.startsAt,
      endsAt: call.endsAt,
      timezone: call.timezone,
      attendeeEmails,
      callId: call.id,
      callExternalId: call.externalId,
    });

    const contentHash = hashEventBody(body);

    // Nothing about the event changed since the last push. Returning here is
    // not just an optimisation: `sendUpdates: 'all'` makes Google email every
    // attendee on an update, and reconciles run for reasons that have nothing
    // to do with the calendar (a series cascade, a buffer replenishment, a
    // retry). Those must not surface as "this meeting changed".
    if (pushState?.eventId && pushState.contentHash === contentHash) {
      logger.info(`${TAG} Event already matches call; skipping update`, {
        callId,
        eventId: pushState.eventId,
      });
      return;
    }

    // sendUpdates:'all' on every write — unlike the inbound reconciler these
    // ARE the organizer's own changes, so invitees should be told about them.
    let event;
    if (pushState?.eventId) {
      try {
        event = await patchGoogleEvent(resolved.credentials.accessToken, pushState.eventId, body, {
          sendUpdates: 'all',
        });
      } catch (err) {
        if (!(err instanceof GoogleCalendarEventGoneError)) throw err;
        // Someone deleted the event straight from Google. Re-create it rather
        // than leaving the call permanently invisible on their calendar.
        logger.warn(`${TAG} Pushed event vanished; re-creating`, {
          callId,
          eventId: pushState.eventId,
        });
        event = await insertGoogleEvent(resolved.credentials.accessToken, body, {
          sendUpdates: 'all',
        });
      }
    } else {
      event = await insertGoogleEvent(resolved.credentials.accessToken, body, {
        sendUpdates: 'all',
      });
    }

    if (!event.id) {
      throw new Error(`Google returned an event without an id for call ${callId}`);
    }

    await repositories.calls.setGoogleCalendarPushState(call.id, {
      eventId: event.id,
      sourceId: resolved.sourceId,
      organizerUserId: call.createdByUserId,
      contentHash,
      ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
      syncedAt: new Date().toISOString(),
    });

    logger.info(`${TAG} Pushed call to organizer's calendar`, {
      callId,
      eventId: event.id,
      attendees: attendeeEmails.length,
      created: !pushState?.eventId,
    });
  });

  return call.updatedAt;
}
