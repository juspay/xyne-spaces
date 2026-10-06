import { useSelector } from '@xstate/react';
import { useMemo, useState, useEffect } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { roomActor } from '../machines/roomMachine';
import { queries } from '../zero/queries';
import { InvitationResponse } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { htmlToPlainText } from '../utils/sanitizer';
import { formatElapsedTime } from '../utils/recordingUtils';

// Type for active call with relations
export type ActiveCallWithRelations = QueryResultType<typeof queries.userActiveCalls>[number];

// Type for call participants
type CallParticipants = Readonly<QueryResultType<typeof queries.callParticipantsByCallId>>;

/**
 * Utility function to filter accepted participants
 * @param participants - Array of call participants
 * @returns Array of accepted participants
 */
export const getActiveParticipants = <T extends { response?: InvitationResponse | string | null }>(
  participants: readonly T[],
): T[] => {
  return participants.filter(p => p.response === InvitationResponse.ACCEPTED);
};
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
 * Find the active call matching the given externalId.
 * @param activeCalls - Array of active calls
 * @param externalId - The call's externalId to find
 * @returns The active call, or undefined if not found
 */
export const findActiveCall = <T extends { externalId: string }>(
  activeCalls: T[],
  externalId: string,
): T | undefined => activeCalls.find(call => call.externalId === externalId);

/**
 * Whether the active call for externalId currently has recording enabled.
 * @param activeCalls - Array of active calls (with recordingEnabled flag)
 * @param externalId - The call's externalId
 * @returns true if that call has recording enabled
 */
export const isCallRecording = (
  activeCalls: Array<{ externalId: string; recordingEnabled?: boolean | null }>,
  externalId: string,
): boolean => findActiveCall(activeCalls, externalId)?.recordingEnabled === true;

/**
 * Determines what UI action a user should see for a call:
 * - 'canJoin': User has accepted/invited/left/declined — show "Join" button
 * - 'requested': User has pending request — show "Waiting..."
 * - 'requestToJoin': User is not a participant — show "Request to Join"
 */
export const getUserCallAccessLevel = (
  participants: ReadonlyArray<{ userId: string; response?: string | null }>,
  userId?: string,
): 'canJoin' | 'requested' | 'requestToJoin' => {
  if (!userId) return 'requestToJoin';
  const p = participants.find(part => part.userId === userId);
  if (!p) return 'requestToJoin';
  return p.response === InvitationResponse.REQUESTED ? 'requested' : 'canJoin';
};
/**
 * Formats participant text for display based on participant count
 * @param participants - Array of call participants (only needs userId field)
 * @param userMap - Map of user IDs to user data for quick lookups
 * @returns Formatted participant text string
 */
export const formatParticipantText = <
  T extends { userId: string; displayName?: string | null; isExternal?: boolean },
>(
  participants: readonly T[] | T[],
  userMap: Map<string, { id: string; name?: string; displayName?: string | null }>,
  totalCount = participants.length,
): string => {
  // Helper function to extract the first name from a full name
  const getFirstName = (fullName: string | undefined): string => {
    if (!fullName) return 'Someone';
    return fullName.split(' ')[0] || fullName;
  };

  // Resolve display name: external users use their stored displayName, internal users use userMap
  const getParticipantFirstName = (p: T): string => {
    if (p.isExternal) return `${p.displayName?.split(' ')[0] || 'Guest'} (External)`;
    const user = userMap.get(p.userId);
    return getFirstName(user?.displayName || user?.name);
  };

  const count = totalCount;
  if (count === 0) return '';

  if (count === 1) {
    const firstParticipant = participants[0];
    if (!firstParticipant) return '';
    return getParticipantFirstName(firstParticipant);
  }

  if (count === 2) {
    const names = participants.slice(0, 2).map(p => getParticipantFirstName(p));
    return names.join(' and ');
  }

  const firstParticipant = participants[0];
  if (!firstParticipant) return '';
  const firstName = getParticipantFirstName(firstParticipant);
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
    return activeCall?.participants ?? [];
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
 * Check if the current user is alone in the call (for AFK detection)
 * @param participants - Array of call participants
 * @returns true if there's exactly one active participant
 */
export const useIsLoneParticipant = (participants: CallParticipants): boolean => {
  return useMemo(() => {
    return getActiveParticipants(participants).length === 1;
  }, [participants]);
};

/**
 * Check if a channel has an active call, respecting callUpdatesChannel for post-to-channel calls.
 * @param channelId - The channel ID to check
 * @returns true if any active call is broadcasting to this channel
 */
export const useChannelHasActiveCall = (channelId: string): boolean => {
  const activeCalls = useActiveCalls();
  return useMemo(
    () =>
      activeCalls?.some(call => (call.callUpdatesChannel ?? call.channelId) === channelId) ?? false,
    [activeCalls, channelId],
  );
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
 * @param format - Format type: 'detailed' (M:SS, then HH:MM:SS, updates every second) or 'simple' (X min / Xh Ym, updates every minute)
 * @returns Formatted duration string (e.g., "5:23", "01:05:23", or "5 min") or empty string if not active
 */
export const useCallDuration = (
  startedAt: number | undefined,
  isActive: boolean,
  format: 'detailed' | 'simple' = 'detailed',
): string => {
  const [duration, setDuration] = useState('');

  const formatCallDuration = (durationMs: number): string => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (format === 'simple') {
      const totalMinutes = Math.floor(totalSeconds / 60);
      const hoursLabel = Math.floor(totalMinutes / 60);
      if (hoursLabel > 0) {
        const remainingMinutes = totalMinutes % 60;
        return remainingMinutes > 0 ? `${hoursLabel}h ${remainingMinutes}m` : `${hoursLabel}h`;
      }
      return totalMinutes > 0 ? `${totalMinutes} min` : '';
    }

    if (hours > 0) {
      return formatElapsedTime(durationMs);
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
