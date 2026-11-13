import { Copy, FolderSymlink, Pencil, Share2, SquarePen, Tag, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../shared/cn.js';
import type { BrowserEntry, LeadingRenderer } from './types.js';
import { ROW_ESTIMATE_GRID_PX } from './constants.js';
import { asText, defaultLeading, isEntryDisabled } from './utils.js';
import { entryCan } from './permissions.js';

type Props = {
  entries: ReadonlyArray<BrowserEntry>;
  onOpen?: (entry: BrowserEntry) => void;
  renderLeading?: LeadingRenderer;
  disableFiles?: boolean;
  disableFolders?: boolean;
  onDelete?: (entry: BrowserEntry) => void;
  onRename?: (entry: BrowserEntry, newName: string) => void;
  onMove?: (entry: BrowserEntry) => void;
  onOpenEditor?: (entry: BrowserEntry) => void;
  /** Duplicate a file entry. Shown only for files; the host gates on create rights. */
  onDuplicate?: (entry: BrowserEntry) => void;
  /** Edit a file entry's tags. Shown only for files. */
  onEditTags?: (entry: BrowserEntry) => void;
  /** Share a row — shown only when permittedActions grant `*:share`. */
  onShare?: (entry: BrowserEntry) => void;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (entry: BrowserEntry, index: number, shiftKey: boolean) => void;
  scrollParentRef: React.RefObject<HTMLElement | null>;
  /** Called when the last row scrolls into view — for infinite scroll / load-more. */
  onReachEnd?: () => void;
};

function colsFor(width: number): number {
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 640) return 3;
  return 2;
}

function useResponsiveCols(): number {
  const [cols, setCols] = useState<number>(() =>
    typeof window === 'undefined' ? 2 : colsFor(window.innerWidth),
  );
  useEffect((): (() => void) => {
    const update = (): void => { setCols(colsFor(window.innerWidth)); };
    update();
    window.addEventListener('resize', update);
    return (): void => { window.removeEventListener('resize', update); };
  }, []);
  return cols;
}

export function EntryGrid({
  entries,
  onOpen,
  renderLeading = defaultLeading,
  disableFiles = false,
  disableFolders = false,
  onDelete,
  onRename,
  onMove,
  onOpenEditor,
  onDuplicate,
  onEditTags,
  onShare,
  selectedIds,
  onToggleSelect,
  scrollParentRef,
  onReachEnd,
}: Props) {
  const cols = useResponsiveCols();
  const rowCount = Math.ceil(entries.length / cols);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const startEdit = (e: BrowserEntry): void => {
    setEditingId(e.id);
    setEditingValue(e.name);
  };
  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingValue('');
  };
  const commitEdit = (e: BrowserEntry): void => {
    const next = editingValue.trim();
    setEditingId(null);
    setEditingValue('');
    if (next && next !== e.name) {
      onRename?.(e, next);
    }
  };

  const internalScrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => internalScrollRef.current ?? scrollParentRef.current,
    estimateSize: () => ROW_ESTIMATE_GRID_PX,
    overscan: 3,
    getItemKey: (i) => `row-${String(i)}-c${String(cols)}`,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastRowIndex = virtualItems.length > 0 ? (virtualItems[virtualItems.length - 1]?.index ?? -1) : -1;
  useEffect(() => {
    if (onReachEnd && rowCount > 0 && lastRowIndex >= rowCount - 1) {
      onReachEnd();
    }
  }, [lastRowIndex, rowCount, onReachEnd]);

  return (
    <div ref={internalScrollRef} className="wui-scroll h-full min-h-0 overflow-y-auto">
      <div
        role="list"
        className="animate-fade-up"
        style={{ height: `${String(virtualizer.getTotalSize())}px`, position: 'relative' }}
      >
      {virtualItems.map((virtualRow) => {
        const start = virtualRow.index * cols;
        const rowEntries = entries.slice(start, start + cols);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 right-0 grid gap-3 pb-3"
            style={{
              transform: `translateY(${String(virtualRow.start - virtualizer.options.scrollMargin)}px)`,
              gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`,
            }}
          >
            {rowEntries.map((e, rowIdx) => {
              const entryIndex = start + rowIdx;
              const intrinsicallyDisabled = isEntryDisabled(e, disableFiles, disableFolders);
              const isEditing = editingId === e.id;
              const disabled = intrinsicallyDisabled || isEditing;
              return (
                <div key={`${e.kind}-${e.id}`} role="listitem" className="group relative">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => { onOpen?.(e); }}
                    className={cn(
                      'flex w-full flex-col items-start gap-3 rounded-2xl border bg-surface-elevated p-4 text-left transition',
                      e.status === 'pending' || e.status === 'processing'
                        ? 'animate-pulse border-ring/60 ring-1 ring-ring/25'
                        : 'border-border',
                      disabled
                        ? 'cursor-default'
                        : 'hover:border-ring/40 hover:bg-secondary/60 active:scale-[0.99]',
                      isEditing && 'border-ring/60 ring-1 ring-ring/30',
                    )}
                    title={e.name}
                  >
                    <div className="pl-1 pt-1">{renderLeading(e, 'md')}</div>
                    <span className="flex w-full min-w-0 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingValue}
                            onChange={(ev) => { setEditingValue(ev.target.value); }}
                            onFocus={(ev) => { ev.target.select(); }}
                            onClick={(ev) => { ev.stopPropagation(); }}
                            onMouseDown={(ev) => { ev.stopPropagation(); }}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') {
                                ev.preventDefault();
                                ev.stopPropagation();
                                commitEdit(e);
                              } else if (ev.key === 'Escape') {
                                ev.preventDefault();
                                ev.stopPropagation();
                                cancelEdit();
                              }
                            }}
                            onBlur={() => { commitEdit(e); }}
                            maxLength={255}
                            className="min-w-0 flex-1 truncate rounded-sm border border-ring/50 bg-background px-1.5 py-0.5 text-[13.5px] font-medium text-foreground outline-none focus:border-ring"
                          />
                        ) : (
                          <span className="truncate text-[13.5px] font-medium text-foreground">
                            {asText(e.name, e.id)}
                          </span>
                        )}
                      </span>
                      {e.caption ? (
                        <span className="truncate text-[11.5px] text-muted-foreground">
                          {asText(e.caption)}
                        </span>
                      ) : null}
                      {e.kind === 'file' && e.tags && e.tags.length > 0 ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {e.tags.slice(0, 4).map((t) => (
                            <span key={t} className="rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground">{t}</span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {/* Selection checkbox */}
                  {onToggleSelect && (
                    <button
                      type="button"
                      aria-label={selectedIds?.has(e.id) ? `Deselect ${e.name}` : `Select ${e.name}`}
                      onClick={(ev) => { ev.stopPropagation(); onToggleSelect(e, entryIndex, ev.shiftKey); }}
                      className={cn(
                        'absolute left-2 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors',
                        selectedIds?.has(e.id)
                          ? 'border-[var(--wui-primary)] bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
                          : 'border-[var(--wui-border-strong)] bg-[var(--wui-surface)]/90 backdrop-blur-sm group-hover:border-[var(--wui-fg-muted)]',
                      )}
                    >
                      {selectedIds?.has(e.id) && (
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )}
                  {!isEditing && (onOpenEditor ?? onDuplicate ?? onEditTags ?? onRename ?? onDelete ?? onMove ?? onShare) ? (
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      {onOpenEditor && e.kind === 'file' ? (
                        <button
                          type="button"
                          aria-label={`Open ${e.name} in editor`}
                          title="Open editor"
                          onClick={(ev) => { ev.stopPropagation(); onOpenEditor(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <SquarePen className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onEditTags && e.kind === 'file' && entryCan(e, 'update') ? (
                        <button
                          type="button"
                          aria-label={`Edit teams for ${e.name}`}
                          title="Teams"
                          onClick={(ev) => { ev.stopPropagation(); onEditTags(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <Tag className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onShare && entryCan(e, 'share') ? (
                        <button
                          type="button"
                          aria-label={`Share ${e.name}`}
                          title="Share"
                          onClick={(ev) => { ev.stopPropagation(); onShare(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onMove && entryCan(e, 'update') ? (
                        <button
                          type="button"
                          aria-label={`Move ${e.name}`}
                          title="Move"
                          onClick={(ev) => { ev.stopPropagation(); onMove(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <FolderSymlink className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onDuplicate && e.kind === 'file' ? (
                        <button
                          type="button"
                          aria-label={`Clone ${e.name}`}
                          title="Clone"
                          onClick={(ev) => { ev.stopPropagation(); onDuplicate(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onRename && entryCan(e, 'update') ? (
                        <button
                          type="button"
                          aria-label={`Rename ${e.name}`}
                          title="Rename"
                          onClick={(ev) => { ev.stopPropagation(); startEdit(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-secondary hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                      {onDelete && entryCan(e, 'delete') ? (
                        <button
                          type="button"
                          aria-label={`Delete ${e.name}`}
                          title="Delete"
                          onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}
                          className="grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
  );
}
