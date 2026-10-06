/**
 * A track's files as a plain list: where you are, as breadcrumbs, then what that
 * folder holds — folders first, then everything else by name. Click a folder to go
 * into it and anything else to open it. Tick rows to act on several at once.
 * Moving works as it does on a computer: cut (⌘X), open the folder they should go
 * to, and paste (⌘V) — or drag rows onto a folder, or onto a breadcrumb to send
 * them back up. Right-click, or hover and use ⋯, for everything a row can do.
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type DragEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { PhoneDefault } from '@xyne/icons';
import {
  ChevronRight,
  ClipboardPaste,
  FileText,
  Folder,
  FolderOpen,
  Info,
  Link2,
  MessageCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Paperclip,
  Pencil,
  Plus,
  Scissors,
  Shapes,
  SquareArrowOutUpRight,
  SquareCheck,
  Upload,
  X,
} from 'lucide-react';
import { fileKind, formatFileSize, type FileKind } from './fileKind';
import { toggleSelection } from './selectionRange';
import { useScrollFade } from '../../hooks/useScrollFade';
import { FileTypeIcon } from './FileTypeIcon';
import { AppIcon } from '../../components/AppIcon/AppIcon';
import { IconPicker } from '../../components/AppIcon/IconPicker';
import { ActivityPill, type SdlcLiveCalls } from './ActivityPill';
import { SdlcItemInfoDialog } from './SdlcItemInfoDialog';
import { compareTreeNodes } from './SdlcFolderPage';
import { FilesEmptyState } from './SdlcFilesEmptyState';
import {
  formatUpdated,
  sdlcItemName,
  targetItemOf,
  type SdlcFilesLocation,
  type SdlcItemKind,
  type SdlcTargetLink,
  type SdlcTrackItem,
} from './sdlcItems';
import { useScope, useShortcutById } from '../../shortcuts';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import { ShortcutTooltip } from '../../components/ui/ShortcutTooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ShortcutHint } from '../../components/ui/ShortcutHint';
import { globalClickTracker } from '../../services/Analytics/globalClickTracker';
import { isElectronApp } from '../../utils/electronApp';

/** With ⌘/Ctrl held, an item opens in a new tab — a window of its own in the desktop app. */
type OpenEvent = { metaKey: boolean; ctrlKey: boolean };

interface FileRow {
  kind: SdlcItemKind;
  id: string;
  name: string;
  /** What it is, in words: Folder, Link, PDF, or the artifact's type. */
  typeLabel: string;
  updatedAt: number;
  /** All of it, for its Info. */
  item: SdlcTrackItem;
  /** A link's favicon, when the page offered one. */
  iconUrl: string | null;
  /** An uploaded file's format, which picks its icon. */
  fileKind: FileKind | null;
  /** An uploaded file's size in bytes. Nothing else in the list has one. */
  size: number | null;
  /** A folder's chosen icon, an @xyne/icons name. */
  folderIcon: string | null;
}

const ROW_TRACK_NAME: Record<SdlcItemKind, string> = {
  FOLDER: 'FolderOpened',
  CANVAS: 'FilesCanvasOpened',
  LINK: 'FilesLinkOpened',
  ATTACHMENT: 'FilesFileOpened',
};

/**
 * Only the rows in view, and a few either side, are in the page: a folder can hold
 * thousands, and each row carries a tick box, an avatar and its actions. Rows are
 * one fixed height, so nothing has to be measured.
 */
const ROW_HEIGHT = 40;
const ROW_OVERSCAN = 10;
/** Space above the first row and below the last. */
const LIST_PADDING = 4;
/** How far the list fades at an edge: deeper than the breadcrumbs', as a row half gone reads as more. */
const ROWS_FADE_PX = 48;

/**
 * How long a click on a row waits to see whether it is the start of a double-click,
 * so a double-click does only what it does and not the click's action first.
 */
const SINGLE_CLICK_DELAY_MS = 250;

/**
 * How soon after a click went into a folder a second one still counts as its
 * double-click. The system decides what a double-click is; this only makes sure
 * the first click was ours, not one from before.
 */
const DOUBLE_CLICK_MS = 800;

/**
 * Columns drop out as the list narrows, least useful first; the name never does. Who
 * made an item, and exactly when, are in its Info.
 */
const TYPE_COLUMN_MIN_WIDTH = 520;
const SIZE_COLUMN_MIN_WIDTH = 620;

function RowIcon(props: { row: FileRow; brokenFavicon: boolean; onFaviconError: () => void }) {
  const { row } = props;
  if (row.kind === 'FOLDER') {
    return row.folderIcon ? (
      <AppIcon
        name={row.folderIcon}
        size={16}
        className='shrink-0 text-muted-foreground'
        aria-hidden='true'
      />
    ) : (
      <Folder className='size-4 shrink-0 fill-muted-foreground/25 text-muted-foreground' />
    );
  }
  if (row.kind === 'LINK') {
    return row.iconUrl && !props.brokenFavicon ? (
      <img
        src={row.iconUrl}
        alt=''
        className='size-4 shrink-0 rounded-sm object-contain'
        onError={props.onFaviconError}
      />
    ) : (
      <Link2 className='size-4 shrink-0 text-muted-foreground' />
    );
  }
  if (row.kind === 'ATTACHMENT') {
    return row.fileKind ? (
      <FileTypeIcon kind={row.fileKind} />
    ) : (
      <Paperclip className='size-4 shrink-0 text-muted-foreground' />
    );
  }
  return <FileText className='size-4 shrink-0 text-muted-foreground' />;
}

function fileRowOf(item: SdlcTrackItem): FileRow {
  const row = {
    kind: item.kind,
    id: item.id,
    name: sdlcItemName(item),
    item,
    iconUrl: null,
    fileKind: null,
    size: null,
    folderIcon: null,
  };
  if (item.kind === 'FOLDER') {
    return { ...row, typeLabel: 'Folder', updatedAt: item.updatedAt, folderIcon: item.icon };
  }
  if (item.kind === 'LINK') {
    return { ...row, typeLabel: 'Link', updatedAt: item.createdAt, iconUrl: item.favicon };
  }
  if (item.kind === 'ATTACHMENT') {
    const kind = fileKind(item.mimetype, item.name);
    return {
      ...row,
      typeLabel: kind.label,
      updatedAt: item.createdAt,
      fileKind: kind,
      size: item.size,
    };
  }
  return { ...row, typeLabel: item.typeName, updatedAt: item.lastEditedAt ?? item.updatedAt };
}

/**
 * What a folder, or the track's top level, holds as list rows: folders first, then by
 * name. Each row's item comes joined to it, so a folder costs one query however
 * much the hub holds.
 */
function useFolderRows(
  channelId: string,
  location: SdlcFilesLocation,
): { rows: FileRow[]; loaded: boolean } {
  const [edgeRows, edgeDetails] = useCachedQuery(
    queries.getSdlcFolderChildren({
      channelId: channelId,
      parentType: location.type,
      parentId: location.id,
    }),
    { enabled: Boolean(channelId && location.id) },
  );
  const rows = useMemo<FileRow[]>(() => {
    const edges: readonly SdlcTargetLink[] = Array.isArray(edgeRows) ? edgeRows : [];
    return edges
      .flatMap(edge => {
        const item = targetItemOf(edge);
        return item ? [fileRowOf(item)] : [];
      })
      .sort(compareTreeNodes);
  }, [edgeRows]);
  return { rows, loaded: edgeDetails.type === 'complete' };
}

/**
 * How many of a folder's items its breadcrumb menu lists. A menu can't be
 * virtualized without losing its arrow keys and type-to-find, and past this many
 * a list is the better place to look anyway.
 */
const BREADCRUMB_MENU_LIMIT = 100;

/** A breadcrumb's menu: what that folder holds. Mounted only while open, so it queries then. */
function BreadcrumbMenuItems(props: {
  channelId: string;
  location: SdlcFilesLocation;
  onPick: (row: FileRow) => void;
  /** Shows the folder in the list, for the items the menu leaves out. */
  onShowAll: () => void;
}): ReactElement {
  const { rows, loaded } = useFolderRows(props.channelId, props.location);
  if (!loaded && rows.length === 0) {
    return <p className='px-2.5 py-2 text-[13px] text-muted-foreground'>Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className='px-2.5 py-2 text-[13px] text-muted-foreground'>
        {props.location.type === 'TRACK' ? 'Nothing here yet' : 'This folder is empty'}
      </p>
    );
  }
  const hidden = rows.length - BREADCRUMB_MENU_LIMIT;
  return (
    <>
      {rows.slice(0, BREADCRUMB_MENU_LIMIT).map(row => (
        <FilesMenuItem
          key={row.id}
          onSelect={() => props.onPick(row)}
          title={row.name}
          data-track-category='SdlcHub'
          data-track-name='FilesBreadcrumbItemPicked'
          data-track-metadata={JSON.stringify({ kind: row.kind })}
        >
          <span className='flex size-5 shrink-0 items-center justify-center'>
            <RowIcon row={row} brokenFavicon={false} onFaviconError={() => {}} />
          </span>
          <span className='min-w-0 flex-1 truncate'>{row.name}</span>
          {row.kind === 'FOLDER' && (
            <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
          )}
        </FilesMenuItem>
      ))}
      {hidden > 0 && (
        <>
          <DropdownMenuSeparator />
          <FilesMenuItem
            onSelect={props.onShowAll}
            className='text-muted-foreground'
            data-track-category='SdlcHub'
            data-track-name='FilesBreadcrumbShowAll'
            data-track-metadata={JSON.stringify({ count: rows.length })}
          >
            <span className='min-w-0 flex-1 truncate'>
              {hidden} more — show all {rows.length}
            </span>
            <ChevronRight className='size-3.5 shrink-0' />
          </FilesMenuItem>
        </>
      )}
    </>
  );
}

/**
 * How a highlight comes and goes: a quick fade in and a slower one out, so running
 * the pointer or the cursor down the list leaves a short trail rather than a
 * flicker. Rings are box-shadows and a cut row's dimming is opacity, so both ease
 * along with the colours.
 */
const HIGHLIGHT_MOTION =
  'transition-[background-color,box-shadow,color,opacity] duration-200 ease-out hover:duration-100 motion-reduce:transition-none';

/**
 * Where you are in the track. One line that never wraps: once the path is wider
 * than the bar it scrolls sideways — by wheel as well as by trackpad — kept at its
 * end so the folder you're in stays in view, and fades at an edge while there is
 * more past it.
 */
function Breadcrumbs(props: {
  trail: SdlcFilesLocation[];
  onGo: (index: number) => void;
  dragging: boolean;
  onDropOn: (location: SdlcFilesLocation) => void;
  channelId: string;
  liveCallCounts: ReadonlyMap<string, SdlcLiveCalls>;
  /** Something picked from a crumb's menu: the crumb's depth, and the row. */
  onPick: (index: number, row: FileRow) => void;
}): ReactElement {
  const fade = useScrollFade<HTMLElement>('x');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const trailKey = props.trail.map(step => step.id).join('/');
  const { node } = fade;
  useLayoutEffect(() => {
    const el = node.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trailKey, node]);
  useEffect(() => {
    if (!props.dragging) setDropTarget(null);
  }, [props.dragging]);

  return (
    <nav
      ref={fade.ref}
      aria-label='Folder path'
      onScroll={fade.onScroll}
      onWheel={event => {
        const el = event.currentTarget;
        if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          return;
        }
        el.scrollLeft += event.deltaY;
      }}
      className='no-scrollbar min-w-0 flex-1 overflow-x-auto'
      style={fade.style}
    >
      {/* One box as wide as the path, so a longer path re-measures the fade. */}
      <div className='flex w-max items-center gap-0.5 whitespace-nowrap'>
        {props.trail.map((step, index) => {
          const current = index === props.trail.length - 1;
          return (
            <Fragment key={step.id}>
              {index > 0 && (
                <ChevronRight className='size-3.5 shrink-0 text-muted-foreground/60' aria-hidden />
              )}
              <DropdownMenu
                open={menuFor === step.id}
                onOpenChange={open => setMenuFor(open ? step.id : null)}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    title={
                      current
                        ? `${step.name} — right-click to see what's in it`
                        : `${step.name} — click to open, right-click to see what's in it`
                    }
                    // A click goes to the folder and the menu is the right-click, so the
                    // trigger's own open-on-press is held off. ↓ still opens it from the
                    // keyboard, as does the context-menu key.
                    onPointerDown={event => event.preventDefault()}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      if (!current) props.onGo(index);
                    }}
                    onClick={() => {
                      if (!current) props.onGo(index);
                    }}
                    onContextMenu={event => {
                      event.preventDefault();
                      setMenuFor(step.id);
                    }}
                    {...(current && { 'aria-current': 'location' as const })}
                    onDragOver={event => {
                      if (!props.dragging || current) return;
                      event.preventDefault();
                      setDropTarget(step.id);
                    }}
                    onDragLeave={() =>
                      setDropTarget(target => (target === step.id ? null : target))
                    }
                    onDrop={event => {
                      if (!props.dragging || current) return;
                      event.preventDefault();
                      setDropTarget(null);
                      props.onDropOn(step);
                    }}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm',
                      HIGHLIGHT_MOTION,
                      current
                        ? 'font-medium text-foreground hover:bg-muted/60'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      menuFor === step.id && 'bg-muted text-foreground',
                      dropTarget === step.id && 'bg-muted ring-1 ring-inset ring-foreground/30',
                    )}
                    data-track-category='SdlcHub'
                    data-track-name='FilesBreadcrumbOpened'
                    data-track-metadata={JSON.stringify({ depth: index })}
                  >
                    {step.icon && (
                      <AppIcon
                        name={step.icon}
                        size={14}
                        className='shrink-0 text-muted-foreground'
                        aria-hidden='true'
                      />
                    )}
                    {step.name}
                    <ActivityPill
                      live={props.liveCallCounts.get(step.id)}
                      place={step.name}
                      size='sm'
                      className='ml-1'
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='start'
                  className='max-h-80 w-64 overflow-y-auto'
                  onCloseAutoFocus={event => event.preventDefault()}
                >
                  <BreadcrumbMenuItems
                    channelId={props.channelId}
                    location={step}
                    onPick={row => props.onPick(index, row)}
                    // The folder you're in is already the list that shows them all.
                    onShowAll={() => {
                      if (!current) props.onGo(index);
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/** The ticket board header's buttons, so the two tabs of a track look alike. */
/** How long the pointer rests on an icon before its name shows: passing over it
 *  on the way somewhere else shouldn't. */
const TOOLTIP_DELAY_MS = 600;

// The toolbar's actions are icons, named by their tooltips: the place's name is
// already in the breadcrumbs beside them.
const TOOLBAR_ICON =
  'flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const TOOLBAR_ICON_PRIMARY =
  'flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted';

/**
 * Every menu in the Files tab reads like its New menu: 13px, regular weight, the
 * same row height. The app's shared menu item is a size up, which next to the New
 * menu looks heavy.
 */
function FilesMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuItem>): ReactElement {
  return (
    <DropdownMenuItem
      className={cn('rounded-md px-2.5 py-1.5 text-[13px]', className)}
      {...props}
    />
  );
}

const ROW_ACTION =
  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type MovingItem = { type: SdlcItemKind; id: string };

export function SdlcFileList(props: {
  channelId: string;
  /** Calls in progress in each track, folder and item, counting everything under it. */
  liveCallCounts: ReadonlyMap<string, SdlcLiveCalls>;
  track: { id: string; name: string };
  /** The folders from the track down to the one being shown. */
  path: SdlcFilesLocation[];
  onNavigate: (path: SdlcFilesLocation[]) => void;
  /**
   * An artifact, link or file, as a tab on the page of the folder holding it. Both
   * open in place, or in a new tab when handed a ⌘/Ctrl event.
   */
  onOpenItem: (
    item: { kind: Exclude<SdlcItemKind, 'FOLDER'>; id: string },
    parent: SdlcFilesLocation,
    event?: OpenEvent,
  ) => void;
  /** A folder's icon; null goes back to the folder mark. */
  onSetFolderIcon: (folderId: string, icon: string | null) => void;
  /** A folder's own page, where its items open as tabs. */
  onOpenFolderPage: (folder: { id: string; name: string }, event?: OpenEvent) => void;
  onPreviewCanvas: (canvasId: string, title: string) => void;
  onNewFolder: (parent: SdlcFilesLocation) => void;
  onNewArtifact: (parent: SdlcFilesLocation) => void;
  onUploadFile: (parent: SdlcFilesLocation) => void;
  onAddLink: (parent: SdlcFilesLocation) => void;
  /** The conversations about one item, in the panel beside the page. */
  onDiscussItem: (
    item: { kind: SdlcItemKind; id: string; name: string },
    parent: SdlcFilesLocation,
  ) => void;
  onDiscussTrack: () => void;
  /** A call about one item, which becomes one of its discussions. Absent for someone outside the hub. */
  onStartCall?: (item: { kind: SdlcItemKind; id: string; name: string }) => void;
  /** The item whose conversations the panel is showing, if any. */
  discussingId: string | null;
  /** Renames a folder, artifact, link or uploaded file; a file keeps its extension. */
  onRenameItem: (item: { kind: SdlcItemKind; id: string }, name: string) => void;
  onMoveItems: (items: MovingItem[], parent: { type: 'TRACK' | 'FOLDER'; id: string }) => void;
  listRef: Ref<HTMLDivElement>;
}): ReactElement {
  const trackStep: SdlcFilesLocation = {
    type: 'TRACK',
    id: props.track.id,
    name: props.track.name,
  };
  const trail = [trackStep, ...props.path];
  const here = trail[trail.length - 1] ?? trackStep;

  const { rows, loaded: rowsLoaded } = useFolderRows(props.channelId, here);
  // Only once the folder has loaded: an empty state shown while it loads would flash.
  const showEmptyState = rowsLoaded && rows.length === 0;

  // Which columns fit, from the list's own width: the page beside it can be any
  // width depending on the sidebar and the conversation panel.
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const showType = width >= TYPE_COLUMN_MIN_WIDTH;
  const showSize = width >= SIZE_COLUMN_MIN_WIDTH;
  const gridTemplateColumns = [
    'minmax(0,1fr)',
    ...(showSize ? ['5rem'] : []),
    ...(showType ? ['8rem'] : []),
    '6.5rem',
  ].join(' ');

  const [addOpen, setAddOpen] = useState(false);
  // The row whose ⋯ menu is open — or still fading out, when its button has to stay
  // on screen: the menu is placed against it, and would jump to the corner without.
  const [menuRow, setMenuRow] = useState<{ id: string; open: boolean } | null>(null);
  // The row whose Info is up, read from the rows so it stays current while open.
  const [infoId, setInfoId] = useState<string | null>(null);
  const infoRow = rows.find(row => row.id === infoId) ?? null;
  const [dragging, setDragging] = useState<MovingItem[] | null>(null);
  /** The row the drag started on, as against everything it carries. */
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [brokenFavicons, setBrokenFavicons] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameAbandoned = useRef(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  // The cursor ring is for keyboard use, as :focus-visible is: a click hides it, a
  // key that moves the cursor (or arriving by shortcut) shows it.
  const [cursorVisible, setCursorVisible] = useState(false);
  const focusByPointer = useRef(false);
  const rowsFade = useScrollFade<HTMLDivElement>('y', ROWS_FADE_PX);

  // Selection belongs to the folder on screen: going elsewhere starts afresh, and an
  // item that has moved away drops out of it.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectionAnchor = useRef<string | null>(null);
  /** Whether the tick box being pressed is to tick a run; its change event can't say. */
  const extendSelection = useRef(false);
  useEffect(() => {
    setSelectedIds(new Set());
    setMenuRow(null);
    setInfoId(null);
    selectionAnchor.current = null;
  }, [here.id]);
  const selectedRows = rows.filter(row => selectedIds.has(row.id));
  const selecting = selectedRows.length > 0;
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const clearSelection = (): void => {
    setSelectedIds(new Set());
    selectionAnchor.current = null;
  };
  /** A plain click: this row alone, as a computer selects. */
  const selectOnly = (row: FileRow): void => {
    setSelectedIds(new Set([row.id]));
    selectionAnchor.current = row.id;
  };
  /**
   * Ticks or unticks one row; extending, it does the same to every row from the
   * last one ticked or unticked, and leaves other runs as they are.
   */
  const toggleRow = (row: FileRow, extend: boolean): void => {
    const anchor = selectionAnchor.current;
    const order = rows.map(item => item.id);
    setSelectedIds(current => toggleSelection(current, order, row.id, anchor, extend));
    selectionAnchor.current = row.id;
  };

  // Cut items wait here while you go to the folder they should end up in, as they
  // would on a computer. A cut is one track's: the list starts over with each track.
  const [clipboard, setClipboard] = useState<{ items: MovingItem[]; fromId: string } | null>(null);
  const cutIds = useMemo(() => new Set((clipboard?.items ?? []).map(item => item.id)), [clipboard]);
  // Where they can't go: back where they came from, or a folder into itself — which
  // is the case whenever a cut folder is anywhere on the path to here.
  const pasteBlocked =
    clipboard === null
      ? 'Nothing is cut'
      : clipboard.fromId === here.id
        ? 'Already in this folder'
        : trail.some(step => cutIds.has(step.id))
          ? "A folder can't go inside itself"
          : null;
  // Where a right-click was, and on which row: none for the list's background. Kept
  // after the menu closes, so it fades out where it was and with what it showed,
  // rather than from the corner with the folder's items.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: FileRow | null;
    open: boolean;
  } | null>(null);
  const contextMenuOpen = contextMenu?.open ?? false;

  const goTo = (depth: number): void => {
    // Coming back up puts the cursor on the folder you left, as a file browser does.
    const leaving = props.path[depth];
    setFocusedRowId(leaving?.id ?? null);
    props.onNavigate(props.path.slice(0, depth));
  };
  const enterFolder = (folder: FileRow): void => {
    setFocusedRowId(null);
    props.onNavigate([
      ...props.path,
      { type: 'FOLDER', id: folder.id, name: folder.name, icon: folder.folderIcon },
    ]);
  };
  // A click's action waits here for SINGLE_CLICK_DELAY_MS; a second click cancels it.
  const pendingClick = useRef<number | null>(null);
  const cancelPendingClick = (): void => {
    if (pendingClick.current !== null) window.clearTimeout(pendingClick.current);
    pendingClick.current = null;
  };
  useEffect(() => cancelPendingClick, []);
  // A double-click slower than that wait has already gone into the folder, so its
  // second click lands inside, on whatever is there. This is the folder it went
  // into, so that click can open the folder's page instead.
  const enteredByClick = useRef<{ id: string; name: string; at: number } | null>(null);
  /**
   * What a double-click does, the same for every kind: it opens on a page — a
   * folder on its own, anything else as a tab on its folder's.
   */
  const openRow = (row: FileRow, event?: OpenEvent, parent: SdlcFilesLocation = here): void => {
    if (row.kind === 'FOLDER') {
      props.onOpenFolderPage({ id: row.id, name: row.name }, event);
      return;
    }
    props.onOpenItem({ kind: row.kind, id: row.id }, parent, event);
  };
  const discussRow = (row: FileRow): void =>
    props.onDiscussItem({ kind: row.kind, id: row.id, name: row.name }, here);
  const moveInto = (
    items: MovingItem[],
    parent: { type: 'TRACK' | 'FOLDER'; id: string },
  ): void => {
    const movable = items.filter(item => item.id !== parent.id);
    if (movable.length === 0) return;
    props.onMoveItems(movable, parent);
    clearSelection();
  };
  const endDrag = (): void => {
    setDragging(null);
    setDropFolderId(null);
    setDragSourceId(null);
  };
  const asMoving = (list: FileRow[]): MovingItem[] =>
    list.map(row => ({ type: row.kind, id: row.id }));
  /** What an action on this row applies to: the whole selection if the row is in it. */
  const actedOn = (row: FileRow): FileRow[] =>
    selectedIds.has(row.id) && selectedRows.length > 1 ? selectedRows : [row];
  // The folder whose icon is being picked. It opens once the menu that asked for it
  // has closed, so the menu's own close doesn't take the picker with it.
  const [iconFolder, setIconFolder] = useState<FileRow | null>(null);
  const pickIcon = (row: FileRow): void => {
    window.setTimeout(() => setIconFolder(row), 0);
  };
  /** A call about it: the picker, once the menu has closed, as with the icon picker. */
  const startCall = (row: FileRow): void => {
    const { onStartCall } = props;
    if (!onStartCall) return;
    window.setTimeout(() => onStartCall({ kind: row.kind, id: row.id, name: row.name }), 0);
  };
  /** Its Info, once the menu has closed, as with the icon picker. */
  const showInfo = (row: FileRow): void => {
    window.setTimeout(() => setInfoId(row.id), 0);
  };
  const cut = (list: FileRow[]): void => {
    if (list.length === 0) return;
    setClipboard({ items: asMoving(list), fromId: here.id });
    clearSelection();
  };
  const paste = (): void => {
    if (!clipboard || pasteBlocked !== null) return;
    moveInto(clipboard.items, { type: here.type, id: here.id });
    setClipboard(null);
  };

  // Keyboard: the cursor is state, not DOM focus, which stays on the list.
  useScope('sdlc-files', keyboardFocused);
  useEffect(() => {
    if (!keyboardFocused) return;
    if (focusedRowId !== null && rows.some(row => row.id === focusedRowId)) return;
    const first = rows[0];
    if (first) setFocusedRowId(first.id);
  }, [keyboardFocused, focusedRowId, rows]);
  const focusedIndex = rows.findIndex(row => row.id === focusedRowId);
  const focusedRow = focusedIndex === -1 ? null : (rows[focusedIndex] ?? null);
  // Rows that stay in the page while scrolled out of view: the one being dragged,
  // since the drag ends on it; the one being renamed, whose field has the focus; and
  // the one whose ⋯ menu is open, since the menu is placed against it.
  const keptIndexes = useMemo(
    () =>
      [dragSourceId, renamingId, menuRow?.id ?? null]
        .map(id => (id === null ? -1 : rows.findIndex(row => row.id === id)))
        .filter(index => index !== -1),
    [dragSourceId, renamingId, menuRow, rows],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => rowsFade.node.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: index => rows[index]?.id ?? index,
    overscan: ROW_OVERSCAN,
    paddingStart: LIST_PADDING,
    paddingEnd: LIST_PADDING,
    rangeExtractor: range => {
      const indexes = defaultRangeExtractor(range);
      const extra = keptIndexes.filter(index => !indexes.includes(index));
      return extra.length === 0 ? indexes : [...indexes, ...extra].sort((a, b) => a - b);
    },
  });
  const moveFocus = (delta: number): void => {
    if (rows.length === 0) return;
    const from = focusedIndex === -1 ? (delta > 0 ? -1 : rows.length) : focusedIndex;
    const index = Math.min(rows.length - 1, Math.max(0, from + delta));
    const next = rows[index];
    if (!next) return;
    setCursorVisible(true);
    setFocusedRowId(next.id);
    // At either end, all the way, padding included, so the fade there goes.
    if (index === 0) virtualizer.scrollToOffset(0);
    else if (index === rows.length - 1) virtualizer.scrollToOffset(virtualizer.getTotalSize());
    else virtualizer.scrollToIndex(index, { align: 'auto' });
  };
  // Opening a row's discussions brings the row into view, smoothly — whether they were
  // opened from the row, from the panel's list or by a link. Left where it is when it
  // is already clear of the faded edges; otherwise centred.
  const revealedId = useRef<string | null>(null);
  const discussingId = props.discussingId;
  useEffect(() => {
    if (!discussingId) {
      revealedId.current = null;
      return;
    }
    if (revealedId.current === discussingId) return;
    const index = rows.findIndex(row => row.id === discussingId);
    const scroller = rowsFade.node.current;
    if (index === -1 || !scroller) return;
    revealedId.current = discussingId;
    const top = LIST_PADDING + index * ROW_HEIGHT;
    const inView =
      top >= scroller.scrollTop + ROWS_FADE_PX &&
      top + ROW_HEIGHT <= scroller.scrollTop + scroller.clientHeight - ROWS_FADE_PX;
    if (!inView) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
  }, [discussingId, rows, rowsFade.node, virtualizer]);
  const bind = { enabled: keyboardFocused && renamingId === null && !contextMenuOpen };
  useShortcutById('files.down', () => moveFocus(1), bind);
  useShortcutById('files.up', () => moveFocus(-1), bind);
  useShortcutById(
    'files.into',
    () => {
      if (focusedRow?.kind !== 'FOLDER') return;
      setCursorVisible(true);
      enterFolder(focusedRow);
    },
    bind,
  );
  useShortcutById(
    'files.out',
    () => {
      if (props.path.length === 0) return;
      setCursorVisible(true);
      goTo(props.path.length - 1);
    },
    bind,
  );
  useShortcutById(
    'files.open',
    () => {
      if (focusedRow) openRow(focusedRow);
    },
    bind,
  );
  useShortcutById(
    'files.openInWindow',
    event => {
      if (focusedRow) openRow(focusedRow, event);
    },
    bind,
  );
  const startRename = (row: FileRow): void => {
    renameAbandoned.current = false;
    setRenameDraft(row.name);
    setRenamingId(row.id);
  };
  useShortcutById(
    'files.rename',
    () => {
      if (focusedRow) startRename(focusedRow);
    },
    bind,
  );
  useShortcutById(
    'files.preview',
    () => {
      if (focusedRow?.kind === 'CANVAS') props.onPreviewCanvas(focusedRow.id, focusedRow.name);
    },
    bind,
  );
  useShortcutById('files.newFolder', () => props.onNewFolder(here), bind);
  useShortcutById('files.newArtifact', () => props.onNewArtifact(here), bind);
  useShortcutById(
    'files.discuss',
    () => {
      if (focusedRow) discussRow(focusedRow);
      else if (here.type === 'FOLDER')
        props.onDiscussItem({ kind: 'FOLDER', id: here.id, name: here.name }, here);
    },
    bind,
  );
  useShortcutById('files.trackDiscuss', () => props.onDiscussTrack(), bind);
  useShortcutById(
    'files.select',
    () => {
      if (focusedRow) toggleRow(focusedRow, false);
    },
    bind,
  );
  useShortcutById('files.selectAll', () => setSelectedIds(new Set(rows.map(row => row.id))), bind);
  useShortcutById('files.clearSelection', clearSelection, { enabled: bind.enabled && selecting });
  useShortcutById(
    'files.cut',
    () => cut(selecting ? selectedRows : focusedRow ? [focusedRow] : []),
    bind,
  );
  useShortcutById('files.paste', paste, bind);

  const addMenu = (
    <Popover
      open={addOpen}
      onOpenChange={setAddOpen}
      align='end'
      sideOffset={6}
      className='w-[180px] p-1'
      trigger={
        <button
          type='button'
          aria-label='New'
          className={TOOLBAR_ICON_PRIMARY}
          data-track-category='SdlcHub'
          data-track-name='FilesAddOpened'
        >
          <Plus className='size-4' strokeWidth={2} />
        </button>
      }
    >
      {(
        [
          {
            label: 'New artifact',
            icon: FileText,
            track: 'NewArtifactOpened',
            run: props.onNewArtifact,
          },
          {
            label: 'Upload file',
            icon: Upload,
            track: 'UploadFileOpened',
            run: props.onUploadFile,
          },
          { label: 'Add link', icon: Link2, track: 'AddLinkOpened', run: props.onAddLink },
          { label: 'New folder', icon: Folder, track: 'NewFolderOpened', run: props.onNewFolder },
        ] as const
      ).map(action => (
        <button
          key={action.label}
          type='button'
          onClick={() => {
            setAddOpen(false);
            action.run(here);
          }}
          className={MENU_ITEM}
          data-track-category='SdlcHub'
          data-track-name={action.track}
        >
          <action.icon className='size-3.5 shrink-0 text-muted-foreground' />
          {action.label}
        </button>
      ))}
    </Popover>
  );

  /** Everything a row can do: the ⋯ menu and the right-click menu are the same list. */
  const rowMenuItems = (row: FileRow): ReactElement => {
    const targets = actedOn(row);
    const many = targets.length > 1;
    return (
      <>
        <FilesMenuItem
          disabled={many}
          onSelect={() => openRow(row)}
          data-track-category='SdlcHub'
          data-track-name='FilesRowOpened'
        >
          {row.kind === 'FOLDER' ? (
            <FolderOpen className='size-4 text-muted-foreground' />
          ) : (
            <FileText className='size-4 text-muted-foreground' />
          )}
          Open
          <ShortcutHint shortcut='files.open' className='ml-auto text-xs' />
        </FilesMenuItem>
        <FilesMenuItem
          disabled={many}
          onSelect={() => openRow(row, { metaKey: true, ctrlKey: false })}
          data-track-category='SdlcHub'
          data-track-name='FilesOpenedInWindow'
        >
          <SquareArrowOutUpRight className='size-4 text-muted-foreground' />
          {isElectronApp() ? 'Open in new window' : 'Open in new tab'}
          <ShortcutHint shortcut='files.openInWindow' className='ml-auto text-xs' />
        </FilesMenuItem>
        <FilesMenuItem
          disabled={many}
          onSelect={() => discussRow(row)}
          data-track-category='SdlcHub'
          data-track-name='FilesRowChatOpened'
        >
          <MessageCircle className='size-4 text-muted-foreground' />
          Discussions
          <ShortcutHint shortcut='files.discuss' className='ml-auto text-xs' />
        </FilesMenuItem>
        {props.onStartCall && (
          <FilesMenuItem
            disabled={many}
            onSelect={() => startCall(row)}
            data-track-category='SdlcHub'
            data-track-name='FilesStartCallOpened'
            data-track-metadata={JSON.stringify({ kind: row.kind })}
          >
            <PhoneDefault size={16} className='text-muted-foreground' />
            Start a call
          </FilesMenuItem>
        )}
        <FilesMenuItem
          disabled={many}
          onSelect={() => showInfo(row)}
          data-track-category='SdlcHub'
          data-track-name='FilesInfoOpened'
          data-track-metadata={JSON.stringify({ kind: row.kind })}
        >
          <Info className='size-4 text-muted-foreground' />
          Info
        </FilesMenuItem>
        <DropdownMenuSeparator />
        <FilesMenuItem
          onSelect={() => cut(targets)}
          data-track-category='SdlcHub'
          data-track-name='FilesCut'
          data-track-metadata={JSON.stringify({ count: targets.length })}
        >
          <Scissors className='size-4 text-muted-foreground' />
          {many ? `Cut ${targets.length} items` : 'Cut'}
          <ShortcutHint shortcut='files.cut' className='ml-auto text-xs' />
        </FilesMenuItem>
        {!many && (
          <FilesMenuItem
            onSelect={() => startRename(row)}
            data-track-category='SdlcHub'
            data-track-name='FilesRenameOpened'
            data-track-metadata={JSON.stringify({ kind: row.kind })}
          >
            <Pencil className='size-4 text-muted-foreground' />
            Rename
            <ShortcutHint shortcut='files.rename' className='ml-auto text-xs' />
          </FilesMenuItem>
        )}
        {row.kind === 'FOLDER' && !many && (
          <FilesMenuItem
            onSelect={() => pickIcon(row)}
            data-track-category='SdlcHub'
            data-track-name='FolderIconPickerOpened'
          >
            <Shapes className='size-4 text-muted-foreground' />
            {row.folderIcon ? 'Change icon' : 'Add icon'}
          </FilesMenuItem>
        )}
        <DropdownMenuSeparator />
        <FilesMenuItem
          onSelect={() => toggleRow(row, false)}
          data-track-category='SdlcHub'
          data-track-name='FilesRowSelected'
        >
          <SquareCheck className='size-4 text-muted-foreground' />
          {selectedIds.has(row.id) ? 'Deselect' : 'Select'}
          <ShortcutHint shortcut='files.select' className='ml-auto text-xs' />
        </FilesMenuItem>
      </>
    );
  };

  /** Right-clicking the list itself, not a row: what can be made or put here. */
  const folderMenuItems = (
    <>
      <FilesMenuItem
        onSelect={() => props.onNewArtifact(here)}
        data-track-category='SdlcHub'
        data-track-name='NewArtifactOpened'
      >
        <FileText className='size-4 text-muted-foreground' />
        New artifact
        <ShortcutHint shortcut='files.newArtifact' className='ml-auto text-xs' />
      </FilesMenuItem>
      <FilesMenuItem
        onSelect={() => props.onNewFolder(here)}
        data-track-category='SdlcHub'
        data-track-name='NewFolderOpened'
      >
        <Folder className='size-4 text-muted-foreground' />
        New folder
        <ShortcutHint shortcut='files.newFolder' className='ml-auto text-xs' />
      </FilesMenuItem>
      <FilesMenuItem
        onSelect={() => props.onUploadFile(here)}
        data-track-category='SdlcHub'
        data-track-name='UploadFileOpened'
      >
        <Upload className='size-4 text-muted-foreground' />
        Upload file
      </FilesMenuItem>
      <FilesMenuItem
        onSelect={() => props.onAddLink(here)}
        data-track-category='SdlcHub'
        data-track-name='AddLinkOpened'
      >
        <Link2 className='size-4 text-muted-foreground' />
        Add link
      </FilesMenuItem>
      <DropdownMenuSeparator />
      <FilesMenuItem
        disabled={pasteBlocked !== null}
        onSelect={paste}
        data-track-category='SdlcHub'
        data-track-name='FilesPasted'
      >
        <ClipboardPaste className='size-4 text-muted-foreground' />
        {clipboard && clipboard.items.length > 1
          ? `Paste ${clipboard.items.length} items`
          : 'Paste'}
        <ShortcutHint shortcut='files.paste' className='ml-auto text-xs' />
      </FilesMenuItem>
    </>
  );

  const rowMenu = (row: FileRow): ReactElement => (
    <DropdownMenu
      open={menuRow?.id === row.id && menuRow.open}
      onOpenChange={open =>
        setMenuRow(current =>
          open ? { id: row.id, open: true } : current && { ...current, open: false },
        )
      }
    >
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          title='More'
          aria-label={`More for ${row.name}`}
          className={ROW_ACTION}
          data-track-category='SdlcHub'
          data-track-name='FilesRowMenuOpened'
        >
          <MoreHorizontal className='size-4' />
        </button>
      </DropdownMenuTrigger>
      {/* No focus hand-back on close: Rename's field has to keep the focus it takes.
        Called once the menu has faded out, so the button can let go then. */}
      <DropdownMenuContent
        align='end'
        className='w-56'
        onCloseAutoFocus={event => {
          event.preventDefault();
          setMenuRow(current => (current?.id === row.id && !current.open ? null : current));
        }}
      >
        {rowMenuItems(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div ref={containerRef} className='relative flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 pb-3'>
        <Breadcrumbs
          trail={trail}
          onGo={index => goTo(index)}
          dragging={dragging !== null}
          onDropOn={location => {
            if (dragging) moveInto(dragging, location);
            endDrag();
          }}
          channelId={props.channelId}
          liveCallCounts={props.liveCallCounts}
          onPick={(index, row) => {
            const location = trail[index] ?? trackStep;
            if (row.kind === 'FOLDER') {
              setFocusedRowId(null);
              props.onNavigate([
                ...props.path.slice(0, index),
                { type: 'FOLDER', id: row.id, name: row.name, icon: row.folderIcon },
              ]);
              return;
            }
            openRow(row, undefined, location);
          }}
        />
        {/* Wherever you are, in the editor: the explorer and tabs, as double-clicking
          a folder opens it. At the top, the track's own. */}
        <Tooltip content='Open in editor' delayDuration={TOOLTIP_DELAY_MS}>
          <button
            type='button'
            aria-label={`Open ${here.name} in the editor`}
            onClick={event => props.onOpenFolderPage({ id: here.id, name: here.name }, event)}
            className={TOOLBAR_ICON}
            data-track-category='SdlcHub'
            data-track-name='FolderPageOpenedFromToolbar'
          >
            <PanelsTopLeft className='size-4' />
          </button>
        </Tooltip>
        {/* The conversations about wherever you are: this folder's, or at the top
          the track's own. */}
        <ShortcutTooltip
          label='Discussions'
          delayDuration={TOOLTIP_DELAY_MS}
          shortcut={here.type === 'FOLDER' ? 'files.discuss' : 'files.trackDiscuss'}
        >
          <button
            type='button'
            aria-label='Discussions'
            aria-pressed={props.discussingId === here.id}
            onClick={() =>
              here.type === 'FOLDER'
                ? props.onDiscussItem({ kind: 'FOLDER', id: here.id, name: here.name }, here)
                : props.onDiscussTrack()
            }
            className={cn(TOOLBAR_ICON, props.discussingId === here.id && 'bg-muted')}
            data-track-category='SdlcHub'
            data-track-name='FolderConversationsOpened'
          >
            <MessageCircle className='size-4' />
          </button>
        </ShortcutTooltip>
        {clipboard && (
          // While something is cut: where to put it, or to change your mind.
          <div className='flex h-[30px] shrink-0 items-center rounded-lg border border-border'>
            <button
              type='button'
              onClick={paste}
              disabled={pasteBlocked !== null}
              title={pasteBlocked ?? `Move here (${clipboard.items.length})`}
              className='flex h-full items-center gap-1.5 rounded-l-lg px-3 text-[12.5px] font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
              data-track-category='SdlcHub'
              data-track-name='FilesPasted'
              data-track-metadata={JSON.stringify({ count: clipboard.items.length })}
            >
              <ClipboardPaste className='size-[14px]' />
              {clipboard.items.length === 1 ? 'Paste' : `Paste ${clipboard.items.length} items`}
            </button>
            <button
              type='button'
              onClick={() => setClipboard(null)}
              title='Cancel the cut'
              aria-label='Cancel the cut'
              className='flex h-full w-7 items-center justify-center rounded-r-lg border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='FilesCutCancelled'
            >
              <X className='size-3.5' />
            </button>
          </div>
        )}
        {/* The menu's own trigger can't also be the tooltip's, so the tooltip holds
          the whole menu. */}
        <Tooltip content='New' delayDuration={TOOLTIP_DELAY_MS} {...(addOpen && { open: false })}>
          <span className='flex shrink-0'>{addMenu}</span>
        </Tooltip>
      </div>

      <div
        ref={props.listRef}
        tabIndex={-1}
        onPointerDownCapture={() => {
          focusByPointer.current = true;
          setCursorVisible(false);
        }}
        onFocusCapture={() => {
          setKeyboardFocused(true);
          if (!focusByPointer.current) setCursorVisible(true);
          focusByPointer.current = false;
        }}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setKeyboardFocused(false);
          }
        }}
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          if (dragging) event.preventDefault();
        }}
        onDrop={event => {
          // Dropped on the list but not on a folder: it stays where it is.
          event.preventDefault();
          endDrag();
        }}
        onContextMenu={event => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, row: null, open: true });
        }}
        className='flex min-h-0 flex-1 flex-col outline-none'
      >
        <div
          style={{ gridTemplateColumns }}
          className={cn(
            'grid shrink-0 items-center gap-4 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground',
            showEmptyState && 'hidden',
          )}
        >
          <span className='flex min-w-0 items-center gap-3'>
            {/* Ticks every row here, in the same column as the rows' tick boxes. */}
            <span className='flex size-[18px] shrink-0 items-center justify-center'>
              <Checkbox
                checked={allSelected}
                indeterminate={selecting && !allSelected}
                onChange={checked =>
                  checked ? setSelectedIds(new Set(rows.map(row => row.id))) : clearSelection()
                }
                label=''
                ariaLabel={allSelected ? 'Deselect all' : 'Select all'}
                disabled={rows.length === 0}
                data-track-category='SdlcHub'
                data-track-name='FilesAllSelected'
              />
            </span>
            {/* Over the rows' icons, so the label sits over their names. */}
            <span className='size-5 shrink-0' aria-hidden='true' />
            Name
          </span>
          {showSize && <span>Size</span>}
          {showType && <span>Type</span>}
          <span>Updated</span>
        </div>

        <div
          ref={rowsFade.ref}
          onScroll={rowsFade.onScroll}
          style={rowsFade.style}
          // Pressing on no row lets go of the selection, as on a computer; Esc does
          // the same from the keyboard.
          onPointerDown={event => {
            if (event.target instanceof Element && !event.target.closest('[data-file-row]')) {
              clearSelection();
            }
          }}
          // A slow double-click on a folder: its first click went in, and its second
          // lands on whatever is now under the pointer. It opens the folder's page
          // instead of reaching the row or card there.
          onClickCapture={event => {
            // A first click starts afresh: the folder gone into before is no longer
            // what a second click would mean.
            const entered = event.detail < 2 ? null : enteredByClick.current;
            enteredByClick.current = null;
            if (!entered || event.timeStamp - entered.at > DOUBLE_CLICK_MS) return;
            event.preventDefault();
            event.stopPropagation();
            globalClickTracker.trackManualEvent('SdlcHub', ROW_TRACK_NAME.FOLDER, undefined, {
              id: entered.id,
            });
            props.onOpenFolderPage({ id: entered.id, name: entered.name });
          }}
          className='no-scrollbar min-h-0 flex-1 overflow-y-auto'
        >
          {/* One box as tall as every row, so rows arriving or leaving re-measure the
            fade; only those in view are drawn inside it. */}
          <div
            className={cn('relative', showEmptyState && 'h-full')}
            style={showEmptyState ? undefined : { height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map(item => {
              const row = rows[item.index];
              if (!row) return null;
              const focused = keyboardFocused && cursorVisible && focusedRowId === row.id;
              const selected = selectedIds.has(row.id);
              const discussing = props.discussingId === row.id;
              // A menu open on the row — its ⋯, or a right-click — takes the pointer
              // away from it, so the row keeps its hovered look until the menu closes.
              const menuOpen =
                menuRow?.id === row.id || (contextMenuOpen && contextMenu?.row?.id === row.id);
              // Kept in view without hover while they mean something: an open menu, or
              // the conversation on show being this item's.
              const pinActions = menuOpen || discussing;
              return (
                <div
                  key={row.id}
                  data-file-row={row.id}
                  draggable={renamingId !== row.id}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.id);
                    // Dragging a ticked row takes everything ticked with it.
                    setDragging(asMoving(selected ? selectedRows : [row]));
                    setDragSourceId(row.id);
                  }}
                  onDragEnd={endDrag}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    // The ⋯ menu's items, where the pointer is. A Ctrl-click on a Mac
                    // ends up here rather than ticking a box, so no run is pending.
                    extendSelection.current = false;
                    setFocusedRowId(row.id);
                    setContextMenu({ x: event.clientX, y: event.clientY, row, open: true });
                  }}
                  onDragOver={event => {
                    if (row.kind !== 'FOLDER' || !dragging) return;
                    if (dragging.some(item => item.id === row.id)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDropFolderId(row.id);
                  }}
                  onDragLeave={() => setDropFolderId(id => (id === row.id ? null : id))}
                  onDrop={event => {
                    if (row.kind !== 'FOLDER' || !dragging) return;
                    if (dragging.some(item => item.id === row.id)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    moveInto(dragging, { type: 'FOLDER', id: row.id });
                    endDrag();
                  }}
                  style={{ gridTemplateColumns, transform: `translateY(${item.start}px)` }}
                  className={cn(
                    'group absolute inset-x-0 top-0 grid h-10 select-none items-center gap-4 rounded-lg px-3 text-sm',
                    HIGHLIGHT_MOTION,
                    selected
                      ? 'bg-muted'
                      : menuOpen
                        ? 'bg-muted/60'
                        : discussing
                          ? 'bg-muted/50'
                          : 'hover:bg-muted/60',
                    focused && 'ring-1 ring-inset ring-foreground/25',
                    (dragging?.some(item => item.id === row.id) ||
                      (clipboard?.fromId === here.id && cutIds.has(row.id))) &&
                      'opacity-40',
                    dropFolderId === row.id && 'bg-muted ring-1 ring-inset ring-foreground/30',
                  )}
                >
                  <span className='flex min-w-0 items-center gap-3'>
                    {/* Its tick box, always there at the start of the row. Shift or
                      ⌘/Ctrl ticks a run of rows; the pointer-down, not the input,
                      says whether one was held — the click can reach the input
                      through its label, which doesn't carry the keys. */}
                    <span
                      onPointerDown={event => {
                        extendSelection.current = event.shiftKey || event.metaKey || event.ctrlKey;
                      }}
                      className='relative z-10 flex size-[18px] shrink-0 items-center justify-center'
                    >
                      <Checkbox
                        checked={selected}
                        onChange={() => {
                          toggleRow(row, extendSelection.current);
                          extendSelection.current = false;
                        }}
                        label=''
                        ariaLabel={`Select ${row.name}`}
                        data-track-category='SdlcHub'
                        data-track-name='FilesRowSelected'
                      />
                    </span>
                    <span className='flex size-5 shrink-0 items-center justify-center'>
                      <RowIcon
                        row={row}
                        brokenFavicon={brokenFavicons.has(row.id)}
                        onFaviconError={() =>
                          setBrokenFavicons(current => new Set(current).add(row.id))
                        }
                      />
                    </span>
                    {renamingId === row.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        maxLength={row.kind === 'FOLDER' ? 120 : 300}
                        onChange={event => setRenameDraft(event.target.value)}
                        // A file's name is picked without its extension, which it keeps.
                        onFocus={event => {
                          const dot =
                            row.kind === 'ATTACHMENT' ? event.target.value.lastIndexOf('.') : -1;
                          event.target.setSelectionRange(
                            0,
                            dot > 0 ? dot : event.target.value.length,
                          );
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            renameAbandoned.current = true;
                            setRenamingId(null);
                          }
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        onBlur={() => {
                          const next = renameDraft.trim();
                          setRenamingId(null);
                          if (renameAbandoned.current) {
                            renameAbandoned.current = false;
                            return;
                          }
                          if (next.length > 0 && next !== row.name) {
                            props.onRenameItem({ kind: row.kind, id: row.id }, next);
                          }
                        }}
                        className='relative z-10 min-w-0 flex-1 rounded border-0 bg-background px-1 text-sm font-medium text-foreground outline-none ring-1 ring-ring'
                        data-track-category='SdlcHub'
                        data-track-name='FilesItemRenamed'
                      />
                    ) : (
                      // The row's one control, stretched over the whole row, so a click
                      // anywhere that isn't the tick box or an action lands here. A click
                      // goes into a folder and selects anything else; a double-click
                      // opens either on its page, and ⌘/Ctrl-click does so in a new tab.
                      // Shift ticks a run of rows.
                      <button
                        type='button'
                        tabIndex={-1}
                        onClick={event => {
                          setFocusedRowId(row.id);
                          cancelPendingClick();
                          if (event.metaKey || event.ctrlKey) {
                            globalClickTracker.trackManualEvent(
                              'SdlcHub',
                              ROW_TRACK_NAME[row.kind],
                              undefined,
                              { id: row.id, newTab: true },
                            );
                            openRow(row, event);
                            return;
                          }
                          if (event.shiftKey) {
                            toggleRow(row, true);
                            return;
                          }
                          // The second click of a double-click: the first one's action
                          // was still waiting, and never happens.
                          if (event.detail >= 2) {
                            globalClickTracker.trackManualEvent(
                              'SdlcHub',
                              ROW_TRACK_NAME[row.kind],
                              undefined,
                              { id: row.id },
                            );
                            openRow(row);
                            return;
                          }
                          pendingClick.current = window.setTimeout(() => {
                            pendingClick.current = null;
                            if (row.kind !== 'FOLDER') {
                              selectOnly(row);
                              return;
                            }
                            enteredByClick.current = {
                              id: row.id,
                              name: row.name,
                              at: performance.now(),
                            };
                            enterFolder(row);
                          }, SINGLE_CLICK_DELAY_MS);
                        }}
                        title={row.name}
                        className={cn(
                          'min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg',
                          row.kind === 'FOLDER' && 'font-medium',
                        )}
                        data-track-category='SdlcHub'
                        data-track-name='FilesRowClicked'
                        data-track-metadata={JSON.stringify({ kind: row.kind })}
                      >
                        {row.name}
                      </button>
                    )}
                    {renamingId !== row.id && (
                      <ActivityPill
                        live={props.liveCallCounts.get(row.id)}
                        place={row.name}
                        onClick={() => discussRow(row)}
                        trackName='FilesLiveCallOpened'
                        className='ml-2'
                      />
                    )}
                  </span>
                  {showSize && (
                    <span className='truncate tabular-nums text-muted-foreground'>
                      {row.size === null ? null : formatFileSize(row.size)}
                    </span>
                  )}
                  {showType && (
                    <span className='truncate text-muted-foreground'>{row.typeLabel}</span>
                  )}
                  <span
                    className={cn(
                      'truncate tabular-nums text-muted-foreground',
                      pinActions ? 'invisible' : 'group-hover:invisible',
                    )}
                  >
                    {formatUpdated(row.updatedAt)}
                  </span>
                  {/* On hover, in place of the date: this item's conversations, and the
                    rest of what can be done with it. */}
                  <span
                    className={cn(
                      'absolute inset-y-0 right-2 z-10 items-center gap-0.5',
                      pinActions ? 'flex' : 'hidden group-hover:flex',
                    )}
                  >
                    <button
                      type='button'
                      title='Discussions'
                      aria-label={`Discussions about ${row.name}`}
                      aria-pressed={discussing}
                      onClick={() => discussRow(row)}
                      className={cn(
                        ROW_ACTION,
                        discussing && 'bg-background text-foreground shadow-xs',
                      )}
                      data-track-category='SdlcHub'
                      data-track-name='FilesRowChatOpened'
                      data-track-metadata={JSON.stringify({ kind: row.kind })}
                    >
                      <MessageCircle className='size-4' />
                    </button>
                    {rowMenu(row)}
                  </span>
                </div>
              );
            })}

            {showEmptyState && (
              <FilesEmptyState
                here={here}
                onNewArtifact={() => props.onNewArtifact(here)}
                onUploadFile={() => props.onUploadFile(here)}
                onAddLink={() => props.onAddLink(here)}
                onNewFolder={() => props.onNewFolder(here)}
              />
            )}
            {/* Room under the last row, so the selection bar never covers it. */}
            {selecting && <div className='h-16' aria-hidden='true' />}
          </div>
        </div>
      </div>

      {selecting && (
        <div className='pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center'>
          <div
            role='toolbar'
            aria-label='Selected items'
            className='pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-popover p-1 pl-3 text-sm text-popover-foreground shadow-lg'
          >
            <span className='pr-2 tabular-nums'>{selectedRows.length} selected</span>
            <span className='h-5 w-px bg-border' aria-hidden='true' />
            {selectedRows.length === 1 && selectedRows[0] && (
              <Button
                size='sm'
                variant='ghost'
                onClick={() => {
                  const [only] = selectedRows;
                  if (only) discussRow(only);
                }}
                data-track-category='SdlcHub'
                data-track-name='FilesSelectionChatOpened'
              >
                <MessageCircle />
                Discussions
              </Button>
            )}
            <Button
              size='sm'
              variant='ghost'
              onClick={() => cut(selectedRows)}
              title='Cut, then paste in another folder'
              data-track-category='SdlcHub'
              data-track-name='FilesCut'
              data-track-metadata={JSON.stringify({ count: selectedRows.length })}
            >
              <Scissors />
              Cut
              <ShortcutHint shortcut='files.cut' className='text-xs' />
            </Button>
            <button
              type='button'
              onClick={clearSelection}
              title='Clear selection (Esc)'
              aria-label='Clear selection'
              className='flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='FilesSelectionCleared'
            >
              <X className='size-4' />
            </button>
          </div>
        </div>
      )}

      {/* The right-click menu, opened where the pointer is: a row's ⋯ items, or the folder's. */}
      <DropdownMenu
        open={contextMenuOpen}
        onOpenChange={open => {
          if (!open) setContextMenu(menu => menu && { ...menu, open: false });
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden='true'
            className='pointer-events-none fixed size-0'
            style={{ left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          sideOffset={2}
          className='w-56'
          onCloseAutoFocus={event => event.preventDefault()}
        >
          {contextMenu?.row ? rowMenuItems(contextMenu.row) : folderMenuItems}
        </DropdownMenuContent>
      </DropdownMenu>

      <SdlcItemInfoDialog
        item={infoRow?.item ?? null}
        typeLabel={infoRow?.typeLabel ?? ''}
        icon={
          infoRow && (
            <RowIcon
              row={infoRow}
              brokenFavicon={brokenFavicons.has(infoRow.id)}
              onFaviconError={() => setBrokenFavicons(current => new Set(current).add(infoRow.id))}
            />
          )
        }
        location={trail}
        onClose={() => setInfoId(null)}
      />

      {iconFolder && (
        <IconPicker
          open
          onOpenChange={open => {
            if (!open) setIconFolder(null);
          }}
          value={iconFolder.folderIcon}
          onChange={icon => props.onSetFolderIcon(iconFolder.id, icon)}
          subject='folder'
          hint='Shown beside the folder’s name, wherever it appears.'
          trackCategory='SdlcHub'
          trackPrefix='Folder'
        />
      )}
    </div>
  );
}
