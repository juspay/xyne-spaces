import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import vespa from '@/vespa/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { isSupportedMimeType } from '@/services/fileProcessor';
import {
  channelSchema,
  fileSchema,
  messageSchema,
  SDLC_FILE_FIELDS,
  SDLC_DISCUSSION_FIELDS,
  SDLC_TICKET_FIELDS,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  SubApp,
  ticketSchema,
  type SdlcDiscussionFields,
  type SdlcFileFields,
  type SdlcTicketFields,
  type VespaSchema,
  type VespaSdlcContainerDocument,
  type VespaSdlcRepositoryDocument,
} from '@/vespa/src/types';
import type { SdlcSearchSyncTarget, VespaJob } from '@/zero/vespa-injection/core/types';
import { hubOfContainer, invalidateSdlcHubIndex, loadSdlcHubIndex, sdlcFieldsForTicket } from './sdlcSearchIndex';
import { mapSdlcRepository } from '@/zero/vespa-injection/core/mapper';
import { requestSdlcSearchSync } from './sdlcSearchSync';

const TAG = '[SDLC-SEARCH-SYNC]';
// Vespa's per-query hit limit (query maxHits); larger sets are read in pages, up to the highest
// offset Vespa accepts (query maxOffset, 1000 by default).
const PAGE = 400;
const MAX_OFFSET = 1000;

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
 *  - feeds the tracks and folders (sdlc_container) and attached repositories whose entry in
 *    Vespa differs from Postgres, or that Vespa does not have;
 *  - re-places the hub's documents, uploads, tickets and conversation messages whose SDLC
 *    fields differ, with field-scoped updates of those fields (the Vespa workers' usual
 *    update path), and feeds in full the ones Vespa does not have;
 *  - clears the SDLC fields of items Vespa still places in the hub but Postgres no longer
 *    does, then deletes containers that no longer exist (found by querying Vespa, since a
 *    deleted row no longer says where it was).
 * Comparing with what Vespa holds keeps each sync to what changed: a moved document is one
 * update, a renamed folder one container feed (documents under it read the new path through
 * their reference), however big the hub.
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
  const ticketFields = [...SDLC_TICKET_FIELDS];
  let fedDocuments = 0;

  // The hub's own entry: containers import its id and members (permissions) through channelRef,
  // and a hub created on the server (not through Zero) is never fed otherwise.
  const hub = (await indexedValues(channelSchema, [hubId])).get(hubId);
  if (hub?.channelType !== 'SDLC') {
    jobs.push({ schema: channelSchema, jobType: 'feed', docId: hubId, ...base });
  }

  const containerIds = [...index.containers.keys()];
  const containerValues = await indexedValues(sdlcContainerSchema, containerIds, ['default', 'lean']);
  for (const [containerId, container] of index.containers) {
    const indexed = containerValues.get(containerId);
    if (!indexed || !sameContainer(container, indexed)) {
      jobs.push({ schema: sdlcContainerSchema, jobType: 'feed', docId: containerId, ...base });
    }
  }
  const indexedRepos = await indexedValues(sdlcRepositorySchema, index.repoIds);
  for (const repoId of index.repoIds) {
    const repo = await mapSdlcRepository(repoId);
    const indexed = indexedRepos.get(repoId);
    if (repo && (!indexed || !sameRepository(repo, indexed))) {
      jobs.push({ schema: sdlcRepositorySchema, jobType: 'feed', docId: repoId, ...base });
    }
  }

  // A field-scoped update of a document Vespa does not have yet is a no-op, so a document that
  // was never indexed (created before indexing ran, or by a path that skipped it) gets a full
  // feed instead, which carries its SDLC fields too. A missing upload is fed only when its file
  // type is one the upload path indexes (attachmentController); others are never in Vespa.
  const indexedFiles = await indexedValues(fileSchema, [...index.canvases.keys(), ...index.attachments.keys()], ['sdlc']);
  for (const [canvasId, fields] of index.canvases) {
    const indexed = indexedFiles.get(canvasId);
    if (!indexed) {
      jobs.push({ schema: fileSchema, jobType: 'feed', docId: canvasId, app: SubApp.CANVAS, ...base });
      fedDocuments++;
    } else if (!sameFileFields(fields, indexed)) {
      jobs.push({ schema: fileSchema, jobType: 'update', docId: canvasId, app: SubApp.CANVAS, fields: fileFields, ...base });
    }
  }
  const missingUploads = [...index.attachments.keys()].filter(id => !indexedFiles.has(id));
  const readableUploads = new Set(
    missingUploads.length
      ? (await db.messageAttachment.findMany({
          where: { id: { in: missingUploads }, isDeleted: false },
          select: { id: true, mimetype: true },
        }))
          .filter(a => isSupportedMimeType(a.mimetype))
          .map(a => a.id)
      : [],
  );
  for (const [attachmentId, fields] of index.attachments) {
    const indexed = indexedFiles.get(attachmentId);
    if (indexed) {
      if (!sameFileFields(fields, indexed)) {
        jobs.push({ schema: fileSchema, jobType: 'update', docId: attachmentId, app: SubApp.CHAT_ATTACHMENT, fields: fileFields, ...base });
      }
    } else if (readableUploads.has(attachmentId)) {
      jobs.push({ schema: fileSchema, jobType: 'feed', docId: attachmentId, app: SubApp.CHAT_ATTACHMENT, ...base });
      fedDocuments++;
    }
  }
  // Tickets and messages the same way: re-placed if Vespa's values differ, fed in full if Vespa
  // does not have them (a ticket's thread message is written on the server, and may never have
  // been indexed). A ticket is compared with its places across every hub it is linked in.
  const indexedTickets = await indexedValues(ticketSchema, [...index.tickets.keys()], ['sdlc']);
  for (const ticketId of index.tickets.keys()) {
    const indexed = indexedTickets.get(ticketId);
    if (!indexed) {
      jobs.push({ schema: ticketSchema, jobType: 'feed', docId: ticketId, ...base });
      fedDocuments++;
    } else if (!sameTicketFields(await sdlcFieldsForTicket(ticketId), indexed)) {
      jobs.push({ schema: ticketSchema, jobType: 'update', docId: ticketId, fields: ticketFields, ...base });
    }
  }
  const messages = index.conversations.size
    ? await db.message.findMany({
        where: { conversationId: { in: [...index.conversations.keys()] }, isDeleted: false },
        select: { messageId: true, conversationId: true },
      })
    : [];
  const indexedMessages = await indexedValues(messageSchema, messages.map(m => m.messageId), ['sdlc']);
  for (const m of messages) {
    const indexed = indexedMessages.get(m.messageId);
    if (!indexed) {
      jobs.push({ schema: messageSchema, jobType: 'feed', docId: m.messageId, ...base });
      fedDocuments++;
    } else if (!sameDiscussionFields(index.conversations.get(m.conversationId!)!, indexed)) {
      jobs.push({ schema: messageSchema, jobType: 'update', docId: m.messageId, fields: placementFields, ...base });
    }
  }

  // Stale entries: what Vespa still places in this hub that Postgres no longer does. Items are
  // found through the containers they reference, so this runs before stale containers go.
  // Vespa is asked only for entries outside the live set, so a large hub is not paged through.
  // Documents and messages carry the hub in their imported sdlcScopeIds; a ticket carries only
  // the containers it sits in, so it is found through every container Vespa has for the hub.
  const inHub = `sdlcScopeIds contains "${hubId}"`;
  const indexedContainers = (await indexedHits(sdlcContainerSchema, `channelId contains "${hubId}"`)).map(hit => hit.id);
  const hubContainers = [...new Set([...index.containers.keys(), ...indexedContainers])];
  let cleared = 0;
  const staleFiles = await indexedHits(
    fileSchema, notIn(inHub, [...index.canvases.keys(), ...index.attachments.keys()]), ['subApp'],
  );
  for (const hit of staleFiles) {
    const app = hit.fields.subApp === SubApp.CANVAS ? SubApp.CANVAS : SubApp.CHAT_ATTACHMENT;
    jobs.push({ schema: fileSchema, jobType: 'update', docId: hit.id, app, fields: fileFields, ...base });
    cleared++;
  }
  const ticketsInHub = hubContainers.length
    ? await indexedHits(ticketSchema, notIn(`sdlcContainerIds in (${hubContainers.map(id => JSON.stringify(id)).join(', ')})`, [...index.tickets.keys()]))
    : [];
  for (const hit of ticketsInHub) {
    jobs.push({ schema: ticketSchema, jobType: 'update', docId: hit.id, fields: ticketFields, ...base });
    cleared++;
  }
  for (const hit of await indexedHits(messageSchema, notIn(inHub, messages.map(m => m.messageId)))) {
    jobs.push({ schema: messageSchema, jobType: 'update', docId: hit.id, fields: placementFields, ...base });
    cleared++;
  }

  const staleContainers = indexedContainers.filter(id => !index.containers.has(id));
  for (const id of staleContainers) {
    jobs.push({ schema: sdlcContainerSchema, jobType: 'delete', docId: id, ...base });
  }
  const staleRepos = (await indexedHits(sdlcRepositorySchema, notIn(`hubIds contains "${hubId}"`, index.repoIds)))
    .map(hit => hit.id);
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

/**
 * What Vespa holds for each of `ids` in `schema`, by docId, read in batches; an id Vespa does not
 * have is absent. Each summary is read and merged, since no one summary returns every fed field.
 */
async function indexedValues(
  schema: VespaSchema,
  ids: string[],
  summaries: string[] = ['default'],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += PAGE) {
    const list = ids.slice(i, i + PAGE).map(id => JSON.stringify(id)).join(', ');
    for (const summary of summaries) {
      for (const hit of await indexedHits(schema, `docId in (${list})`, [], summary)) {
        found.set(hit.id, { ...found.get(hit.id), ...hit.fields });
      }
    }
  }
  return found;
}

// Vespa leaves empty values out of results, so '', [] and null all compare as absent.
const norm = (value: unknown): string | undefined =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    ? undefined
    : JSON.stringify(value);
const same = (pairs: [unknown, unknown][]): boolean => pairs.every(([a, b]) => norm(a) === norm(b));
/** The document id a reference (id:<namespace>:<schema>::<id>) points at. */
const refId = (ref: string): string => (ref ? ref.slice(ref.lastIndexOf('::') + 2) : '');

const CONTAINER_FIELDS = [
  'name', 'description', 'branch', 'containerType', 'trackId', 'trackStatus', 'parentId', 'parentType',
  'repoRef', 'scopeIds', 'depth', 'path', 'projectId', 'createdBy', 'createdAt', 'updatedAt',
] as const;

function sameContainer(container: VespaSdlcContainerDocument, indexed: Record<string, unknown>): boolean {
  return same([
    ...CONTAINER_FIELDS.map(field => [container[field], indexed[field]] as [unknown, unknown]),
    [refId(container.channelRef), indexed.channelId],
  ]);
}

function sameRepository(repo: VespaSdlcRepositoryDocument, indexed: Record<string, unknown>): boolean {
  const hubIds = (ids: unknown) => (Array.isArray(ids) ? [...ids].sort() : ids);
  return same([
    [repo.name, indexed.name], [repo.url, indexed.url], [repo.orgId, indexed.orgId],
    [repo.workspaceId, indexed.workspaceId], [repo.projectId, indexed.projectId],
    [hubIds(repo.hubIds), hubIds(indexed.hubIds)],
  ]);
}

function sameFileFields(fields: SdlcFileFields, indexed: Record<string, unknown>): boolean {
  return same([
    [refId(fields.sdlcContainerRef), indexed.sdlcContainerId], [fields.sdlcTypeName, indexed.sdlcTypeName],
    [fields.sdlcStatus, indexed.sdlcStatus], [fields.sdlcRelatedDocumentIds, indexed.sdlcRelatedDocumentIds],
  ]);
}

function sameDiscussionFields(fields: SdlcDiscussionFields, indexed: Record<string, unknown>): boolean {
  return same([
    [refId(fields.sdlcContainerRef), indexed.sdlcContainerId], [fields.sdlcDocumentId, indexed.sdlcDocumentId],
  ]);
}

function sameTicketFields(fields: SdlcTicketFields, indexed: Record<string, unknown>): boolean {
  return same([
    [fields.sdlcContainerIds, indexed.sdlcContainerIds], [fields.sdlcDocumentIds, indexed.sdlcDocumentIds],
    [fields.sdlcRepoIds, indexed.sdlcRepoIds],
  ]);
}

/** `where`, minus the entries whose docId is in `liveIds`. */
function notIn(where: string, liveIds: string[]): string {
  if (!liveIds.length) return where;
  return `${where} and !(docId in (${liveIds.map(id => JSON.stringify(id)).join(', ')}))`;
}

interface IndexedHit {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Entries of `schema` matching `where`. If Vespa stops answering part way, what was read so far
 * is kept (with a warning).
 */
async function indexedHits(schema: VespaSchema, where: string, fields: string[] = [], summary?: string): Promise<IndexedHit[]> {
  const hits: IndexedHit[] = [];
  try {
    const select = summary ? '*' : ['documentid', ...fields].join(', ');
    for (let page = 0; page * PAGE <= MAX_OFFSET; page++) {
      const response = await vespa.vespaClient.search<{
        root?: { children?: { id?: string; fields?: Record<string, unknown> }[] };
      }>({
        yql: `select ${select} from ${schema} where ${where}`,
        ...(summary ? { 'presentation.summary': summary } : {}),
        hits: PAGE,
        offset: page * PAGE,
        timeout: '5s',
      });
      const children = response.root?.children ?? [];
      for (const hit of children) {
        // A named summary may not return documentid, and the hit id is then not a document id.
        const id = hit.fields?.documentid
          ? String(hit.fields.documentid).split('::')[1]
          : typeof hit.fields?.docId === 'string' ? hit.fields.docId : hit.id?.split('::')[1];
        if (id) hits.push({ id, fields: hit.fields ?? {} });
      }
      if (children.length < PAGE) return hits;
    }
    logger.warn(`${TAG} ${schema}: over ${hits.length} matching entries; the rest wait for the next sync`);
    return hits;
  } catch (error) {
    logger.warn(`${TAG} could not list indexed ${schema} entries; continuing with ${hits.length} read`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return hits;
  }
}

/**
 * Runs one SDLC search sync request (queued by requestSdlcSearchSync; run by the Vespa worker).
 * A request that names an item becomes a request for its hub, so a burst of writes to different
 * items of one hub collapses into that hub's one debounced sync.
 */
export async function runSdlcSearchSync(target: SdlcSearchSyncTarget & { reason?: string }): Promise<SdlcHubSyncResult[]> {
  const hubIds = await hubsOfSyncTarget(target);
  // A repository in no hub (detached from its last one) has no hub to sync; re-feed it
  // directly so its hubIds empty out.
  if ('repoId' in target && hubIds.length === 0) {
    await vespaQueue.addJob({ schema: sdlcRepositorySchema, jobType: 'feed', docId: target.repoId });
  }
  if (!('hubId' in target)) {
    for (const hubId of hubIds) requestSdlcSearchSync({ hubId }, target.reason);
    return [];
  }
  const results: SdlcHubSyncResult[] = [];
  for (const hubId of hubIds) {
    const result = await syncSdlcHub(hubId);
    if (result) results.push(result);
  }
  return results;
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
