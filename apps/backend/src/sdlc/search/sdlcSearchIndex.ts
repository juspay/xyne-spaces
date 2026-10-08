import {
  ChannelType,
  SDLC_CONTAINMENT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  sdlcHubKnowledgeFolderId,
  sdlcHubWikiFolderId,
  sdlcWikiFolderId,
} from '@xyne/shared';
import type { PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import {
  channelSchema,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  VespaDocType,
  type SdlcBranch,
  type SdlcContainerType,
  type SdlcDiscussionFields,
  type SdlcFileFields,
  type VespaSdlcContainerDocument,
} from '@/vespa/src/types';

/**
 * Everything SDLC search needs for one hub, computed from Postgres (vespa-core:
 * docs/sdlc-schemas.md).
 *
 * The tree is tracks and folders, placed by sdlc_entity_links: CHANNEL -> TRACK [TRACK],
 * TRACK|FOLDER -> FOLDER|CANVAS|ATTACHMENT|LINK [TRACK_ITEM], CHANNEL|FOLDER -> FOLDER|CANVAS
 * [HUB_ITEM] for the Wiki and Hub Knowledge trees. A repository's wiki is the Wiki folder
 * sdlc-wiki-<hubId>-<repoId>, indexed as a REPOSITORY container.
 *
 * Documents, uploads, tickets and conversations are indexed by the one container they sit in
 * (sdlcContainerRef); Vespa imports the rest of their place from it. A ticket or conversation
 * started on a document sits in the document's container and names it (sdlcDocumentId).
 */
export interface SdlcHubIndex {
  hubId: string;
  projectId: string;
  workspaceId: string;
  containers: Map<string, VespaSdlcContainerDocument>;
  /** Canvas id -> its SDLC fields. */
  canvases: Map<string, SdlcFileFields>;
  /** Uploaded file (message_attachments) id -> its container ref. */
  attachments: Map<string, string>;
  /** Ticket id -> its container ref and the document it was raised on. */
  tickets: Map<string, SdlcDiscussionFields>;
  /** Conversation id -> its container ref and the document it was started on. */
  conversations: Map<string, SdlcDiscussionFields>;
  /** Repositories attached to the hub. */
  repoIds: string[];
}

const PLACED_TYPES = new Set(['FOLDER', 'CANVAS', 'ATTACHMENT', 'LINK']);

const ms = (d: Date | null | undefined): number => (d ? d.getTime() : 0);

// Vespa document ids are id:<namespace>:<schema>::<id>, the namespace being the deployment's
// (VESPA_NAMESPACE), as in the mapper's getRef.
export const sdlcContainerRef = (containerId: string): string =>
  `id:${NAMESPACE}:${sdlcContainerSchema}::${containerId}`;
const repositoryRef = (repoId: string): string =>
  `id:${NAMESPACE}:${sdlcRepositorySchema}::${repoId}`;

// A hub sync fans out into one Vespa job per item, and each job maps its own document; caching
// the hub briefly keeps that from rebuilding the whole hub once per item. The jobs run in other
// processes (the Vespa workers), where the sync cannot invalidate this cache, so it must expire
// faster than the sync debounce (3s, sdlcSearchSyncQueue): a sync then never reads a hub cached
// before the change that triggered it.
const CACHE_TTL_MS = 2_000;
const cache = new Map<string, { at: number; index: Promise<SdlcHubIndex | null> }>();

export function invalidateSdlcHubIndex(hubId: string): void {
  cache.delete(hubId);
}

export function loadSdlcHubIndex(hubId: string, prisma: PrismaClient = db): Promise<SdlcHubIndex | null> {
  const hit = cache.get(hubId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.index;
  const index = buildSdlcHubIndex(hubId, prisma);
  cache.set(hubId, { at: Date.now(), index });
  index.catch(() => cache.delete(hubId));
  return index;
}

async function buildSdlcHubIndex(hubId: string, prisma: PrismaClient): Promise<SdlcHubIndex | null> {
  const hub = await prisma.channel.findUnique({
    where: { id: hubId },
    select: { id: true, type: true, projectId: true, workspaceId: true },
  });
  if (!hub || hub.type !== ChannelType.SDLC) return null;

  const links = await prisma.sdlcEntityLink.findMany({ where: { channelId: hubId } });

  // item -> the container it is in. A CHANNEL source is the hub itself.
  const parentOf = new Map<string, string>();
  const trackIds: string[] = [];
  for (const l of links) {
    if (l.relationType === SDLC_TRACK_MEMBERSHIP_RELATION && l.targetType === 'TRACK') {
      trackIds.push(l.targetId);
      parentOf.set(l.targetId, hubId);
    }
  }
  for (const l of links) {
    const trackItem = l.relationType === SDLC_CONTAINMENT_RELATION
      && (l.sourceType === 'TRACK' || l.sourceType === 'FOLDER')
      && PLACED_TYPES.has(l.targetType);
    const hubItem = l.relationType === SDLC_HUB_ITEM_RELATION
      && (l.sourceType === 'CHANNEL' || l.sourceType === 'FOLDER')
      && PLACED_TYPES.has(l.targetType);
    if (trackItem || hubItem) parentOf.set(l.targetId, l.sourceType === 'CHANNEL' ? hubId : l.sourceId);
  }

  /** Containers above `id`, hub first; [] when it does not reach the hub. */
  const chainOf = (id: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let cur = parentOf.get(id);
    while (cur && !seen.has(cur)) {
      chain.unshift(cur);
      if (cur === hubId) return chain;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return [];
  };

  const folderIds = links
    .filter(l => (l.relationType === SDLC_CONTAINMENT_RELATION || l.relationType === SDLC_HUB_ITEM_RELATION)
      && l.targetType === 'FOLDER')
    .map(l => l.targetId);
  const [tracks, folders, canvasFolders, canvases] = await Promise.all([
    prisma.sdlcTrack.findMany({ where: { id: { in: trackIds } } }),
    prisma.sdlcFolder.findMany({ where: { id: { in: folderIds } } }),
    prisma.canvasFolder.findMany({ where: { channelId: hubId }, select: { id: true, name: true } }),
    prisma.canvas.findMany({
      where: { channelId: hubId, sdlcArtifact: { isNot: null } },
      select: { id: true, folderId: true, sdlcArtifact: { select: { artifactStatus: true } } },
    }),
  ]);

  const repoIds = [...new Set(links
    .filter(l => l.relationType === SDLC_MEMBERSHIP_RELATION && l.sourceType === 'CHANNEL' && l.targetType === 'REPOSITORY')
    .map(l => l.targetId))];

  const wikiRoot = sdlcWikiFolderId(hubId);
  const hubWiki = sdlcHubWikiFolderId(hubId);
  const knowledgeRoot = sdlcHubKnowledgeFolderId(hubId);
  const repoWikiPrefix = `${wikiRoot}-`;
  /** The repository whose wiki `id` is, or null. */
  const repoOfWiki = (id: string): string | null =>
    id !== hubWiki && parentOf.get(id) === wikiRoot && id.startsWith(repoWikiPrefix)
      ? id.slice(repoWikiPrefix.length)
      : null;

  const names = new Map<string, string>();
  for (const t of tracks) names.set(t.id, t.name);
  for (const f of folders) names.set(f.id, f.name);
  const trackSet = new Set(trackIds);

  const containers = new Map<string, VespaSdlcContainerDocument>();
  const base = {
    docType: VespaDocType.SDLC_CONTAINER as const,
    channelRef: `id:${NAMESPACE}:${channelSchema}::${hubId}`,
    projectId: hub.projectId ?? '',
  };
  const place = (id: string) => {
    const chain = chainOf(id);
    if (!chain.length) return null;
    const scopeIds = [...chain, id];
    const branch: SdlcBranch = scopeIds.includes(wikiRoot) ? 'WIKI'
      : scopeIds.includes(knowledgeRoot) ? 'KNOWLEDGE'
      : 'TRACKS';
    const parentId = chain[chain.length - 1]!;
    const repoContainer = scopeIds.find(c => repoOfWiki(c));
    return {
      branch,
      parentId,
      scopeIds,
      depth: chain.length - 1,
      path: scopeIds.slice(1).map(c => names.get(c) ?? '').join('/'),
      trackId: scopeIds.find(c => trackSet.has(c)) ?? '',
      repoRef: repoContainer ? repositoryRef(repoOfWiki(repoContainer)!) : '',
    };
  };
  const typeOf = (id: string): SdlcContainerType =>
    trackSet.has(id) ? 'TRACK' : repoOfWiki(id) ? 'REPOSITORY' : 'FOLDER';

  for (const t of tracks) {
    const p = place(t.id);
    if (!p || p.branch !== 'TRACKS') continue;
    containers.set(t.id, {
      ...base, ...p, docId: t.id, containerType: 'TRACK', parentType: 'HUB',
      name: t.name, description: t.description ?? '', status: t.status,
      createdBy: t.createdBy, createdAt: ms(t.createdAt), updatedAt: ms(t.updatedAt),
    });
  }
  for (const f of folders) {
    const p = place(f.id);
    if (!p) continue;
    containers.set(f.id, {
      ...base, ...p, docId: f.id, containerType: typeOf(f.id),
      parentType: p.parentId === hubId ? 'HUB' : typeOf(p.parentId),
      name: f.name, description: '', status: '',
      createdBy: f.createdBy, createdAt: ms(f.createdAt), updatedAt: ms(f.updatedAt),
    });
  }

  /** The container an item sits in: a track or folder is its own; anything else its parent's. */
  const containerOf = (type: string, id: string): string | null => {
    const containerId = type === 'TRACK' || type === 'FOLDER' ? id : parentOf.get(id);
    return containerId && containers.has(containerId) ? containerId : null;
  };

  const typeNames = new Map(canvasFolders.map(f => [f.id, f.name]));
  const related = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.relationType !== 'CONTEXT' || l.sourceType !== 'CANVAS' || l.targetType !== 'CANVAS') continue;
    for (const [a, b] of [[l.sourceId, l.targetId], [l.targetId, l.sourceId]] as const) {
      if (!related.has(a)) related.set(a, new Set());
      related.get(a)!.add(b);
    }
  }
  const canvasFields = new Map<string, SdlcFileFields>();
  for (const c of canvases) {
    const containerId = containerOf('CANVAS', c.id);
    if (!containerId) continue;
    canvasFields.set(c.id, {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: (c.folderId && typeNames.get(c.folderId)) || '',
      sdlcStatus: c.sdlcArtifact?.artifactStatus ?? '',
      sdlcRelatedDocumentIds: [...(related.get(c.id) ?? [])],
    });
  }

  const attachments = new Map<string, string>();
  for (const l of links) {
    if (l.relationType !== SDLC_CONTAINMENT_RELATION || l.targetType !== 'ATTACHMENT') continue;
    const containerId = containerOf('ATTACHMENT', l.targetId);
    if (containerId) attachments.set(l.targetId, sdlcContainerRef(containerId));
  }

  /**
   * Where a ticket or conversation started on an item sits: the item's container, and the
   * item itself when it is an indexed document (a canvas or upload in the hub).
   */
  const discussionOf = (type: string, id: string): SdlcDiscussionFields | null => {
    const containerId = containerOf(type, id);
    if (!containerId) return null;
    const isDocument = (type === 'CANVAS' && canvasFields.has(id)) || (type === 'ATTACHMENT' && attachments.has(id));
    return { sdlcContainerRef: sdlcContainerRef(containerId), sdlcDocumentId: isDocument ? id : '' };
  };

  // A ticket's place is that of the item it was raised from (X -> TICKET [TICKET]); a ticket
  // raised on a track has only the TRACK -> TICKET [TRACK_ITEM] edge.
  const tickets = new Map<string, SdlcDiscussionFields>();
  for (const l of links) {
    if (l.targetType !== 'TICKET' || l.relationType !== 'TICKET') continue;
    const place = discussionOf(l.sourceType, l.sourceId);
    if (place) tickets.set(l.targetId, place);
  }
  for (const l of links) {
    if (l.targetType !== 'TICKET' || l.relationType !== SDLC_CONTAINMENT_RELATION || tickets.has(l.targetId)) continue;
    const place = discussionOf('TRACK', l.sourceId);
    if (place) tickets.set(l.targetId, place);
  }

  const conversations = new Map<string, SdlcDiscussionFields>();
  for (const l of links) {
    if (l.relationType !== 'DISCUSSION' || l.targetType !== 'CONVERSATION') continue;
    const place = discussionOf(l.sourceType, l.sourceId);
    if (place) conversations.set(l.targetId, place);
  }

  return {
    hubId,
    projectId: hub.projectId ?? '',
    workspaceId: hub.workspaceId,
    containers,
    canvases: canvasFields,
    attachments,
    tickets,
    conversations,
    repoIds,
  };
}

export const EMPTY_SDLC_FILE_FIELDS: SdlcFileFields = {
  sdlcContainerRef: '',
  sdlcTypeName: '',
  sdlcStatus: '',
  sdlcRelatedDocumentIds: [],
};

/** The hub of an item, from the link that files it (or a ticket / discussion link to it). */
async function hubOfTarget(targetType: string, targetId: string): Promise<string | null> {
  const link = await db.sdlcEntityLink.findFirst({
    where: { targetType, targetId },
    select: { channelId: true },
  });
  return link?.channelId ?? null;
}

/** SDLC fields for a canvas; empty unless it is an SDLC document filed in a hub. */
export async function sdlcFieldsForCanvas(canvas: { id: string; channelId?: string | null }): Promise<SdlcFileFields> {
  if (!canvas.channelId) return EMPTY_SDLC_FILE_FIELDS;
  const index = await loadSdlcHubIndex(canvas.channelId);
  return index?.canvases.get(canvas.id) ?? EMPTY_SDLC_FILE_FIELDS;
}

/** SDLC fields for an uploaded file; empty unless it was uploaded into a hub's track. */
export async function sdlcFieldsForAttachment(attachment: { id: string; entityType?: string | null; entityId?: string | null }): Promise<SdlcFileFields> {
  if (attachment.entityType !== 'SDLC_HUB' || !attachment.entityId) return EMPTY_SDLC_FILE_FIELDS;
  const index = await loadSdlcHubIndex(attachment.entityId);
  const ref = index?.attachments.get(attachment.id);
  return ref ? { ...EMPTY_SDLC_FILE_FIELDS, sdlcContainerRef: ref } : EMPTY_SDLC_FILE_FIELDS;
}

export const EMPTY_SDLC_DISCUSSION_FIELDS: SdlcDiscussionFields = { sdlcContainerRef: '', sdlcDocumentId: '' };

/** Where a ticket raised in a hub sits; empty outside SDLC. */
export async function sdlcFieldsForTicket(ticketId: string): Promise<SdlcDiscussionFields> {
  const hubId = await hubOfTarget('TICKET', ticketId);
  if (!hubId) return EMPTY_SDLC_DISCUSSION_FIELDS;
  return (await loadSdlcHubIndex(hubId))?.tickets.get(ticketId) ?? EMPTY_SDLC_DISCUSSION_FIELDS;
}

/** Where a conversation started in a hub sits; empty outside SDLC. */
export async function sdlcFieldsForConversation(conversationId: string | null | undefined): Promise<SdlcDiscussionFields> {
  if (!conversationId) return EMPTY_SDLC_DISCUSSION_FIELDS;
  const hubId = await hubOfTarget('CONVERSATION', conversationId);
  if (!hubId) return EMPTY_SDLC_DISCUSSION_FIELDS;
  return (await loadSdlcHubIndex(hubId))?.conversations.get(conversationId) ?? EMPTY_SDLC_DISCUSSION_FIELDS;
}

/** The hub a track or folder belongs to, from the edge that places it. */
export async function hubOfContainer(containerId: string): Promise<string | null> {
  const link = await db.sdlcEntityLink.findFirst({
    where: {
      targetId: containerId,
      targetType: { in: ['TRACK', 'FOLDER'] },
      relationType: { in: [SDLC_TRACK_MEMBERSHIP_RELATION, SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION] },
    },
    select: { channelId: true },
  });
  return link?.channelId ?? null;
}
