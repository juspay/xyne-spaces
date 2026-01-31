import { useSelector } from '@xstate/react';
import { roomActor } from '../machines/roomMachine';

/**
 * Custom hook to get active calls from room actor
 * @returns Array of active calls or undefined
 */
export const useActiveCalls = () => {
  return useSelector(roomActor, state => state.context.activeCalls);
};
