import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CollectionTreeDataSync } from '../../components/knowledgeBase/hooks/CollectionTreeDataSync';
import { useProjectCollections } from '../../components/knowledgeBase/hooks/useProjectCollections';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { GlobalCollectionsProvider, useGlobalCollections } from './hooks/useGlobalCollections';
import { KbContentsPanel, type KbContentsFile } from './components/KbContentsPanel';
import { resolveKbBasePath } from './utils/kbRoutePaths';
import { cn } from '../../utils/classNames';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../ui/Resizable/Resizable';

const KB_CONTENTS_DEFAULT_WIDTH = 240;
const KB_CONTENTS_MIN_WIDTH = 180;
const KB_CONTENTS_MAX_WIDTH = 600;
const KB_CONTENTS_COLLAPSED_WIDTH = 40;

interface KbContentsShellProps {
  children: React.ReactNode;
}

// The Google-Drive/wiki-style left Contents panel, shared by every place the
// KB folder browser or file viewer can be reached from — the standalone
// /knowledge-base route (KnowledgeBaseV2Layout) and the embedded /ai/knowledge
// screen (AIKnowledgeScreen) both render this exact component around their
// own content, rather than each keeping their own copy of this data-fetching
// and panel-wiring logic. `children` is whatever that caller's own main
// content is (an <Outlet/> for a nested-route layout, or a screen element
// directly for a leaf route) — this shell only owns the Contents panel
// itself and the resizable split next to it.
const KbContentsShellInner: React.FC<KbContentsShellProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const globalCollections = useGlobalCollections();
  const { activeCollection, currentFolderId, currentFileId, nodes, rootChildrenIds } =
    useProjectCollections();

  const contentsPanelRef = useRef<PanelImperativeHandle>(null);
  const [isContentsCollapsed, setIsContentsCollapsed] = useState(false);

  useEffect(() => {
    const panel = contentsPanelRef.current;
    if (!panel) return;
    if (isContentsCollapsed) {
      if (!panel.isCollapsed()) panel.collapse();
    } else if (panel.isCollapsed()) {
      panel.expand();
    }
  }, [isContentsCollapsed]);

  const collectionId = activeCollection?.id ?? null;

  const collectionName =
    activeCollection?.name ??
    (collectionId ? globalCollections.byId(collectionId)?.name : undefined) ??
    'Collection';

  // The tree loads a folder's files lazily (only the root + whichever
  // folder is currently open), which can't show every expanded folder's
  // files at once — only ever the active one. `collectionFilesByRoot` pulls
  // every file in the whole collection in one query (already used elsewhere
  // for the root's rolled-up ingestion badges), so every folder in the tree
  // can show its own files as soon as it's expanded, independent of which
  // one is currently active — matching how Canvas's folders each show their
  // own canvases regardless of which is selected.
  const [allCollectionFiles] = useCachedQuery(
    queries.collectionFilesByRoot({ rootCollectionId: collectionId ?? '' }),
    !!collectionId,
  );

  const filesByFolder = useMemo(() => {
    const map = new Map<string, KbContentsFile[]>();
    for (const f of allCollectionFiles ?? []) {
      const list = map.get(f.collectionId);
      const entry = { id: f.id, name: f.name };
      if (list) list.push(entry);
      else map.set(f.collectionId, [entry]);
    }
    return map;
  }, [allCollectionFiles]);

  // The active folder and all of its ancestors default open, so wherever
  // you are — reached by browsing the tree, a grid click, a citation link,
  // anything — is always visible fully expanded, not just the path down to
  // it. (An earlier version left the active folder's own row collapsed by
  // default, on the theory that its contents already show in the main pane
  // so the tree didn't need to also reveal them — but that meant a folder
  // full of only subfolders showed nothing in the tree until you clicked
  // its chevron yourself, and a file stayed invisible under its own
  // collapsed parent. Always-open is simpler and matches how every other
  // file explorer actually behaves.)
  const activePath = useMemo(() => {
    const path = new Set<string>();
    let curr = currentFolderId ? nodes[currentFolderId] : undefined;
    while (curr) {
      path.add(curr.id);
      curr = curr.parentId ? nodes[curr.parentId] : undefined;
    }
    return path;
  }, [currentFolderId, nodes]);

  // Folder/file navigation stays on whichever browse screen you're already
  // on — /ai/knowledge if that's embedding this shell, /knowledge-base
  // otherwise — instead of always hopping to the standalone route. Both
  // routes now have their own nested file-viewer path.
  const browseBasePath = useMemo(() => resolveKbBasePath(location.pathname), [location.pathname]);

  const onNavigate = useCallback(
    (folderId: string | null): void => {
      if (!collectionId) return;
      const sp = new URLSearchParams();
      sp.set('cl', collectionId);
      if (folderId) sp.set('parent', folderId);
      void navigate(`${browseBasePath}?${sp.toString()}`);
    },
    [collectionId, navigate, browseBasePath],
  );

  // KB root (no collection open yet) — same navigation shape as `onNavigate`
  // above but targets a collection id instead of a folder within one.
  const onNavigateCollection = useCallback(
    (id: string): void => {
      const sp = new URLSearchParams();
      sp.set('cl', id);
      void navigate(`${browseBasePath}?${sp.toString()}`);
    },
    [navigate, browseBasePath],
  );

  // `folderId` is the file's *actual* parent folder (or null for a root
  // file), passed by the caller — not necessarily `currentFolderId`. With
  // every folder's files preloaded (`filesByFolder` above), you can open a
  // file from a folder you're not currently browsing; using the active
  // folder here would point the URL — and so `nodes[fileId]` resolution in
  // FileViewerPanel — at the wrong folder and show "No file selected".
  const onOpenFile = useCallback(
    (fileId: string, folderId: string | null): void => {
      if (!collectionId) return;
      const owning = globalCollections.byId(collectionId);
      const projectId = owning?.projectId;
      const channelId = owning?.scopeId;
      if (projectId && channelId) {
        void navigate(
          `${browseBasePath}/${projectId}/${channelId}/${collectionId}/${folderId ?? '_'}/${fileId}`,
        );
      } else {
        toast.error('Could not resolve collection scope');
      }
    },
    [collectionId, globalCollections, navigate, browseBasePath],
  );

  // Root mode: no collection is open, so the panel lists every top-level
  // collection flat instead of one collection's folder tree — kept present
  // here (rather than only showing `children` unwrapped) so the KB root
  // screen doesn't feel inconsistent with every other screen this shell
  // wraps, which always has the Contents panel on the left.
  const rootCollections = useMemo(
    () => globalCollections.collections.map(c => ({ id: c.id, name: c.name })),
    [globalCollections.collections],
  );

  return (
    <div className='relative h-full w-full'>
      <ResizableGroup
        orientation='horizontal'
        className='flex h-full min-h-0'
        autoSaveId='kb-contents-resize'
      >
        <Panel
          id='kb-contents-panel'
          panelRef={contentsPanelRef}
          defaultSize={KB_CONTENTS_DEFAULT_WIDTH}
          minSize={KB_CONTENTS_MIN_WIDTH}
          maxSize={KB_CONTENTS_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
          collapsible
          collapsedSize={KB_CONTENTS_COLLAPSED_WIDTH}
        >
          {activeCollection ? (
            <KbContentsPanel
              collectionName={collectionName}
              collectionId={collectionId ?? ''}
              activeFolderId={currentFolderId}
              activeFileId={currentFileId}
              nodes={nodes}
              rootChildrenIds={rootChildrenIds}
              filesByFolder={filesByFolder}
              activePath={activePath}
              collapsed={isContentsCollapsed}
              onNavigate={onNavigate}
              onOpenFile={onOpenFile}
              onToggleCollapsed={() => setIsContentsCollapsed(c => !c)}
            />
          ) : (
            <KbContentsPanel
              collectionName=''
              collectionId=''
              activeFolderId={null}
              activeFileId={null}
              nodes={{}}
              rootChildrenIds={[]}
              filesByFolder={new Map()}
              activePath={new Set()}
              collapsed={isContentsCollapsed}
              onNavigate={() => {}}
              onOpenFile={() => {}}
              onToggleCollapsed={() => setIsContentsCollapsed(c => !c)}
              rootCollections={rootCollections}
              onNavigateCollection={onNavigateCollection}
            />
          )}
        </Panel>
        <Separator
          className={cn(
            'group flex w-[2px] cursor-col-resize items-center justify-center transition-colors',
            isContentsCollapsed && 'hidden',
          )}
        >
          <div className='h-full w-px bg-sidebar-border-muted group-hover:bg-primary group-active:bg-primary' />
        </Separator>
        <Panel id='kb-main-panel' minSize='50%'>
          {children}
        </Panel>
      </ResizableGroup>
    </div>
  );
};

export const KbContentsShell: React.FC<KbContentsShellProps> = ({ children }) => {
  return (
    <GlobalCollectionsProvider>
      <CollectionTreeDataSync>
        <KbContentsShellInner>{children}</KbContentsShellInner>
      </CollectionTreeDataSync>
    </GlobalCollectionsProvider>
  );
};

export default KbContentsShell;
