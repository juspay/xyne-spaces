/**
 * Call history item utilities — exact port of
 * dashboard/src/routes/CallHistoryScreen/callHistoryItem.utils.ts
 * adapted for React Native (no browser APIs).
 */
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { CallOrigin, CallStatus, InvitationResponse } from '@xyne/shared';

// ─── Types ─────────────────────────────────────────────────────────────────

export type Call = QueryResultType<typeof queries.userCallHistory>[number];

/** Generic user shape used by utility functions */
export type UserLike = {
  id: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
};

export interface CallStatusInfo {
  isMissedCall: boolean;
  didNotAnswer: boolean;
}

// ─── Calendar origin helpers ────────────────────────────────────────────────

export function isGoogleCalendarCall(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return (call as { callOrigin?: string }).callOrigin === CallOrigin.GOOGLE_CALENDAR;
}

export function isMicrosoftCalendarCall(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return (call as { callOrigin?: string }).callOrigin === CallOrigin.MICROSOFT_CALENDAR;
}

export function isExternalCalendarEvent(
  call: { callOrigin?: string } | Record<string, unknown>,
): boolean {
  return isGoogleCalendarCall(call) || isMicrosoftCalendarCall(call);
}

// ─── Participant helpers ────────────────────────────────────────────────────

/** Get all participant user objects (excluding nulls) */
export function getParticipantUsers<U extends UserLike>(
  participants: Call['participants'],
  allUsers: U[],
): U[] {
  const participantUserIds = (participants || []).map(p => p.userId);
  return allUsers.filter(u => participantUserIds.includes(u.id));
}

/** Check if any participant joined the call */
export function hasAnyoneJoined(participants: Call['participants']): boolean {
  return (participants || []).some(
    p => p.response === InvitationResponse.ACCEPTED || p.response === InvitationResponse.LEFT,
  );
}

/** Get other participants (excluding current user) */
export function getOtherParticipants(
  participants: Call['participants'],
  currentUserId: string | undefined,
): NonNullable<Call['participants']> {
  return participants?.filter(p => p.userId !== currentUserId) || [];
}

// ─── Participant preview (calls.participantPreviewUserIds) ──────────────────
// History rows come from the participant-only query, which relates just the current
// user's participant row; who else was on the call comes from this denormalized preview
// (same as the dashboard).

type ParticipantPreviewEntry = { userId: string; hasJoined: boolean };

function normalizeParticipantPreviewEntry(value: unknown): ParticipantPreviewEntry | null {
  if (value && typeof value === 'object' && 'userId' in value && typeof value.userId === 'string') {
    return {
      userId: value.userId,
      hasJoined: 'hasJoined' in value && value.hasJoined === true,
    };
  }
  return null;
}

function parseParticipantPreviewEntries(preview: unknown): ParticipantPreviewEntry[] | null {
  let parsed: unknown = preview;
  if (typeof preview === 'string') {
    try {
      parsed = JSON.parse(preview) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .map(normalizeParticipantPreviewEntry)
    .filter((entry): entry is ParticipantPreviewEntry => entry !== null);
}

/** Other participants' user ids from the preview, in preview order. */
export function getPreviewParticipantUserIds(
  preview: unknown,
  currentUserId: string | undefined,
): string[] {
  return (parseParticipantPreviewEntries(preview) ?? [])
    .map(entry => entry.userId)
    .filter(userId => userId !== currentUserId);
}

export function hasPreviewParticipantJoined(
  preview: unknown,
  currentUserId: string | undefined,
): boolean {
  return (parseParticipantPreviewEntries(preview) ?? []).some(
    entry => entry.userId !== currentUserId && entry.hasJoined,
  );
}

/** Total participants: live rows for an active call, the denormalized count otherwise. */
export function getCallParticipantCount(call: {
  status?: string | null;
  participantCount?: number | null;
  participants?: readonly unknown[] | null;
}): number {
  if (call.status === CallStatus.ACTIVE) {
    return call.participants?.length ?? call.participantCount ?? 0;
  }
  return call.participantCount ?? call.participants?.length ?? 0;
}

// ─── Status helpers ─────────────────────────────────────────────────────────

/** Determine call status based on call type and participants */
export function getCallStatus(
  call: Call,
  isOutgoingCall: boolean,
  hasCurrentUserJoined: boolean,
  userJoinedandLeft: boolean,
  anyoneJoined: boolean,
): CallStatusInfo {
  const isCallEnded = call.status === CallStatus.ENDED;
  const hasCurrentUserParticipated = hasCurrentUserJoined || userJoinedandLeft;

  if (isOutgoingCall) {
    // Outgoing call: "No answer" if ended and no one joined
    return {
      isMissedCall: false,
      didNotAnswer: isCallEnded && !anyoneJoined,
    };
  }

  // Incoming call: "Missed" if ended and current user didn't participate
  return {
    isMissedCall: isCallEnded && !hasCurrentUserParticipated,
    didNotAnswer: false,
  };
}

/** Format a duration in milliseconds to a human-readable string */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Get status text based on call state */
export function getStatusText(
  isMissedCall: boolean,
  didNotAnswer: boolean,
  isActive: boolean,
  durationMs: number,
  isScheduled?: boolean,
): string {
  if (isMissedCall) return 'Missed call invite';
  if (didNotAnswer) return 'No answer';
  if (isActive) return 'Active';
  if (isScheduled) return 'Scheduled';
  return formatDuration(durationMs);
}

// ─── Title helpers ──────────────────────────────────────────────────────────

/** Get call title from participant names */
export function getCallTitleFromParticipants<U extends UserLike>(
  participants: Call['participants'],
  allUsers: U[],
  currentUserId: string | undefined,
): string {
  const otherParticipants = getOtherParticipants(participants, currentUserId);
  if (otherParticipants.length === 0) return 'Unknown';

  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const firstNames = otherParticipants.map(p => {
    const fullName = userMap.get(p.userId)?.name || 'Unknown';
    return fullName.split(' ')[0];
  });

  return firstNames.join(', ');
}

// ─── Scheduled call helpers ─────────────────────────────────────────────────

export function isScheduledCallJoinable(call: {
  startsAt?: number | null;
  status: string;
}): boolean {
  if (!call.startsAt) return false;
  if (call.status === CallStatus.ENDED) return false;
  if (call.status === CallStatus.ACTIVE) return true;

  return Date.now() >= call.startsAt;
}
