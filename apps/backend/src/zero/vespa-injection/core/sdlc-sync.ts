import {
  SDLC_CONTAINMENT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  sdlcRepositoryWikiFolderId,
  ChannelType,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import {
  channelSchema,
  fileSchema,
  messageSchema,
  SDLC_CONVERSATION_FIELDS,
  SDLC_FILE_FIELDS,
  SDLC_TICKET_FIELDS,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  SubApp,
  ticketSchema,
} from '@/vespa/src/types';
import type { VespaJob } from './types';

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

// Strip CR/LF so request-derived values can't forge log lines.
const sanitizeForLog = (value: string): string => value.replace(/[\r\n]/g, '');

// Upper bound on the containers walked under one container: far above any real hub, and it ends
// the walk even if the links ever formed a cycle.
const MAX_SUBTREE_CONTAINERS = 5000;


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
  /** Canvases whose own SDLC values changed (archived or restored). */
  documents?: string[];
  /** Artifact types (canvas folders) renamed: every document of the type carries its name. */
  typeIds?: string[];
  /** Repositories whose own entry changed (renamed). */
  repositories?: string[];
  /** Repositories attached to the hub: their entries, and their wikis' folders. */
  attachedRepositories?: string[];
  /** Repositories detached from the hub: their entries, and their wikis' folders leave search. */
  detachedRepositories?: string[];
  /** The hub's own channel entry (containers import its id and members). */
  hub?: boolean;
}

const PLACING_RELATIONS = new Set<string>([
  SDLC_CONTAINMENT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
]);

/** The SDLC changes a write makes, each with the hub it was made in. */
export type SdlcSearchChanges = Array<{ hubId: string; change: SdlcSearchChange }>;

/**
 * Runs an SDLC write and then queues the Vespa jobs of the changes it made. The write gets an
 * empty list and adds each change to it, itself or through the link helpers it passes the list
 * to (ensureLink, refileFolderEdges, ...). Once the write is done, its transaction committed,
 * every change is queued, so a worker that picks a job at once maps the committed rows. If the
 * write throws, nothing is queued.
 */
export async function withSdlcSearchSync<T>(write: (changes: SdlcSearchChanges) => Promise<T>): Promise<T> {
  const changes: SdlcSearchChanges = [];
  const result = await write(changes);
  for (const { hubId, change } of changes) queueSdlcSearchJobs(hubId, change);
  return result;
}

/**
 * Queues the Vespa jobs of a committed SDLC change. Fire-and-forget: indexing must never fail
 * the write. Called by withSdlcSearchSync once its write is done, and by the Zero side effects
 * and other writes that have already committed.
 */
export function queueSdlcSearchJobs(hubId: string, change: SdlcSearchChange): void {
  void (async () => {
    const jobs = await jobsFor(hubId, change);
    if (!jobs.length) return;
    // Any process that writes SDLC rows can queue; one that has not started the queue starts it.
    if (!vespaQueue.isReady) await vespaQueue.initialize();
    for (const job of jobs) {
      await vespaQueue.addJob(job);
    }
  })().catch(error => {
    logger.warn(`${TAG} could not queue Vespa jobs for hub ${sanitizeForLog(hubId)}`, {
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
  });
}

async function jobsFor(hubId: string, change: SdlcSearchChange): Promise<VespaJob[]> {
  const jobs = new Map<string, VespaJob>();
  // A channel that is not an SDLC hub has no SDLC entries. One that does not exist yet is a hub
  // being created in this transaction: queue what the change names.
  const hub = await db.channel.findUnique({ where: { id: hubId }, select: { type: true, workspaceId: true } });
  if (hub && hub.type !== ChannelType.SDLC) return [];
  const base = hub?.workspaceId ? { workspaceId: hub.workspaceId } : {};
  const add = (job: VespaJob) => jobs.set(`${job.schema}:${job.docId}`, { ...job, ...base });

  // Which entries a change affects is read from the hub's links, a few rows at a time; the values
  // of each entry are worked out when its job runs (the mapper, sdlc-index.ts).

  /** `id` and every track or folder placed under it. */
  const subtree = async (id: string): Promise<string[]> => {
    const ids = [id];
    const seen = new Set(ids);
    for (let i = 0; i < ids.length && i < MAX_SUBTREE_CONTAINERS; i++) {
      const children = await db.sdlcEntityLink.findMany({
        where: {
          channelId: hubId,
          sourceId: ids[i],
          sourceType: { in: ['TRACK', 'FOLDER'] },
          targetType: 'FOLDER',
          relationType: { in: [SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION] },
        },
        select: { targetId: true },
      });
      for (const child of children) {
        if (!seen.has(child.targetId)) {
          seen.add(child.targetId);
          ids.push(child.targetId);
        }
      }
    }
    return ids;
  };
  /** Whether a track or folder is still placed in the hub. */
  const placed = async (id: string): Promise<boolean> =>
    Boolean(await db.sdlcEntityLink.findFirst({
      where: {
        channelId: hubId,
        targetId: id,
        OR: [
          { targetType: 'TRACK', relationType: SDLC_TRACK_MEMBERSHIP_RELATION },
          { targetType: 'FOLDER', relationType: { in: [SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION] } },
        ],
      },
      select: { id: true },
    }));
  // A track or folder and every container under it (their paths and scope ids include it): fed,
  // or deleted when it has left the hub.
  const container = async (id: string, removed = false) => {
    const gone = removed && !(await placed(id));
    for (const containerId of await subtree(id)) {
      add({ schema: sdlcContainerSchema, jobType: gone ? 'delete' : 'feed', docId: containerId });
    }
  };
  const ticket = (id: string) =>
    add({ schema: ticketSchema, jobType: 'update', docId: id, fields: [...SDLC_TICKET_FIELDS] });
  const conversation = async (id: string) => {
    const messages = await db.message.findMany({ where: { conversationId: id, isDeleted: false }, select: { messageId: true } });
    for (const m of messages) {
      add({ schema: messageSchema, jobType: 'update', docId: m.messageId, fields: [...SDLC_CONVERSATION_FIELDS] });
    }
  };
  // A document or upload; with its dependents when its place changed: the tickets linked to it
  // and the discussions started on it sit where it sits.
  const document = async (type: string, id: string, withDependents: boolean) => {
    const app = type === 'ATTACHMENT' ? SubApp.CHAT_ATTACHMENT : SubApp.CANVAS;
    add({ schema: fileSchema, jobType: 'update', docId: id, app, fields: [...SDLC_FILE_FIELDS] });
    if (!withDependents) return;
    const ticketLinks = await db.sdlcEntityLink.findMany({
      where: {
        channelId: hubId,
        OR: [
          { sourceId: id, targetType: 'TICKET', relationType: { in: ['TICKET', 'CONTEXT'] } },
          { targetId: id, sourceType: 'TICKET', relationType: 'CONTEXT' },
        ],
      },
      select: { sourceType: true, sourceId: true, targetId: true },
    });
    for (const l of ticketLinks) ticket(l.sourceType === 'TICKET' ? l.sourceId : l.targetId);
    const discussions = await db.sdlcEntityLink.findMany({
      where: { channelId: hubId, sourceId: id, targetType: 'CONVERSATION', relationType: 'DISCUSSION' },
      select: { targetId: true },
    });
    for (const d of discussions) await conversation(d.targetId);
  };
  const repository = async (id: string) => {
    const exists = await db.repo.findUnique({ where: { id }, select: { id: true } });
    add({ schema: sdlcRepositorySchema, jobType: exists ? 'feed' : 'delete', docId: id });
  };
  // A repository's wiki joins or leaves the hub with it. Its folders stay linked after a detach
  // (which removes only the membership), so they are found through those links: fed when it is
  // attached (those that exist; a new one is fed as it is created), deleted when it is detached.
  const repositoryWiki = async (repoId: string, detached: boolean) => {
    for (const folderId of await subtree(sdlcRepositoryWikiFolderId(hubId, repoId))) {
      if (detached) add({ schema: sdlcContainerSchema, jobType: 'delete', docId: folderId });
      else if (await db.sdlcFolder.findUnique({ where: { id: folderId }, select: { id: true } })) {
        add({ schema: sdlcContainerSchema, jobType: 'feed', docId: folderId });
      }
    }
  };
  // What an edge places or links: its target, and for a context link both ends.
  const item = async (type: string, id: string, relation: string, removed: boolean) => {
    const placing = PLACING_RELATIONS.has(relation);
    if (type === 'TRACK' || type === 'FOLDER') {
      if (placing) await container(id, removed);
    } else if (type === 'CANVAS' || type === 'ATTACHMENT') {
      if (placing || relation === 'CONTEXT') await document(type, id, placing);
    } else if (type === 'TICKET') {
      ticket(id);
    } else if (type === 'CONVERSATION') {
      await conversation(id);
    } else if (type === 'REPOSITORY' && relation === SDLC_MEMBERSHIP_RELATION) {
      await repository(id);
      await repositoryWiki(id, removed);
    }
  };

  if (change.hub) add({ schema: channelSchema, jobType: 'feed', docId: hubId });
  if (change.link) {
    const { link } = change;
    await item(link.targetType, link.targetId, link.relationType, Boolean(change.removed));
    if (link.relationType === 'CONTEXT') {
      await item(link.sourceType, link.sourceId, link.relationType, Boolean(change.removed));
    }
  }
  if (change.moved) {
    const { type, id } = change.moved;
    if (type === 'TRACK' || type === 'FOLDER') await container(id);
    else if (type === 'CANVAS' || type === 'ATTACHMENT') await document(type, id, true);
  }
  for (const id of change.containers ?? []) await container(id);
  for (const id of change.documents ?? []) await document('CANVAS', id, false);
  if (change.typeIds?.length) {
    const canvases = await db.canvas.findMany({
      where: { channelId: hubId, folderId: { in: change.typeIds } },
      select: { id: true },
    });
    for (const canvas of canvases) await document('CANVAS', canvas.id, false);
  }
  for (const id of change.repositories ?? []) await repository(id);
  for (const id of change.attachedRepositories ?? []) {
    await repository(id);
    await repositoryWiki(id, false);
  }
  for (const id of change.detachedRepositories ?? []) {
    await repository(id);
    await repositoryWiki(id, true);
  }
  return [...jobs.values()];
}
