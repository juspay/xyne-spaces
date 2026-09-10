import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';

/**
 * One-off backfill: link orphaned detailed-summary canvases onto their Call row.
 *
 * Both summary pipelines create the same canvas — Canvas.metadata
 * {source:'call_detailed_summary', callId} — but only the note-taker pipeline
 * writes the pointer the v2 recording screen reads
 * (Call.metadata.detailedSummaryCanvasId). Recordings processed by the older
 * pipeline have the canvas linked from the call MESSAGE instead
 * (callDocumentService 'detailedSummaryCanvasUrl'), so v2 renders "Not generated"
 * even though a full summary exists. This walks those rows in batches and writes
 * the pointer, matching the canvas the same way findExistingDetailedSummaryCanvas
 * does (canvasService.ts).
 *
 * RUN WITH NO ACTIVE RECORDINGS. Prisma cannot express a partial JSON update, so
 * each row is a read-merge-write of the whole metadata column. If a pipeline were
 * writing the same row concurrently (transcriptEntryCount, notesCanvasId,
 * linkedTicketId), the merge could drop its key — the same failure mode as the
 * stale-snapshot merge in noteTakerTranscriptService.finalizeCallUpdates. With
 * recordings quiesced there is no concurrent writer and the merge is safe.
 *
 * Idempotent: only rows whose pointer is still absent are selected, so re-running
 * after the pipeline cutover picks up just the stragglers.
 *
 * Runs inside runAsSystem(): `db` is the ACL-wrapped client, and Call/Canvas both
 * carry a workspaceId scalar, so an ordinary request context would silently narrow
 * this to the calling admin's own rows (isRequestContext() applies the per-table
 * user ACL) or at best to their single workspace. This repair spans every
 * workspace, which is what the system actor is for.
 */

const TAG = '[RecordingSummaryPointerBackfill]';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DELAY_MS = 5_000;
/** Keeps one request under proxy timeouts: 20 x (50 rows + 5s) ~= 100s. */
const DEFAULT_MAX_BATCHES = 20;
const MAX_BATCH_SIZE = 500;
/** How many calls to scan per page while hunting for rows that have a canvas. */
const SCAN_PAGE_SIZE = 200;
const CANVAS_SOURCE = 'call_detailed_summary';
const POINTER_KEY = 'detailedSummaryCanvasId';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  maxBatches: number;
  dryRun: boolean;
  cursor: string | null;
};

type BatchResult = {
  batch: number;
  updated: number;
  /** Candidate rows left to scan after this batch (not all are linkable). */
  remaining: number;
};

type CandidateCall = {
  id: string;
  externalId: string;
  metadata: Prisma.JsonValue;
};

type LinkablePair = {
  call: CandidateCall;
  canvasId: string;
};

export class RecordingSummaryPointerBackfillController {
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
   * Recordings whose pointer is absent. `AnyNull` covers both a missing key and an
   * explicit JSON null, matching `metadata ->> 'detailedSummaryCanvasId' IS NULL`.
   */
  private static candidateWhere(): Prisma.CallWhereInput {
    return {
      callType: 'HEADLESS',
      metadata: { path: [POINTER_KEY], equals: Prisma.AnyNull },
    };
  }

  private static asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * Newest summary canvas per callId, for a page of calls, in a single query.
   * Calls with no canvas simply don't come back — they're skipped, and the cursor
   * moves past them so they're never re-scanned.
   */
  private static async findCanvasesFor(calls: CandidateCall[]): Promise<Map<string, string>> {
    if (calls.length === 0) return new Map();

    const canvases = await db.canvas.findMany({
      where: {
        metadata: { path: ['source'], equals: CANVAS_SOURCE },
        OR: calls.map(call => ({ metadata: { path: ['callId'], equals: call.externalId } })),
      },
      select: { id: true, metadata: true },
      // Newest first, so the first hit per callId wins the duplicate case.
      orderBy: { updatedAt: 'desc' },
    });

    const byCallId = new Map<string, string>();
    for (const canvas of canvases) {
      const callId = RecordingSummaryPointerBackfillController.asRecord(canvas.metadata)['callId'];
      if (typeof callId !== 'string' || byCallId.has(callId)) continue;
      byCallId.set(callId, canvas.id);
    }
    return byCallId;
  }

  /**
   * Scan forward from `cursor` until `batchSize` linkable rows are found or the
   * table is exhausted. Scanning past canvas-less rows here (rather than
   * re-selecting them every batch) is what keeps the run draining.
   */
  private static async collectLinkable(
    batchSize: number,
    cursor: string | null,
  ): Promise<{ pairs: LinkablePair[]; nextCursor: string | null; exhausted: boolean }> {
    const pairs: LinkablePair[] = [];
    let scanCursor = cursor;

    for (;;) {
      // `id: { gt: … }` rather than Prisma's `cursor`: cursor pagination needs the
      // cursor row to still match the where-clause, and this backfill removes rows
      // from the candidate set by writing the very key the clause filters on. A
      // cursor pointing at an already-linked row returns an empty page, which
      // silently ends the run with rows left behind.
      const page: CandidateCall[] = await db.call.findMany({
        where: {
          ...RecordingSummaryPointerBackfillController.candidateWhere(),
          ...(scanCursor ? { id: { gt: scanCursor } } : {}),
        },
        select: { id: true, externalId: true, metadata: true },
        orderBy: { id: 'asc' },
        take: SCAN_PAGE_SIZE,
      });

      if (page.length === 0) {
        return { pairs, nextCursor: scanCursor, exhausted: true };
      }

      const canvasByCallId =
        await RecordingSummaryPointerBackfillController.findCanvasesFor(page);

      for (const call of page) {
        scanCursor = call.id;
        const canvasId = canvasByCallId.get(call.externalId);
        if (!canvasId) continue;
        pairs.push({ call, canvasId });
        if (pairs.length >= batchSize) {
          return { pairs, nextCursor: scanCursor, exhausted: false };
        }
      }

      if (page.length < SCAN_PAGE_SIZE) {
        return { pairs, nextCursor: scanCursor, exhausted: true };
      }
    }
  }

  /**
   * Write the pointer, preserving every other metadata key. The `AnyNull` guard in
   * the where-clause means a row that gained a pointer since it was read is left
   * alone rather than overwritten, and `count` reports what actually changed.
   */
  private static async linkPair(pair: LinkablePair): Promise<boolean> {
    const metadata = RecordingSummaryPointerBackfillController.asRecord(pair.call.metadata);
    const result = await db.call.updateMany({
      where: {
        id: pair.call.id,
        metadata: { path: [POINTER_KEY], equals: Prisma.AnyNull },
      },
      data: {
        metadata: { ...metadata, [POINTER_KEY]: pair.canvasId } as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  /** Candidate rows left to scan after `cursor` — not all of them are linkable. */
  private static async countRemaining(cursor: string | null): Promise<number> {
    return db.call.count({
      where: {
        ...RecordingSummaryPointerBackfillController.candidateWhere(),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
    });
  }

  /**
   * POST /api/admin/recording-pointer-backfill/run
   * Body: { batchSize?: 50, delayMs?: 5000, maxBatches?: 20, dryRun?: false, cursor?: string }
   *
   * Pass the `nextCursor` from the previous response back in to continue where the
   * last request stopped; omit it to start from the beginning. Continuing by cursor
   * is what stops each new request re-scanning the ~768 recordings that have no
   * canvas and never will.
   */
  static run = async (req: Request, res: Response): Promise<void> => {
    const options = RecordingSummaryPointerBackfillController.buildOptions(req.body);
    const startedAt = Date.now();

    logger.info(`${TAG} started`, { ...options });

    try {
      const result = await runAsSystem(async () => {
      const batches: BatchResult[] = [];
      const linkedExternalIds: string[] = [];
      let totalUpdated = 0;
      let cursor = options.cursor;
      let done = false;

      for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
        const { pairs, nextCursor, exhausted } =
          await RecordingSummaryPointerBackfillController.collectLinkable(
            options.batchSize,
            cursor,
          );
        cursor = nextCursor;

        let updated = 0;
        if (!options.dryRun) {
          for (const pair of pairs) {
            if (await RecordingSummaryPointerBackfillController.linkPair(pair)) {
              updated += 1;
              linkedExternalIds.push(pair.call.externalId);
            }
          }
        } else {
          updated = pairs.length;
          linkedExternalIds.push(...pairs.map(pair => pair.call.externalId));
        }

        totalUpdated += updated;
        const remaining = await RecordingSummaryPointerBackfillController.countRemaining(cursor);
        batches.push({ batch: batchNumber, updated, remaining });
        logger.info(`${TAG} batch #${batchNumber}`, {
          updated,
          remaining,
          dryRun: options.dryRun,
        });

        if (exhausted) {
          done = true;
          break;
        }
        // Don't sleep only to return: skip the pause on the final allowed batch.
        if (batchNumber === options.maxBatches) break;
        if (options.delayMs > 0) {
          await RecordingSummaryPointerBackfillController.sleep(options.delayMs);
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
        // The rollback key: removing 'detailedSummaryCanvasId' from these rows
        // restores the exact prior state, since only absent keys were written.
        linkedExternalIds,
      };
      });
      res.json(result);
    } catch (error) {
      logger.error(`${TAG} failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ success: false, error: 'Recording pointer backfill failed' });
    }
  };

  /**
   * GET /api/admin/recording-pointer-backfill/status
   * `linkable` is the real work outstanding; `pointerAbsent` includes recordings
   * that have no canvas to link and never will (no transcript, or a short summary
   * only), which is why the two differ.
   */
  static status = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await runAsSystem(async () => {
      const pointerAbsent = await RecordingSummaryPointerBackfillController.countRemaining(null);

      const canvases = await db.canvas.findMany({
        where: { metadata: { path: ['source'], equals: CANVAS_SOURCE } },
        select: { metadata: true },
      });
      const callIds = [
        ...new Set(
          canvases
            .map(canvas => RecordingSummaryPointerBackfillController.asRecord(canvas.metadata)['callId'])
            .filter((callId): callId is string => typeof callId === 'string'),
        ),
      ];

      const linkable = callIds.length
        ? await db.call.count({
            where: {
              ...RecordingSummaryPointerBackfillController.candidateWhere(),
              externalId: { in: callIds },
            },
          })
        : 0;

      return { success: true as const, linkable, pointerAbsent, summaryCanvases: callIds.length };
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
