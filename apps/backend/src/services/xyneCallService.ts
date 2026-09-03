/**
 * Xyne Call Service (Xyne Call Link Auto-Injection)
 *
 * Resolves the hosted Xyne Call for a given Google Calendar event: recovers
 * a previously-created call's room link so it never changes across syncs,
 * or derives a fresh one for a not-yet-managed event. No explicit "create
 * room" API call is needed — the room is created implicitly on first join.
 * The link always points at the external/guest invite flow (dashboard-external,
 * no Xyne login required) rather than the internal authenticated dashboard
 * route, since Calendar invitees — internal or external — shouldn't need a
 * Xyne account just to open the link (PRD: OPEN access, anyone with the link
 * can request or join). Actual persistence of the Call row (xyneManaged,
 * roomLink, channelId) happens through the existing storeGCalEventAsCall
 * upsert pipeline once the Calendar PATCH succeeds.
 */

import { repositories } from '@/database/repositories';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { buildCalendarExternalId } from '@/services/calendarCallStore.utils';

export interface ResolvedXyneCall {
  /** Canonical Xyne Call join URL. Stable across recoveries. */
  roomLink: string;
  /** True when no prior Xyne-managed call existed for this event. */
  isNew: boolean;
}

/**
 * Create-or-recover the hosted Xyne Call for a Google Calendar event owned
 * by userId. Recovery is keyed off the same deterministic external ID the
 * passive mirror pipeline already uses, so a previously-managed event always
 * gets back the exact same join link.
 */
export async function resolveXyneCallForEvent(
  userId: string,
  googleEventId: string
): Promise<ResolvedXyneCall> {
  const externalId = buildCalendarExternalId('google', userId, googleEventId);
  const existing = await repositories.calls.findByExternalId(externalId);

  if (existing?.xyneManaged && existing.roomLink) {
    return { roomLink: existing.roomLink, isNew: false };
  }

  const roomLink = buildCallInviteUrl(externalId);
  return { roomLink, isNew: !existing };
}

/**
 * Resolves (or creates) the organizer's self-DM channel to back a Xyne-managed
 * calendar call. The join API (`joinCall`) requires `call.channelId` to resolve
 * a real Channel before it will create the LiveKit room on first join — without
 * one it fails with "Channel not found", since calendar-mirrored calls are
 * otherwise created with channelId=null (see calendarCallStore.utils.ts).
 */
export async function resolveXyneChannelForUser(
  userId: string,
  workspaceId: string
): Promise<string> {
  return repositories.channels.findOrCreateDMChannel(
    userId,
    [userId],
    repositories.channelParticipants,
    workspaceId
  );
}
