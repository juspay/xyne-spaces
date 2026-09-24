import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem } from './base';

export type EmailReadFlagBackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  batches: number;
  scanned: number;
  setTrue: number;
  setFalse: number;
};

type CandidateRead = {
  id: string;
  ticketId: string;
  lastReadEmailAt: Date;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Relocated from controllers/emailReadFlagBackfillController.ts's runBackfill. One-off backfill
 * of email_reads.hasNewEmail for rows that predate the column.
 *
 * The migration adds hasNewEmail as a nullable column with no default, so every existing row
 * starts NULL ("not computed"). A read row has new email when its lastReadEmailAt is older than
 * the ticket's current lastEmailAt. This walks the NULL rows and writes true or false; going
 * forward advanceLastEmailAt and the markAsRead / bulkMarkAsRead mutators always write it
 * explicitly. Idempotent — each batch is written with two UPDATEs guarded on
 * `hasNewEmail: null`, so a row touched mid-run by live code is left alone rather than
 * overwritten from a stale snapshot.
 *
 * Kept running in the request's async context would limit writes to the calling admin's own
 * rows; the repair spans every user in every workspace, so it runs under asSystem.
 */
export function runEmailReadFlagBackfillAsSystem(options: EmailReadFlagBackfillOptions): Promise<void> {
  return asSystem(
    ['EmailRead', 'Ticket'],
    'one-off email_reads.hasNewEmail backfill spans every user in every workspace',
    async () => {
      const summary: BackfillSummary = { batches: 0, scanned: 0, setTrue: 0, setFalse: 0 };
      const startTime = Date.now();
      logger.info('[EmailReadFlagBackfill] Starting', options);

      let cursor: string | null = null;
      while (true) {
        // `id: { gt: … }` rather than Prisma's `cursor`: rows leave the candidate set
        // (hasNewEmail: null) as they are written, and a cursor row that no longer matches
        // the where-clause would end the run early.
        const page: CandidateRead[] = await db.emailRead.findMany({
          where: { hasNewEmail: null, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true, ticketId: true, lastReadEmailAt: true },
          orderBy: { id: 'asc' },
          take: options.batchSize,
        });
        if (page.length === 0) break;
        summary.batches += 1;
        summary.scanned += page.length;

        // lastReadEmailAt < lastEmailAt spans two tables, so compare per page here.
        const tickets = await db.ticket.findMany({
          where: { id: { in: [...new Set(page.map(read => read.ticketId))] } },
          select: { id: true, lastEmailAt: true },
        });
        const lastEmailAtByTicket = new Map(tickets.map(t => [t.id, t.lastEmailAt]));

        const staleIds: string[] = [];
        const caughtUpIds: string[] = [];
        for (const read of page) {
          const lastEmailAt = lastEmailAtByTicket.get(read.ticketId);
          if (lastEmailAt !== undefined && read.lastReadEmailAt < lastEmailAt) staleIds.push(read.id);
          else caughtUpIds.push(read.id);
        }

        if (options.dryRun) {
          summary.setTrue += staleIds.length;
          summary.setFalse += caughtUpIds.length;
        } else {
          if (staleIds.length > 0) {
            const res = await db.emailRead.updateMany({
              where: { id: { in: staleIds }, hasNewEmail: null },
              data: { hasNewEmail: true },
            });
            summary.setTrue += res.count;
          }
          if (caughtUpIds.length > 0) {
            const res = await db.emailRead.updateMany({
              where: { id: { in: caughtUpIds }, hasNewEmail: null },
              data: { hasNewEmail: false },
            });
            summary.setFalse += res.count;
          }
        }

        cursor = page[page.length - 1]?.id ?? null;
        logger.info('[EmailReadFlagBackfill] Batch done', { batchRows: page.length, ...summary });
        if (page.length < options.batchSize) break;
        await sleep(options.delayMs);
      }

      logger.info('[EmailReadFlagBackfill] Done', { ...summary, durationMs: Date.now() - startTime });
    },
  );
}
