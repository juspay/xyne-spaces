import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  MessageCircle,
  Paperclip,
  Plus,
  Upload,
} from 'lucide-react';
import { fileKind, formatFileSize } from './fileKind';
import { compareTreeNodes } from './SdlcFolderPage';
import { useScope, useShortcutById } from '../../shortcuts';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Popover } from '../../components/ui/Popover';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';

const FINDER_MIN_COLUMN_WIDTH = 244;
const FINDER_MAX_COLUMN_WIDTH = 560;
const FINDER_DEFAULT_COLUMN_WIDTH = 248;

function RowIcon(props: {
  icon: ComponentType<{ className?: string }>;
  className?: string;
}): ReactElement {
  const Icon = props.icon;
  return <Icon {...(props.className === undefined ? {} : { className: props.className })} />;
}

const FINDER_ROW_TRACK_NAME: Record<SdlcFinderNodeType, string> = {
  FOLDER: 'FolderOpened',
  CANVAS: 'FinderCanvasOpened',
  LINK: 'FinderLinkOpened',
  ATTACHMENT: 'FinderFileOpened',
};

export type SdlcFinderNodeType = 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';

interface ContainmentEdge {
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface SdlcFinderFolder {
  id: string;
  name: string;
}

interface FinderRow {
  kind: SdlcFinderNodeType;
  id: string;
  name: string;
  meta: string | null;
  createdBy: string | null;
  /** Where a link or an uploaded file opens. Folders and artifacts open in-app. */
  href: string | null;
  /** A link's favicon, when the page offered one. */
  iconUrl: string | null;
  /** A file's icon, chosen from its mime type. */
  icon: ComponentType<{ className?: string }> | null;
}

export interface SdlcFinderLink {
  id: string;
  title: string;
  url: string;
  description: string | null;
  favicon: string | null;
  createdBy: string;
  createdAt: number;
}

export interface SdlcFinderFile {
  id: string;
  name: string;
  url: string;
  mimetype: string;
  size: number;
  createdBy: string;
  createdAt: number;
}

export interface SdlcFinderCanvas {
  id: string;
  title: string;
  typeName: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastEditedBy?: string | undefined;
  lastEditedAt?: number | undefined;
}

export interface SdlcFinderStep {
  type: 'TRACK' | 'FOLDER';
  id: string;
  name: string;
}

export function SdlcFinderColumn(props: {
  channelId: string;
  parent: SdlcFinderStep;
  selectedId: string | null;
  activeSelectionId: string | null;
  canvasById: Map<string, SdlcFinderCanvas>;
  linkById: ReadonlyMap<string, SdlcFinderLink>;
  fileById: ReadonlyMap<string, SdlcFinderFile>;
  previewItemId: string | null;
  onPreviewItem: (item: { kind: 'LINK' | 'ATTACHMENT'; id: string }) => void;
  isLast: boolean;
  onSelectFolder: (folder: { id: string; name: string }) => void;
  onOpenFolderPage: (
    folder: { id: string; name: string },
    event?: { metaKey: boolean; ctrlKey: boolean },
  ) => void;
  onOpenItem: (
    item: { kind: 'LINK' | 'ATTACHMENT'; id: string },
    parent: SdlcFinderStep,
    event?: { metaKey: boolean; ctrlKey: boolean },
  ) => void;
  onSelectCanvas: (canvasId: string) => void;
  onOpenCanvas: (canvasId: string, event?: { metaKey: boolean; ctrlKey: boolean }) => void;
  previewCanvasId: string | null;
  onNewFolder: (parent: SdlcFinderStep) => void;
  onNewArtifact: (parent: SdlcFinderStep) => void;
  onUploadFile: (parent: SdlcFinderStep) => void;
  onAddLink: (parent: SdlcFinderStep) => void;
  onDiscussFolder: (folder: { id: string; name: string }) => void;
  onDiscussTrack: () => void;
  onPreviewCanvas: (canvasId: string) => void;
  folderById: ReadonlyMap<string, SdlcFinderFolder>;
  discussingFolderId: string | null;
  onRenameFolder: (folderId: string, name: string) => void;
  onMoveItem: (
    item: { type: SdlcFinderNodeType; id: string },
    parent: { type: 'TRACK' | 'FOLDER'; id: string },
  ) => void;
  draggingItem: { type: SdlcFinderNodeType; id: string } | null;
  onDragItem: (item: { type: SdlcFinderNodeType; id: string } | null) => void;
}): ReactElement {
  const columnWidths = useUserPreference('sdlcFinderColumnWidths');
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const columnWidth = dragWidth ?? columnWidths[props.parent.id] ?? FINDER_DEFAULT_COLUMN_WIDTH;
  const groupBy = useUserPreference('sdlcFinderGroupBy');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [brokenIcons, setBrokenIcons] = useState<ReadonlySet<string>>(() => new Set());
  const [columnDragOver, setColumnDragOver] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameAbandoned = useRef(false);
  const columnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (props.isLast) {
      columnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
    }
  }, [props.isLast, props.parent.id]);

  useEffect(() => {
    if (!props.draggingItem) setDragOverId(null);
  }, [props.draggingItem]);

  const startColumnResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth;
    let latest = startWidth;

    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      latest = Math.min(
        FINDER_MAX_COLUMN_WIDTH,
        Math.max(FINDER_MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX)),
      );
      setDragWidth(latest);
    };
    const finish = (): void => {
      setUserPreference('sdlcFinderColumnWidths', { ...columnWidths, [props.parent.id]: latest });
      setDragWidth(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.setProperty('cursor', 'col-resize');
    document.body.style.setProperty('user-select', 'none');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const [edgeRows] = useCachedQuery(
    queries.getSdlcFolderChildren({
      channelId: props.channelId,
      parentType: props.parent.type,
      parentId: props.parent.id,
    }),
    { enabled: Boolean(props.channelId && props.parent.id) },
  );
  const edges: ContainmentEdge[] = Array.isArray(edgeRows) ? (edgeRows as ContainmentEdge[]) : [];

  const folderById = props.folderById;

  const rows = useMemo(
    () =>
      edges
        .flatMap<FinderRow>(edge => {
          if (edge.targetType === 'FOLDER') {
            const folder = folderById.get(edge.targetId);
            if (!folder) return [];
            return [
              {
                kind: 'FOLDER' as const,
                id: folder.id,
                name: folder.name,
                meta: null,
                createdBy: null,
                href: null,
                iconUrl: null,
                icon: null,
              },
            ];
          }
          if (edge.targetType === 'LINK') {
            const link = props.linkById.get(edge.targetId);
            if (!link) return [];
            return [
              {
                kind: 'LINK' as const,
                id: link.id,
                name: link.title.trim() || link.url,
                meta: 'Link',
                createdBy: link.createdBy,
                href: link.url,
                iconUrl: link.favicon,
                icon: null,
              },
            ];
          }
          if (edge.targetType === 'ATTACHMENT') {
            const file = props.fileById.get(edge.targetId);
            if (!file) return [];
            return [
              {
                kind: 'ATTACHMENT' as const,
                id: file.id,
                name: file.name,
                meta: fileKind(file.mimetype, file.name).label,
                createdBy: file.createdBy,
                href: file.url,
                iconUrl: null,
                icon: fileKind(file.mimetype, file.name).icon,
              },
            ];
          }
          const canvas = props.canvasById.get(edge.targetId);
          if (!canvas) return [];
          return [
            {
              kind: 'CANVAS' as const,
              id: canvas.id,
              name: canvas.title,
              meta: canvas.typeName,
              createdBy: canvas.createdBy,
              href: null,
              iconUrl: null,
              icon: null,
            },
          ];
        })
        .sort(compareTreeNodes),
    [edges, folderById, props.canvasById, props.linkById, props.fileById],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ label: null, rows }];
    const byLabel = new Map<string, FinderRow[]>();
    for (const row of rows) {
      const label =
        row.kind === 'FOLDER'
          ? 'Folders'
          : row.kind === 'LINK'
            ? 'Links'
            : row.kind === 'ATTACHMENT'
              ? 'Files'
              : (row.meta ?? 'Artifacts');
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(row);
      else byLabel.set(label, [row]);
    }
    const labels = [...byLabel.keys()].sort((left, right) => {
      if (left === 'Folders') return -1;
      if (right === 'Folders') return 1;
      return left.localeCompare(right);
    });
    return labels.map(label => ({ label, rows: byLabel.get(label) ?? [] }));
  }, [groupBy, rows]);

  useScope('sdlc-finder', keyboardFocused);
  useEffect(() => {
    if (!keyboardFocused || focusedRowId !== null) return;
    const first = rows[0];
    if (first) setFocusedRowId(first.id);
  }, [keyboardFocused, focusedRowId, rows]);
  const focusedIndex = rows.findIndex(row => row.id === focusedRowId);
  const focusedRow = focusedIndex === -1 ? null : rows[focusedIndex];
  const moveFocus = (delta: number): void => {
    if (rows.length === 0) return;
    const from = focusedIndex === -1 ? (delta > 0 ? -1 : rows.length) : focusedIndex;
    const next = rows[Math.min(rows.length - 1, Math.max(0, from + delta))];
    if (!next) return;
    setFocusedRowId(next.id);
    columnRef.current
      ?.querySelector(`[data-finder-row="${next.id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  const focusColumn = (id: string): void => {
    let frames = 0;
    const tick = (): void => {
      const column = columnRef.current?.parentElement?.querySelector<HTMLElement>(
        `[data-finder-column="${id}"]`,
      );
      if (column) {
        column.focus();
        column.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        return;
      }
      if (frames < 12) {
        frames += 1;
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };
  const openFolder = (): void => {
    if (focusedRow?.kind !== 'FOLDER') return;
    props.onSelectFolder({ id: focusedRow.id, name: focusedRow.name });
  };
  const stepInto = (): void => {
    if (focusedRow?.kind !== 'FOLDER') return;
    const folder = { id: focusedRow.id, name: focusedRow.name };
    props.onSelectFolder(folder);
    focusColumn(folder.id);
  };
  const bind = { enabled: keyboardFocused };
  useShortcutById('finder.down', () => moveFocus(1), bind);
  useShortcutById('finder.up', () => moveFocus(-1), bind);
  useShortcutById('finder.into', stepInto, bind);
  useShortcutById(
    'finder.out',
    () => {
      let sibling = columnRef.current?.previousElementSibling;
      while (sibling && !(sibling instanceof HTMLElement && sibling.dataset['finderColumn'])) {
        sibling = sibling.previousElementSibling;
      }
      if (sibling instanceof HTMLElement) {
        sibling.focus();
        sibling.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    },
    bind,
  );
  useShortcutById(
    'finder.open',
    () => {
      if (!focusedRow) return;
      if (focusedRow.kind === 'FOLDER') {
        openFolder();
        return;
      }
      // A link or a file is not a canvas: opening one by its id as if it were
      // asked for an artifact that does not exist.
      if (focusedRow.kind === 'LINK' || focusedRow.kind === 'ATTACHMENT') {
        props.onOpenItem({ kind: focusedRow.kind, id: focusedRow.id }, props.parent);
        return;
      }
      props.onOpenCanvas(focusedRow.id);
    },
    bind,
  );
  useShortcutById(
    'finder.rename',
    () => {
      if (focusedRow?.kind !== 'FOLDER') return;
      renameAbandoned.current = false;
      setRenameDraft(focusedRow.name);
      setRenamingId(focusedRow.id);
    },
    bind,
  );
  useShortcutById(
    'finder.preview',
    () => {
      if (focusedRow?.kind === 'CANVAS') props.onPreviewCanvas(focusedRow.id);
    },
    bind,
  );
  useShortcutById(
    'finder.openInWindow',
    event => {
      if (focusedRow?.kind === 'LINK' || focusedRow?.kind === 'ATTACHMENT') {
        props.onOpenItem({ kind: focusedRow.kind, id: focusedRow.id }, props.parent, event);
        return;
      }
      if (focusedRow?.kind === 'CANVAS') props.onOpenCanvas(focusedRow.id, event);
    },
    bind,
  );
  useShortcutById('finder.newFolder', () => props.onNewFolder(props.parent), bind);
  useShortcutById('finder.newArtifact', () => props.onNewArtifact(props.parent), bind);
  useShortcutById(
    'finder.discuss',
    () => {
      const folder =
        focusedRow?.kind === 'FOLDER'
          ? { id: focusedRow.id, name: focusedRow.name }
          : props.parent.type === 'FOLDER'
            ? { id: props.parent.id, name: props.parent.name }
            : null;
      if (folder) props.onDiscussFolder(folder);
    },
    bind,
  );
  useShortcutById('finder.trackDiscuss', () => props.onDiscussTrack(), bind);

  return (
    <div
      tabIndex={-1}
      data-finder-column={props.parent.id}
      onFocusCapture={() => setKeyboardFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setKeyboardFocused(false);
        }
      }}
      onDragOver={event => {
        if (!props.draggingItem) return;
        event.preventDefault();
        setColumnDragOver(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setColumnDragOver(false);
        }
      }}
      onDrop={event => {
        event.preventDefault();
        setColumnDragOver(false);
        const dragged = props.draggingItem;
        if (!dragged) return;
        props.onMoveItem(dragged, { type: props.parent.type, id: props.parent.id });
        props.onDragItem(null);
      }}
      ref={columnRef}
      style={props.isLast ? { minWidth: FINDER_MIN_COLUMN_WIDTH } : { width: columnWidth }}
      className={cn(
        'relative flex shrink-0 flex-col border-r border-border outline-none transition-colors last:border-r-0',
        props.isLast && 'flex-1',
        props.draggingItem && columnDragOver && !dragOverId && 'bg-primary/[0.06]',
      )}
    >
      {/* A real step, not a theme surface: --card and --background are the same
          value in dark, so a tint the app already uses for its sidebar rows is
          what actually reads as a header here. */}
      <div className='flex shrink-0 items-center gap-2 border-b border-border bg-foreground/[0.05] px-3 py-1.5'>
        <span className='min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground'>
          {props.parent.name}
        </span>
        <span className='shrink-0 text-[10.5px] tabular-nums text-muted-foreground'>
          {rows.length}
        </span>
        {props.parent.type === 'FOLDER' && (
          <button
            type='button'
            title={`Conversations in ${props.parent.name}`}
            aria-label={`Conversations in ${props.parent.name}`}
            aria-pressed={props.discussingFolderId === props.parent.id}
            onClick={() => props.onDiscussFolder({ id: props.parent.id, name: props.parent.name })}
            className={cn(
              'shrink-0 rounded p-0.5 transition-colors',
              props.discussingFolderId === props.parent.id
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
            )}
            data-track-category='SdlcHub'
            data-track-name='FolderConversationsOpened'
          >
            <MessageCircle className='size-3.5' />
          </button>
        )}
        {/* Creating into *this* level, whatever it already holds. The empty state
            offers the same two actions, but a column with contents had no way to
            add to it except the page heading, whose target is not obvious. */}
        <Popover
          open={addOpen}
          onOpenChange={setAddOpen}
          align='end'
          sideOffset={6}
          className='w-[170px] p-1'
          trigger={
            <button
              type='button'
              title={`Add to ${props.parent.name}`}
              aria-label={`Add to ${props.parent.name}`}
              className='-mr-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='FinderColumnAddOpened'
            >
              <Plus className='size-3.5' />
            </button>
          }
        >
          <button
            type='button'
            onClick={() => {
              setAddOpen(false);
              props.onNewArtifact(props.parent);
            }}
            className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted'
            data-track-category='SdlcHub'
            data-track-name='NewArtifactOpened'
          >
            <FileText className='size-3.5 shrink-0 text-muted-foreground' />
            New artifact
          </button>
          <button
            type='button'
            onClick={() => {
              setAddOpen(false);
              props.onUploadFile(props.parent);
            }}
            className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted'
            data-track-category='SdlcHub'
            data-track-name='UploadFileOpened'
          >
            <Upload className='size-3.5 shrink-0 text-muted-foreground' />
            Upload file
          </button>
          <button
            type='button'
            onClick={() => {
              setAddOpen(false);
              props.onAddLink(props.parent);
            }}
            className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted'
            data-track-category='SdlcHub'
            data-track-name='AddLinkOpened'
          >
            <Link2 className='size-3.5 shrink-0 text-muted-foreground' />
            Add link
          </button>
          <button
            type='button'
            onClick={() => {
              setAddOpen(false);
              props.onNewFolder(props.parent);
            }}
            className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted'
            data-track-category='SdlcHub'
            data-track-name='NewFolderOpened'
          >
            <Folder className='size-3.5 shrink-0 text-muted-foreground' />
            New folder
          </button>
        </Popover>
      </div>

      {!props.isLast && (
        <div
          role='separator'
          aria-orientation='vertical'
          aria-label='Resize columns'
          onPointerDown={startColumnResize}
          className='group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize'
          data-track-category='SdlcHub'
          data-track-name='FinderColumnResized'
        >
          <div
            className='pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary opacity-0 transition-opacity duration-150 group-hover:opacity-70'
            aria-hidden='true'
          />
        </div>
      )}
      {/* Deep bottom padding, not a spacer row: the last item should never sit
          against the edge, and the slack scrolls away with the list. */}
      <div className='scrollbar-none min-h-0 flex-1 overflow-y-auto p-1.5 pb-[150px]'>
        {groups.map(group => (
          <div key={group.label ?? 'all'} className='mb-1 last:mb-0'>
            {group.label && (
              <div className='px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground'>
                {group.label}
              </div>
            )}
            {group.rows.map(row => {
              const selected =
                props.selectedId === row.id ||
                (row.kind === 'CANVAS' && props.previewCanvasId === row.id) ||
                props.previewItemId === row.id;
              const activeSelected =
                selected &&
                (row.id === props.activeSelectionId ||
                  props.previewCanvasId === row.id ||
                  props.previewItemId === row.id);
              return (
                <button
                  key={row.id}
                  type='button'
                  onClick={event => {
                    setFocusedRowId(row.id);
                    if (row.kind === 'FOLDER') {
                      if (event.metaKey || event.ctrlKey) {
                        props.onOpenFolderPage({ id: row.id, name: row.name }, event);
                        return;
                      }
                      props.onSelectFolder({ id: row.id, name: row.name });
                      return;
                    }
                    if (row.kind === 'LINK' || row.kind === 'ATTACHMENT') {
                      if (event.metaKey || event.ctrlKey) {
                        props.onOpenItem({ kind: row.kind, id: row.id }, props.parent, event);
                        return;
                      }
                      props.onPreviewItem({ kind: row.kind, id: row.id });
                      return;
                    }
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      props.onOpenCanvas(row.id, event);
                      return;
                    }
                    props.onSelectCanvas(row.id);
                  }}
                  onDoubleClick={event => {
                    if (row.kind === 'CANVAS') {
                      props.onOpenCanvas(row.id, event);
                      return;
                    }
                    if (row.kind === 'LINK' || row.kind === 'ATTACHMENT') {
                      props.onOpenItem({ kind: row.kind, id: row.id }, props.parent, event);
                      return;
                    }
                    if (row.kind !== 'FOLDER') return;
                    event.preventDefault();
                    props.onOpenFolderPage({ id: row.id, name: row.name });
                  }}
                  draggable={renamingId !== row.id}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.id);
                    props.onDragItem({ type: row.kind, id: row.id });
                  }}
                  onDragEnd={() => props.onDragItem(null)}
                  onDragOver={event => {
                    if (
                      row.kind === 'FOLDER' &&
                      props.draggingItem?.id &&
                      props.draggingItem?.id !== row.id
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragOverId(row.id);
                    }
                  }}
                  onDragLeave={() =>
                    setDragOverId(current => (current === row.id ? null : current))
                  }
                  onDrop={event => {
                    setDragOverId(null);
                    const dragged = props.draggingItem;
                    if (row.kind !== 'FOLDER' || !dragged || dragged.id === row.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onMoveItem(dragged, { type: 'FOLDER', id: row.id });
                    props.onDragItem(null);
                  }}
                  className={cn(
                    'mb-px flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors',
                    activeSelected && 'bg-primary text-primary-foreground',
                    selected &&
                      !activeSelected &&
                      'bg-foreground/[0.07] text-foreground ring-1 ring-inset ring-foreground/15',
                    !selected && 'hover:bg-muted',
                    props.draggingItem?.id === row.id && 'opacity-40',
                    dragOverId === row.id && 'ring-1 ring-inset ring-primary',
                    keyboardFocused &&
                      focusedRowId === row.id &&
                      (activeSelected
                        ? 'ring-2 ring-inset ring-primary-foreground/70'
                        : 'bg-foreground/[0.07] ring-2 ring-inset ring-foreground/40'),
                  )}
                  tabIndex={-1}
                  data-finder-row={row.id}
                  data-track-category='SdlcHub'
                  data-track-name={FINDER_ROW_TRACK_NAME[row.kind]}
                  data-track-metadata={JSON.stringify({ id: row.id })}
                >
                  {row.kind === 'FOLDER' ? (
                    <Folder
                      className={cn(
                        'size-[18px] shrink-0',
                        activeSelected ? 'fill-current' : 'fill-primary/25 text-primary/70',
                      )}
                    />
                  ) : row.kind === 'LINK' ? (
                    row.iconUrl && !brokenIcons.has(row.id) ? (
                      <img
                        src={row.iconUrl}
                        alt=''
                        className='size-[18px] shrink-0 rounded-sm object-contain'
                        onError={() => setBrokenIcons(current => new Set(current).add(row.id))}
                      />
                    ) : (
                      <Link2
                        className={cn(
                          'size-[18px] shrink-0',
                          activeSelected ? '' : 'text-muted-foreground',
                        )}
                      />
                    )
                  ) : row.kind === 'ATTACHMENT' ? (
                    <RowIcon
                      icon={row.icon ?? Paperclip}
                      className={cn(
                        'size-[18px] shrink-0',
                        activeSelected ? '' : 'text-muted-foreground',
                      )}
                    />
                  ) : (
                    <FileText
                      className={cn(
                        'size-[18px] shrink-0',
                        activeSelected ? '' : 'text-primary/70',
                      )}
                    />
                  )}
                  {renamingId === row.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      maxLength={120}
                      onChange={event => setRenameDraft(event.target.value)}
                      onClick={event => event.stopPropagation()}
                      onDoubleClick={event => event.stopPropagation()}
                      onFocus={event =>
                        event.target.setSelectionRange(0, event.target.value.length)
                      }
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
                          props.onRenameFolder(row.id, next);
                        }
                      }}
                      className='min-w-0 flex-1 rounded border-0 bg-background px-1 text-[12.5px] font-semibold leading-[18px] tracking-[-0.01em] text-foreground outline-none ring-1 ring-primary'
                      data-track-category='SdlcHub'
                      data-track-name='FolderRenamed'
                    />
                  ) : (
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[12.5px] leading-[18px] tracking-[-0.01em]',
                        row.kind === 'FOLDER' ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {row.name}
                    </span>
                  )}
                  {/* The type sits beside the name rather than beneath it, so a file
                  row is the same height as a folder row and the column keeps one
                  rhythm. */}
                  {row.meta && (
                    <span
                      className={cn(
                        'shrink-0 truncate text-[10.5px]',
                        activeSelected ? 'opacity-75' : 'text-muted-foreground',
                      )}
                    >
                      {row.meta}
                    </span>
                  )}
                  {row.createdBy && (
                    <Avatar userId={row.createdBy} size='xs' showActiveStatus={false} />
                  )}
                  {row.kind === 'FOLDER' && (
                    <ChevronRight
                      className={cn(
                        'size-3 shrink-0',
                        activeSelected ? '' : 'text-muted-foreground',
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {rows.length === 0 && (
          <div className='flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center'>
            <div className='grid size-9 place-items-center rounded-lg bg-foreground/[0.05]'>
              <FolderOpen className='size-4 text-muted-foreground' aria-hidden='true' />
            </div>
            <p className='text-[12.5px] font-medium text-foreground'>
              {props.parent.type === 'TRACK' ? 'Nothing here yet' : 'This folder is empty'}
            </p>
            <p className='max-w-[190px] text-[11.5px] leading-relaxed text-muted-foreground'>
              {props.parent.type === 'TRACK'
                ? 'Create an artifact, or add a folder to group them.'
                : 'Create an artifact here, or drag one in from another folder.'}
            </p>
            <div className='mt-1 flex items-center gap-1.5'>
              <button
                type='button'
                onClick={() => props.onNewArtifact(props.parent)}
                className='flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
                data-track-category='SdlcHub'
                data-track-name='NewArtifactOpened'
              >
                <Plus className='size-3' />
                New artifact
              </button>
              <button
                type='button'
                onClick={() => props.onNewFolder(props.parent)}
                className='flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted'
                data-track-category='SdlcHub'
                data-track-name='NewFolderOpened'
              >
                <Plus className='size-3' />
                New folder
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A link and an uploaded file have no page of their own, so the column that
 * previews an artifact previews them too — same shape, same place, so selecting
 * down a column does not change what the right-hand side means.
 */
export function SdlcFinderItemPreview(props: {
  item: { kind: 'LINK'; link: SdlcFinderLink } | { kind: 'ATTACHMENT'; file: SdlcFinderFile };
  onOpen: (href: string, event?: { metaKey: boolean; ctrlKey: boolean }) => void;
  onDiscuss: (item: { type: 'LINK' | 'ATTACHMENT'; id: string; name: string }) => void;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [iconBroken, setIconBroken] = useState(false);
  const item = props.item;
  const link = item.kind === 'LINK' ? item.link : null;
  const file = item.kind === 'ATTACHMENT' ? item.file : null;
  const entity = link ?? file;
  const owner = useUser(entity?.createdBy ?? '');
  const entityId = entity?.id;
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
  }, [entityId]);

  if (!entity) return <></>;

  const kind = file ? fileKind(file.mimetype, file.name) : null;
  const title = link ? link.title.trim() || link.url : (file?.name ?? '');
  const href = link ? link.url : (file?.url ?? '');
  const host = link
    ? (() => {
        try {
          return new URL(link.url).hostname.replace(/^www\./, '');
        } catch {
          return link.url;
        }
      })()
    : null;
  const when = new Date(entity.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div ref={panelRef} className='flex w-[300px] shrink-0 flex-col border-r border-border'>
      <div className='flex shrink-0 items-center border-b border-border bg-foreground/[0.05] px-3 py-1.5'>
        <span className='truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground'>
          Preview
        </span>
      </div>

      <div className='scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto p-4'>
        <div className='flex items-start gap-3'>
          <div className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10'>
            {link?.favicon && !iconBroken ? (
              <img
                src={link.favicon}
                alt=''
                className='size-5 rounded-sm object-contain'
                onError={() => setIconBroken(true)}
              />
            ) : (
              <RowIcon icon={kind?.icon ?? Link2} className='size-5 text-primary' />
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <p className='break-words text-[13.5px] font-semibold leading-snug'>{title}</p>
            <p className='mt-0.5 truncate text-[11.5px] text-muted-foreground'>
              {host ?? kind?.label ?? 'File'}
            </p>
          </div>
        </div>

        {/* An image says more than its own filename does. */}
        {file && file.mimetype.startsWith('image/') && (
          <img
            src={file.url}
            alt=''
            className='mt-3 max-h-[180px] w-full rounded-lg border border-border object-contain'
          />
        )}

        {link?.description && (
          <p className='mt-3 line-clamp-4 text-[11.5px] leading-relaxed text-muted-foreground'>
            {link.description}
          </p>
        )}

        <dl className='mt-4 space-y-2.5 border-t border-border pt-3'>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Type</dt>
            <dd className='min-w-0 truncate text-[11.5px] font-medium'>
              {link ? 'Link' : (kind?.label ?? 'File')}
            </dd>
          </div>
          {file && (
            <div className='flex items-center justify-between gap-3'>
              <dt className='shrink-0 text-[11px] text-muted-foreground'>Size</dt>
              <dd className='text-[11.5px] tabular-nums'>{formatFileSize(file.size)}</dd>
            </div>
          )}
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Added by</dt>
            <dd className='flex min-w-0 items-center gap-1.5'>
              <Avatar userId={entity.createdBy} size='xs' showActiveStatus={false} />
              <span className='min-w-0 truncate text-[11.5px]'>
                {owner ? getUserDisplayName(owner) : 'Unknown'}
              </span>
            </dd>
          </div>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Added</dt>
            <dd className='text-[11.5px] tabular-nums'>{when}</dd>
          </div>
        </dl>

        <div className='mt-auto flex items-center gap-1.5 pt-4'>
          <button
            type='button'
            onClick={event => props.onOpen(href, event)}
            className='h-8 flex-1 rounded-md bg-primary text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
            data-track-category='SdlcHub'
            data-track-name={link ? 'FinderLinkOpened' : 'FinderFileOpened'}
          >
            {link ? 'Open link' : 'Open file'}
          </button>
          {/* A link and a file carry conversations the way a folder does, so the
              panel that describes one is also where you start talking about it. */}
          <button
            type='button'
            onClick={() => props.onDiscuss({ type: item.kind, id: entity.id, name: title })}
            title='Conversations'
            aria-label='Conversations'
            className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            data-track-category='SdlcHub'
            data-track-name='FinderItemDiscussed'
          >
            <MessageCircle className='size-3.5' />
          </button>
        </div>
      </div>
    </div>
  );
}

export function SdlcFinderPreview(props: {
  canvas: SdlcFinderCanvas;
  onOpen: (canvasId: string, event?: ReactMouseEvent) => void;
  onPreview: (canvasId: string) => void;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const owner = useUser(props.canvas.createdBy);
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
  }, [props.canvas.id]);

  const when = (value: number | undefined): string =>
    value
      ? new Date(value).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  const edited = props.canvas.lastEditedAt ?? props.canvas.updatedAt;
  const editedBy = props.canvas.lastEditedBy ?? props.canvas.createdBy;

  return (
    <div ref={panelRef} className='flex w-[300px] shrink-0 flex-col border-r border-border'>
      <div className='flex shrink-0 items-center border-b border-border bg-foreground/[0.05] px-3 py-1.5'>
        <span className='truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground'>
          Preview
        </span>
      </div>

      <div className='scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto p-4'>
        <div className='flex items-start gap-3'>
          <div className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10'>
            <FileText className='size-5 text-primary' />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='text-[13.5px] font-semibold leading-snug'>{props.canvas.title}</p>
            <p className='mt-0.5 text-[11.5px] text-muted-foreground'>{props.canvas.typeName}</p>
          </div>
        </div>

        {/* The facts the hub already knows, rather than an icon and a title the
            row beside it has just shown. */}
        <dl className='mt-4 space-y-2.5 border-t border-border pt-3'>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Type</dt>
            <dd className='min-w-0 truncate text-[11.5px] font-medium'>{props.canvas.typeName}</dd>
          </div>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Owner</dt>
            {/* Named, not just pictured: an initial in a circle is not an answer
                to "who owns this". No hover card here — the panel is already the
                place you came to read the details. */}
            <dd className='flex min-w-0 items-center gap-1.5'>
              <Avatar userId={props.canvas.createdBy} size='xs' showActiveStatus={false} />
              <span className='min-w-0 truncate text-[11.5px]'>
                {owner ? getUserDisplayName(owner) : 'Unknown'}
              </span>
            </dd>
          </div>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Created</dt>
            <dd className='text-[11.5px] tabular-nums'>{when(props.canvas.createdAt)}</dd>
          </div>
          <div className='flex items-center justify-between gap-3'>
            <dt className='shrink-0 text-[11px] text-muted-foreground'>Last edited</dt>
            <dd className='flex items-center gap-1.5 text-[11.5px] tabular-nums'>
              {when(edited)}
              <Avatar userId={editedBy} size='xs' showActiveStatus={false} />
            </dd>
          </div>
        </dl>

        <div className='mt-auto flex items-center gap-1.5 pt-4'>
          <button
            type='button'
            onClick={() => props.onPreview(props.canvas.id)}
            title='Preview in a side panel'
            className='h-8 flex-1 rounded-md bg-primary text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90'
            data-track-category='SdlcHub'
            data-track-name='FinderPreviewPaneOpened'
          >
            Preview
          </button>
          <button
            type='button'
            onClick={event => props.onOpen(props.canvas.id, event)}
            title='Open the artifact'
            className='h-8 flex-1 rounded-md border border-border text-[12px] font-medium text-foreground transition-colors hover:bg-muted'
            data-track-category='SdlcHub'
            data-track-name='FinderPreviewOpened'
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
