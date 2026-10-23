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
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import {
  channelSchema,
  sdlcContainerSchema,
  sdlcRepositorySchema,
  VespaDocType,
  type SdlcBranch,
  type SdlcContainerType,
  type SdlcConversationFields,
  type SdlcFieldValues,
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
 * (sdlcContainerRef); Vespa imports the rest of their place from it. A ticket can sit in several
 * places, so its containers and documents are fed as lists.
 *
 * Each lookup reads only its own item: its place is found by walking up the edges that place it
 * to the hub, never by loading the whole hub. The sdlcFieldsFor* functions return the fields as
 * written to Vespa: an empty value is null (a Vespa reference cannot hold ''), and an item in no
 * hub gets every field null, which clears a placement it no longer has.
 */

const PLACED_TYPES = new Set(['FOLDER', 'CANVAS', 'ATTACHMENT', 'LINK']);
const PLACING_RELATIONS = [SDLC_TRACK_MEMBERSHIP_RELATION, SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION];
const OLDEST_FIRST = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

// Vespa document ids are id:<namespace>:<schema>::<id>, as in the mapper's getRef.
const sdlcContainerRef = (containerId: string): string => `id:${NAMESPACE}:${sdlcContainerSchema}::${containerId}`;

/** Caches each key's first lookup, so the entries of one job share their reads. */
function once<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return key => {
    if (!cache.has(key)) cache.set(key, load(key));
    return cache.get(key)!;
  };
}

/**
 * A link between a ticket and an item of a hub: X -> TICKET [TICKET] (raised or linked there),
 * X <-> TICKET [CONTEXT], or TRACK -> TICKET [TRACK_ITEM] (the tracks whose board holds it).
 */
interface TicketLink {
  channelId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
}

/** How an id is placed in the hub. */
interface Placement {
  /** A track of the hub (CHANNEL -> TRACK [TRACK]). */
  isTrack: boolean;
  /** A folder filed in the hub (-> FOLDER [TRACK_ITEM | HUB_ITEM]). */
  isFolder: boolean;
  /** What it sits in: a track, a folder, or the hub itself; null when nothing places it. */
  parentId: string | null;
}

/** One hub, read only as far as the lookups asked for need. Made for a job and dropped after it. */
function sdlcHub(hubId: string) {
  const wikiRoot = sdlcWikiFolderId(hubId);
  const hubWiki = sdlcHubWikiFolderId(hubId);
  const knowledgeRoot = sdlcHubKnowledgeFolderId(hubId);
  const repoWikiPrefix = `${wikiRoot}-`;

  /**
   * How `id` is placed, from the edges that target it. Where several edges place it, the newest
   * wins, as when a hub's edges are read in the order they were written.
   */
  const placementOf = once(async (id: string): Promise<Placement> => {
    const links = await db.sdlcEntityLink.findMany({
      where: { channelId: hubId, targetId: id, relationType: { in: PLACING_RELATIONS } },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true, targetType: true, relationType: true },
    });

    let isTrack = false;
    let isFolder = false;
    let placedUnder: string | null = null;
    for (const link of links) {
      if (link.relationType === SDLC_TRACK_MEMBERSHIP_RELATION && link.targetType === 'TRACK') isTrack = true;
      if (link.relationType !== SDLC_TRACK_MEMBERSHIP_RELATION && link.targetType === 'FOLDER') isFolder = true;

      const filedInTrackOrFolder = link.relationType === SDLC_CONTAINMENT_RELATION
        && (link.sourceType === 'TRACK' || link.sourceType === 'FOLDER');
      const filedInHubTree = link.relationType === SDLC_HUB_ITEM_RELATION
        && (link.sourceType === 'CHANNEL' || link.sourceType === 'FOLDER');
      if (PLACED_TYPES.has(link.targetType) && (filedInTrackOrFolder || filedInHubTree)) {
        placedUnder = link.sourceType === 'CHANNEL' ? hubId : link.sourceId;
      }
    }

    return {
      isTrack,
      isFolder,
      parentId: placedUnder ?? (isTrack ? hubId : null),
    };
  });

  /** A track or folder's sdlc_container document; null when it is not placed in the hub. */
  const container = once(async (id: string): Promise<VespaSdlcContainerDocument | null> => {
    // 1. The hub must be an SDLC hub.
    const channel = await db.channel.findUnique({ where: { id: hubId }, select: { type: true, projectId: true } });
    if (channel?.type !== ChannelType.SDLC) return null;

    // 2. Its chain: the containers above it up to the hub, with how each is placed.
    const placements = new Map<string, Placement>([[id, await placementOf(id)]]);
    const chain: string[] = [];
    let parent = placements.get(id)!.parentId;
    while (parent && parent !== hubId && !placements.has(parent)) {
      chain.unshift(parent);
      placements.set(parent, await placementOf(parent));
      parent = placements.get(parent)!.parentId;
    }
    if (parent !== hubId) return null;
    const scopeIds = [hubId, ...chain, id];
    const isTrackAt = (i: number) => i > 0 && placements.get(scopeIds[i]!)!.isTrack;

    // 3. The rows on the chain (names, the track's status), in two reads.
    const below = scopeIds.slice(1);
    const [folderRows, trackRows] = await Promise.all([
      db.sdlcFolder.findMany({ where: { id: { in: below.filter(c => placements.get(c)!.isFolder) } } }),
      db.sdlcTrack.findMany({ where: { id: { in: below.filter(c => placements.get(c)!.isTrack) } } }),
    ]);
    const folders = new Map(folderRows.map(row => [row.id, row]));
    const tracks = new Map(trackRows.map(row => [row.id, row]));
    const folder = folders.get(id);
    const track = folder ? undefined : tracks.get(id);
    const row = folder ?? track;
    if (!row) return null;

    // 4. A repository wiki on the chain (sdlc-wiki-<hubId>-<repoId>, right under the Wiki root):
    //    out of search while that repository is detached from the hub.
    const repoAt = (i: number) => {
      const scopeId = scopeIds[i]!;
      const isRepoWiki = i > 0 && scopeIds[i - 1] === wikiRoot && scopeId !== hubWiki && scopeId.startsWith(repoWikiPrefix);
      return isRepoWiki ? scopeId.slice(repoWikiPrefix.length) : null;
    };
    const repoId = scopeIds.map((_, i) => repoAt(i)).find(Boolean) ?? null;
    if (repoId) {
      const attached = await db.sdlcEntityLink.findFirst({
        where: { channelId: hubId, sourceType: 'CHANNEL', targetType: 'REPOSITORY', targetId: repoId, relationType: SDLC_MEMBERSHIP_RELATION },
        select: { id: true },
      });
      if (!attached) return null;
    }

    // 5. Its branch. A track sits only in the tracks branch.
    const branch: SdlcBranch = scopeIds.includes(wikiRoot) ? 'WIKI' : scopeIds.includes(knowledgeRoot) ? 'KNOWLEDGE' : 'TRACKS';
    if (track && branch !== 'TRACKS') return null;

    // 6. Its type and its parent's type, the track it is in, and its path.
    const typeAt = (i: number): SdlcContainerType => {
      const scopeId = scopeIds[i]!;
      if (isTrackAt(i)) return 'TRACK';
      if (scopeId === wikiRoot) return 'WIKI';
      if (scopeId === hubWiki) return 'HUB_WIKI';
      if (scopeId === knowledgeRoot) return 'KNOWLEDGE';
      if (repoAt(i)) return 'REPOSITORY';
      return 'FOLDER';
    };
    const self = scopeIds.length - 1;
    const parentId = scopeIds[self - 1]!;
    const trackId = scopeIds.find((_, i) => isTrackAt(i)) ?? '';
    const path = below.map(c => folders.get(c)?.name ?? tracks.get(c)?.name ?? '').join('/');

    return {
      docId: id,
      docType: VespaDocType.SDLC_CONTAINER,
      channelRef: `id:${NAMESPACE}:${channelSchema}::${hubId}`,
      projectId: channel.projectId ?? '',
      branch,
      containerType: track ? 'TRACK' : typeAt(self),
      name: row.name,
      description: track?.description ?? '',
      trackId,
      trackStatus: trackId ? String(tracks.get(trackId)?.status ?? '') : '',
      parentId,
      parentType: track || parentId === hubId ? 'HUB' : typeAt(self - 1),
      repoRef: repoId ? `id:${NAMESPACE}:${sdlcRepositorySchema}::${repoId}` : '',
      scopeIds,
      depth: scopeIds.length - 2,
      path,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  });

  /** The container an item sits in (a track or folder is its own); null when it is not placed in the hub. */
  const containerOf = async (type: string, id: string): Promise<string | null> => {
    const containerId = type === 'TRACK' || type === 'FOLDER' ? id : (await placementOf(id)).parentId;
    if (!containerId || !(await container(containerId))) return null;
    return containerId;
  };

  /**
   * A document's SDLC fields (a canvas or an upload of the hub); null for anything else. With
   * `withRelated`, also the hub documents linked to it as context, in both directions.
   */
  const documentOf = async (type: string, id: string, withRelated = false): Promise<SdlcFieldValues<SdlcFileFields> | null> => {
    // 1. Its own fields.
    let own: SdlcFieldValues<SdlcFileFields> | null = null;
    if (type === 'CANVAS') {
      const canvas = await db.canvas.findFirst({
        where: { id, channelId: hubId, sdlcArtifact: { isNot: null } },
        select: { folderId: true, sdlcArtifact: { select: { artifactStatus: true } } },
      });
      const containerId = canvas ? await containerOf('CANVAS', id) : null;
      if (canvas && containerId) {
        // Its type is its canvas folder ("PRDs", "Tech Docs").
        const docType = canvas.folderId
          ? await db.canvasFolder.findFirst({ where: { id: canvas.folderId, channelId: hubId }, select: { name: true } })
          : null;
        own = {
          sdlcContainerRef: sdlcContainerRef(containerId),
          sdlcTypeName: docType?.name || null,
          sdlcStatus: canvas.sdlcArtifact?.artifactStatus || null,
          sdlcRelatedDocumentIds: null,
        };
      }
    } else if (type === 'ATTACHMENT') {
      const filed = await db.sdlcEntityLink.findFirst({
        where: { channelId: hubId, relationType: SDLC_CONTAINMENT_RELATION, targetType: 'ATTACHMENT', targetId: id },
        select: { id: true },
      });
      const containerId = filed ? await containerOf('ATTACHMENT', id) : null;
      if (containerId) {
        own = {
          sdlcContainerRef: sdlcContainerRef(containerId),
          sdlcTypeName: null,
          sdlcStatus: null,
          sdlcRelatedDocumentIds: null,
        };
      }
    }
    if (!own || !withRelated) return own;

    // 2. Its CONTEXT edges, oldest first; the other end counts when it is a document of the hub.
    const links = await db.sdlcEntityLink.findMany({
      where: { channelId: hubId, relationType: 'CONTEXT', OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] },
      orderBy: OLDEST_FIRST,
      select: { sourceType: true, sourceId: true, targetType: true, targetId: true },
    });
    const relatedIds: string[] = [];
    for (const link of links) {
      if (link.sourceId === link.targetId) continue;
      const isSource = link.sourceType === type && link.sourceId === id;
      const [otherType, otherId] = isSource ? [link.targetType, link.targetId] : [link.sourceType, link.sourceId];
      if (!relatedIds.includes(otherId) && (await documentOf(otherType, otherId))) relatedIds.push(otherId);
    }

    return {
      sdlcContainerRef: own.sdlcContainerRef,
      sdlcTypeName: own.sdlcTypeName,
      sdlcStatus: own.sdlcStatus,
      sdlcRelatedDocumentIds: relatedIds.length ? relatedIds : null,
    };
  };

  /**
   * Where a ticket sits in this hub, from its links here (oldest first); null when none of them
   * reaches a placed item. Every item it is linked to is one of its places.
   */
  const ticketIn = async (links: TicketLink[]): Promise<SdlcTicketFields | null> => {
    // Each linked item's container, the item when it is a document, the repository of its container.
    const containerIds = new Set<string>();
    const documentIds = new Set<string>();
    const repoIds = new Set<string>();
    for (const link of links) {
      const [itemType, itemId] = link.targetType === 'TICKET' ? [link.sourceType, link.sourceId] : [link.targetType, link.targetId];
      const containerId = await containerOf(itemType, itemId);
      if (!containerId) continue;

      containerIds.add(containerId);
      // repoRef is id:<namespace>:sdlc_repository::<repoId> on a repository wiki's containers.
      const { repoRef } = (await container(containerId))!;
      if (repoRef) repoIds.add(repoRef.split('::')[1]!);
      if (link.relationType !== SDLC_CONTAINMENT_RELATION && (await documentOf(itemType, itemId))) documentIds.add(itemId);
    }
    if (!containerIds.size) return null;

    return {
      sdlcContainerIds: [...containerIds],
      sdlcDocumentIds: [...documentIds],
      sdlcRepoIds: [...repoIds],
    };
  };

  return { container, containerOf, documentOf, ticketIn };
}

/** A track or folder's sdlc_container document; null when it is not placed in `hubId`. */
export function sdlcContainerDocument(id: string, hubId: string): Promise<VespaSdlcContainerDocument | null> {
  return sdlcHub(hubId).container(id);
}

/** A canvas's SDLC fields for Vespa; all null unless it is an SDLC document filed in a hub. */
export async function sdlcFieldsForCanvas(canvas: { id: string; channelId?: string | null }): Promise<SdlcFieldValues<SdlcFileFields>> {
  const fields = canvas.channelId ? await sdlcHub(canvas.channelId).documentOf('CANVAS', canvas.id, true) : null;
  return fields ?? {
    sdlcContainerRef: null,
    sdlcTypeName: null,
    sdlcStatus: null,
    sdlcRelatedDocumentIds: null,
  };
}

/** An uploaded file's SDLC fields for Vespa; all null unless it was uploaded into a hub's track. */
export async function sdlcFieldsForAttachment(attachment: { id: string; entityType?: string | null; entityId?: string | null }): Promise<SdlcFieldValues<SdlcFileFields>> {
  const hubId = attachment.entityType === 'SDLC_HUB' ? attachment.entityId : null;
  const fields = hubId ? await sdlcHub(hubId).documentOf('ATTACHMENT', attachment.id, true) : null;
  return fields ?? {
    sdlcContainerRef: null,
    sdlcTypeName: null,
    sdlcStatus: null,
    sdlcRelatedDocumentIds: null,
  };
}

/**
 * A ticket's SDLC fields for Vespa, across every hub it is linked in: the union of its places
 * there, in the order its links were made. All null outside SDLC.
 */
export async function sdlcFieldsForTicket(ticketId: string): Promise<SdlcFieldValues<SdlcTicketFields>> {
  // 1. All its links, in every hub, oldest first.
  const links: TicketLink[] = await db.sdlcEntityLink.findMany({
    where: {
      OR: [
        { targetType: 'TICKET', targetId: ticketId, sourceType: { not: 'TICKET' }, relationType: { in: ['TICKET', 'CONTEXT', SDLC_CONTAINMENT_RELATION] } },
        { sourceType: 'TICKET', sourceId: ticketId, targetType: { not: 'TICKET' }, relationType: 'CONTEXT' },
      ],
    },
    orderBy: OLDEST_FIRST,
    select: { channelId: true, sourceType: true, sourceId: true, targetType: true, targetId: true, relationType: true },
  });
  const hubIds = new Set(links.map(link => link.channelId));

  // 2. Its places in each hub, merged.
  const containerIds = new Set<string>();
  const documentIds = new Set<string>();
  const repoIds = new Set<string>();
  for (const hubId of hubIds) {
    const inHub = await sdlcHub(hubId).ticketIn(links.filter(link => link.channelId === hubId));
    inHub?.sdlcContainerIds.forEach(id => containerIds.add(id));
    inHub?.sdlcDocumentIds.forEach(id => documentIds.add(id));
    inHub?.sdlcRepoIds.forEach(id => repoIds.add(id));
  }

  return {
    sdlcContainerIds: containerIds.size ? [...containerIds] : null,
    sdlcDocumentIds: documentIds.size ? [...documentIds] : null,
    sdlcRepoIds: repoIds.size ? [...repoIds] : null,
  };
}

/**
 * The SDLC fields for Vespa of a conversation's messages: the container of the item it was
 * started on, and that item when it is a document. All null when it was not started in a hub.
 */
export async function sdlcFieldsForConversation(conversationId: string | null | undefined): Promise<SdlcFieldValues<SdlcConversationFields>> {
  const notInHub = { sdlcContainerRef: null, sdlcDocumentId: null };
  if (!conversationId) return notInHub;

  // 1. What it was started on: its DISCUSSION edges, oldest first. Its hub is the oldest one's.
  const startedOn = await db.sdlcEntityLink.findMany({
    where: { targetType: 'CONVERSATION', targetId: conversationId, relationType: 'DISCUSSION' },
    orderBy: OLDEST_FIRST,
    select: { channelId: true, sourceType: true, sourceId: true },
  });
  if (!startedOn.length) return notInHub;
  const hubId = startedOn[0]!.channelId;
  const hub = sdlcHub(hubId);

  // 2. The first of those items placed in the hub decides where its messages sit.
  for (const item of startedOn.filter(link => link.channelId === hubId)) {
    const containerId = await hub.containerOf(item.sourceType, item.sourceId);
    if (!containerId) continue;
    const isDocument = Boolean(await hub.documentOf(item.sourceType, item.sourceId));

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcDocumentId: isDocument ? item.sourceId : null,
    };
  }
  return notInHub;
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
