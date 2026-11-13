import { useState, useMemo } from 'react';
import { Check, ChevronRight, Folder, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '../shared/cn.js';
import type { BrowserEntry } from './types.js';

interface FolderRecord {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface MoveDialogProps {
  entries: BrowserEntry[];
  folders: FolderRecord[];
  currentParentId: string | null;
  onMove: (targetFolderId: string | null) => void;
  onClose: () => void;
}

function getDescendantIds(id: string, folders: FolderRecord[]): Set<string> {
  const result = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const f of folders) {
      if (f.parentId === cur) {
        result.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}

export function MoveDialog({ entries, folders, currentParentId, onMove, onClose }: MoveDialogProps) {
  // If any selected entry is a workflow, Root is not a valid destination
  const hasFolderOnly = entries.every((e) => e.kind === 'folder');
  const entry = entries[0]!; // used for display title
  const [query, setQuery] = useState('');
  // Navigation path: array of {id, name} representing the drill-down trail.
  // Empty = browsing root.
  const [browsePath, setBrowsePath] = useState<Array<{ id: string; name: string }>>([]);
  // Selected destination: undefined = nothing, null = root, string = folder id.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);

  const browsedFolderId = browsePath.at(-1)?.id ?? null;

  const excludedIds = useMemo<Set<string>>(() => {
    const result = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'folder') {
        for (const id of getDescendantIds(e.id, folders)) result.add(id);
      }
    }
    return result;
  }, [entries, folders]);

  const hasChildren = (folderId: string) =>
    folders.some((f) => f.parentId === folderId && !excludedIds.has(f.id));

  // In search mode: flat filtered list. Otherwise: children of browsedFolderId.
  const visibleFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = folders.filter((f) => !excludedIds.has(f.id));
    if (q) {
      return pool.filter((f) => f.name.toLowerCase().includes(q));
    }
    return pool.filter((f) =>
      browsedFolderId ? f.parentId === browsedFolderId : !f.parentId,
    );
  }, [folders, excludedIds, query, browsedFolderId]);

  const isCurrentLocation = (id: string | null) => id === currentParentId;

  const selectedLabel = useMemo(() => {
    if (selected === undefined) return null;
    if (selected === null) return 'Root';
    return folders.find((f) => f.id === selected)?.name ?? null;
  }, [selected, folders]);

  const canMove = selected !== undefined && selected !== currentParentId;

  const drillInto = (folder: FolderRecord) => {
    setQuery('');
    setBrowsePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const goToPathIndex = (index: number) => {
    setBrowsePath((prev) => (index < 0 ? [] : prev.slice(0, index + 1)));
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onMouseDown={handleBackdrop}
    >
      <div aria-hidden className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-[15px] font-semibold text-foreground">
            {entries.length === 1
              ? <>Move &ldquo;{entry.name}&rdquo;</>
              : <>Move {entries.length} items</>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Search */}
        <div className="px-6 py-4">
          <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface-elevated px-4 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
            <input
              autoFocus
              type="text"
              placeholder="Search folders…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              className="flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground/70 outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); }}
                className="grid h-4 w-4 place-items-center text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Breadcrumb (only in non-search mode) */}
        {!query && browsePath.length > 0 && (
          <div className="flex items-center gap-1 border-b border-border px-6 py-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={() => { goToPathIndex(-1); }}
              className="rounded px-1 py-0.5 transition hover:bg-secondary hover:text-foreground"
            >
              Root
            </button>
            {browsePath.map((seg, i) => {
              const isLast = i === browsePath.length - 1;
              return (
                <span key={seg.id} className="flex items-center gap-1">
                  <span className="text-muted-foreground/50">›</span>
                  {isLast ? (
                    <span className="px-1 py-0.5 font-medium text-foreground">{seg.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { goToPathIndex(i); }}
                      className="rounded px-1 py-0.5 transition hover:bg-secondary hover:text-foreground"
                    >
                      {seg.name}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* Folder grid */}
        <div className="min-h-[200px] max-h-[360px] overflow-y-auto px-6 py-4">
          {visibleFolders.length === 0 && !(hasFolderOnly && !query && browsePath.length === 0) ? (
            <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">
              {query ? 'No folders match your search' : 'No folders here'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Root destination card — only when all entries are folders, at root level, not in search mode */}
              {hasFolderOnly && !query && browsePath.length === 0 && (() => {
                const isCurrent = currentParentId === null;
                const isSelected = selected === null;
                return (
                  <button
                    key="__root__"
                    type="button"
                    disabled={isCurrent}
                    onClick={() => { setSelected(isSelected ? undefined : null); }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                      isCurrent
                        ? 'cursor-default border-border opacity-40'
                        : isSelected
                          ? 'border-ring bg-secondary/60'
                          : 'border-border hover:border-ring/50 hover:bg-secondary/40',
                    )}
                  >
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition', isSelected ? 'bg-foreground/10' : 'bg-surface-muted')}>
                      {isSelected
                        ? <Check className="h-4 w-4 text-foreground" strokeWidth={2} />
                        : <Folder className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />}
                    </div>
                    <span className="truncate text-[13px] font-medium text-foreground">
                      Root
                      {isCurrent && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(current)</span>}
                    </span>
                  </button>
                );
              })()}
              {visibleFolders.map((f) => {
                const isCurrent = isCurrentLocation(f.id);
                const isSelected = selected === f.id;
                const hasKids = hasChildren(f.id);
                return (
                  <div key={f.id} className="flex overflow-hidden rounded-xl border border-border transition hover:border-ring/50">
                    {/* Selectable area */}
                    <button
                      type="button"
                      disabled={isCurrent}
                      onClick={() => { setSelected(isSelected ? undefined : f.id); }}
                      className={cn(
                        'flex flex-1 items-center gap-3 px-4 py-3 text-left transition',
                        isCurrent
                          ? 'cursor-default opacity-40'
                          : isSelected
                            ? 'bg-secondary/60'
                            : 'hover:bg-secondary/40',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
                          isSelected ? 'bg-foreground/10' : 'bg-surface-muted',
                        )}
                      >
                        {isSelected ? (
                          <Check className="h-4 w-4 text-foreground" strokeWidth={2} />
                        ) : (
                          <Folder className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                        )}
                      </div>
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {f.name}
                        {isCurrent && (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                            (current)
                          </span>
                        )}
                      </span>
                    </button>

                    {/* Drill-in button — only when folder has children */}
                    {hasKids && (
                      <>
                        <div className="w-px self-stretch bg-border" />
                        <button
                          type="button"
                          onClick={() => { drillInto(f); }}
                          title={`Open ${f.name}`}
                          className="flex items-center px-3 text-muted-foreground/60 transition hover:bg-secondary/60 hover:text-foreground"
                        >
                          <ChevronRight className="h-4 w-4" strokeWidth={2} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <p className="min-w-0 truncate text-[13px] text-muted-foreground">
            {selectedLabel
              ? (
                <>
                  Moving to:{' '}
                  <span className="font-medium text-foreground">{selectedLabel}</span>
                </>
              )
              : (
                <span className="italic">Select a destination folder</span>
              )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[13px] text-foreground transition hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canMove}
              onClick={() => { if (selected !== undefined) onMove(selected); }}
              className="inline-flex h-9 items-center rounded-full bg-[var(--wui-primary)] px-5 text-[13px] font-medium text-[var(--wui-primary-fg)] transition-colors hover:bg-[var(--wui-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Move here
            </button>
          </div>
        </div>
      </div>
    </div>,
    // Portal into the workflow-ui scope so the dialog inherits the host's --wui-* tokens.
    document.querySelector('[data-workflow-ui]') ?? document.body,
  );
}
