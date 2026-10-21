import { asService, asSystem } from './base';
import { externalSourceCore } from '@/integrations/core/core';
import type { BitbucketWebhookService } from '@/services/bitbucketWebhookService';
import type { BitbucketWebhookEnvelope } from '@/routes/webhooks';
import type { GcsPollingService } from '@/services/gcsPollingService';
import type { GitHubWebhookService } from '@/services/githubWebhookService';

/**
 * Relocated from integrations/routes/external-source-sync.ts's sync route. Unauthenticated
 * external-source webhook → workspace resolved from the source row itself, not a request
 * session, so scope is opened explicitly before the ingest writes (tickets, conversations,
 * messages) run.
 */
export function ingestExternalSource(
  workspaceId: string,
  ...args: Parameters<typeof externalSourceCore.ingest>
): ReturnType<typeof externalSourceCore.ingest> {
  return asService(
    ['EmailChannelPreference', 'User', 'Ticket', 'Conversation', 'Message', 'Channel'],
    'external source ingest: unauthenticated webhook, workspace resolved from the source row itself',
    'external-source-ingest',
    workspaceId,
    () => externalSourceCore.ingest(...args),
  );
}

/**
 * Relocated from services/bitbucketWebhookService.ts's handleWebhookEvent. Unauthenticated
 * webhook (no req.user): the internal workspaceId in the request URL is the only tenant signal,
 * so scope is opened explicitly before the ticket_assignments / user_workload_mappings writes
 * this event triggers downstream.
 */
export function runBitbucketWebhook(
  service: BitbucketWebhookService,
  workspaceId: string,
  eventKey: string,
  payload: BitbucketWebhookEnvelope,
): ReturnType<BitbucketWebhookService['processWebhookEvent']> {
  return asService(
    ['TicketAssignment', 'UserWorkloadMapping'],
    'bitbucket webhook: unauthenticated, workspaceId comes only from the internal request URL',
    'bitbucket-webhook',
    workspaceId,
    () => service.processWebhookEvent(eventKey, payload, workspaceId),
  );
}

/**
 * Relocated from services/githubWebhookService.ts's handleWebhookEvent. Unauthenticated webhook
 * (no req.user). The new /webhooks/github/:workspaceId route carries a workspaceId — used to
 * open scope before the PR-metrics/ticket-sync writes pull_request events trigger. The legacy
 * /webhooks/github route (no workspaceId) only acknowledges pull_request events and processes
 * issue_comment ones, which resolve their own workspace deeper inside xyneCommentService — no
 * tenant is knowable at this entry point, so that branch runs as system instead.
 */
export function runGitHubWebhook(
  service: GitHubWebhookService,
  eventType: string,
  payload: unknown,
  workspaceId: string | undefined,
): ReturnType<GitHubWebhookService['processWebhookEvent']> {
  if (workspaceId) {
    return asService(
      ['PullRequests', 'Ticket', 'TicketActivity', 'WorkflowExecution', 'Workflow'],
      'github webhook: unauthenticated, workspaceId comes only from the internal request URL',
      'github-webhook',
      workspaceId,
      () => service.processWebhookEvent(eventType, payload, workspaceId),
    );
  }
  return asSystem(
    ['Ticket', 'Message', 'Conversation'],
    'github webhook: legacy route carries no workspaceId, only acknowledges pull_request and processes issue_comment, which resolves its own workspace downstream',
    () => service.processWebhookEvent(eventType, payload, workspaceId),
  );
}

/**
 * Relocated from services/gcsPollingService.ts's poll loop. Background poller → no request
 * context; the systemUserId actor is a dedicated bot account, not a participant of the channels
 * or tickets this touches, so relational predicates on a real caller would return nothing.
 */
export function processGcsFile(
  systemUserId: string,
  workspaceId: string,
  poller: GcsPollingService,
  file: Parameters<GcsPollingService['processFile']>[0],
): Promise<void> {
  return asService(
    ['Ticket', 'Conversation', 'Message'],
    'gcs polling: background poller has no request context, actor is a dedicated bot account not a participant',
    systemUserId,
    workspaceId,
    () => poller.processFile(file),
  );
}
