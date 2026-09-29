import { asService } from './base';
import { catchUpFromCursor } from '@/integrations/adapters/google/refetch';
import { socialMediaService } from '@/integrations/social-media/socialMediaService';
import { emailService } from '@/services/emailService';
import type { ExternalSource } from '@prisma/client';
import type { ExternalSourceAdapter, RefetchOptions } from '@/integrations/core/types';
import type { EmailClassificationWorker } from '@/workers/emailClassificationWorker';

const EMAIL_FETCH_TABLES = ['Email', 'ExternalMessage', 'ExternalSource', 'Ticket', 'TicketActivity'] as const;

/**
 * Relocated from workers/emailFetchWorker.ts's runCatchup. Background job → open a tenant scope
 * from the job's workspaceId so ingested emails/drafts/tickets get workspaceId stamped instead
 * of leaking NULL.
 */
export function catchUpEmailSource(
  workspaceId: string,
  ...args: Parameters<typeof catchUpFromCursor>
): ReturnType<typeof catchUpFromCursor> {
  return asService(
    [...EMAIL_FETCH_TABLES],
    'email fetch worker: background job has no request context, ingested rows need workspaceId stamped',
    'email-fetch-worker',
    workspaceId,
    () => catchUpFromCursor(...args),
  );
}

/**
 * Relocated from workers/emailFetchWorker.ts's processFetchJob. Same reasoning as
 * catchUpEmailSource — an explicit refetch of a window is also a background job with no request
 * context.
 */
export function refetchEmailSource(
  workspaceId: string,
  adapter: ExternalSourceAdapter,
  source: ExternalSource,
  options: RefetchOptions | undefined,
) {
  return asService(
    [...EMAIL_FETCH_TABLES],
    'email fetch worker: background job has no request context, ingested rows need workspaceId stamped',
    'email-fetch-worker',
    workspaceId,
    () => adapter.refetch!(source, options),
  );
}

/**
 * Relocated from workers/emailFetchWorker.ts's processReviewSyncJob. Social-media review sync is
 * also a background job with no request context, so ingested rows need workspaceId stamped.
 * Returns how many new interactions were synced across the sources.
 */
export function syncSocialMediaSources(
  workspaceId: string,
  sourceIds: string[],
  backfill: { startDate: Date; endDate: Date } | undefined,
): Promise<number> {
  return asService(
    ['ExternalSource', 'Ticket', 'Email'],
    'social-media fetch worker: background job has no request context, ingested rows need workspaceId stamped',
    'social-media-fetch-worker',
    workspaceId,
    async () => {
      let newInteractionCount = 0;
      for (const sourceId of sourceIds) {
        const result = await socialMediaService.syncSource(sourceId, {
          ignoreSyncCursor: true,
          ...(backfill && { backfill }),
        });
        newInteractionCount += result.synced;
      }
      return newInteractionCount;
    },
  );
}

/**
 * Relocated from workers/emailClassificationWorker.ts's processJob. Background job → no
 * request context; classification writes (ticket assignment, activity, workload) need
 * workspaceId stamped.
 */
export function classifyAndAssignTicket(
  worker: EmailClassificationWorker,
  workspaceId: string,
  job: Parameters<EmailClassificationWorker['classifyAndAssign']>[0],
): Promise<void> {
  return asService(
    ['Ticket', 'TicketActivity', 'Email'],
    'email classification worker: background job has no request context, classification writes need workspaceId stamped',
    'email-classification-worker',
    workspaceId,
    () => worker.classifyAndAssign(job, workspaceId),
  );
}

/**
 * Relocated from workers/autoDraftWorker.ts's processJob. Background job → no request context;
 * draft generation writes email/ticket rows that need workspaceId stamped.
 */
export function retriggerAutoDraft(workspaceId: string, ticketId: string): Promise<boolean> {
  return asService(
    ['Email', 'Ticket'],
    'auto-draft worker: background job has no request context, draft writes need workspaceId stamped',
    'auto-draft-worker',
    workspaceId,
    () => emailService.retriggerAutoDraftForTicket(ticketId),
  );
}

/**
 * Relocated from controllers/autodraftCallback.handler.ts. Unauthenticated callback — no HTTP
 * session to derive the tenant from, so scope is opened explicitly off the channel's workspaceId.
 * The generation finished without a usable result, so the "generating" marker is cleared.
 */
export function clearAutoDraftGeneratingFromCallback(workspaceId: string, conversationId: string): Promise<void> {
  return asService(
    ['Email', 'Ticket'],
    'auto-draft callback: unauthenticated callback has no session, scope opened off the channel\'s workspaceId',
    'autodraft-callback',
    workspaceId,
    () => emailService.clearAutoDraftGenerating(conversationId),
  );
}

/**
 * Relocated from controllers/autodraftCallback.handler.ts. Same scope as
 * clearAutoDraftGeneratingFromCallback; persists the generated draft.
 */
export function persistAutoDraftFromCallback(
  workspaceId: string,
  params: Parameters<typeof emailService.persistAutoDraft>[0],
): ReturnType<typeof emailService.persistAutoDraft> {
  return asService(
    ['Email', 'Ticket'],
    'auto-draft callback: unauthenticated callback has no session, scope opened off the channel\'s workspaceId',
    'autodraft-callback',
    workspaceId,
    () => emailService.persistAutoDraft(params),
  );
}
