import { asService } from './base';

/**
 * Relocated from controllers/deskReportCallback.handler.ts. Unauthenticated callback — no HTTP
 * session to derive the tenant from, so scope is opened explicitly off the channel's workspaceId.
 */
export function runDeskReportCallback<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['MessageAttachment'],
    'desk report callback: unauthenticated callback has no session, scope opened off the channel\'s workspaceId',
    'desk-report-callback',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from services/deskReportGenerationService.ts's runScheduledGeneration. Cron-scheduled
 * generation across every workspace's preferences — no request context, so each channel's report
 * needs its own scope opened from that channel's workspaceId.
 */
export function runScheduledDeskReport<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['MessageAttachment'],
    'desk report scheduler: cron job has no request context, scope opened per channel\'s own workspaceId',
    'desk-report-scheduler',
    workspaceId,
    fn,
  );
}
