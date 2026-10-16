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
const sdlcContainerRef = (containerId: string): string =>
  `id:${NAMESPACE}:${sdlcContainerSchema}::${containerId}`;
const repositoryRef = (repoId: string): string =>
  `id:${NAMESPACE}:${sdlcRepositorySchema}::${repoId}`;

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

const addOnce = (list: string[], value: string): void => {
  if (!list.includes(value)) list.push(value);
};

/** How an id is placed in the hub. */
interface Placement {
  /** A track of the hub (CHANNEL -> TRACK [TRACK]). */
  isTrack: boolean;
  /** A folder filed in the hub (-> FOLDER [TRACK_ITEM | HUB_ITEM]). */
  isFolder: boolean;
  /** What it sits in: a track, a folder, or the hub itself; null when nothing places it. */
  parentId: string | null;
}

/** Where a track or folder sits: everything about it that comes from the containers above it. */
interface Position {
  branch: SdlcBranch;
  parentId: string;
  /** The hub, every container above it, then itself. */
  scopeIds: string[];
  depth: number;
  /** Names below the hub, joined: "Payments/Design". */
  path: string;
  trackId: string;
  trackStatus: string;
  repoRef: string;
}

/**
 * One hub, read only as far as the entries asked for need. Short-lived: made for a job (or a
 * backfill pass) and dropped after it.
 */
function sdlcHub(hubId: string) {
  const wikiRoot = sdlcWikiFolderId(hubId);
  const hubWiki = sdlcHubWikiFolderId(hubId);
  const knowledgeRoot = sdlcHubKnowledgeFolderId(hubId);
  const repoWikiPrefix = `${wikiRoot}-`;

  /** The hub's channel; null when it is not an SDLC hub. */
  const hubChannel = once(async (_: true) => {
    const channel = await db.channel.findUnique({ where: { id: hubId }, select: { type: true, projectId: true } });
    return channel?.type === ChannelType.SDLC ? channel : null;
  });

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

  /** The containers above `id`, hub first; [] when its chain does not reach the hub. */
  const chainOf = once(async (id: string): Promise<string[]> => {
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let parent = (await placementOf(id)).parentId;
    while (parent && !seen.has(parent)) {
      chain.unshift(parent);
      if (parent === hubId) return chain;
      seen.add(parent);
      parent = (await placementOf(parent)).parentId;
    }
    return [];
  });

  const trackRow = once((id: string) => db.sdlcTrack.findUnique({ where: { id } }));
  const folderRow = once((id: string) => db.sdlcFolder.findUnique({ where: { id } }));

  const isTrack = async (id: string): Promise<boolean> => id !== hubId && (await placementOf(id)).isTrack;

  const nameOf = async (id: string): Promise<string> => {
    const placement = await placementOf(id);
    const folderName = placement.isFolder ? (await folderRow(id))?.name : undefined;
    const trackName = placement.isTrack ? (await trackRow(id))?.name : undefined;
    return folderName ?? trackName ?? '';
  };

  /** The repository whose wiki `id` is (sdlc-wiki-<hubId>-<repoId>, under the Wiki root), or null. */
  const repoOfWiki = async (id: string): Promise<string | null> => {
    const isRepoWiki = id !== hubWiki && id.startsWith(repoWikiPrefix) && (await placementOf(id)).parentId === wikiRoot;
    return isRepoWiki ? id.slice(repoWikiPrefix.length) : null;
  };

  const isAttached = once(async (repoId: string): Promise<boolean> => {
    const membership = await db.sdlcEntityLink.findFirst({
      where: { channelId: hubId, sourceType: 'CHANNEL', targetType: 'REPOSITORY', targetId: repoId, relationType: SDLC_MEMBERSHIP_RELATION },
      select: { id: true },
    });
    return Boolean(membership);
  });

  const containerTypeOf = async (id: string): Promise<SdlcContainerType> => {
    if (await isTrack(id)) return 'TRACK';
    if (id === wikiRoot) return 'WIKI';
    if (id === hubWiki) return 'HUB_WIKI';
    if (id === knowledgeRoot) return 'KNOWLEDGE';
    if (await repoOfWiki(id)) return 'REPOSITORY';
    return 'FOLDER';
  };

  /** Where a track or folder sits; null when it does not reach the hub or is in a detached repository's wiki. */
  const positionOf = async (id: string): Promise<Position | null> => {
    // 1. Its chain up to the hub.
    const chain = await chainOf(id);
    if (!chain.length) return null;
    const scopeIds = [...chain, id];

    // 2. A repository wiki on the chain: out of search while that repository is detached.
    const repos = await Promise.all(scopeIds.map(repoOfWiki));
    for (const repo of repos) {
      if (repo && !(await isAttached(repo))) return null;
    }
    const repoId = repos.find(Boolean);

    // 3. The track on the chain, if any.
    const tracks = await Promise.all(scopeIds.map(isTrack));
    const trackId = scopeIds.find((_, i) => tracks[i]) ?? '';

    // 4. The names on the chain, for the path.
    const names = await Promise.all(scopeIds.slice(1).map(nameOf));

    return {
      branch: scopeIds.includes(wikiRoot) ? 'WIKI' : scopeIds.includes(knowledgeRoot) ? 'KNOWLEDGE' : 'TRACKS',
      parentId: chain[chain.length - 1]!,
      scopeIds,
      depth: chain.length - 1,
      path: names.join('/'),
      trackId,
      trackStatus: trackId ? String((await trackRow(trackId))?.status ?? '') : '',
      repoRef: repoId ? repositoryRef(repoId) : '',
    };
  };

  /** A track or folder's sdlc_container document; null when it is not placed in the hub. */
  const container = once(async (id: string): Promise<VespaSdlcContainerDocument | null> => {
    // 1. The hub.
    const channel = await hubChannel(true);
    if (!channel) return null;

    // 2. Its own row: a filed folder, else a track.
    const placement = await placementOf(id);
    const folder = placement.isFolder ? await folderRow(id) : null;
    const track = !folder && placement.isTrack ? await trackRow(id) : null;
    if (!folder && !track) return null;

    // 3. Where it sits. A track sits only in the tracks branch.
    const position = await positionOf(id);
    if (!position) return null;
    if (track && position.branch !== 'TRACKS') return null;

    const row = (folder ?? track)!;
    return {
      docId: id,
      docType: VespaDocType.SDLC_CONTAINER,
      channelRef: `id:${NAMESPACE}:${channelSchema}::${hubId}`,
      projectId: channel.projectId ?? '',
      branch: position.branch,
      containerType: track ? 'TRACK' : await containerTypeOf(id),
      name: row.name,
      description: track?.description ?? '',
      trackId: position.trackId,
      trackStatus: position.trackStatus,
      parentId: position.parentId,
      parentType: track || position.parentId === hubId ? 'HUB' : await containerTypeOf(position.parentId),
      repoRef: position.repoRef,
      scopeIds: position.scopeIds,
      depth: position.depth,
      path: position.path,
      createdBy: row.createdBy,
      createdAt: ms(row.createdAt),
      updatedAt: ms(row.updatedAt),
    };
  });

  /** The container an item sits in (a track or folder is its own); null when it is not placed in the hub. */
  const containerOf = async (type: string, id: string): Promise<string | null> => {
    const containerId = type === 'TRACK' || type === 'FOLDER' ? id : (await placementOf(id)).parentId;
    if (!containerId || !(await container(containerId))) return null;
    return containerId;
  };

  /** A canvas's own SDLC fields (no related documents yet); null when it is not an SDLC document of the hub. */
  const canvas = once(async (id: string): Promise<SdlcFileFields | null> => {
    const row = await db.canvas.findFirst({
      where: { id, channelId: hubId, sdlcArtifact: { isNot: null } },
      select: { folderId: true, sdlcArtifact: { select: { artifactStatus: true } } },
    });
    if (!row) return null;

    const containerId = await containerOf('CANVAS', id);
    if (!containerId) return null;

    // Its type is its canvas folder ("PRDs", "Tech Docs").
    const type = row.folderId
      ? await db.canvasFolder.findFirst({ where: { id: row.folderId, channelId: hubId }, select: { name: true } })
      : null;

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: type?.name || '',
      sdlcStatus: row.sdlcArtifact?.artifactStatus ?? '',
      sdlcRelatedDocumentIds: [],
    };
  });

  /** An upload's own SDLC fields; null when it is not filed in the hub's tracks. */
  const upload = once(async (id: string): Promise<SdlcFileFields | null> => {
    const filed = await db.sdlcEntityLink.findFirst({
      where: { channelId: hubId, relationType: SDLC_CONTAINMENT_RELATION, targetType: 'ATTACHMENT', targetId: id },
      select: { id: true },
    });
    if (!filed) return null;

    const containerId = await containerOf('ATTACHMENT', id);
    if (!containerId) return null;

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: '',
      sdlcStatus: '',
      sdlcRelatedDocumentIds: [],
    };
  });

  /** A document's own SDLC fields (a canvas or an upload); null for anything else. */
  const documentOf = (type: string, id: string): Promise<SdlcFileFields | null> => {
    if (type === 'CANVAS') return canvas(id);
    if (type === 'ATTACHMENT') return upload(id);
    return Promise.resolve(null);
  };

  /** A document's SDLC fields, with the hub documents linked to it as context (both directions). */
  const document = async (type: string, id: string): Promise<SdlcFileFields | null> => {
    // 1. Its own fields.
    const own = await documentOf(type, id);
    if (!own) return null;

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
      sdlcRelatedDocumentIds: relatedIds,
    };
  };

  /**
   * Where a ticket sits in this hub; null when it sits nowhere in it. Every item it is linked to
   * is one of its places: X -> TICKET [TICKET] (raised or linked there), X <-> TICKET [CONTEXT],
   * and TRACK -> TICKET [TRACK_ITEM] (the tracks whose board holds it).
   */
  const ticket = async (ticketId: string): Promise<SdlcTicketFields | null> => {
    // 1. Its links, oldest first.
    const links = await db.sdlcEntityLink.findMany({
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

    // 2. Each linked item's container, the item when it is a document, the repository of its container.
    const containerIds: string[] = [];
    const documentIds: string[] = [];
    const repoIds: string[] = [];
    for (const link of links) {
      const [itemType, itemId] = link.targetType === 'TICKET' ? [link.sourceType, link.sourceId] : [link.targetType, link.targetId];
      const containerId = await containerOf(itemType, itemId);
      if (!containerId) continue;

      addOnce(containerIds, containerId);
      // repoRef is id:<namespace>:sdlc_repository::<repoId> on a repository wiki's containers.
      const { repoRef } = (await container(containerId))!;
      if (repoRef) addOnce(repoIds, repoRef.split('::')[1]!);
      if (link.relationType !== SDLC_CONTAINMENT_RELATION && (await documentOf(itemType, itemId))) addOnce(documentIds, itemId);
    }
    if (!containerIds.length) return null;

    // 3. Only the deepest containers: one above another in the list is left out.
    const scopes = new Map<string, string[]>();
    for (const id of containerIds) scopes.set(id, (await container(id))!.scopeIds);
    const deepest = containerIds.filter(id => !containerIds.some(other => other !== id && scopes.get(other)!.includes(id)));

    return {
      sdlcContainerIds: deepest,
      sdlcDocumentIds: documentIds,
      sdlcRepoIds: repoIds,
    };
  };

  return { container, containerOf, document, documentOf, ticket };
}

/** A track or folder's sdlc_container document; null when it is not placed in `hubId`. */
export function sdlcContainerDocument(id: string, hubId: string): Promise<VespaSdlcContainerDocument | null> {
  return sdlcHub(hubId).container(id);
}

/** Every track and folder placed in a hub (the backfill lists them to feed). */
export async function sdlcHubContainerIds(hubId: string): Promise<string[]> {
  // 1. Every track and filed folder of the hub.
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

  // 2. Those placed in the hub (one reader, so their chains are shared).
  const hub = sdlcHub(hubId);
  const placed: string[] = [];
  for (const { targetId } of candidates) {
    if (await hub.container(targetId)) placed.push(targetId);
  }
  return placed;
}

/** A canvas's SDLC fields; null unless it is an SDLC document filed in a hub. */
export async function sdlcFieldsForCanvas(canvas: { id: string; channelId?: string | null }): Promise<SdlcFileFields | null> {
  if (!canvas.channelId) return null;
  return sdlcHub(canvas.channelId).document('CANVAS', canvas.id);
}

/** An uploaded file's SDLC fields; null unless it was uploaded into a hub's track. */
export async function sdlcFieldsForAttachment(attachment: { id: string; entityType?: string | null; entityId?: string | null }): Promise<SdlcFileFields | null> {
  if (attachment.entityType !== 'SDLC_HUB' || !attachment.entityId) return null;
  return sdlcHub(attachment.entityId).document('ATTACHMENT', attachment.id);
}

/**
 * A ticket's SDLC fields, across every hub it is linked in: the union of its places there, in
 * the order its links were made. Empty lists outside SDLC.
 */
export async function sdlcFieldsForTicket(ticketId: string): Promise<SdlcTicketFields> {
  // 1. The hubs it is linked in, oldest link first.
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
  const hubIds = [...new Set(links.map(link => link.channelId))];

  // 2. Its places in each hub, merged.
  const containerIds: string[] = [];
  const documentIds: string[] = [];
  const repoIds: string[] = [];
  for (const hubId of hubIds) {
    const inHub = await sdlcHub(hubId).ticket(ticketId);
    if (!inHub) continue;
    inHub.sdlcContainerIds.forEach(id => addOnce(containerIds, id));
    inHub.sdlcDocumentIds.forEach(id => addOnce(documentIds, id));
    inHub.sdlcRepoIds.forEach(id => addOnce(repoIds, id));
  }

  return {
    sdlcContainerIds: containerIds,
    sdlcDocumentIds: documentIds,
    sdlcRepoIds: repoIds,
  };
}

/**
 * The SDLC fields of a conversation's messages: the container of the item it was started on,
 * and that item when it is a document. Null when it was not started in an SDLC hub.
 */
export async function sdlcFieldsForConversation(conversationId: string | null | undefined): Promise<SdlcDiscussionFields | null> {
  if (!conversationId) return null;

  // 1. What it was started on: its DISCUSSION edges, oldest first. Its hub is the oldest one's.
  const startedOn = await db.sdlcEntityLink.findMany({
    where: { targetType: 'CONVERSATION', targetId: conversationId, relationType: 'DISCUSSION' },
    orderBy: OLDEST_FIRST,
    select: { channelId: true, sourceType: true, sourceId: true },
  });
  if (!startedOn.length) return null;
  const hubId = startedOn[0]!.channelId;
  const hub = sdlcHub(hubId);

  // 2. The first of those items placed in the hub decides where its messages sit.
  for (const item of startedOn.filter(link => link.channelId === hubId)) {
    const containerId = await hub.containerOf(item.sourceType, item.sourceId);
    if (!containerId) continue;
    const isDocument = Boolean(await hub.documentOf(item.sourceType, item.sourceId));

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcDocumentId: isDocument ? item.sourceId : '',
    };
  }
  return null;
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
