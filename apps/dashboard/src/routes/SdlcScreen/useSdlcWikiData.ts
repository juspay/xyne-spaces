import { useMemo, useState } from 'react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import {
  type WikiCanvas,
  type WikiScope,
  type SdlcWikiPage,
  wikiScopePages,
  wikiScopes,
} from './sdlcWikiTree';
import { type HubWorkflow, useHubWorkflow } from './hubWorkflowRunPolicy';

export interface SdlcWikiData<Repo> {
  scopes: WikiScope[];
  /** Live pages per scope folder. */
  pageCounts: ReadonlyMap<string, number>;
  /** The scope on screen: the url's, else the one holding the open page. */
  scope: WikiScope | null;
  scopeRepo: Repo | null;
  /** The scope's pages, archived ones too when asked for. */
  pages: SdlcWikiPage[];
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  /** The open page, when the open artifact is one of the scope's pages. */
  selectedPage: SdlcWikiPage | undefined;
  workflow: HubWorkflow;
}

/**
 * Everything the Wiki page reads, loaded only while it is open. The hub's wiki is
 * its own tree — scope folders per repository, pages beneath them — kept in the
 * same tables as a track's, under HUB_ITEM links; nothing else in the hub needs it,
 * so no other page pays for it.
 */
export function useSdlcWikiData<Repo extends { id: string }>(input: {
  channelId: string | null;
  enabled: boolean;
  repos: readonly Repo[];
  /** `?wiki=`: the scope folder asked for. */
  scopeParam: string | null;
  selectedCanvasId: string | null;
}): SdlcWikiData<Repo> {
  const { channelId, enabled, repos, scopeParam, selectedCanvasId } = input;
  const active = Boolean(channelId) && enabled;
  const [itemRows] = useCachedQuery(queries.getSdlcHubItems({ channelId: channelId ?? '' }), {
    enabled: active,
  });
  const [folderRows] = useCachedQuery(queries.getSdlcHubFolders({ channelId: channelId ?? '' }), {
    enabled: active,
  });
  const [workflowLink] = useCachedQuery(
    queries.getSdlcWikiWorkflow({ channelId: channelId ?? '' }),
    {
      enabled: active,
    },
  );
  const workflow = useHubWorkflow(active ? (workflowLink?.workflow?.id ?? null) : null);

  const edges = useMemo(
    () => (active && Array.isArray(itemRows) ? itemRows : []),
    [active, itemRows],
  );
  const folderNames = useMemo(
    () =>
      new Map(
        (active && Array.isArray(folderRows) ? folderRows : []).map(folder => [
          folder.id,
          folder.name,
        ]),
      ),
    [active, folderRows],
  );
  const scopes = useMemo(
    () =>
      channelId && active
        ? wikiScopes({
            channelId,
            edges,
            folderNames,
            memberRepoIds: new Set(repos.map(repo => repo.id)),
          })
        : [],
    [channelId, active, edges, folderNames, repos],
  );
  const pagesByScope = useMemo(() => {
    // Each page's artifact comes with the link filing it.
    const wikiCanvases = new Map<string, WikiCanvas>(
      edges.flatMap(edge => {
        const canvas = edge.targetCanvas;
        return canvas
          ? [
              [
                canvas.id,
                {
                  id: canvas.id,
                  title: canvas.title,
                  updatedAt: canvas.lastEditedAt ?? canvas.updatedAt,
                  archived: canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED',
                },
              ] as const,
            ]
          : [];
      }),
    );
    return new Map(
      scopes.map(scope => [
        scope.folderId,
        wikiScopePages({
          scopeFolderId: scope.folderId,
          edges,
          folderNames,
          canvases: wikiCanvases,
        }),
      ]),
    );
  }, [scopes, edges, folderNames]);
  const pageCounts = useMemo(
    () =>
      new Map(
        [...pagesByScope].map(
          ([folderId, pages]) => [folderId, pages.filter(page => !page.archived).length] as const,
        ),
      ),
    [pagesByScope],
  );
  // A page link without ?wiki= falls back to the page's own folder.
  const scope =
    scopes.find(item => item.folderId === scopeParam) ??
    scopes.find(item =>
      pagesByScope.get(item.folderId)?.some(page => page.canvasId === selectedCanvasId),
    ) ??
    null;
  const scopeRepo = useMemo(
    () => repos.find(repo => repo.id === scope?.repoId) ?? null,
    [repos, scope],
  );
  const [showArchived, setShowArchived] = useState(false);
  const scopeAllPages = useMemo(
    () => (scope ? (pagesByScope.get(scope.folderId) ?? []) : []),
    [scope, pagesByScope],
  );
  const pages = useMemo(
    () => (showArchived ? scopeAllPages : scopeAllPages.filter(page => !page.archived)),
    [showArchived, scopeAllPages],
  );
  const selectedPage = scopeAllPages.find(page => page.canvasId === selectedCanvasId);

  return {
    scopes,
    pageCounts,
    scope,
    scopeRepo,
    pages,
    showArchived,
    setShowArchived,
    selectedPage,
    workflow,
  };
}
