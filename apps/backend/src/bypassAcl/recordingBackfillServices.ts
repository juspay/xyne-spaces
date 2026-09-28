import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { RecordingSummaryPointerBackfillController } from '@/controllers/recordingSummaryPointerBackfillController';
import { asSystem } from './base';

const TAG = '[RecordingSummaryPointerBackfill]';
const CANVAS_SOURCE = 'call_detailed_summary';

interface BackfillOptions {
  batchSize: number;
  delayMs: number;
  maxBatches: number;
  dryRun: boolean;
  cursor: string | null;
}

/**
 * Relocated from controllers/recordingSummaryPointerBackfillController.ts's `run`. `db` is the
 * ACL-wrapped client, and Call/Canvas both carry a workspaceId scalar, so an ordinary request
 * context would silently narrow this to the calling admin's own rows or single workspace. This
 * repair spans every workspace, which is what the system actor is for.
 */
export function runRecordingSummaryPointerBackfill(options: BackfillOptions, startedAt: number) {
  return asSystem(
    ['Call', 'Canvas'],
    'one-off backfill spans every workspace by design — ordinary request context would silently narrow it',
    async () => {
      const batches: Array<{ batch: number; updated: number; remaining: number }> = [];
      const linkedExternalIds: string[] = [];
      let totalUpdated = 0;
      let cursor = options.cursor;
      let done = false;

      for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
        const { pairs, nextCursor, exhausted } =
          await RecordingSummaryPointerBackfillController.collectLinkable(options.batchSize, cursor);
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
    },
  );
}

/**
 * Relocated from controllers/recordingSummaryPointerBackfillController.ts's `status`. Same
 * cross-workspace reasoning as runRecordingSummaryPointerBackfill above.
 */
export function getRecordingSummaryPointerBackfillStatus() {
  return asSystem(
    ['Call', 'Canvas'],
    'one-off backfill spans every workspace by design — ordinary request context would silently narrow it',
    async () => {
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
    },
  );
}
