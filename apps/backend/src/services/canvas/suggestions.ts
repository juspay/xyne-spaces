/**
 * Suggestion storage and accept orchestration.
 *
 * createSuggestionBatch parks an agent's derived ops as PENDING rows (the
 * document is untouched). applySuggestionChanges applies accepted rows in one
 * batch: one read, pure apply (suggestionApply.ts), one undo snapshot, one
 * Y-Sweet write, then statuses — all under a per-canvas lock.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseClient } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { createBlockRenderer } from './blockRender';
import { hashBlocks, stableStringify } from './blockHash';
import type { DerivedOp } from './blockLabels';
import { applyOps, type SuggestionRowLike } from './suggestionApply';
// Relative import on purpose: the backend's "@xyne/shared" alias points at the
// package's BUILT output, and this pure module must be usable (and testable)
// without a rebuild. The dashboard imports the same file via "@xyne/shared".
import { computeDeletionEvents } from '../../../../../packages/shared/src/canvas/blockDeletionEvents';

const LOCK_TTL_SECONDS = 30;

/** Serialises concurrent accepts on one canvas; the loser gets onBusy(). */
async function withCanvasLock<T>(canvasId: string, fn: () => Promise<T>, onBusy: () => T): Promise<T> {
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

/** stableStringify drops undefined values Prisma rejects (e.g. table columnWidths). */
function toJsonSafe(value: unknown): unknown {
  return JSON.parse(stableStringify(value));
}

const topLevelIds = (blocks: BlockNoteBlock[]): string[] =>
  blocks.map(b => (b as { id?: string }).id).filter((id): id is string => Boolean(id));

export interface CreateBatchInput {
  workspaceId: string;
  canvasId: string;
  ops: DerivedOp[];
}

export async function createSuggestionBatch({ workspaceId, canvasId, ops }: CreateBatchInput): Promise<{ batchId: string; created: number }> {
  const prisma = DatabaseClient.getInstance();
  const batchId = randomUUID();

  // Row ids first: an insert's id doubles as its future block id, and anchors
  // may reference a same-reply new block by op key.
  const idByKey = new Map(ops.map(op => [op.key, randomUUID()]));
  const anchorIdOf = (op: DerivedOp): string | null => {
    if (op.anchor === null || op.anchor === undefined) return null;
    return op.anchor.kind === 'block' ? op.anchor.ref : (idByKey.get(op.anchor.ref) as string);
  };

  const rows = ops.map(op => ({
    workspaceId,
    id: idByKey.get(op.key) as string,
    canvasId,
    batchId,
    op: op.op,
    blockId: op.blockId ?? null,
    proposedAnchorId: op.op === 'insert' || op.op === 'move' ? anchorIdOf(op) : null,
    currentAnchorId: op.op === 'insert' || op.op === 'move' ? anchorIdOf(op) : null,
    orderIndex: op.orderIndex,
    ...(op.beforeContent !== undefined ? { beforeContent: toJsonSafe(op.beforeContent) as never } : {}),
    ...(op.afterMarkdown !== undefined ? { afterContent: { markdown: op.afterMarkdown } as never } : {}),
    status: 'PENDING',
  }));

  const targetIds = ops.map(op => op.blockId).filter((id): id is string => Boolean(id));
  await prisma.$transaction(async tx => {
    if (targetIds.length) {
      // A newer proposal supersedes older pending rows for the same blocks.
      await tx.canvasSuggestionChange.updateMany({
        where: { canvasId, status: 'PENDING', blockId: { in: targetIds } },
        data: { status: 'SUPERSEDED' },
      });
    }
    await tx.canvasSuggestionChange.createMany({ data: rows });
  });

  logger.info(`[Suggestions] Parked batch ${batchId} on canvas ${canvasId}: ${rows.length} changes`);
  return { batchId, created: rows.length };
}

export interface BatchResult {
  applied: number;
  stale: number;
  versionId: string | null;
  error?: string;
}

export async function applySuggestionChanges(changeIds: string[], actorUserId: string): Promise<BatchResult> {
  const empty: BatchResult = { applied: 0, stale: 0, versionId: null };
  if (!changeIds.length) return empty;

  const prisma = DatabaseClient.getInstance();
  const rows = await prisma.canvasSuggestionChange.findMany({
    where: { id: { in: changeIds }, status: 'PENDING' },
    orderBy: { orderIndex: 'asc' },
  });
  if (!rows.length) return empty;

  const canvasIds = new Set(rows.map(r => r.canvasId));
  if (canvasIds.size > 1) return { ...empty, error: 'Changes span multiple canvases' };
  const canvasId = rows[0]!.canvasId;

  return withCanvasLock(
    canvasId,
    async () => {
      const current = await readFromYSweet(canvasId);
      const renderer = await createBlockRenderer(current);
      const preIds = topLevelIds(current);

      const outcome = await applyOps(current, rows as SuggestionRowLike[], renderer.toBlocks);

      const markStatuses = async (ids: string[], status: string): Promise<void> => {
        if (!ids.length) return;
        await prisma.canvasSuggestionChange.updateMany({ where: { id: { in: ids } }, data: { status } });
      };

      if (!outcome.applied.length) {
        await markStatuses(outcome.stale, 'STALE');
        return { applied: 0, stale: outcome.stale.length, versionId: null };
      }

      // One undo snapshot of the pre-apply state; an existing identical
      // version already serves as the undo point.
      const contentHash = hashBlocks(current);
      let versionId: string | null = null;
      const existing = await prisma.canvasVersion.findFirst({ where: { canvasId, contentHash }, select: { id: true } });
      if (existing) {
        versionId = existing.id;
      } else {
        const created = await prisma.canvasVersion
          .create({
            data: {
              workspaceId: rows[0]!.workspaceId,
              id: randomUUID(),
              canvasId,
              name: `Before AI changes · ${new Date().toLocaleString()}`,
              content: toJsonSafe(current) as never,
              contentHash,
              createdBy: actorUserId,
            },
            select: { id: true },
          })
          .catch(() => null);
        versionId = created?.id ?? null;
        if (!versionId) logger.warn('[Suggestions] Could not snapshot an undo point; applying anyway');
      }

      const ok = await syncToYSweet(canvasId, outcome.blocks);
      if (!ok) {
        logger.error(`[Suggestions] Y-Sweet write failed for canvas ${canvasId}; no statuses written`);
        return { ...empty, error: 'Collaboration sync failed; no changes applied' };
      }

      await markStatuses(outcome.applied, 'ACCEPTED');
      await markStatuses(outcome.stale, 'STALE');

      // Forward anchors of OTHER pending rows past blocks this batch deleted.
      const events = computeDeletionEvents(preIds, topLevelIds(outcome.blocks));
      for (const event of events) {
        await prisma.canvasSuggestionChange.updateMany({
          where: { canvasId, status: 'PENDING', currentAnchorId: event.deletedId },
          data: { currentAnchorId: event.previousAliveId },
        });
      }

      logger.info(
        `[Suggestions] canvas ${canvasId}: applied ${outcome.applied.length}, stale ${outcome.stale.length}`
      );
      return {
        applied: outcome.applied.length,
        stale: outcome.stale.length,
        versionId,
      };
    },
    () => ({ ...empty, error: 'Another change is being applied to this canvas; try again' })
  );
}
