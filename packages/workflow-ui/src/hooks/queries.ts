/**
 * The query layer: cache keys, and the reads that live under them.
 *
 * These exist so that a change notification has something to invalidate. The
 * package previously fetched with `useEffect` + `useState` in every component,
 * which cannot be told "that is stale now" from outside — a notification would
 * have had nowhere to land. React Query was already a declared peer dependency;
 * until now nothing used it.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { WorkflowConfig, Action } from '@xyne/workflow-sdk';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { useWorkflowUI } from '../components/provider/workflow-ui-context.js';

/**
 * Cache keys, in one place.
 *
 * Hierarchical and built from `all` downward so a broad invalidation reaches
 * everything beneath it. Hand-written key arrays scattered across components are
 * how invalidation silently stops matching.
 */
export const wfKeys = {
  all: ['xyne-workflow-ui'] as const,
  workflow: (workflowId: string) => [...wfKeys.all, 'workflow', workflowId] as const,
  /** `limit` is part of the key — a different page size is a different question. */
  workflowList: (folderId?: string, limit?: number) =>
    [...wfKeys.all, 'workflow-list', folderId ?? null, limit ?? null] as const,
  capabilities: () => [...wfKeys.all, 'capabilities'] as const,

  // Each list key carries the filters it is scoped by, so a notification can
  // invalidate exactly the lists it affects.

  /** The run family, for invalidating wholesale on a `run_changed`. */
  runs: () => [...wfKeys.all, 'runs'] as const,
  runList: (filters: {
    workflowId?: string | undefined;
    status?: string | undefined;
    folderId?: string | undefined;
  }) =>
    [
      ...wfKeys.runs(),
      filters.workflowId ?? null,
      filters.status ?? null,
      filters.folderId ?? null,
    ] as const,

  /** The approvals family: page, badge and facets together. */
  approvals: () => [...wfKeys.all, 'approvals'] as const,
  approvalList: (filters: {
    workflowIds?: readonly string[] | undefined;
    stages?: readonly string[] | undefined;
    tags?: readonly string[] | undefined;
    search?: string | undefined;
    sort?: string | undefined;
    bucket?: string | undefined;
    dayEnd?: number | undefined;
  }) =>
    [
      ...wfKeys.approvals(),
      'list',
      [...(filters.workflowIds ?? [])].sort().join(',') || null,
      [...(filters.stages ?? [])].sort().join(',') || null,
      [...(filters.tags ?? [])].sort().join(',') || null,
      filters.search ?? null,
      filters.sort ?? null,
      filters.bucket ?? null,
      // Part of the key, not just the request: the same bucket asked on two
      // different days is two different questions, and the answer to one must
      // not be served for the other.
      filters.dayEnd ?? null,
    ] as const,
  /**
   * The badge, or one section's own total. Bucketed counts are separate keys so
   * Overdue's number never overwrites the whole queue's.
   */
  approvalCount: (bucket?: string, dayEnd?: number) =>
    [...wfKeys.approvals(), 'count', bucket ?? null, dayEnd ?? null] as const,
  approvalFacets: () => [...wfKeys.approvals(), 'facets'] as const,
  /** On-time vs late since a date. In the approvals family, so a decision refreshes it. */
  approvalAnalytics: (since: string) => [...wfKeys.approvals(), 'analytics', since] as const,

  pendingWorkflows: () => [...wfKeys.all, 'pending-workflows'] as const,
  folders: () => [...wfKeys.all, 'folders'] as const,
  workflowCounts: () => [...wfKeys.all, 'workflow-counts'] as const,
  /** The family, for invalidating every scope at once. */
  lastRuns: () => [...wfKeys.all, 'last-runs'] as const,
  lastRunsIn: (folderId?: string) => [...wfKeys.lastRuns(), folderId ?? null] as const,
  credentials: () => [...wfKeys.all, 'credentials'] as const,
  topErrors: (since: string, folderId?: string) =>
    [...wfKeys.all, 'top-errors', since, folderId ?? null] as const,
  analytics: (range: number, folderId?: string) =>
    [...wfKeys.all, 'analytics', range, folderId ?? null] as const,
  execution: (executionId: string) => [...wfKeys.all, 'execution', executionId] as const,
} as const;

/**
 * The caller's root-level actions — what they may do where there is no row to
 * ask about: create at the top level, manage credentials, approve at all.
 *
 * One key, so the several components that gate on it share a single request.
 * It answers a fact about the caller, not about anything on screen, so it is
 * also long-lived: refetching it per mount or per refresh buys nothing.
 *
 * Returns `undefined` while loading or on failure, which callers read as
 * "assume allowed" — `canPerform`'s convention. Gating UI is for UX; the
 * backend is the boundary.
 */
export function useCapabilities(): readonly Action[] | undefined {
  const { client } = useWorkflowUI();
  const { data } = useQuery({
    queryKey: wfKeys.capabilities(),
    queryFn: () => client.capabilities(),
    staleTime: 5 * 60_000,
  });
  return data;
}

/** A workflow, with its JSON columns already parsed. */
export interface WorkflowDetail {
  workflowId: string;
  name: string;
  /** DRAFT / ACTIVE / PENDING_APPROVAL / REJECTED / … — what the lifecycle control reads. */
  status: string;
  config: WorkflowConfig | undefined;
  /** `metadata.kind` — which editor the workflow was made for, e.g. `conversational_flow`. */
  kind?: string;
  summary?: string;
  permittedActions?: readonly Action[];
}

/**
 * `metadata` and `config` are stored as JSON strings, so every reader would
 * otherwise parse them itself — and disagree about what a malformed one means.
 */
export function toWorkflowDetail(
  workflowId: string,
  record: Awaited<ReturnType<WorkflowClient['workflows']['get']>>,
): WorkflowDetail {
  const meta = record.metadata
    ? (JSON.parse(record.metadata) as { name?: string; kind?: unknown })
    : {};
  const config = record.config
    ? (JSON.parse(record.config) as WorkflowConfig)
    : undefined;

  return {
    workflowId,
    name: meta.name ?? workflowId,
    status: record.status,
    config,
    ...(typeof meta.kind === 'string' ? { kind: meta.kind } : {}),
    ...(record.summary != null ? { summary: record.summary } : {}),
    ...(record.permittedActions ? { permittedActions: record.permittedActions } : {}),
  };
}

/**
 * Read one workflow.
 *
 * Pass `undefined` to read nothing — the query stays disabled rather than the
 * caller having to branch around the hook, which it could not do anyway.
 */
export function useWorkflowDetail(
  workflowId: string | undefined,
): UseQueryResult<WorkflowDetail> {
  const { client } = useWorkflowUI();

  return useQuery({
    queryKey: wfKeys.workflow(workflowId ?? ''),
    queryFn: async () => toWorkflowDetail(workflowId!, await client.workflows.get(workflowId!)),
    enabled: Boolean(workflowId),
  });
}
