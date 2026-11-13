import { useState } from 'react';
import type { FolderRecord } from '@xyne/workflow-sdk/client';
import { LoadMore } from '../shared/LoadMore.js';
import { useWorkflowList } from '../../hooks/use-workflow-list.js';
import { useFolderList } from '../../hooks/use-folder-list.js';
import { useWorkflowCounts } from '../../hooks/use-workflow-counts.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { cn } from '../shared/cn.js';
import { EmptyState } from '../shared/EmptyState.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { AutomationCard } from './AutomationCard.js';
import { CreateWorkflowDialog } from './CreateWorkflowDialog.js';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AutomationListViewProps {
  onSelectWorkflow: (workflowId: string) => void;
  onRunWorkflow?: (workflowId: string) => void;
  className?: string;
}

/** Workflows per page in the list view. */
const PAGE_SIZE = 25;

// ─── Folder tree helpers ──────────────────────────────────────────────────────

interface FolderNode {
  folder: FolderRecord;
  children: FolderNode[];
}

function buildTree(folders: FolderRecord[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of folders) map.set(f.id, { folder: f, children: [] });

  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    const pid = node.folder.parentId;
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AutomationListView({
  onSelectWorkflow,
  onRunWorkflow,
  className,
}: AutomationListViewProps) {
  const client = useWorkflowClient();
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');

  const counts = useWorkflowCounts();
  const folderList = useFolderList();
  const { folders } = folderList;

  // From the counts aggregate, not from measuring the rows in hand.
  const total = selectedFolderId === 'all'
    ? counts.total
    : (counts.byFolder[selectedFolderId]?.total ?? 0);

  const { workflows, isLoading, isLoadingMore, error, hasMore, loadMore, refetch } =
    useWorkflowList({
      ...(selectedFolderId === 'all' ? {} : { folderId: selectedFolderId }),
      limit: PAGE_SIZE,
    });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [railError, setRailError] = useState<string | null>(null);

  // Track which folder is having a new child added: null = top-level new folder
  const [addingChildOf, setAddingChildOf] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');

  // Collapsed state: set of folder IDs that are collapsed
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewFolder = async (parentId: string | null) => {
    const name = newFolderName.trim();
    if (!name) { setAddingChildOf(undefined); return; }
    setRailError(null);
    try {
      const folder = await folderList.create(name, parentId);
      setNewFolderName('');
      setAddingChildOf(undefined);
      setSelectedFolderId(folder.id);
      // Expand parent so new folder is visible
      if (parentId) setCollapsed((prev) => { const next = new Set(prev); next.delete(parentId); return next; });
    } catch (err) {
      setRailError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    setEditingFolderId(null);
    if (!name) return;
    try {
      await folderList.rename(id, name);
    } catch (err) {
      setRailError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    setRailError(null);
    try {
      await folderList.remove(id);
      if (selectedFolderId === id) setSelectedFolderId('all');
    } catch (err) {
      setRailError(err instanceof Error ? err.message : 'Could not delete folder');
    }
  };

  const handleMove = async (workflowId: string, folderId: string) => {
    await client.workflows.update(workflowId, { folderId });
    refetch();
    counts.refetch();
  };

  const selectedFolderName =
    selectedFolderId === 'all'
      ? null
      : folders.find((f) => f.id === selectedFolderId)?.name;

  const folderTree = buildTree(folders);

  return (
    <section className={cn('flex h-full min-h-0 bg-[var(--wui-bg)]', className)}>
      {/* Folder rail */}
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--wui-border)]">
        <div className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-[var(--wui-fg-muted)]">
          Folders
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          <FolderRailItem
            kind="all"
            label="All workflows"
            count={counts.total}
            active={selectedFolderId === 'all'}
            onClick={() => setSelectedFolderId('all')}
          />

          {folderTree.map((node) => (
            <FolderTreeNode
              key={node.folder.id}
              node={node}
              depth={0}
              selectedFolderId={selectedFolderId}
              collapsed={collapsed}
              counts={counts.byFolder}
              editingFolderId={editingFolderId}
              editingName={editingName}
              addingChildOf={addingChildOf}
              newFolderName={newFolderName}
              onSelect={setSelectedFolderId}
              onToggleCollapse={toggleCollapsed}
              onStartEdit={(id, name) => { setEditingFolderId(id); setEditingName(name); }}
              onCommitEdit={handleRename}
              onEditingChange={setEditingName}
              onDelete={handleDelete}
              onStartAddChild={(parentId) => { setNewFolderName(''); setAddingChildOf(parentId); }}
              onNewFolderNameChange={setNewFolderName}
              onCommitNewFolder={handleNewFolder}
              onCancelNewFolder={() => setAddingChildOf(undefined)}
            />
          ))}

          {/* Top-level new folder inline input */}
          {addingChildOf === null && (
            <NewFolderInput
              depth={0}
              value={newFolderName}
              onChange={setNewFolderName}
              onCommit={() => void handleNewFolder(null)}
              onCancel={() => setAddingChildOf(undefined)}
            />
          )}
        </nav>

        <div className="border-t border-[var(--wui-border)] p-2">
          {addingChildOf === undefined ? (
            <button
              type="button"
              onClick={() => { setRailError(null); setNewFolderName(''); setAddingChildOf(null); }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium',
                'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)] transition-colors',
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              New folder
            </button>
          ) : null}
          {railError && (
            <p className="mt-1.5 px-1 text-[11px] text-red-500">{railError}</p>
          )}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--wui-border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--wui-fg)]">
            {selectedFolderName ?? 'All workflows'}
          </h2>
          {!isLoading && !error && (
            <span
              className={cn(
                'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5',
                'bg-[var(--wui-bg-subtle)] text-xs font-medium text-[var(--wui-fg-muted)]',
                'border border-[var(--wui-border)]',
              )}
            >
              {total}
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={() => setShowCreateDialog(true)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5',
                'bg-indigo-500 text-[13px] font-medium text-white',
                'hover:bg-indigo-600 transition-colors',
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              Create
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--wui-fg-muted)]">
              Failed to load workflows
            </div>
          ) : total === 0 ? (
            <EmptyState title={selectedFolderName ? `No workflows in ${selectedFolderName}` : 'No workflows yet'} />
          ) : (
            <>
              <ul role="list" className="overflow-hidden rounded-lg border border-[var(--wui-border)]">
                {workflows.map((workflow) => (
                  <li key={workflow.id}>
                    <AutomationCard
                      layout="row"
                      workflow={workflow}
                      onClick={() => onSelectWorkflow(workflow.id)}
                      onRun={onRunWorkflow ? () => onRunWorkflow(workflow.id) : undefined}
                      folders={folders}
                      onMove={(folderId) => void handleMove(workflow.id, folderId)}
                    />
                  </li>
                ))}
              </ul>

              <LoadMore
                hasMore={hasMore}
                isLoading={isLoadingMore}
                onClick={loadMore}
                shown={workflows.length}
                total={total}
                noun="workflows"
              />
            </>
          )}
        </div>
      </div>

      {showCreateDialog && (
        <CreateWorkflowDialog
          folders={folders}
          defaultFolderId={selectedFolderId === 'all' ? undefined : selectedFolderId}
          onCreateFolder={folderList.create}
          onCreated={(workflow) => {
            setShowCreateDialog(false);
            refetch();
            onSelectWorkflow(workflow.id);
          }}
          onClose={() => setShowCreateDialog(false)}
        />
      )}
    </section>
  );
}

// ─── Recursive tree node ──────────────────────────────────────────────────────

interface FolderTreeNodeProps {
  node: FolderNode;
  depth: number;
  selectedFolderId: string | 'all';
  collapsed: Set<string>;
  counts: Record<string, { total: number; active: number }>;
  editingFolderId: string | null;
  editingName: string;
  addingChildOf: string | null | undefined;
  newFolderName: string;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onStartEdit: (id: string, name: string) => void;
  onCommitEdit: (id: string) => void;
  onEditingChange: (v: string) => void;
  onDelete: (id: string) => void;
  onStartAddChild: (parentId: string) => void;
  onNewFolderNameChange: (v: string) => void;
  onCommitNewFolder: (parentId: string | null) => void;
  onCancelNewFolder: () => void;
}

function FolderTreeNode({
  node,
  depth,
  selectedFolderId,
  collapsed,
  counts,
  editingFolderId,
  editingName,
  addingChildOf,
  newFolderName,
  onSelect,
  onToggleCollapse,
  onStartEdit,
  onCommitEdit,
  onEditingChange,
  onDelete,
  onStartAddChild,
  onNewFolderNameChange,
  onCommitNewFolder,
  onCancelNewFolder,
}: FolderTreeNodeProps) {
  const { folder, children } = node;
  const count = counts[folder.id]?.total ?? 0;
  const hasChildren = children.length > 0 || addingChildOf === folder.id;
  const isCollapsed = collapsed.has(folder.id);

  return (
    <div>
      <FolderRailItem
        kind="folder"
        label={folder.name}
        count={count}
        depth={depth}
        active={selectedFolderId === folder.id}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        editing={editingFolderId === folder.id}
        editingValue={editingName}
        onEditingChange={onEditingChange}
        onCommitEdit={() => onCommitEdit(folder.id)}
        onStartEdit={() => onStartEdit(folder.id, folder.name)}
        deletable={count === 0 && children.length === 0}
        onDelete={() => onDelete(folder.id)}
        onAddChild={() => onStartAddChild(folder.id)}
        onToggleCollapse={() => onToggleCollapse(folder.id)}
        onClick={() => onSelect(folder.id)}
      />

      {!isCollapsed && (
        <div>
          {children.map((child) => (
            <FolderTreeNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              collapsed={collapsed}
              counts={counts}
              editingFolderId={editingFolderId}
              editingName={editingName}
              addingChildOf={addingChildOf}
              newFolderName={newFolderName}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onEditingChange={onEditingChange}
              onDelete={onDelete}
              onStartAddChild={onStartAddChild}
              onNewFolderNameChange={onNewFolderNameChange}
              onCommitNewFolder={onCommitNewFolder}
              onCancelNewFolder={onCancelNewFolder}
            />
          ))}
          {addingChildOf === folder.id && (
            <NewFolderInput
              depth={depth + 1}
              value={newFolderName}
              onChange={onNewFolderNameChange}
              onCommit={() => onCommitNewFolder(folder.id)}
              onCancel={onCancelNewFolder}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inline new-folder input ──────────────────────────────────────────────────

function NewFolderInput({
  depth,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  depth: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ paddingLeft: `${depth * 12 + 10}px` }} className="pr-2 py-0.5">
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        placeholder="Folder name…"
        className={cn(
          'w-full rounded-md border border-indigo-300 bg-[var(--wui-bg)] px-2.5 py-1.5 text-[13px]',
          'outline-none focus:ring-2 focus:ring-indigo-100',
        )}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          else if (e.key === 'Escape') onCancel();
        }}
      />
    </div>
  );
}

// ─── Folder rail item ─────────────────────────────────────────────────────────

interface FolderRailItemProps {
  kind: 'all' | 'folder';
  label: string;
  count: number;
  depth?: number;
  active: boolean;
  hasChildren?: boolean;
  isCollapsed?: boolean;
  onClick: () => void;
  onToggleCollapse?: () => void;
  onAddChild?: () => void;
  editing?: boolean;
  editingValue?: string;
  onEditingChange?: (v: string) => void;
  onCommitEdit?: () => void;
  onStartEdit?: () => void;
  deletable?: boolean;
  onDelete?: () => void;
}

function FolderRailItem({
  kind,
  label,
  count,
  depth = 0,
  active,
  hasChildren,
  isCollapsed,
  onClick,
  onToggleCollapse,
  onAddChild,
  editing,
  editingValue,
  onEditingChange,
  onCommitEdit,
  onStartEdit,
  deletable,
  onDelete,
}: FolderRailItemProps) {
  const indentPx = depth * 12;

  if (editing) {
    return (
      <div style={{ paddingLeft: `${indentPx}px` }}>
        <input
          autoFocus
          value={editingValue ?? ''}
          onChange={(e) => onEditingChange?.(e.target.value)}
          onBlur={() => onCommitEdit?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') onCommitEdit?.();
          }}
          className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1.5 text-[13px] outline-none"
        />
      </div>
    );
  }

  return (
    <div
      style={{ paddingLeft: `${indentPx}px` }}
      className={cn(
        'group flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] cursor-pointer transition-colors',
        active
          ? 'bg-indigo-50 font-semibold text-indigo-700'
          : 'text-[var(--wui-fg)] hover:bg-[var(--wui-bg-subtle)]',
      )}
      onClick={onClick}
      onDoubleClick={onStartEdit}
      title={onStartEdit ? 'Double-click to rename' : undefined}
    >
      {/* Collapse toggle or spacer */}
      {kind === 'folder' ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            hasChildren
              ? 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)] hover:bg-[var(--wui-border)]'
              : 'opacity-0 pointer-events-none',
          )}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('transition-transform', !isCollapsed && 'rotate-90')}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      ) : (
        <span className="w-[15px] shrink-0" />
      )}

      {/* Folder icon */}
      <span className={cn('shrink-0', active ? 'text-indigo-500' : 'text-[var(--wui-fg-muted)]')}>
        {kind === 'all' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
        )}
      </span>

      <span className="flex-1 truncate">{label}</span>

      {/* Action buttons (visible on hover) */}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {onAddChild && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            className="rounded p-0.5 text-[var(--wui-fg-muted)] hover:bg-[var(--wui-border)] hover:text-[var(--wui-fg)]"
            title="New subfolder"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          </button>
        )}
        {deletable && onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="rounded p-0.5 text-[var(--wui-fg-muted)] hover:text-red-500"
            aria-label={`Delete ${label}`}
            title="Delete folder"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </span>

      <span
        className={cn(
          'shrink-0 text-[11px] tabular-nums group-hover:hidden',
          active ? 'text-indigo-400' : 'text-[var(--wui-fg-muted)]',
        )}
      >
        {count}
      </span>
    </div>
  );
}
