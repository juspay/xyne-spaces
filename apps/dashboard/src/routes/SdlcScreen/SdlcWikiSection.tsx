import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Network,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { cn } from '../../utils/classNames';
import { SdlcArchiveMenu } from './SdlcArchiveMenu';
import type { SdlcWikiPage, WikiScope } from './sdlcWikiTree';

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
    node.folders.sort((left, right) => left.name.localeCompare(right.name));
    node.pages.sort((left, right) => left.title.localeCompare(right.title));
    node.folders.forEach(sortNode);
    node.pageCount =
      node.pages.filter(page => !page.archived).length +
      node.folders.reduce((total, folder) => total + folder.pageCount, 0);
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

function WikiFolderNode(props: {
  node: WikiTreeNode;
  depth: number;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onOpen: (page: SdlcWikiPage) => void;
  /** Undefined for everyone but hub admins. */
  onArchivePage: ((page: SdlcWikiPage, archived: boolean) => void) | undefined;
}): ReactElement {
  const open = props.forceExpanded || props.expanded.has(props.node.path);
  const FolderIcon = open ? FolderOpen : Folder;

  return (
    <div className='[content-visibility:auto]'>
      {props.depth > 0 ? (
        <button
          type='button'
          onClick={() => props.onToggle(props.node.path)}
          className='flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          style={{ paddingLeft: `${10 + (props.depth - 1) * 20}px` }}
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
      ) : null}
      {open || props.depth === 0 ? (
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
              onArchivePage={props.onArchivePage}
            />
          ))}
          {props.node.pages.map(page => (
            <div
              key={page.canvasId}
              className={cn(
                'group flex items-center rounded-lg pr-2 transition-colors hover:bg-primary/5',
                page.archived && 'opacity-60',
              )}
            >
              <button
                type='button'
                onClick={() => props.onOpen(page)}
                className='flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                style={{ paddingLeft: `${14 + props.depth * 20}px` }}
                data-track-category='SdlcHub'
                data-track-name='WikiCanvasOpened'
                data-track-metadata={JSON.stringify({ canvasId: page.canvasId })}
              >
                <FileText
                  size={16}
                  className='shrink-0 text-muted-foreground group-hover:text-primary'
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[15px] font-medium'>{page.title}</span>
                  <span className='mt-0.5 block truncate text-xs text-muted-foreground'>
                    {page.archived ? 'Archived · ' : ''}
                    Updated {new Date(page.updatedAt).toLocaleString()}
                  </span>
                </span>
              </button>
              {props.onArchivePage && (
                <SdlcArchiveMenu
                  title={page.title}
                  archived={page.archived}
                  trackingScope='Wiki'
                  onToggle={archived => props.onArchivePage?.(page, archived)}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WikiScopeGrid(props: {
  scopes: WikiScope[];
  pageCounts: ReadonlyMap<string, number>;
  onSelectScope: (folderId: string) => void;
  onAddRepository: () => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase();
  const visibleScopes = normalized
    ? props.scopes.filter(scope => scope.name.toLocaleLowerCase().includes(normalized))
    : props.scopes;

  return (
    <div className='pt-2'>
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
          className='h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring'
          aria-label='Search repositories'
          data-track-category='SdlcHub'
          data-track-name='WikiRepositorySearched'
        />
      </div>
      <div className='mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <button
          type='button'
          onClick={props.onAddRepository}
          className='group flex min-h-40 flex-col rounded-xl border border-dashed p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          data-track-category='SdlcHub'
          data-track-name='WikiRepositoryAddOpened'
        >
          <span className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
            <Plus size={18} />
          </span>
          <span className='mt-4 font-medium'>Add repository</span>
          <span className='mt-1 text-xs text-muted-foreground'>
            Its Wiki is written on the next run.
          </span>
        </button>
        {visibleScopes.map(scope => {
          const count = props.pageCounts.get(scope.folderId) ?? 0;
          const ScopeIcon = scope.hub ? Network : GitBranch;
          return (
            <button
              key={scope.folderId}
              type='button'
              onClick={() => props.onSelectScope(scope.folderId)}
              className='group flex min-h-40 flex-col rounded-xl border bg-background p-5 text-left transition-[border-color,box-shadow] hover:border-primary/35 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='SdlcHub'
              data-track-name='WikiScopeSelected'
              data-track-metadata={JSON.stringify({ hub: scope.hub })}
            >
              <span className='grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground'>
                <ScopeIcon size={18} />
              </span>
              <span className='mt-4 truncate font-medium'>{scope.name}</span>
              <span className='mt-1 text-xs text-muted-foreground'>
                {scope.hub ? 'How the repositories in this hub connect' : 'Repository Wiki'}
              </span>
              <span className='mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground'>
                <span className='tabular-nums'>
                  {count} page{count === 1 ? '' : 's'}
                </span>
                <ArrowRight
                  size={16}
                  className='transition-transform group-hover:translate-x-0.5 group-hover:text-foreground'
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SdlcWikiSection(props: {
  header: ReactNode;
  scopes: WikiScope[];
  /** Null shows the repository grid. */
  scope: WikiScope | null;
  pageCounts: ReadonlyMap<string, number>;
  pages: SdlcWikiPage[];
  showArchived: boolean;
  /** Hub admins only; hides the add and archive controls when false. */
  canManage: boolean;
  onSelectScope: (folderId: string) => void;
  onAddRepository: () => void;
  onShowArchivedChange: (next: boolean) => void;
  onOpen: (page: SdlcWikiPage) => void;
  onCreatePage: () => void;
  onArchivePage: (page: SdlcWikiPage, archived: boolean) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visiblePages = useMemo(() => filterWikiPages(props.pages, query), [props.pages, query]);
  const tree = useMemo(() => buildWikiTree(visiblePages), [visiblePages]);
  const activePageCount = props.pages.filter(page => !page.archived).length;
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
      {props.header}

      {props.scope ? (
        <>
          <div className='flex items-center justify-between gap-4'>
            <Select value={props.scope.folderId} onValueChange={props.onSelectScope}>
              <SelectTrigger className='w-72' aria-label='Wiki'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.scopes.map(scope => (
                  <SelectItem
                    key={scope.folderId}
                    value={scope.folderId}
                    data-track-category='SdlcHub'
                    data-track-name='WikiScopeSelected'
                    data-track-metadata={JSON.stringify({ hub: scope.hub })}
                  >
                    {scope.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className='text-sm tabular-nums text-muted-foreground'>
              {activePageCount} page{activePageCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className='mt-4 overflow-hidden rounded-xl border bg-background shadow-sm'>
            <div className='flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3'>
              <div className='relative min-w-64 flex-1'>
                <Search
                  size={15}
                  className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
                />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder='Search titles or folders'
                  className='h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                  aria-label='Search Wiki pages'
                  data-track-category='SdlcHub'
                  data-track-name='WikiSearched'
                />
              </div>
              <Checkbox
                size='sm'
                label='Show archived'
                checked={props.showArchived}
                onChange={props.onShowArchivedChange}
                data-track-category='SdlcHub'
                data-track-name='WikiArchivedToggled'
              />
              {props.canManage && (
                <Button
                  type='button'
                  size='sm'
                  onClick={props.onCreatePage}
                  data-track-category='SdlcHub'
                  data-track-name='WikiPageCreateOpened'
                >
                  <Plus size={15} />
                  New page
                </Button>
              )}
            </div>

            <div className='min-h-72 p-3'>
              {visiblePages.length === 0 ? (
                <div className='grid min-h-64 place-items-center px-6 text-center'>
                  <div>
                    <BookOpen className='mx-auto text-muted-foreground' size={28} />
                    <p className='mt-3 text-sm font-medium'>
                      {props.pages.length === 0 ? 'No Wiki pages yet' : 'No matching Wiki pages'}
                    </p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {props.pages.length === 0
                        ? 'Pages appear here once the Generate Wiki workflow runs.'
                        : 'Try a title or folder name.'}
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
                  onArchivePage={props.canManage ? props.onArchivePage : undefined}
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <WikiScopeGrid
          scopes={props.scopes}
          pageCounts={props.pageCounts}
          onSelectScope={props.onSelectScope}
          onAddRepository={props.onAddRepository}
        />
      )}
    </section>
  );
}
