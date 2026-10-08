import { sdlcHubWikiFolderId, sdlcWikiFolderId } from '@xyne/shared';

export interface SdlcWikiPage {
  canvasId: string;
  title: string;
  /** Folders between the Wiki (or Hub Knowledge) root and the page, joined by "/". */
  folderPath: string;
  updatedAt: string;
  archived: boolean;
}

export interface HubItemEdge {
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface WikiCanvas {
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
}

export interface WikiScope {
  folderId: string;
  name: string;
  hub: boolean;
  /** Null on the Hub Wiki, which belongs to no single repository. */
  repoId: string | null;
}

/**
 * One folder per member repository, then the Hub Wiki as Relationships once the hub has two.
 * A disconnected repository's folder is kept, only hidden, so reconnecting brings its pages back.
 */
export function wikiScopes(input: {
  channelId: string;
  edges: readonly HubItemEdge[];
  folderNames: ReadonlyMap<string, string>;
  memberRepoIds: ReadonlySet<string>;
}): WikiScope[] {
  const rootId = sdlcWikiFolderId(input.channelId);
  const hubId = sdlcHubWikiFolderId(input.channelId);
  const repositoryPrefix = `${rootId}-`;
  const scopes = input.edges
    .filter(edge => edge.sourceId === rootId && edge.targetType === 'FOLDER')
    .filter(edge => edge.targetId !== hubId || input.memberRepoIds.size > 1)
    .filter(
      edge =>
        !edge.targetId.startsWith(repositoryPrefix) ||
        input.memberRepoIds.has(edge.targetId.slice(repositoryPrefix.length)),
    )
    .map(edge => {
      const hub = edge.targetId === hubId;
      return {
        folderId: edge.targetId,
        name: hub ? 'Relationships' : (input.folderNames.get(edge.targetId) ?? 'Repository'),
        hub,
        repoId: hub ? null : edge.targetId.slice(repositoryPrefix.length),
      };
    });
  return scopes.sort((left, right) =>
    left.hub === right.hub ? left.name.localeCompare(right.name) : left.hub ? 1 : -1,
  );
}

export function wikiScopePages(input: {
  scopeFolderId: string;
  edges: readonly HubItemEdge[];
  folderNames: ReadonlyMap<string, string>;
  canvases: ReadonlyMap<string, WikiCanvas>;
}): SdlcWikiPage[] {
  const parentOf = new Map(input.edges.map(edge => [edge.targetId, edge.sourceId]));
  const pages: SdlcWikiPage[] = [];
  for (const edge of input.edges) {
    const canvas = edge.targetType === 'CANVAS' ? input.canvases.get(edge.targetId) : undefined;
    if (!canvas) continue;
    const segments: string[] = [];
    let folderId: string | undefined = edge.sourceId;
    // Bounded: a cycle cannot come from the server, but a bad row must not hang the tab.
    for (let depth = 0; folderId && folderId !== input.scopeFolderId && depth < 64; depth++) {
      segments.unshift(input.folderNames.get(folderId) ?? '');
      folderId = parentOf.get(folderId);
    }
    if (folderId !== input.scopeFolderId) continue;
    pages.push({
      canvasId: canvas.id,
      title: canvas.title,
      folderPath: segments.join('/'),
      updatedAt: new Date(canvas.updatedAt).toISOString(),
      archived: canvas.archived,
    });
  }
  return pages;
}
