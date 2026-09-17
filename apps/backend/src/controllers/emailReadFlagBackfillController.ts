import { Request, Response } from 'express';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';

/**
 * One-off backfill: compute email_reads.hasNewEmail for rows that predate the column.
 *
 * The migration adds hasNewEmail as a nullable column with no default, so every
 * existing row starts NULL ("not computed"). A read row really has new email when its
 * lastReadEmailAt is older than the ticket's current lastEmailAt. This walks the NULL
 * rows and writes true or false accordingly; going forward advanceLastEmailAt and the
 * markAsRead / bulkMarkAsRead mutators always write it explicitly.
 *
 * Run it AFTER the new backend is live: rows that went stale while old code was still
 * serving are only caught here. Re-running is safe and cheap.
 *
 * Each page is written with two UPDATEs (the true rows, the false rows), both guarded on
 * `hasNewEmail: null`: live code always writes a non-null value, so a row it touched
 * mid-run (a new email flagged it, or the user re-read it) is left alone rather than
 * overwritten from a stale snapshot.
 *
 * Idempotent: only NULL rows are candidates, and each row leaves that set once written.
 *
 * Runs inside runAsSystem(): `db` is the ACL-wrapped client and email_reads writes are
 * limited to the caller's own rows in a request context. This repair spans every
 * user in every workspace, which is what the system actor is for.
 */

const TAG = '[EmailReadFlagBackfill]';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_DELAY_MS = 1_000;
/** Keeps one request under proxy timeouts. */
const DEFAULT_MAX_BATCHES = 50;
const MAX_BATCH_SIZE = 2_000;

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  maxBatches: number;
  dryRun: boolean;
  cursor: string | null;
};

type BatchResult = {
  batch: number;
  scanned: number;
  setTrue: number;
  setFalse: number;
};

type CandidateRead = {
  id: string;
  ticketId: string;
  lastReadEmailAt: Date;
};

export class EmailReadFlagBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<BackfillOptions>;
    const batchSize =
      typeof payload.batchSize === 'number' && payload.batchSize > 0
        ? Math.min(Math.floor(payload.batchSize), MAX_BATCH_SIZE)
        : DEFAULT_BATCH_SIZE;
    const delayMs =
      typeof payload.delayMs === 'number' && payload.delayMs >= 0
        ? Math.floor(payload.delayMs)
        : DEFAULT_DELAY_MS;
    const maxBatches =
      typeof payload.maxBatches === 'number' && payload.maxBatches > 0
        ? Math.floor(payload.maxBatches)
        : DEFAULT_MAX_BATCHES;

    return {
      batchSize,
      delayMs,
      maxBatches,
      dryRun: payload.dryRun === true,
      cursor: typeof payload.cursor === 'string' && payload.cursor.length > 0 ? payload.cursor : null,
    };
  }

  /**
   * Next page of not-yet-computed (NULL) read rows after `cursor`, split by whether
   * the ticket has newer email. The lastReadEmailAt < lastEmailAt comparison spans two
   * tables, so the ticket timestamps are fetched per page and compared here.
   */
  private static async scanPage(
    batchSize: number,
    cursor: string | null,
  ): Promise<{ page: CandidateRead[]; stale: CandidateRead[]; caughtUp: CandidateRead[] }> {
    // `id: { gt: … }` rather than Prisma's `cursor`: this backfill removes rows from
    // the candidate set (hasNewEmail: null) as it goes, and a cursor row that no
    // longer matches the where-clause would end the run early.
    const page = await db.emailRead.findMany({
      where: { hasNewEmail: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, ticketId: true, lastReadEmailAt: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (page.length === 0) return { page, stale: [], caughtUp: [] };

    const tickets = await db.ticket.findMany({
      where: { id: { in: [...new Set(page.map(read => read.ticketId))] } },
      select: { id: true, lastEmailAt: true },
    });
    const lastEmailAtByTicket = new Map(tickets.map(ticket => [ticket.id, ticket.lastEmailAt]));

    const stale: CandidateRead[] = [];
    const caughtUp: CandidateRead[] = [];
    for (const read of page) {
      const lastEmailAt = lastEmailAtByTicket.get(read.ticketId);
      // A read row whose ticket is gone has nothing to be unread against.
      if (lastEmailAt !== undefined && read.lastReadEmailAt < lastEmailAt) stale.push(read);
      else caughtUp.push(read);
    }
    return { page, stale, caughtUp };
  }

  /**
   * One UPDATE for a whole group of rows. The `hasNewEmail: null` guard is what keeps live
   * writes safe: markAsRead / bulkMarkAsRead always write false and advanceLastEmailAt
   * always writes true, so any row they touched since the scan is no longer NULL and is
   * skipped here. (markAsRead's no-op path writes nothing, but then lastReadEmailAt is
   * unchanged too, so the value computed from the scan still holds.)
   */
  private static async writeMany(reads: CandidateRead[], hasNewEmail: boolean): Promise<number> {
    if (reads.length === 0) return 0;
    const result = await db.emailRead.updateMany({
      where: { id: { in: reads.map(read => read.id) }, hasNewEmail: null },
      data: { hasNewEmail },
    });
    return result.count;
  }

  /**
   * POST /api/admin/email-read-flag-backfill/run
   * Body: { batchSize?: 500, delayMs?: 1000, maxBatches?: 50, dryRun?: false, cursor?: string }
   *
   * Pass the `nextCursor` from the previous response back in to continue where the
   * last request stopped; omit it to start from the beginning.
   */
  static run = async (req: Request, res: Response): Promise<void> => {
    const options = EmailReadFlagBackfillController.buildOptions(req.body);
    const startedAt = Date.now();

    logger.info(`${TAG} started`, { ...options });

    try {
      const result = await runAsSystem(async () => {
        const batches: BatchResult[] = [];
        let totalSetTrue = 0;
        let totalSetFalse = 0;
        let cursor = options.cursor;
        let done = false;

        for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
          const { page, stale, caughtUp } = await EmailReadFlagBackfillController.scanPage(
            options.batchSize,
            cursor,
          );
          if (page.length === 0) {
            done = true;
            break;
          }
          cursor = page[page.length - 1]!.id;

          let setTrue = 0;
          let setFalse = 0;
          if (options.dryRun) {
            setTrue = stale.length;
            setFalse = caughtUp.length;
          } else {
            setTrue = await EmailReadFlagBackfillController.writeMany(stale, true);
            setFalse = await EmailReadFlagBackfillController.writeMany(caughtUp, false);
          }

          totalSetTrue += setTrue;
          totalSetFalse += setFalse;
          batches.push({ batch: batchNumber, scanned: page.length, setTrue, setFalse });
          logger.info(`${TAG} batch #${batchNumber}`, {
            scanned: page.length,
            setTrue,
            setFalse,
            dryRun: options.dryRun,
          });

          if (page.length < options.batchSize) {
            done = true;
            break;
          }
          // Don't sleep only to return: skip the pause on the final allowed batch.
          if (batchNumber === options.maxBatches) break;
          if (options.delayMs > 0) {
            await EmailReadFlagBackfillController.sleep(options.delayMs);
          }
        }

        logger.info(`${TAG} finished`, {
          totalSetTrue,
          totalSetFalse,
          batches: batches.length,
          done,
          durationMs: Date.now() - startedAt,
        });

        return {
          success: true as const,
          dryRun: options.dryRun,
          totalSetTrue,
          totalSetFalse,
          batches,
          done,
          // Pass this back as `cursor` on the next request to continue.
          nextCursor: done ? null : cursor,
        };
      });
      res.json(result);
    } catch (error) {
      logger.error(`${TAG} failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ success: false, error: 'Email read flag backfill failed' });
    }
  };

  /**
   * GET /api/admin/email-read-flag-backfill/status
   * `pending` is rows still NULL (the work outstanding — 0 when the backfill is done);
   * `hasNewEmail` / `noNewEmail` are rows already computed.
   */
  static status = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await runAsSystem(async () => {
        const [pending, hasNewEmail, noNewEmail] = await Promise.all([
          db.emailRead.count({ where: { hasNewEmail: null } }),
          db.emailRead.count({ where: { hasNewEmail: true } }),
          db.emailRead.count({ where: { hasNewEmail: false } }),
        ]);
        return { success: true as const, pending, hasNewEmail, noNewEmail };
      });
      res.json(result);
    } catch (error) {
      logger.error(`${TAG} status failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, error: 'Failed to read backfill status' });
    }
  };
}
