/**
 * Persist and resolve canvas suggestions.
 *
 * Nothing here touches Y-Sweet. A suggestion is inert until a human accepts
 * it, at which point the accept path applies it and writes.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import type { MatchedChange } from './blockMatch';
import { stableStringify } from './blockHash';

/**
 * Prisma refuses `undefined` inside JSON arrays — it wants null or the key
 * dropped. BlockNote emits exactly that: a table with unsized columns carries
 * columnWidths: [undefined, undefined, …], which made storing any table block
 * fail with "Can not use `undefined` value within array".
 *
 * stableStringify already drops undefined (it exists for hashing), so a
 * round trip through it produces JSON Prisma accepts.
 */
const toJsonSafe = <T>(value: T): T =>
  value === null || value === undefined
    ? (value as T)
    : (JSON.parse(stableStringify(value)) as T);

export interface CreateSuggestionInput {
  workspaceId: string;
  canvasId: string;
  createdBy: string;
  currentBlocks: BlockNoteBlock[];
  changes: MatchedChange[];
}

export interface CreatedSuggestion {
  id: string;
  changeCount: number;
}

export async function createSuggestion(
  input: CreateSuggestionInput
): Promise<CreatedSuggestion> {
  const prisma = DatabaseClient.getInstance();
  const suggestionId = randomUUID();

  await prisma.$transaction(async tx => {
    await tx.canvasSuggestion.create({
      data: {
        workspaceId: input.workspaceId,
        id: suggestionId,
        canvasId: input.canvasId,
        baseBlockIds: input.currentBlocks
          .map(b => (b as { id?: string }).id)
          .filter(Boolean) as string[],
        status: 'PENDING',
        createdBy: input.createdBy,
      },
    });

    if (input.changes.length) {
      await tx.canvasSuggestionChange.createMany({
        data: input.changes.map(change => ({
          workspaceId: input.workspaceId,
          id: randomUUID(),
          suggestionId,
          op: change.op,
          blockId: change.blockId,
          basePos: change.basePos,
          beforeContent: (change.beforeContent ? toJsonSafe(change.beforeContent) : undefined) as never,
          afterContent: change.afterMarkdown
            ? ({ markdown: change.afterMarkdown } as never)
            : undefined,
          status: 'PENDING',
          orderIndex: change.orderIndex,
        })),
      });
    }
  });

  const methodCounts = input.changes.reduce<Record<string, number>>((m, c) => {
    m[c.matchMethod] = (m[c.matchMethod] ?? 0) + 1;
    return m;
  }, {});
  logger.info(
    `[Suggestions] Parked ${input.changes.length} change(s) for canvas ${input.canvasId} ` +
      `(suggestion ${suggestionId}) methods=${JSON.stringify(methodCounts)}`
  );
  return { id: suggestionId, changeCount: input.changes.length };
}

/** Pending suggestions for a canvas, newest first, with their changes. */
export async function listPendingSuggestions(canvasId: string) {
  const prisma = DatabaseClient.getInstance();
  return prisma.canvasSuggestion.findMany({
    where: { canvasId, status: 'PENDING' },
    include: { changes: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}
