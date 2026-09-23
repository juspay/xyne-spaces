import { BaseSideEffectHandler } from '../base-handler';
import type { ConversationLabelMappingPreviousValue, SideEffectJobConfig } from '../types';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';

/**
 * Label unread badge counts depend on which conversations carry a label, so a
 * mapping insert (label applied) or delete (label removed / label deleted)
 * invalidates the channel's label-unread-counts room. The mapping row itself
 * carries the denormalized channelId, so no ticket lookup is needed.
 */
export class ConversationLabelMappingsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { args } = job;
    const channelId: string | undefined = args?.channelId;

    if (!channelId) {
      logger.warn('[ConversationLabelMappingsSideEffectHandler] Missing channelId in insert args');
      return;
    }

    websocketService.broadcastLabelUnreadCountsUpdate(channelId);
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as ConversationLabelMappingPreviousValue | undefined;

    if (!prev?.channelId) {
      logger.warn('[ConversationLabelMappingsSideEffectHandler] No previousValue for conversation_label_mappings delete');
      return;
    }

    websocketService.broadcastLabelUnreadCountsUpdate(prev.channelId);
  }
}
