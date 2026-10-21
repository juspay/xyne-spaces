import { logger } from '@/utils/logger';
import type { AutomationEvent } from '@/automations/types/automation-events';

export async function emitDomainEvent(
  event: AutomationEvent,
  workspaceId: string,
): Promise<void> {
  const [{ eventRouter }, { workflowRuntime }] = await Promise.all([
    import('@/automations/engine/event-router'),
    import('@/workflowsV2/runtime'),
  ]);

  const [automations, workflows] = await Promise.allSettled([
    eventRouter.emitToAutomations(event, workspaceId),
    workflowRuntime.dispatchEvent({
      type: event.type,
      payload: event.payload as unknown as Record<string, unknown>,
      // `findActiveWorkflows` reads `workspaceId` from here to scope candidates.
      metadata: { workspaceId },
    }),
  ]);

  if (automations.status === 'rejected') {
    logger.error(
      `[events] automations failed for ${event.type} in workspace ${workspaceId}:`,
      automations.reason,
    );
  }
  if (workflows.status === 'rejected') {
    logger.error(
      `[events] workflows failed for ${event.type} in workspace ${workspaceId}:`,
      workflows.reason,
    );
  }
}
