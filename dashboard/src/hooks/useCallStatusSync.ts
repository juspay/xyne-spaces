import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { v4 as uuidv4 } from 'uuid';
import { roomActor } from '../machines/roomMachine';
import { useZero } from './useZero';
import { useSelf } from './useUsers';
import { mutators } from '../zero/mutators';
import { isStatusExpired } from '../utils/statusUtils';

export const CALL_STATUS_EMOJI = '🎧';
const CALL_STATUS_CONTENT = 'In a call';

/**
 * Syncs the user's presence status with their call state.
 * When a user enters a call and has no active status, sets "In a call" status.
 * When the call ends, clears it only if we were the ones who set it and it's still present.
 */
/**
 * Renders nothing — just runs useCallStatusSync inside the SharedAuthProvider tree.
 */
export const CallStatusSyncProvider = (): null => {
  useCallStatusSync();
  return null;
};

export const useCallStatusSync = (): void => {
  const zero = useZero();
  const currentUser = useSelf();
  const callStatusSetRef = useRef(false);

  const isInCall = useSelector(
    roomActor,
    state =>
      state.matches('initiating') ||
      state.matches('joining') ||
      state.matches('connecting') ||
      state.matches('connected'),
  );

  useEffect(() => {
    // We need currentUser data to make any safe decisions about presence status
    if (!currentUser) {
      return;
    }

    const hasActiveStatus =
      currentUser.statusEmoji &&
      (!currentUser.statusExpiryAt || !isStatusExpired(currentUser.statusExpiryAt));

    if (isInCall) {
      // If we are in a call and the user has no active status, set the "In a call" status
      // We check callStatusSetRef to ensure we only automatically set it once per call session
      if (!hasActiveStatus && !callStatusSetRef.current) {
        callStatusSetRef.current = true;
        void zero.mutate(
          mutators.userPresence.upsert({
            statusEmoji: CALL_STATUS_EMOJI,
            statusContent: CALL_STATUS_CONTENT,
            statusExpiryAt: null,
            timestamp: Date.now(),
            presenceId: uuidv4(),
          }),
        );
      }
    } else {
      // If we are not in a call, clear the "In a call" status if:
      // (a) this tab set it (normal flow), OR
      // (b) the status is still '🎧' even though we're not in a call — handles the case
      //     where the tab crashed/refreshed mid-call and callStatusSetRef reset to false.
      const hasStuckCallStatus = currentUser.statusEmoji === CALL_STATUS_EMOJI;
      // True if the user manually changed to a different status during the call.
      // In that case we preserve their intent and do not clear it on call end.
      const userChangedStatusDuringCall =
        currentUser.statusEmoji !== null && currentUser.statusEmoji !== CALL_STATUS_EMOJI;

      if ((callStatusSetRef.current || hasStuckCallStatus) && !userChangedStatusDuringCall) {
        callStatusSetRef.current = false;

        void zero.mutate(
          mutators.userPresence.upsert({
            statusEmoji: null,
            statusContent: null,
            statusExpiryAt: null,
            timestamp: Date.now(),
            presenceId: uuidv4(),
          }),
        );
      }
    }
  }, [isInCall, zero, currentUser]);
};
