/**
 * Calendar Conference Patcher (Xyne Call Link Auto-Injection)
 *
 * Builds the managed description block for a Google Calendar event and
 * PATCHes it via the organizer's delegated OAuth token.
 * - Internal-only events: clears the existing (non-Xyne) conference entry
 *   AND upserts the description link. Google Calendar's API only accepts a
 *   custom (addOn-type) conference entry from applications registered as an
 *   actual Google Workspace Marketplace conferencing partner — confirmed via
 *   a live 400 "Invalid conference data" response, so we cannot render
 *   "Join Xyne Call" in the native join UI without that registration. Instead
 *   we remove the stale/incorrect conference so it doesn't linger, and rely
 *   on the description link as the join path (FR-9, reduced scope).
 * - External-participant events: description link only, conference entry
 *   left untouched (FR-4/FR-9).
 * On a 412 (stale etag) the caller gets one fresh re-fetch + retry; beyond
 * that it surfaces the error so the reconciler leaves the event untouched.
 */

import { type GCalEvent } from '@/services/googleCalendarCallStore';
import {
  getGoogleEventById,
  patchGoogleEvent,
  GoogleCalendarPatchConflictError,
} from '@/services/googleCalendarApi';
import { logger } from '@/utils/logger';

const TAG = '[CALENDAR_SYNC][GOOGLE][CONFERENCE_PATCHER]';

const MANAGED_DESCRIPTION_START = '<!-- xyne-call:start -->';
const MANAGED_DESCRIPTION_END = '<!-- xyne-call:end -->';

/** Escapes a URL for safe use inside an HTML attribute in the event description. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildManagedBlock(roomLink: string): string {
  // Google Calendar's description field renders a small safe subset of HTML
  // (bold, links, line breaks) in both Web and mobile clients, so this shows
  // as a clean clickable "Join Xyne Call" link instead of a raw pasted URL.
  const href = escapeHtmlAttribute(roomLink);
  return `${MANAGED_DESCRIPTION_START}\n<b>𝓧  <a href="${href}">Join Xyne Call</a></b>\n${MANAGED_DESCRIPTION_END}`;
}

/**
 * Idempotently upsert the managed block inside an event description,
 * preserving all other content. Replaces an existing block in place, or
 * appends a new one if none exists yet.
 */
export function upsertManagedDescription(
  existingDescription: string | undefined,
  roomLink: string
): string {
  const block = buildManagedBlock(roomLink);
  const description = existingDescription ?? '';
  const startIdx = description.indexOf(MANAGED_DESCRIPTION_START);
  const endIdx = description.indexOf(MANAGED_DESCRIPTION_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = description.slice(0, startIdx);
    const after = description.slice(endIdx + MANAGED_DESCRIPTION_END.length);
    return `${before}${block}${after}`;
  }

  if (description.trim().length === 0) return block;
  return `${description}\n\n${block}`;
}

/**
 * Google Calendar conferenceData payload used to clear an existing (non-Xyne)
 * conference entry. Google rejects custom addOn-type conference entries from
 * apps that aren't a registered conferencing partner, so the best we can do
 * without that registration is remove the stale entry rather than replace it.
 */
export const CLEARED_CONFERENCE_DATA = null;

export interface ReconcileConferenceOptions {
  roomLink: string;
  xyneCallId: string;
  /** Organizer's self-DM channel backing the Call row, so joinCall can resolve a real Channel. */
  channelId: string;
  /** True for internal-only events — also clears the existing conference entry. */
  replaceConference: boolean;
}

function buildPatchBody(event: GCalEvent, options: ReconcileConferenceOptions) {
  const description = upsertManagedDescription(event.description, options.roomLink);
  const existingPrivate = event.extendedProperties?.private ?? {};

  const body: Record<string, unknown> = {
    description,
    extendedProperties: {
      private: {
        ...existingPrivate,
        xyneManaged: 'true',
        xyneCallId: options.xyneCallId,
        xyneRoomLink: options.roomLink,
        xyneChannelId: options.channelId,
      },
    },
  };

  if (options.replaceConference) {
    body.conferenceData = CLEARED_CONFERENCE_DATA;
  }

  return body;
}

/** Whether Google already contains the exact managed state this PATCH would establish. */
export function isEventReconciledWithOptions(
  event: GCalEvent,
  options: ReconcileConferenceOptions
): boolean {
  const privateProperties = event.extendedProperties?.private;
  if (
    privateProperties?.xyneManaged !== 'true' ||
    privateProperties.xyneCallId !== options.xyneCallId ||
    privateProperties.xyneRoomLink !== options.roomLink ||
    privateProperties.xyneChannelId !== options.channelId
  ) {
    return false;
  }

  const description = event.description ?? '';
  const hasRoomLink =
    description.includes(options.roomLink) ||
    description.includes(escapeHtmlAttribute(options.roomLink));
  if (!hasRoomLink) return false;

  if (!options.replaceConference) return true;
  return (event.conferenceData?.entryPoints ?? []).length === 0;
}

/**
 * PATCH the organizer's Calendar event with the managed description (and,
 * for internal-only events, the replaced conference entry). Retries exactly
 * once on a 412 conflict by re-fetching the event and rebuilding the patch
 * against its fresh etag; any further failure is thrown for the caller to
 * log and skip (event is left untouched until the next sync).
 */
export async function reconcileEventConference(
  accessToken: string,
  event: GCalEvent,
  options: ReconcileConferenceOptions
): Promise<GCalEvent> {
  if (!event.id) {
    throw new Error('Cannot patch a Google Calendar event without an id');
  }

  const attemptPatch = async (target: GCalEvent): Promise<GCalEvent> => {
    const body = buildPatchBody(target, options);
    return patchGoogleEvent(accessToken, target.id!, body, {
      conferenceDataVersion: options.replaceConference,
      etag: target.etag,
    });
  };

  try {
    return await attemptPatch(event);
  } catch (err) {
    if (!(err instanceof GoogleCalendarPatchConflictError)) throw err;

    logger.warn(`${TAG} Patch conflict, re-evaluating once`, { eventId: event.id });
    const fresh = await getGoogleEventById(accessToken, event.id);
    if (isEventReconciledWithOptions(fresh, options)) {
      logger.info(`${TAG} Fresh event already reconciled after conflict`, { eventId: event.id });
      return fresh;
    }
    return attemptPatch(fresh);
  }
}
