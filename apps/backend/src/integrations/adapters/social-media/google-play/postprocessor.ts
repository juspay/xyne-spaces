import { BasePostprocessor } from '@/integrations/core/basePostprocessor';
import type { PostprocessContext } from '@/integrations/core/types';
import { syncSocialMediaTicketCustomFields } from '../ticketCustomFields';

export class GooglePlayReviewsPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    await syncSocialMediaTicketCustomFields(context);
  }
}
