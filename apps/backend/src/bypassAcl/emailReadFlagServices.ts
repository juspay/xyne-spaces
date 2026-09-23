import { asSystem } from './base';

/**
 * Used by the private repo's controllers/emailReadFlagBackfillController.ts — a one-off
 * backfill of email_reads.hasNewEmail for rows that predate the column. Kept running in the
 * request's async context would limit writes to the calling admin's own rows; the repair spans
 * every user in every workspace, so it must run outside any single workspace's ACL scope.
 */
export function runEmailReadFlagBackfillAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return asSystem(
    ['EmailRead', 'Ticket'],
    'one-off email_reads.hasNewEmail backfill spans every user in every workspace',
    fn,
  );
}
