import { useSelector } from '@xstate/react';
import { useMemo, useState, useEffect } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { roomActor } from '../machines/roomMachine';
import { queries } from '../zero/queries';
import { InvitationResponse, MeetingStatus } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { htmlToPlainText } from '../utils/sanitizer';

// Type for active call with relations
type ActiveCallWithRelations = QueryResultType<typeof queries.userActiveCalls>[number];

// Type for call participants
type CallParticipants = NonNullable<ActiveCallWithRelations['participants']>;

/**
 * Utility function to filter active participants (ACCEPTED and not left)
 * @param participants - Array of call participants
 * @returns Array of active participants
 */
export const getActiveParticipants = <
  T extends { response?: InvitationResponse | string | null; leftAt?: number | null },
>(
  participants: readonly T[],
): T[] => {
  return participants.filter(p => p.response === InvitationResponse.ACCEPTED);
};

/**
 * Find a specific user's participant record in a participants array
 * @param participants - Array of call participants
 * @param userId - The user ID to find
 * @returns The participant record, or undefined if not found
 */
export const findUserParticipant = <T extends { userId: string }>(
  participants: readonly T[],
  userId: string,
): T | undefined => participants.find(p => p.userId === userId);

/**
 * Check if a specific user is actively in a call (ACCEPTED response)
 * @param participants - Array of call participants
 * @param userId - The user ID to check
 * @returns true if the user has an ACCEPTED response
 */
export const isUserActiveInCall = <T extends { userId: string; response?: string | null }>(
  participants: readonly T[],
  userId: string,
): boolean =>
  participants.some(
    p => p.userId === userId && p.response === (InvitationResponse.ACCEPTED as string),
  );

/**
 * Gets the meeting status of the current user for a given call
 * @param call - The call object with participants
 * @param currentUserId - Current user ID (optional)
 * @returns MeetingStatus of the user or PENDING if not found
 */
export const getCurrentUserMeetingStatus = (
  call: { participants?: Array<{ userId: string; meetingStatus?: MeetingStatus }> },
  currentUserId?: string,
): MeetingStatus => {
  if (!currentUserId) return MeetingStatus.PENDING;
  return (
    call.participants?.find(participant => participant.userId === currentUserId)?.meetingStatus ??
    MeetingStatus.PENDING
  );
};

/**
 * Formats participant text for display based on participant count
 * @param participants - Array of call participants (only needs userId field)
 * @param userMap - Map of user IDs to user data for quick lookups
 * @returns Formatted participant text string
 */
export const formatParticipantText = <T extends { userId: string }>(
  participants: readonly T[] | T[],
  userMap: Map<string, { id: string; name?: string }>,
): string => {
  // Helper function to extract the first name from a full name
  const getFirstName = (fullName: string | undefined): string => {
    if (!fullName) return 'Someone';
    return fullName.split(' ')[0] || fullName;
  };

  const count = participants.length;
  if (count === 0) return '';

  if (count === 1) {
    const firstParticipant = participants[0];
    if (!firstParticipant) return '';
    const user = userMap.get(firstParticipant.userId);
    return getFirstName(user?.name);
  }

  if (count === 2) {
    const names = participants.slice(0, 2).map(p => {
      const user = userMap.get(p.userId);
      return getFirstName(user?.name);
    });
    return names.join(' and ');
  }

  const firstParticipant = participants[0];
  if (!firstParticipant) return '';
  const firstUser = userMap.get(firstParticipant.userId);
  const firstName = getFirstName(firstUser?.name);
  const othersCount = count - 1;
  return `${firstName} and ${othersCount} ${othersCount === 1 ? 'other' : 'others'}`;
};

/**
 * Custom hook to get active calls from room actor
 * @returns Array of active calls or undefined
 */
export const useActiveCalls = () => {
  return useSelector(roomActor, state => state.context.activeCalls);
};

/**
 * Get a specific active call by external ID
 * @param externalId - The external ID of the call
 * @returns The active call or undefined
 */
export const useActiveCall = (externalId: string) => {
  const activeCalls = useActiveCalls();

  return useMemo(() => {
    return activeCalls.find(call => call.externalId === externalId) as
      | ActiveCallWithRelations
      | undefined;
  }, [activeCalls, externalId]);
};

/**
 * Check if the current user is the host/creator of a specific call
 * @param externalId - The external ID of the call
 * @param userId - The current user's ID
 * @returns true if the user is the host, false otherwise
 */
export const useIsCallHost = (externalId: string, userId: string | undefined) => {
  const activeCall = useActiveCall(externalId);

  return useMemo(() => {
    return activeCall?.createdByUserId === userId;
  }, [activeCall?.createdByUserId, userId]);
};

/**
 * Get participants for a specific call
 * @param externalId - The external ID of the call
 * @returns Array of call participants
 */
export const useCallParticipants = (externalId: string) => {
  const activeCall = useActiveCall(externalId);

  return useMemo(() => {
    return activeCall?.participants || [];
  }, [activeCall?.participants]);
};

/**
 * Check if there's only one active participant in the call
 * @param participants - Array of call participants
 * @returns true if there's only one or zero active participants, false otherwise
 */
export const useIsOnlyParticipant = (participants: CallParticipants) => {
  return useMemo(() => {
    const activeParticipants = getActiveParticipants(participants);
    return activeParticipants.length <= 1;
  }, [participants]);
};

/**
 * Custom hook to check if a specific call is active
 * @param callId - The external call ID to check
 * @returns true if the call is active, false otherwise
 */
export const useIsCallActive = (callId: string | undefined): boolean => {
  const activeCalls = useActiveCalls();

  if (!callId || !activeCalls) {
    return false;
  }

  return activeCalls.some(call => call.externalId === callId);
};

/**
 * Hook to track call duration with real-time updates
 * @param startedAt - The timestamp when the call started (in milliseconds)
 * @param isActive - Whether the call is currently active
 * @param format - Format type: 'detailed' (M:SS min, updates every second) or 'simple' (X min, updates every minute)
 * @returns Formatted duration string (e.g., "5:23 min" or "5 min") or empty string if not active
 */
export const useCallDuration = (
  startedAt: number | undefined,
  isActive: boolean,
  format: 'detailed' | 'simple' = 'detailed',
): string => {
  const [duration, setDuration] = useState('');

  const formatCallDuration = (durationMs: number): string => {
    const minutes = Math.floor(durationMs / 60000);
    if (format === 'simple') {
      return minutes > 0 ? `${minutes} min` : '';
    }
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')} min`;
  };

  useEffect(() => {
    if (!startedAt || !isActive) {
      setDuration('');
      return;
    }

    const updateDuration = (): void => {
      const now = Date.now();
      const durationMs = now - startedAt;
      setDuration(formatCallDuration(durationMs));
    };

    // Update immediately
    updateDuration();

    // Update interval based on format
    const intervalMs = format === 'simple' ? 60000 : 1000;
    const interval = setInterval(updateDuration, intervalMs);
    return (): void => clearInterval(interval);
  }, [startedAt, isActive, format]);

  return duration;
};

/**
 * Hook to fetch call title with priority: call.title > conversation message > "Group Call"
 * @param callId - The external call ID
 * @param truncateLength - Maximum length for the preview (default: 20)
 * @returns Call title string
 */
export const useFetchCallTitle = (
  callId: string | undefined,
  truncateLength: number = 20,
): string => {
  const activeCall = useActiveCall(callId || '');
  const [conversation] = useCachedQuery(queries.getConversationByCallId({ callId: callId || '' }), {
    enabled: !!callId,
  });

  return useMemo(() => {
    if (activeCall?.title) {
      const title = activeCall.title;
      return title.length <= truncateLength ? title : title.slice(0, truncateLength) + '...';
    }
    if (conversation?.initialMessage?.content) {
      const plainText = htmlToPlainText(conversation.initialMessage.content);
      return plainText.length <= truncateLength
        ? plainText
        : plainText.slice(0, truncateLength) + '...';
    }
    return 'Group Call';
  }, [activeCall?.title, conversation?.initialMessage?.content, truncateLength]);
};
