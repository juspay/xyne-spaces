import {
  SDLC_CONTAINMENT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import {
  channelSchema,
  fileSchema,
  messageSchema,
  SDLC_DISCUSSION_FIELDS,
  SDLC_FILE_FIELDS,
  SDLC_TICKET_FIELDS,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  SubApp,
  ticketSchema,
} from '@/vespa/src/types';
import type { VespaJob } from './types';
import { invalidateSdlcHubIndex, loadSdlcHubIndex } from './sdlc-index';

/**
 * Keeps SDLC Hub search in step with the writes that change it: each SDLC write names what it
 * changed, and this queues the Vespa jobs for the entries that change, the way the rest of
 * ingestion queues its own jobs (canvas and upload jobs go straight to vespa-files, the rest to
 * vespa-ingestion). The jobs carry ids only; the worker maps each entry, SDLC fields included,
 * from Postgres when it runs.
 *
 * Documents, tickets and messages point at their track or folder (sdlcContainerRef), and Vespa
 * imports the container's path, track and status through it, so a renamed or moved folder
 * re-feeds containers only, never the items under them.
 */
const TAG = '[SDLC-SEARCH]';

// Jobs wait this long before a worker picks them: longer than the transaction that queued them
// (writers queue from inside it) and than the mapper's hub cache (sdlc-index.ts), so a worker
// always maps the change itself, never a hub it cached just before it.
const SDLC_JOB_DELAY_MS = 3000;

/** A hub edge (sdlc_entity_links row), as written or as it was before a delete. */
export interface SdlcLink {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
}

/** What an SDLC write changed; every part is optional. */
export interface SdlcSearchChange {
  /** An edge written, or removed (removed: true): re-places what it places or links. */
  link?: SdlcLink;
  removed?: boolean;
  /** An item filed, moved or unfiled. */
  moved?: { type: string; id: string };
  /** Tracks or folders whose own values changed (created, renamed, status); those under them follow. */
  containers?: string[];
  /** Tracks or folders that left the hub. */
  removedContainers?: string[];
  /** Canvases whose own SDLC values changed (archived or restored). */
  documents?: string[];
  /** Artifact types (canvas folders) renamed: every document of the type carries its name. */
  typeIds?: string[];
  /** Repositories attached, detached or changed. */
  repositories?: string[];
  /** The hub's own channel entry (containers import its id and members). */
  hub?: boolean;
}

const PLACING_RELATIONS = new Set<string>([
  SDLC_CONTAINMENT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
]);

/**
 * Queues the Vespa jobs an SDLC write affects. Fire-and-forget: indexing must never fail the
 * write. Safe to call inside the write's transaction: what it reads (which containers sit under
 * a folder, which tickets and discussions sit on a document) is not what the write changes, and
 * the jobs it queues run only after the delay above.
 */
export function queueSdlcSearchJobs(hubId: string, change: SdlcSearchChange): void {
  void (async () => {
    const jobs = await jobsFor(hubId, change);
    if (!jobs.length) return;
    // Any process that writes SDLC rows can queue; one that has not started the queue starts it.
    if (!vespaQueue.isReady) await vespaQueue.initialize();
    for (const job of jobs) {
      await vespaQueue.addJob(job, { delayMs: SDLC_JOB_DELAY_MS });
    }
  })().catch(error => {
    logger.warn(`${TAG} could not queue Vespa jobs for hub ${hubId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function jobsFor(hubId: string, change: SdlcSearchChange): Promise<VespaJob[]> {
  invalidateSdlcHubIndex(hubId); // read the hub as it is now, not as cached before this write
  const index = await loadSdlcHubIndex(hubId);
  if (!index) return []; // not an SDLC hub
  const base = { workspaceId: index.workspaceId };
  const jobs = new Map<string, VespaJob>();
  const add = (job: VespaJob) => jobs.set(`${job.schema}:${job.docId}`, { ...job, ...base });

  // A track or folder, and every container under it (their paths and scope ids include it).
  const container = (id: string, removed = false) => {
    if (!index.containers.has(id)) {
      if (removed) add({ schema: sdlcContainerSchema, jobType: 'delete', docId: id });
      // Not in the hub yet: written in this transaction, so feed it once it commits.
      else add({ schema: sdlcContainerSchema, jobType: 'feed', docId: id });
      return;
    }
    for (const [containerId, entry] of index.containers) {
      if (containerId === id || entry.scopeIds.includes(id)) {
        add({ schema: sdlcContainerSchema, jobType: 'feed', docId: containerId });
      }
    }
  };
  const ticket = (id: string) =>
    add({ schema: ticketSchema, jobType: 'update', docId: id, fields: [...SDLC_TICKET_FIELDS] });
  const conversation = async (id: string) => {
    const messages = await db.message.findMany({ where: { conversationId: id, isDeleted: false }, select: { messageId: true } });
    for (const m of messages) {
      add({ schema: messageSchema, jobType: 'update', docId: m.messageId, fields: [...SDLC_DISCUSSION_FIELDS] });
    }
  };
  // A document or upload; with its dependents when its place changed: the tickets linked to it
  // and the discussions started on it sit where it sits.
  const document = async (type: string, id: string, withDependents: boolean) => {
    const app = type === 'ATTACHMENT' ? SubApp.CHAT_ATTACHMENT : SubApp.CANVAS;
    add({ schema: fileSchema, jobType: 'update', docId: id, app, fields: [...SDLC_FILE_FIELDS] });
    if (!withDependents) return;
    for (const [ticketId, fields] of index.tickets) {
      if (fields.sdlcDocumentIds.includes(id)) ticket(ticketId);
    }
    for (const [conversationId, fields] of index.conversations) {
      if (fields.sdlcDocumentId === id) await conversation(conversationId);
    }
  };
  const repository = async (id: string) => {
    const exists = await db.repo.findUnique({ where: { id }, select: { id: true } });
    add({ schema: sdlcRepositorySchema, jobType: exists ? 'feed' : 'delete', docId: id });
  };
  // What an edge places or links: its target, and for a context link both ends.
  const item = async (type: string, id: string, relation: string, removed: boolean) => {
    const placing = PLACING_RELATIONS.has(relation);
    if (type === 'TRACK' || type === 'FOLDER') {
      if (placing) container(id, removed);
    } else if (type === 'CANVAS' || type === 'ATTACHMENT') {
      if (placing || relation === 'CONTEXT') await document(type, id, placing);
    } else if (type === 'TICKET') {
      ticket(id);
    } else if (type === 'CONVERSATION') {
      await conversation(id);
    } else if (type === 'REPOSITORY' && relation === SDLC_MEMBERSHIP_RELATION) {
      await repository(id);
    }
  };

  if (change.link) {
    const { link } = change;
    await item(link.targetType, link.targetId, link.relationType, Boolean(change.removed));
    if (link.relationType === 'CONTEXT') {
      await item(link.sourceType, link.sourceId, link.relationType, Boolean(change.removed));
    }
  }
  if (change.moved) {
    const { type, id } = change.moved;
    if (type === 'TRACK' || type === 'FOLDER') container(id);
    else if (type === 'CANVAS' || type === 'ATTACHMENT') await document(type, id, true);
  }
  for (const id of change.containers ?? []) container(id);
  for (const id of change.removedContainers ?? []) container(id, true);
  for (const id of change.documents ?? []) await document('CANVAS', id, false);
  if (change.typeIds?.length) {
    const canvases = await db.canvas.findMany({
      where: { channelId: hubId, folderId: { in: change.typeIds } },
      select: { id: true },
    });
    for (const canvas of canvases) {
      if (index.canvases.has(canvas.id)) await document('CANVAS', canvas.id, false);
    }
  }
  for (const id of change.repositories ?? []) await repository(id);
  if (change.hub) add({ schema: channelSchema, jobType: 'feed', docId: hubId });

  return [...jobs.values()];
}
