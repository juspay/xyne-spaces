import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Search,
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
            {newestSync ? `synced ${new Date(newestSync).toLocaleString()}` : 'not imported'}
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
                  {props.pages.length === 0 ? 'No Wiki pages imported' : 'No matching Wiki pages'}
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {props.pages.length === 0
                    ? 'Run the SDLC Wiki import script to add Research Agent documentation.'
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
