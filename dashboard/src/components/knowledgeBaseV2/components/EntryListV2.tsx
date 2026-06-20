import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../utils/classNames';
import { CollectionChild } from '../../../services/Knowledge/collectionService';
import { StatusBadgeV2 } from './StatusBadgeV2';
import { IngestStatusV2 } from './IngestStatusV2';
import { Folder, Pencil, Share2, Trash2 } from 'lucide-react';
import { useInlineEdit } from './useInlineEdit';

export interface ColumnDef {
  key: string;
  header: string;
  width?: string;
}

const DEFAULT_COL_WIDTH = '120px';
const ROW_ESTIMATE_LIST_PX = 48;

interface EntryListV2Props {
  entries: CollectionChild[];
  columns?: ColumnDef[];
  onOpen: (entry: CollectionChild) => void;
  onDelete?: (entry: CollectionChild) => void;
  onRename?: (entry: CollectionChild) => void;
  /** When provided, FOLDER rows render a share button next to rename/delete.
   *  The screen only passes this at root (collections view). */
  onShare?: (entry: CollectionChild) => void;
  /** Inline-rename state: id of the row whose name should render as an
   *  editable input, plus the commit / cancel callbacks. */
  editingId?: string | null;
  onRenameCommit?: (entry: CollectionChild, next: string) => void | Promise<void>;
  onRenameCancel?: () => void;
  scrollParentRef: React.RefObject<HTMLElement | null>;
}

// Inline editable name cell. Same UX as the cards: Enter commits, Escape
// cancels, blur saves. The wrapping `<button>` for opening the row is
// suppressed while editing to keep clicks inside the input from triggering
// navigation.
const InlineNameCell: React.FC<{
  initial: string;
  onCommit: (next: string) => void | Promise<void>;
  onCancel: () => void;
}> = ({ initial, onCommit, onCancel }) => {
  const { value, setValue, inputRef, onKeyDown, onBlur } = useInlineEdit({
    initial,
    onCommit,
    onCancel,
  });
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={e => e.stopPropagation()}
      aria-label='Rename'
      data-track-category='knowledge-base'
      data-track-name='rename-entry-inline'
      className='h-6 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-[13.5px] font-medium text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'
    />
  );
};

export const EntryListV2: React.FC<EntryListV2Props> = ({
  entries,
  columns = [],
  onOpen,
  onDelete,
  onRename,
  onShare,
  editingId,
  onRenameCommit,
  onRenameCancel,
  scrollParentRef,
}) => {
  // Reserve a tail gutter for whichever action affordances are wired up so
  // grid columns don't shift between rows with/without actions. Each button
  // is 36 px wide.
  const actionCount = (onShare ? 1 : 0) + (onRename ? 1 : 0) + (onDelete ? 1 : 0);
  const actionsWidth = actionCount > 0 ? `${String(actionCount * 36)}px` : null;
  const template = [
    '1fr',
    ...columns.map(c => c.width ?? DEFAULT_COL_WIDTH),
    ...(actionsWidth ? [actionsWidth] : []),
  ].join(' ');

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_ESTIMATE_LIST_PX,
    overscan: 6,
    getItemKey: i => {
      const entry = entries[i];
      return entry ? `${entry.type}-${entry.id}` : `i-${String(i)}`;
    },
  });

  const virtualRows = virtualizer.getVirtualItems();

  const formatCaption = (entry: CollectionChild): string => {
    if (entry.type === 'FOLDER') return 'Folder';
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    return ext.toUpperCase() || 'File';
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getColumnValue = (entry: CollectionChild, key: string): string => {
    switch (key) {
      case 'kind':
        return formatCaption(entry);
      case 'size':
        return entry.type === 'FOLDER' ? '—' : formatSize(entry.size);
      case 'updated':
        return formatDate(entry.updatedAt);
      default:
        return '—';
    }
  };

  return (
    // Same surface tokens as the toolbar (bg-secondary) so the list view
    // reads as part of the same surface family — matches xyne-search /kb.
    <div className='overflow-hidden rounded-2xl border border-border bg-secondary'>
      {/* Header */}
      <div
        className='grid items-center gap-3 border-b border-border bg-muted/60 px-4 py-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground'
        style={{ gridTemplateColumns: template }}
      >
        <span>Name</span>
        {columns.map(c => (
          <span key={`h-${c.key}`} className='hidden md:block'>
            {c.header}
          </span>
        ))}
        {actionsWidth ? <span aria-hidden /> : null}
      </div>

      {/* Rows */}
      <div
        style={{
          height: `${String(virtualizer.getTotalSize())}px`,
          position: 'relative',
        }}
      >
        {virtualRows.map(virtualRow => {
          const e = entries[virtualRow.index];
          if (!e) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                'group absolute left-0 right-0',
                virtualRow.index > 0 && 'border-t border-border',
              )}
              style={{
                transform: `translateY(${String(virtualRow.start)}px)`,
              }}
            >
              <div
                className='grid w-full items-center gap-3 px-4 py-2 transition hover:bg-muted/60'
                style={{ gridTemplateColumns: template }}
                title={e.name}
              >
                {/* Name column — replaced with an inline-edit input when
                    this row is the rename target. */}
                {editingId === e.id && onRenameCommit && onRenameCancel ? (
                  <div className='flex min-w-0 items-center gap-3'>
                    <span className='flex-shrink-0 pr-1'>
                      {e.type === 'FOLDER' ? (
                        <div className='flex h-7 w-7 items-center justify-center'>
                          <Folder className='h-5 w-5 text-muted-foreground' strokeWidth={1.5} />
                        </div>
                      ) : (
                        <StatusBadgeV2 name={e.name} />
                      )}
                    </span>
                    <InlineNameCell
                      initial={e.name}
                      onCommit={(next): void | Promise<void> => onRenameCommit(e, next)}
                      onCancel={onRenameCancel}
                    />
                    <IngestStatusV2 status={e.ingestionStatus} />
                  </div>
                ) : (
                  <button
                    type='button'
                    onClick={() => onOpen(e)}
                    className='flex min-w-0 items-center gap-3 text-left'
                    data-track-category='knowledge-base'
                    data-track-name='open-entry'
                  >
                    <span className='flex-shrink-0 pr-1'>
                      {e.type === 'FOLDER' ? (
                        <div className='flex h-7 w-7 items-center justify-center'>
                          <Folder className='h-5 w-5 text-muted-foreground' strokeWidth={1.5} />
                        </div>
                      ) : (
                        <StatusBadgeV2 name={e.name} />
                      )}
                    </span>
                    <span className='truncate text-[13.5px] font-medium text-foreground'>
                      {e.name}
                    </span>
                    <IngestStatusV2 status={e.ingestionStatus} />
                  </button>
                )}

                {/* Other columns */}
                {columns.map(c => (
                  <button
                    key={`c-${c.key}`}
                    type='button'
                    onClick={() => onOpen(e)}
                    className='hidden md:block truncate text-left tabular-nums text-[12px] text-muted-foreground'
                    data-track-category='knowledge-base'
                    data-track-name='open-entry-column'
                  >
                    {getColumnValue(e, c.key)}
                  </button>
                ))}

                {/* Row actions (share / rename / delete). Share is folder-only
                    and only wired by the root view — matches V1's behaviour. */}
                {actionsWidth ? (
                  <div className='flex items-center justify-end gap-1'>
                    {onShare && e.type === 'FOLDER' ? (
                      <button
                        type='button'
                        aria-label={`Share ${e.name}`}
                        title='Share'
                        onClick={ev => {
                          ev.stopPropagation();
                          onShare(e);
                        }}
                        className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-foreground focus:opacity-100'
                        data-track-category='knowledge-base'
                        data-track-name='share-entry'
                      >
                        <Share2 className='h-3.5 w-3.5' strokeWidth={1.75} />
                      </button>
                    ) : null}
                    {onRename ? (
                      <button
                        type='button'
                        aria-label={`Rename ${e.name}`}
                        title='Rename'
                        onClick={ev => {
                          ev.stopPropagation();
                          onRename(e);
                        }}
                        className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-foreground focus:opacity-100'
                        data-track-category='knowledge-base'
                        data-track-name='rename-entry'
                      >
                        <Pencil className='h-3.5 w-3.5' strokeWidth={1.75} />
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button
                        type='button'
                        aria-label={`Delete ${e.name}`}
                        title='Delete'
                        onClick={ev => {
                          ev.stopPropagation();
                          onDelete(e);
                        }}
                        className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus:opacity-100 dark:hover:bg-red-950/40'
                        data-track-category='knowledge-base'
                        data-track-name='delete-entry'
                      >
                        <Trash2 className='h-3.5 w-3.5' strokeWidth={1.75} />
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
  );
};
