import { Copy, FolderSymlink, Pencil, Share2, SquarePen, Tag, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../shared/cn.js';
import type { BrowserEntry, ColumnDef, LeadingRenderer } from './types.js';
import { DEFAULT_COL_WIDTH, ROW_ESTIMATE_LIST_PX } from './constants.js';
import { asText, defaultLeading, isEntryDisabled } from './utils.js';
import { entryCan } from './permissions.js';

type Props = {
  entries: ReadonlyArray<BrowserEntry>;
  columns?: ReadonlyArray<ColumnDef>;
  onOpen?: (entry: BrowserEntry) => void;
  nameHeader?: string;
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
  /** Share a row. The button shows only when the row's permittedActions grant
   *  `*:share`; wire it to open the host's `shareResource` slot. */
  onShare?: (entry: BrowserEntry) => void;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (entry: BrowserEntry, index: number, shiftKey: boolean) => void;
  scrollParentRef: React.RefObject<HTMLElement | null>;
  /** Called when the last row scrolls into view — for infinite scroll / load-more. */
  onReachEnd?: () => void;
};

export function EntryList({
  entries,
  columns = [],
  onOpen,
  nameHeader = 'Name',
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

  // Max controls a row can show — reserves the trailing column width; per-row
  // gating (below) shows a subset, so this stays an upper bound.
  const trailingActions = (onOpenEditor ? 1 : 0) + (onDuplicate ? 1 : 0) + (onEditTags ? 1 : 0) + (onShare ? 1 : 0) + (onMove ? 1 : 0) + (onRename ? 1 : 0) + (onDelete ? 1 : 0);
  const template = [
    '1fr',
    ...columns.map((c) => c.width ?? DEFAULT_COL_WIDTH),
    ...(trailingActions > 0 ? [`${String(trailingActions * 36)}px`] : []),
  ].join(' ');

  const internalScrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => internalScrollRef.current ?? scrollParentRef.current,
    estimateSize: () => ROW_ESTIMATE_LIST_PX,
    overscan: 6,
    getItemKey: (i) => {
      const entry = entries[i];
      return entry ? `${entry.kind}-${entry.id}` : `i-${String(i)}`;
    },
  });

  const virtualRows = virtualizer.getVirtualItems();

  const lastIndex = virtualRows.length > 0 ? (virtualRows[virtualRows.length - 1]?.index ?? -1) : -1;
  useEffect(() => {
    if (onReachEnd && entries.length > 0 && lastIndex >= entries.length - 1) {
      onReachEnd();
    }
  }, [lastIndex, entries.length, onReachEnd]);

  return (
    <div className="animate-fade-up flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--wui-border)] bg-surface-elevated">
      <div
        className="grid shrink-0 items-center gap-3 border-b border-border bg-surface-muted/60 px-4 py-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: template }}
      >
        <span>{nameHeader}</span>
        {columns.map((c) => (
          <span
            key={`h-${c.key}`}
            className={c.mdOnly === false ? undefined : 'hidden md:block'}
          >
            {c.header}
          </span>
        ))}
        {trailingActions > 0 ? <span aria-hidden /> : null}
      </div>
      <div ref={internalScrollRef} className="wui-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          role="list"
          style={{ height: `${String(virtualizer.getTotalSize())}px`, position: 'relative' }}
        >
          {virtualRows.map((virtualRow) => {
          const e = entries[virtualRow.index];
          if (!e) return null;
          const intrinsicallyDisabled = isEntryDisabled(e, disableFiles, disableFolders);
          const isEditing = editingId === e.id;
          const disabled = intrinsicallyDisabled || isEditing;
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                'group absolute left-0 right-0',
                virtualRow.index > 0 && 'border-t border-border',
              )}
              style={{
                transform: `translateY(${String(virtualRow.start - virtualizer.options.scrollMargin)}px)`,
              }}
            >
              <div
                className={cn(
                  'grid w-full items-center gap-3 px-4 py-2 transition',
                  (e.status === 'pending' || e.status === 'processing') &&
                    'animate-pulse ring-1 ring-inset ring-ring/30',
                  disabled ? 'cursor-default' : 'cursor-pointer hover:bg-secondary/60',
                  isEditing && 'bg-secondary/50',
                )}
                style={{ gridTemplateColumns: template }}
                title={e.name}
                onClick={() => { if (!disabled && !isEditing) onOpen?.(e); }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {onToggleSelect && (
                    <button
                      type="button"
                      aria-label={selectedIds?.has(e.id) ? `Deselect ${e.name}` : `Select ${e.name}`}
                      onClick={(ev) => { ev.stopPropagation(); onToggleSelect(e, virtualRow.index, ev.shiftKey); }}
                      className={cn(
                        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                        selectedIds?.has(e.id)
                          ? 'border-[var(--wui-primary)] bg-[var(--wui-primary)] text-[var(--wui-primary-fg)]'
                          : 'border-[var(--wui-border-strong)] bg-[var(--wui-surface)] group-hover:border-[var(--wui-fg-muted)]',
                      )}
                    >
                      {selectedIds?.has(e.id) && (
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )}
                  <span className="flex-shrink-0 pr-1">{renderLeading(e, 'sm')}</span>
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
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate text-[13.5px] font-medium text-foreground">
                        {asText(e.name, e.id)}
                      </span>
                      {e.kind === 'folder' && e.caption && (
                        <span className="truncate text-[11px] text-muted-foreground">{asText(e.caption)}</span>
                      )}
                      {e.kind === 'file' && e.tags && e.tags.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {e.tags.map((t) => (
                            <span key={t} className="rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground">{t}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {e.kind !== 'folder' && columns.map((c) => (
                  <span
                    key={`c-${c.key}`}
                    className={cn(
                      c.mdOnly === false ? undefined : 'hidden md:block',
                      'truncate text-left tabular-nums text-[12px] text-muted-foreground',
                    )}
                  >
                    {c.render ? c.render(e) : (e.columns?.[c.key] ?? '—')}
                  </span>
                ))}
                {trailingActions > 0 ? (
                  <div
                    style={{ gridColumnStart: columns.length + 2 }}
                    className={cn(
                      'flex items-center justify-end gap-0.5 transition',
                      isEditing
                        ? 'pointer-events-none opacity-0'
                        : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                    )}
                  >
                    {onOpenEditor && e.kind === 'file' ? (
                      <button
                        type="button"
                        aria-label={`Open ${e.name} in editor`}
                        title="Open editor"
                        onClick={(ev) => { ev.stopPropagation(); onOpenEditor(e); }}
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
