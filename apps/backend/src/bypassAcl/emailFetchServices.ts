import { asService } from './base';

const EMAIL_FETCH_TABLES = ['Email', 'ExternalMessage', 'ExternalSource', 'Ticket', 'TicketActivity'] as const;

/**
 * Relocated from workers/emailFetchWorker.ts's runCatchup / processFetchJob. Background job →
 * open a tenant scope from the job's workspaceId so ingested emails/drafts/tickets get
 * workspaceId stamped instead of leaking NULL.
 */
export function runEmailFetchJob<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    [...EMAIL_FETCH_TABLES],
    'email fetch worker: background job has no request context, ingested rows need workspaceId stamped',
    'email-fetch-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from workers/emailFetchWorker.ts's processReviewSyncJob. Same reasoning as
 * runEmailFetchJob — social-media review sync is also a background job with no request context.
 */
export function runSocialMediaFetchJob<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['ExternalSource', 'Ticket', 'Email'],
    'social-media fetch worker: background job has no request context, ingested rows need workspaceId stamped',
    'social-media-fetch-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from workers/emailClassificationWorker.ts's processJob. Background job → no
 * request context; classification writes (ticket assignment, activity, workload) need
 * workspaceId stamped.
 */
export function runEmailClassificationJob<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Ticket', 'TicketActivity', 'Email'],
    'email classification worker: background job has no request context, classification writes need workspaceId stamped',
    'email-classification-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from workers/autoDraftWorker.ts's processJob. Background job → no request context;
 * draft generation writes email/ticket rows that need workspaceId stamped.
 */
export function runAutoDraftJob<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Email', 'Ticket'],
    'auto-draft worker: background job has no request context, draft writes need workspaceId stamped',
    'auto-draft-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from controllers/autodraftCallback.handler.ts. Unauthenticated callback — no HTTP
 * session to derive the tenant from, so scope is opened explicitly off the channel's workspaceId.
 */
export function runAutoDraftCallback<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Email', 'Ticket'],
    'auto-draft callback: unauthenticated callback has no session, scope opened off the channel\'s workspaceId',
    'autodraft-callback',
    workspaceId,
    fn,
  );
}
