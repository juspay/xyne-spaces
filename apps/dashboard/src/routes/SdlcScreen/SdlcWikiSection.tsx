import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Network,
  Plus,
  Search,
} from 'lucide-react';
import { ProviderIcon } from '../AIScreen/environments/ProviderIcon';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { setUserPreference, userPreferencesSnapshot } from '../../machines/userPreferencesMachine';
import { cn } from '../../utils/classNames';
import { formatRelativeTime } from '../../utils/dateUtils';
import { SdlcArchiveMenu } from './SdlcArchiveMenu';
import type { SdlcWikiHubPage, SdlcWikiPage, WikiScope } from './sdlcWikiTree';

interface WikiTreeNode {
  name: string;
  path: string;
  folders: WikiTreeNode[];
  pages: SdlcWikiPage[];
}

// Numeric, so "10 Operations" comes after "2 Architecture": generated titles carry their order.
const byNumberedName = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true });

function createTreeNode(name: string, path: string): WikiTreeNode {
  return { name, path, folders: [], pages: [] };
}

export function buildWikiTree(pages: SdlcWikiPage[]): WikiTreeNode {
  const root = createTreeNode('Wiki', '');
  const nodeByPath = new Map<string, WikiTreeNode>([['', root]]);

  for (const page of pages) {
    let parent = root;
    let currentPath = '';
    for (const segment of page.folderPath.split('/').filter(Boolean)) {
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
    node.folders.sort((left, right) => byNumberedName(left.name, right.name));
    node.pages.sort((left, right) => byNumberedName(left.title, right.title));
    node.folders.forEach(sortNode);
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
      page.folderPath.toLocaleLowerCase().includes(normalized),
  );
}

const folderAncestors = (folderPath: string): string[] => {
  const segments = folderPath.split('/').filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
};

/** A page a reader opened, and when. Kept per user, on this device. */
interface WikiView {
  canvasId: string;
  at: number;
}

// The hub id comes from the URL. Prefixed, it can never name a built-in object key
// such as "constructor" or "__proto__".
const viewsKey = (channelId: string): string => `hub:${channelId}`;

/** The pages this reader opened in a hub, newest first. */
export function readWikiViews(channelId: string): WikiView[] {
  return userPreferencesSnapshot().sdlcWikiViews[viewsKey(channelId)] ?? [];
}

export function recordWikiView(channelId: string, canvasId: string): void {
  const rest = readWikiViews(channelId).filter(view => view.canvasId !== canvasId);
  setUserPreference('sdlcWikiViews', {
    ...userPreferencesSnapshot().sdlcWikiViews,
    [viewsKey(channelId)]: [{ canvasId, at: Date.now() }, ...rest].slice(0, 30),
  });
}

/**
 * The page a Wiki opens on: the one this reader had open last, else its Overview,
 * else its first top-level page, else its first page.
 */
export function wikiLandingPage(
  pages: readonly SdlcWikiPage[],
  views: readonly WikiView[],
): SdlcWikiPage | undefined {
  const live = pages.filter(page => !page.archived);
  const lastViewed = views.find(view => live.some(page => page.canvasId === view.canvasId));
  if (lastViewed) return live.find(page => page.canvasId === lastViewed.canvasId);
  const byTitle = [...live].sort((left, right) => byNumberedName(left.title, right.title));
  const topLevel = byTitle.filter(page => !page.folderPath);
  return (
    topLevel.find(page => page.title.toLocaleLowerCase().includes('overview')) ??
    topLevel[0] ??
    byTitle[0]
  );
}

/**
 * The tree as a docs site draws it, not as a file browser: every folder is the same
 * folding group, whatever its depth, and pages are plain lines of text under it.
 */
function WikiFolderNode(props: {
  node: WikiTreeNode;
  depth: number;
  expanded: Set<string>;
  forceExpanded: boolean;
  activeCanvasId: string | null;
  onToggle: (path: string) => void;
  onOpen: (page: SdlcWikiPage) => void;
  /** Undefined for everyone but hub admins. */
  onArchivePage: ((page: SdlcWikiPage, archived: boolean) => void) | undefined;
}): ReactElement {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const open = props.forceExpanded || props.expanded.has(props.node.path);
  const Chevron = open ? ChevronDown : ChevronRight;
  // A folder steps in once per level, and its pages line up under its name.
  const folderIndent = 8 + Math.max(0, props.depth - 1) * 14;
  const pageIndent = props.depth === 0 ? 8 : folderIndent + 19;

  return (
    <div>
      {props.depth > 0 ? (
        <button
          type='button'
          onClick={() => props.onToggle(props.node.path)}
          className='flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
          style={{ paddingLeft: `${folderIndent}px` }}
          aria-expanded={open}
          data-track-category='SdlcHub'
          data-track-name='WikiFolderToggled'
          data-track-metadata={JSON.stringify({ path: props.node.path, open: !open })}
        >
          <Chevron size={13} className='shrink-0 text-sidebar-foreground/60' />
          <span className='min-w-0 flex-1 truncate' title={props.node.name}>
            {props.node.name}
          </span>
        </button>
      ) : null}
      {open || props.depth === 0 ? (
        <div>
          {props.node.pages.map(page => {
            const active = page.canvasId === props.activeCanvasId;
            return (
              <div
                key={page.canvasId}
                className={cn(
                  'group flex h-8 items-center rounded-lg border border-transparent pr-1 transition-colors',
                  active
                    ? 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent',
                  page.archived && 'opacity-60',
                )}
                // The menu button shows on hover only, so right-click opens it too.
                onContextMenu={
                  props.onArchivePage &&
                  ((event): void => {
                    event.preventDefault();
                    setMenuFor(page.canvasId);
                  })
                }
              >
                <button
                  type='button'
                  onClick={() => props.onOpen(page)}
                  {...(active && { 'aria-current': 'page' as const })}
                  className='flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
                  style={{ paddingLeft: `${pageIndent}px` }}
                  data-track-category='SdlcHub'
                  data-track-name='WikiCanvasOpened'
                  data-track-metadata={JSON.stringify({ canvasId: page.canvasId })}
                >
                  <span
                    className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}
                    title={page.archived ? `${page.title} (archived)` : page.title}
                  >
                    {page.title}
                  </span>
                  {page.archived && (
                    <span className='shrink-0 text-[11px] text-sidebar-foreground/70'>
                      Archived
                    </span>
                  )}
                </button>
                {props.onArchivePage && (
                  <SdlcArchiveMenu
                    title={page.title}
                    archived={page.archived}
                    trackingScope='Wiki'
                    className='size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100'
                    open={menuFor === page.canvasId}
                    onOpenChange={next => setMenuFor(next ? page.canvasId : null)}
                    onToggle={archived => props.onArchivePage?.(page, archived)}
                  />
                )}
              </div>
            );
          })}
          {props.node.folders.map(folder => (
            <WikiFolderNode
              key={folder.path}
              node={folder}
              depth={props.depth + 1}
              expanded={props.expanded}
              forceExpanded={props.forceExpanded}
              activeCanvasId={props.activeCanvasId}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
              onArchivePage={props.onArchivePage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Open folders per Wiki, kept while the reader moves between its pages. */
const expandedByScope = new Map<string, Set<string>>();

/**
 * A Wiki's own side panel, shown in the hub sidebar the way a track's folder page shows
 * its Explorer: the repository switcher, search, the page tree, and the admin controls.
 */
export function SdlcWikiExplorer(props: {
  scopes: WikiScope[];
  scope: WikiScope;
  /** The scope's pages, archived ones too when they are shown. */
  pages: SdlcWikiPage[];
  activeCanvasId: string | null;
  showArchived: boolean;
  /** Hub admins only; hides New page and the archive menus when false. */
  canManage: boolean;
  onSelectScope: (folderId: string) => void;
  onShowArchivedChange: (next: boolean) => void;
  onOpen: (page: SdlcWikiPage) => void;
  onCreatePage: () => void;
  onArchivePage: (page: SdlcWikiPage, archived: boolean) => void;
}): ReactElement {
  const scopeId = props.scope.folderId;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(expandedByScope.get(scopeId)),
  );
  const activeFolderPath = props.pages.find(
    page => page.canvasId === props.activeCanvasId,
  )?.folderPath;
  const topFolders = useMemo(
    () => [...new Set(props.pages.flatMap(page => page.folderPath.split('/')[0] || []))],
    [props.pages],
  );
  // A Wiki opens with its top folders open, or as the reader left it. Keyed on the folder
  // names, not the array, so a data sync does not reopen a folder the reader closed.
  const topFolderKey = topFolders.join('/');
  useEffect(() => {
    if (!topFolderKey) return;
    const next = new Set(expandedByScope.get(scopeId) ?? topFolderKey.split('/'));
    expandedByScope.set(scopeId, next);
    setExpanded(next);
  }, [scopeId, topFolderKey]);
  // The open page is always in view, whichever way the reader got to it.
  useEffect(() => {
    if (!activeFolderPath) return;
    setExpanded(current => {
      const next = new Set([...current, ...folderAncestors(activeFolderPath)]);
      expandedByScope.set(scopeId, next);
      return next;
    });
  }, [scopeId, activeFolderPath]);
  const visiblePages = useMemo(() => filterWikiPages(props.pages, query), [props.pages, query]);
  const tree = useMemo(() => buildWikiTree(visiblePages), [visiblePages]);
  const toggle = (path: string): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      expandedByScope.set(scopeId, next);
      return next;
    });
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <Select value={scopeId} onValueChange={props.onSelectScope}>
        <SelectTrigger
          className='h-9 w-full border-transparent bg-transparent px-2 text-sm font-semibold text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent focus:ring-1 focus:ring-sidebar-accent-ring'
          aria-label='Repository'
        >
          <SelectValue />
        </SelectTrigger>
        {/* Opts out of the dark theme's hardcoded blue for the chosen option (see global.css). */}
        <SelectContent data-theme-tokens>
          {props.scopes.map(scope => (
            <SelectItem
              key={scope.folderId}
              value={scope.folderId}
              data-theme-tokens
              data-track-category='SdlcHub'
              data-track-name='WikiScopeSelected'
              data-track-metadata={JSON.stringify({ hub: scope.hub })}
            >
              {scope.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Nothing to search in a Wiki with no pages. */}
      <div className={cn('relative', props.pages.length === 0 && 'hidden')}>
        <Search
          size={14}
          className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sidebar-foreground/60'
        />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder='Search pages'
          className='h-8 w-full rounded-lg border border-transparent bg-sidebar-foreground/[0.06] pl-8 pr-2 text-[13px] outline-none placeholder:text-sidebar-foreground/60 focus:border-sidebar-border focus:bg-sidebar-accent'
          aria-label='Search research pages'
          data-track-category='SdlcHub'
          data-track-name='WikiSearched'
        />
      </div>
      <nav
        aria-label='Research pages'
        className='no-scrollbar mt-1 min-h-0 flex-1 overflow-y-auto pb-2'
      >
        {visiblePages.length === 0 ? (
          <p className='px-2 py-3 text-[13px] text-sidebar-foreground/70'>
            {props.pages.length === 0 ? 'No pages yet' : 'No matching pages'}
          </p>
        ) : (
          <WikiFolderNode
            node={tree}
            depth={0}
            expanded={expanded}
            forceExpanded={Boolean(query.trim())}
            activeCanvasId={props.activeCanvasId}
            onToggle={toggle}
            onOpen={props.onOpen}
            onArchivePage={props.canManage ? props.onArchivePage : undefined}
          />
        )}
      </nav>
      <div className='flex shrink-0 flex-col gap-2 border-t border-sidebar-border-muted px-1 py-3'>
        {props.canManage && (
          <button
            type='button'
            onClick={props.onCreatePage}
            className='flex h-8 items-center gap-2 rounded-lg px-1.5 text-left text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
            data-track-category='SdlcHub'
            data-track-name='WikiPageCreateOpened'
          >
            <Plus size={15} />
            New page
          </button>
        )}
        <div className='px-1.5'>
          <Checkbox
            labelClassName='text-xs text-sidebar-foreground/80'
            label='Show archived'
            checked={props.showArchived}
            onChange={props.onShowArchivedChange}
            data-track-category='SdlcHub'
            data-track-name='WikiArchivedToggled'
          />
        </div>
      </div>
    </div>
  );
}

function RecentList(props: {
  title: string;
  note?: string;
  rows: Array<{ page: SdlcWikiHubPage; detail: string }>;
  trackName: string;
  onOpenPage: (page: SdlcWikiHubPage) => void;
}): ReactElement {
  return (
    <div className='min-w-0'>
      <h4 className='mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
        {props.title}
      </h4>
      <div className='divide-y overflow-hidden rounded-xl border bg-background'>
        {props.rows.map(({ page, detail }) => (
          <button
            key={page.canvasId}
            type='button'
            onClick={() => props.onOpenPage(page)}
            className='flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
            data-track-category='SdlcHub'
            data-track-name={props.trackName}
            data-track-metadata={JSON.stringify({ canvasId: page.canvasId })}
          >
            <FileText size={15} className='shrink-0 text-muted-foreground' />
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium' title={page.title}>
                {page.title}
              </span>
              <span className='block truncate text-xs text-muted-foreground'>{page.scopeName}</span>
            </span>
            <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{detail}</span>
          </button>
        ))}
      </div>
      {props.note && <p className='mt-2 text-xs text-muted-foreground'>{props.note}</p>}
    </div>
  );
}

/** The Wiki's first page: the hub's repositories, then where the reader left off and what changed. */
export function SdlcWikiHome(props: {
  channelId: string;
  scopes: WikiScope[];
  pageCounts: ReadonlyMap<string, number>;
  /** Live pages of every scope. */
  allPages: SdlcWikiHubPage[];
  /** Repository id to its clone url, for the provider's logo. */
  repoUrls: ReadonlyMap<string, string>;
  /** Hub admins only; hides the add card when false. */
  canManage: boolean;
  /** Status and button of the run that writes the Wiki. */
  runControl: ReactNode;
  onSelectScope: (folderId: string) => void;
  onAddRepository: () => void;
  onOpenPage: (page: SdlcWikiHubPage) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase();
  const visibleScopes = normalized
    ? props.scopes.filter(scope => scope.name.toLocaleLowerCase().includes(normalized))
    : props.scopes;
  const updatedAtByScope = new Map<string, number>();
  for (const page of props.allPages) {
    const at = Date.parse(page.updatedAt);
    if (at > (updatedAtByScope.get(page.scopeFolderId) ?? 0)) {
      updatedAtByScope.set(page.scopeFolderId, at);
    }
  }
  const pageById = new Map(props.allPages.map(page => [page.canvasId, page]));
  const viewed = readWikiViews(props.channelId)
    .flatMap(view => {
      const page = pageById.get(view.canvasId);
      return page ? [{ page, at: view.at }] : [];
    })
    .slice(0, 5)
    .map(({ page, at }) => ({
      page,
      detail: `${formatRelativeTime(at)}${Date.parse(page.updatedAt) > at ? ' · updated since' : ''}`,
    }));
  const updated = [...props.allPages]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5)
    .map(page => ({ page, detail: formatRelativeTime(Date.parse(page.updatedAt)) }));

  return (
    <section className='mx-auto max-w-5xl'>
      <h3 className='text-center text-lg font-medium'>
        Which repository would you like to understand?
      </h3>
      <div className='relative mx-auto mt-4 max-w-md'>
        <Search
          size={15}
          className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
        />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder='Search repositories'
          className='h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'
          aria-label='Search repositories'
          data-track-category='SdlcHub'
          data-track-name='WikiRepositorySearched'
        />
      </div>
      <div className='mt-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <h4 className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
          Repositories and Relationships
        </h4>
        {props.runControl}
      </div>
      <div className='mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {props.canManage && (
          <button
            type='button'
            onClick={props.onAddRepository}
            className='group flex min-h-36 flex-col rounded-xl border border-dashed p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            data-track-category='SdlcHub'
            data-track-name='WikiRepositoryAddOpened'
          >
            <span className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
              <Plus size={18} />
            </span>
            <span className='mt-4 font-medium'>Add repositories</span>
            <span className='mt-1 text-xs text-muted-foreground'>
              Connect more repositories. Each one is researched on the next run.
            </span>
          </button>
        )}
        {visibleScopes.map(scope => {
          const count = props.pageCounts.get(scope.folderId) ?? 0;
          const updatedAt = updatedAtByScope.get(scope.folderId);
          return (
            <button
              key={scope.folderId}
              type='button'
              onClick={() => props.onSelectScope(scope.folderId)}
              className='group flex min-h-36 flex-col rounded-xl border bg-background p-5 text-left transition-[border-color,box-shadow] hover:border-primary/35 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='SdlcHub'
              data-track-name='WikiScopeSelected'
              data-track-metadata={JSON.stringify({ hub: scope.hub })}
            >
              <span className='grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground'>
                {scope.hub ? (
                  <Network size={18} />
                ) : (
                  <ProviderIcon url={props.repoUrls.get(scope.repoId ?? '') ?? ''} />
                )}
              </span>
              <span className='mt-4 max-w-full truncate font-medium' title={scope.name}>
                {scope.name}
              </span>
              <span className='mt-1 text-xs text-muted-foreground'>
                {scope.hub ? 'How these repositories connect' : 'Deep research on this repository'}
              </span>
              <span className='mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-muted-foreground'>
                <span className='tabular-nums'>
                  {count === 0
                    ? 'Not generated yet'
                    : `${count} page${count === 1 ? '' : 's'}${updatedAt ? ` · Updated ${formatRelativeTime(updatedAt)}` : ''}`}
                </span>
                <ArrowRight
                  size={16}
                  className='shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground'
                />
              </span>
            </button>
          );
        })}
      </div>
      {normalized && visibleScopes.length === 0 && (
        <div className='mt-8 text-center'>
          <p className='text-sm font-medium'>No matching repositories</p>
          <p className='mt-1 text-xs text-muted-foreground'>Try another repository name.</p>
        </div>
      )}
      {updated.length > 0 && (
        <div className={cn('mt-8 grid gap-5', viewed.length > 0 && 'md:grid-cols-2')}>
          {viewed.length > 0 && (
            <RecentList
              title='Recently viewed by you'
              note='Only you see this list. It is saved on this device.'
              rows={viewed}
              trackName='WikiRecentlyViewedOpened'
              onOpenPage={props.onOpenPage}
            />
          )}
          <RecentList
            title='Recently updated'
            rows={updated}
            trackName='WikiRecentlyUpdatedOpened'
            onOpenPage={props.onOpenPage}
          />
        </div>
      )}
    </section>
  );
}

/** A Wiki with no pages yet: the same place its pages will be, saying how to get the first ones. */
export function SdlcWikiEmpty(props: {
  canManage: boolean;
  /** Null on the Hub Wiki, which is written from every repository. */
  repositoryName: string | null;
  /** A Wiki run is under way: say so, instead of offering to start one. */
  running: boolean;
  runStatus: ReactNode;
  runButton: ReactNode;
  onCreatePage: () => void;
}): ReactElement {
  const source = props.repositoryName ?? "this hub's repositories";
  return (
    <div className='grid h-full min-h-72 place-items-center px-6 text-center'>
      <div className='max-w-md'>
        <BookOpen
          className={cn('mx-auto', props.running ? 'text-primary' : 'text-muted-foreground')}
          size={28}
        />
        <p className='mt-3 text-lg font-semibold' aria-live='polite'>
          {props.running ? 'Running deep research' : 'No research pages yet'}
        </p>
        <p className='mt-1.5 text-sm text-muted-foreground'>
          {props.running
            ? `The run reads the code of ${source} and writes its pages. They show up here as they are written, and a large repository takes a while.`
            : props.canManage
              ? `Generate it from the code of ${source}, or write the first page yourself.`
              : 'Pages appear here once an admin runs deep research.'}
        </p>
        {/* While it runs, what is happening comes before the way to stop it. */}
        <div
          className={cn(
            'mt-5 flex items-center gap-3',
            props.running ? 'flex-col-reverse' : 'flex-col',
          )}
        >
          <div className='flex flex-wrap items-center justify-center gap-2'>
            {props.runButton}
            {/* Not while a run writes the same Wiki. The sidebar keeps New page for whoever needs it. */}
            {props.canManage && !props.running && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={props.onCreatePage}
                data-track-category='SdlcHub'
                data-track-name='WikiPageCreateOpened'
              >
                <Plus size={15} />
                New page
              </Button>
            )}
          </div>
          <div className='flex flex-wrap items-center justify-center gap-x-2 gap-y-1'>
            {props.runStatus}
          </div>
        </div>
      </div>
    </div>
  );
}
