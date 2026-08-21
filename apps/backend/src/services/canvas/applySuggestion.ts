/**
 * Apply accepted suggestion changes to the live canvas.
 *
 * Batch-first: N changes = one read, one conflict pass, one undo snapshot,
 * one Y-Sweet write. Applying one at a time would rewrite the document N
 * times and lose inserts anchored to blocks deleted earlier in the batch.
 *
 * Partial application is deliberate: clean changes apply even when others
 * in the batch conflict.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseClient } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { applyChanges, type BlockChange } from './applyBlockChanges';
import { createBlockRenderer } from './blockRender';
import { hashBlock, hashBlocks, findBlockById, stableStringify } from './blockHash';
import { resolveVirtualAnchor } from './virtualAnchor';

export interface BatchResult {
  applied: number;
  conflicted: number;
  stale: number;
  versionId: string | null;
  error?: string;
}

const LOCK_TTL_SECONDS = 30;

/** Serialises concurrent accepts on one canvas; the loser gets onBusy(). */
async function withCanvasLock<T>(
  canvasId: string,
  fn: () => Promise<T>,
  onBusy: () => T
): Promise<T> {
  const key = `canvas-apply-lock:${canvasId}`;
  const acquired = await redisService
    .set(key, '1', LOCK_TTL_SECONDS, true)
    .catch(() => true); // Redis down: proceed rather than block the feature
  if (!acquired) return onBusy();
  try {
    return await fn();
  } finally {
    await redisService.del(key).catch(() => undefined);
  }
}

export async function applySuggestionChanges(
  changeIds: string[],
  actorUserId: string
): Promise<BatchResult> {
  const empty: BatchResult = { applied: 0, conflicted: 0, stale: 0, versionId: null };
  if (!changeIds.length) return empty;

  const prisma = DatabaseClient.getInstance();
  const rows = await prisma.canvasSuggestionChange.findMany({
    where: { id: { in: changeIds } },
    include: { suggestion: true },
    orderBy: { orderIndex: 'asc' },
  });
  if (!rows.length) return empty;

  const canvasIds = new Set(rows.map(r => r.suggestion.canvasId));
  if (canvasIds.size > 1) {
    return { ...empty, error: 'Changes span multiple canvases' };
  }
  const canvasId = rows[0]!.suggestion.canvasId;

  return withCanvasLock(
    canvasId,
    async () => {
      // ── one read ──────────────────────────────────────────────────────
      const current = await readFromYSweet(canvasId);
      const renderer = await createBlockRenderer(current);
      const currentIds = new Set(
        current.map(b => (b as { id?: string }).id).filter(Boolean) as string[]
      );

      // Anchor-resolver inputs: frozen block order + this suggestion's insert slots.
      const suggestionRow = rows[0]!.suggestion;
      const baseOrder = (suggestionRow.baseBlockIds ?? []) as string[];
      const allInserts = await prisma.canvasSuggestionChange.findMany({
        where: { suggestionId: suggestionRow.id, op: 'insert_after' },
        select: { id: true, basePos: true, orderIndex: true },
      });
      const slots = allInserts
        .filter(r => r.basePos !== null)
        .map(r => ({ rowId: r.id, basePos: r.basePos as number, orderIndex: r.orderIndex }));

      const applicable: { row: (typeof rows)[number]; change: BlockChange }[] = [];
      const conflicted: string[] = [];
      const stale: string[] = [];

      // ── one conflict-check pass, all against the SAME snapshot ────────
      for (const row of rows) {
        if (row.blockId) {
          const target = findBlockById(current, row.blockId);
          if (!target) {
            stale.push(row.id);
            continue;
          }
          // Hash derived on both sides — no stored hash column to drift.
          if (row.beforeContent && hashBlock(target) !== hashBlock(row.beforeContent as never)) {
            conflicted.push(row.id);
            continue;
          }
        }

        let afterContent: BlockNoteBlock | null = null;
        const proposed = row.afterContent as { markdown?: string } | null;
        if (proposed?.markdown) {
          const parsed = await renderer.toBlocks(proposed.markdown);
          afterContent = parsed[0] ?? null;
          if (!afterContent) {
            stale.push(row.id);
            continue;
          }
          if (row.op === 'insert_after') {
            afterContent = { ...(afterContent as object), id: row.id } as BlockNoteBlock;
          }
        }

        // Re-anchor the insert against the live document via the frozen order.
        let anchor: string | null = null;
        if (row.op === 'insert_after') {
          anchor =
            row.basePos !== null && baseOrder.length
              ? resolveVirtualAnchor(
                  baseOrder,
                  { rowId: row.id, basePos: row.basePos, orderIndex: row.orderIndex },
                  currentIds,
                  slots.filter(sl => sl.rowId !== row.id)
                )
              : null; // no basePos → prepend
        }

        applicable.push({
          row,
          change: {
            op: row.op as BlockChange['op'],
            blockId: row.blockId,
            afterBlockId: anchor,
            afterContent,
            orderIndex: row.orderIndex,
          },
        });
      }

      if (!applicable.length) {
        await markStatuses(conflicted, 'CONFLICT');
        await markStatuses(stale, 'STALE');
        return { applied: 0, conflicted: conflicted.length, stale: stale.length, versionId: null };
      }

      // ── one snapshot: the document before this whole batch ────────────
      const contentHash = hashBlocks(current);
      let versionId: string | null = null;

      // (canvasId, contentHash) is unique — an existing snapshot of this exact
      // state already serves as the undo point.
      const existing = await prisma.canvasVersion.findFirst({
        where: { canvasId, contentHash },
        select: { id: true },
      });
      if (existing) {
        versionId = existing.id;
        logger.debug('[ApplySuggestion] Reusing existing snapshot as the undo point');
      } else {
        const created = await prisma.canvasVersion
          .create({
            data: {
              workspaceId: rows[0]!.suggestion.workspaceId,
              id: randomUUID(),
              canvasId,
              name: `Before AI changes · ${new Date().toLocaleString()}`,
              // stableStringify drops undefined values Prisma rejects (table columnWidths).
              content: JSON.parse(stableStringify(current)) as never,
              contentHash,
              createdBy: actorUserId,
            },
            select: { id: true },
          })
          .catch(() => null);
        versionId = created?.id ?? null;
        if (!versionId) {
          logger.warn('[ApplySuggestion] Could not snapshot an undo point; applying anyway');
        }
      }

      // ── one apply, one write ──────────────────────────────────────────
      const { blocks, skipped } = applyChanges(
        current,
        applicable.map(a => a.change)
      );
      const skippedIds = new Set(
        skipped.map(s => applicable.find(a => a.change === s)?.row.id).filter(Boolean) as string[]
      );

      const ok = await syncToYSweet(canvasId, blocks);
      if (!ok) {
        logger.error(`[ApplySuggestion] Y-Sweet write failed for canvas ${canvasId}`);
        return { ...empty, error: 'Collaboration sync failed; no changes applied' };
      }

      const appliedIds = applicable.map(a => a.row.id).filter(id => !skippedIds.has(id));
      await markStatuses(appliedIds, 'ACCEPTED');
      await markStatuses(conflicted, 'CONFLICT');
      await markStatuses([...stale, ...skippedIds], 'STALE');
      await closeResolvedSuggestions(rows.map(r => r.suggestionId));

      logger.info(
        `[ApplySuggestion] canvas ${canvasId}: applied ${appliedIds.length}, ` +
          `conflicted ${conflicted.length}, stale ${stale.length + skippedIds.size}`
      );
      return {
        applied: appliedIds.length,
        conflicted: conflicted.length,
        stale: stale.length + skippedIds.size,
        versionId,
      };
    },
    () => ({ ...empty, error: 'Another change is being applied to this canvas; try again' })
  );
}

/** Single-change convenience wrapper. */
export async function applySuggestionChange(
  changeId: string,
  actorUserId: string
): Promise<boolean> {
  const result = await applySuggestionChanges([changeId], actorUserId);
  return result.applied === 1;
}


async function markStatuses(ids: string[], status: string): Promise<void> {
  if (!ids.length) return;
  const prisma = DatabaseClient.getInstance();
  await prisma.canvasSuggestionChange.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
}

/** A batch is done once none of its changes are still PENDING. */
async function closeResolvedSuggestions(suggestionIds: string[]): Promise<void> {
  const prisma = DatabaseClient.getInstance();
  for (const suggestionId of new Set(suggestionIds)) {
    const pending = await prisma.canvasSuggestionChange.count({
      where: { suggestionId, status: 'PENDING' },
    });
    if (pending > 0) continue;
    await prisma.canvasSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'ACCEPTED' },
    });
  }
}
