import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  RotateCw,
  X,
} from 'lucide-react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import { Popover } from '../../components/ui/Popover';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';
import { useScope, useShortcutById } from '../../shortcuts';
import { openLink } from '../../utils/openLink';
import { useBridgeTransport } from './useBridgeTransport';
import {
  canHostEmbedPages,
  controlEmbeddedPage,
  embedPageOverElement,
  openLinkFromSdlcFrame,
  reclaimHostFocus,
  subscribeToEmbeddedPage,
} from './useSdlcFrameBridge';
import type { SdlcEmbedTab } from './sdlcFrameMessages';
import { AttachmentPreviewPane } from '../../components/FileViewer/AttachmentPreviewPane';
import { detectFileType } from '../../components/FileViewer/utils';
import { fileKind, formatFileSize } from './fileKind';
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
import type { SdlcFinderCanvas, SdlcFinderFile, SdlcFinderLink } from './SdlcFinder';

export type FolderTabKind = 'CANVAS' | 'LINK' | 'ATTACHMENT' | 'BROWSER';

/** The one scratch tab a folder can have open; it is not an item of anything. */
export const SCRATCH_TAB_ID = 'browse';

/** Where scratch browsing starts. */
const SCRATCH_START_PAGE = 'https://www.google.com';

export interface FolderTab {
  kind: FolderTabKind;
  id: string;
}

interface ContainmentEdge {
  targetType: string;
  targetId: string;
}

interface TreeNode {
  kind: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
  id: string;
  name: string;
}

interface Maps {
  folderById: ReadonlyMap<string, { id: string; name: string }>;
  canvasById: ReadonlyMap<string, SdlcFinderCanvas>;
  linkById: ReadonlyMap<string, SdlcFinderLink>;
  fileById: ReadonlyMap<string, SdlcFinderFile>;
}

export function compareTreeNodes(
  left: { kind: string; name: string },
  right: { kind: string; name: string },
): number {
  const leftIsFolder = left.kind === 'FOLDER';
  const rightIsFolder = right.kind === 'FOLDER';
  if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
}

function nodesFromEdges(edges: readonly ContainmentEdge[], maps: Maps): TreeNode[] {
  const nodes = edges.flatMap<TreeNode>(edge => {
    if (edge.targetType === 'FOLDER') {
      const folder = maps.folderById.get(edge.targetId);
      return folder ? [{ kind: 'FOLDER', id: folder.id, name: folder.name }] : [];
    }
    if (edge.targetType === 'LINK') {
      const link = maps.linkById.get(edge.targetId);
      return link ? [{ kind: 'LINK', id: link.id, name: link.title.trim() || link.url }] : [];
    }
    if (edge.targetType === 'ATTACHMENT') {
      const file = maps.fileById.get(edge.targetId);
      return file ? [{ kind: 'ATTACHMENT', id: file.id, name: file.name }] : [];
    }
    const canvas = maps.canvasById.get(edge.targetId);
    return canvas ? [{ kind: 'CANVAS', id: canvas.id, name: canvas.title }] : [];
  });
  return nodes.sort(compareTreeNodes);
}

function NodeIcon(props: {
  node: TreeNode;
  maps: Maps;
  size?: string;
  active?: boolean;
}): ReactElement {
  const className = cn(
    props.size ?? 'size-[15px]',
    'shrink-0',
    props.active ? '' : 'text-muted-foreground',
  );
  if (props.node.kind === 'LINK') {
    const link = props.maps.linkById.get(props.node.id);
    if (link?.favicon) {
      return (
        <img
          src={link.favicon}
          alt=''
          className={cn(props.size ?? 'size-[15px]', 'shrink-0 rounded-sm object-contain')}
        />
      );
    }
    return <Link2 className={className} />;
  }
  if (props.node.kind === 'ATTACHMENT') {
    const file = props.maps.fileById.get(props.node.id);
    const Icon = file ? fileKind(file.mimetype, file.name).icon : Paperclip;
    return <Icon className={className} />;
  }
  return (
    <FileText
      className={cn(props.size ?? 'size-[15px]', 'shrink-0', props.active ? '' : 'text-primary/70')}
    />
  );
}

/**
 * One level of the tree. Each expanded folder subscribes to its own children,
 * so opening a branch costs one query and closing it drops one — the same
 * bargain the finder's columns make.
 */
interface TreeHandlers {
  channelId: string;
  maps: Maps;
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
  /** Filing an item into another folder, the same move the finder performs. */
  onMoveItem: (
    item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string },
    parentFolderId: string,
  ) => void;
  dragging: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string } | null;
  onDrag: (item: { type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT'; id: string } | null) => void;
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
  const { node } = props;
  const isFolder = node.kind === 'FOLDER';
  const isOpen = isFolder && (expanded[node.id] ?? props.defaultExpanded ?? false);
  const isActive =
    !isFolder && props.activeTab?.kind === node.kind && props.activeTab.id === node.id;
  const [dragOver, setDragOver] = useState(false);
  // Only a folder can receive, and never the thing being dragged.
  const canAccept = isFolder && props.dragging !== null && props.dragging.id !== node.id;

  return (
    <div>
      {/* A row, not a button: it carries controls of its own, and a button
          cannot hold other buttons. */}
      <div
        data-explorer-row={node.id}
        data-explorer-kind={node.kind}
        data-explorer-open={isFolder ? String(isOpen) : undefined}
        draggable
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
        className={cn(
          'group/row flex items-center gap-1 pr-1.5 text-[12.5px] transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/90 hover:bg-foreground/[0.06]',
          props.cursorId === node.id && !isActive && 'bg-foreground/[0.09]',
          dragOver && 'bg-primary/20',
        )}
        style={{ paddingLeft: 8 + props.depth * 12 }}
      >
        <button
          type='button'
          onClick={() => {
            if (node.kind === 'FOLDER') {
              setUserPreference('sdlcFolderTreeExpanded', { ...expanded, [node.id]: !isOpen });
              return;
            }
            props.onOpen({ kind: node.kind, id: node.id });
          }}
          className='flex min-w-0 flex-1 items-center gap-1.5 py-[3px] text-left'
          data-track-category='SdlcHub'
          data-track-name={isFolder ? 'FolderTreeToggled' : 'FolderTreeItemOpened'}
          data-track-metadata={JSON.stringify({ id: node.id })}
        >
          {isFolder ? (
            isOpen ? (
              <ChevronDown
                className={cn('size-3 shrink-0', isActive ? '' : 'text-muted-foreground')}
              />
            ) : (
              <ChevronRight
                className={cn('size-3 shrink-0', isActive ? '' : 'text-muted-foreground')}
              />
            )
          ) : (
            <span className='size-3 shrink-0' />
          )}
          {isFolder ? (
            <Folder
              className={cn(
                'size-[15px] shrink-0',
                isActive
                  ? 'fill-current'
                  : isOpen
                    ? 'fill-primary/25 text-primary/70'
                    : 'fill-primary/20 text-primary/60',
              )}
            />
          ) : (
            <NodeIcon node={node} maps={props.maps} active={isActive} />
          )}
          <span className='min-w-0 flex-1 truncate'>{node.name}</span>
        </button>
        <button
          type='button'
          title={`Conversations on ${node.name}`}
          aria-label={`Conversations on ${node.name}`}
          onClick={() => props.onDiscuss({ type: node.kind, id: node.id, name: node.name })}
          className={cn(
            'shrink-0 rounded p-0.5 transition-opacity hover:bg-foreground/10',
            props.discussingId === node.id
              ? 'opacity-100'
              : 'opacity-0 focus:opacity-100 group-hover/row:opacity-100',
          )}
          data-track-category='SdlcHub'
          data-track-name='FolderTreeItemDiscussed'
        >
          <MessageCircle className='size-3' />
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
          {...props}
          parentType={props.childrenParentType ?? 'FOLDER'}
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
 * bargain the finder's columns make.
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
  const edges: ContainmentEdge[] = Array.isArray(edgeRows) ? (edgeRows as ContainmentEdge[]) : [];
  const nodes = useMemo(() => nodesFromEdges(edges, props.maps), [edges, props.maps]);

  if (nodes.length === 0) {
    return (
      <p
        className='py-1 text-[11.5px] text-muted-foreground'
        style={{ paddingLeft: 12 + props.depth * 12 }}
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
      className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted'
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
      className='w-[170px] p-1'
      trigger={
        <button
          type='button'
          title='Add to this folder'
          aria-label='Add to this folder'
          className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name='FolderPageAddOpened'
        >
          <Plus className='size-3.5' />
        </button>
      }
    >
      {item(
        'New artifact',
        <FileText className='size-3.5 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('artifact'),
        'NewArtifactOpened',
      )}
      {item(
        'Upload file',
        <Paperclip className='size-3.5 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('upload'),
        'UploadFileOpened',
      )}
      {item(
        'Add link',
        <Link2 className='size-3.5 shrink-0 text-muted-foreground' />,
        () => props.onAddItem('link'),
        'AddLinkOpened',
      )}
      {item(
        'New folder',
        <Folder className='size-3.5 shrink-0 fill-primary/25 text-primary/70' />,
        props.onNewFolder,
        'NewFolderOpened',
      )}
    </Popover>
  );
}

function TabLabel(props: { tab: FolderTab; maps: Maps }): ReactElement {
  const { tab, maps } = props;
  if (tab.kind === 'BROWSER') {
    return (
      <>
        <Globe className='size-3.5 shrink-0' />
        <span className='min-w-0 truncate'>Browsing</span>
      </>
    );
  }
  const name =
    tab.kind === 'LINK'
      ? (() => {
          const link = maps.linkById.get(tab.id);
          return link ? link.title.trim() || link.url : 'Link';
        })()
      : tab.kind === 'ATTACHMENT'
        ? (maps.fileById.get(tab.id)?.name ?? 'File')
        : (maps.canvasById.get(tab.id)?.title ?? 'Artifact');
  return (
    <>
      <NodeIcon node={{ kind: tab.kind, id: tab.id, name }} maps={maps} size='size-3.5' />
      <span className='min-w-0 truncate'>{name}</span>
    </>
  );
}

export function SdlcFolderPage(props: {
  channelId: string;
  folder: { id: string; name: string };
  /** A track's own page is this page with the track as its root. */
  rootType?: 'TRACK' | 'FOLDER';
  maps: Maps;
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
  renderCanvas: (canvasId: string) => ReactElement;
  /** Offers a page the reader browsed to for adding as a link in this folder. */
  onAddLink?: (url: string, title: string) => void;
  /** `KIND:id` -> the folder holding it, for reaching a buried item. */
  parentFolderOf: ReadonlyMap<string, string>;
  /** The strip lives in the page header when there is one, so the top bar is
   *  the tab bar rather than a breadcrumb repeating what the tabs already say. */
  tabsContainer: HTMLElement | null;
}): ReactElement {
  const tabsByFolder = useUserPreference('sdlcFolderTabs');
  const tabs = useMemo<FolderTab[]>(() => {
    const stored = tabsByFolder[props.folder.id] ?? [];
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
        (tab.kind === 'BROWSER'
          ? true
          : tab.kind === 'LINK'
            ? props.maps.linkById.has(tab.id)
            : tab.kind === 'ATTACHMENT'
              ? props.maps.fileById.has(tab.id)
              : props.maps.canvasById.has(tab.id)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsByFolder, props.folder.id, props.maps, props.activeTab?.kind, props.activeTab?.id]);
  const [dragging, setDragging] = useState<{
    type: 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';
    id: string;
  } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
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
    setUserPreference('sdlcFolderTreeExpanded', { ...expandedFolders, [id]: open });
  };

  const bind = { enabled: treeFocused };
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
    setUserPreference('sdlcFolderTabs', { ...tabsByFolder, [props.folder.id]: next });
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
    () => (active ? tabItem(active, props.maps) : null),
    [active, props.maps],
  );
  // The scratch tab is ad-hoc browsing, not an item of the hub: it has no
  // entity id of its own (every folder would share SCRATCH_TAB_ID), so a
  // comment left here would be visible from every other folder's scratch tab.
  const canComment = Boolean(
    activeItem && active?.id !== SCRATCH_TAB_ID && commentStoreFor(activeItem),
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
        const item = tabItem(tab, props.maps);
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
  }, [tabs, active, props.folder.id, props.folder.name, props.channelId, props.maps]);

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

  // A tab can become active while scrolled out of the strip — opened from the
  // tree, restored from the url, or simply pushed along by newer tabs.
  useEffect(() => {
    if (!active) return;
    stripRef.current
      ?.querySelector(`[data-folder-tab="${active.kind}:${active.id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active?.kind, active?.id, tabs.length]);

  // Opening a tab for something filed deeper down should show it where it
  // lives, not leave the reader looking at a closed branch.
  useEffect(() => {
    if (!active) return undefined;

    const chain: string[] = [];
    let key = `${active.kind}:${active.id}`;
    // Bounded: a cycle in the edges would otherwise spin here forever.
    for (let step = 0; step < 32; step += 1) {
      const parent = props.parentFolderOf.get(key);
      if (!parent) break;
      chain.push(parent);
      if (parent === props.folder.id) break;
      key = `FOLDER:${parent}`;
    }

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
  }, [active?.kind, active?.id]);

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
    if (tabs.some(tab => tab.kind === active.kind && tab.id === active.id)) return;
    setTabs([...tabs, active]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, active?.id, tabs]);

  /**
   * The strip scrolls; the browsing button does not. It sits at the end of the
   * bar in the page's own header — the centre pane — so opening the
   * conversation panel never carries it off to the other side.
   */
  const renderTabStrip = (strip: ReactElement): ReactElement => {
    const bar = (
      <>
        {strip}
        {canHostEmbedPages() && (
          <button
            type='button'
            title='Open a tab for browsing'
            aria-label='Open a tab for browsing'
            onClick={() => openTab({ kind: 'BROWSER', id: SCRATCH_TAB_ID })}
            className='ml-auto flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
            data-track-category='SdlcHub'
            data-track-name='ScratchBrowserOpened'
          >
            <Globe className='size-4' />
          </button>
        )}
        {canComment && annotate.toggle}
        {canComment && (
          <button
            type='button'
            title={commentsOpen ? 'Hide comments' : 'Show comments'}
            aria-label={commentsOpen ? 'Hide comments' : 'Show comments'}
            onClick={() =>
              setCommentsOpen(open => {
                if (open) setDraftAnchor(null);
                return !open;
              })
            }
            className={cn(
              'flex size-7 shrink-0 items-center justify-center self-center rounded-md transition-colors hover:bg-foreground/[0.08] hover:text-foreground',
              canHostEmbedPages() ? 'mr-1' : 'ml-auto mr-1',
              commentsOpen ? 'text-foreground' : 'text-muted-foreground',
            )}
            data-track-category='SdlcHub'
            data-track-name='FolderCommentsToggled'
          >
            <MessageSquare className='size-4' />
          </button>
        )}
      </>
    );
    return props.tabsContainer ? (
      createPortal(bar, props.tabsContainer)
    ) : (
      <div className='flex h-9 shrink-0 items-stretch border-b border-border bg-sidebar/30'>
        {bar}
      </div>
    );
  };

  const closeTab = (tab: FolderTab): void => {
    const remaining = tabs.filter(item => !(item.kind === tab.kind && item.id === tab.id));
    // Closing the open tab also navigates away from it, and that lands a beat
    // later. Until it does, the url still names this tab, and the effect that
    // keeps the open tab in the strip would put it straight back — which read
    // as the first click doing nothing.
    closedRef.current = `${tab.kind}:${tab.id}`;
    setTabs(remaining);
    if (active && active.kind === tab.kind && active.id === tab.id) {
      openTab(remaining.at(-1) ?? null);
    }
  };

  return (
    <div className='flex min-h-0 flex-1'>
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
            className='-ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
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
        <div
          ref={treeRef}
          tabIndex={0}
          role='tree'
          aria-label='Explorer'
          onFocus={() => setTreeFocused(true)}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setTreeFocused(false);
            }
          }}
          className={cn(
            'scrollbar-none min-h-0 flex-1 overflow-y-auto py-1.5 outline-none',
            explorerCollapsed && 'hidden',
          )}
        >
          {/* The folder you opened is the tree's first row, not a title above
              it: it expands, takes new items and carries conversations exactly
              as the folders beneath it do. */}
          <TreeRow
            node={{ kind: 'FOLDER', id: props.folder.id, name: props.folder.name }}
            depth={0}
            defaultExpanded
            childrenParentType={props.rootType ?? 'FOLDER'}
            channelId={props.channelId}
            maps={props.maps}
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
          />
        </div>
      </aside>

      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {tabs.length > 0 &&
          renderTabStrip(
            <div
              ref={stripRef}
              onPointerEnter={reclaimHostFocus}
              className='scrollbar-none flex h-full min-w-0 items-stretch overflow-x-auto'
            >
              {tabs.map(tab => {
                const isActive = active?.kind === tab.kind && active.id === tab.id;
                return (
                  <div
                    key={`${tab.kind}-${tab.id}`}
                    data-folder-tab={`${tab.kind}:${tab.id}`}
                    className={cn(
                      'group flex max-w-[220px] shrink-0 items-stretch border-r border-border text-[12.5px] transition-colors',
                      isActive
                        ? 'bg-foreground/[0.09] font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                    )}
                  >
                    <button
                      type='button'
                      onClick={() => openTab(tab)}
                      className='flex min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1.5'
                      data-track-category='SdlcHub'
                      data-track-name='FolderTabSelected'
                    >
                      <TabLabel tab={tab} maps={props.maps} />
                    </button>
                    <button
                      type='button'
                      onMouseDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        closeTab(tab);
                      }}
                      aria-label='Close tab'
                      className='my-auto mr-1.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-100'
                      data-track-category='SdlcHub'
                      data-track-name='FolderTabClosed'
                    >
                      <X className='size-3' />
                    </button>
                  </div>
                );
              })}
            </div>,
          )}

        <div className='flex min-h-0 flex-1 overflow-hidden bg-background'>
          {active ? (
            <>
              <div ref={setViewerRoot} className='relative min-h-0 min-w-0 flex-1 overflow-hidden'>
                <TabContent
                  tab={active}
                  maps={props.maps}
                  renderCanvas={props.renderCanvas}
                  {...(props.onAddLink ? { onAddLink: props.onAddLink } : {})}
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
            <div className='flex h-full flex-col items-center justify-center gap-1.5 text-center'>
              <FolderOpen className='size-6 text-muted-foreground' />
              <p className='text-sm font-medium'>{props.folder.name}</p>
              <p className='text-[12.5px] text-muted-foreground'>
                Pick something on the left to open it here.
              </p>
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

function tabItem(tab: FolderTab, maps: Maps): WorkspaceItem | null {
  if (tab.kind === 'BROWSER') {
    return itemFromSdlc({
      id: tab.id,
      title: 'Browsing',
      kind: 'BROWSER',
      url: SCRATCH_START_PAGE,
    });
  }
  if (tab.kind === 'CANVAS') {
    const canvas = maps.canvasById.get(tab.id);
    return canvas ? itemFromSdlc({ id: tab.id, title: canvas.title, kind: 'CANVAS' }) : null;
  }
  if (tab.kind === 'LINK') {
    const link = maps.linkById.get(tab.id);
    return link
      ? itemFromSdlc({
          id: tab.id,
          title: link.title.trim() || link.url,
          kind: 'LINK',
          url: link.url,
        })
      : null;
  }
  const file = maps.fileById.get(tab.id);
  return file
    ? itemFromSdlc({
        id: tab.id,
        title: file.name,
        kind: 'FILE',
        url: file.url,
        mimeType: file.mimetype,
      })
    : null;
}

function FileFallback({ file }: { file: SdlcFinderFile }): ReactElement {
  const kind = fileKind(file.mimetype, file.name);
  // The same viewers the rest of the app previews attachments with — csv, xlsx,
  // docx, pptx, markdown and html included — rather than a second, poorer set
  // living here. They fetch through apiInstance, so the lane's api base applies
  // and the stream's download headers never come into it.
  if (detectFileType(file.mimetype, file.name)) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <AttachmentPreviewPane
          attachmentId={file.id}
          fileName={file.name}
          mimeType={file.mimetype}
          fileSize={file.size}
          flush
        />
      </div>
    );
  }
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
      <kind.icon className='size-10 text-muted-foreground' />
      <div>
        <p className='text-[15px] font-semibold'>{file.name}</p>
        <p className='mt-0.5 text-[12.5px] text-muted-foreground'>
          {kind.label} · {formatFileSize(file.size)}
        </p>
      </div>
      <button
        type='button'
        onClick={event => openFromTab(file.url, event)}
        className='mt-1 rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
        data-track-category='SdlcHub'
        data-track-name='FolderTabFileOpened'
      >
        Download
      </button>
    </div>
  );
}

function LinkCard({ link }: { link: SdlcFinderLink }): ReactElement {
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
        className='mt-1 rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
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
 * two things only it can draw — its own embedded browser, which the host window
 * holds over this frame, and the download card for a file no viewer previews.
 */
function TabContent(props: {
  tab: FolderTab;
  maps: Maps;
  renderCanvas: (canvasId: string) => ReactElement;
  onAddLink?: (url: string, title: string) => void;
}): ReactElement {
  const item = tabItem(props.tab, props.maps);
  if (!item) {
    return (
      <Missing
        what={props.tab.kind === 'LINK' ? 'link' : props.tab.kind === 'CANVAS' ? 'canvas' : 'file'}
      />
    );
  }

  return (
    <ItemView
      item={item}
      slots={{
        canvas: canvasItem => props.renderCanvas(canvasItem.refId),
        browser: browsable => {
          if (!canHostEmbedPages()) {
            const link = props.maps.linkById.get(browsable.refId);
            return link ? <LinkCard link={link} /> : null;
          }
          return (
            <EmbeddedPage
              url={browsable.url ?? SCRATCH_START_PAGE}
              {...(props.onAddLink ? { onAddLink: props.onAddLink } : {})}
            />
          );
        },
        fileFallback: fileItem => {
          const file = props.maps.fileById.get(fileItem.refId);
          return file ? <FileFallback file={file} /> : null;
        },
      }}
    />
  );
}

/**
 * The page itself, inside the tab. A <webview> is the same mechanism the
 * browser panel uses, so it inherits the app's partitions: a Xyne URL loads
 * signed in, everything else stays in the external jar where Xyne cookies
 * never go.
 */
function EmbeddedPage(props: {
  url: string;
  onAddLink?: (url: string, title: string) => void;
}): ReactElement {
  const holeRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    tabs: SdlcEmbedTab[];
    activeTabId: string;
  }>({ url: props.url, canGoBack: false, canGoForward: false, tabs: [], activeTabId: '' });
  // Null while the reader is editing; the address follows the page otherwise.
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    const element = holeRef.current;
    if (!element) return undefined;
    return embedPageOverElement(props.url, element);
  }, [props.url]);

  useEffect(() => subscribeToEmbeddedPage(setState), []);

  useEffect(() => {
    if (!state.activeTabId) return;
    tabStripRef.current
      ?.querySelector(`[data-embed-tab="${state.activeTabId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.activeTabId, state.tabs.length]);
  useEffect(() => {
    setState({
      url: props.url,
      canGoBack: false,
      canGoForward: false,
      tabs: [],
      activeTabId: '',
    });
    setDraft(null);
  }, [props.url]);

  const button = (
    label: string,
    icon: ReactElement,
    onClick: () => void,
    disabled: boolean,
    trackName: string,
  ): ReactElement => (
    <button
      type='button'
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
        disabled
          ? 'text-muted-foreground/40'
          : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
      )}
      data-track-category='SdlcHub'
      data-track-name={trackName}
    >
      {icon}
    </button>
  );

  return (
    <div className='flex size-full flex-col bg-background'>
      <div
        onPointerEnter={reclaimHostFocus}
        className='flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5'
      >
        {button(
          'Back',
          <ChevronLeft className='size-4' />,
          () => controlEmbeddedPage('back'),
          !state.canGoBack,
          'EmbeddedPageBack',
        )}
        {button(
          'Forward',
          <ChevronRight className='size-4' />,
          () => controlEmbeddedPage('forward'),
          !state.canGoForward,
          'EmbeddedPageForward',
        )}
        {button(
          'Reload',
          <RotateCw className='size-3.5' />,
          () => controlEmbeddedPage('reload'),
          false,
          'EmbeddedPageReload',
        )}
        {button(
          'New tab',
          <Plus className='size-4' />,
          () => controlEmbeddedPage('newTab', { url: SCRATCH_START_PAGE }),
          false,
          'EmbeddedPageNewTab',
        )}
        <form
          className='min-w-0 flex-1'
          onSubmit={event => {
            event.preventDefault();
            const typed = (draft ?? '').trim();
            if (!typed) return;
            // A bare host is a url the moment someone presses enter on it.
            const target = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
            controlEmbeddedPage('goto', { url: target });
            setDraft(null);
          }}
        >
          <input
            value={draft ?? state.url}
            onChange={event => setDraft(event.target.value)}
            onFocus={event => event.target.select()}
            onBlur={() => setDraft(null)}
            spellCheck={false}
            aria-label='Address'
            className='h-7 w-full rounded-md bg-foreground/[0.06] px-2.5 text-[12px] outline-none focus:ring-1 focus:ring-ring'
            data-track-category='SdlcHub'
            data-track-name='EmbeddedPageAddressEdited'
          />
        </form>
        {props.onAddLink &&
          state.url &&
          state.url !== props.url &&
          button(
            'Save to this folder',
            <BookmarkPlus className='size-4' />,
            () => {
              const active = state.tabs.find(tab => tab.id === state.activeTabId);
              props.onAddLink?.(state.url, active?.title ?? state.url);
            },
            false,
            'EmbeddedPageAddLink',
          )}
      </div>
      {state.tabs.length > 1 && (
        <div
          ref={tabStripRef}
          onPointerEnter={reclaimHostFocus}
          className='scrollbar-none flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-border bg-foreground/[0.04] px-1 pt-1'
        >
          {state.tabs.map(tab => {
            const isActive = tab.id === state.activeTabId;
            return (
              <div
                key={tab.id}
                data-embed-tab={tab.id}
                className={cn(
                  'group/tab flex w-[168px] shrink-0 items-stretch rounded-md text-[11.5px] transition-colors',
                  isActive
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                )}
              >
                <button
                  type='button'
                  onClick={() => controlEmbeddedPage('select', { tabId: tab.id })}
                  className='flex min-w-0 flex-1 items-center gap-1 py-1 pl-2.5 pr-1'
                  title={tab.url}
                  data-track-category='SdlcHub'
                  data-track-name='EmbeddedTabSelected'
                >
                  {tab.favicon ? (
                    <img
                      src={tab.favicon}
                      alt=''
                      className='size-3.5 shrink-0 rounded-[2px] object-contain'
                    />
                  ) : tab.pinned ? (
                    <Link2 className='size-3.5 shrink-0' />
                  ) : (
                    <Globe className='size-3.5 shrink-0' />
                  )}
                  <span className='min-w-0 truncate'>{tab.title || tab.url}</span>
                </button>
                {/* The item's own link is what this browser is for; closing it
                    would leave the tab showing nothing. */}
                {!tab.pinned && (
                  <button
                    type='button'
                    onMouseDown={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      controlEmbeddedPage('close', { tabId: tab.id });
                    }}
                    aria-label='Close tab'
                    className='my-auto mr-1.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover/tab:opacity-100'
                    data-track-category='SdlcHub'
                    data-track-name='EmbeddedTabClosed'
                  >
                    <X className='size-2.5' />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div ref={holeRef} className='min-h-0 flex-1' />
    </div>
  );
}

/** Same rule as the finder: the host opens it unless a modifier says otherwise. */
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
