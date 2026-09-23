import { asService } from './base';

/**
 * Relocated from integrations/routes/external-source-sync.ts's sync route. Unauthenticated
 * external-source webhook → workspace resolved from the source row itself, not a request
 * session, so scope is opened explicitly before the ingest writes (tickets, conversations,
 * messages) run.
 */
export function ingestExternalSourceAsServiceActor<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['EmailChannelPreference', 'User', 'Ticket', 'Conversation', 'Message', 'Channel'],
    'external source ingest: unauthenticated webhook, workspace resolved from the source row itself',
    'external-source-ingest',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from services/bitbucketWebhookService.ts's handlePullRequestEvent. Unauthenticated
 * webhook (no req.user): the internal workspaceId in the request URL is the only tenant signal,
 * so scope is opened explicitly before the ticket_assignments / user_workload_mappings writes
 * this event triggers downstream.
 */
export function runBitbucketWebhookAsServiceActor<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['TicketAssignment', 'UserWorkloadMapping'],
    'bitbucket webhook: unauthenticated, workspaceId comes only from the internal request URL',
    'bitbucket-webhook',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from services/gcsPollingService.ts's poll loop. Background poller → no request
 * context; the systemUserId actor is a dedicated bot account, not a participant of the channels
 * or tickets this touches, so relational predicates on a real caller would return nothing.
 */
export function processGcsFileAsServiceActor<T>(
  systemUserId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return asService(
    ['Ticket', 'Conversation', 'Message'],
    'gcs polling: background poller has no request context, actor is a dedicated bot account not a participant',
    systemUserId,
    workspaceId,
    fn,
  );
}
