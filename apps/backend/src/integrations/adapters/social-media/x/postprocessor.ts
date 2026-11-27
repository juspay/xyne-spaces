import type { PostprocessContext } from '@/integrations/core/types';
import { backdateConversationToMessage } from '@/integrations/core/backdateConversation';
import { logger } from '@/utils/logger';
import { MetaPostprocessor } from '../shared/metaPostprocessor';

/**
 * Shared social behaviour (custom fields, reopen on a new inbound message), plus a backdate: X
 * messages that arrive out of order (a gap repair that had to retry, a manual fetch) can append
 * a message older than its ticket, which then moves back to that real first message.
 */
export class XPostprocessor extends MetaPostprocessor {
  constructor() {
    super('[XPostprocessor]');
  }

  async process(context: PostprocessContext): Promise<void> {
    await super.process(context);
    const { metadata, emailData } = context.normalizedData;
    // A message that created its ticket already dated it; desk replies are never older than their
    // ticket; content updates keep their original time.
    if (context.isNew || metadata.isReply || emailData?.updateExisting || !(metadata.timestamp instanceof Date)) return;
    try {
      await backdateConversationToMessage(context.conversationId, metadata.timestamp);
    } catch (error) {
      logger.warn('[XPostprocessor] Backdate failed', { conversationId: context.conversationId, error: String(error) });
    }
  }
}
