import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { formatDuration } from '../../utils/dateUtils';
import { type User } from '@xyne/shared';

export type Call = QueryResultType<typeof queries.userCallHistory>[number];

export interface CallStatus {
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
  return (participants || []).some(p => p.joinedAt !== null);
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
  anyoneJoined: boolean,
): CallStatus {
  const isCallEnded = call.endedAt !== null;

  if (isOutgoingCall) {
    // Outgoing call: "No answer" if ended and no one joined
    return {
      isMissedCall: false,
      didNotAnswer: isCallEnded && !anyoneJoined,
    };
  }

  // Incoming call: "Missed" if ended and current user didn't join
  return {
    isMissedCall: isCallEnded && !hasCurrentUserJoined,
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
