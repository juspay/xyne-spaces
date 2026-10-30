import { logger } from '@/utils/logger';
import type { AutomationEvent } from '@/automations/types/automation-events';

export async function emitDomainEvent(
  event: AutomationEvent,
  workspaceId: string,
): Promise<void> {
  const { eventRouter } = await import('@/automations/engine/event-router');

  try {
    await eventRouter.emitToAutomations(event, workspaceId);
  } catch (error) {
    logger.error(
      `[events] automations failed for ${event.type} in workspace ${workspaceId}:`,
      error,
    );
  }
}
