import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, TicketTagPreviousValue } from '../types';
import { buildKanbanCountsSnapshot } from '@/services/tickets/kanbanCountsSnapshotService';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';

/**
 * The tag audit trail (activity + SYSTEM message) is emitted by
 * TicketTagMappingsSideEffectHandler (the canonical new-model table), not here,
 * to avoid duplicate messages during the dual-write migration window. This
 * handler is responsible for re-indexing Vespa and broadcasting kanban counts.
 */
export class TicketTagsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { args } = job;
    const tagName: string = args?.name;
    const ticketId: string = args?.ticketId;

    if (!tagName || !ticketId) {
      logger.warn('[TicketTagsSideEffectHandler] Missing name or ticketId in insert args');
      return;
    }

    await this.queueTicketVespaFeed(ticketId);
    await this.broadcastTicketCountsUpdate(ticketId, tagName, 'added');
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { args, previousValue } = job;
    const prev = previousValue as TicketTagPreviousValue | undefined;
    const ticketId: string | undefined = args?.ticketId ?? prev?.ticketId;

    if (!ticketId) {
      logger.warn('[TicketTagsSideEffectHandler] Missing ticketId in update args and previousValue');
      return;
    }

    await this.queueTicketVespaFeed(ticketId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { previousValue } = job;

    if (!previousValue) {
      logger.warn('[TicketTagsSideEffectHandler] No previousValue for ticket_tags delete');
      return;
    }

    const prev = previousValue as TicketTagPreviousValue;
    await this.queueTicketVespaFeed(prev.ticketId);
    await this.broadcastTicketCountsUpdate(prev.ticketId, prev.tagName, 'removed');
  }

  private async queueTicketVespaFeed(ticketId: string): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: ticketSchema,
        jobType: 'feed',
        docId: ticketId,
        userId: this.ctx.userID,
        workspaceId: this.ctx.workspaceId,
      });
    } catch (error) {
      logger.error('[TicketTagsSideEffectHandler] Failed to queue ticket Vespa feed:', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async broadcastTicketCountsUpdate(
    ticketId: string,
    tagName: string,
    action: 'added' | 'removed',
  ): Promise<void> {
    const snapshot = await buildKanbanCountsSnapshot(ticketId);
    if (!snapshot) return;

    const tags = snapshot.tags.filter(tag => tag !== tagName);
    const previousTags = action === 'added' ? tags : [...tags, tagName];

    websocketService.broadcastTicketCountsUpdate({
      operation: 'update',
      ticket: snapshot,
      previousTicket: {
        ...snapshot,
        tags: previousTags,
      },
    });
  }
}
