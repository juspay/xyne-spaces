import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowLeft } from 'lucide-react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { useWorkflowDetail, wfKeys, type WorkflowDetail } from '../../hooks/queries.js';
import { useRemoteAdoption } from '../../live/use-remote-adoption.js';
import { WorkflowHome, type WorkflowHomeTab } from './WorkflowHome.js';
import { type FolderCrumb } from './WorkflowBrowser.js';
import { WorkflowDashboard } from '../dashboard/WorkflowDashboard.js';
import { ExecutionViewer } from '../execution/ExecutionViewer.js';
import { WorkflowReviewView } from './WorkflowReviewView.js';

export interface WorkflowSearch {
  view?: 'tabs' | 'graph' | undefined;
}

type ToastHandler = (
  kind: 'success' | 'error',
  message: string,
  opts?: { action?: { label: string; onClick: () => void } },
) => void;

export interface WorkflowAppProps {
  /** Sub-path after the host's /workflows mount: '', 'executions', 'approvals',
   *  'credentials', 'folder/<id>', 'w/<id>', 'runs/<id>'. */
  path: string;
  /** Query params (view state within a page — e.g. the run viewer's tab/node). */
  search?: WorkflowSearch | undefined;
  /** Push a new sub-path (+ optional query); the host wires this to its router so
   *  back/forward work. `replace` avoids a history entry for in-page view changes. */
  onNavigate: (path: string, search?: WorkflowSearch, replace?: boolean) => void;
  aiBuilderClient?: AiBuilderClient | undefined;
  onToast?: ToastHandler;
  /** Host actions rendered at the trailing end of the tab bar. See WorkflowHome. */
  headerActions?: ReactNode | undefined;
  /** Host content rendered at the leading end of the tab bar — e.g. the brand
   *  lockup of an embedder that renders no chrome of its own. See WorkflowHome. */
  headerLead?: ReactNode | undefined;
  /** Fires when the builder's selected step changes. See WorkflowBuilder. */
  onSelectStep?: ((stepId: string | null) => void) | undefined;
  /** Signed-in user — the host owns identity; used for the Home greeting. */
  user?: { name: string } | undefined;
  className?: string;
}

export type Route =
  | { kind: 'home'; tab: WorkflowHomeTab; folderId?: string; approvalId?: string }
  | { kind: 'workflow'; workflowId: string; view: 'runs' | 'builder' | 'test' }
  | { kind: 'review'; workflowId: string }
  | { kind: 'run'; executionId: string; nodeId?: string; fileId?: string };

/** A stored attachment name — cuid2, a dash, then the original file name. */
const ATTACHMENT_FILE = /^[a-z0-9]{16,}-.+\.[A-Za-z0-9]+$/;

export const parseRoute = (raw: string): Route => {
  const clean = raw.replace(/^\/+|\/+$/g, '');
  if (clean === '') return { kind: 'home', tab: 'home' };
  const [head, ...rest] = clean.split('/');
  const arg = rest.join('/');
  if (head === 'workflows') return { kind: 'home', tab: 'workflows' };
  if (head === 'executions') return { kind: 'home', tab: 'executions' };
  if (head === 'approvals')
    return { kind: 'home', tab: 'approvals', ...(arg ? { approvalId: arg } : {}) };
  if (head === 'submitted')
    return arg ? { kind: 'review', workflowId: arg } : { kind: 'home', tab: 'submitted' };
  if (head === 'credentials') return { kind: 'home', tab: 'credentials' };
  if (head === 'folder' && arg) return { kind: 'home', tab: 'workflows', folderId: arg };
  if (head === 'w' && arg) {
    const [wfId, sub] = arg.split('/');
    if (wfId)
      return {
        kind: 'workflow',
        workflowId: wfId,
        view: sub === 'edit' ? 'builder' : sub === 'test' ? 'test' : 'runs',
      };
  }
  if (head === 'runs' && arg) {
    const [execId, ...nodeParts] = arg.split('/');
    // A trailing attachment id means "open this document over the run". Node
    // ids contain slashes too (`deep_research:biz#0/biz`), so the split is by
    // shape, not by position: only a stored file name looks like
    // `<cuid2>-<name>.<ext>`. Never match on a step being called "report" —
    // the step that emits a document is named whatever its author chose.
    const last = nodeParts[nodeParts.length - 1];
    const fileId = nodeParts.length > 1 && last && ATTACHMENT_FILE.test(last) ? last : undefined;
    const nodeId = (fileId ? nodeParts.slice(0, -1) : nodeParts).join('/');
    if (execId)
      return {
        kind: 'run',
        executionId: execId,
        ...(nodeId ? { nodeId } : {}),
        ...(fileId ? { fileId } : {}),
      };
  }
  return { kind: 'home', tab: 'home' };
};

const tabToPath = (tab: WorkflowHomeTab): string => (tab === 'home' ? '' : tab);
const folderToPath = (crumbs: FolderCrumb[]): string => {
  const leaf = crumbs[crumbs.length - 1];
  return leaf ? `folder/${leaf.id}` : 'workflows';
};
const runToPath = (executionId: string, nodeId?: string, fileId?: string): string => {
  const base = nodeId ? `runs/${executionId}/${nodeId}` : `runs/${executionId}`;
  return fileId ? `${base}/${fileId}` : base;
};

export function WorkflowApp({
  path,
  search,
  onNavigate,
  aiBuilderClient,
  onToast,
  headerActions,
  headerLead,
  onSelectStep,
  user,
  className,
}: WorkflowAppProps) {
  const client = useWorkflowClient();
  const route = parseRoute(path);

  // The URL carries only the leaf folder id; the full breadcrumb lives here and is
  // reconciled with the id on back/forward/deep-link below.
  const [folderCrumbs, setFolderCrumbs] = useState<FolderCrumb[]>([]);
  const queryClient = useQueryClient();

  const folderId = route.kind === 'home' ? route.folderId : undefined;
  useEffect(() => {
    setFolderCrumbs((prev) => {
      if (!folderId) return prev.length ? [] : prev;
      if (prev[prev.length - 1]?.id === folderId) return prev;
      const idx = prev.findIndex((c) => c.id === folderId);
      if (idx >= 0) return prev.slice(0, idx + 1);
      return [{ id: folderId, name: 'Folder' }];
    });
  }, [folderId]);

  const workflowId = route.kind === 'workflow' ? route.workflowId : undefined;
  // React Query replaces the hand-rolled fetch, and the sequence counter that
  // guarded it: it discards superseded fetches for a key on its own, and — the
  // reason for the change — gives a change notification something to invalidate.
  const { data: detail } = useWorkflowDetail(workflowId);

  // ─── Adopting a change made somewhere else ───
  //
  // The builder seeds its state once, at mount, so a refetched config does not
  // reach it and cannot silently overwrite what someone is typing. Adopting one
  // therefore means remounting, which is exactly the decision that has to depend
  // on whether there is unsaved work:
  //
  //  - clean  → remount. The user sees the new version, and loses nothing.
  //  - dirty  → leave it alone and say so. Replacing the canvas under someone
  //             mid-edit is the one outcome worse than being slightly stale.
  //
  // Either way the cache is invalidated, so the fresh copy is ready the moment
  // the user asks for it.
  const builderDirty = useRef(false);
  const {
    epoch: builderEpoch,
    stale: staleRemote,
    adopt: adoptRemote,
    clearStale,
  } = useRemoteAdoption(workflowId, () => builderDirty.current);

  useEffect(() => {
    builderDirty.current = false;
  }, [workflowId]);

  const goTab = useCallback(
    (tab: WorkflowHomeTab) => onNavigate(tabToPath(tab)),
    [onNavigate],
  );
  const goFolder = useCallback(
    (crumbs: FolderCrumb[]) => {
      setFolderCrumbs(crumbs);
      onNavigate(folderToPath(crumbs));
    },
    [onNavigate],
  );
  const openWorkflow = useCallback(
    (id: string, crumbs: FolderCrumb[]) => {
      setFolderCrumbs(crumbs);
      onNavigate(`w/${id}`);
    },
    [onNavigate],
  );
  const openRun = useCallback(
    (executionId: string) => onNavigate(`runs/${executionId}`),
    [onNavigate],
  );
  const backToBrowser = useCallback(
    () => onNavigate(folderToPath(folderCrumbs)),
    [folderCrumbs, onNavigate],
  );
  const goToCrumb = (index: number) =>
    goFolder(index < 0 ? [] : folderCrumbs.slice(0, index + 1));

  const handleSave = useCallback(
    async (config: WorkflowConfig, summary: string | null) => {
      if (!detail) return;
      await client.workflows.update(detail.workflowId, { config });
      // Write through, rather than invalidating: we already know what the server
      // now holds, and a refetch here would race the builder's own state. The
      // change event this save causes carries our origin and is dropped before it
      // reaches the subscription above, so this is the only update that lands.
      queryClient.setQueryData<WorkflowDetail>(
        wfKeys.workflow(detail.workflowId),
        (prev) =>
          prev ? { ...prev, config, ...(summary != null ? { summary } : {}) } : prev,
      );
    },
    [client, detail, queryClient],
  );

  // A document id in the URL means one of two very different things. Clicked
  // from inside the app, it is a dialog over the run that produced it. Opened
  // cold from a shared link, there is no run page behind it and nothing to
  // return to — so it renders as just the document.
  //
  // Captured on the first render, and only ever cleared: a file id already
  // present when this app mounted came from a link. Keying this off "has the
  // app navigated yet" is not enough, because the run view syncs its selected
  // step on mount — that is a navigation, and it would flip a shared link into
  // dialog mode mid-load.
  const standaloneRef = useRef(route.kind === 'run' && !!route.fileId);
  if (route.kind !== 'run' || !route.fileId) standaloneRef.current = false;
  const standaloneDocument = standaloneRef.current;

  let detailView: ReactNode = null;
  if (route.kind === 'run') {
    detailView = (
      <ExecutionViewer
        executionId={route.executionId}
        selectedStepId={route.nodeId ?? null}
        fullPreviewFileId={route.fileId ?? null}
        fullPreviewMode={standaloneDocument ? 'page' : 'dialog'}
        onFullPreviewChange={(fileId) => {
          // A file id is only addressable under a node segment — `parseRoute`
          // reads `runs/<exec>/<file>` as a node id. With no step selected,
          // decline, and the panel opens the dialog itself.
          if (fileId && !route.nodeId) return false;
          onNavigate(
            runToPath(route.executionId, route.nodeId, fileId ?? undefined),
            { view: search?.view },
            // Opening pushes, so Back closes the dialog; closing replaces, so
            // Back does not immediately reopen what the user just dismissed.
            fileId === null,
          );
          return true;
        }}
        viewMode={search?.view ?? 'tabs'}
        onViewModeChange={(m) =>
          onNavigate(
            // Switching journey/graph must not dismiss an open document: the
            // node is unchanged, so the file id rides along.
            runToPath(route.executionId, route.nodeId, route.fileId),
            { view: m === 'graph' ? 'graph' : undefined },
            true,
          )
        }
        onSelectStep={(node, replace) =>
          onNavigate(
            // Selecting a DIFFERENT step drops the file id — that document
            // belongs to the step you left. Re-selecting the same one keeps it,
            // which is what happens when the run view syncs its selection on
            // mount; without this a pasted link opens the dialog and instantly
            // closes it again.
            runToPath(
              route.executionId,
              node ?? undefined,
              (node ?? undefined) === route.nodeId ? route.fileId : undefined,
            ),
            { view: search?.view },
            replace ?? false,
          )
        }
        onBack={() => {
          if (typeof window !== 'undefined') window.history.back();
        }}
        onRerunSuccess={(newId) => openRun(newId)}
      />
    );
  } else if (route.kind === 'workflow') {
    detailView =
      detail?.workflowId === route.workflowId ? (
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-5 py-2.5">
            <button
              type="button"
              aria-label="Back"
              onClick={backToBrowser}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--wui-fg-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] hover:text-[var(--wui-fg)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <nav className="flex min-w-0 items-center gap-1 text-[13px] text-[var(--wui-fg-muted)]">
              <button
                type="button"
                onClick={() => goToCrumb(-1)}
                className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] hover:text-[var(--wui-fg)]"
              >
                Workflows
              </button>
              {folderCrumbs.map((seg, i) => (
                <span key={seg.id} className="flex min-w-0 items-center gap-1">
                  <span className="select-none text-[var(--wui-fg-muted)]/60">›</span>
                  <button
                    type="button"
                    onClick={() => goToCrumb(i)}
                    className="max-w-[24ch] truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] hover:text-[var(--wui-fg)]"
                    title={seg.name}
                  >
                    {seg.name}
                  </button>
                </span>
              ))}
              <span className="flex min-w-0 items-center gap-1">
                <span className="select-none text-[var(--wui-fg-muted)]/60">›</span>
                <span
                  className="max-w-[32ch] truncate rounded-md px-1.5 py-0.5 font-medium text-[var(--wui-fg)]"
                  title={detail.name}
                >
                  {detail.name}
                </span>
              </span>
            </nav>
          </div>
          {staleRemote && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-4 py-2 text-[13px] text-[var(--wui-fg)]"
            >
              <span>
                This workflow was changed somewhere else. Your unsaved edits are still here.
              </span>
              <button
                type="button"
                onClick={adoptRemote}
                className="shrink-0 rounded-[var(--wui-radius-sm)] bg-[var(--wui-primary)] px-2.5 py-1 text-[12px] font-medium text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]"
              >
                Discard mine and reload
              </button>
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <WorkflowDashboard
              // Remounting is how a change made elsewhere is adopted: the builder
              // seeds its state at mount and deliberately ignores a changed
              // `initialConfig` thereafter, so that a background refetch can never
              // overwrite an edit in progress.
              key={`${route.workflowId}:${String(builderEpoch)}`}
              view={route.view}
              onViewChange={(v) =>
                onNavigate(
                  v === 'builder'
                    ? `w/${route.workflowId}/edit`
                    : v === 'test'
                      ? `w/${route.workflowId}/test`
                      : `w/${route.workflowId}`,
                )
              }
              onViewRun={openRun}
              workflowId={detail.workflowId}
              workflowConfig={detail.config}
              kind={detail.kind}
              summary={detail.summary}
              workflowName={detail.name}
              onCloned={(id) => onNavigate(`w/${id}/edit`)}
              onSave={handleSave}
              onDirtyChange={(dirty) => {
                builderDirty.current = dirty;
                // Saving clears the dirty flag, and with it any warning that was
                // only waiting on unsaved work.
                if (!dirty) clearStale();
              }}
              {...(onSelectStep ? { onSelectStep } : {})}
              {...(aiBuilderClient ? { aiBuilderClient } : {})}
              {...(detail.permittedActions
                ? { permittedActions: detail.permittedActions }
                : {})}
              status={detail.status}
              onStatusChange={(next, message) => {
                // The cached record is stale the moment the status moved, and
                // the row's permittedActions may have moved with it.
                queryClient.setQueryData<WorkflowDetail>(
                  wfKeys.workflow(detail.workflowId),
                  (prev) => (prev ? { ...prev, status: next } : prev),
                );
                void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(detail.workflowId) });
                onToast?.(next === 'REJECTED' ? 'error' : 'success', message);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--wui-fg-muted)]">
          Loading…
        </div>
      );
  }

  if (route.kind === 'review') {
    return (
      <WorkflowReviewView
        {...(className ? { className } : {})}
        workflowId={route.workflowId}
        onBack={() => { onNavigate('submitted'); }}
        onDecided={() => { onNavigate('submitted'); }}
        {...(onToast ? { onToast } : {})}
        {...(headerActions ? { headerActions } : {})}
        {...(headerLead ? { headerLead } : {})}
      />
    );
  }

  const tab: WorkflowHomeTab = route.kind === 'home' ? route.tab : 'workflows';

  // A shared document link renders the document alone — the run's tab shell
  // would be chrome around something that has no run page behind it.
  if (standaloneDocument && detailView) {
    return <div className="h-full w-full">{detailView}</div>;
  }

  return (
    <WorkflowHome
      {...(className ? { className } : {})}
      tab={tab}
      onTabChange={goTab}
      onReviewWorkflow={(id) => { onNavigate(`submitted/${id}`); }}
      path={folderCrumbs}
      onPathChange={goFolder}
      onSelectWorkflow={openWorkflow}
      onViewRun={(id) => openRun(id)}
      approvalId={route.kind === 'home' && route.tab === 'approvals' ? (route.approvalId ?? null) : null}
      onApprovalSelect={(id) => onNavigate(id ? `approvals/${id}` : 'approvals')}
      {...(user ? { user } : {})}
      {...(onToast ? { onToast } : {})}
      {...(headerActions ? { headerActions } : {})}
      {...(headerLead ? { headerLead } : {})}
      {...(detailView ? { detailView } : {})}
    />
  );
}
