import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Clock, FolderPlus, MousePointerClick, Plus, RefreshCw, Webhook, Workflow, Zap } from 'lucide-react';
import type { FolderRecord, WorkflowRecord } from '@xyne/workflow-sdk/client';
import type { Action } from '@xyne/workflow-sdk';
import type { WorkflowConfig, WorkflowRunNaming } from '@xyne/workflow-sdk/builder';
import { canPerform, friendlyMutationError } from '../../utils/permissions.js';
import { useOptionalSlot } from '../provider/slot-resolution.js';
import type { ShareSlotProps } from '../../types/slots.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { useApprovalCount } from '../../hooks/use-approval-count.js';
import { useCapabilities } from '../../hooks/queries.js';
import { CreateWorkflowDialog } from '../automations/CreateWorkflowDialog.js';
import { ApprovalsView } from '../execution/ApprovalsView.js';
import { EntryGrid } from '../browser/EntryGrid.js';
import { LoadMore } from '../shared/LoadMore.js';
import { useLiveRuns } from '../../live/use-live-workflow.js';
import { useFolderList } from '../../hooks/use-folder-list.js';
import { useWorkflowCounts } from '../../hooks/use-workflow-counts.js';
import { useWorkflowList } from '../../hooks/use-workflow-list.js';
import { useLastRuns } from '../../hooks/use-last-runs.js';
import { EntryList } from '../browser/EntryList.js';

const WORKFLOW_PAGE = 50;
import { FolderCard } from '../browser/FolderCard.js';
import { SearchField } from '../browser/SearchField.js';
import { ViewToggle } from '../browser/ViewToggle.js';
import { NameDialog } from '../browser/NameDialog.js';
import { ToolbarButton, ToolbarIconButton } from '../shared/Toolbar.js';
import { MoveDialog } from '../browser/MoveDialog.js';
import { TriggerFormModal } from '../dashboard/TriggerFormModal.js';
import { TagInput } from '../shared/TagInput.js';
import { TagFilter } from '../shared/TagFilter.js';
import { cn } from '../shared/cn.js';
import type { BrowserEntry, ColumnDef, LeadingRenderer, ViewMode } from '../browser/types.js';

// ─── Column definitions ───────────────────────────────────────────────────────

const WF_COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: 'status', header: 'Status', width: '104px', render: (e) => <WorkflowStatusPill status={e.columns?.['status']} /> },
  { key: 'steps', header: 'Steps', width: '60px' },
  { key: 'trigger', header: 'Trigger', width: '116px', render: (e) => <TriggerCell type={e.columns?.['trigger']} /> },
  { key: 'lastRun', header: 'Last run', width: '116px', render: (e) => <LastRunCell status={e.columns?.['lastRunStatus']} at={e.columns?.['lastRunAt']} /> },
];

function timeAgo(ms: number): string {
  const sec = Math.floor(Math.max(0, Date.now() - ms) / 1000);
  if (sec < 60) return `${String(sec)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  return `${String(Math.floor(hr / 24))}d ago`;
}

function LastRunCell({ status, at }: { status?: string | undefined; at?: string | undefined }) {
  if (!status || !at) {
    return <span className="text-[12px] text-[var(--wui-fg-muted)]">Never run</span>;
  }
  const s = status.toUpperCase();
  const dot =
    s === 'COMPLETED' ? 'bg-[var(--wui-status-completed)]'
      : s === 'FAILED' ? 'bg-[var(--wui-status-failed)]'
        : s === 'RUNNING' ? 'bg-[var(--wui-status-running)]'
          : s === 'EXTERNAL_WAIT' ? 'bg-[var(--wui-status-paused)]'
            : 'bg-[var(--wui-fg-muted)]';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--wui-fg-muted)]"
      title={new Date(Number(at)).toLocaleString()}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
      {timeAgo(Number(at))}
    </span>
  );
}

function WorkflowStatusPill({ status }: { status?: string | undefined }) {
  const s = (status ?? '').toUpperCase();
  const styles: Record<string, string> = {
    ACTIVE: 'text-[var(--wui-status-completed)] bg-[color-mix(in_srgb,var(--wui-status-completed)_14%,transparent)]',
    PENDING_APPROVAL: 'text-[var(--wui-status-paused)] bg-[color-mix(in_srgb,var(--wui-status-paused)_14%,transparent)]',
    // Declined reads as a failure, not as a quieter kind of draft — the author
    // has to be able to tell it apart from "nobody has looked yet".
    REJECTED: 'text-[var(--wui-status-failed)] bg-[color-mix(in_srgb,var(--wui-status-failed)_14%,transparent)]',
    DRAFT: 'text-[var(--wui-fg-muted)] bg-[var(--wui-bg-muted)]',
  };
  const cls = styles[s] ?? 'text-[var(--wui-fg-muted)] bg-[var(--wui-bg-muted)]';
  const label = s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>
      {label}
    </span>
  );
}

function TriggerCell({ type }: { type?: string | undefined }) {
  const t = (type ?? '').toUpperCase();
  const map: Record<string, { Icon: typeof Clock; label: string }> = {
    MANUAL: { Icon: MousePointerClick, label: 'Manual' },
    WEBHOOK: { Icon: Webhook, label: 'Webhook' },
    WEBHOOK_V2: { Icon: Webhook, label: 'Webhook V2' },
    CRON: { Icon: Clock, label: 'Schedule' },
    SCHEDULE: { Icon: Clock, label: 'Schedule' },
    EVENT: { Icon: Zap, label: 'Event' },
  };
  const m = map[t];
  if (!m) return <span className="text-[12px] text-[var(--wui-fg-muted)]">{type || '—'}</span>;
  const { Icon, label } = m;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--wui-fg-muted)]">
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {label}
    </span>
  );
}

// ─── Leading visual ───────────────────────────────────────────────────────────

const wfLeading: LeadingRenderer = (entry, size) => {
  if (entry.kind === 'folder') return <FolderCard size={size} />;
  const isSm = size === 'sm';
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
        isSm ? 'h-9 w-9' : 'h-14 w-14',
      )}
    >
      <Workflow
        strokeWidth={1.75}
        className={cn('text-[var(--wui-primary)]', isSm ? 'h-5 w-5' : 'h-8 w-8')}
      />
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try { return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; }
  catch { return {}; }
}

function parseStepCount(raw: string | null | undefined): number {
  try {
    const cfg = raw ? (JSON.parse(raw) as { steps?: unknown[] }) : {};
    return cfg.steps?.length ?? 0;
  } catch { return 0; }
}

function parseTags(meta: Record<string, unknown>): string[] {
  const raw = meta['tags'];
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}

function workflowToEntry(wf: WorkflowRecord): BrowserEntry {
  const meta = parseMeta(wf.metadata);
  const stepCount = parseStepCount(wf.config);
  const tags = parseTags(meta);
  return {
    kind: 'file',
    id: wf.id,
    name: typeof meta['name'] === 'string' ? meta['name'] : wf.id,
    format: 'workflow',
    caption: `${wf.status} · ${String(stepCount)} step${stepCount === 1 ? '' : 's'}`,
    columns: {
      status: wf.status,
      steps: String(stepCount),
      trigger: wf.eventType || '—',
    },
    ...(tags.length > 0 ? { tags } : {}),
    ...(wf.permittedActions ? { permittedActions: wf.permittedActions } : {}),
  };
}

function folderToEntry(f: FolderRecord, childCount: number): BrowserEntry {
  return {
    kind: 'folder',
    id: f.id,
    name: f.name,
    ...(childCount > 0 ? { caption: `${String(childCount)} item${childCount === 1 ? '' : 's'}` } : {}),
    ...(f.permittedActions ? { permittedActions: f.permittedActions } : {}),
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FolderCrumb { id: string; name: string }

export interface WorkflowBrowserProps {
  onSelectWorkflow: (workflowId: string, path: FolderCrumb[]) => void;
  onViewRun?: (executionId: string, workflowName: string) => void;
  path: FolderCrumb[];
  onPathChange: (path: FolderCrumb[]) => void;
  onToast?: (kind: 'success' | 'error', message: string) => void;
  /** Suppress the embedded "waiting for approval" banner + inline approvals view
   *  (used when approvals live in a sibling tab, e.g. WorkflowHome). */
  hideApprovals?: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkflowBrowser({
  onSelectWorkflow,
  onViewRun,
  path: breadcrumb,
  onPathChange,
  onToast,
  hideApprovals = false,
  className,
}: WorkflowBrowserProps) {
  const client = useWorkflowClient();
  const [view, setViewInternal] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('wf-browser-view') as ViewMode) ?? 'list'; } catch { return 'list'; }
  });
  const setView = (v: ViewMode) => {
    setViewInternal(v);
    try { localStorage.setItem('wf-browser-view', v); } catch {}
  };
  const [query, setQuery] = useState('');

  const setBreadcrumb = (updater: FolderCrumb[] | ((prev: FolderCrumb[]) => FolderCrumb[])) => {
    const next = typeof updater === 'function' ? updater(breadcrumb) : updater;
    onPathChange(next);
  };

  const currentFolderId = breadcrumb.at(-1)?.id ?? null;
  const isAtRoot = currentFolderId === null;

  const { folders: allFolders, error: foldersError, refetch: refetchFolders } = useFolderList();
  const { byFolder: wfCounts, refetch: refetchCounts } = useWorkflowCounts();
  const {
    workflows,
    isLoading: loading,
    isLoadingMore,
    error: workflowsError,
    hasMore,
    loadMore: loadMoreWorkflows,
    refetch: refetchWorkflows,
  } = useWorkflowList({
    ...(currentFolderId ? { folderId: currentFolderId } : {}),
    limit: WORKFLOW_PAGE,
    // At root the listing is folders only, so this would fetch nothing rendered.
    enabled: currentFolderId !== null,
  });
  const lastRunByWorkflow = useLastRuns(currentFolderId ?? undefined);

  // The hooks report errors rather than throwing; without this an unreadable
  // folder renders as an empty one and says nothing.
  const readError = foldersError ?? workflowsError;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  useEffect(() => {
    if (!readError) return;
    onToastRef.current?.('error', friendlyMutationError(readError));
  }, [readError]);

  const [dialog, setDialog] = useState<'folder' | null>(null);
  const [moveEntries, setMoveEntries] = useState<BrowserEntry[] | null>(null);
  const [runTarget, setRunTarget] = useState<
    | {
        id: string;
        name: string;
        inputSchema?: Record<string, unknown> | undefined;
        runNaming?: WorkflowRunNaming | undefined;
      }
    | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  /** Active tag filter (ANY-match). */
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  /** Workflow whose tags are being edited. */
  const [tagEditTarget, setTagEditTarget] = useState<{ id: string; name: string; tags: string[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrowserEntry | null>(null);
  /** Workflow being cloned — drives the "name the copy" dialog. */
  const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const polledCount = useApprovalCount();
  const [localCount, setLocalCount] = useState<number | null>(null);
  const approvalCount = localCount ?? polledCount;
  const mainRef = useRef<HTMLElement | null>(null);

  // Top-level create rights ("New folder" at root) come from capabilities();
  // create-inside-a-folder rights come from that folder's own permittedActions.
  const rootCaps = useCapabilities();
  // Host-provided share UI. Absent ⇒ no Share affordance is offered anywhere.
  const ShareSlot = useOptionalSlot<ShareSlotProps>('shareResource');
  const [shareTarget, setShareTarget] = useState<
    { resourceType: 'workflow' | 'folder'; resourceId: string; resourceName?: string } | null
  >(null);

  const refresh = useCallback(() => {
    refetchFolders();
    refetchCounts();
    refetchWorkflows();
  }, [refetchFolders, refetchCounts, refetchWorkflows]);

  // Keep the folder's rows current without a timer: a run starting or finishing
  // anywhere in this folder refreshes the "Last run" column and the counts.
  useLiveRuns(currentFolderId ? { kind: 'folder', id: currentFolderId } : undefined);

  const childFolders = allFolders.filter((f) =>
    currentFolderId ? f.parentId === currentFolderId : !f.parentId,
  );

  // Create rights come from the container: root from capabilities(), a folder
  // from its own permittedActions (which carry workflow:create / folder:create).
  const currentFolder = currentFolderId ? allFolders.find((f) => f.id === currentFolderId) : undefined;
  const canCreateWorkflowHere = canPerform(currentFolder?.permittedActions, 'workflow:create' as Action);
  const canCreateFolderHere = isAtRoot
    ? canPerform(rootCaps, 'folder:create' as Action)
    : canPerform(currentFolder?.permittedActions, 'folder:create' as Action);

  const onShareEntry = ShareSlot
    ? (e: BrowserEntry) =>
        setShareTarget({
          resourceType: e.kind === 'file' ? 'workflow' : 'folder',
          resourceId: e.id,
          resourceName: e.name,
        })
    : undefined;

  const itemCount = (id: string) => {
    const subfolders = allFolders.filter((f) => f.parentId === id).length;
    const wfs = wfCounts[id]?.total ?? 0;
    return subfolders + wfs;
  };

  const allEntries: BrowserEntry[] = [
    ...childFolders.map((f) => folderToEntry(f, itemCount(f.id))),
    ...(isAtRoot ? [] : workflows.map((wf) => {
      const e = workflowToEntry(wf);
      const lr = lastRunByWorkflow[wf.id];
      return lr
        ? { ...e, columns: { ...e.columns, lastRunStatus: lr.status, lastRunAt: String(lr.createdAt) } }
        : e;
    })),
  ];

  // Tags present in this folder's workflows — drives the filter selector.
  const availableTags = [
    ...new Set(allEntries.flatMap((e) => (e.kind === 'file' ? (e.tags ?? []) : []))),
  ].sort();

  const trimmedQ = query.trim().toLowerCase();
  const entries = allEntries.filter((e) => {
    if (trimmedQ && !e.name.toLowerCase().includes(trimmedQ)) return false;
    // Tag filter applies to workflows only (ANY-match); folders always pass so
    // navigation isn't blocked.
    if (selectedTags.length > 0 && e.kind === 'file') {
      const tags = e.tags ?? [];
      if (!selectedTags.some((t) => tags.includes(t))) return false;
    }
    return true;
  });

  const folderCount = entries.filter((e) => e.kind === 'folder').length;
  const wfCount = entries.filter((e) => e.kind === 'file').length;

  const countText = loading
    ? 'Loading…'
    : isAtRoot
      ? entries.length === 0
        ? 'No folders yet'
        : `${String(entries.length)} folder${entries.length === 1 ? '' : 's'}`
      : entries.length === 0
        ? 'This folder is empty'
        : [
            folderCount > 0 && `${String(folderCount)} folder${folderCount === 1 ? '' : 's'}`,
            wfCount > 0 && `${String(wfCount)} workflow${wfCount === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ');

  // ── Navigation ──────────────────────────────────────────────────────────────

  const openEntry = (entry: BrowserEntry) => {
    if (entry.kind === 'folder') {
      setQuery('');
      clearSelection();
      setBreadcrumb((prev) => [...prev, { id: entry.id, name: entry.name }]);
      return;
    }
    handleRunEntry(entry);
  };

  const goUp = () => {
    setQuery('');
    clearSelection();
    setBreadcrumb((prev) => prev.slice(0, -1));
  };

  const goToIndex = (i: number) => {
    setQuery('');
    clearSelection();
    setBreadcrumb((prev) => prev.slice(0, i + 1));
  };

  const goRoot = () => {
    setQuery('');
    clearSelection();
    setBreadcrumb([]);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const submitNewFolder = async (name: string, attributes?: Record<string, unknown>) => {
    await client.folders.create({
      name,
      parentId: currentFolderId,
      ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
    });
    onToast?.('success', `Created "${name}"`);
    setDialog(null);
    refresh();
  };

  const handleRename = async (entry: BrowserEntry, newName: string) => {
    try {
      if (entry.kind === 'folder') {
        await client.folders.update(entry.id, { name: newName });
      } else {
        const wf = workflows.find((w) => w.id === entry.id);
        const meta = parseMeta(wf?.metadata);
        await client.workflows.update(entry.id, { metadata: { ...meta, name: newName } });
      }
      onToast?.('success', `Renamed to "${newName}"`);
      refresh();
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Rename failed');
    }
  };

  // Open the tag editor for a workflow (reads its current tags from metadata).
  const openTagEditor = (entry: BrowserEntry) => {
    if (entry.kind !== 'file') return;
    const wf = workflows.find((w) => w.id === entry.id);
    setTagEditTarget({ id: entry.id, name: entry.name, tags: parseTags(parseMeta(wf?.metadata)) });
  };

  // Persist edited tags into the workflow's metadata (merged, so name etc. survive).
  const saveTags = async (id: string, tags: string[]) => {
    try {
      const wf = workflows.find((w) => w.id === id);
      const meta = parseMeta(wf?.metadata);
      await client.workflows.update(id, { metadata: { ...meta, tags } });
      setTagEditTarget(null);
      onToast?.('success', 'Teams updated');
      refresh();
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Could not update tags');
    }
  };

  const handleDelete = (entry: BrowserEntry) => {
    if (entry.kind === 'folder') setDeleteTarget(entry);
  };

  const confirmDelete = async () => {
    const entry = deleteTarget;
    if (!entry) return;
    setDeleteTarget(null);
    try {
      await client.folders.delete(entry.id);
      onToast?.('success', `Deleted "${entry.name}"`);
      refresh();
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Could not delete folder');
    }
  };

  const handleClone = (entry: BrowserEntry) => {
    if (entry.kind !== 'file') return;
    setCloneTarget({ id: entry.id, name: entry.name });
  };

  // Read the source workflow and write a fresh copy under the same folder. The
  // config and kind carry over unchanged; only the name is the author's. Errors
  // propagate so the dialog shows them inline (matching the folder create flow).
  const submitClone = async (newName: string) => {
    const target = cloneTarget;
    if (!target || !currentFolderId) return;
    const record = await client.workflows.get(target.id);
    const config = JSON.parse(record.config ?? '{}') as WorkflowConfig;
    const meta = parseMeta(record.metadata);
    const created = await client.workflows.create({
      name: newName,
      config,
      folderId: currentFolderId,
      metadata: { ...meta, name: newName },
      ...(record.summary != null ? { summary: record.summary } : {}),
      ...(record.attributes ? { attributes: record.attributes } : {}),
    });
    setCloneTarget(null);
    onToast?.('success', `Cloned to "${newName}"`);
    refresh();
    onSelectWorkflow(created.id, breadcrumb);
  };

  const triggerWorkflow = async (
    id: string,
    name: string,
    payload: Record<string, unknown>,
  ) => {
    try {
      await client.workflows.trigger(id, payload);
      setRunTarget(null);
      onToast?.('success', `Started "${name}"`);
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Could not start workflow');
    }
  };

  const handleRunEntry = (entry: BrowserEntry) => {
    if (entry.kind !== 'file') return;
    const wf = workflows.find((w) => w.id === entry.id);
    const cfg = (() => {
      try {
        return wf?.config
          ? (JSON.parse(wf.config) as { trigger?: { config?: Record<string, unknown> }; settings?: { runNaming?: WorkflowRunNaming } })
          : {};
      } catch { return {}; }
    })();
    const inputSchema = (cfg.trigger?.config ?? {})['inputSchema'] as Record<string, unknown> | undefined;
    setRunTarget({ id: entry.id, name: entry.name, inputSchema, runNaming: cfg.settings?.runNaming });
  };

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  }, []);

  const toggleSelect = useCallback((entry: BrowserEntry, index: number, shiftKey: boolean) => {
    if (shiftKey && lastSelectedIndex !== null) {
      const lo = Math.min(lastSelectedIndex, index);
      const hi = Math.max(lastSelectedIndex, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const e = entries[i];
          if (e) next.add(e.id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
        return next;
      });
    }
    setLastSelectedIndex(index);
  }, [lastSelectedIndex, entries]);

  const handleMoveConfirm = async (entriesToMove: BrowserEntry[], targetFolderId: string | null) => {
    try {
      const folders = entriesToMove
        .filter((e) => e.kind === 'folder')
        .map((e) => ({ id: e.id, parentId: targetFolderId }));
      const workflows = entriesToMove
        .filter((e) => e.kind === 'file' && targetFolderId !== null)
        .map((e) => ({ id: e.id, folderId: targetFolderId! }));
      await client.moveBatch({ folders, workflows });
      const n = entriesToMove.length;
      onToast?.('success', n === 1 ? `Moved "${entriesToMove[0]!.name}"` : `Moved ${String(n)} items`);
      setMoveEntries(null);
      clearSelection();
      refresh();
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'Move failed');
    }
  };

  const handleCreateFolder = async (name: string): Promise<FolderRecord> => {
    const folder = await client.folders.create({ name, parentId: currentFolderId });
    refresh();
    return folder;
  };

  const handleWorkflowCreated = (wf: WorkflowRecord) => {
    setShowCreateDialog(false);
    refresh();
    onSelectWorkflow(wf.id, breadcrumb);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={cn('relative flex h-full flex-col', className)}>
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--wui-border)] px-5">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
        {/* Left: back button (only when there's somewhere to go up) + breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {(showApprovals || !isAtRoot) && (
            <button
              type="button"
              aria-label="Up one level"
              onClick={showApprovals ? () => { setShowApprovals(false); } : goUp}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--wui-fg-muted)] transition hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
            </button>
          )}

          {showApprovals ? (
            <nav className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
              <button
                type="button"
                onClick={() => { setShowApprovals(false); }}
                className="rounded-md px-1.5 py-0.5 transition hover:bg-secondary hover:text-foreground"
              >
                Workflows
              </button>
              <span className="select-none text-muted-foreground/60">›</span>
              <span className="cursor-default px-1.5 py-0.5 font-medium text-foreground">
                Pending Approvals
              </span>
            </nav>
          ) : isAtRoot ? (
            <span className="text-[13px] font-medium text-[var(--wui-fg)]">Workflows</span>
          ) : (
            <nav className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
              <button
                type="button"
                onClick={goRoot}
                className="rounded-md px-1.5 py-0.5 transition hover:bg-secondary hover:text-foreground"
              >
                Workflows
              </button>
              {breadcrumb.map((seg, i) => {
                const isLast = i === breadcrumb.length - 1;
                return (
                  <span key={seg.id} className="flex min-w-0 items-center gap-1">
                    <span className="select-none text-muted-foreground/60">›</span>
                    <button
                      type="button"
                      onClick={() => (isLast ? undefined : goToIndex(i))}
                      className={cn(
                        'max-w-[24ch] truncate rounded-md px-1.5 py-0.5 transition',
                        isLast
                          ? 'cursor-default font-medium text-foreground'
                          : 'hover:bg-secondary hover:text-foreground',
                      )}
                      title={seg.name}
                    >
                      {seg.name}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!showApprovals && !isAtRoot && canCreateWorkflowHere && (
            <ToolbarButton onClick={() => { setShowCreateDialog(true); }}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Create workflow
            </ToolbarButton>
          )}
          {!showApprovals && canCreateFolderHere && (
            <ToolbarButton onClick={() => { setDialog('folder'); }}>
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={2} />
              New folder
            </ToolbarButton>
          )}
          {!showApprovals && (
            <ToolbarIconButton
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
                strokeWidth={2}
              />
            </ToolbarIconButton>
          )}
          {!showApprovals && <ViewToggle value={view} onChange={setView} />}
          {!showApprovals && (
            <SearchField
              value={query}
              onChange={setQuery}
              className="w-56"
              ariaLabel="Search workflows"
              placeholder="Search by name"
            />
          )}
        </div>
        </div>
      </div>

      {/* Floating selection pill */}
      {selectedIds.size > 0 && (
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 shadow-lg backdrop-blur-md">
            <span className="text-[13px] font-medium text-foreground">
              {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={() => { setMoveEntries(allEntries.filter((e) => selectedIds.has(e.id))); }}
              className="inline-flex h-7 items-center rounded-full bg-[var(--wui-primary)] px-3 text-[12px] font-medium text-[var(--wui-primary-fg)] transition-colors hover:bg-[var(--wui-primary-hover)]"
            >
              Move selected
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[12px] text-muted-foreground transition hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Approvals — full-height split panel, outside the scrollable main */}
      {showApprovals && (
        <div className="flex-1 overflow-hidden">
          <ApprovalsView
            className="h-full"
            onCountChange={setLocalCount}
            {...(onViewRun
              ? {
                  onViewRun: (executionId, workflowName) => {
                    setShowApprovals(false);
                    onViewRun(executionId, workflowName);
                  },
                }
              : {})}
          />
        </div>
      )}

      {/* Content */}
      <main ref={mainRef} className={cn('relative flex flex-1 flex-col overflow-hidden px-5 py-5', showApprovals && 'hidden')}>
        <div className="mx-auto flex h-full w-full min-h-0 max-w-7xl flex-col">
          {false ? null : (
            <>
              {!hideApprovals && approvalCount !== undefined && approvalCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowApprovals(true); }}
                  className="mb-4 flex w-full items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-left transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:hover:bg-orange-950/50"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-orange-500" strokeWidth={2} />
                  <span className="flex-1 text-[13px] font-medium text-orange-800 dark:text-orange-300">
                    {approvalCount} workflow{approvalCount === 1 ? '' : 's'} waiting for approval
                  </span>
                  <span className="text-[12px] text-orange-600 dark:text-orange-400">Review →</span>
                </button>
              )}
              <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                <p className="text-[12px] text-muted-foreground">{countText}</p>
                <TagFilter tags={availableTags} selected={selectedTags} onChange={setSelectedTags} />
              </div>

              {/* Flex column so the list flexes and LoadMore keeps its own row at
                  the bottom. Without this the list (h-full) consumed the whole
                  height and the "Load more" button rendered below the fold, where
                  main's overflow-hidden clipped it out of view. */}
              <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
              {entries.length === 0 && !loading ? (
                <EmptyPane isRoot={isAtRoot} />
              ) : view === 'grid' ? (
                <EntryGrid
                  entries={entries}
                  renderLeading={wfLeading}
                  onOpen={openEntry}
                  onOpenEditor={(e) => { onSelectWorkflow(e.id, breadcrumb); }}
                  onEditTags={openTagEditor}
                  onRename={(e, name) => { void handleRename(e, name); }}
                  onDelete={(e) => { void handleDelete(e); }}
                  onMove={(e) => { setMoveEntries([e]); }}
                  {...(canCreateWorkflowHere ? { onDuplicate: handleClone } : {})}
                  {...(onShareEntry ? { onShare: onShareEntry } : {})}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  scrollParentRef={mainRef}
                  onReachEnd={loadMoreWorkflows}
                />
              ) : (
                <EntryList
                  entries={entries}
                  columns={isAtRoot ? [] : WF_COLUMNS}
                  renderLeading={wfLeading}
                  onOpen={openEntry}
                  onOpenEditor={(e) => { onSelectWorkflow(e.id, breadcrumb); }}
                  onEditTags={openTagEditor}
                  onRename={(e, name) => { void handleRename(e, name); }}
                  onDelete={(e) => { void handleDelete(e); }}
                  onMove={(e) => { setMoveEntries([e]); }}
                  {...(canCreateWorkflowHere ? { onDuplicate: handleClone } : {})}
                  {...(onShareEntry ? { onShare: onShareEntry } : {})}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  scrollParentRef={mainRef}
                  onReachEnd={loadMoreWorkflows}
                />
              )}
              </div>
              {/* The virtualized list drives loading via onReachEnd, so the footer
                  is passive here (autoLoad off) — it only shows progress. */}
              <LoadMore
                className="shrink-0"
                autoLoad={false}
                hasMore={!isAtRoot && hasMore}
                isLoading={isLoadingMore}
                onClick={loadMoreWorkflows}
                {...(isAtRoot ? {} : { shown: workflows.length })}
                noun="workflows"
              />
              </div>
            </>
          )}
        </div>
      </main>

      <NameDialog
        open={dialog === 'folder'}
        title="New folder"
        description={
          currentFolderId
            ? 'Adds a subfolder inside the current folder.'
            : 'Adds a top-level folder for organising workflows.'
        }
        label="Folder name"
        placeholder="e.g. Notifications"
        helper="Up to 255 characters."
        submitLabel="Create folder"
        attributeSlot="folderAttributes"
        onSubmit={submitNewFolder}
        onClose={() => { setDialog(null); }}
      />

      <NameDialog
        open={cloneTarget !== null}
        title="Clone workflow"
        {...(cloneTarget ? { description: `Makes a copy of "${cloneTarget.name}" in this folder.` } : {})}
        label="New workflow name"
        placeholder="e.g. My workflow copy"
        helper="The copy keeps every step and setting; only the name changes."
        submitLabel="Clone workflow"
        initialValue={cloneTarget ? `${cloneTarget.name} copy` : ''}
        onSubmit={submitClone}
        onClose={() => { setCloneTarget(null); }}
      />

      {showCreateDialog && (
        <CreateWorkflowDialog
          folders={allFolders}
          defaultFolderId={currentFolderId ?? undefined}
          onCreateFolder={handleCreateFolder}
          onCreated={handleWorkflowCreated}
          onClose={() => { setShowCreateDialog(false); }}
        />
      )}

      {tagEditTarget && (
        <TagEditDialog
          target={tagEditTarget}
          suggestions={availableTags}
          onSave={(tags) => { void saveTags(tagEditTarget.id, tags); }}
          onClose={() => { setTagEditTarget(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete folder "${deleteTarget.name}"?`}
          message="This permanently deletes the folder. This can't be undone."
          confirmLabel="Delete folder"
          danger
          onConfirm={() => { void confirmDelete(); }}
          onClose={() => { setDeleteTarget(null); }}
        />
      )}

      {runTarget && (
        <TriggerFormModal
          inputSchema={runTarget.inputSchema}
          workflowName={runTarget.name}
          runNaming={runTarget.runNaming}
          onSubmit={(payload) => triggerWorkflow(runTarget.id, runTarget.name, payload)}
          onClose={() => { setRunTarget(null); }}
        />
      )}

      {moveEntries && moveEntries.length > 0 && (
        <MoveDialog
          entries={moveEntries}
          folders={allFolders}
          currentParentId={
            moveEntries.length === 1 && moveEntries[0]!.kind === 'folder'
              ? (allFolders.find((f) => f.id === moveEntries[0]!.id)?.parentId ?? null)
              : currentFolderId
          }
          onMove={(targetId) => { void handleMoveConfirm(moveEntries, targetId); }}
          onClose={() => { setMoveEntries(null); }}
        />
      )}

      {/* Host-provided share UI. Closing refreshes so a visibility/role change
          re-projects permittedActions onto the rows. */}
      {ShareSlot && shareTarget ? (
        <ShareSlot
          resourceType={shareTarget.resourceType}
          resourceId={shareTarget.resourceId}
          {...(shareTarget.resourceName ? { resourceName: shareTarget.resourceName } : {})}
          onClose={() => { setShareTarget(null); refresh(); }}
        />
      ) : null}
    </div>
  );
}

// ─── Tag editor dialog ─────────────────────────────────────────────────────────

function TagEditDialog({
  target,
  suggestions,
  onSave,
  onClose,
}: {
  target: { id: string; name: string; tags: string[] };
  suggestions: string[];
  onSave: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>(target.tags);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--wui-border)] px-5 py-3.5">
          <h3 className="truncate text-sm font-semibold text-[var(--wui-fg)]" title={target.name}>Teams · {target.name}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-md text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} placeholder="Add a team — Enter to confirm" />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--wui-border)] px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-[var(--wui-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)]">Cancel</button>
          <button onClick={() => onSave(tags)} className="rounded-md bg-[var(--wui-primary)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]">Save tags</button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-xl">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--wui-fg)]">{title}</h3>
          {message ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--wui-fg-muted)]">{message}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--wui-border)] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--wui-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-muted)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors',
              danger
                ? 'bg-[var(--wui-status-failed)] hover:opacity-90'
                : 'bg-[var(--wui-primary)] hover:bg-[var(--wui-primary-hover)]',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyPane({ isRoot }: { isRoot: boolean }) {
  return (
    <div className="flex h-52 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <Workflow className="h-9 w-9 opacity-25" strokeWidth={1.25} />
      <span>{isRoot ? 'No folders yet — create one to get started' : 'This folder is empty'}</span>
    </div>
  );
}
