import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { BasePostprocessor } from '@/integrations/core/basePostprocessor';
import type { PostprocessContext } from '@/integrations/core/types';
import { logger } from '@/utils/logger';
import { syncSocialMediaTicketCustomFields } from '../ticketCustomFields';
import { APP_STORE_RESPONSE_STATE_FIELD, APP_STORE_RESPONSE_STATE_STALE } from './constants';

export class AppStoreReviewsPostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    try {
      await syncSocialMediaTicketCustomFields(await this.keepStaleMarker(context));
    } catch (error) {
      logger.error('[AppStoreReviewsPostprocessor] Failed to sync ticket custom fields', {
        sourceId: context.sourceId,
        conversationId: context.conversationId,
        error,
      });
    }
  }

  /**
   * The poll reports Apple's raw state, so it would revert the reconciler's 24h marker every five
   * minutes — the only signal a stuck reply ever gets. A reply just posted owns the newer truth.
   */
  private async keepStaleMarker(context: PostprocessContext): Promise<PostprocessContext> {
    if (context.normalizedData.metadata.isReply) return context;
    const fields = context.normalizedData.ticketCustomFields;
    const incoming = fields?.find((field) => field.fieldName === APP_STORE_RESPONSE_STATE_FIELD);
    if (incoming?.value !== 'PENDING_PUBLISH') return context;

    const ticket = await db.ticket.findFirst({
      where: { conversationId: context.conversationId },
      select: { id: true },
    });
    if (!ticket) return context;
    const current = await repositories.forms.getFormEntityValuesByEntityId(ticket.id, 'TICKET');
    if (current[APP_STORE_RESPONSE_STATE_FIELD] !== APP_STORE_RESPONSE_STATE_STALE) return context;

    return {
      ...context,
      normalizedData: {
        ...context.normalizedData,
        ticketCustomFields: fields?.filter((field) => field !== incoming),
      },
    };
  }
}
