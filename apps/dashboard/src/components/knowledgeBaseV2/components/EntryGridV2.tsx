import React, { useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CollectionChild } from '../../../services/Knowledge/collectionService';
import { FileCardV2, FolderCardV2 } from './FileCardV2';

interface EntryGridV2Props {
  entries: CollectionChild[];
  onOpen: (entry: CollectionChild) => void;
  onDelete?: (entry: CollectionChild) => void;
  /** When provided, each card surfaces a hover-revealed pencil button.
   *  Same predicate applies as `onDelete`: passing a handler enables it
   *  for the entry. */
  onRename?: (entry: CollectionChild) => void;
  /** Surfaces a hover-revealed share button on every card, folder or file.
   *  At root this opens the full collection access-management dialog;
   *  inside a collection it opens a copy-link-only dialog. */
  onShare?: (entry: CollectionChild) => void;
  /** Surfaces a hover-revealed Ask AI button on every card, folder or file.
   *  Files scope precisely (kbDocId); folders fall back to their owning
   *  collection — see KnowledgeBaseV2Screen's onAskAIAboutEntry. */
  onAskAI?: (entry: CollectionChild) => void;
  /** Opens the per-collection ingestion status drawer (root collections view). */
  onOpenStatus?: (entry: CollectionChild) => void;
  /** Entry id currently in inline-rename mode (only one at a time). When
   *  set the matching card renders an editable input instead of its name. */
  editingId?: string | null;
  /** Called when the user commits a rename (Enter or blur). */
  onRenameCommit?: (entry: CollectionChild, next: string) => void | Promise<void>;
  /** Called when the user cancels rename (Escape). */
  onRenameCancel?: () => void;
  scrollParentRef: React.RefObject<HTMLElement | null>;
  /** Resolve the caption shown under a folder card. Called for FOLDER
   *  entries only; defaults to "Folder" when omitted. The collections root
   *  view passes "Collection" / "Empty collection". */
  folderCaption?: (entry: CollectionChild) => string;
}

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
    const update = (): void => {
      setCols(colsFor(window.innerWidth));
    };
    update();
    window.addEventListener('resize', update);
    return (): void => {
      window.removeEventListener('resize', update);
    };
  }, []);
  return cols;
}

const ROW_ESTIMATE_GRID_PX = 160;

export const EntryGridV2: React.FC<EntryGridV2Props> = ({
  entries,
  onOpen,
  onDelete,
  onRename,
  onShare,
  onAskAI,
  editingId,
  onRenameCommit,
  onRenameCancel,
  scrollParentRef,
  folderCaption,
  onOpenStatus,
}) => {
  const cols = useResponsiveCols();
  const rowCount = Math.ceil(entries.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_ESTIMATE_GRID_PX,
    overscan: 3,
    getItemKey: i => `row-${String(i)}-c${String(cols)}`,
  });

  return (
    <div
      role='list'
      className='animate-fade-up'
      style={{
        height: `${String(virtualizer.getTotalSize())}px`,
        position: 'relative',
      }}
    >
      {virtualizer.getVirtualItems().map(virtualRow => {
        const start = virtualRow.index * cols;
        const rowEntries = entries.slice(start, start + cols);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className='absolute left-0 right-0 grid gap-3 pb-3'
            style={{
              transform: `translateY(${String(virtualRow.start)}px)`,
              gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`,
            }}
          >
            {rowEntries.map(e => {
              const isRenaming = editingId === e.id;
              const commitFor = onRenameCommit
                ? (next: string) => onRenameCommit(e, next)
                : undefined;
              return (
                <div key={`${e.type}-${e.id}`} role='listitem'>
                  {e.type === 'FOLDER' ? (
                    <FolderCardV2
                      folder={e}
                      onClick={() => onOpen(e)}
                      {...(folderCaption ? { caption: folderCaption(e) } : {})}
                      onDelete={onDelete ? () => onDelete(e) : undefined}
                      onRename={onRename ? () => onRename(e) : undefined}
                      onShare={onShare ? () => onShare(e) : undefined}
                      onAskAI={onAskAI ? () => onAskAI(e) : undefined}
                      onOpenStatus={onOpenStatus}
                      isRenaming={isRenaming}
                      onRenameCommit={commitFor}
                      onRenameCancel={onRenameCancel}
                    />
                  ) : (
                    <FileCardV2
                      file={e}
                      onClick={() => onOpen(e)}
                      onDelete={onDelete ? () => onDelete(e) : undefined}
                      onRename={onRename ? () => onRename(e) : undefined}
                      onAskAI={onAskAI ? () => onAskAI(e) : undefined}
                      onShare={onShare ? () => onShare(e) : undefined}
                      isRenaming={isRenaming}
                      onRenameCommit={commitFor}
                      onRenameCancel={onRenameCancel}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
