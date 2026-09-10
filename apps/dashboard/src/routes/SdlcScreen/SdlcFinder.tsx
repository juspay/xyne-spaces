import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, MessageCircle, Plus } from 'lucide-react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Popover } from '../../components/ui/Popover';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';

/**
 * Column width bounds. The minimum is set by the empty state's two buttons: any
 * narrower and "New artifact" and "New folder" wrap onto separate lines.
 */
const FINDER_MIN_COLUMN_WIDTH = 244;
const FINDER_MAX_COLUMN_WIDTH = 560;
const FINDER_DEFAULT_COLUMN_WIDTH = 248;

/** What a column can show. Anything else on the edge is not a tree node. */
export type SdlcFinderNodeType = 'FOLDER' | 'CANVAS';

/** The edge fields a column reads; the row type is wider than this. */
interface ContainmentEdge {
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface SdlcFinderFolder {
  id: string;
  name: string;
}

/** A rendered row, whichever kind of node it came from. */
interface FinderRow {
  kind: SdlcFinderNodeType;
  id: string;
  name: string;
  meta: string | null;
  createdBy: string | null;
}

export interface SdlcFinderCanvas {
  id: string;
  title: string;
  /** The artifact's type — PRD, Tech Doc — which is its folder in the old sense. */
  typeName: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastEditedBy?: string | undefined;
  lastEditedAt?: number | undefined;
}

/** One step down the tree. The track is the first, and is never a folder. */
export interface SdlcFinderStep {
  type: 'TRACK' | 'FOLDER';
  id: string;
  name: string;
}

/**
 * One level of the tree: the things directly inside `parent`.
 *
 * Containment is an edge, so a column is the same query at every depth. The
 * component is repeated once per open level and owns exactly one live query,
 * which is what makes the tree lazy — closing a column drops its query rather
 * than keeping the whole hub in sync.
 */
export function SdlcFinderColumn(props: {
  channelId: string;
  parent: SdlcFinderStep;
  /** The child on the path below this column, if one is open. */
  selectedId: string | null;
  /** The deepest selection on the path — the one that is live rather than trail. */
  activeSelectionId: string | null;
  canvasById: Map<string, SdlcFinderCanvas>;
  isLast: boolean;
  onSelectFolder: (folder: { id: string; name: string }) => void;
  /** A single click: select the artifact so the preview can show it. */
  onSelectCanvas: (canvasId: string) => void;
  /** A double click, or a modified click that opens in its own window. */
  onOpenCanvas: (canvasId: string, event?: ReactMouseEvent) => void;
  /** The artifact being previewed, so its row reads as selected. */
  previewCanvasId: string | null;
  onNewFolder: (parent: SdlcFinderStep) => void;
  onNewArtifact: (parent: SdlcFinderStep) => void;
  /**
   * Open this column's own folder's conversations. The action is here rather
   * than on the rows because a row is a button already, and the folder you are
   * looking into is the one a conversation started here belongs to.
   */
  onDiscussFolder: (folder: { id: string; name: string }) => void;
  /** Every folder in the hub, by id — the page owns the one query behind it. */
  folderById: ReadonlyMap<string, SdlcFinderFolder>;
  /**
   * The folder whose conversations the right panel is currently showing, so the
   * browser says which one the panel belongs to. Null whenever the panel is
   * closed or bound to the track.
   */
  discussingFolderId: string | null;
  /** Committing a rename typed into a folder row. */
  onRenameFolder: (folderId: string, name: string) => void;
  /** Dropping an item on a folder row, or on the column's own parent. */
  onMoveItem: (
    item: { type: SdlcFinderNodeType; id: string },
    parent: { type: 'TRACK' | 'FOLDER'; id: string },
  ) => void;
  draggingItem: { type: SdlcFinderNodeType; id: string } | null;
  onDragItem: (item: { type: SdlcFinderNodeType; id: string } | null) => void;
}): ReactElement {
  const columnWidths = useUserPreference('sdlcFinderColumnWidths');
  const columnWidth = columnWidths[props.parent.id] ?? FINDER_DEFAULT_COLUMN_WIDTH;
  const groupBy = useUserPreference('sdlcFinderGroupBy');
  /** The row the pointer is currently over mid-drag, so only it shows a target. */
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  /** The pointer is over this column but not over a row, so the drop lands here. */
  const [columnDragOver, setColumnDragOver] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** The folder being renamed in place, and the text so far. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /** Set when Escape ends a rename, so the blur that follows does not save it. */
  const renameAbandoned = useRef(false);
  const columnRef = useRef<HTMLDivElement | null>(null);

  // Opening a folder puts its column past the right edge when the browser is
  // already full; bring it into view so a click never appears to do nothing.
  // `nearest` vertically, so this never scrolls the page itself.
  useEffect(() => {
    if (props.isLast) {
      columnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
    }
  }, [props.isLast, props.parent.id]);

  // A drag that ends anywhere — dropped, cancelled, or left the column — must not
  // leave a row still marked as the target.
  useEffect(() => {
    if (!props.draggingItem) setDragOverId(null);
  }, [props.draggingItem]);

  /** Drag the divider on this column's right edge; only this column moves. */
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
      setUserPreference('sdlcFinderColumnWidths', { ...columnWidths, [props.parent.id]: latest });
    };
    const finish = (): void => {
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

  // Names come from the page's one hub-wide folder subscription rather than a
  // per-column fetch: the columns differ in which edges they read, not in which
  // folders exist, so one query serves every level and the page besides.
  const folderById = props.folderById;

  const rows = useMemo(
    () =>
      edges.flatMap<FinderRow>(edge => {
        if (edge.targetType === 'FOLDER') {
          const folder = folderById.get(edge.targetId);
          // An edge whose folder has not arrived yet renders nothing rather than
          // a blank row; a deleted one never arrives and is skipped the same way.
          if (!folder) return [];
          // No count line: a folder is one line, and what is inside it is one
          // click away rather than a number to read.
          return [
            {
              kind: 'FOLDER' as const,
              id: folder.id,
              name: folder.name,
              meta: null,
              createdBy: null,
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
          },
        ];
      }),
    [edges, folderById, props.canvasById],
  );

  /**
   * Rows split into labelled groups, or one unlabelled group when grouping is off.
   * Folders lead: they are the structure, and the artifacts under a type heading
   * are what the structure holds.
   */
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ label: null, rows }];
    const byLabel = new Map<string, FinderRow[]>();
    for (const row of rows) {
      const label = row.kind === 'FOLDER' ? 'Folders' : (row.meta ?? 'Artifacts');
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

  return (
    <div
      onDragOver={event => {
        if (!props.draggingItem) return;
        event.preventDefault();
        setColumnDragOver(true);
      }}
      onDragLeave={event => {
        // dragleave also fires crossing into a child, so only a pointer that has
        // actually left the column clears the highlight.
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
        'relative flex shrink-0 flex-col border-r border-border transition-colors last:border-r-0',
        // The open level takes the slack so the columns fill the width.
        props.isLast && 'flex-1',
        // Where the drop would land, when it is the level itself rather than a
        // folder in it. A row under the pointer owns the target instead.
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
                (row.kind === 'CANVAS' && props.previewCanvasId === row.id);
              // The deepest selection is the live one; the selections above it only
              // mark the path taken to get here, so they go quiet rather than
              // competing with it.
              const activeSelected =
                selected &&
                (row.id === props.activeSelectionId || props.previewCanvasId === row.id);
              return (
                <button
                  key={row.id}
                  type='button'
                  onClick={event => {
                    if (row.kind === 'FOLDER') {
                      props.onSelectFolder({ id: row.id, name: row.name });
                      return;
                    }
                    // Cmd/Ctrl-click keeps its existing meaning — open in a window —
                    // so a plain click is free to mean "show me this" as it does in
                    // a file browser.
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
                    // Only a folder already selected: the first click of a
                    // double-click opens a folder, so renaming an unselected one
                    // would race with stepping into it.
                    if (selected) {
                      event.preventDefault();
                      // Escape unmounts the input and React fires no blur for
                      // an unmounted element, so arm the guard as the editor
                      // opens rather than clearing it on the way out.
                      renameAbandoned.current = false;
                      setRenameDraft(row.name);
                      setRenamingId(row.id);
                    }
                  }}
                  draggable={renamingId !== row.id}
                  onDragStart={event => {
                    // Firefox starts no drag without a dataTransfer entry, which
                    // left the whole move-by-drag feature silently inert there.
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.id);
                    props.onDragItem({ type: row.kind, id: row.id });
                  }}
                  onDragEnd={() => props.onDragItem(null)}
                  onDragOver={event => {
                    // Only folders take a drop, and nothing may be dropped on itself.
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
                    'mb-px flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                    activeSelected && 'bg-primary text-primary-foreground',
                    selected && !activeSelected && 'bg-foreground/[0.07] text-foreground',
                    !selected && 'hover:bg-muted',
                    props.draggingItem?.id === row.id && 'opacity-40',
                    dragOverId === row.id && 'ring-1 ring-inset ring-primary',
                  )}
                  data-track-category='SdlcHub'
                  data-track-name={row.kind === 'FOLDER' ? 'FolderOpened' : 'FinderCanvasOpened'}
                  data-track-metadata={JSON.stringify({ id: row.id })}
                >
                  {row.kind === 'FOLDER' ? (
                    // Filled, so a folder reads as a solid shape beside the outlined
                    // documents rather than as another line drawing.
                    <Folder
                      className={cn(
                        'size-[18px] shrink-0',
                        activeSelected ? 'fill-current' : 'fill-primary/25 text-primary/70',
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
                        // A folder has to be called something, and renaming it to
                        // what it already is is not a change worth a round trip.
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
          // Centred in the column rather than perched at the top of it, and it
          // says what to do next: an empty column is the one place a reader has
          // nothing to go on.
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
 * The preview a single click opens, standing where the next column would be.
 *
 * A file has no children, so the column that would list them says what the file
 * is instead — which is what makes one click worth making in a browser like this.
 */
export function SdlcFinderPreview(props: {
  canvas: SdlcFinderCanvas;
  onOpen: (canvasId: string, event?: ReactMouseEvent) => void;
  /** Read it in place, in the side panel, without leaving the browser. */
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
    // Fixed and narrow: a preview stretched across the remaining width is mostly
    // empty, and the facts in it read better in a column than in a banner.
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
        <p className='mt-2 text-center text-[10.5px] leading-relaxed text-muted-foreground'>
          Double-click the row to open · ⌘-click for a new window
        </p>
      </div>
    </div>
  );
}
