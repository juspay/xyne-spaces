import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { formatDuration } from '../../utils/dateUtils';
import { CallOrigin, CallStatus, InvitationResponse, type User } from '@xyne/shared';
import { hasJoinedExternalParticipant as hasJoinedExternalCallParticipant } from '../../components/Call/callParticipant.utils';

export type RecentCallFilter = 'all' | 'incoming' | 'outgoing' | 'active' | 'missed';

export const FILTER_LABELS: Record<RecentCallFilter, string> = {
  all: 'All Calls',
  incoming: 'Incoming Calls',
  outgoing: 'Outgoing Calls',
  active: 'Active Calls',
  missed: 'Missed Calls',
};

export type Call = QueryResultType<typeof queries.userCallHistory>[number];

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

export interface CallStatusInfo {
  isMissedCall: boolean;
  didNotAnswer: boolean;
}

// Get all participant user objects (excluding nulls)
export function getParticipantUsers(participants: Call['participants'], allUsers: User[]): User[] {
  const participantUserIds = (participants || []).map(p => p.userId);
  return allUsers.filter(u => participantUserIds.includes(u.id));
}

// Check if any participant joined the call
export function hasAnyoneJoined(participants: Call['participants']): boolean {
  return (participants || []).some(
    p => p.response === InvitationResponse.ACCEPTED || p.response === InvitationResponse.LEFT,
  );
}

export function hasJoinedExternalParticipant(participants: Call['participants']): boolean {
  return hasJoinedExternalCallParticipant(participants);
}

// Get other participants (excluding current user)
export function getOtherParticipants(
  participants: Call['participants'],
  currentUserId: string | undefined,
): NonNullable<Call['participants']> {
  return participants?.filter(p => p.userId !== currentUserId) || [];
}

// Determine call status based on call type and participants
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

// Get status text based on call state
export function getStatusText(
  isMissedCall: boolean,
  didNotAnswer: boolean,
  isActive: boolean,
  duration: number,
): string {
  if (isMissedCall) return 'Missed call invite';
  if (didNotAnswer) return 'No answer';
  if (isActive) return 'Active';
  return formatDuration(duration);
}

// Get call title from participant names
export function getCallTitleFromParticipants(
  participants: Call['participants'],
  allUsers: User[],
  currentUserId: string | undefined,
): string {
  const otherParticipants = getOtherParticipants(participants, currentUserId);
  if (otherParticipants.length === 0) return 'Unknown';

  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const firstNames = otherParticipants.map(p => {
    if (p.isExternal) return `${p.displayName?.split(' ')[0] || 'Guest'} (External)`;
    const fullName = userMap.get(p.userId)?.name || 'Unknown';
    return fullName.split(' ')[0];
  });

  return firstNames.join(', ');
}

export function groupByDay(calls: Call[]): { date: Date; calls: Call[] }[] {
  const map = new Map<string, { date: Date; calls: Call[] }>();
  for (const call of calls) {
    if (!call.startsAt) continue;
    const d = new Date(call.startsAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!map.has(key)) map.set(key, { date: d, calls: [] });
    map.get(key)!.calls.push(call);
  }
  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function isScheduledCallJoinable(call: Call): boolean {
  if (!call.startsAt) return false;
  if (call.status === CallStatus.ENDED) return false;

  if (call.status === CallStatus.ACTIVE) return true;

  const now = Date.now();
  const scheduledTime = new Date(call.startsAt).getTime();

  return now >= scheduledTime;
}
