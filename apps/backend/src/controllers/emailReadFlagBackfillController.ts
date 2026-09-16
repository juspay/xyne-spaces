import { Request, Response } from 'express';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';

/**
 * One-off backfill: set email_reads.hasNewEmail for rows that predate the column.
 *
 * The migration adds hasNewEmail with DEFAULT false, but a read row is really
 * "has new email" when its lastReadEmailAt is older than the ticket's current
 * lastEmailAt. Going forward advanceLastEmailAt keeps the flag in step; this walks
 * the existing rows once and sets it where that comparison already holds.
 *
 * Run it AFTER the new backend is live: rows that go stale while old code is still
 * serving are not flagged by anything else. Re-running is safe and cheap.
 *
 * Only ever sets the flag to true. Clearing is the read path's job (markAsRead), and
 * a backfill clearing a flag from a stale snapshot could race a new email arriving.
 * Each write is guarded on the lastReadEmailAt it was computed from, so a row the
 * user re-read mid-run is left alone.
 *
 * Idempotent: rows already flagged are skipped by the candidate query.
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
  updated: number;
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
   * Next page of unflagged read rows after `cursor`, and which of them are stale.
   * The lastReadEmailAt < lastEmailAt comparison spans two tables, so the ticket
   * timestamps are fetched per page and compared here.
   */
  private static async scanPage(
    batchSize: number,
    cursor: string | null,
  ): Promise<{ page: CandidateRead[]; stale: CandidateRead[] }> {
    // `id: { gt: … }` rather than Prisma's `cursor`: this backfill removes rows from
    // the candidate set (hasNewEmail: false) as it goes, and a cursor row that no
    // longer matches the where-clause would end the run early.
    const page = await db.emailRead.findMany({
      where: { hasNewEmail: false, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, ticketId: true, lastReadEmailAt: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (page.length === 0) return { page, stale: [] };

    const tickets = await db.ticket.findMany({
      where: { id: { in: [...new Set(page.map(read => read.ticketId))] } },
      select: { id: true, lastEmailAt: true },
    });
    const lastEmailAtByTicket = new Map(tickets.map(ticket => [ticket.id, ticket.lastEmailAt]));

    const stale = page.filter(read => {
      const lastEmailAt = lastEmailAtByTicket.get(read.ticketId);
      return lastEmailAt !== undefined && read.lastReadEmailAt < lastEmailAt;
    });
    return { page, stale };
  }

  /** Guarded on the snapshot's lastReadEmailAt so a re-read since the scan wins. */
  private static async flag(read: CandidateRead): Promise<boolean> {
    const result = await db.emailRead.updateMany({
      where: { id: read.id, hasNewEmail: false, lastReadEmailAt: read.lastReadEmailAt },
      data: { hasNewEmail: true },
    });
    return result.count > 0;
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
        let totalUpdated = 0;
        let cursor = options.cursor;
        let done = false;

        for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
          const { page, stale } = await EmailReadFlagBackfillController.scanPage(
            options.batchSize,
            cursor,
          );
          if (page.length === 0) {
            done = true;
            break;
          }
          cursor = page[page.length - 1]!.id;

          let updated = 0;
          if (options.dryRun) {
            updated = stale.length;
          } else {
            for (const read of stale) {
              if (await EmailReadFlagBackfillController.flag(read)) updated += 1;
            }
          }

          totalUpdated += updated;
          batches.push({ batch: batchNumber, scanned: page.length, updated });
          logger.info(`${TAG} batch #${batchNumber}`, {
            scanned: page.length,
            updated,
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
          totalUpdated,
          batches: batches.length,
          done,
          durationMs: Date.now() - startedAt,
        });

        return {
          success: true as const,
          dryRun: options.dryRun,
          totalUpdated,
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
   * `pending` is the work outstanding (unflagged rows whose ticket has newer email);
   * `flagged` is rows already set. Scans every unflagged row, so it is as slow as a
   * dry run.
   */
  static status = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await runAsSystem(async () => {
        let pending = 0;
        let unflagged = 0;
        let cursor: string | null = null;
        for (;;) {
          const { page, stale } = await EmailReadFlagBackfillController.scanPage(
            MAX_BATCH_SIZE,
            cursor,
          );
          if (page.length === 0) break;
          unflagged += page.length;
          pending += stale.length;
          cursor = page[page.length - 1]!.id;
          if (page.length < MAX_BATCH_SIZE) break;
        }
        const flagged = await db.emailRead.count({ where: { hasNewEmail: true } });
        return { success: true as const, pending, unflagged, flagged };
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
