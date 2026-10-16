import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ClipboardPaste,
  Download,
  FolderPlus,
  Pencil,
  ChevronRight,
  ExternalLink,
  Loader2,
  Save,
  FileText,
  Folder,
  Globe,
  PanelLeft,
  FolderOpen,
  Link2,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Scissors,
  Upload,
} from 'lucide-react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import { Popover } from '../../components/ui/Popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { downloadFile } from '../../services/clients/fileFetchService';
import {
  setUserPreference,
  useUserPreference,
  userPreferencesSnapshot,
} from '../../machines/userPreferencesMachine';
import { formatShortcut, useScope, useShortcutById, type ShortcutId } from '../../shortcuts';
import { resolveShortcutKeys } from '../../components/ui/ShortcutHint';
import { usePlatform } from '../../hooks/usePlatform';
import { FilePreview } from '../../components/FilePreview';
import { Tooltip } from '../../components/ui/Tooltip';
import { openLink } from '../../utils/openLink';
import { homePageFor, hostOf } from '../../utils/browserAddress';
import { useBridgeTransport } from './useBridgeTransport';
import {
  canHostEmbedPages,
  controlEmbeddedPage,
  discardEmbeddedPage,
  embedPageOverElement,
  historyFromHost,
  openLinkFromSdlcFrame,
  reclaimHostFocus,
  subscribeToEmbeddedCommand,
  subscribeToEmbeddedOpen,
  subscribeToEmbeddedPage,
  useEmbeddedPages,
} from './useSdlcFrameBridge';
import type { SdlcEmbedPageState, SdlcEmbedTab } from './sdlcFrameMessages';
import { fileKind, type FileKind } from './fileKind';
import {
  BrowserToolbar,
  DownloadsButton,
  FindBar,
  LoadError,
  SiteTiles,
  StartPage,
  StartSection,
  TabStrip,
  TabSwitcher,
  ToolbarButton,
  siteLetter,
  useFindInPage,
  type HistorySource,
  type TabSwitcherEntry,
} from '../../components/InAppBrowser';
import { FileTypeIcon } from './FileTypeIcon';
import { AppIcon } from '../../components/AppIcon/AppIcon';
import { ActivityPill, type SdlcLiveCalls } from './ActivityPill';
import {
  CommentsPanel,
  ItemView,
  commentStoreFor,
  itemFromSdlc,
  onCommentsRequested,
  publishOpenItems,
  revealAnchor,
  useAnnotate,
  useDomTransport,
  type PickedBlock,
  type WorkspaceItem,
} from '../../components/workspaceItems';
import { FilesEmptyState } from './SdlcFilesEmptyState';
import {
  formatUpdated,
  sdlcItemName,
  sdlcParentFolders,
  targetItemOf,
  type SdlcLinkItem,
  type SdlcTargetLink,
  type SdlcTrackItem,
} from './sdlcItems';

export type FolderTabKind = 'CANVAS' | 'LINK' | 'ATTACHMENT' | 'BROWSER';

/**
 * The browsing tab folders had before they could have several: still opened from
 * links and tabs saved then. New browsing tabs get ids of their own.
 */
export const SCRATCH_TAB_ID = 'browse';

/** A new browsing tab's id: its own, so several can be open in one folder. */
export const newBrowsingTabId = (): string =>
  `browse-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * How many tabs a folder's strip looks up. Past this many the oldest drop out of the
 * strip, as ones whose items are gone already do.
 */
const TAB_LOOKUP_LIMIT = 100;

export interface FolderTab {
  kind: FolderTabKind;
  id: string;
  /** A browsing tab's page, kept as it moves so the tab reopens where it was; none
   *  while it shows its start page. */
  url?: string;
  /** A browsing tab's page title, for its label before the page has loaded again. */
  title?: string;
  /** And its icon, likewise. */
  favicon?: string;
}

/**
 * A stored per-folder record with one folder's entry replaced. Folder ids can arrive
 * from the URL, so the record is rebuilt from its entries, each defined as its own
 * key, rather than written through a key taken from outside.
 */
export function withFolderEntry<T>(
  record: Readonly<Record<string, T>>,
  folderId: string,
  value: T,
): Record<string, T> {
  return Object.fromEntries([
    ...Object.entries(record).filter(([key]) => key !== folderId),
    [folderId, value],
  ]);
}

interface TreeNode {
  kind: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
  id: string;
  name: string;
  /** A link's favicon, when the page offered one. */
  favicon: string | null;
  /** An uploaded file's format, which picks its icon. */
  fileKind: FileKind | null;
  /** A folder's chosen icon, an @xyne/icons name. */
  folderIcon: string | null;
}

function treeNodeOf(item: SdlcTrackItem): TreeNode {
  return {
    kind: item.kind,
    id: item.id,
    name: sdlcItemName(item),
    favicon: item.kind === 'LINK' ? item.favicon : null,
    fileKind: item.kind === 'ATTACHMENT' ? fileKind(item.mimetype, item.name) : null,
    folderIcon: item.kind === 'FOLDER' ? item.icon : null,
  };
}

const tabKey = (tab: { kind: string; id: string }): string => `${tab.kind}:${tab.id}`;

/**
 * The key a tab's page is kept under in the window. The scratch tab has the same id
 * in every folder, so its page is told apart by the folder — or a parked page from
 * one folder would come back in another. Still `KIND:id`, as every window takes.
 */
const pageKeyOf = (folderId: string, tab: { kind: string; id: string }): string =>
  tab.id === SCRATCH_TAB_ID
    ? `${tab.kind}:${tab.id}-${folderId.replace(/[^\w-]/g, '')}`.slice(0, tab.kind.length + 129)
    : tabKey(tab);

export function compareTreeNodes(
  left: { kind: string; name: string },
  right: { kind: string; name: string },
): number {
  const leftIsFolder = left.kind === 'FOLDER';
  const rightIsFolder = right.kind === 'FOLDER';
  if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
}

function nodesFromEdges(edges: readonly SdlcTargetLink[]): TreeNode[] {
  const nodes = edges.flatMap(edge => {
    const item = targetItemOf(edge);
    return item ? [treeNodeOf(item)] : [];
  });
  return nodes.sort(compareTreeNodes);
}

function NodeIcon(props: { node: TreeNode; size?: string; active?: boolean }): ReactElement {
  const className = cn(
    props.size ?? 'size-[15px]',
    'shrink-0',
    props.active ? '' : 'text-muted-foreground',
  );
  if (props.node.kind === 'LINK') {
    if (props.node.favicon) {
      return (
        <img
          src={props.node.favicon}
          alt=''
          className={cn(props.size ?? 'size-[15px]', 'shrink-0 rounded-sm object-contain')}
        />
      );
    }
    return <Link2 className={className} />;
  }
  if (props.node.kind === 'ATTACHMENT') {
    if (!props.node.fileKind) return <Paperclip className={className} />;
    return <FileTypeIcon kind={props.node.fileKind} size='sm' className={props.size} />;
  }
  return (
    <FileText
      className={cn(
        props.size ?? 'size-[15px]',
        'shrink-0',
        !props.active && 'text-muted-foreground',
      )}
    />
  );
}

/**
 * One level of the tree. Each expanded folder subscribes to its own children,
 * so opening a branch costs one query and closing it drops one — the same
 * bargain the track's file list makes, one folder at a time.
 */
interface TreeHandlers {
  channelId: string;
  /** Calls in progress in each track, folder and item, counting everything under it. */
  liveCallCounts: ReadonlyMap<string, SdlcLiveCalls>;
  activeTab: FolderTab | null;
  onOpen: (tab: FolderTab) => void;
  onDiscuss: (item: {
    type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
    id: string;
    name: string;
  }) => void;
  discussingId: string | null;
  onNewFolder: (parent: { id: string; name: string }) => void;
  onAddItem: (tab: 'artifact' | 'upload' | 'link', parent: { id: string; name: string }) => void;
  /** The row the keyboard is on, which is not the same as the open tab. */
  cursorId: string | null;
  /** Filing an item into another folder, the same move the track's file list makes. */
  onMoveItem: (
    item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string },
    parentFolderId: string,
  ) => void;
  dragging: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string } | null;
  onDrag: (item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string } | null) => void;
  /** The row whose name is a field, being renamed. */
  renamingId: string | null;
  onRenameDone: () => void;
  onRenameItem: (
    item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string },
    name: string,
  ) => void;
  /** A right-click on a row: the page's menu for it, where the pointer is. */
  onRowMenu: (node: TreeNode, at: { x: number; y: number }) => void;
  /** What is cut, waiting to be pasted: drawn faded where it still is. */
  cutIds: ReadonlySet<string>;
}

/** An open folder held at the top of the explorer while its contents scroll by. */
interface PinnedFolder {
  id: string;
  name: string;
  icon: string | null;
  depth: number;
  /** Where its row sits from the top of the tree: its place in the stack, or above
   *  it while the next folder pushes it out. */
  top: number;
}

/**
 * VS Code's sticky scroll, measured from the tree as it stands: an open folder whose
 * row has scrolled above its place in the stack, while some of what is in it is still
 * below, pins there. As its last item reaches the stack it is pushed up and out.
 * Only a folder's own ancestors can be pinned with it, so the stack is one path.
 */
function pinnedFoldersIn(tree: HTMLElement): PinnedFolder[] {
  const treeTop = tree.getBoundingClientRect().top;
  const pinned: PinnedFolder[] = [];
  for (const folder of tree.querySelectorAll<HTMLElement>('[data-explorer-folder]')) {
    const row = folder.firstElementChild;
    const id = folder.dataset['explorerFolder'];
    if (!row || !id) continue;
    const depth = Number(folder.dataset['explorerDepth'] ?? 0);
    const place = depth * TREE_ROW_HEIGHT;
    const rowTop = row.getBoundingClientRect().top - treeTop;
    const end = folder.getBoundingClientRect().bottom - treeTop;
    const top = Math.min(place, end - TREE_ROW_HEIGHT);
    if (rowTop >= place || top + TREE_ROW_HEIGHT <= place) continue;
    pinned.push({
      id,
      name: folder.dataset['explorerName'] ?? '',
      icon: folder.dataset['explorerIcon'] ?? null,
      depth,
      top,
    });
  }
  return pinned.sort((left, right) => left.depth - right.depth);
}

/** The same stack, drawn the same: a renamed or re-iconed folder is a change too. */
const samePinned = (left: readonly PinnedFolder[], right: readonly PinnedFolder[]): boolean =>
  left.length === right.length &&
  left.every((folder, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      folder.id === other.id &&
      folder.top === other.top &&
      folder.name === other.name &&
      folder.icon === other.icon
    );
  });

/**
 * An open folder's own calls, without the ones inside it: what is inside is on show
 * under it, each with its own pill, so the folder needs no dot pointing down to them.
 * A closed folder keeps its dot, as the only sign of a call in there.
 */
const ownCallsOnly = (live: SdlcLiveCalls | undefined): SdlcLiveCalls | undefined =>
  live && { ...live, inside: 0, insideMine: 0 };

const TREE_KINDS: readonly string[] = ['FOLDER', 'CANVAS', 'LINK', 'ATTACHMENT'];
/** A row's kind, read back from its data attribute. */
const isTreeKind = (value: string | undefined): value is TreeNode['kind'] =>
  value !== undefined && TREE_KINDS.includes(value);

/** A tree row's height, h-9: what each folder pinned above a row takes up. */
const TREE_ROW_HEIGHT = 36;
/** How many open folders pin to the top at most, so a deep path never fills the view. */
const TREE_PINNED_DEPTH = 5;

/**
 * A name made a field in place, as the file list renames: Enter or leaving it keeps
 * it, Escape lets it go. A file's name is picked without its extension, which it
 * keeps.
 */
function RenameField(props: {
  name: string;
  isFile: boolean;
  /** A folder's name is up to 120 characters; anything else's, 300, as a link's title. */
  maxLength: number;
  onDone: (name: string | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState(props.name);
  const abandoned = useRef(false);
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- it is opened to be typed in
      autoFocus
      value={draft}
      maxLength={props.maxLength}
      aria-label={`Rename ${props.name}`}
      onChange={event => setDraft(event.target.value)}
      onFocus={event => {
        const dot = props.isFile ? event.target.value.lastIndexOf('.') : -1;
        event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          abandoned.current = true;
          event.currentTarget.blur();
        }
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      onBlur={() => {
        const next = draft.trim();
        props.onDone(abandoned.current || !next || next === props.name ? null : next);
      }}
      className='h-7 min-w-0 flex-1 rounded-md bg-background px-1.5 text-sm text-foreground outline-none ring-1 ring-ring'
      data-track-category='SdlcHub'
      data-track-name='ExplorerItemRenamed'
    />
  );
}

/**
 * One row, and its children when it is an open folder. The folder the page is
 * rooted at renders through this too, so it behaves like every folder below it:
 * it expands, it can be added to, and it has its own conversations.
 */
function TreeRow(
  props: TreeHandlers & {
    node: TreeNode;
    depth: number;
    defaultExpanded?: boolean;
    /** What this row's children hang off. A track only for the root row of a
     *  track's own page; a folder everywhere else. */
    childrenParentType?: 'TRACK' | 'FOLDER';
  },
): ReactElement {
  const expanded = useUserPreference('sdlcFolderTreeExpanded');
  // What is this row's own stays here: its children take only the handlers, or the
  // root's track parent and its open-by-default would pass to every row beneath it.
  const {
    node,
    depth: _depth,
    defaultExpanded: _defaultExpanded,
    childrenParentType,
    ...handlers
  } = props;
  const isFolder = node.kind === 'FOLDER';
  const isOpen = isFolder && (expanded[node.id] ?? props.defaultExpanded ?? false);
  const isActive =
    !isFolder && props.activeTab?.kind === node.kind && props.activeTab.id === node.id;
  const [dragOver, setDragOver] = useState(false);
  // Only a folder can receive, and never the thing being dragged.
  const canAccept = isFolder && props.dragging !== null && props.dragging.id !== node.id;
  const rowRef = useRef<HTMLDivElement | null>(null);
  // The folders pinned above this row, which a row scrolled into view must clear.
  const pinnedAbove = Math.min(props.depth, TREE_PINNED_DEPTH) * TREE_ROW_HEIGHT;
  const pinnable = isOpen && props.depth < TREE_PINNED_DEPTH;

  return (
    // An open folder's box holds its row and everything under it: what the
    // explorer measures to pin the row while its contents scroll past.
    <div
      data-explorer-node={node.id}
      data-explorer-folder={pinnable ? node.id : undefined}
      data-explorer-depth={pinnable ? props.depth : undefined}
      data-explorer-name={pinnable ? node.name : undefined}
      data-explorer-icon={pinnable ? (node.folderIcon ?? undefined) : undefined}
    >
      {/* A row, not a button: it carries controls of its own, and a button
          cannot hold other buttons. */}
      <div
        ref={rowRef}
        data-explorer-row={node.id}
        data-explorer-kind={node.kind}
        data-explorer-open={isFolder ? String(isOpen) : undefined}
        draggable={props.renamingId !== node.id}
        onContextMenu={event => {
          event.preventDefault();
          props.onRowMenu(node, { x: event.clientX, y: event.clientY });
        }}
        onDragStart={event => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.id);
          props.onDrag({ type: node.kind, id: node.id });
        }}
        onDragEnd={() => {
          props.onDrag(null);
          setDragOver(false);
        }}
        onDragOver={event => {
          if (!canAccept) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={event => {
          setDragOver(false);
          if (!canAccept || !props.dragging) return;
          event.preventDefault();
          event.stopPropagation();
          props.onMoveItem(props.dragging, node.id);
          props.onDrag(null);
        }}
        // Rows read as the hub sidebar's do, which the explorer takes the place of:
        // the same height, type, colours and highlight.
        className={cn(
          'group/row flex h-9 items-center gap-1 rounded-[10px] border border-transparent pr-1.5 text-sm transition-colors',
          isActive
            ? 'border-sidebar-border bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-[:focus-visible]:bg-sidebar-accent has-[:focus-visible]:text-sidebar-accent-foreground',
          props.cursorId === node.id && !isActive && 'bg-sidebar-accent/70',
          dragOver && 'bg-primary/15',
          props.cutIds.has(node.id) && 'opacity-50',
        )}
        style={{ paddingLeft: 8 + props.depth * 16, scrollMarginTop: pinnedAbove }}
      >
        {props.renamingId === node.id ? (
          <div className='flex h-full min-w-0 flex-1 items-center gap-2'>
            {isFolder ? (
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-sidebar-foreground/60 transition-transform duration-200',
                  isOpen && 'rotate-90',
                )}
              />
            ) : (
              <span className='size-3.5 shrink-0' />
            )}
            {isFolder && node.folderIcon ? (
              <AppIcon name={node.folderIcon} size={16} className='shrink-0' aria-hidden='true' />
            ) : isFolder ? (
              <Folder className='size-4 shrink-0' />
            ) : (
              <NodeIcon node={node} size='size-4' active />
            )}
            <RenameField
              name={node.name}
              isFile={node.kind === 'ATTACHMENT'}
              maxLength={node.kind === 'FOLDER' ? 120 : 300}
              onDone={name => {
                props.onRenameDone();
                if (name) props.onRenameItem({ type: node.kind, id: node.id }, name);
              }}
            />
          </div>
        ) : (
          <button
            type='button'
            onClick={() => {
              if (node.kind === 'FOLDER') {
                setUserPreference(
                  'sdlcFolderTreeExpanded',
                  withFolderEntry(expanded, node.id, !isOpen),
                );
                // Closed from where it was pinned, it would drop back to its place
                // in the list, often far above: keep it in sight instead.
                if (isOpen) {
                  requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: 'nearest' }));
                }
                return;
              }
              props.onOpen({ kind: node.kind, id: node.id });
            }}
            className='outline-none flex h-full min-w-0 flex-1 items-center gap-2 text-left'
            data-track-category='SdlcHub'
            data-track-name={isFolder ? 'FolderTreeToggled' : 'FolderTreeItemOpened'}
            data-track-metadata={JSON.stringify({ id: node.id })}
          >
            {isFolder ? (
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-sidebar-foreground/60 transition-transform duration-200',
                  isOpen && 'rotate-90',
                )}
              />
            ) : (
              <span className='size-3.5 shrink-0' />
            )}
            {isFolder && node.folderIcon ? (
              <AppIcon name={node.folderIcon} size={16} className='shrink-0' aria-hidden='true' />
            ) : isFolder ? (
              <Folder className='size-4 shrink-0' />
            ) : (
              <NodeIcon node={node} size='size-4' active />
            )}
            <span className='min-w-0 flex-1 truncate'>{node.name}</span>
            <ActivityPill
              live={
                isOpen
                  ? ownCallsOnly(props.liveCallCounts.get(node.id))
                  : props.liveCallCounts.get(node.id)
              }
              place={node.name}
              size='sm'
              className='mr-1'
            />
          </button>
        )}
        {/* Its conversations, in the panel: apart from opening it in the centre. On the
            row the panel is showing it stays, lit, and puts the panel away. */}
        <button
          type='button'
          title={
            props.discussingId === node.id
              ? `Hide conversations on ${node.name}`
              : `Conversations on ${node.name}`
          }
          aria-label={`Conversations on ${node.name}`}
          aria-pressed={props.discussingId === node.id}
          onClick={() => props.onDiscuss({ type: node.kind, id: node.id, name: node.name })}
          className={cn(
            'outline-none flex size-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-sidebar-border focus-visible:bg-sidebar-border hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground',
            props.discussingId === node.id
              ? 'bg-sidebar-border/70 text-sidebar-accent-foreground opacity-100'
              : 'text-sidebar-foreground/70 opacity-0 focus:opacity-100 group-hover/row:opacity-100',
          )}
          data-track-category='SdlcHub'
          data-track-name='FolderTreeItemDiscussed'
        >
          <MessageCircle className='size-3.5' />
        </button>
        {/* Every folder in the tree can be added to, not just the one the page
            is rooted at. */}
        {isFolder && (
          <span className='shrink-0 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100'>
            <AddMenu
              onNewFolder={() => props.onNewFolder({ id: node.id, name: node.name })}
              onAddItem={tab => props.onAddItem(tab, { id: node.id, name: node.name })}
            />
          </span>
        )}
      </div>
      {isOpen && (
        <TreeLevel
          {...handlers}
          parentType={childrenParentType ?? 'FOLDER'}
          parentId={node.id}
          depth={props.depth + 1}
        />
      )}
    </div>
  );
}

/**
 * One level of the tree. Each expanded folder subscribes to its own children,
 * so opening a branch costs one query and closing it drops one — the same
 * bargain the track's file list makes, one folder at a time.
 */
function TreeLevel(
  props: TreeHandlers & { parentType: 'TRACK' | 'FOLDER'; parentId: string; depth: number },
): ReactElement {
  const [edgeRows] = useCachedQuery(
    queries.getSdlcFolderChildren({
      channelId: props.channelId,
      parentType: props.parentType,
      parentId: props.parentId,
    }),
    { enabled: Boolean(props.channelId && props.parentId) },
  );
  const nodes = useMemo(() => nodesFromEdges(Array.isArray(edgeRows) ? edgeRows : []), [edgeRows]);

  if (nodes.length === 0) {
    return (
      <p
        className='flex h-8 items-center text-xs text-sidebar-foreground/50'
        style={{ paddingLeft: 8 + props.depth * 16 + 22 }}
      >
        Empty
      </p>
    );
  }

  return (
    <>
      {nodes.map(node => (
        <TreeRow key={`${node.kind}-${node.id}`} {...props} node={node} depth={props.depth} />
      ))}
    </>
  );
}

function AddMenu(props: {
  onNewFolder: () => void;
  onAddItem: (tab: 'artifact' | 'upload' | 'link') => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const item = (
    label: string,
    icon: ReactElement,
    run: () => void,
    trackName: string,
  ): ReactElement => (
    <button
      type='button'
      onClick={() => {
        setOpen(false);
        run();
      }}
      className='outline-none flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted focus-visible:bg-muted'
      data-track-category='SdlcHub'
      data-track-name={trackName}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='end'
      sideOffset={6}
      className='w-[180px] p-1'
      trigger={
        <button
          type='button'
          title='Add to this folder'
          aria-label='Add to this folder'
          className='outline-none flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-border focus-visible:bg-sidebar-border hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground'
          data-track-category='SdlcHub'
          data-track-name='FolderPageAddOpened'
        >
          <Plus className='size-3.5' />
        </button>
      }
    >
      {item(
        'New artifact',
        <FileText className='size-4 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('artifact'),
        'NewArtifactOpened',
      )}
      {item(
        'Upload file',
        <Upload className='size-4 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('upload'),
        'UploadFileOpened',
      )}
      {item(
        'Add link',
        <Link2 className='size-4 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('link'),
        'AddLinkOpened',
      )}
      {item(
        'New folder',
        <Folder className='size-4 shrink-0 text-muted-foreground' />,
        props.onNewFolder,
        'NewFolderOpened',
      )}
    </Popover>
  );
}

/** How long the pointer rests on an icon before its name shows: passing over it
 *  on the way somewhere else shouldn't. */
const TOOLTIP_DELAY_MS = 600;

/**
 * A tab's name. A page shows what it is on now — its title, as the host reports it —
 * a saved link its own name until then, and a browsing tab the title it last had, or
 * its site, or that it is new. Anything else is its item's name, or what it is while
 * the item is on its way.
 */
function tabName(
  tab: FolderTab,
  item: SdlcTrackItem | undefined,
  page?: SdlcEmbedPageState,
): string {
  if (page?.title) return page.title;
  if (tab.kind === 'BROWSER') return tab.title || hostOf(tab.url) || 'New tab';
  if (item) return sdlcItemName(item);
  return tab.kind === 'LINK' ? 'Link' : tab.kind === 'ATTACHMENT' ? 'File' : 'Artifact';
}

/** On hover: a saved link's own name above the page it is on, and where that is. */
function tabTooltip(
  tab: FolderTab,
  item: SdlcTrackItem | undefined,
  page: SdlcEmbedPageState | undefined,
): string {
  const name = tabName(tab, item, page);
  if (tab.kind !== 'LINK' && tab.kind !== 'BROWSER') return name;
  const saved = tab.kind === 'LINK' && item ? sdlcItemName(item) : '';
  const url = page?.url || (item?.kind === 'LINK' ? item.url : tab.url) || '';
  return [saved && saved !== name ? `Saved as ${saved}` : '', name, url].filter(Boolean).join('\n');
}

/** A page's icon: the site's own once it says, a spinner while it loads, the tab's
 *  kind until then — and a link mark on a saved one. */
function PageIcon(props: {
  tab: FolderTab;
  item: SdlcTrackItem | undefined;
  page: SdlcEmbedPageState | undefined;
}): ReactElement {
  const { tab, item, page } = props;
  const savedFavicon = item?.kind === 'LINK' ? item.favicon : tab.favicon;
  const favicon = page?.favicon || savedFavicon;
  return (
    <span className='relative flex size-4 shrink-0 items-center justify-center'>
      {page?.loading ? (
        <Loader2 className='size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none' />
      ) : favicon ? (
        <img src={favicon} alt='' className='size-4 rounded-[3px] object-contain' />
      ) : tab.kind === 'LINK' ? (
        <Link2 className='size-4' />
      ) : (
        <Globe className='size-4' />
      )}
      {tab.kind === 'LINK' && (favicon || page?.loading) && (
        // A saved link, whichever page it is on: the mark the explorer's links carry.
        <span className='absolute -bottom-1 -right-1 flex size-2.5 items-center justify-center rounded-full bg-background'>
          <Link2 className='size-2 text-muted-foreground' />
        </span>
      )}
    </span>
  );
}

/** A tab's icon alone, as its label shows it: for the tab switcher's rows. */
function TabIcon(props: {
  folderId: string;
  tab: FolderTab;
  item: SdlcTrackItem | undefined;
}): ReactElement {
  const { tab, item } = props;
  const page = useEmbeddedPages().get(pageKeyOf(props.folderId, tab));
  if (tab.kind === 'BROWSER' || tab.kind === 'LINK') {
    return <PageIcon tab={tab} item={item} page={page} />;
  }
  const node: TreeNode = item
    ? treeNodeOf(item)
    : { kind: tab.kind, id: tab.id, name: '', favicon: null, fileKind: null, folderIcon: null };
  return <NodeIcon node={node} size='size-4' />;
}

/** When an item last changed: links and files never do, so theirs is when they came. */
function itemUpdatedAt(item: SdlcTrackItem): number {
  if (item.kind === 'FOLDER') return item.updatedAt;
  if (item.kind === 'CANVAS') return item.lastEditedAt ?? item.updatedAt;
  return item.createdAt;
}

const LANDING_ITEMS = 6;

/** A key the explorer answers to, as its binding reads now. */
function ExplorerKey(props: { shortcut: ShortcutId; isMac: boolean }): ReactElement | null {
  const keys = resolveShortcutKeys(props.shortcut);
  if (keys === undefined) return null;
  return (
    <kbd className='inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted/50 px-1 font-sans text-[11px] text-muted-foreground'>
      {formatShortcut(keys, props.isMac)}
    </kbd>
  );
}

/**
 * The page with nothing open in it: the folder, what it holds and the last things to
 * change, any of which opens in a tab, and the keys that walk the explorer. A folder
 * with nothing in it offers the ways to add to it, as the file list does.
 */
function FolderLanding(props: {
  channelId: string;
  folder: { id: string; name: string; icon: string | null };
  parentType: 'TRACK' | 'FOLDER';
  onOpen: (tab: FolderTab) => void;
  onAddItem: (tab: 'artifact' | 'upload' | 'link') => void;
  onNewFolder: () => void;
}): ReactElement | null {
  const { isMac, isMobile } = usePlatform();
  // The explorer's top level holds this same query, so this costs nothing more.
  const [edgeRows, details] = useCachedQuery(
    queries.getSdlcFolderChildren({
      channelId: props.channelId,
      parentType: props.parentType,
      parentId: props.folder.id,
    }),
    { enabled: Boolean(props.channelId && props.folder.id) },
  );
  const items = useMemo(
    () =>
      (Array.isArray(edgeRows) ? edgeRows : []).flatMap(edge => {
        const item = targetItemOf(edge);
        return item ? [item] : [];
      }),
    [edgeRows],
  );
  const files = useMemo(
    () =>
      items
        .filter(
          (item): item is Exclude<SdlcTrackItem, { kind: 'FOLDER' }> => item.kind !== 'FOLDER',
        )
        .sort((left, right) => itemUpdatedAt(right) - itemUpdatedAt(left)),
    [items],
  );

  if (items.length === 0) {
    // Nothing yet, or nothing known yet: an empty folder only once the answer is in.
    if (details.type !== 'complete') return null;
    return (
      <FilesEmptyState
        here={{ type: props.parentType, id: props.folder.id, name: props.folder.name }}
        place='folder-page-empty'
        onNewArtifact={() => props.onAddItem('artifact')}
        onUploadFile={() => props.onAddItem('upload')}
        onAddLink={() => props.onAddItem('link')}
        onNewFolder={props.onNewFolder}
      />
    );
  }

  const folderCount = items.length - files.length;
  const counts = [
    folderCount > 0 && `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`,
    files.length > 0 && `${files.length} ${files.length === 1 ? 'file' : 'files'}`,
  ].filter(Boolean);
  const shown = files.slice(0, LANDING_ITEMS);
  const more = files.length - shown.length;

  return (
    // A third of the way down, as the file list's empty state sits.
    <div className='flex h-full min-h-[320px] flex-col items-center overflow-y-auto px-6 pb-12 pt-[12vh]'>
      <div className='mb-5 grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-muted/40'>
        {props.folder.icon ? (
          <AppIcon
            name={props.folder.icon}
            size={24}
            className='text-muted-foreground'
            aria-hidden='true'
          />
        ) : (
          <FolderOpen className='size-6 text-muted-foreground' aria-hidden='true' />
        )}
      </div>
      <h3 className='max-w-full truncate text-[15px] font-semibold text-foreground'>
        {props.folder.name}
      </h3>
      <p className='mt-1 text-[13px] text-muted-foreground'>
        {counts.join(' · ')}
        {files.length === 0 && ' · open one in the explorer to see inside'}
      </p>

      {shown.length > 0 && (
        <section aria-label='Recently updated' className='mt-8 w-full max-w-[560px]'>
          <h4 className='mb-2 px-1 text-xs font-medium text-muted-foreground'>Recently updated</h4>
          <ul className='overflow-hidden rounded-xl border border-border'>
            {shown.map(item => {
              const node = treeNodeOf(item);
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  className='border-b border-border last:border-b-0'
                >
                  <button
                    type='button'
                    onClick={() => props.onOpen({ kind: item.kind, id: item.id })}
                    className='flex h-11 w-full items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
                    data-track-category='SdlcHub'
                    data-track-name='FolderLandingItemOpened'
                    data-track-metadata={JSON.stringify({ kind: item.kind })}
                  >
                    <NodeIcon node={node} size='size-4' />
                    <span className='min-w-0 flex-1 truncate font-medium text-foreground'>
                      {node.name}
                    </span>
                    <span className='w-[72px] shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
                      {formatUpdated(itemUpdatedAt(item))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <p className='mt-2 px-1 text-xs text-muted-foreground'>{more} more in the explorer</p>
          )}
        </section>
      )}

      {!isMobile && (
        <div className='mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground'>
          <span className='flex items-center gap-1.5'>
            <ExplorerKey shortcut='explorer.up' isMac={isMac} />
            <ExplorerKey shortcut='explorer.down' isMac={isMac} />
            Move
          </span>
          <span className='flex items-center gap-1.5'>
            <ExplorerKey shortcut='explorer.expand' isMac={isMac} />
            Expand
          </span>
          <span className='flex items-center gap-1.5'>
            <ExplorerKey shortcut='explorer.open' isMac={isMac} />
            Open
          </span>
        </div>
      )}
    </div>
  );
}

export function SdlcFolderPage(props: {
  channelId: string;
  liveCallCounts: ReadonlyMap<string, SdlcLiveCalls>;
  folder: { id: string; name: string; icon: string | null };
  /** A track's own page is this page with the track as its root. */
  rootType?: 'TRACK' | 'FOLDER';
  activeTab: FolderTab | null;
  onOpenTab: (tab: FolderTab | null) => void;
  onDiscuss: (item: {
    type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
    id: string;
    name: string;
  }) => void;
  discussingId: string | null;
  onNewFolder: (parent: { id: string; name: string }) => void;
  onAddItem: (tab: 'artifact' | 'upload' | 'link', parent: { id: string; name: string }) => void;
  onMoveItem: (
    item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string },
    parentFolderId: string,
  ) => void;
  /** Renames a folder, artifact, link or uploaded file; a file keeps its extension. */
  onRenameItem: (
    item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string },
    name: string,
  ) => void;
  renderCanvas: (canvasId: string) => ReactElement;
  /** Offers a page the reader browsed to for adding as a link in this folder. */
  onAddLink?: (url: string, title: string) => void;
  /** The strip lives in the page header when there is one, so the top bar is
   *  the tab bar rather than a breadcrumb repeating what the tabs already say. */
  tabsContainer: HTMLElement | null;
  /** The hub sidebar's explorer pane: the tree is drawn there, in the sidebar's place.
   *  Null in a window of its own, which has no hub sidebar: the explorer then stays
   *  beside the page. */
  explorerContainer: HTMLElement | null;
}): ReactElement {
  const tabsByFolder = useUserPreference('sdlcFolderTabs');
  const storedTabs = tabsByFolder[props.folder.id];
  // The items the strip names and the open tab shows, looked up together by the ids
  // the page keeps for its tabs: never the hub's every link and file.
  const openKind = props.activeTab?.kind;
  const openId = props.activeTab?.id;
  const tabRefs = useMemo(() => {
    const open = openKind && openId ? [{ kind: openKind, id: openId }] : [];
    const refs = [...open, ...(storedTabs ?? [])].flatMap(tab =>
      tab.kind === 'BROWSER' ? [] : [{ type: tab.kind, id: tab.id }],
    );
    return refs
      .filter(
        (ref, index) =>
          refs.findIndex(other => other.type === ref.type && other.id === ref.id) === index,
      )
      .slice(0, TAB_LOOKUP_LIMIT);
  }, [storedTabs, openKind, openId]);
  const [tabItemRows] = useCachedQuery(
    queries.getSdlcTrackItems({ channelId: props.channelId, items: tabRefs }),
    { enabled: Boolean(props.channelId) && tabRefs.length > 0 },
  );
  // `KIND:id` -> the folder holding it, for the tabs' items and every folder above
  // them: how the explorer opens the branches down to a tab.
  const parentFolderOf = useMemo(
    () => sdlcParentFolders(tabRefs.length > 0 && Array.isArray(tabItemRows) ? tabItemRows : []),
    [tabRefs.length, tabItemRows],
  );
  // By `KIND:id`.
  const tabItems = useMemo<ReadonlyMap<string, SdlcTrackItem>>(
    () =>
      new Map(
        (tabRefs.length > 0 && Array.isArray(tabItemRows) ? tabItemRows : []).flatMap(row => {
          const item = targetItemOf(row);
          return item ? [[tabKey(item), item] as const] : [];
        }),
      ),
    [tabRefs.length, tabItemRows],
  );
  const tabs = useMemo<FolderTab[]>(() => {
    const stored = storedTabs ?? [];
    // Items get deleted; the stored tab list does not hear about it. Dropping
    // the ones that no longer resolve keeps ghosts labelled 'Link' out of the
    // strip. The open tab is the exception: a row that has not replicated yet —
    // a just-created artifact, a link opened from a shared url — is on screen,
    // and filtering it out would leave the effect below adding it to a list
    // that drops it again on every render.
    const open = props.activeTab;
    return stored.filter(
      tab =>
        (open && tab.kind === open.kind && tab.id === open.id) ||
        tab.kind === 'BROWSER' ||
        tabItems.has(tabKey(tab)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedTabs, tabItems, props.activeTab?.kind, props.activeTab?.id]);
  // What each page-holding tab is on: its title, icon and loading, for the strip.
  const embeddedPages = useEmbeddedPages();
  /**
   * Where the original browsing tab opens when it has no page of its own: the tab
   * Xyne AI asks for (requestSdlcBrowser, `browse=1`), which must hold a live page
   * the moment it opens for the agent to drive — not the start page new tabs show.
   */
  const homePage = useUserPreference('sdlcBrowserHomePage');
  /**
   * A browsing tab opened at an address — a link a page opened in a new window —
   * before the stored list has caught up with it: the url changes first, and the
   * tab joins the strip from there without its address.
   */
  const browseStartsRef = useRef(new Map<string, string>());
  const [dragging, setDragging] = useState<{
    type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
    id: string;
  } | null>(null);
  const [tabListOpen, setTabListOpen] = useState(false);
  const treeRef = useRef<HTMLDivElement | null>(null);
  // The tree as an element in state too: it is drawn into the sidebar, so it can
  // arrive after this page does, and the pinned stack watches it.
  const [treeElement, setTreeElement] = useState<HTMLDivElement | null>(null);
  const attachTree = useCallback((node: HTMLDivElement | null) => {
    treeRef.current = node;
    setTreeElement(node);
  }, []);
  const [pinnedFolders, setPinnedFolders] = useState<PinnedFolder[]>([]);
  useEffect(() => {
    if (!treeElement) return;
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = pinnedFoldersIn(treeElement);
        setPinnedFolders(current => (samePinned(current, next) ? current : next));
      });
    };
    measure();
    treeElement.addEventListener('scroll', measure, { passive: true });
    // Folders opening, closing and filling in change what is under the stack.
    const resize = new ResizeObserver(measure);
    resize.observe(treeElement);
    // A pinned folder renamed or given an icon is drawn again from its row.
    const renamed = new MutationObserver(measure);
    renamed.observe(treeElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-explorer-name', 'data-explorer-icon'],
    });
    if (treeElement.firstElementChild) resize.observe(treeElement.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      treeElement.removeEventListener('scroll', measure);
      resize.disconnect();
      renamed.disconnect();
    };
  }, [treeElement]);
  // Where the stack ends: the tree is hidden above it, so the rows it covers don't
  // show through the sidebar's glass, which has nothing solid to cover them with.
  const stackBottom = pinnedFolders.reduce(
    (bottom, folder) => Math.max(bottom, folder.top + TREE_ROW_HEIGHT),
    0,
  );
  const revealFolder = (id: string): void => {
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-explorer-row="${id}"]`)
      ?.scrollIntoView({ block: 'start' });
  };
  const [treeFocused, setTreeFocused] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const expandedFolders = useUserPreference('sdlcFolderTreeExpanded');
  const explorerCollapsed = useUserPreference('sdlcExplorerCollapsed');

  useScope('sdlc-explorer', treeFocused);

  // The visible rows are whatever is on screen, so the DOM is the list: it is
  // already in the order the reader sees, and it cannot disagree with which
  // branches happen to be open.
  const rows = (): HTMLElement[] =>
    Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-explorer-row]') ?? []);

  const moveCursor = (delta: number): void => {
    const all = rows();
    if (all.length === 0) return;
    const at = all.findIndex(row => row.dataset['explorerRow'] === cursorId);
    const next = all[Math.min(all.length - 1, Math.max(0, (at === -1 ? -1 : at) + delta))];
    if (!next) return;
    setCursorId(next.dataset['explorerRow'] ?? null);
    next.scrollIntoView({ block: 'nearest' });
  };

  const cursorRow = (): HTMLElement | null =>
    rows().find(row => row.dataset['explorerRow'] === cursorId) ?? null;

  const setFolderOpen = (id: string, open: boolean): void => {
    setUserPreference('sdlcFolderTreeExpanded', withFolderEntry(expandedFolders, id, open));
  };

  // ── Renaming, and the right-click menu ──
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    node: TreeNode;
    x: number;
    y: number;
    open: boolean;
  } | null>(null);
  // ── Cut and paste: a move, as dragging is, from the menu or ⌘X and ⌘V ──
  const [clipboard, setClipboard] = useState<
    { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string; name: string }[]
  >([]);
  const cutIds = useMemo(() => new Set(clipboard.map(item => item.id)), [clipboard]);
  const cut = (node: TreeNode): void => {
    if (node.id === props.folder.id) return;
    setClipboard([{ type: node.kind, id: node.id, name: node.name }]);
  };
  /** The folder a row sits in, from the rows' own boxes. */
  const folderHolding = (id: string): string | null => {
    const box = treeRef.current?.querySelector<HTMLElement>(`[data-explorer-node="${id}"]`);
    return (
      box?.parentElement?.closest<HTMLElement>('[data-explorer-node]')?.dataset['explorerNode'] ??
      null
    );
  };
  /** Why what is cut can't go into this folder: a folder into itself, or below itself. */
  const pasteBlocked = (folderId: string): string | null => {
    for (const item of clipboard) {
      if (item.type !== 'FOLDER') continue;
      const box = treeRef.current?.querySelector(`[data-explorer-node="${item.id}"]`);
      const target = treeRef.current?.querySelector(`[data-explorer-node="${folderId}"]`);
      if (item.id === folderId || (box && target && box.contains(target))) {
        return `${item.name} can't go inside itself`;
      }
    }
    return null;
  };
  const paste = (folderId: string): void => {
    if (clipboard.length === 0 || pasteBlocked(folderId)) return;
    for (const item of clipboard) {
      if (folderHolding(item.id) !== folderId) props.onMoveItem(item, folderId);
    }
    setClipboard([]);
    setFolderOpen(folderId, true);
  };

  /** Everything renames but a track's own root row: a track is renamed as a track. */
  const canRename = (id: string): boolean =>
    !(props.rootType === 'TRACK' && id === props.folder.id);
  const startRename = (id: string): void => {
    if (canRename(id)) setRenamingId(id);
  };

  const bind = { enabled: treeFocused && renamingId === null };
  useShortcutById(
    'explorer.rename',
    () => {
      if (cursorId) startRename(cursorId);
    },
    bind,
  );
  useShortcutById(
    'explorer.cut',
    () => {
      const row = cursorRow();
      const id = row?.dataset['explorerRow'];
      const kind = row?.dataset['explorerKind'];
      if (!row || !id || !isTreeKind(kind) || id === props.folder.id) return;
      setClipboard([{ type: kind, id, name: row.textContent?.trim() ?? '' }]);
    },
    bind,
  );
  useShortcutById(
    'explorer.paste',
    () => {
      const row = cursorRow();
      // Into the folder the keyboard is on, else the page's own.
      paste(
        row?.dataset['explorerKind'] === 'FOLDER' ? (cursorId ?? props.folder.id) : props.folder.id,
      );
    },
    { enabled: bind.enabled && clipboard.length > 0 },
  );
  useShortcutById('explorer.cancelCut', () => setClipboard([]), {
    enabled: bind.enabled && clipboard.length > 0,
  });
  useShortcutById('explorer.down', () => moveCursor(1), bind);
  useShortcutById('explorer.up', () => moveCursor(-1), bind);
  useShortcutById(
    'explorer.expand',
    () => {
      const row = cursorRow();
      if (!row || row.dataset['explorerKind'] !== 'FOLDER') return;
      // Already open: the next row is what is inside it.
      if (row.dataset['explorerOpen'] === 'true') moveCursor(1);
      else setFolderOpen(row.dataset['explorerRow'] ?? '', true);
    },
    bind,
  );
  useShortcutById(
    'explorer.collapse',
    () => {
      const row = cursorRow();
      if (!row) return;
      if (row.dataset['explorerKind'] === 'FOLDER' && row.dataset['explorerOpen'] === 'true') {
        setFolderOpen(row.dataset['explorerRow'] ?? '', false);
        return;
      }
      moveCursor(-1);
    },
    bind,
  );
  useShortcutById(
    'explorer.open',
    () => {
      const row = cursorRow();
      const id = row?.dataset['explorerRow'];
      const kind = row?.dataset['explorerKind'];
      if (!row || !id || !kind) return;
      if (kind === 'FOLDER') {
        setFolderOpen(id, row.dataset['explorerOpen'] !== 'true');
        return;
      }
      openTab({ kind: kind as FolderTabKind, id });
    },
    bind,
  );

  const setTabs = (next: FolderTab[]): void => {
    setUserPreference('sdlcFolderTabs', withFolderEntry(tabsByFolder, props.folder.id, next));
  };

  // A link into a folder names one item; it joins the strip so the tab bar and
  // the address bar never disagree about what is open.
  const active = props.activeTab;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedBlock | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<{ quote: string; selector?: string } | null>(null);
  const [viewerRoot, setViewerRoot] = useState<HTMLDivElement | null>(null);
  const activeItem = useMemo(
    () =>
      active
        ? tabItem(
            active,
            tabItems.get(tabKey(active)),
            active.kind === 'BROWSER'
              ? (tabs.find(tab => tab.kind === 'BROWSER' && tab.id === active.id)?.url ??
                  browseStartsRef.current.get(active.id) ??
                  (active.id === SCRATCH_TAB_ID ? homePage : undefined))
              : undefined,
          )
        : null,
    [active, tabItems, tabs, homePage],
  );
  // A browsing tab is ad-hoc browsing, not an item of the hub: it has no entity of its
  // own to hold a comment, and the old one's id is every folder's, so a comment left
  // there would show in every other folder's.
  const canComment = Boolean(
    activeItem && active?.kind !== 'BROWSER' && commentStoreFor(activeItem),
  );

  useEffect(
    () =>
      onCommentsRequested(request => {
        if (!activeItem || request.itemId !== activeItem.id) return;
        setCommentsOpen(true);
        setFocusCommentId(request.commentId ?? null);
      }),
    [activeItem],
  );

  // Tell the agent what the reader is looking at, so a question about "this
  // page" is answered from the tabs rather than from the route name.
  useEffect(() => {
    publishOpenItems({
      container: props.folder.name,
      placement: {
        channelId: props.channelId,
        folderId: props.folder.id,
        folderName: props.folder.name,
      },
      items: tabs.flatMap(tab => {
        const item = tabItem(tab, tabItems.get(tabKey(tab)));
        if (!item) return [];
        return [
          {
            title: item.title,
            kind: tab.kind,
            ...(item.url ? { url: item.url } : {}),
            ...(active?.kind === tab.kind && active.id === tab.id ? { active: true } : {}),
          },
        ];
      }),
    });
    return () => publishOpenItems(null);
  }, [tabs, active, props.folder.id, props.folder.name, props.channelId, tabItems]);

  const openThread = (commentId: string): void => {
    setCommentsOpen(true);
    setFocusCommentId(commentId);
  };

  // A browsed page is held by the host over a hole in this frame, so it is
  // reached through the bridge; everything else renders here and is reached
  // directly. The annotator above does not know which it got.
  const browsing = active?.kind === 'BROWSER' || active?.kind === 'LINK';
  const domTransport = useDomTransport(browsing ? null : viewerRoot, {
    onPick: setPicked,
    onMarkClick: openThread,
  });
  // A browsed page is drawn by the host ON TOP of this frame, so a box rendered
  // here would sit behind it. The picked passage goes to the comments panel
  // beside the page instead, which is the one place we can draw next to it.
  const notePickedRef = useRef<() => void>(() => undefined);
  const bridgeTransport = useBridgeTransport(browsing && canHostEmbedPages(), {
    onPick: block => {
      setDraftAnchor({
        quote: block.text,
        ...(block.selector ? { selector: block.selector } : {}),
      });
      setCommentsOpen(true);
      notePickedRef.current();
    },
    onMarkClick: openThread,
  });

  const annotate = useAnnotate({
    item: activeItem ?? EMPTY_ITEM,
    url: activeItem?.url ?? '',
    transport: browsing ? bridgeTransport : domTransport,
    picked: browsing ? null : picked,
    onPicked: setPicked,
  });
  notePickedRef.current = annotate.notePicked;
  /** The tab closed here, ignored for as long as the url still names it. */
  const closedRef = useRef<string | null>(null);

  /** Opening is the answer to having closed it, so it forgets the closure. */
  const openTab = (tab: FolderTab | null): void => {
    closedRef.current = null;
    props.onOpenTab(tab);
  };

  // The folders from the open tab's item up to the page's own, which arrive with the
  // tab's lookup — often after the tab opens.
  const activeChain = useMemo(() => {
    const chain: string[] = [];
    if (!openKind || !openId) return chain;
    let key = `${openKind}:${openId}`;
    // Bounded: a cycle in the edges would otherwise spin here forever.
    for (let step = 0; step < 32; step += 1) {
      const parent = parentFolderOf.get(key);
      if (!parent) break;
      chain.push(parent);
      if (parent === props.folder.id) break;
      key = `FOLDER:${parent}`;
    }
    return chain;
  }, [openKind, openId, parentFolderOf, props.folder.id]);
  const activeChainKey = activeChain.join('/');

  // Opening a tab for something filed deeper down should show it where it
  // lives, not leave the reader looking at a closed branch.
  useEffect(() => {
    if (!active) return undefined;
    const chain = activeChain;

    const shut = chain.filter(id => expandedFolders[id] !== true);
    if (shut.length > 0) {
      setUserPreference('sdlcFolderTreeExpanded', {
        ...expandedFolders,
        ...Object.fromEntries(shut.map(id => [id, true])),
      });
    }

    // The row only exists once those branches have rendered their children,
    // which takes a query each; look for it over a few frames rather than once.
    let frames = 0;
    let raf = 0;
    const reveal = (): void => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-explorer-row="${active.id}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (frames < 30) {
        frames += 1;
        raf = requestAnimationFrame(reveal);
      }
    };
    raf = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, active?.id, activeChainKey]);

  useEffect(() => {
    if (!active) {
      closedRef.current = null;
      return;
    }
    // Still the tab that was just closed: its navigation has not landed yet.
    if (closedRef.current === `${active.kind}:${active.id}`) return;
    // The url names something else, so the closure is spent. Reaching that tab
    // again — the back button, a url someone re-shares — has to put it back.
    closedRef.current = null;
    // Added to the tabs as kept, not as shown: those whose items are still on their
    // way would otherwise be dropped with it.
    const stored = storedTabs ?? [];
    if (stored.some(tab => tab.kind === active.kind && tab.id === active.id)) return;
    setTabs([...stored, active]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, active?.id, storedTabs]);

  /**
   * The strip scrolls; the browsing button does not. It sits at the end of the
   * bar in the page's own header — the centre pane — so opening the
   * conversation panel never carries it off to the other side.
   */
  const renderTabStrip = (strip: ReactElement): ReactElement => {
    const canBrowse = canHostEmbedPages();
    const bar = (
      <>
        {strip}
        <div className='ml-auto flex shrink-0 items-center gap-1 pl-3'>
          <span aria-hidden='true' className='mr-1 h-5 w-px bg-border' />
          {canBrowse && (
            <button
              type='button'
              title='New browsing tab — look things up without saving them'
              aria-label='New browsing tab'
              onClick={openBrowsingTab}
              className='outline-none flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='ScratchBrowserOpened'
            >
              <Globe className='size-4' />
            </button>
          )}
          {/* Comments on the open tab: one toggle, which also puts the panel away.
              Pointing at a passage to comment on it comes beside it while they show. */}
          {canComment && commentsOpen && annotate.toggle}
          {canComment && (
            <button
              type='button'
              title={commentsOpen ? 'Hide comments' : 'Comments'}
              aria-label='Comments'
              aria-pressed={commentsOpen}
              onClick={() =>
                setCommentsOpen(open => {
                  if (open) setDraftAnchor(null);
                  return !open;
                })
              }
              className={cn(
                'outline-none flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                commentsOpen
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground',
              )}
              data-track-category='SdlcHub'
              data-track-name='FolderCommentsToggled'
            >
              <MessageSquare className='size-4' />
            </button>
          )}
          {/* Every open tab in one list, findable by name or site: the strip only shows
              what fits. ⌘P opens it from anywhere in the folder. */}
          <Tooltip content='All open tabs (⌘P)' delayDuration={TOOLTIP_DELAY_MS}>
            <button
              type='button'
              aria-label='All open tabs'
              aria-keyshortcuts='Meta+P'
              onClick={() => setTabListOpen(true)}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
                tabListOpen
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08] focus-visible:text-foreground',
              )}
              data-track-category='SdlcHub'
              data-track-name='FolderTabListOpened'
            >
              <ChevronDown className='size-4' />
            </button>
          </Tooltip>
          <TabSwitcher
            open={tabListOpen}
            onOpenChange={setTabListOpen}
            // What is saved in the folder first, then pages only being browsed.
            entries={[...tabs]
              .sort((a, b) => Number(a.kind === 'BROWSER') - Number(b.kind === 'BROWSER'))
              .map((tab): TabSwitcherEntry => {
                const item = tabItems.get(tabKey(tab));
                const page = embeddedPages.get(pageKeyOf(props.folder.id, tab));
                const saved = tab.kind !== 'BROWSER';
                const url = page?.url || (item?.kind === 'LINK' ? item.url : tab.url) || '';
                const detail =
                  tab.kind === 'LINK' || tab.kind === 'BROWSER'
                    ? hostOf(url)
                    : tab.kind === 'CANVAS'
                      ? 'Artifact'
                      : item?.kind === 'ATTACHMENT'
                        ? fileKind(item.mimetype, item.name).label
                        : 'File';
                return {
                  key: tabKey(tab),
                  name: tabName(tab, item, page),
                  detail: saved ? detail : `Not saved${detail ? ` · ${detail}` : ''}`,
                  icon: <TabIcon folderId={props.folder.id} tab={tab} item={item} />,
                  group: saved ? 'Saved in this folder' : 'Browsing · not saved',
                  current: Boolean(active && active.kind === tab.kind && active.id === tab.id),
                  ...(!saved && /^https?:/.test(url) && { saveUrl: url }),
                };
              })}
            onOpen={key => {
              const tab = tabs.find(candidate => tabKey(candidate) === key);
              if (tab) openTab(tab);
            }}
            onClose={key => {
              const tab = tabs.find(candidate => tabKey(candidate) === key);
              if (tab) closeTab(tab);
            }}
            onCloseAll={closeAllTabs}
            {...(props.onAddLink ? { onSave: props.onAddLink } : {})}
            where='anywhere in a folder'
            trackCategory='SdlcHub'
          />
        </div>
      </>
    );
    return props.tabsContainer ? (
      createPortal(bar, props.tabsContainer)
    ) : (
      <div className='flex h-11 shrink-0 items-center border-b border-border px-2'>{bar}</div>
    );
  };

  const reorderTabs = (fromKey: string, toKey: string): void => {
    const from = tabs.findIndex(tab => tabKey(tab) === fromKey);
    const to = tabs.findIndex(tab => tabKey(tab) === toKey);
    if (from < 0 || to < 0) return;
    setTabs(arrayMove(tabs, from, to));
  };

  /** The tab beside the open one, wrapping round: ⌃Tab and ⌃⇧Tab, as in a browser. */
  const stepTab = (by: 1 | -1): void => {
    if (tabs.length === 0) return;
    const index = active
      ? tabs.findIndex(tab => tab.kind === active.kind && tab.id === active.id)
      : -1;
    const next = tabs[(index + by + tabs.length) % tabs.length];
    if (next) openTab(next);
  };
  const stepTabRef = useRef(stepTab);
  stepTabRef.current = stepTab;
  useShortcutById('browser.nextTab', () => stepTabRef.current(1), { scope: 'global' });
  useShortcutById('browser.previousTab', () => stepTabRef.current(-1), { scope: 'global' });

  const closeAllTabs = (): void => {
    setTabListOpen(false);
    tabs.forEach(tab => discardEmbeddedPage(pageKeyOf(props.folder.id, tab)));
    setTabs([]);
    if (!active) return;
    // Not openTab: that forgets the closure, and until the url catches up it still
    // names the open tab, which would come straight back.
    closedRef.current = `${active.kind}:${active.id}`;
    props.onOpenTab(null);
  };

  const closeTab = (tab: FolderTab): void => {
    const index = tabs.findIndex(item => item.kind === tab.kind && item.id === tab.id);
    const remaining = tabs.filter(item => !(item.kind === tab.kind && item.id === tab.id));
    // Closing the open tab also navigates away from it, and that lands a beat
    // later. Until it does, the url still names this tab, and the effect that
    // keeps the open tab in the strip would put it straight back — which read
    // as the first click doing nothing.
    closedRef.current = `${tab.kind}:${tab.id}`;
    discardEmbeddedPage(pageKeyOf(props.folder.id, tab));
    setTabs(remaining);
    if (active && active.kind === tab.kind && active.id === tab.id) {
      // The one that takes its place, else the one before it — through onOpenTab, not
      // openTab, which would forget the closure before the url has caught up.
      props.onOpenTab(remaining[index] ?? remaining[index - 1] ?? null);
    }
  };

  /** A browsing tab, after the one it came from or at the end; open, with its address. */
  const addBrowsingTab = (url?: string, after?: string): void => {
    const tab: FolderTab = { kind: 'BROWSER', id: newBrowsingTabId(), ...(url && { url }) };
    if (url) browseStartsRef.current.set(tab.id, url);
    // Built on what is saved this moment, not this render's list: two pages opening
    // windows at once would otherwise each add to the same list, and one be lost.
    const saved = userPreferencesSnapshot().sdlcFolderTabs[props.folder.id] ?? tabs;
    const at = after ? saved.findIndex(candidate => tabKey(candidate) === after) : -1;
    const next =
      at < 0 ? [...saved, tab] : [...saved.slice(0, at + 1), tab, ...saved.slice(at + 1)];
    setUserPreference(
      'sdlcFolderTabs',
      withFolderEntry(userPreferencesSnapshot().sdlcFolderTabs, props.folder.id, next),
    );
    openTab(tab);
  };
  const openBrowsingTab = (): void => {
    const waiting = tabs.find(tab => tab.kind === 'BROWSER' && !tab.url);
    if (waiting) openTab(waiting);
    else addBrowsingTab();
  };

  // A page opening a new window — a link to a new tab, a popup — opens a tab beside it.
  const addBrowsingTabRef = useRef(addBrowsingTab);
  addBrowsingTabRef.current = addBrowsingTab;
  useEffect(() => subscribeToEmbeddedOpen((url, from) => addBrowsingTabRef.current(url, from)), []);

  // A browsing tab keeps the page it is on, and its title, so it reopens there and is
  // named right before the page loads again. Written once the page settles, not on
  // every step of a redirect.
  useEffect(() => {
    const stored = storedTabs ?? [];
    const changed = stored.flatMap(tab => {
      if (tab.kind !== 'BROWSER') return [];
      const page = embeddedPages.get(pageKeyOf(props.folder.id, tab));
      if (!page || page.loading || !/^https?:/.test(page.url)) return [];
      return page.url !== tab.url ||
        (page.title && page.title !== tab.title) ||
        (page.favicon && page.favicon !== tab.favicon)
        ? [tab.id]
        : [];
    });
    if (changed.length === 0) return;
    const timer = window.setTimeout(() => {
      setTabs(
        stored.map(tab => {
          const page = changed.includes(tab.id)
            ? embeddedPages.get(pageKeyOf(props.folder.id, tab))
            : undefined;
          return page
            ? {
                ...tab,
                url: page.url,
                ...(page.title && { title: page.title }),
                ...(page.favicon && { favicon: page.favicon }),
              }
            : tab;
        }),
      );
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddedPages, storedTabs]);

  /** Where a browsing tab is: its page, its address before the list caught up, the
   *  original tab's home page, or nothing yet. */
  const browseUrlOf = (tab: FolderTab): string | undefined =>
    tab.kind === 'BROWSER'
      ? (tabs.find(candidate => candidate.kind === 'BROWSER' && candidate.id === tab.id)?.url ??
        browseStartsRef.current.get(tab.id) ??
        (tab.id === SCRATCH_TAB_ID ? homePage : undefined))
      : undefined;

  useShortcutById('folder.tabs', () => setTabListOpen(open => !open));
  const openBrowsingTabRef = useRef(openBrowsingTab);
  openBrowsingTabRef.current = openBrowsingTab;
  useShortcutById('folder.newBrowsingTab', () => openBrowsingTabRef.current());
  useEffect(
    () =>
      subscribeToEmbeddedCommand((_key, command) => {
        if (command === 'newTab') openBrowsingTabRef.current();
        // ⌘P pressed in a page, which had the keyboard: the folder's tabs, as anywhere.
        else if (command === 'tabs') setTabListOpen(true);
        else if (command === 'nextTab') stepTabRef.current(1);
        else if (command === 'previousTab') stepTabRef.current(-1);
      }),
    [],
  );

  // The folder's tree. Beside a hub sidebar it takes the sidebar's place; in a window
  // of its own it keeps a panel beside the page.
  /** What a right-clicked row can do: what it is, then its conversations and name. */
  // A function rather than a component: one defined in render is a new component
  // each time, and the open menu would be remounted under the pointer.
  const rowMenuItems = (node: TreeNode): ReactElement => {
    const parent = { id: node.id, name: node.name };
    const tabKind = node.kind === 'FOLDER' ? null : node.kind;
    const item = (
      label: string,
      icon: ReactElement,
      run: () => void,
      trackName: string,
    ): ReactElement => (
      <DropdownMenuItem
        onSelect={run}
        className='gap-2 rounded-md px-2.5 py-1.5 text-[13px]'
        data-track-category='SdlcHub'
        data-track-name={trackName}
      >
        {icon}
        {label}
      </DropdownMenuItem>
    );
    const iconClass = 'size-4 text-muted-foreground';
    return (
      <>
        {node.kind === 'FOLDER' ? (
          <>
            {item(
              'New artifact',
              <FileText className={iconClass} />,
              () => props.onAddItem('artifact', parent),
              'ExplorerMenuNewArtifact',
            )}
            {item(
              'Upload file',
              <Upload className={iconClass} />,
              () => props.onAddItem('upload', parent),
              'ExplorerMenuUpload',
            )}
            {item(
              'Add link',
              <Link2 className={iconClass} />,
              () => props.onAddItem('link', parent),
              'ExplorerMenuAddLink',
            )}
            {item(
              'New folder',
              <FolderPlus className={iconClass} />,
              () => props.onNewFolder(parent),
              'ExplorerMenuNewFolder',
            )}
          </>
        ) : (
          <>
            {tabKind &&
              item(
                'Open',
                <FolderOpen className={iconClass} />,
                () => openTab({ kind: tabKind, id: node.id }),
                'ExplorerMenuOpen',
              )}
            {node.kind === 'ATTACHMENT' &&
              item(
                'Download',
                <Download className={iconClass} />,
                () => void downloadFile(node.id, node.name),
                'ExplorerMenuDownload',
              )}
          </>
        )}
        <DropdownMenuSeparator />
        {node.id !== props.folder.id &&
          item('Cut', <Scissors className={iconClass} />, () => cut(node), 'ExplorerMenuCut')}
        {node.kind === 'FOLDER' && clipboard.length > 0 && (
          <DropdownMenuItem
            disabled={pasteBlocked(node.id) !== null}
            onSelect={() => paste(node.id)}
            title={pasteBlocked(node.id) ?? undefined}
            className='gap-2 rounded-md px-2.5 py-1.5 text-[13px]'
            data-track-category='SdlcHub'
            data-track-name='ExplorerMenuPaste'
          >
            <ClipboardPaste className={iconClass} />
            {`Paste ${clipboard.length === 1 ? (clipboard[0]?.name ?? 'item') : `${clipboard.length} items`}`}
          </DropdownMenuItem>
        )}
        {item(
          'Conversations',
          <MessageCircle className={iconClass} />,
          () => props.onDiscuss({ type: node.kind, id: node.id, name: node.name }),
          'ExplorerMenuDiscuss',
        )}
        {canRename(node.id) &&
          item(
            'Rename',
            <Pencil className={iconClass} />,
            () => startRename(node.id),
            'ExplorerMenuRename',
          )}
      </>
    );
  };

  const tree = (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        !props.explorerContainer && explorerCollapsed && 'hidden',
      )}
    >
      <div
        ref={attachTree}
        tabIndex={0}
        role='tree'
        aria-label='Explorer'
        onFocus={() => setTreeFocused(true)}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setTreeFocused(false);
          }
        }}
        className='scrollbar-none min-h-0 flex-1 overflow-y-auto py-1.5 outline-none'
        style={
          stackBottom > 0
            ? {
                maskImage: `linear-gradient(to bottom, transparent ${stackBottom}px, black ${stackBottom}px)`,
                WebkitMaskImage: `linear-gradient(to bottom, transparent ${stackBottom}px, black ${stackBottom}px)`,
              }
            : undefined
        }
      >
        {/* The folder you opened is the tree's first row, not a title above
          it: it expands, takes new items and carries conversations exactly
          as the folders beneath it do. */}
        <TreeRow
          node={{
            kind: 'FOLDER',
            id: props.folder.id,
            name: props.folder.name,
            favicon: null,
            fileKind: null,
            folderIcon: props.folder.icon,
          }}
          depth={0}
          defaultExpanded
          childrenParentType={props.rootType ?? 'FOLDER'}
          channelId={props.channelId}
          liveCallCounts={props.liveCallCounts}
          activeTab={active}
          onOpen={openTab}
          onDiscuss={props.onDiscuss}
          discussingId={props.discussingId}
          onNewFolder={props.onNewFolder}
          onAddItem={props.onAddItem}
          cursorId={treeFocused ? cursorId : null}
          onMoveItem={props.onMoveItem}
          dragging={dragging}
          onDrag={setDragging}
          renamingId={renamingId}
          onRenameDone={() => {
            setRenamingId(null);
            treeRef.current?.focus();
          }}
          onRenameItem={props.onRenameItem}
          onRowMenu={(node, at) => setRowMenu({ node, ...at, open: true })}
          cutIds={cutIds}
        />
      </div>
      {pinnedFolders.length > 0 && (
        // The pinned folders, over the tree: each in its own row's height, so one
        // pushed up slides out of its place rather than over the folder above it.
        <div
          className='pointer-events-none absolute inset-x-0 top-0'
          style={{ height: stackBottom }}
          // It sits over the tree, not in it: a wheel here still scrolls the tree.
          onWheel={event => treeRef.current?.scrollBy({ top: event.deltaY })}
        >
          {pinnedFolders.map(folder => (
            <div
              key={folder.id}
              className='absolute inset-x-0 overflow-hidden'
              style={{ top: folder.depth * TREE_ROW_HEIGHT, height: TREE_ROW_HEIGHT }}
            >
              <button
                type='button'
                tabIndex={-1}
                title={`Show ${folder.name} in the explorer`}
                onClick={() => revealFolder(folder.id)}
                className='pointer-events-auto flex h-9 w-full items-center gap-2 rounded-[10px] border border-transparent pr-1.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                style={{
                  paddingLeft: 8 + folder.depth * 16,
                  transform: `translateY(${folder.top - folder.depth * TREE_ROW_HEIGHT}px)`,
                }}
                data-track-category='SdlcHub'
                data-track-name='ExplorerPinnedFolderRevealed'
              >
                <ChevronRight className='size-3.5 shrink-0 rotate-90 text-sidebar-foreground/60' />
                {folder.icon ? (
                  <AppIcon name={folder.icon} size={16} className='shrink-0' aria-hidden='true' />
                ) : (
                  <Folder className='size-4 shrink-0' />
                )}
                <span className='min-w-0 flex-1 truncate'>{folder.name}</span>
                <ActivityPill
                  live={ownCallsOnly(props.liveCallCounts.get(folder.id))}
                  place={folder.name}
                  size='sm'
                  className='mr-1'
                />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Where the stack ends and the scrolling list begins: a hint, not a bar. Always
        here, so it fades in as a folder pins and out as the last one lets go — where
        the stack was, mostly the top folder alone, rather than jumping to the top. */}
      <div
        aria-hidden='true'
        className={cn(
          'pointer-events-none absolute inset-x-0 h-2 bg-gradient-to-b from-black/[0.12] to-transparent transition-opacity duration-300 ease-out motion-reduce:transition-none',
          pinnedFolders.length > 0 ? 'opacity-100' : 'opacity-0',
        )}
        style={{ top: stackBottom > 0 ? stackBottom : TREE_ROW_HEIGHT }}
      />
      {/* A row's right-click menu, opened where the pointer is. */}
      <DropdownMenu
        open={rowMenu?.open ?? false}
        onOpenChange={open => {
          if (!open) setRowMenu(menu => menu && { ...menu, open: false });
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden='true'
            className='pointer-events-none fixed size-0'
            style={{ left: rowMenu?.x ?? 0, top: rowMenu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          sideOffset={2}
          className='w-52'
          onCloseAutoFocus={event => event.preventDefault()}
        >
          {rowMenu && rowMenuItems(rowMenu.node)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className='flex min-h-0 flex-1'>
      {props.explorerContainer ? (
        createPortal(tree, props.explorerContainer)
      ) : (
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-border bg-sidebar/40 transition-[width]',
            explorerCollapsed ? 'w-[38px]' : 'w-[250px]',
          )}
        >
          <div
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b border-border py-2',
              explorerCollapsed ? 'justify-center px-1' : 'px-3',
            )}
          >
            {/* Leads, for the same reason the hub sidebar's does. */}
            <button
              type='button'
              title={explorerCollapsed ? 'Show explorer' : 'Hide explorer'}
              aria-label={explorerCollapsed ? 'Show explorer' : 'Hide explorer'}
              aria-expanded={!explorerCollapsed}
              onClick={() => setUserPreference('sdlcExplorerCollapsed', !explorerCollapsed)}
              className='outline-none -ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='ExplorerCollapsed'
            >
              <PanelLeft className='size-3.5' />
            </button>
            {!explorerCollapsed && (
              <span className='min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground'>
                Explorer
              </span>
            )}
          </div>
          {tree}
        </aside>
      )}

      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {tabs.length > 0 &&
          renderTabStrip(
            <TabStrip
              tabs={tabs.map(tab => {
                const item = tabItems.get(tabKey(tab));
                const page = embeddedPages.get(pageKeyOf(props.folder.id, tab));
                return {
                  key: tabKey(tab),
                  name: tabName(tab, item, page),
                  tooltip: tabTooltip(tab, item, page),
                  icon: <TabIcon folderId={props.folder.id} tab={tab} item={item} />,
                };
              })}
              activeKey={active ? tabKey(active) : null}
              onSelect={key => {
                const tab = tabs.find(candidate => tabKey(candidate) === key);
                if (tab) openTab(tab);
              }}
              onClose={key => {
                const tab = tabs.find(candidate => tabKey(candidate) === key);
                if (tab) closeTab(tab);
              }}
              onReorder={reorderTabs}
              label='Open files'
              onPointerEnter={reclaimHostFocus}
              trackCategory='SdlcHub'
              trackNames={{ select: 'FolderTabSelected', close: 'FolderTabClosed' }}
            />,
          )}

        <div className='flex min-h-0 flex-1 overflow-hidden bg-background'>
          {active ? (
            <>
              <div ref={setViewerRoot} className='relative min-h-0 min-w-0 flex-1 overflow-hidden'>
                <TabContent
                  tab={active}
                  item={tabItems.get(tabKey(active))}
                  browseUrl={browseUrlOf(active)}
                  renderCanvas={props.renderCanvas}
                  {...(props.onAddLink ? { onAddLink: props.onAddLink } : {})}
                  onBrowse={url => {
                    browseStartsRef.current.set(active.id, url);
                    setTabs(
                      tabs.some(tab => tab.kind === 'BROWSER' && tab.id === active.id)
                        ? tabs.map(tab =>
                            tab.kind === 'BROWSER' && tab.id === active.id ? { ...tab, url } : tab,
                          )
                        : [...tabs, { ...active, url }],
                    );
                  }}
                  onOpen={openTab}
                  channelId={props.channelId}
                  parentType={props.rootType ?? 'FOLDER'}
                  folderId={props.folder.id}
                  folderName={props.folder.name}
                  homePage={homePage}
                  browsing={tabs.filter(
                    tab =>
                      tab.kind === 'BROWSER' &&
                      Boolean(tab.url) &&
                      !(active.kind === 'BROWSER' && tab.id === active.id),
                  )}
                />
                {annotate.box}
              </div>
              {commentsOpen && activeItem ? (
                <CommentsPanel
                  item={activeItem}
                  focusCommentId={focusCommentId}
                  draftAnchor={draftAnchor}
                  onJump={comment => revealAnchor(activeItem.id, comment.anchor)}
                />
              ) : null}
            </>
          ) : (
            // The pane is a row, for the viewer and its comments: this takes all of it.
            <div className='min-h-0 min-w-0 flex-1'>
              <FolderLanding
                channelId={props.channelId}
                folder={props.folder}
                parentType={props.rootType ?? 'FOLDER'}
                onOpen={openTab}
                onAddItem={tab => props.onAddItem(tab, props.folder)}
                onNewFolder={() => props.onNewFolder(props.folder)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Stands in while no tab is open, so the annotate hook keeps a stable shape. */
const EMPTY_ITEM: WorkspaceItem = {
  id: '',
  kind: 'file',
  title: '',
  source: 'sdlc-item',
  origin: 'source',
  refId: '',
  row: {},
};

function tabItem(
  tab: FolderTab,
  item: SdlcTrackItem | undefined,
  browseUrl?: string,
): WorkspaceItem | null {
  if (tab.kind === 'BROWSER') {
    return itemFromSdlc({
      id: tab.id,
      title: tab.title || 'New tab',
      kind: 'BROWSER',
      url: browseUrl ?? '',
    });
  }
  if (!item || item.kind === 'FOLDER') return null;
  if (item.kind === 'CANVAS')
    return itemFromSdlc({ id: tab.id, title: item.title, kind: 'CANVAS' });
  if (item.kind === 'LINK') {
    return itemFromSdlc({ id: tab.id, title: sdlcItemName(item), kind: 'LINK', url: item.url });
  }
  return itemFromSdlc({
    id: tab.id,
    title: item.name,
    kind: 'FILE',
    url: item.url,
    mimeType: item.mimetype,
  });
}

function LinkCard({ link }: { link: SdlcLinkItem }): ReactElement {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
      {link.favicon ? (
        <img src={link.favicon} alt='' className='size-10 rounded-lg object-contain' />
      ) : (
        <Link2 className='size-10 text-muted-foreground' />
      )}
      <div>
        <p className='text-[15px] font-semibold'>{link.title.trim() || link.url}</p>
        <p className='mt-0.5 text-[12.5px] text-muted-foreground'>{link.url}</p>
      </div>
      {link.description && (
        <p className='max-w-[520px] text-[12.5px] leading-relaxed text-muted-foreground'>
          {link.description}
        </p>
      )}
      <button
        type='button'
        onClick={event => openFromTab(link.url, event)}
        className='outline-none mt-1 rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:opacity-90'
        data-track-category='SdlcHub'
        data-track-name='FolderTabLinkOpened'
      >
        Open link
      </button>
    </div>
  );
}

/**
 * One open tab, rendered by the shared workspace viewer. The folder keeps the
 * things only it can draw — its own embedded browser, which the host window holds
 * over this frame, a browsing tab's start page, and the download card for a file
 * no viewer previews.
 */
function TabContent(props: {
  tab: FolderTab;
  /** The tab's item, once it has arrived. */
  item: SdlcTrackItem | undefined;
  /** A browsing tab's page; none while it is at its start page. */
  browseUrl: string | undefined;
  renderCanvas: (canvasId: string) => ReactElement;
  onAddLink?: (url: string, title: string) => void;
  /** A browsing tab's start page was given somewhere to go. */
  onBrowse: (url: string) => void;
  onOpen: (tab: FolderTab) => void;
  channelId: string;
  parentType: 'TRACK' | 'FOLDER';
  folderId: string;
  folderName: string;
  /** The folder's other browsing tabs on a page, for the start page. */
  browsing: readonly FolderTab[];
  homePage: string;
}): ReactElement {
  const found = props.item;
  // An uploaded file is previewed by the file previewer, whatever kind it is.
  if (found?.kind === 'ATTACHMENT' && props.tab.kind === 'ATTACHMENT') {
    const kind = fileKind(found.mimetype, found.name);
    return (
      <FilePreview
        // One preview per file: a tab for another file starts afresh, never with the
        // last one's player, zoom or parsed rows.
        key={found.id}
        file={{ id: found.id, name: found.name, mimetype: found.mimetype, size: found.size }}
        icon={<FileTypeIcon kind={kind} size='lg' />}
        // The list's own name for it — Excel, Word — unless that is only "File" or
        // "Text", which the previewer names better: Code, Markdown, CSV.
        {...(kind.label !== 'File' && kind.label !== 'Text' && { typeLabel: kind.label })}
      />
    );
  }
  if (props.tab.kind === 'BROWSER' && !props.browseUrl && canHostEmbedPages()) {
    return (
      <BrowserStartPage
        key={props.tab.id}
        channelId={props.channelId}
        parentType={props.parentType}
        folderId={props.folderId}
        folderName={props.folderName}
        browsing={props.browsing}
        homePage={props.homePage}
        onGo={props.onBrowse}
        onOpen={props.onOpen}
      />
    );
  }
  const item = tabItem(props.tab, found, props.browseUrl);
  if (!item) {
    return (
      <Missing
        what={props.tab.kind === 'LINK' ? 'link' : props.tab.kind === 'CANVAS' ? 'canvas' : 'file'}
      />
    );
  }

  const pageKey = pageKeyOf(props.folderId, props.tab);
  return (
    <ItemView
      item={item}
      slots={{
        canvas: canvasItem => props.renderCanvas(canvasItem.refId),
        browser: browsable => {
          if (!canHostEmbedPages()) {
            return found?.kind === 'LINK' && found.id === browsable.refId ? (
              <LinkCard link={found} />
            ) : null;
          }
          const start = browsable.url || props.browseUrl;
          if (!start) return null;
          return (
            <EmbeddedPage
              pageKey={pageKey}
              url={start}
              {...(found?.kind === 'LINK' && {
                saved: { name: sdlcItemName(found), url: found.url },
              })}
              {...(props.onAddLink ? { onAddLink: props.onAddLink } : {})}
            />
          );
        },
      }}
    />
  );
}

/**
 * Where a folder's browser opens for Xyne AI, kept per person on this device: shown
 * as its site, changed in place.
 */
function HomePageSetting(props: {
  homePage: string;
  onChange: (url: string) => void;
}): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing !== null]);

  if (editing === null) {
    return (
      <p className='text-center text-[11.5px] text-muted-foreground'>
        Home page{' '}
        <span className='font-medium text-foreground'>
          {hostOf(props.homePage) || props.homePage}
        </span>
        <span aria-hidden='true'> · </span>
        <button
          type='button'
          onClick={() => {
            setInvalid(false);
            setEditing(props.homePage);
          }}
          className='rounded px-0.5 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline'
          data-track-category='SdlcHub'
          data-track-name='BrowserHomePageEditOpened'
        >
          Change
        </button>
      </p>
    );
  }
  const save = (): void => {
    const url = homePageFor(editing);
    if (!url) {
      setInvalid(true);
      return;
    }
    props.onChange(url);
    setEditing(null);
  };
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        save();
      }}
      className='mx-auto flex w-full max-w-[420px] flex-col items-center gap-1.5'
    >
      <div className='flex w-full items-center gap-1.5'>
        <input
          ref={inputRef}
          value={editing}
          onChange={event => {
            setInvalid(false);
            setEditing(event.target.value);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(null);
            }
          }}
          aria-label='Home page'
          aria-invalid={invalid}
          spellCheck={false}
          className={cn(
            'h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:ring-1',
            invalid ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-ring',
          )}
          data-track-category='SdlcHub'
          data-track-name='BrowserHomePageTyped'
        />
        <button
          type='submit'
          className='h-8 rounded-lg bg-foreground px-3 text-[12.5px] font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90'
          data-track-category='SdlcHub'
          data-track-name='BrowserHomePageSaved'
        >
          Save
        </button>
        <button
          type='button'
          onClick={() => setEditing(null)}
          className='h-8 rounded-lg px-2.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted'
          data-track-category='SdlcHub'
          data-track-name='BrowserHomePageEditCancelled'
        >
          Cancel
        </button>
      </div>
      <p
        role={invalid ? 'alert' : undefined}
        className={cn('text-[11.5px]', invalid ? 'text-destructive' : 'text-muted-foreground')}
      >
        {invalid
          ? 'Enter a web address, like google.com.'
          : 'Where the browser opens when Xyne AI browses for you.'}
      </p>
    </form>
  );
}

/**
 * A browsing tab before it has gone anywhere, as a browser's new tab is: where you
 * are browsing from, one box to search or type an address, the links saved in this
 * folder as tiles a click from their tabs, the pages still open from here, and the
 * keys that get around. Pages browsed here aren't saved until saved.
 */
function BrowserStartPage(props: {
  channelId: string;
  parentType: 'TRACK' | 'FOLDER';
  folderId: string;
  folderName: string;
  /** The folder's other browsing tabs that are on a page: somewhere to go back to. */
  browsing: readonly FolderTab[];
  homePage: string;
  onGo: (url: string) => void;
  onOpen: (tab: FolderTab) => void;
}): ReactElement {
  // The explorer holds this same query for the folder, so it costs nothing more.
  const [edgeRows, details] = useCachedQuery(
    queries.getSdlcFolderChildren({
      channelId: props.channelId,
      parentType: props.parentType,
      parentId: props.folderId,
    }),
    { enabled: Boolean(props.channelId && props.folderId) },
  );
  const links = useMemo(
    () =>
      (Array.isArray(edgeRows) ? edgeRows : [])
        .flatMap(edge => {
          const item = targetItemOf(edge);
          return item?.kind === 'LINK' ? [item] : [];
        })
        .slice(0, 8),
    [edgeRows],
  );

  return (
    <StartPage
      heading={
        <>
          <Globe className='size-4' />
          <span>
            Browsing from <span className='font-medium text-foreground'>{props.folderName}</span>
          </span>
        </>
      }
      note={
        <>
          Pages here aren&apos;t kept until you press{' '}
          <Save className='inline size-3.5 -translate-y-px' aria-label='Save' /> — then they join{' '}
          {props.folderName}.
        </>
      }
      onGo={props.onGo}
      history={LANE_HISTORY}
      footer={
        <HomePageSetting
          homePage={props.homePage}
          onChange={url => setUserPreference('sdlcBrowserHomePage', url)}
        />
      }
      keys={[
        { keys: '⌘T', label: 'New tab' },
        { keys: '⌘L', label: 'Address' },
        { keys: '⌘F', label: 'Find in page' },
        { keys: '⌘P', label: 'All tabs' },
      ]}
      trackCategory='SdlcHub'
    >
      <StartSection title={`Saved in ${props.folderName}`}>
        {links.length > 0 ? (
          <SiteTiles
            sites={links.map(link => ({
              key: link.id,
              url: link.url,
              name: sdlcItemName(link),
              favicon: link.favicon,
            }))}
            onOpen={id => props.onOpen({ kind: 'LINK', id })}
            trackCategory='SdlcHub'
            trackName='BrowserStartLinkOpened'
          />
        ) : details.type === 'complete' ? (
          <div className='flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground'>
            <Link2 className='size-4 shrink-0' />
            Links saved to {props.folderName} show up here, a click from their own tabs.
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-1 sm:grid-cols-4' aria-hidden='true'>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className='flex flex-col items-center gap-2 px-2 py-3'>
                <span className='size-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none' />
                <span className='h-3 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none' />
              </div>
            ))}
          </div>
        )}
      </StartSection>

      {props.browsing.length > 0 && (
        <StartSection title='Still open, not saved'>
          <div className='flex flex-col gap-0.5'>
            {props.browsing.slice(0, 5).map(tab => {
              const host = hostOf(tab.url);
              return (
                <button
                  key={tab.id}
                  type='button'
                  onClick={() => props.onOpen(tab)}
                  title={tab.url}
                  className='flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted/70'
                  data-track-category='SdlcHub'
                  data-track-name='BrowserStartTabOpened'
                >
                  <span className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-semibold text-muted-foreground'>
                    {tab.favicon ? (
                      <img
                        src={tab.favicon}
                        alt=''
                        className='size-4 rounded-[3px] object-contain'
                      />
                    ) : (
                      siteLetter(host)
                    )}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-[13px] text-foreground'>
                    {tab.title || host || tab.url}
                  </span>
                  <span className='shrink-0 text-[11.5px] text-muted-foreground'>{host}</span>
                </button>
              );
            })}
          </div>
        </StartSection>
      )}
    </StartPage>
  );
}

/** The browsing history, asked of the host: the lane can't reach the desktop app itself. */
const LANE_HISTORY: HistorySource = {
  suggest: (typed, limit) => historyFromHost('suggest', typed, limit),
  top: limit => historyFromHost('top', '', limit).then(found => found.pages),
};

/**
 * The page itself, inside the tab. A <webview> is the same mechanism the browser
 * panel uses, so it inherits the app's partitions: a Xyne URL loads signed in,
 * everything else stays in the external jar where Xyne cookies never go.
 *
 * The host keeps it for as long as its tab is open: switching tabs puts it aside
 * and back as it was. Its bar says what it is doing — loading, where it is and
 * whether that is secure — and, on a saved link, which link it came from.
 */
function EmbeddedPage(props: {
  /** The tab it belongs to, which the host holds it under. */
  pageKey: string;
  /** Where it starts; afterwards it goes where its reader takes it. */
  url: string;
  /** A saved link's name and address, to go back to. */
  saved?: { name: string; url: string };
  onAddLink?: (url: string, title: string) => void;
}): ReactElement {
  const holeRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const page = useEmbeddedPages().get(props.pageKey);
  // An older host reports its one page in the fields it always has, and keeps
  // pages a link opened as tabs of its own, inside this one.
  const [legacy, setLegacy] = useState<{
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    tabs: SdlcEmbedTab[];
    activeTabId: string;
  } | null>(null);

  useEffect(() => {
    const element = holeRef.current;
    if (!element) return undefined;
    return embedPageOverElement(props.url, element, props.pageKey);
  }, [props.url, props.pageKey]);
  useEffect(() => subscribeToEmbeddedPage(setLegacy), []);

  const find = useFindInPage(
    {
      find: (key, text, forward, step) =>
        controlEmbeddedPage('find', { key, text, forward, findNext: step }),
      stop: key => controlEmbeddedPage('stopFind', { key }),
    },
    props.pageKey,
  );
  const openFind = find.open;
  const focusAddress = useCallback(() => {
    requestAnimationFrame(() => addressRef.current?.focus());
  }, []);

  // While a page is open, ⌘F finds in it and ⌘L takes the address — ahead of the
  // channel's own find — as in any browser.
  useScope('sdlc-browser', true);
  useShortcutById('browser.find', openFind);
  useShortcutById('browser.focusAddress', focusAddress);

  // The same, pressed inside the page, which has the keyboard then; and its menu's Save.
  const saveRef = useRef<() => void>(() => undefined);
  useEffect(
    () =>
      subscribeToEmbeddedCommand((key, command) => {
        if (key !== props.pageKey) return;
        if (command === 'find') openFind();
        else if (command === 'focusAddress') focusAddress();
        else if (command === 'save') saveRef.current();
      }),
    [props.pageKey, openFind, focusAddress],
  );

  const fromLegacy = !page && legacy?.url ? legacy : null;
  const url = page?.url || fromLegacy?.url || props.url;
  const title = page?.title || '';
  const loading = page?.loading ?? false;
  const canGoBack = page?.canGoBack ?? fromLegacy?.canGoBack ?? false;
  const canGoForward = page?.canGoForward ?? fromLegacy?.canGoForward ?? false;
  const error = page?.error ?? null;
  // A saved link often lands somewhere else — stripe.com/docs redirects to
  // docs.stripe.com — so where it landed, before any history, is the saved page too.
  const landingRef = useRef<{ key: string; url: string } | null>(null);
  if (
    page &&
    !page.loading &&
    !page.canGoBack &&
    page.url &&
    landingRef.current?.key !== props.pageKey
  ) {
    landingRef.current = { key: props.pageKey, url: page.url };
  }
  const landing = landingRef.current?.key === props.pageKey ? landingRef.current.url : null;
  const onSaved = props.saved ? url === props.saved.url || url === landing : false;
  const canSave = Boolean(props.onAddLink) && /^https?:/.test(url) && !onSaved;
  saveRef.current = () => {
    if (/^https?:/.test(url)) props.onAddLink?.(url, title || url);
  };

  const control = (
    action: 'back' | 'forward' | 'reload' | 'stop' | 'goto',
    target?: string,
  ): void => {
    controlEmbeddedPage(action, { key: props.pageKey, ...(target ? { url: target } : {}) });
  };

  return (
    <div className='flex size-full flex-col bg-background'>
      <BrowserToolbar
        url={url}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={() => control('back')}
        onForward={() => control('forward')}
        onReload={() => control('reload')}
        onStop={() => control('stop')}
        onGo={target => control('goto', target)}
        addressRef={addressRef}
        history={LANE_HISTORY}
        addressLeading={
          props.saved ? (
            <button
              type='button'
              onClick={() => props.saved && control('goto', props.saved.url)}
              title={
                onSaved
                  ? `Saved link: ${props.saved.name}`
                  : `Back to the saved page: ${props.saved.name}`
              }
              className={cn(
                'flex h-6 max-w-[200px] shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium outline-none transition-colors',
                onSaved
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                  : 'bg-background text-muted-foreground ring-1 ring-border/70 hover:text-foreground focus-visible:text-foreground',
              )}
              data-track-category='SdlcHub'
              data-track-name='EmbeddedPageSavedLinkReturned'
            >
              <Link2 className='size-3 shrink-0' />
              <span className='truncate'>{props.saved.name}</span>
            </button>
          ) : null
        }
        find={
          find.text !== null && (
            <FindBar
              text={find.text}
              result={page?.find ?? null}
              onChange={find.setText}
              onStep={find.step}
              onClose={find.close}
              inputRef={find.inputRef}
              trackCategory='SdlcHub'
            />
          )
        }
        trailing={
          <>
            <DownloadsButton />
            {canSave && (
              <ToolbarButton
                label='Save to this folder'
                onClick={() => props.onAddLink?.(url, title || url)}
                trackCategory='SdlcHub'
                trackName='EmbeddedPageAddLink'
              >
                <Save className='size-4' />
              </ToolbarButton>
            )}
            <ToolbarButton
              label='Open in your browser'
              onClick={() => openLink(url, null, { force: 'external' })}
              disabled={!/^https?:/.test(url)}
              trackCategory='SdlcHub'
              trackName='EmbeddedPageOpenedExternally'
            >
              <ExternalLink className='size-4' />
            </ToolbarButton>
          </>
        }
        pageKey={props.pageKey}
        onPointerEnter={reclaimHostFocus}
        trackCategory='SdlcHub'
      />
      {fromLegacy && fromLegacy.tabs.length > 1 && (
        // An older host keeps a page's new windows inside it: they can at least be
        // switched between, until the host is updated and they become tabs.
        <div
          onPointerEnter={reclaimHostFocus}
          className='scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1'
        >
          {fromLegacy.tabs.map(tab => (
            <button
              key={tab.id}
              type='button'
              onClick={() => controlEmbeddedPage('select', { tabId: tab.id })}
              title={tab.url}
              className={cn(
                'flex h-6 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] outline-none transition-colors',
                tab.id === fromLegacy.activeTabId
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60',
              )}
              data-track-category='SdlcHub'
              data-track-name='EmbeddedTabSelected'
            >
              {tab.favicon ? (
                <img src={tab.favicon} alt='' className='size-3.5 shrink-0 rounded-[2px]' />
              ) : (
                <Globe className='size-3.5 shrink-0' />
              )}
              <span className='truncate'>{tab.title || tab.url}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={holeRef} className='relative min-h-0 flex-1'>
        {error && (
          <LoadError
            error={error}
            onRetry={() => control('goto', error.url || url)}
            trackCategory='SdlcHub'
          />
        )}
      </div>
    </div>
  );
}

/** Same rule as the track's file list: the host opens it unless a modifier says otherwise. */
function openFromTab(url: string, event: { metaKey: boolean; ctrlKey: boolean }): void {
  if (!event.metaKey && !event.ctrlKey && openLinkFromSdlcFrame(url)) return;
  openLink(url, event);
}

function Missing(props: { what: string }): ReactElement {
  return (
    <div className='flex h-full items-center justify-center'>
      <p className='text-[12.5px] text-muted-foreground'>This {props.what} is no longer here.</p>
    </div>
  );
}
