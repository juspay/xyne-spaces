import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Search,
  AlertTriangle,
  Bug,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { cn } from '../../utils/classNames';

export interface SdlcWikiPage {
  canvasId: string;
  title: string;
  path: string;
  folderPath: string;
  syncedAt: string;
  updatedAt: string;
}

export interface SdlcWikiRun {
  executionId: string;
  runMode: 'INITIAL' | 'REFRESH';
  phase: string;
  total: number;
  processed: number;
  updated: number;
  noop: number;
  failed: number;
  aggregated?: number;
  windows?: {
    total: number;
    completed: number;
    updated: number;
    noop: number;
    failed: number;
    intermediate: number;
  };
  currentWindowBeforeSha?: string | null;
  currentWindowAfterSha?: string | null;
  activeCheckpointSha?: string | null;
  cursorSha: string | null;
  targetHeadSha: string | null;
  error: string | null;
  recovery?: {
    attempts: number;
    noProgressAttempts: number;
    lastCause: string;
    lastCauseAt: string;
  };
  chunkSize: 1 | 10 | 25 | 50 | 100;
  quality: 'QUICK' | 'STANDARD';
  baseBranch: string;
  currentCommitSha: string | null;
  currentChunkPosition: number | null;
  currentChunkSize: number | null;
  conversationId: string | null;
  sessionId: string | null;
  updatedAt: string;
  knowledge: {
    executionId: string;
    phase: string;
    completedCount: number;
    totalCount: number;
    error: string | null;
  } | null;
}

export interface SdlcWikiStartInput {
  historyRange:
    | { kind: 'LAST_PERCENT'; percent: 20 | 50 }
    | { kind: 'FULL' }
    | { kind: 'CUSTOM_SHA'; sha: string };
  chunkSize: 1 | 10 | 25 | 50 | 100;
  quality: 'QUICK' | 'STANDARD';
}

const ACTIVE_WIKI_PHASES = new Set([
  'QUEUED',
  'PREPARING',
  'BOOTSTRAPPING',
  'PROCESSING',
  'VALIDATING',
  'CORRECTING',
]);

function WikiRunControls(props: {
  run: SdlcWikiRun | null;
  isAdmin: boolean;
  actionPending: boolean;
  onGenerate: (input: SdlcWikiStartInput) => Promise<void>;
  onRefresh: (input: Pick<SdlcWikiStartInput, 'chunkSize' | 'quality'>) => Promise<void>;
  onRetry: () => Promise<void>;
  onRetryKnowledge: () => Promise<void>;
  onCancel: () => Promise<void>;
  onDebug: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<'20' | '50' | 'FULL' | 'CUSTOM'>('FULL');
  const [customSha, setCustomSha] = useState('');
  const [chunkSize, setChunkSize] = useState<1 | 10 | 25 | 50 | 100>(1);
  const [quality, setQuality] = useState<'QUICK' | 'STANDARD'>('STANDARD');
  const active = props.run ? ACTIVE_WIKI_PHASES.has(props.run.phase) : false;
  const resumable = props.run?.phase === 'PARTIALLY_FAILED' || props.run?.phase === 'CANCELLED';
  const canRefresh = props.run?.phase === 'COMPLETED' && Boolean(props.run.cursorSha);
  const progress = props.run?.total
    ? Math.min(100, Math.round((props.run.processed / props.run.total) * 100))
    : 0;
  const historyLabel =
    history === '20'
      ? 'Latest 20%'
      : history === '50'
        ? 'Latest 50%'
        : history === 'FULL'
          ? 'Full history'
          : customSha.trim() || 'Custom SHA';
  const start = async (): Promise<void> => {
    const historyRange: SdlcWikiStartInput['historyRange'] =
      history === '20'
        ? { kind: 'LAST_PERCENT', percent: 20 }
        : history === '50'
          ? { kind: 'LAST_PERCENT', percent: 50 }
          : history === 'FULL'
            ? { kind: 'FULL' }
            : { kind: 'CUSTOM_SHA', sha: customSha.trim() };
    await props.onGenerate({ historyRange, chunkSize, quality });
    setOpen(false);
  };

  return (
    <div className='mt-6 overflow-hidden rounded-xl border bg-background shadow-sm'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <div className='grid size-8 shrink-0 place-items-center rounded-lg border bg-background'>
            <GitCommitHorizontal size={16} />
          </div>
          <div className='min-w-0'>
            <p className='text-sm font-medium'>Commit history pipeline</p>
            <p className='truncate font-mono text-[11px] text-muted-foreground'>
              {props.run
                ? `${props.run.phase.toLowerCase().replaceAll('_', ' ')} · ${props.run.quality.toLowerCase()} · ${props.run.processed}/${props.run.total || '?'} commits`
                : 'Not generated yet'}
            </p>
          </div>
        </div>
        {props.isAdmin ? (
          <div className='flex items-center gap-2'>
            {props.run?.conversationId ? (
              <button
                type='button'
                onClick={props.onDebug}
                title='Debug Wiki run'
                aria-label='Debug Wiki run'
                data-track-category='SdlcWiki'
                data-track-name='DebuggerOpened'
                className='inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground'
              >
                <Bug size={14} />
              </button>
            ) : null}
            {resumable ? (
              <button
                type='button'
                disabled={props.actionPending}
                onClick={() => void props.onRetry()}
                data-track-category='SdlcWiki'
                data-track-name='RetryClicked'
                className='inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50'
              >
                <RefreshCw size={13} /> Resume
              </button>
            ) : null}
            {active ? (
              <button
                type='button'
                disabled={props.actionPending}
                onClick={() => void props.onCancel()}
                data-track-category='SdlcWiki'
                data-track-name='CancelClicked'
                className='h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50'
              >
                Cancel
              </button>
            ) : (
              <button
                type='button'
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
                data-track-category='SdlcWiki'
                data-track-name={canRefresh ? 'RefreshPanelOpened' : 'GeneratePanelOpened'}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium',
                  open
                    ? 'border bg-background text-foreground hover:bg-muted'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <Settings2 size={13} />
                {open ? 'Hide settings' : canRefresh ? 'Refresh Wiki' : 'Generate Wiki'}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {active ? (
        <div className='px-4 py-3'>
          <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
            <div
              className='h-full rounded-full bg-primary transition-[width]'
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className='mt-2 flex justify-between text-[11px] text-muted-foreground'>
            <span>
              {props.run?.updated ?? 0} updated · {props.run?.noop ?? 0} no-op
              {props.run?.aggregated ? ` · ${props.run.aggregated} aggregated` : ''}
            </span>
            <span className='inline-flex items-center gap-1'>
              <Loader2 size={11} className='animate-spin' /> {progress}%
            </span>
          </div>
          <p className='mt-2 truncate font-mono text-[10px] text-muted-foreground'>
            {props.run?.baseBranch} @{' '}
            {props.run?.activeCheckpointSha ??
              props.run?.currentWindowAfterSha ??
              props.run?.currentCommitSha ??
              props.run?.targetHeadSha ??
              'discovering head'}
            {props.run?.windows
              ? ` · window ${Math.min(props.run.windows.completed + 1, props.run.windows.total)}/${props.run.windows.total}`
              : props.run?.currentChunkPosition && props.run.currentChunkSize
                ? ` · legacy chunk ${props.run.currentChunkPosition}/${props.run.currentChunkSize}`
                : ''}
          </p>
          {props.run?.recovery ? (
            <p className='mt-1 text-[10px] text-amber-600 dark:text-amber-300'>
              Recovery {props.run.recovery.attempts} · {props.run.recovery.lastCause}
            </p>
          ) : null}
        </div>
      ) : null}

      {props.run?.error ? (
        <p className='border-t px-4 py-3 text-xs text-destructive'>{props.run.error}</p>
      ) : null}

      {props.run && !active && !props.run.error ? (
        <p className='border-t px-4 py-2 text-[10px] text-muted-foreground'>
          Last durable update {new Date(props.run.updatedAt).toLocaleString()}
        </p>
      ) : null}

      {props.run?.knowledge ? (
        <div
          className={cn(
            'flex items-center justify-between gap-3 border-t px-4 py-2 text-xs',
            props.run.knowledge.error ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          <span>
            Repo Knowledge: {props.run.knowledge.phase.toLowerCase().replaceAll('_', ' ')} ·{' '}
            {props.run.knowledge.completedCount}/{props.run.knowledge.totalCount}
            {props.run.knowledge.error ? ` · ${props.run.knowledge.error}` : ''}
          </span>
          {props.isAdmin && props.run.knowledge.error ? (
            <button
              type='button'
              disabled={props.actionPending}
              onClick={() => void props.onRetryKnowledge()}
              data-track-category='SdlcWiki'
              data-track-name='RepoKnowledgeRetryClicked'
              className='h-7 shrink-0 rounded-md border px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-50'
            >
              Retry knowledge
            </button>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className='space-y-5 border-t px-4 py-4'>
          {!canRefresh ? (
            <fieldset>
              <legend className='text-xs font-semibold'>History range</legend>
              <p className='mt-1 text-xs text-muted-foreground'>
                More history captures more architectural evolution and takes longer.
              </p>
              <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {(
                  [
                    ['20', 'Latest 20%'],
                    ['50', 'Latest 50%'],
                    ['FULL', 'Full history'],
                    ['CUSTOM', 'Custom SHA'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type='button'
                    onClick={() => setHistory(value)}
                    aria-pressed={history === value}
                    data-track-category='SdlcWiki'
                    data-track-name='HistoryRangeSelected'
                    data-track-metadata={JSON.stringify({ value })}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium',
                      history === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className='inline-flex items-center gap-1.5'>
                      {history === value ? <Check size={13} strokeWidth={2.5} /> : null}
                      {label}
                    </span>
                    {value === 'FULL' ? (
                      <span className='shrink-0 text-[10px] font-semibold text-primary'>
                        · Default
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {history === 'CUSTOM' ? (
                <input
                  value={customSha}
                  onChange={event => setCustomSha(event.target.value)}
                  data-track-category='SdlcWiki'
                  data-track-name='CustomShaChanged'
                  placeholder='40-character start commit SHA'
                  className='mt-2 h-9 w-full rounded-md border bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring'
                />
              ) : null}
            </fieldset>
          ) : null}

          <fieldset>
            <legend className='text-xs font-semibold'>Commits per Wiki update</legend>
            <p className='mt-1 text-xs text-muted-foreground'>
              1 preserves exact commit-by-commit history. Larger windows compare the state before
              and after several commits, reducing model runs but potentially compressing
              intermediate architectural context.
            </p>
            <div className='mt-2 flex flex-wrap gap-2'>
              {([1, 10, 25, 50, 100] as const).map(value => (
                <button
                  key={value}
                  type='button'
                  onClick={() => setChunkSize(value)}
                  aria-pressed={chunkSize === value}
                  data-track-category='SdlcWiki'
                  data-track-name='ChunkSizeSelected'
                  data-track-metadata={JSON.stringify({ value })}
                  className={cn(
                    'inline-flex min-w-12 items-center justify-center gap-1.5 rounded-md border px-3 py-2 font-mono text-xs',
                    chunkSize === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  <span className='inline-flex items-center gap-1.5'>
                    {chunkSize === value ? <Check size={12} strokeWidth={2.5} /> : null}
                    {value}
                  </span>
                  {value === 1 ? (
                    <span className='shrink-0 font-sans text-[10px] font-semibold text-primary'>
                      · Default
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className='text-xs font-semibold'>Review mode</legend>
            <p className='mt-1 text-xs text-muted-foreground'>
              Choose whether the generated Wiki gets an independent review pass.
            </p>
            <div className='mt-2 grid gap-2 sm:grid-cols-2'>
              {(
                [
                  ['QUICK', 'Quick', 'Generation only. Fastest; no independent review.'],
                  ['STANDARD', 'Standard', 'One read-only review and one correction pass.'],
                ] as const
              ).map(([value, label, note]) => (
                <button
                  key={value}
                  type='button'
                  onClick={() => setQuality(value)}
                  aria-pressed={quality === value}
                  data-track-category='SdlcWiki'
                  data-track-name='QualitySelected'
                  data-track-metadata={JSON.stringify({ value })}
                  className={cn(
                    'rounded-md border p-3 text-left',
                    quality === value ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <span className='flex items-center gap-2 text-xs font-semibold'>
                    <span
                      className={cn(
                        'grid size-4 place-items-center rounded-full border',
                        quality === value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {quality === value ? <Check size={10} strokeWidth={3} /> : null}
                    </span>
                    {label}
                    {value === 'STANDARD' ? (
                      <span className='ml-auto shrink-0 text-[10px] font-semibold text-primary'>
                        Default
                      </span>
                    ) : null}
                  </span>
                  <span className='mt-1 block text-[11px] leading-4 text-muted-foreground'>
                    {note}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/25 px-3 py-2.5'>
            <span className='text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
              Run configuration
            </span>
            <span className='font-mono text-[11px] text-foreground'>
              {canRefresh ? 'New commits' : historyLabel} · {chunkSize} commits/update ·{' '}
              {quality === 'STANDARD' ? 'Reviewed' : 'Generation only'}
            </span>
          </div>

          <div className='flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-foreground'>
            <AlertTriangle size={15} className='mt-0.5 shrink-0 text-amber-500' />
            <span>
              More history, smaller Wiki updates, and independent review increase runtime and model
              cost. Every window still saves its endpoint; meaningful intermediate checkpoints are
              optional. Wiki and Repo Knowledge can run independently. After Wiki completion, a
              reconciliation still updates only changed or missing Repo Knowledge documents.
            </span>
          </div>
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => setOpen(false)}
              data-track-category='SdlcWiki'
              data-track-name='RunPanelClosed'
              className='h-9 rounded-md border px-4 text-xs font-medium hover:bg-muted'
            >
              Close
            </button>
            <button
              type='button'
              disabled={
                props.actionPending ||
                (history === 'CUSTOM' && !/^[0-9a-f]{40}$/i.test(customSha.trim()))
              }
              onClick={() =>
                void (canRefresh
                  ? props.onRefresh({ chunkSize, quality }).then(() => setOpen(false))
                  : start())
              }
              data-track-category='SdlcWiki'
              data-track-name={canRefresh ? 'RefreshStarted' : 'GenerateStarted'}
              className='h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            >
              {canRefresh ? 'Refresh Wiki' : 'Generate Wiki'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface WikiTreeNode {
  name: string;
  path: string;
  folders: WikiTreeNode[];
  pages: SdlcWikiPage[];
  pageCount: number;
}

function createTreeNode(name: string, path: string): WikiTreeNode {
  return { name, path, folders: [], pages: [], pageCount: 0 };
}

export function buildWikiTree(pages: SdlcWikiPage[]): WikiTreeNode {
  const root = createTreeNode('Wiki', '');
  const nodeByPath = new Map<string, WikiTreeNode>([['', root]]);

  for (const page of [...pages].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = page.path.split('/').filter(Boolean);
    let parent = root;
    let currentPath = '';
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = nodeByPath.get(currentPath);
      if (!node) {
        node = createTreeNode(segment, currentPath);
        nodeByPath.set(currentPath, node);
        parent.folders.push(node);
      }
      parent = node;
    }
    parent.pages.push(page);
  }

  const sortNode = (node: WikiTreeNode): void => {
    node.folders.sort((left, right) => left.name.localeCompare(right.name));
    node.pages.sort((left, right) => left.title.localeCompare(right.title));
    node.folders.forEach(sortNode);
    node.pageCount =
      node.pages.length + node.folders.reduce((total, folder) => total + folder.pageCount, 0);
  };
  sortNode(root);
  return root;
}

function filterWikiPages(pages: SdlcWikiPage[], query: string): SdlcWikiPage[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return pages;
  return pages.filter(
    page =>
      page.title.toLocaleLowerCase().includes(normalized) ||
      page.path.toLocaleLowerCase().includes(normalized),
  );
}

function wikiParentPaths(path: string): string[] {
  const segments = path.split('/').filter(Boolean).slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function SidebarWikiPageRow(props: {
  page: SdlcWikiPage;
  depth: number;
  selected: boolean;
  trackingScope: 'Wiki' | 'RepoKnowledge';
  onOpen: (page: SdlcWikiPage) => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={() => props.onOpen(props.page)}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring',
        props.selected
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
      )}
      style={{ paddingLeft: `${10 + props.depth * 14}px` }}
      title={props.page.path}
      aria-current={props.selected ? 'page' : undefined}
      data-track-category='SdlcHub'
      data-track-name={`${props.trackingScope}SidebarCanvasOpened`}
      data-track-metadata={JSON.stringify({
        canvasId: props.page.canvasId,
        path: props.page.path,
      })}
    >
      <FileText
        size={14}
        className={cn(
          'shrink-0 text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground',
          props.selected && 'text-sidebar-accent-foreground',
        )}
      />
      <span className='truncate'>{props.page.title}</span>
    </button>
  );
}

function SidebarWikiFolderNode(props: {
  node: WikiTreeNode;
  depth: number;
  expanded: Set<string>;
  forceExpanded: boolean;
  selectedCanvasId: string | null;
  trackingScope: 'Wiki' | 'RepoKnowledge';
  onToggle: (path: string) => void;
  onOpen: (page: SdlcWikiPage) => void;
}): ReactElement {
  const open = props.forceExpanded || props.expanded.has(props.node.path);

  return (
    <div className='[content-visibility:auto]'>
      <button
        type='button'
        onClick={() => props.onToggle(props.node.path)}
        className='flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12px] font-semibold text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
        style={{ paddingLeft: `${8 + props.depth * 14}px` }}
        aria-expanded={open}
        title={props.node.path}
        data-track-category='SdlcHub'
        data-track-name={`${props.trackingScope}SidebarFolderToggled`}
        data-track-metadata={JSON.stringify({ path: props.node.path, open: !open })}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span className='truncate font-mono'>{props.node.name}</span>
        <span className='ml-auto font-mono text-[10px] font-normal tabular-nums text-sidebar-foreground/45'>
          {props.node.pageCount}
        </span>
      </button>
      {open ? (
        <div>
          {props.node.folders.map(folder => (
            <SidebarWikiFolderNode
              key={folder.path}
              node={folder}
              depth={props.depth + 1}
              expanded={props.expanded}
              forceExpanded={props.forceExpanded}
              selectedCanvasId={props.selectedCanvasId}
              trackingScope={props.trackingScope}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
          ))}
          {props.node.pages.map(page => (
            <SidebarWikiPageRow
              key={page.canvasId}
              page={page}
              depth={props.depth + 1}
              selected={page.canvasId === props.selectedCanvasId}
              trackingScope={props.trackingScope}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SdlcWikiSidebarTree(props: {
  pages: SdlcWikiPage[];
  loading: boolean;
  error: boolean;
  selectedCanvasId: string | null;
  variant?: 'wiki' | 'repo-knowledge';
  onRetry: () => void;
  onOpen: (page: SdlcWikiPage) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visiblePages = useMemo(() => filterWikiPages(props.pages, query), [props.pages, query]);
  const tree = useMemo(() => buildWikiTree(visiblePages), [visiblePages]);
  const repoKnowledge = props.variant === 'repo-knowledge';
  const trackingScope = repoKnowledge ? 'RepoKnowledge' : 'Wiki';

  useEffect(() => {
    const selectedPage = props.pages.find(page => page.canvasId === props.selectedCanvasId);
    if (!selectedPage) return;
    setExpanded(current => {
      const next = new Set(current);
      wikiParentPaths(selectedPage.path).forEach(path => next.add(path));
      return next;
    });
  }, [props.pages, props.selectedCanvasId]);

  const toggle = (path: string): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <section
      className='flex h-full min-h-0 flex-col'
      aria-label={repoKnowledge ? 'Repo Knowledge documents' : 'Wiki files'}
    >
      <div className='shrink-0 px-3 pb-2 pt-3'>
        <div className='flex items-center justify-between gap-2 px-1'>
          <span className='text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70'>
            {repoKnowledge ? 'Repo Knowledge' : 'Files'}
          </span>
          <span className='font-mono text-[11px] tabular-nums text-sidebar-foreground/60'>
            {props.pages.length}
          </span>
        </div>
        <div className='relative mt-2'>
          <Search
            size={14}
            className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground/55'
          />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={repoKnowledge ? 'Filter documents' : 'Filter files'}
            aria-label={repoKnowledge ? 'Filter Repo Knowledge documents' : 'Filter Wiki files'}
            className='h-9 w-full rounded-md border border-sidebar-border-muted bg-background/80 pl-9 pr-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-sidebar-accent-ring dark:bg-sidebar-accent/30 dark:text-sidebar-accent-foreground dark:placeholder:text-sidebar-foreground/55'
            data-track-category='SdlcHub'
            data-track-name={`${trackingScope}SidebarSearched`}
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
        {props.loading ? (
          <div className='px-2 py-3 text-xs text-sidebar-foreground/55'>Loading files…</div>
        ) : props.error ? (
          <button
            type='button'
            onClick={props.onRetry}
            className='w-full rounded-md px-2 py-3 text-left text-xs text-sidebar-foreground/65 hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
            data-track-category='SdlcHub'
            data-track-name={`${trackingScope}SidebarReloaded`}
          >
            Files unavailable. Try again
          </button>
        ) : visiblePages.length === 0 ? (
          <div className='px-2 py-3 text-xs text-sidebar-foreground/55'>
            {props.pages.length === 0
              ? repoKnowledge
                ? 'No Repo Knowledge yet'
                : 'No files imported'
              : repoKnowledge
                ? 'No matching documents'
                : 'No matching files'}
          </div>
        ) : (
          <>
            {tree.folders.map(folder => (
              <SidebarWikiFolderNode
                key={folder.path}
                node={folder}
                depth={0}
                expanded={expanded}
                forceExpanded={Boolean(query.trim())}
                selectedCanvasId={props.selectedCanvasId}
                trackingScope={trackingScope}
                onToggle={toggle}
                onOpen={props.onOpen}
              />
            ))}
            {tree.pages.map(page => (
              <SidebarWikiPageRow
                key={page.canvasId}
                page={page}
                depth={0}
                selected={page.canvasId === props.selectedCanvasId}
                trackingScope={trackingScope}
                onOpen={props.onOpen}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function WikiFolderNode(props: {
  node: WikiTreeNode;
  depth: number;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onOpen: (page: SdlcWikiPage) => void;
}): ReactElement {
  const open = props.forceExpanded || props.expanded.has(props.node.path);
  const FolderIcon = open ? FolderOpen : Folder;

  return (
    <div className='[content-visibility:auto]'>
      <button
        type='button'
        onClick={() => props.onToggle(props.node.path)}
        className='flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        style={{ paddingLeft: `${10 + props.depth * 20}px` }}
        aria-expanded={open}
        data-track-category='SdlcHub'
        data-track-name='WikiFolderToggled'
        data-track-metadata={JSON.stringify({ path: props.node.path, open: !open })}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <FolderIcon size={17} className='shrink-0 text-primary/80' />
        <span className='truncate font-mono text-sm'>{props.node.name}</span>
        <span className='ml-auto rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground'>
          {props.node.pageCount}
        </span>
      </button>
      {open ? (
        <div>
          {props.node.folders.map(folder => (
            <WikiFolderNode
              key={folder.path}
              node={folder}
              depth={props.depth + 1}
              expanded={props.expanded}
              forceExpanded={props.forceExpanded}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
          ))}
          {props.node.pages.map(page => (
            <button
              key={page.canvasId}
              type='button'
              onClick={() => props.onOpen(page)}
              className='group flex min-h-12 w-full items-center gap-2.5 rounded-lg py-2.5 pr-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              style={{ paddingLeft: `${34 + (props.depth + 1) * 20}px` }}
              title={page.path}
              data-track-category='SdlcHub'
              data-track-name='WikiCanvasOpened'
              data-track-metadata={JSON.stringify({ canvasId: page.canvasId, path: page.path })}
            >
              <FileText
                size={16}
                className='shrink-0 text-muted-foreground group-hover:text-primary'
              />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-[15px] font-medium'>{page.title}</span>
                <span className='mt-0.5 block truncate font-mono text-xs text-muted-foreground'>
                  {page.path}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SdlcWikiSection(props: {
  pages: SdlcWikiPage[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpen: (page: SdlcWikiPage) => void;
  run: SdlcWikiRun | null;
  isAdmin: boolean;
  actionPending: boolean;
  onGenerate: (input: SdlcWikiStartInput) => Promise<void>;
  onRefresh: (input: Pick<SdlcWikiStartInput, 'chunkSize' | 'quality'>) => Promise<void>;
  onRetryRun: () => Promise<void>;
  onRetryKnowledge: () => Promise<void>;
  onCancelRun: () => Promise<void>;
  onDebugRun: () => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['', 'domains', 'overview']));
  const visiblePages = useMemo(() => filterWikiPages(props.pages, query), [props.pages, query]);
  const tree = useMemo(() => buildWikiTree(visiblePages), [visiblePages]);
  const newestSync = useMemo(
    () =>
      props.pages.reduce<string | null>(
        (latest, page) => (!latest || page.syncedAt > latest ? page.syncedAt : latest),
        null,
      ),
    [props.pages],
  );
  const toggle = (path: string): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <section className='mx-auto max-w-5xl'>
      <div className='flex items-start justify-between gap-6'>
        <div>
          <div className='flex items-center gap-3'>
            <div className='grid size-10 place-items-center rounded-xl border bg-background text-primary shadow-sm'>
              <BookOpen size={19} />
            </div>
            <div>
              <h2 className='text-xl font-semibold tracking-tight'>Repository Wiki</h2>
              <p className='mt-0.5 text-sm text-muted-foreground'>
                Source-managed documentation, preserved as repository paths.
              </p>
            </div>
          </div>
        </div>
        <div className='text-right'>
          <div className='font-mono text-2xl font-semibold tabular-nums'>{props.pages.length}</div>
          <div className='text-xs text-muted-foreground'>pages</div>
        </div>
      </div>

      <WikiRunControls
        run={props.run}
        isAdmin={props.isAdmin}
        actionPending={props.actionPending}
        onGenerate={props.onGenerate}
        onRefresh={props.onRefresh}
        onRetry={props.onRetryRun}
        onRetryKnowledge={props.onRetryKnowledge}
        onCancel={props.onCancelRun}
        onDebug={props.onDebugRun}
      />

      <div className='mt-6 overflow-hidden rounded-xl border bg-background shadow-sm'>
        <div className='flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3'>
          <div className='relative min-w-64 flex-1'>
            <Search
              size={15}
              className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
            />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder='Search titles or repository paths'
              className='h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring'
              aria-label='Search Wiki pages'
              data-track-category='SdlcHub'
              data-track-name='WikiSearched'
            />
          </div>
          <div className='font-mono text-[11px] text-muted-foreground'>
            {newestSync ? `updated ${new Date(newestSync).toLocaleString()}` : 'not generated'}
          </div>
        </div>

        <div className={cn('min-h-72 p-3', props.loading && 'grid place-items-center')}>
          {props.loading ? (
            <p className='text-sm text-muted-foreground'>Loading Wiki tree…</p>
          ) : props.error ? (
            <div className='grid min-h-64 place-items-center text-center'>
              <div>
                <p className='text-sm font-medium'>Wiki pages could not be loaded.</p>
                <button
                  type='button'
                  onClick={props.onRetry}
                  className='mt-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  data-track-category='SdlcHub'
                  data-track-name='WikiReloaded'
                >
                  Try again
                </button>
              </div>
            </div>
          ) : visiblePages.length === 0 ? (
            <div className='grid min-h-64 place-items-center px-6 text-center'>
              <div>
                <BookOpen className='mx-auto text-muted-foreground' size={28} />
                <p className='mt-3 text-sm font-medium'>
                  {props.pages.length === 0 ? 'No Wiki pages generated' : 'No matching Wiki pages'}
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {props.pages.length === 0
                    ? 'Choose Generate Wiki to build product and architecture knowledge from Git history.'
                    : 'Try a title, feature, or directory name.'}
                </p>
              </div>
            </div>
          ) : (
            <WikiFolderNode
              node={tree}
              depth={0}
              expanded={expanded}
              forceExpanded={Boolean(query.trim())}
              onToggle={toggle}
              onOpen={props.onOpen}
            />
          )}
        </div>
      </div>
    </section>
  );
}
