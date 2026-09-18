import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  FolderGit2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { type TabItem } from '../../ui/Tabs';
import { cn } from '../../../utils/classNames';
import { downloadFile } from '../../../services/clients/fileFetchService';
import { useCitationDocs } from '../citationDocs';
import CitationDocsPanel from '../CitationDocsPanel';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import { useConversationArtifacts } from './useConversationArtifacts';
import { ArtifactList } from './ArtifactList';
import { ArtifactInlineView, artifactInlineActions } from './ArtifactInlineView';
import { AiBrowserItemView } from './AiBrowserItemView';
import { AiDocItemView } from './AiDocItemView';
import { useReviewGuide } from './useReviewGuide';
import { registerArtifactCommentStore } from './artifactCommentStore';
import { ViewerActionsProvider, useViewerActions } from './viewerActions';
import {
  WorkspaceSurface,
  QuickSwitch,
  publishOpenItems,
  type WorkspaceItemKind,
  itemFromArtifact,
  openTab,
  closeTab,
  pruneTabs,
  EMPTY_TABS,
  type TabState,
} from '../../workspaceItems';
import { artifactKindIcon } from './artifactKinds';
import { isLocalDiffArtifact } from './LocalDiffView';
import { attachedLocalFolder } from './localFolderContext';
import { useDesignStudio } from './design/designStudioContext';
import { htmlFromMessage } from './design/designDocument';

export type WorkspaceTabId = 'artifacts' | 'sources' | 'preview' | 'files';

function ViewerActionSlot(): ReactElement | null {
  const node = useViewerActions();
  return node ? <>{node}</> : null;
}

const SOURCE_ARTIFACT_KINDS = new Set(['PAGE', 'LINK', 'UPLOAD']);

const SHARED_ITEM_KINDS = new Set<WorkspaceItemKind>(['file', 'spec', 'html-doc', 'preview']);

const TABS: readonly TabItem[] = [
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'sources', label: 'Sources' },
  { id: 'files', label: 'Files' },
  { id: 'preview', label: 'Preview' },
];

export interface WorkspaceOpenRequest {
  seq: number;
  tab: WorkspaceTabId;
  openAppId?: string | null;
  openArtifactId?: string | null;
}

export interface WorkspaceAppMode {
  active: boolean;
  hasApp: boolean;
  appId: string | null;
  open: () => void;
  exit: () => void;
}

interface WorkspacePaneProps {
  conversationId: string | null;
  appPane: ReactNode;
  openRequest: WorkspaceOpenRequest;
  appMode?: WorkspaceAppMode | undefined;
  onCollapse?: (() => void) | undefined;
  onShownAppChange?: ((appId: string | null) => void) | undefined;
}

const LAST_OPEN_KEY = 'xyne-workspace-last-open';

function readLastOpen(conversationId: string | null): string | null {
  if (!conversationId) return null;
  try {
    return window.localStorage.getItem(`${LAST_OPEN_KEY}:${conversationId}`);
  } catch {
    return null;
  }
}

function writeLastOpen(conversationId: string | null, id: string | null): void {
  if (!conversationId) return;
  const key = `${LAST_OPEN_KEY}:${conversationId}`;
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch {
    /* a private window refuses storage; the pane just opens on the list */
  }
}

const TRANSIENT_APP_ARTIFACT_ID = '__workspace-transient-app__';
const TRANSIENT_DESIGN_ARTIFACT_ID = '__workspace-transient-design__';

function transientDesignArtifact(conversationId: string | null): ConversationArtifact {
  const now = new Date().toISOString();
  return {
    id: TRANSIENT_DESIGN_ARTIFACT_ID,
    conversationId: conversationId ?? '',
    kind: 'DESIGN_HTML',
    refService: 'CLAW',
    refId: '',
    title: 'Design',
    status: 'ACTIVE',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    openRef: { kind: 'DESIGN_HTML', service: 'CLAW', refId: '' },
  };
}

function transientAppArtifact(conversationId: string | null, appId: string): ConversationArtifact {
  const now = new Date().toISOString();
  return {
    id: TRANSIENT_APP_ARTIFACT_ID,
    conversationId: conversationId ?? '',
    kind: 'REACT_APP',
    refService: 'CLAW',
    refId: appId,
    title: 'App',
    status: 'ACTIVE',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    openRef: { kind: 'REACT_APP', service: 'CLAW', refId: appId },
  };
}

export function WorkspacePane(props: WorkspacePaneProps): ReactElement {
  return (
    <ViewerActionsProvider>
      <WorkspacePaneInner {...props} />
    </ViewerActionsProvider>
  );
}

function WorkspacePaneInner({
  conversationId,
  appPane,
  openRequest,
  appMode,
  onCollapse,
  onShownAppChange,
}: WorkspacePaneProps): ReactElement {
  registerArtifactCommentStore();
  const [tab, setTab] = useState<WorkspaceTabId>('artifacts');
  const [tabs, setTabs] = useState<TabState>(EMPTY_TABS);
  const selectedId = tabs.activeId;
  const setSelectedId = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      setTabs(current => {
        const wanted = typeof next === 'function' ? next(current.activeId) : next;
        if (wanted === null) return { openIds: current.openIds, activeId: null };
        return openTab(current, wanted);
      });
    },
    [],
  );
  const closeWorkspaceTab = useCallback((id: string) => {
    setTabs(current => closeTab(current, id));
  }, []);
  const [transientAppId, setTransientAppId] = useState<string | null>(null);
  const { artifacts, isLoading, isError, patch } = useConversationArtifacts(conversationId);
  const citations = useCitationDocs();
  const citationActiveId = citations?.activeId ?? null;
  const studio = useDesignStudio();
  const hasDeliveredDesign = useMemo(
    () => artifacts.some(a => a.kind === 'DESIGN_HTML'),
    [artifacts],
  );
  const designDraftActive = useMemo(() => {
    if (hasDeliveredDesign) return false;
    const last = [...(studio?.messages ?? [])].reverse().find(m => m.type === 'bot');
    return !!last && htmlFromMessage(last) !== null;
  }, [studio?.messages, hasDeliveredDesign]);

  const localFolder = useMemo(
    () => attachedLocalFolder(studio?.messages ?? []),
    [studio?.messages],
  );

  const seenArtifactIds = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setTransientAppId(null);
    seenArtifactIds.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (isLoading) return;
    const stamps = new Map(artifacts.map(a => [a.id, a.updatedAt] as const));
    const seen = seenArtifactIds.current;
    seenArtifactIds.current = stamps;
    const recent = Date.now() - 2 * 60 * 1000;
    const isNew = (a: ConversationArtifact): boolean =>
      seen === null ? new Date(a.updatedAt).getTime() > recent : seen.get(a.id) !== a.updatedAt;
    const design = artifacts.find(a => a.kind === 'DESIGN_HTML' && isNew(a));
    if (design) {
      setTab('artifacts');
      setTransientAppId(null);
      setSelectedId(design.id);
      return;
    }
    const localDiff = artifacts.find(a => isLocalDiffArtifact(a) && isNew(a));
    if (localDiff) {
      setTab('preview');
      setTransientAppId(null);
      setSelectedId(null);
      return;
    }
    const page = artifacts.find(a => a.kind === 'PAGE' && isNew(a));
    if (page && designDraftActive) {
      setTab('artifacts');
      setTransientAppId(null);
      setSelectedId(page.id);
      return;
    }
    if (!page) return;
    setTab('sources');
    setTransientAppId(null);
    setSelectedId(page.id);
  }, [artifacts, isLoading]);

  useEffect(() => {
    if (!designDraftActive) return;
    setTab('artifacts');
    setTransientAppId(null);
    setSelectedId(current =>
      current === null || current === TRANSIENT_DESIGN_ARTIFACT_ID
        ? TRANSIENT_DESIGN_ARTIFACT_ID
        : current,
    );
  }, [designDraftActive]);

  useEffect(() => {
    if (!citationActiveId) return;
    setTab('sources');
  }, [citationActiveId]);

  const { seq, tab: requestedTab, openAppId, openArtifactId } = openRequest;
  useEffect(() => {
    if (seq === 0) return;
    setTab(requestedTab);
    if (openAppId) return;
    setTransientAppId(null);
    setSelectedId(openArtifactId ?? null);
  }, [seq, requestedTab, openAppId, openArtifactId]);

  useEffect(() => {
    if (seq === 0 || !openAppId) return;
    const row = artifacts.find(a => a.kind === 'REACT_APP' && a.openRef.refId === openAppId);
    if (row) {
      setSelectedId(row.id);
      setTransientAppId(null);
      return;
    }
    setSelectedId(TRANSIENT_APP_ARTIFACT_ID);
    setTransientAppId(openAppId);
  }, [seq, openAppId, artifacts]);

  const transientArtifact = useMemo(
    () => (transientAppId ? transientAppArtifact(conversationId, transientAppId) : null),
    [conversationId, transientAppId],
  );

  const designDraftArtifact = useMemo(
    () => (designDraftActive ? transientDesignArtifact(conversationId) : null),
    [conversationId, designDraftActive],
  );

  const selected = useMemo(() => {
    if (selectedId === TRANSIENT_APP_ARTIFACT_ID) return transientArtifact;
    if (selectedId === TRANSIENT_DESIGN_ARTIFACT_ID) return designDraftArtifact;
    return artifacts.find(a => a.id === selectedId) ?? null;
  }, [artifacts, selectedId, transientArtifact, designDraftArtifact]);

  const fileArtifacts = useMemo(() => artifacts.filter(a => a.kind === 'FILE'), [artifacts]);
  const pageArtifacts = useMemo(() => artifacts.filter(a => a.kind === 'PAGE'), [artifacts]);
  const listedArtifacts = useMemo(() => {
    const hasDesign = artifacts.some(a => a.kind === 'DESIGN_HTML');
    const designFileIds = new Set(
      artifacts
        .filter(a => a.kind === 'DESIGN_HTML' && a.latestVersionRef)
        .map(a => a.latestVersionRef as string),
    );
    const isDesignHtmlFile = (a: ConversationArtifact): boolean =>
      a.kind === 'FILE' && (designFileIds.has(a.refId) || (hasDesign && /\.html?$/i.test(a.title)));
    return artifacts.filter(a => a.kind !== 'PAGE' && !isDesignHtmlFile(a));
  }, [artifacts]);
  const reviewGuide = useReviewGuide(artifacts);

  const previewArtifact = useMemo(() => {
    const candidates = artifacts.filter(a => a.kind === 'PREVIEW' || a.kind === 'DIFF');
    if (candidates.length === 0) return null;
    return (
      [...candidates].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0] ?? null
    );
  }, [artifacts]);

  const openArtifact = useCallback((artifact: ConversationArtifact): void => {
    setSelectedId(artifact.id);
  }, []);

  const openArtifactRows = useMemo(() => {
    const rows = new Map<string, ConversationArtifact>();
    for (const row of artifacts) rows.set(row.id, row);
    if (transientArtifact) rows.set(transientArtifact.id, transientArtifact);
    if (designDraftArtifact) rows.set(designDraftArtifact.id, designDraftArtifact);
    return rows;
  }, [artifacts, transientArtifact, designDraftArtifact]);

  const surfaceItems = useMemo(
    () => [...openArtifactRows.values()].map(itemFromArtifact),
    [openArtifactRows],
  );

  useEffect(() => {
    setTabs(current => pruneTabs(current, [...openArtifactRows.keys()]));
  }, [openArtifactRows]);

  const restored = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || restored.current === conversationId) return;
    if (isLoading || artifacts.length === 0) return;
    restored.current = conversationId;
    if (selectedId) return;
    const last = readLastOpen(conversationId);
    if (!last) return;
    const row = artifacts.find(artifact => artifact.id === last);
    if (!row) return;
    setTab(SOURCE_ARTIFACT_KINDS.has(row.kind) ? 'sources' : 'artifacts');
    setSelectedId(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isLoading, artifacts, setSelectedId]);

  useEffect(() => {
    if (!conversationId) return;
    if (selectedId === TRANSIENT_APP_ARTIFACT_ID || selectedId === TRANSIENT_DESIGN_ARTIFACT_ID) {
      return;
    }
    writeLastOpen(conversationId, selectedId);
  }, [conversationId, selectedId]);

  const showDetail = (tab === 'artifacts' || tab === 'sources') && selected !== null;

  const quickSwitchSections = useMemo(
    () =>
      TABS.map(item => ({
        id: item.id,
        label: item.label,
        active: item.id === tab,
        onSelect: () => {
          setSelectedId(null);
          setTransientAppId(null);
          setTab(item.id as WorkspaceTabId);
        },
      })),
    [tab, setSelectedId],
  );

  // The same report the hub's folder page publishes: what is open here, so a
  // question about "this page" is answered from the tabs.
  useEffect(() => {
    publishOpenItems({
      items: tabs.openIds.flatMap(id => {
        const row = openArtifactRows.get(id);
        if (!row) return [];
        return [
          {
            title: row.title,
            kind: row.kind,
            ...(row.openRef.url || row.url ? { url: row.openRef.url ?? row.url ?? '' } : {}),
            ...(id === tabs.activeId ? { active: true } : {}),
          },
        ];
      }),
    });
    return () => publishOpenItems(null);
  }, [tabs, openArtifactRows]);

  const shownAppId = showDetail && selected.kind === 'REACT_APP' ? selected.openRef.refId : null;

  useEffect(() => {
    onShownAppChange?.(shownAppId);
  }, [shownAppId, onShownAppChange]);

  useEffect(() => {
    return () => onShownAppChange?.(null);
  }, [onShownAppChange]);

  const openApp = useCallback((): void => {
    const appId = appMode?.appId;
    if (!appMode || !appId) return;
    appMode.open();
    setTab('artifacts');
    const row = artifacts.find(a => a.kind === 'REACT_APP' && a.openRef.refId === appId);
    if (row) {
      setSelectedId(row.id);
      setTransientAppId(null);
      return;
    }
    setSelectedId(TRANSIENT_APP_ARTIFACT_ID);
    setTransientAppId(appId);
  }, [appMode, artifacts]);

  const [maximized, setMaximized] = useState(false);
  const onToggleMaximize = useCallback(() => setMaximized(value => !value), []);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMaximized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);

  const goBack = useCallback((): void => {
    setSelectedId(null);
    setTransientAppId(null);
  }, [setSelectedId]);

  const showOpenApp =
    tab === 'artifacts' && !showDetail && Boolean(appMode?.hasApp) && !appMode?.active;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col border-l border-border bg-background',
        maximized ? 'fixed inset-0 z-50 h-screen w-screen border-l-0' : 'h-full w-full',
      )}
    >
      <div className='flex h-11 flex-shrink-0 items-center gap-2 border-b border-border px-2'>
        {showDetail ? (
          <>
            <button
              type='button'
              onClick={goBack}
              aria-label='Back'
              title='Back'
              className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              data-track-category='AskAI'
              data-track-name='workspace-artifact-back'
            >
              <ArrowLeft className='h-4 w-4' />
            </button>
            <span className='flex min-w-0 flex-1 items-center gap-1.5'>
              {artifactKindIcon(selected.kind, 'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground')}
              <span className='truncate text-sm font-medium text-foreground' title={selected.title}>
                {selected.title}
              </span>
            </span>
            {artifactInlineActions(selected)}
          </>
        ) : (
          <>
            <QuickSwitch
              items={surfaceItems}
              tabs={tabs}
              onOpen={id => setSelectedId(id)}
              sections={quickSwitchSections}
              icon={item => artifactKindIcon((item.row as ConversationArtifact).kind, 'h-3 w-3')}
            />
            <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
              {TABS.find(item => item.id === tab)?.label ?? ''}
            </span>
          </>
        )}
        {showOpenApp && (
          <button
            type='button'
            onClick={openApp}
            title='Reopen the app panel'
            className='flex h-7 flex-shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='AskAI'
            data-track-name='ArtifactAppPaneReopen'
          >
            <PanelRightOpen className='h-3.5 w-3.5' aria-hidden='true' />
            Open app
          </button>
        )}
        {
          <button
            type='button'
            onClick={onToggleMaximize}
            aria-label={maximized ? 'Restore workspace width' : 'Maximise workspace'}
            title={maximized ? 'Restore workspace width' : 'Maximise workspace'}
            className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            data-track-category='AskAI'
            data-track-name='workspace-maximize'
          >
            {maximized ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
          </button>
        }
        {onCollapse && !maximized && (
          <button
            type='button'
            onClick={onCollapse}
            aria-label='Collapse workspace'
            title='Collapse workspace'
            className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            data-track-category='AskAI'
            data-track-name='workspace-collapse'
          >
            <PanelRightClose className='h-4 w-4' />
          </button>
        )}
      </div>

      <div className='relative min-h-0 w-full min-w-0 flex-1 overflow-hidden'>
        {showDetail ? (
          <WorkspaceSurface
            items={surfaceItems}
            tabs={tabs}
            onActivate={id => setSelectedId(id)}
            onOpen={id => setSelectedId(id)}
            sections={quickSwitchSections}
            onClose={closeWorkspaceTab}
            icon={item => artifactKindIcon((item.row as ConversationArtifact).kind, 'h-3 w-3')}
            actionsFor={item => (
              <>
                <ViewerActionSlot />
                {artifactInlineActions(item.row as ConversationArtifact)}
              </>
            )}
            renderItem={item => {
              if (item.kind === 'html-doc') return <AiDocItemView item={item} />;
              if (SHARED_ITEM_KINDS.has(item.kind)) return null;
              if (item.kind === 'link' || item.kind === 'page') {
                return <AiBrowserItemView item={item} />;
              }
              return (
                <ArtifactInlineView
                  artifact={item.row as ConversationArtifact}
                  appPane={appPane}
                  reviewGuide={reviewGuide}
                />
              );
            }}
          />
        ) : tab === 'artifacts' ? (
          <ArtifactList
            artifacts={listedArtifacts}
            isLoading={isLoading}
            isError={isError}
            emptyTitle='No artifacts yet'
            emptyBody='Canvases, apps, files and links the agent creates in this conversation will appear here.'
            onOpen={openArtifact}
            onPatch={patch}
          />
        ) : tab === 'sources' ? (
          citations && citations.docs.length > 0 ? (
            <CitationDocsPanel embedded />
          ) : (
            <ArtifactList
              artifacts={pageArtifacts}
              isLoading={isLoading}
              isError={isError}
              emptyTitle='No sources open'
              emptyBody='Pages the agent opens and citations you click in the chat show up here.'
              onOpen={openArtifact}
              onPatch={patch}
            />
          )
        ) : tab === 'preview' ? (
          previewArtifact ? (
            <ArtifactInlineView
              artifact={previewArtifact}
              appPane={appPane}
              reviewGuide={reviewGuide}
            />
          ) : (
            <div className='flex h-full flex-col items-center justify-center gap-1 px-8 text-center'>
              <p className='text-sm font-medium text-foreground'>Nothing to preview</p>
              <p className='text-xs text-muted-foreground'>
                Live previews and code diffs from this conversation show up here.
              </p>
            </div>
          )
        ) : (
          <div className='flex h-full min-h-0 flex-col'>
            {localFolder && (
              <div className='flex-shrink-0 border-b border-border px-3 py-2'>
                <div className='flex items-center gap-1.5'>
                  <FolderGit2
                    className='h-3.5 w-3.5 flex-shrink-0 text-muted-foreground'
                    aria-hidden='true'
                  />
                  <span className='truncate text-xs font-medium text-foreground'>
                    Working in {localFolder.name}
                    {localFolder.branch ? ` · ${localFolder.branch}` : ''}
                  </span>
                </div>
                <p
                  className='mt-0.5 truncate font-mono text-[11px] text-muted-foreground'
                  title={localFolder.path}
                >
                  {localFolder.path}
                </p>
              </div>
            )}
            <div className='min-h-0 flex-1'>
              <ArtifactList
                artifacts={fileArtifacts}
                isLoading={isLoading}
                isError={isError}
                emptyTitle='No files yet'
                emptyBody='Files the agent delivers in this conversation will appear here.'
                onOpen={(artifact): void => {
                  void downloadFile(
                    `/xyne-ai/v2/attachments/${encodeURIComponent(artifact.openRef.refId)}/download`,
                    artifact.title,
                  );
                }}
                onPatch={patch}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
