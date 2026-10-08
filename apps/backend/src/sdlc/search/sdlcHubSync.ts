import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import vespa from '@/vespa/client';
import { vespaQueue } from '@/queues/vespaQueue';
import {
  channelSchema,
  fileSchema,
  messageSchema,
  SDLC_FILE_FIELDS,
  SDLC_DISCUSSION_FIELDS,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  SubApp,
  ticketSchema,
  type VespaSchema,
} from '@/vespa/src/types';
import type { VespaJob } from '@/zero/vespa-injection/core/types';
import { hubOfContainer, invalidateSdlcHubIndex, loadSdlcHubIndex } from './sdlcSearchIndex';

const TAG = '[SDLC-SEARCH-SYNC]';
// Vespa's per-query hit limit (query maxHits); larger sets are read in pages.
const PAGE = 400;
const MAX_PAGES = 25;

export interface SdlcHubSyncResult {
  hubId: string;
  containers: number;
  repositories: number;
  documents: number;
  /** Documents, tickets and messages Vespa did not have, fed in full. */
  fedDocuments: number;
  uploads: number;
  tickets: number;
  messages: number;
  removedContainers: number;
  cleared: number;
}

/**
 * Brings one hub's search entries in line with Postgres:
 *  - feeds every track and folder (sdlc_container) and every attached repository;
 *  - re-places the hub's documents, uploads, tickets and conversation messages with
 *    field-scoped updates of their SDLC fields only (no content re-read, no re-embedding);
 *  - clears the SDLC fields of items Vespa still places in the hub but Postgres no longer
 *    does, then deletes containers that no longer exist (found by querying Vespa, since a
 *    deleted row no longer says where it was).
 * Recomputing the whole hub keeps renames, moves and deletes right with one code path; hubs
 * are small, and a moved folder only re-feeds containers, never the documents under it.
 */
export async function syncSdlcHub(hubId: string): Promise<SdlcHubSyncResult | null> {
  invalidateSdlcHubIndex(hubId);
  const index = await loadSdlcHubIndex(hubId);
  if (!index) {
    logger.info(`${TAG} ${hubId} is not an SDLC hub (or was deleted); nothing to sync`);
    return null;
  }
  const base = { workspaceId: index.workspaceId };
  const jobs: VespaJob[] = [];
  const fileFields = [...SDLC_FILE_FIELDS];
  const placementFields = [...SDLC_DISCUSSION_FIELDS];

  // The hub's own entry: containers import its id and members (permissions) through channelRef,
  // and a hub created on the server (not through Zero) is never fed otherwise.
  jobs.push({ schema: channelSchema, jobType: 'feed', docId: hubId, ...base });
  for (const containerId of index.containers.keys()) {
    jobs.push({ schema: sdlcContainerSchema, jobType: 'feed', docId: containerId, ...base });
  }
  for (const repoId of index.repoIds) {
    jobs.push({ schema: sdlcRepositorySchema, jobType: 'feed', docId: repoId, ...base });
  }
  // A field-scoped update of a document Vespa does not have yet is a no-op, so a document that
  // was never indexed (created before indexing ran, or by a path that skipped it) gets a full
  // feed instead, which carries its SDLC fields too. Uploads are left to the upload path, which
  // only indexes the file types it can read.
  const indexedFiles = await existingIds(fileSchema, [...index.canvases.keys(), ...index.attachments.keys()]);
  let fedDocuments = 0;
  for (const canvasId of index.canvases.keys()) {
    if (indexedFiles.has(canvasId)) {
      jobs.push({ schema: fileSchema, jobType: 'update', docId: canvasId, app: SubApp.CANVAS, fields: fileFields, ...base });
    } else {
      jobs.push({ schema: fileSchema, jobType: 'feed', docId: canvasId, app: SubApp.CANVAS, ...base });
      fedDocuments++;
    }
  }
  for (const attachmentId of index.attachments.keys()) {
    if (!indexedFiles.has(attachmentId)) continue;
    jobs.push({ schema: fileSchema, jobType: 'update', docId: attachmentId, app: SubApp.CHAT_ATTACHMENT, fields: fileFields, ...base });
  }
  // Tickets and messages the same way: placed if Vespa has them, fed in full if it does not
  // (a ticket's thread message is written on the server, and may never have been indexed).
  const indexedTickets = await existingIds(ticketSchema, [...index.tickets.keys()]);
  for (const ticketId of index.tickets.keys()) {
    jobs.push(indexedTickets.has(ticketId)
      ? { schema: ticketSchema, jobType: 'update', docId: ticketId, fields: placementFields, ...base }
      : { schema: ticketSchema, jobType: 'feed', docId: ticketId, ...base });
    if (!indexedTickets.has(ticketId)) fedDocuments++;
  }
  const messages = index.conversations.size
    ? await db.message.findMany({
        where: { conversationId: { in: [...index.conversations.keys()] }, isDeleted: false },
        select: { messageId: true },
      })
    : [];
  const indexedMessages = await existingIds(messageSchema, messages.map(m => m.messageId));
  for (const m of messages) {
    jobs.push(indexedMessages.has(m.messageId)
      ? { schema: messageSchema, jobType: 'update', docId: m.messageId, fields: placementFields, ...base }
      : { schema: messageSchema, jobType: 'feed', docId: m.messageId, ...base });
    if (!indexedMessages.has(m.messageId)) fedDocuments++;
  }

  // Stale entries: what Vespa still places in this hub that Postgres no longer does. Items are
  // found through the containers they reference, so this runs before stale containers go.
  const inHub = `sdlcScopeIds contains "${hubId}"`;
  const liveFiles = new Set([...index.canvases.keys(), ...index.attachments.keys()]);
  const liveMessages = new Set(messages.map(m => m.messageId));
  let cleared = 0;
  for (const hit of await indexedHits(fileSchema, inHub, ['subApp'])) {
    if (liveFiles.has(hit.id)) continue;
    const app = hit.fields.subApp === SubApp.CANVAS ? SubApp.CANVAS : SubApp.CHAT_ATTACHMENT;
    jobs.push({ schema: fileSchema, jobType: 'update', docId: hit.id, app, fields: fileFields, ...base });
    cleared++;
  }
  for (const hit of await indexedHits(ticketSchema, inHub)) {
    if (index.tickets.has(hit.id)) continue;
    jobs.push({ schema: ticketSchema, jobType: 'update', docId: hit.id, fields: placementFields, ...base });
    cleared++;
  }
  for (const hit of await indexedHits(messageSchema, inHub)) {
    if (liveMessages.has(hit.id)) continue;
    jobs.push({ schema: messageSchema, jobType: 'update', docId: hit.id, fields: placementFields, ...base });
    cleared++;
  }

  const staleContainers = (await indexedHits(sdlcContainerSchema, `channelId contains "${hubId}"`))
    .map(hit => hit.id)
    .filter(id => !index.containers.has(id));
  for (const id of staleContainers) {
    jobs.push({ schema: sdlcContainerSchema, jobType: 'delete', docId: id, ...base });
  }
  const staleRepos = (await indexedHits(sdlcRepositorySchema, `hubIds contains "${hubId}"`))
    .map(hit => hit.id)
    .filter(id => !index.repoIds.includes(id));
  if (staleRepos.length) {
    const existing = new Set(
      (await db.repo.findMany({ where: { id: { in: staleRepos } }, select: { id: true } })).map(r => r.id),
    );
    for (const id of staleRepos) {
      // A detached repository is re-fed so its hubIds drop this hub; a deleted one is removed.
      jobs.push({ schema: sdlcRepositorySchema, jobType: existing.has(id) ? 'feed' : 'delete', docId: id, ...base });
    }
  }

  for (const job of jobs) {
    await vespaQueue.addJob(job);
  }

  const result: SdlcHubSyncResult = {
    hubId,
    containers: index.containers.size,
    repositories: index.repoIds.length,
    documents: index.canvases.size,
    fedDocuments,
    uploads: index.attachments.size,
    tickets: index.tickets.size,
    messages: messages.length,
    removedContainers: staleContainers.length,
    cleared,
  };
  logger.info(`${TAG} queued ${jobs.length} Vespa jobs`, result);
  return result;
}

/** Which of `ids` Vespa has in `schema` (by docId), read in batches. */
async function existingIds(schema: VespaSchema, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += PAGE) {
    const batch = ids.slice(i, i + PAGE);
    const list = batch.map(id => JSON.stringify(id)).join(', ');
    for (const hit of await indexedHits(schema, `docId in (${list})`, ['docId'])) {
      found.add(String(hit.fields.docId ?? hit.id));
    }
  }
  return found;
}

interface IndexedHit {
  id: string;
  fields: Record<string, unknown>;
}

/** Entries of `schema` matching `where`. Empty (with a warning) if Vespa can't answer. */
async function indexedHits(schema: VespaSchema, where: string, fields: string[] = []): Promise<IndexedHit[]> {
  try {
    const select = ['documentid', ...fields].join(', ');
    const hits: IndexedHit[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await vespa.vespaClient.search<{
        root?: { children?: { id?: string; fields?: Record<string, unknown> }[] };
      }>({
        yql: `select ${select} from ${schema} where ${where}`,
        hits: PAGE,
        offset: page * PAGE,
        timeout: '5s',
      });
      const children = response.root?.children ?? [];
      for (const hit of children) {
        const id = hit.fields?.documentid ? String(hit.fields.documentid).split('::')[1] : hit.id?.split('::')[1];
        if (id) hits.push({ id, fields: hit.fields ?? {} });
      }
      if (children.length < PAGE) return hits;
    }
    logger.warn(`${TAG} ${schema} where ${where} has over ${PAGE * MAX_PAGES} entries; some stale entries may remain`);
    return hits;
  } catch (error) {
    logger.warn(`${TAG} could not list indexed ${schema} entries (${where}); skipping stale check`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** The hubs a sync request reaches, for requests that name an item instead of a hub. */
export async function hubsOfSyncTarget(target: {
  hubId?: string; containerId?: string; canvasId?: string; repoId?: string;
}): Promise<string[]> {
  if (target.hubId) return [target.hubId];
  if (target.canvasId) {
    const canvas = await db.canvas.findUnique({ where: { id: target.canvasId }, select: { channelId: true } });
    return canvas?.channelId ? [canvas.channelId] : [];
  }
  if (target.repoId) {
    const links = await db.sdlcEntityLink.findMany({
      where: { targetType: 'REPOSITORY', targetId: target.repoId, sourceType: 'CHANNEL' },
      select: { channelId: true },
    });
    return [...new Set(links.map(l => l.channelId))];
  }
  if (target.containerId) {
    const hubId = await hubOfContainer(target.containerId);
    return hubId ? [hubId] : [];
  }
  return [];
}
