import { DependencyError } from './types';

// Storage/read infrastructure is not a release switch. Do not remove this compile-time
// interlock until all stage writers enforce the gate atomically and the UI is tested.
export const TICKET_DEPENDENCIES_ENFORCEMENT_READY = false;

export async function ticketDependenciesEnabled(workspaceId: string): Promise<boolean> {
  if (!TICKET_DEPENDENCIES_ENFORCEMENT_READY) return false;
  try {
    const { superpositionClient } = await import('@/services/superpositionClient');
    return await superpositionClient.getRequiredBooleanValue('ticket_dependencies_v1', {
      workspaceId,
    });
  } catch {
    // Once enforcement is deployable, a provider outage must not turn existing hard gates off.
    throw new DependencyError('DEPENDENCY_FLAG_UNAVAILABLE', 'Dependency policy is temporarily unavailable; retry', 503);
  }
}
