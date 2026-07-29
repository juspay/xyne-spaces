import { stateMachineActor } from '../machines/stateMachine';

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
