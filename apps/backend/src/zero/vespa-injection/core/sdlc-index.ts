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
  type SdlcTicketFields,
  type VespaSdlcContainerDocument,
} from '@/vespa/src/types';

/*
 * Where things sit in an SDLC hub, computed from Postgres (vespa-core: docs/sdlc-schemas.md).
 *
 * The tree is tracks and folders, placed by sdlc_entity_links: CHANNEL -> TRACK [TRACK],
 * TRACK|FOLDER -> FOLDER|CANVAS|ATTACHMENT|LINK [TRACK_ITEM], CHANNEL|FOLDER -> FOLDER|CANVAS
 * [HUB_ITEM] for the Wiki and Hub Knowledge trees. A repository's wiki is the Wiki folder
 * sdlc-wiki-<hubId>-<repoId>, indexed as a REPOSITORY container.
 *
 * Documents, uploads and conversations are indexed by the one container they sit in
 * (sdlcContainerRef); Vespa imports the rest of their place from it. A conversation started on a
 * document sits in the document's container and names it (sdlcDocumentId). A ticket can sit in
 * several places, so its containers and documents are fed as lists (sdlcContainerIds,
 * sdlcDocumentIds, sdlcRepoIds).
 *
 * Each entry reads only what it needs: an item's place is found by walking up the edges that
 * place it to the hub, never by loading the whole hub, so a job costs the depth of its item, not
 * the size of its hub. Reads are made when the job runs, so it maps the hub as it is then.
 */

const PLACED_TYPES = new Set(['FOLDER', 'CANVAS', 'ATTACHMENT', 'LINK']);
const PLACING_RELATIONS = [SDLC_TRACK_MEMBERSHIP_RELATION, SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION];
const OLDEST_FIRST = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

const ms = (d: Date | null | undefined): number => (d ? d.getTime() : 0);

// Vespa document ids are id:<namespace>:<schema>::<id>, the namespace being the deployment's
// (VESPA_NAMESPACE), as in the mapper's getRef.
export const sdlcContainerRef = (containerId: string): string =>
  `id:${NAMESPACE}:${sdlcContainerSchema}::${containerId}`;
const repositoryRef = (repoId: string): string =>
  `id:${NAMESPACE}:${sdlcRepositorySchema}::${repoId}`;

export const EMPTY_SDLC_FILE_FIELDS: SdlcFileFields = {
  sdlcContainerRef: '',
  sdlcTypeName: '',
  sdlcStatus: '',
  sdlcRelatedDocumentIds: [],
};

export const EMPTY_SDLC_DISCUSSION_FIELDS: SdlcDiscussionFields = { sdlcContainerRef: '', sdlcDocumentId: '' };

/** Caches each key's first lookup, so the entries read together share their reads. */
function once<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return key => {
    let value = cache.get(key);
    if (!value) {
      value = load(key);
      cache.set(key, value);
    }
    return value;
  };
}

/** How an id is placed in the hub: whether it is a track, a filed folder, and what holds it. */
interface Placing {
  isTrack: boolean;
  isFolder: boolean;
  /** The container (or the hub) it sits in; null when nothing places it. */
  parentId: string | null;
}

/**
 * One hub, read only as far as the entries asked for need. Short-lived: made for a job (or a
 * backfill pass) and dropped after it.
 */
function sdlcHub(hubId: string, prisma: PrismaClient = db) {
  const wikiRoot = sdlcWikiFolderId(hubId);
  const hubWiki = sdlcHubWikiFolderId(hubId);
  const knowledgeRoot = sdlcHubKnowledgeFolderId(hubId);
  const repoWikiPrefix = `${wikiRoot}-`;

  const hub = once(async (_: true) => {
    const channel = await prisma.channel.findUnique({ where: { id: hubId }, select: { type: true, projectId: true } });
    return channel && channel.type === ChannelType.SDLC ? channel : null;
  });

  // The edges that place `id`. Where several do, the newest wins, as when a hub's edges are read
  // in the order they were written.
  const placing = once(async (id: string): Promise<Placing> => {
    const links = await prisma.sdlcEntityLink.findMany({
      where: { channelId: hubId, targetId: id, relationType: { in: PLACING_RELATIONS } },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true, targetType: true, relationType: true },
    });
    let isTrack = false;
    let isFolder = false;
    let parentId: string | null = null;
    for (const l of links) {
      if (l.relationType === SDLC_TRACK_MEMBERSHIP_RELATION && l.targetType === 'TRACK') isTrack = true;
      if (l.relationType !== SDLC_TRACK_MEMBERSHIP_RELATION && l.targetType === 'FOLDER') isFolder = true;
      const places = PLACED_TYPES.has(l.targetType) && (
        (l.relationType === SDLC_CONTAINMENT_RELATION && (l.sourceType === 'TRACK' || l.sourceType === 'FOLDER'))
        || (l.relationType === SDLC_HUB_ITEM_RELATION && (l.sourceType === 'CHANNEL' || l.sourceType === 'FOLDER')));
      if (places) parentId = l.sourceType === 'CHANNEL' ? hubId : l.sourceId;
    }
    return { isTrack, isFolder, parentId: parentId ?? (isTrack ? hubId : null) };
  });

  /** Containers above `id`, hub first; [] when it does not reach the hub. */
  const chainOf = once(async (id: string): Promise<string[]> => {
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let cur = (await placing(id)).parentId;
    while (cur && !seen.has(cur)) {
      chain.unshift(cur);
      if (cur === hubId) return chain;
      seen.add(cur);
      cur = (await placing(cur)).parentId;
    }
    return [];
  });

  const trackRow = once((id: string) => prisma.sdlcTrack.findUnique({ where: { id } }));
  const folderRow = once((id: string) => prisma.sdlcFolder.findUnique({ where: { id } }));
  const isTrack = async (id: string) => id !== hubId && (await placing(id)).isTrack;
  const nameOf = async (id: string): Promise<string> => {
    const p = await placing(id);
    return (p.isFolder ? (await folderRow(id))?.name : undefined) ?? (p.isTrack ? (await trackRow(id))?.name : undefined) ?? '';
  };

  /** The repository whose wiki `id` is, or null. */
  const repoOfWiki = async (id: string): Promise<string | null> =>
    id !== hubWiki && id.startsWith(repoWikiPrefix) && (await placing(id)).parentId === wikiRoot
      ? id.slice(repoWikiPrefix.length)
      : null;
  const attached = once(async (repoId: string) => Boolean(await prisma.sdlcEntityLink.findFirst({
    where: { channelId: hubId, sourceType: 'CHANNEL', targetType: 'REPOSITORY', targetId: repoId, relationType: SDLC_MEMBERSHIP_RELATION },
    select: { id: true },
  })));

  const typeOf = async (id: string): Promise<SdlcContainerType> =>
    (await isTrack(id)) ? 'TRACK'
      : id === wikiRoot ? 'WIKI'
      : id === hubWiki ? 'HUB_WIKI'
      : id === knowledgeRoot ? 'KNOWLEDGE'
      : (await repoOfWiki(id)) ? 'REPOSITORY'
      : 'FOLDER';

  /** Where a track or folder sits; null when it does not reach the hub or is in a detached repository's wiki. */
  const place = async (id: string) => {
    const chain = await chainOf(id);
    if (!chain.length) return null;
    const scopeIds = [...chain, id];
    const repos = await Promise.all(scopeIds.map(repoOfWiki));
    // Detaching a repository leaves its wiki folders linked under the Wiki; they stay out of the
    // hub's search entries until it is attached again.
    for (const repo of repos) if (repo && !(await attached(repo))) return null;
    const branch: SdlcBranch = scopeIds.includes(wikiRoot) ? 'WIKI'
      : scopeIds.includes(knowledgeRoot) ? 'KNOWLEDGE'
      : 'TRACKS';
    const tracks = await Promise.all(scopeIds.map(isTrack));
    const trackId = scopeIds.find((_, i) => tracks[i]) ?? '';
    const repo = repos.find(Boolean);
    return {
      branch,
      parentId: chain[chain.length - 1]!,
      scopeIds,
      depth: chain.length - 1,
      path: (await Promise.all(scopeIds.slice(1).map(nameOf))).join('/'),
      trackId,
      trackStatus: trackId ? String((await trackRow(trackId))?.status ?? '') : '',
      repoRef: repo ? repositoryRef(repo) : '',
    };
  };

  /** A track or folder's sdlc_container document; null when it is not in the hub. */
  const container = once(async (id: string): Promise<VespaSdlcContainerDocument | null> => {
    const channel = await hub(true);
    if (!channel) return null;
    const base = {
      docType: VespaDocType.SDLC_CONTAINER as const,
      channelRef: `id:${NAMESPACE}:${channelSchema}::${hubId}`,
      projectId: channel.projectId ?? '',
    };
    const p = await placing(id);
    const folder = p.isFolder ? await folderRow(id) : null;
    if (folder) {
      const at = await place(id);
      if (!at) return null;
      return {
        ...base, ...at, docId: id, containerType: await typeOf(id),
        parentType: at.parentId === hubId ? 'HUB' : await typeOf(at.parentId),
        name: folder.name, description: '',
        createdBy: folder.createdBy, createdAt: ms(folder.createdAt), updatedAt: ms(folder.updatedAt),
      };
    }
    const track = p.isTrack ? await trackRow(id) : null;
    if (!track) return null;
    const at = await place(id);
    if (!at || at.branch !== 'TRACKS') return null;
    return {
      ...base, ...at, docId: id, containerType: 'TRACK', parentType: 'HUB',
      name: track.name, description: track.description ?? '',
      createdBy: track.createdBy, createdAt: ms(track.createdAt), updatedAt: ms(track.updatedAt),
    };
  });

  /** The container an item sits in: a track or folder is its own; anything else its parent's. */
  const containerOf = async (type: string, id: string): Promise<string | null> => {
    const containerId = type === 'TRACK' || type === 'FOLDER' ? id : (await placing(id)).parentId;
    return containerId && (await container(containerId)) ? containerId : null;
  };

  /** A canvas or upload's own SDLC fields (no related documents); null when it is not a document of the hub. */
  const canvas = once(async (id: string): Promise<SdlcFileFields | null> => {
    const row = await prisma.canvas.findFirst({
      where: { id, channelId: hubId, sdlcArtifact: { isNot: null } },
      select: { folderId: true, sdlcArtifact: { select: { artifactStatus: true } } },
    });
    if (!row) return null;
    const containerId = await containerOf('CANVAS', id);
    if (!containerId) return null;
    const type = row.folderId
      ? await prisma.canvasFolder.findFirst({ where: { id: row.folderId, channelId: hubId }, select: { name: true } })
      : null;
    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: type?.name || '',
      sdlcStatus: row.sdlcArtifact?.artifactStatus ?? '',
      sdlcRelatedDocumentIds: [],
    };
  });
  const attachment = once(async (id: string): Promise<SdlcFileFields | null> => {
    const filed = await prisma.sdlcEntityLink.findFirst({
      where: { channelId: hubId, relationType: SDLC_CONTAINMENT_RELATION, targetType: 'ATTACHMENT', targetId: id },
      select: { id: true },
    });
    const containerId = filed ? await containerOf('ATTACHMENT', id) : null;
    return containerId ? { ...EMPTY_SDLC_FILE_FIELDS, sdlcContainerRef: sdlcContainerRef(containerId), sdlcRelatedDocumentIds: [] } : null;
  });
  const documentOf = (type: string, id: string): Promise<SdlcFileFields | null> =>
    type === 'CANVAS' ? canvas(id) : type === 'ATTACHMENT' ? attachment(id) : Promise.resolve(null);

  /** A document's SDLC fields, with the other documents of the hub linked to it as context (both directions). */
  const document = async (type: string, id: string): Promise<SdlcFileFields | null> => {
    const own = await documentOf(type, id);
    if (!own) return null;
    const links = await prisma.sdlcEntityLink.findMany({
      where: { channelId: hubId, relationType: 'CONTEXT', OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true, targetType: true, targetId: true },
    });
    const related: string[] = [];
    for (const l of links) {
      if (l.sourceId === l.targetId) continue;
      const [otherType, otherId] = l.sourceType === type && l.sourceId === id ? [l.targetType, l.targetId] : [l.sourceType, l.sourceId];
      if (!related.includes(otherId) && (await documentOf(otherType, otherId))) related.push(otherId);
    }
    return { ...own, sdlcRelatedDocumentIds: related };
  };

  /**
   * Where a ticket sits in this hub. Every item it is linked to is one of its places: X -> TICKET
   * [TICKET] (raised or linked there), X <-> TICKET [CONTEXT], and TRACK -> TICKET [TRACK_ITEM]
   * (the tracks whose board holds it). Its containers are those items' containers, in the order
   * the links were made, minus any container above another one in the list.
   */
  const ticket = async (ticketId: string): Promise<SdlcTicketFields | null> => {
    const links = await prisma.sdlcEntityLink.findMany({
      where: {
        channelId: hubId,
        OR: [
          { targetType: 'TICKET', targetId: ticketId, sourceType: { not: 'TICKET' }, relationType: { in: ['TICKET', 'CONTEXT', SDLC_CONTAINMENT_RELATION] } },
          { sourceType: 'TICKET', sourceId: ticketId, targetType: { not: 'TICKET' }, relationType: 'CONTEXT' },
        ],
      },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true, targetType: true, targetId: true, relationType: true },
    });
    let entry: SdlcTicketFields | null = null;
    const addOnce = (list: string[], value: string) => {
      if (!list.includes(value)) list.push(value);
    };
    for (const l of links) {
      const [itemType, itemId] = l.targetType === 'TICKET' ? [l.sourceType, l.sourceId] : [l.targetType, l.targetId];
      const containerId = await containerOf(itemType, itemId);
      if (!containerId) continue;
      entry ??= { sdlcContainerIds: [], sdlcDocumentIds: [], sdlcRepoIds: [] };
      addOnce(entry.sdlcContainerIds, containerId);
      // repoRef is id:<namespace>:sdlc_repository::<repoId> on a repository wiki's containers.
      const { repoRef } = (await container(containerId))!;
      if (repoRef) addOnce(entry.sdlcRepoIds, repoRef.split('::')[1]!);
      if (l.relationType !== SDLC_CONTAINMENT_RELATION && (await documentOf(itemType, itemId))) addOnce(entry.sdlcDocumentIds, itemId);
    }
    if (!entry) return null;
    const found = entry;
    const scopes = new Map<string, string[]>();
    for (const id of found.sdlcContainerIds) scopes.set(id, (await container(id))!.scopeIds);
    found.sdlcContainerIds = found.sdlcContainerIds.filter(id => !found.sdlcContainerIds.some(
      other => other !== id && scopes.get(other)!.includes(id),
    ));
    return found;
  };

  /**
   * Where a conversation started in this hub sits: the container of the item it was started on
   * (its oldest DISCUSSION edge that is placed), and the item itself when it is a document.
   */
  const conversation = async (conversationId: string): Promise<SdlcDiscussionFields | null> => {
    const links = await prisma.sdlcEntityLink.findMany({
      where: { channelId: hubId, relationType: 'DISCUSSION', targetType: 'CONVERSATION', targetId: conversationId },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true },
    });
    for (const l of links) {
      const containerId = await containerOf(l.sourceType, l.sourceId);
      if (!containerId) continue;
      const isDocument = Boolean(await documentOf(l.sourceType, l.sourceId));
      return { sdlcContainerRef: sdlcContainerRef(containerId), sdlcDocumentId: isDocument ? l.sourceId : '' };
    }
    return null;
  };

  return { container, document, ticket, conversation };
}

/** A track or folder's sdlc_container document, or null when it is not placed in `hubId`. */
export function sdlcContainerDocument(id: string, hubId: string): Promise<VespaSdlcContainerDocument | null> {
  return sdlcHub(hubId).container(id);
}

/** Every track and folder placed in a hub (the backfill lists them to feed). */
export async function sdlcHubContainerIds(hubId: string): Promise<string[]> {
  const candidates = await db.sdlcEntityLink.findMany({
    where: {
      channelId: hubId,
      OR: [
        { relationType: SDLC_TRACK_MEMBERSHIP_RELATION, targetType: 'TRACK' },
        { relationType: { in: [SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION] }, targetType: 'FOLDER' },
      ],
    },
    select: { targetId: true },
    distinct: ['targetId'],
  });
  const hub = sdlcHub(hubId);
  const placed: string[] = [];
  for (const { targetId } of candidates) {
    if (await hub.container(targetId)) placed.push(targetId);
  }
  return placed;
}

/** SDLC fields for a canvas; empty unless it is an SDLC document filed in a hub. */
export async function sdlcFieldsForCanvas(canvas: { id: string; channelId?: string | null }): Promise<SdlcFileFields> {
  if (!canvas.channelId) return EMPTY_SDLC_FILE_FIELDS;
  return (await sdlcHub(canvas.channelId).document('CANVAS', canvas.id)) ?? EMPTY_SDLC_FILE_FIELDS;
}

/** SDLC fields for an uploaded file; empty unless it was uploaded into a hub's track. */
export async function sdlcFieldsForAttachment(attachment: { id: string; entityType?: string | null; entityId?: string | null }): Promise<SdlcFileFields> {
  if (attachment.entityType !== 'SDLC_HUB' || !attachment.entityId) return EMPTY_SDLC_FILE_FIELDS;
  return (await sdlcHub(attachment.entityId).document('ATTACHMENT', attachment.id)) ?? EMPTY_SDLC_FILE_FIELDS;
}

/**
 * Where a ticket sits, across every hub it is linked in; empty outside SDLC. Its containers and
 * documents are the union over all its hubs, in the order its links were made.
 */
export async function sdlcFieldsForTicket(ticketId: string): Promise<SdlcTicketFields> {
  const links = await db.sdlcEntityLink.findMany({
    where: {
      OR: [
        { targetType: 'TICKET', targetId: ticketId, relationType: { in: ['TICKET', 'CONTEXT', SDLC_CONTAINMENT_RELATION] } },
        { sourceType: 'TICKET', sourceId: ticketId, relationType: 'CONTEXT' },
      ],
    },
    orderBy: OLDEST_FIRST,
    select: { channelId: true },
  });
  const fields: SdlcTicketFields = { sdlcContainerIds: [], sdlcDocumentIds: [], sdlcRepoIds: [] };
  for (const hubId of new Set(links.map(l => l.channelId))) {
    const entry = await sdlcHub(hubId).ticket(ticketId);
    if (!entry) continue;
    fields.sdlcContainerIds.push(...entry.sdlcContainerIds.filter(id => !fields.sdlcContainerIds.includes(id)));
    fields.sdlcDocumentIds.push(...entry.sdlcDocumentIds.filter(id => !fields.sdlcDocumentIds.includes(id)));
    fields.sdlcRepoIds.push(...entry.sdlcRepoIds.filter(id => !fields.sdlcRepoIds.includes(id)));
  }
  return fields;
}

/** Where a conversation started in a hub sits; empty outside SDLC. */
export async function sdlcFieldsForConversation(conversationId: string | null | undefined): Promise<SdlcDiscussionFields> {
  if (!conversationId) return EMPTY_SDLC_DISCUSSION_FIELDS;
  // Its hub: the hub of the oldest DISCUSSION edge to it.
  const link = await db.sdlcEntityLink.findFirst({
    where: { targetType: 'CONVERSATION', targetId: conversationId, relationType: 'DISCUSSION' },
    orderBy: OLDEST_FIRST,
    select: { channelId: true },
  });
  if (!link) return EMPTY_SDLC_DISCUSSION_FIELDS;
  return (await sdlcHub(link.channelId).conversation(conversationId)) ?? EMPTY_SDLC_DISCUSSION_FIELDS;
}

/** The hub a track or folder belongs to, from the edge that places it. */
export async function hubOfContainer(containerId: string): Promise<string | null> {
  const link = await db.sdlcEntityLink.findFirst({
    where: {
      targetId: containerId,
      targetType: { in: ['TRACK', 'FOLDER'] },
      relationType: { in: PLACING_RELATIONS },
    },
    select: { channelId: true },
  });
  return link?.channelId ?? null;
}
