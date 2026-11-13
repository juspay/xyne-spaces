import { useEffect, useMemo, useRef } from 'react';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import type { ExecutionRecord, PaginatedList } from '@xyne/workflow-sdk/client';
import { wfKeys } from '../hooks/queries.js';
import { useLiveContext, type LiveChange, type LiveTopic } from './live-context.js';

/**
 * Be told when something under a topic changes; the caller decides what to do.
 *
 * Reach for this over {@link useLiveWorkflow} / {@link useLiveRuns} when
 * "refresh" is the wrong answer, as in an editor holding unsaved work. A no-op
 * without the live layer, or while `topic` is undefined.
 */
export function useLiveChanges(
  topic: LiveTopic | undefined,
  onChange: (change: LiveChange) => void,
): void {
  const live = useLiveContext();

  // Held in a ref so that an inline arrow — which almost every caller passes —
  // does not tear down and reopen the subscription on every render.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  const kind = topic?.kind;
  const id = topic?.id;

  useEffect(() => {
    if (!live || !kind || !id) return;
    return live.watch({ kind, id }, (change) => {
      handler.current(change);
    });
  }, [live, kind, id]);
}

/** Definition changes only — run traffic is filtered out. */
export function useWorkflowChanges(
  workflowId: string | undefined,
  onChange: (change: LiveChange) => void,
): void {
  const topic = useMemo<LiveTopic | undefined>(
    () => (workflowId ? { kind: 'workflow', id: workflowId } : undefined),
    [workflowId],
  );
  useLiveChanges(topic, (change) => {
    if (change.reason === 'run') return;
    onChange(change);
  });
}

/**
 * Keep a workflow's cached copy honest: re-read it whenever it changes elsewhere.
 *
 * Invalidates rather than patching from the event, because the event carries no
 * workflow — deliberately. The re-read goes through the ordinary authorized GET,
 * which is what keeps access control on the read path instead of at a fan-out
 * layer that knows nothing about who is listening.
 */
export function useLiveWorkflow(workflowId: string | undefined): void {
  const queryClient = useQueryClient();

  useWorkflowChanges(workflowId, () => {
    if (!workflowId) return;
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(workflowId) });
  });
}

/**
 * Invalidate the run-shaped lists when a run appears or changes status.
 *
 * `scope` is the topic to watch: the workflow for a workflow-scoped list, the
 * folder otherwise. `undefined` for an unscoped list — there is no topic
 * meaning "everything the caller can see", so those revalidate on focus instead.
 */
export function useLiveRuns(scope: LiveTopic | undefined): void {
  const queryClient = useQueryClient();

  useLiveChanges(scope, (change) => {
    if (change.reason === 'changed') return;

    // The family, not one key: a list is keyed by its filters and the event
    // cannot know which ones a given row now matches.
    void queryClient.invalidateQueries({ queryKey: wfKeys.runs() });
    void queryClient.invalidateQueries({ queryKey: wfKeys.approvals() });
    void queryClient.invalidateQueries({ queryKey: wfKeys.lastRuns() });

    if (change.executionId) {
      void queryClient.invalidateQueries({
        queryKey: wfKeys.execution(change.executionId),
      });
    }
  });
}

type RunsPage = PaginatedList<ExecutionRecord>;
type RunsData = InfiniteData<RunsPage>;

/**
 * Merge one root-scope run change into the unscoped Executions caches, in place.
 *
 * A status change updates the row where it sits (and drops it from a filtered
 * view it no longer matches); a brand-new run — which the root feed enriches with
 * name + createdAt — is prepended. Only the unscoped caches are touched
 * (`workflowId` and `folderId` both null in the key); scoped lists are kept live
 * by {@link useLiveRuns}.
 */
function applyRootRunChange(queryClient: QueryClient, change: LiveChange): void {
  const executionId = change.executionId;
  const status = change.status;
  const workflowId = change.workflowId;
  if (!executionId || status === undefined || workflowId === undefined) return;

  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: wfKeys.runs() })
    .filter((q) => {
      const key = q.queryKey as readonly (string | null)[];
      const folderId = key[key.length - 1];
      const scopedWorkflowId = key[key.length - 3];
      return scopedWorkflowId == null && folderId == null;
    });

  for (const q of queries) {
    const key = q.queryKey as readonly (string | null)[];
    const statusFilter = key[key.length - 2]; // runList order: workflowId, status, folderId

    queryClient.setQueryData<RunsData>(q.queryKey, (old) => {
      if (!old || old.pages.length === 0) return old;

      // Does the row already exist anywhere in the loaded pages?
      let found = false;
      const pages = old.pages.map((page) => {
        const idx = page.items.findIndex((e) => e.id === executionId);
        if (idx < 0) return page;
        found = true;
        const items = page.items.slice();
        items[idx] = { ...items[idx]!, status };
        return { ...page, items };
      });

      if (found) {
        // A status change that no longer matches this filtered view: drop it.
        if (statusFilter != null && statusFilter !== status) {
          return {
            ...old,
            pages: pages.map((page) => ({
              ...page,
              items: page.items.filter((e) => e.id !== executionId),
            })),
          };
        }
        return { ...old, pages };
      }

      // A new run. Only creation events carry enough to render a row, and it only
      // belongs in a view whose status filter it matches (or none).
      if (change.createdAt === undefined) return old;
      if (statusFilter != null && statusFilter !== status) return old;

      const fresh: ExecutionRecord = {
        id: executionId,
        workflowId,
        status,
        createdAt: new Date(change.createdAt),
        ...(change.workflowName !== undefined ? { workflowName: change.workflowName } : {}),
      };
      const [first, ...tail] = old.pages;
      return {
        ...old,
        pages: [{ ...first!, items: [fresh, ...first!.items] }, ...tail],
      };
    });
  }

  // Keep the folder "last run" column and approval badges honest without a list
  // refetch — cheap, and not the hot path.
  void queryClient.invalidateQueries({ queryKey: wfKeys.lastRuns() });
}

/**
 * Keep the unscoped Executions list live by patching the root feed straight into
 * the cache — no polling, no refetch. Enabled only for the unscoped view; scoped
 * lists use {@link useLiveRuns}. On reconnect the stream cannot replay, so a
 * `resync` (or any change we cannot patch precisely) re-reads instead.
 */
export function useLiveRootRuns(enabled: boolean): void {
  const queryClient = useQueryClient();
  const scope = useMemo<LiveTopic | undefined>(
    () => (enabled ? { kind: 'root', id: 'self' } : undefined),
    [enabled],
  );

  useLiveChanges(scope, (change) => {
    if (change.reason === 'changed') return;
    if (change.reason === 'resync' || !change.executionId) {
      void queryClient.invalidateQueries({ queryKey: wfKeys.runs() });
      void queryClient.invalidateQueries({ queryKey: wfKeys.approvals() });
      void queryClient.invalidateQueries({ queryKey: wfKeys.lastRuns() });
      return;
    }
    applyRootRunChange(queryClient, change);
    if (change.executionId) {
      void queryClient.invalidateQueries({ queryKey: wfKeys.execution(change.executionId) });
    }
  });
}
