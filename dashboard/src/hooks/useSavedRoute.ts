import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Subscribes to the saved route for a given keyword. Returns `undefined`
 * when nothing has been saved yet for that keyword.
 */
export function useSavedRoute(keyword: string): string | undefined {
  return useSelector(stateMachineActor, state => state.context.savedRoutes[keyword]);
}

/**
 * Returns the current saved route without subscribing — useful for capturing
 * the value once on mount inside effects.
 */
export function readSavedRoute(keyword: string): string | undefined {
  return stateMachineActor.getSnapshot().context.savedRoutes[keyword];
}

export function setSavedRoute(keyword: string, path: string | null): void {
  stateMachineActor.send({ type: 'SET_SAVED_ROUTE', keyword, path });
}
