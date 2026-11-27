// Storage/read infrastructure is not a release switch. Do not remove this compile-time
// interlock until all stage writers enforce the gate atomically and the UI is tested.
export const TICKET_DEPENDENCIES_ENFORCEMENT_READY = false;

export async function ticketDependenciesEnabled(workspaceId: string): Promise<boolean> {
  if (!TICKET_DEPENDENCIES_ENFORCEMENT_READY) return false;
  try {
    const { superpositionClient } = await import('@/services/superpositionClient');
    return await superpositionClient.getBooleanValue('ticket_dependencies_v1', false, {
      workspaceId,
    });
  } catch {
    // Flag-service failure must preserve pre-feature behavior, never partially enable gates.
    return false;
  }
}
