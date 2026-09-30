import type { Prisma } from '@prisma/client';
import {
  SDLC_CONTAINMENT_RELATION,
  SDLC_FOLDER_FLAT_RELATION,
  SDLC_TREE_TARGET_TYPES,
  planSdlcFolderEdges,
  type SdlcFolderEdge,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem } from './base';

/**
 * One-off backfill of SDLC folder edges: an edge from every folder an item sits
 * under, however deep. The writers keep them from here on; this gives the items
 * filed before they did the same edges.
 *
 * Worked out per hub from its containment edges, with the rule the writers use
 * (planSdlcFolderEdges), so it also removes folder edges that no longer match where
 * an item is filed. Idempotent: a hub with nothing to change is skipped, so a re-run
 * only picks up what is still off.
 *
 * Rollback: every edge it writes is derived, so deleting the FOLDER_ITEM_SECONDARY
 * rows it added undoes it — though the writers will have added some since.
 *
 * Runs as the system actor: `db` is ACL-wrapped, and the repair spans every hub in
 * every workspace, which a request context would narrow to the caller's.
 */

const TAG = '[SdlcFolderEdgeBackfill]';
const REASON =
  "one-off backfill of SDLC folder edges spans every hub in every workspace; a request context would narrow it to the caller's";
/** Deeper than any real tree; stops a cycle in the data from walking forever. */
const MAX_DEPTH = 64;

export interface SdlcFolderEdgeBackfillOptions {
  /** Edges written or removed per batch. */
  batchSize: number;
  /** Pause between batches. */
  delayMs: number;
  /** Batches per request, so one request stays under proxy timeouts. */
  maxBatches: number;
  dryRun: boolean;
  /** The hub to resume from, as the previous response's `nextCursor`. */
  cursor: string | null;
}

interface HubWork {
  add: Prisma.SdlcEntityLinkCreateManyInput[];
  remove: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hubs that file anything into a folder, or still hold folder edges, from `cursor` on. */
async function hubsFrom(cursor: string | null): Promise<string[]> {
  const rows = await db.sdlcEntityLink.findMany({
    where: {
      OR: [
        { relationType: SDLC_CONTAINMENT_RELATION, sourceType: 'FOLDER' },
        { relationType: SDLC_FOLDER_FLAT_RELATION },
      ],
      ...(cursor ? { channelId: { gte: cursor } } : {}),
    },
    distinct: ['channelId'],
    orderBy: { channelId: 'asc' },
    select: { channelId: true },
  });
  return rows.map((row) => row.channelId);
}

/**
 * What one hub's folder edges are missing, and which of them no longer match where
 * items are filed. Read fresh each time: members keep filing and moving things
 * while this runs.
 */
async function hubWork(channelId: string): Promise<HubWork> {
  const [containment, folderEdges] = await Promise.all([
    db.sdlcEntityLink.findMany({
      where: {
        channelId,
        relationType: SDLC_CONTAINMENT_RELATION,
        sourceType: { in: ['TRACK', 'FOLDER'] },
        targetType: { in: [...SDLC_TREE_TARGET_TYPES] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        workspaceId: true,
        sourceType: true,
        sourceId: true,
        targetType: true,
        targetId: true,
        createdBy: true,
      },
    }),
    db.sdlcEntityLink.findMany({
      where: { channelId, relationType: SDLC_FOLDER_FLAT_RELATION },
      select: { id: true, sourceId: true, targetType: true, targetId: true },
    }),
  ]);

  // Where each item is filed, by `TYPE:id`. An item filed twice is bad data; its
  // first placement wins, as it does for the tree.
  const placement = new Map<string, (typeof containment)[number]>();
  for (const edge of containment) {
    const key = `${edge.targetType}:${edge.targetId}`;
    if (!placement.has(key)) placement.set(key, edge);
  }
  const incoming = new Map<string, SdlcFolderEdge[]>();
  const items = new Map<string, { type: string; id: string }>();
  for (const edge of folderEdges) {
    const key = `${edge.targetType}:${edge.targetId}`;
    incoming.set(key, [...(incoming.get(key) ?? []), edge]);
    items.set(key, { type: edge.targetType, id: edge.targetId });
  }
  for (const [key, edge] of placement) {
    items.set(key, { type: edge.targetType, id: edge.targetId });
  }

  const work: HubWork = { add: [], remove: [] };
  for (const [key, item] of items) {
    const filed = placement.get(key);
    const ancestors: string[] = [];
    for (
      let parent = filed;
      parent?.sourceType === 'FOLDER' &&
      ancestors.length < MAX_DEPTH &&
      !ancestors.includes(parent.sourceId);
      parent = placement.get(`FOLDER:${parent.sourceId}`)
    ) {
      ancestors.push(parent.sourceId);
    }
    const plan = planSdlcFolderEdges({
      item,
      ancestors,
      descendants: [],
      existing: incoming.get(key) ?? [],
    });
    work.remove.push(...plan.remove);
    if (!filed) continue;
    for (const edge of plan.add) {
      work.add.push({
        workspaceId: filed.workspaceId,
        channelId,
        sourceType: 'FOLDER',
        ...edge,
        relationType: SDLC_FOLDER_FLAT_RELATION,
        // Whoever filed the item, as for the edge that files it.
        createdBy: filed.createdBy,
      });
    }
  }
  return work;
}

/** Every hub's outstanding work, without writing anything. */
async function pendingWork(hubs: string[]) {
  const pendingHubs: Array<{ channelId: string; add: number; remove: number }> = [];
  for (const channelId of hubs) {
    const work = await hubWork(channelId);
    if (work.add.length + work.remove.length > 0) {
      pendingHubs.push({ channelId, add: work.add.length, remove: work.remove.length });
    }
  }
  return {
    success: true as const,
    dryRun: true,
    hubsScanned: hubs.length,
    pending: {
      add: pendingHubs.reduce((sum, hub) => sum + hub.add, 0),
      remove: pendingHubs.reduce((sum, hub) => sum + hub.remove, 0),
    },
    hubs: pendingHubs,
  };
}

/** What is left to do, across every hub. Writes nothing. */
export function getSdlcFolderEdgeBackfillStatus() {
  return asSystem(['SdlcEntityLink'], REASON, async () => pendingWork(await hubsFrom(null)));
}

/**
 * Writes the missing folder edges and removes stale ones, `batchSize` at a time with
 * `delayMs` between batches, for at most `maxBatches` batches. Continue with the
 * returned `nextCursor` until `done`.
 */
export function runSdlcFolderEdgeBackfill(options: SdlcFolderEdgeBackfillOptions) {
  return asSystem(['SdlcEntityLink'], REASON, async () => {
    const startedAt = Date.now();
    const hubs = await hubsFrom(options.cursor);
    if (options.dryRun) return { ...(await pendingWork(hubs)), done: true, nextCursor: null };

    const batches: Array<{ batch: number; channelId: string; added: number; removed: number }> = [];
    let nextCursor: string | null = null;
    hubs: for (const channelId of hubs) {
      for (;;) {
        const work = await hubWork(channelId);
        const remove = work.remove.slice(0, options.batchSize);
        const add = work.add.slice(0, options.batchSize - remove.length);
        if (remove.length + add.length === 0) break;
        if (batches.length === options.maxBatches) {
          nextCursor = channelId;
          break hubs;
        }
        if (batches.length > 0 && options.delayMs > 0) await sleep(options.delayMs);
        const removed =
          remove.length > 0
            ? (await db.sdlcEntityLink.deleteMany({ where: { id: { in: remove } } })).count
            : 0;
        const added =
          add.length > 0
            ? (await db.sdlcEntityLink.createMany({ data: add, skipDuplicates: true })).count
            : 0;
        const batch = { batch: batches.length + 1, channelId, added, removed };
        batches.push(batch);
        logger.info(`${TAG} batch`, batch);
        // Nothing written means the remaining work can't be written; move on
        // rather than retrying the same rows forever.
        if (added + removed === 0) break;
      }
    }

    const result = {
      success: true as const,
      dryRun: false,
      added: batches.reduce((sum, batch) => sum + batch.added, 0),
      removed: batches.reduce((sum, batch) => sum + batch.removed, 0),
      batches,
      done: nextCursor === null,
      // Pass back as `cursor` to continue from the hub this stopped in.
      nextCursor,
    };
    logger.info(`${TAG} finished`, {
      added: result.added,
      removed: result.removed,
      batches: batches.length,
      done: result.done,
      durationMs: Date.now() - startedAt,
    });
    return result;
  });
}
