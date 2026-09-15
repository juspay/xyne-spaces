import { BasePostprocessor } from '@/integrations/core/basePostprocessor';
import type { PostprocessContext } from '@/integrations/core/types';
import { logger } from '@/utils/logger';
import { syncSocialMediaTicketCustomFields } from '../ticketCustomFields';

export class AppStoreReviewsPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    try {
      await syncSocialMediaTicketCustomFields(context);
    } catch (error) {
      logger.error('[AppStoreReviewsPostprocessor] Failed to sync ticket custom fields', {
        sourceId: context.sourceId,
        conversationId: context.conversationId,
        error,
      });
    }
  }
}
