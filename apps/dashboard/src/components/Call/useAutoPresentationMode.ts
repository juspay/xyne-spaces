import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../machines/roomMachine';

/**
 * Turns presentation mode on once, when the call was started with
 * `?telepresence=1` (see useCallAutoJoin's call URL API). The request arrives on
 * roomMachine's context rather than being read from the URL here, so it stays
 * scoped to the call and clears with the rest of the context on disconnect.
 *
 * `isAllowed` is the caller's existing xyne_telepresence_config gate and is
 * required: the URL param is only another way to trigger something the user
 * could already click, never a way around the permission.
 *
 * Applied once per call. Exiting presentation mode afterwards sticks — this will
 * not drag the user back in on the next render.
 */
export function useAutoPresentationMode(
  isAllowed: boolean,
  setPresentationMode: (on: boolean) => void,
): void {
  const requested = useSelector(
    roomActor,
    state => state.context.callUrlOverrides?.presentation ?? false,
  );
  const callId = useSelector(roomActor, state => state.context.externalId);
  const appliedForCallRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requested || !isAllowed || !callId) return;
    if (appliedForCallRef.current === callId) return;

    appliedForCallRef.current = callId;
    setPresentationMode(true);
  }, [requested, isAllowed, callId, setPresentationMode]);
}
