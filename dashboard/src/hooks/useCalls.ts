import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { roomActor } from '../machines/roomMachine';
import { queries } from '../zero/queries';
import { InvitationResponse } from '@xyne/shared';

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
