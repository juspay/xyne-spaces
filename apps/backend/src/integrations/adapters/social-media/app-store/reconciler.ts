import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { appStoreClient } from './client';
import {
  APP_STORE_MAX_RECONCILE_PER_RUN,
  APP_STORE_RESPONSE_PUBLISH_SLA_MS,
  APP_STORE_RESPONSE_STATE_FIELD,
} from './constants';
import { clearPendingResponse, listPendingResponses } from './syncState';

const TAG = '[AppStoreReconciler]';

/** Written to the ticket field once Apple has blown through its own 24h publication SLA. */
export const APP_STORE_RESPONSE_STATE_STALE = 'PENDING_PUBLISH (over 24h)';

/**
 * Pass B — pending-reply reconciliation.
 *
 * Apple publishes responses asynchronously, so a reply we post comes back PENDING_PUBLISH. The
 * normal poll cannot fix this up: it pages on createdDate, and the review we replied to may have
 * been created long before the ingest window, so it is never re-fetched. This pass re-checks only
 * the reviews we know are waiting, which is normally a handful.
 *
 * There is no REJECTED state — a response only ever becomes published — so the 24h staleness marker
 * below is the only way a stuck reply ever becomes visible to an agent.
 */
export async function reconcilePendingResponses(source: ExternalSource): Promise<void> {
  const pending = await listPendingResponses(source.id);
  if (pending.length === 0) return;

  for (const { reviewId, firstSeenAt } of pending.slice(0, APP_STORE_MAX_RECONCILE_PER_RUN)) {
    try {
      const response = await appStoreClient.getReviewResponse(source, reviewId);

      // Apple no longer has a response for this review — nothing left to wait for.
      if (!response) {
        await clearPendingResponse(source.id, reviewId);
        continue;
      }

      if (response.state === 'PUBLISHED') {
        await writeResponseState(source, reviewId, 'PUBLISHED');
        await clearPendingResponse(source.id, reviewId);
        continue;
      }

      if (Date.now() - firstSeenAt.getTime() > APP_STORE_RESPONSE_PUBLISH_SLA_MS) {
        logger.warn(`${TAG} [APP_STORE_RESPONSE_STUCK] still unpublished past Apple's 24h SLA`, {
          sourceId: source.id,
          reviewId,
          pendingSinceHours: Math.round((Date.now() - firstSeenAt.getTime()) / 3_600_000),
        });
        await writeResponseState(source, reviewId, APP_STORE_RESPONSE_STATE_STALE);
      }
    } catch (error) {
      // One bad review must not stop the rest; it stays pending and is retried next pass.
      logger.error(`${TAG} Failed to reconcile a pending response`, {
        sourceId: source.id,
        reviewId,
        error,
      });
    }
  }
}

/** Resolves review → interaction → email → ticket, then updates the desk's response-state field. */
async function writeResponseState(
  source: ExternalSource,
  reviewId: string,
  state: string,
): Promise<void> {
  const externalMessage = await db.externalMessage.findFirst({
    where: { externalSourceId: source.id, externalId: `${source.id}:${reviewId}` },
    select: { messageId: true },
  });
  if (!externalMessage) return;

  const email = await db.email.findUnique({
    where: { id: externalMessage.messageId },
    select: { conversationId: true },
  });
  if (!email?.conversationId) return;

  const ticket = await db.ticket.findFirst({
    where: { conversationId: email.conversationId },
    select: { id: true, boardId: true },
  });
  if (!ticket) return;

  await repositories.forms.upsertTicketFormFields(ticket.id, ticket.boardId, [
    { fieldName: APP_STORE_RESPONSE_STATE_FIELD, value: state },
  ]);
}
