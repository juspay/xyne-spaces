import { useState } from 'react';
import type { FolderRecord } from '@xyne/workflow-sdk/client';
import { useFolderList } from '../../hooks/use-folder-list.js';
import { useWorkflowCounts } from '../../hooks/use-workflow-counts.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { FolderCard } from './FolderCard.js';

interface FolderGridProps {
  onSelect: (folder: FolderRecord) => void;
  /** When set, only show folders whose parentId matches. When null/undefined, show top-level folders only. */
  parentId?: string | null;
}

export function FolderGrid({ onSelect, parentId = null }: FolderGridProps) {
  const { folders, isLoading: foldersLoading, error } = useFolderList();
  const { byFolder, isLoading: countsLoading } = useWorkflowCounts();
  const [search, setSearch] = useState('');
  const isLoading = foldersLoading || countsLoading;

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center" aria-label="Loading folders">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--wui-status-failed)]">
        Failed to load folders
      </div>
    );
  }

  const atLevel = folders.filter((f) => (f.parentId ?? null) === parentId);

  if (atLevel.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--wui-fg-muted)]">
        No folders found
      </div>
    );
  }

  const filtered = search.trim()
    ? atLevel.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : atLevel;

  // Count direct children for each folder at this level
  const childCount = (folderId: string) =>
    folders.filter((f) => (f.parentId ?? null) === folderId).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-xs">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--wui-fg-muted)]"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search folders..."
          className="w-full rounded-md border border-[var(--wui-border)] py-1.5 pl-8 pr-3 text-xs text-[var(--wui-fg)] outline-none transition-colors placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]"
          style={{ background: 'var(--wui-bg, #ffffff)' }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-[var(--wui-fg-muted)]">
          No folders match "{search}"
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((folder) => {
            const counts = byFolder[folder.id] ?? { total: 0, active: 0 };
            const subFolders = childCount(folder.id);
            return (
              <FolderCard
                key={folder.id}
                folder={folder}
                total={counts.total}
                active={counts.active}
                subFolderCount={subFolders > 0 ? subFolders : undefined}
                onClick={() => onSelect(folder)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
