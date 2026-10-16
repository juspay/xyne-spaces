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
 * (sdlcContainerRef); Vespa imports the rest of their place from it. A conversation started on a
 * document sits in the document's container and names it (sdlcDocumentId). A ticket can sit in
 * several places, so its containers and documents are fed as lists (sdlcContainerIds,
 * sdlcDocumentIds, sdlcRepoIds).
 *
 * Each entry reads only what it needs: an item's place is found by walking up the edges that
 * place it to the hub, never by loading the whole hub, so a job costs the depth of its item, not
 * the size of its hub. Reads are made when the job runs, so it maps the hub as it is then.
 *
 * The sdlcFieldsFor* functions return the SDLC fields as written to Vespa: an empty value is
 * null (a Vespa reference cannot hold ''), and an item in no hub gets every field null, which
 * clears a placement it no longer has.
 */

const PLACED_TYPES = new Set(['FOLDER', 'CANVAS', 'ATTACHMENT', 'LINK']);
const PLACING_RELATIONS = [SDLC_TRACK_MEMBERSHIP_RELATION, SDLC_CONTAINMENT_RELATION, SDLC_HUB_ITEM_RELATION];
const OLDEST_FIRST = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

// Vespa document ids are id:<namespace>:<schema>::<id>, the namespace being the deployment's
// (VESPA_NAMESPACE), as in the mapper's getRef.
const sdlcContainerRef = (containerId: string): string => `id:${NAMESPACE}:${sdlcContainerSchema}::${containerId}`;

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

  const trackRow = once((id: string) => db.sdlcTrack.findUnique({ where: { id } }));
  const folderRow = once((id: string) => db.sdlcFolder.findUnique({ where: { id } }));

  const isTrack = async (id: string): Promise<boolean> => id !== hubId && (await placementOf(id)).isTrack;

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

  /** A track or folder's sdlc_container document; null when it is not placed in the hub. */
  const container = once(async (id: string): Promise<VespaSdlcContainerDocument | null> => {
    // 1. The hub.
    const channel = await hubChannel(true);
    if (!channel) return null;

    // 2. Its own row: a filed folder, else a track.
    const placement = await placementOf(id);
    const folder = placement.isFolder ? await folderRow(id) : null;
    const track = !folder && placement.isTrack ? await trackRow(id) : null;
    const row = folder ?? track;
    if (!row) return null;

    // 3. The containers above it, up to the hub (hub first); not placed when they never reach it.
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let parent = placement.parentId;
    while (parent && parent !== hubId && !seen.has(parent)) {
      chain.unshift(parent);
      seen.add(parent);
      parent = (await placementOf(parent)).parentId;
    }
    if (parent !== hubId) return null;
    chain.unshift(hubId);
    const scopeIds = [...chain, id];

    // 4. A repository wiki on the chain: out of search while that repository is detached.
    const repos = await Promise.all(scopeIds.map(repoOfWiki));
    for (const repo of repos) {
      if (repo && !(await isAttached(repo))) return null;
    }
    const repoId = repos.find(Boolean);

    // 5. Its branch. A track sits only in the tracks branch.
    const branch: SdlcBranch = scopeIds.includes(wikiRoot) ? 'WIKI' : scopeIds.includes(knowledgeRoot) ? 'KNOWLEDGE' : 'TRACKS';
    if (track && branch !== 'TRACKS') return null;

    // 6. The track on the chain, and the names on it for the path.
    const tracks = await Promise.all(scopeIds.map(isTrack));
    const trackId = scopeIds.find((_, i) => tracks[i]) ?? '';
    const names = await Promise.all(scopeIds.slice(1).map(async scopeId => {
      const scopePlacement = await placementOf(scopeId);
      const folderName = scopePlacement.isFolder ? (await folderRow(scopeId))?.name : undefined;
      const trackName = scopePlacement.isTrack ? (await trackRow(scopeId))?.name : undefined;
      return folderName ?? trackName ?? '';
    }));
    const parentId = chain[chain.length - 1]!;

    return {
      docId: id,
      docType: VespaDocType.SDLC_CONTAINER,
      channelRef: `id:${NAMESPACE}:${channelSchema}::${hubId}`,
      projectId: channel.projectId ?? '',
      branch,
      containerType: track ? 'TRACK' : await containerTypeOf(id),
      name: row.name,
      description: track?.description ?? '',
      trackId,
      trackStatus: trackId ? String((await trackRow(trackId))?.status ?? '') : '',
      parentId,
      parentType: track || parentId === hubId ? 'HUB' : await containerTypeOf(parentId),
      repoRef: repoId ? `id:${NAMESPACE}:${sdlcRepositorySchema}::${repoId}` : '',
      scopeIds,
      depth: chain.length - 1,
      path: names.join('/'),
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

  /** A canvas's SDLC fields, without its related documents; null when it is not an SDLC document of the hub. */
  const canvasFields = once(async (id: string): Promise<SdlcFieldValues<SdlcFileFields> | null> => {
    const canvas = await db.canvas.findFirst({
      where: { id, channelId: hubId, sdlcArtifact: { isNot: null } },
      select: { folderId: true, sdlcArtifact: { select: { artifactStatus: true } } },
    });
    if (!canvas) return null;

    const containerId = await containerOf('CANVAS', id);
    if (!containerId) return null;

    // Its type is its canvas folder ("PRDs", "Tech Docs").
    const type = canvas.folderId
      ? await db.canvasFolder.findFirst({ where: { id: canvas.folderId, channelId: hubId }, select: { name: true } })
      : null;

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: type?.name || null,
      sdlcStatus: canvas.sdlcArtifact?.artifactStatus || null,
      sdlcRelatedDocumentIds: null,
    };
  });

  /** An upload's SDLC fields, without its related documents; null when it is not filed in the hub's tracks. */
  const uploadFields = once(async (id: string): Promise<SdlcFieldValues<SdlcFileFields> | null> => {
    const filed = await db.sdlcEntityLink.findFirst({
      where: { channelId: hubId, relationType: SDLC_CONTAINMENT_RELATION, targetType: 'ATTACHMENT', targetId: id },
      select: { id: true },
    });
    if (!filed) return null;

    const containerId = await containerOf('ATTACHMENT', id);
    if (!containerId) return null;

    return {
      sdlcContainerRef: sdlcContainerRef(containerId),
      sdlcTypeName: null,
      sdlcStatus: null,
      sdlcRelatedDocumentIds: null,
    };
  });

  /** A document's SDLC fields (a canvas or an upload), without its related documents; null for anything else. */
  const documentOf = (type: string, id: string): Promise<SdlcFieldValues<SdlcFileFields> | null> => {
    if (type === 'CANVAS') return canvasFields(id);
    if (type === 'ATTACHMENT') return uploadFields(id);
    return Promise.resolve(null);
  };

  /** A document's SDLC fields, with the hub documents linked to it as context (both directions). */
  const document = async (type: string, id: string): Promise<SdlcFieldValues<SdlcFileFields> | null> => {
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
      sdlcRelatedDocumentIds: relatedIds.length ? relatedIds : null,
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

/** A canvas's SDLC fields for Vespa; all null unless it is an SDLC document filed in a hub. */
export async function sdlcFieldsForCanvas(canvas: { id: string; channelId?: string | null }): Promise<SdlcFieldValues<SdlcFileFields>> {
  const fields = canvas.channelId ? await sdlcHub(canvas.channelId).document('CANVAS', canvas.id) : null;
  return fields ?? {
    sdlcContainerRef: null,
    sdlcTypeName: null,
    sdlcStatus: null,
    sdlcRelatedDocumentIds: null,
  };
}

/** An uploaded file's SDLC fields for Vespa; all null unless it was uploaded into a hub's track. */
export async function sdlcFieldsForAttachment(attachment: { id: string; entityType?: string | null; entityId?: string | null }): Promise<SdlcFieldValues<SdlcFileFields>> {
  const inHub = attachment.entityType === 'SDLC_HUB' && attachment.entityId;
  const fields = inHub ? await sdlcHub(attachment.entityId!).document('ATTACHMENT', attachment.id) : null;
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
    sdlcContainerIds: containerIds.length ? containerIds : null,
    sdlcDocumentIds: documentIds.length ? documentIds : null,
    sdlcRepoIds: repoIds.length ? repoIds : null,
  };
}

/**
 * The SDLC fields for Vespa of a conversation's messages: the container of the item it was
 * started on, and that item when it is a document. All null when it was not started in a hub.
 */
export async function sdlcFieldsForConversation(conversationId: string | null | undefined): Promise<SdlcFieldValues<SdlcDiscussionFields>> {
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
