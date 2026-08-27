// Prisma implementation of the @xyne/workflow-sdk PersistenceAdapter.
//
// The SDK's four core stores REUSE the legacy engine's tables, discriminated
// by workflowType='SDK' on every row this adapter writes and every query it
// runs (never touching legacy/automation rows):
//   workflows                 → public.workflows           (config ↔ configuration)
//   executions                → public.workflow_executions (sourceExecutionId column added)
//   execution states          → workflow.workflow_execution_states (pausePath/pauseType added)
//   step records              → workflow.workflow_steps    (executorType ↔ stepExecutorType)
// SDK executions are excluded from the legacy generic poller/recovery via
// GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES ('SDK'). workspaceId is stamped on
// every inserted row (house convention: denormalized tenant key).
//
// Everything WITHOUT a legacy counterpart is `sdk_`-prefixed: workflow.sdk_*
// (credentials AES-encrypted here at the adapter boundary) plus
// public.sdk_resource_permissions for the owner rows.

import { randomUUID } from 'crypto';
import type { Prisma, Workflow } from '@prisma/client';
import { db } from '@/database/client';
import { encrypt, decrypt } from '@/services/encryptionService';
import type {
  ExecutionPauseType,
  ExecutionRecord,
  ExecutionStateRecord,
  FolderRecord,
  PersistenceAdapter,
  ResourceAttributes,
  StepRecord,
  WebhookRecord,
  WorkflowCallbackRecord,
  WorkflowRecord,
  CredentialSummary,
  CredentialListItem,
  ResolvedCredential,
  CreateCredentialInput,
  AuthSpecificValues,
  CredentialAuthType,
  CredentialStatus,
  WorkflowContext,
} from '@xyne/workflow-sdk';
import { validateCredentialAuth, validateCredentialValues } from '@xyne/workflow-sdk';
import type { AnalyticsSummaryResult } from '@xyne/workflow-sdk/client';
import type { ResumePayload } from '@xyne/workflow-sdk/common';
import { SDK_WORKFLOW_TYPE } from './acl';
import type { XyneFilter, XyneResourceAttrs } from './acl';
import {
  credentialPermissionId,
  getResourceOwners,
  getUserAccessibleWorkflows,
  getUserAccessibleFolders,
  getAccessibleWorkflowCounts,
  grantSdkPermission,
  SdkResourceRole,
} from './resourcePermissions';

export { SDK_WORKFLOW_TYPE } from './acl';

const createId = (): string => randomUUID();

/** Best-effort name extraction from the metadata JSON (kept in workflowName for DB browsing). */
const nameFromMetadata = (metadata: string | null | undefined): string | null => {
  if (!metadata) return null;
  try {
    const name = (JSON.parse(metadata) as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
};

// Attributes are DERIVED from columns, not stored: workspaceId is the tenant/
// execution scope, isPublic lets the authorizer synthesize viewer access for
// public resources without a second query.
const toWorkflowRecord = (r: Workflow): WorkflowRecord => ({
  id: r.id,
  status: r.status,
  config: r.configuration,
  metadata: r.metadata,
  // The SDK's trigger type lives in sdkEventType; the legacy `eventType` enum
  // stays NO_OP on SDK rows so the automations event router skips them.
  eventType: r.sdkEventType ?? '',
  summary: r.summary,
  folderId: r.folderId ?? 'default',
  attributes: {
    workspaceId: r.workspaceId,
    isPublic: r.isPublic ?? false,
  } satisfies XyneResourceAttrs,
});

const toFolderRecord = (r: {
  id: string;
  name: string;
  metadata: string | null;
  parentId: string | null;
  workspaceId: string;
  isPublic: boolean;
}): FolderRecord => ({
  id: r.id,
  name: r.name,
  metadata: r.metadata,
  parentId: r.parentId,
  attributes: {
    workspaceId: r.workspaceId,
    isPublic: r.isPublic,
  } satisfies XyneResourceAttrs,
});

const toCredentialSummary = (r: {
  name: string;
  credType: string;
  status: string;
  createdAt: bigint | number;
  updatedAt: bigint | number;
}): CredentialSummary => ({
  name: r.name,
  authType: r.credType as CredentialAuthType,
  status: r.status as CredentialStatus,
  createdAt: Number(r.createdAt),
  updatedAt: Number(r.updatedAt),
});

// ── Tenant-key resolution for the child tables ───────────────────────────────
//
// The sdk_* child tables carry a denormalized `workspaceId`, but the
// PersistenceAdapter methods that write them receive only an execution or
// workflow id — the SDK fixes those signatures. So it is resolved from the
// parent here, on an indexed primary key.

/** Workspace owning a workflow. Throws rather than writing an unscoped row. */
const workspaceOfWorkflow = async (workflowId: string): Promise<string> => {
  const row = await db.workflow.findFirst({
    where: { id: workflowId, workflowType: SDK_WORKFLOW_TYPE },
    select: { workspaceId: true },
  });
  if (!row?.workspaceId) throw new Error(`No SDK workflow ${workflowId} to resolve a workspace from`);
  return row.workspaceId;
};

/**
 * Workspace owning an SDK execution. Doubles as the "this is an SDK execution"
 * assertion every write needs, so callers do not repeat the lookup.
 */
const workspaceOfExecution = async (executionId: string): Promise<string> => {
  const row = await db.workflowExecution.findFirst({
    where: { id: executionId, workflowType: SDK_WORKFLOW_TYPE },
    select: { workspaceId: true },
  });
  if (!row?.workspaceId) throw new Error(`Execution ${executionId} not found`);
  return row.workspaceId;
};

type DayCounts = { COMPLETED: number; FAILED: number; RUNNING: number; CANCELLED: number };

/** One bucket per day over the trailing `rangeDays`, so empty days still plot. */
const bucketByDay = (
  executions: ReadonlyArray<{ status: string; createdAt: Date }>,
  rangeDays: number,
): Array<{ date: string } & DayCounts> => {
  const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
  const buckets = new Map<string, DayCounts>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(d), { COMPLETED: 0, FAILED: 0, RUNNING: 0, CANCELLED: 0 });
  }
  for (const e of executions) {
    const bucket = buckets.get(dayKey(e.createdAt));
    if (bucket && e.status in bucket) bucket[e.status as keyof DayCounts]++;
  }
  return Array.from(buckets.entries()).map(([date, counts]) => ({ date, ...counts }));
};

export class PrismaPersistenceAdapter implements PersistenceAdapter<XyneFilter> {
  // ── Workflow definitions (public.workflows, workflowType='SDK') ───────────

  async getWorkflow(id: string): Promise<WorkflowRecord | null> {
    const r = await db.workflow.findFirst({
      where: { id, workflowType: SDK_WORKFLOW_TYPE },
    });
    return r ? toWorkflowRecord(r) : null;
  }

  async listWorkflows(
    filter: XyneFilter,
    page?: { folderId?: string; limit?: number; offset?: number },
  ): Promise<WorkflowRecord[]> {
    const rows = await getUserAccessibleWorkflows(filter, page);
    return rows.map(toWorkflowRecord);
  }

  async countWorkflowsByFolder(
    filter: XyneFilter,
  ): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }> {
    return getAccessibleWorkflowCounts(filter);
  }

  // Internal — used at boot to re-register cron jobs; bypasses workspace filter.
  async listAllActiveWorkflows(): Promise<WorkflowRecord[]> {
    const rows = await db.workflow.findMany({
      where: { workflowType: SDK_WORKFLOW_TYPE, status: 'ACTIVE' },
    });
    return rows.map(toWorkflowRecord);
  }

  async findActiveWorkflows(
    eventType: string,
    eventScope: Record<string, unknown>,
  ): Promise<WorkflowRecord[]> {
    // System event routing (no caller): eventScope is the event's own origin
    // scope, used to route to workflows in the same workspace — not an ACL check.
    const workspaceId = eventScope['workspaceId'] as string | undefined;
    const rows = await db.workflow.findMany({
      where: {
        workflowType: SDK_WORKFLOW_TYPE,
        sdkEventType: eventType,
        status: 'ACTIVE',
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
    return rows.map(toWorkflowRecord);
  }

  async createWorkflow(data: {
    id?: string;
    status: string;
    config: string;
    metadata: string;
    eventType: string;
    summary?: string | null;
    folderId: string;
    attributes?: ResourceAttributes<'workflow'>;
  }): Promise<string> {
    const id = data.id ?? createId();
    // Scope + creator arrive via attributes (set from ctx by the router, never
    // trusted from the client). Insert the workflow AND stamp the creator's
    // owner permission row atomically — a failed grant must not orphan a row.
    const attrs = (data.attributes ?? {}) as XyneResourceAttrs;
    const workspaceId = attrs.workspaceId ?? '';
    await db.$transaction(async tx => {
      await tx.workflow.create({
        data: {
          id,
          workspaceId,
          workflowType: SDK_WORKFLOW_TYPE,
          status: data.status,
          configuration: data.config,
          metadata: data.metadata,
          workflowName: nameFromMetadata(data.metadata),
          // NO_OP keeps the automations event router away from SDK rows; the
          // SDK's own trigger type goes in sdkEventType.
          eventType: 'NO_OP',
          sdkEventType: data.eventType,
          summary: data.summary ?? null,
          folderId: data.folderId,
          isPublic: false,
        },
      });
      if (attrs.createdByUserId !== undefined) {
        await grantSdkPermission(
          tx,
          workspaceId,
          attrs.createdByUserId,
          'workflow',
          id,
          SdkResourceRole.Owner,
        );
      }
    });
    return id;
  }

  async updateWorkflow(
    id: string,
    data: {
      status?: string;
      config?: string;
      metadata?: string;
      eventType?: string;
      summary?: string | null;
      folderId?: string;
    },
  ): Promise<void> {
    // updateMany + workflowType guard: an SDK update must never touch a legacy
    // row, whatever id it is handed.
    await db.workflow.updateMany({
      where: { id, workflowType: SDK_WORKFLOW_TYPE },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.config !== undefined ? { configuration: data.config } : {}),
        ...(data.metadata !== undefined
          ? { metadata: data.metadata, workflowName: nameFromMetadata(data.metadata) }
          : {}),
        ...(data.eventType !== undefined ? { sdkEventType: data.eventType } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        ...(data.folderId !== undefined ? { folderId: data.folderId } : {}),
      },
    });
  }

  // ── Folders (workflow.sdk_folders) ────────────────────────────────────────

  async listFolders(filter: XyneFilter): Promise<FolderRecord[]> {
    const rows = await getUserAccessibleFolders(filter);
    return rows.map(toFolderRecord);
  }

  async getFolder(id: string): Promise<FolderRecord | null> {
    const r = await db.sdkFolder.findUnique({ where: { id } });
    return r ? toFolderRecord(r) : null;
  }

  // System integrity read — deliberately unfiltered. The SDK's reparent cycle
  // check must see folders the caller cannot, or a hidden descendant slips a
  // cycle through. Never surfaced to a caller.
  async listAllFolders(): Promise<FolderRecord[]> {
    const rows = await db.sdkFolder.findMany();
    return rows.map(toFolderRecord);
  }

  // System integrity read — deliberately unfiltered. Folder deletion is blocked
  // while it holds ANY workflow, including ones the caller cannot see.
  async countWorkflowsInFolder(folderId: string): Promise<number> {
    return db.workflow.count({ where: { folderId, workflowType: SDK_WORKFLOW_TYPE } });
  }

  async createFolder(data: {
    id?: string;
    name: string;
    metadata: string;
    parentId?: string | null;
    attributes?: ResourceAttributes<'folder'>;
  }): Promise<string> {
    const id = data.id ?? createId();
    const attrs = (data.attributes ?? {}) as XyneResourceAttrs;
    const workspaceId = attrs.workspaceId ?? '';
    await db.$transaction(async tx => {
      await tx.sdkFolder.create({
        data: {
          id,
          workspaceId,
          name: data.name,
          metadata: data.metadata,
          parentId: data.parentId ?? null,
          createdAt: Date.now(),
        },
      });
      if (attrs.createdByUserId !== undefined) {
        await grantSdkPermission(
          tx,
          workspaceId,
          attrs.createdByUserId,
          'folder',
          id,
          SdkResourceRole.Owner,
        );
      }
    });
    return id;
  }

  async updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if ('parentId' in data) patch.parentId = data.parentId ?? null;
    if (Object.keys(patch).length > 0) {
      await db.sdkFolder.update({ where: { id }, data: patch });
    }
  }

  async deleteFolder(id: string): Promise<void> {
    // resourceId is polymorphic and so carries no FK — the grants would outlive
    // the folder. Folders are the only sdk resource with a hard delete;
    // credentials revoke in place and workflows have no delete route.
    await db.$transaction(async tx => {
      await tx.sdkFolder.deleteMany({ where: { id } });
      await tx.sdkResourcePermission.deleteMany({
        where: { resourceType: 'folder', resourceId: id },
      });
    });
  }

  // ── Execution lifecycle (public.workflow_executions, workflowType='SDK') ──

  async createExecution(data: {
    workflowId: string;
    status: string;
    context: string;
    sourceExecutionId?: string;
  }): Promise<string> {
    const id = createId();
    // The workspaceId stamp comes from the owning workflow (house convention:
    // denormalized tenant key on every row).
    const wf = await db.workflow.findFirst({
      where: { id: data.workflowId, workflowType: SDK_WORKFLOW_TYPE },
      select: { workspaceId: true },
    });
    if (!wf) throw new Error(`Workflow ${data.workflowId} not found`);
    await db.$transaction(async tx => {
      await tx.workflowExecution.create({
        data: {
          id,
          workspaceId: wf.workspaceId,
          workflowId: data.workflowId,
          workflowType: SDK_WORKFLOW_TYPE,
          status: data.status,
          sourceExecutionId: data.sourceExecutionId ?? null,
        },
      });
      await tx.workflowExecutionState.create({
        data: {
          workspaceId: wf.workspaceId,
          workflowExecutionId: id,
          context: data.context,
          currentStepIndex: 0,
        },
      });
    });
    return id;
  }

  async updateExecutionStatus(executionId: string, status: string): Promise<void> {
    await db.workflowExecution.updateMany({
      where: { id: executionId, workflowType: SDK_WORKFLOW_TYPE },
      data: { status },
    });
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    const r = await db.workflowExecution.findFirst({
      where: { id: executionId, workflowType: SDK_WORKFLOW_TYPE },
    });
    if (!r) return null;
    return {
      id: r.id,
      workflowId: r.workflowId,
      status: r.status,
      createdAt: r.createdAt,
      ...(r.sourceExecutionId != null ? { sourceExecutionId: r.sourceExecutionId } : {}),
    };
  }

  // The ids of workflows the caller may see — analytics/executions inherit a
  // workflow's visibility, so they scope to this set.
  private async visibleWorkflowIds(filter: XyneFilter): Promise<string[]> {
    const rows = await getUserAccessibleWorkflows(filter);
    return rows.map(r => r.id);
  }

  async getTopErrors(
    filter: XyneFilter,
    params: { since?: Date; limit?: number; folderId?: string },
  ): Promise<Array<{ message: string; count: number; runs: Array<{ id: string; workflowId: string }> }>> {
    const limit = params.limit ?? 10;

    const visibleIds = await this.visibleWorkflowIds(filter);
    if (visibleIds.length === 0) return [];

    const rows = await db.workflowStep.findMany({
      where: {
        status: 'FAILED',
        workflowExecution: {
          workflowType: SDK_WORKFLOW_TYPE,
          status: 'FAILED',
          workflowId: { in: visibleIds },
          ...(params.since ? { createdAt: { gte: params.since } } : {}),
          ...(params.folderId ? { workflow: { folderId: params.folderId } } : {}),
        },
      },
      select: {
        workflowExecutionId: true,
        data: true,
        workflowExecution: { select: { workflowId: true } },
      },
      orderBy: { workflowExecution: { createdAt: 'desc' } },
    });

    const byMessage = new Map<string, Array<{ id: string; workflowId: string }>>();
    for (const r of rows) {
      let message = 'Unknown error';
      if (r.data) {
        try {
          const parsed = JSON.parse(r.data) as Record<string, unknown>;
          message =
            (typeof parsed['error'] === 'string' ? parsed['error'] : null) ??
            (typeof parsed['message'] === 'string' ? parsed['message'] : null) ??
            message;
        } catch {
          // Unparseable step data keeps the fallback message.
        }
      }
      const runs = byMessage.get(message) ?? [];
      runs.push({ id: r.workflowExecutionId, workflowId: r.workflowExecution.workflowId });
      byMessage.set(message, runs);
    }

    return Array.from(byMessage.entries())
      .map(([message, runs]) => ({ message, count: runs.length, runs }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getAnalyticsSummary(
    filter: XyneFilter,
    params: { since: Date; rangeDays: number; folderId?: string },
  ): Promise<AnalyticsSummaryResult> {
    // Visible workflows are the analytics universe — same scope as the list.
    const workflows = await getUserAccessibleWorkflows(
      filter,
      params.folderId ? { folderId: params.folderId } : undefined,
    );
    const workflowIds = workflows.map(w => w.id);

    const executions =
      workflowIds.length === 0
        ? []
        : await db.workflowExecution.findMany({
            where: {
              workflowType: SDK_WORKFLOW_TYPE,
              createdAt: { gte: params.since },
              workflowId: { in: workflowIds },
            },
            orderBy: { createdAt: 'desc' },
          });

    const byStatus: Record<string, number> = {};
    for (const e of executions) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }

    const completed = byStatus['COMPLETED'] ?? 0;
    const failed = byStatus['FAILED'] ?? 0;
    const terminal = completed + failed;
    const successRate = terminal > 0 ? Math.round((completed / terminal) * 100) : 0;

    const runsByDay = bucketByDay(executions, params.rangeDays);

    const nameMap = new Map(workflows.map(w => [w.id, nameFromMetadata(w.metadata) ?? w.id]));
    const wfStats = new Map<string, { totalRuns: number; failed: number; lastRunAt: number | null }>();
    for (const e of executions) {
      const s = wfStats.get(e.workflowId) ?? { totalRuns: 0, failed: 0, lastRunAt: null };
      s.totalRuns++;
      if (e.status === 'FAILED') s.failed++;
      const t = e.createdAt.getTime();
      if (!s.lastRunAt || t > s.lastRunAt) s.lastRunAt = t;
      wfStats.set(e.workflowId, s);
    }
    const byWorkflow = workflows
      .map(wf => {
        const s = wfStats.get(wf.id) ?? { totalRuns: 0, failed: 0, lastRunAt: null };
        return {
          workflowId: wf.id,
          name: nameMap.get(wf.id) ?? wf.id,
          status: wf.status,
          eventType: wf.eventType,
          totalRuns: s.totalRuns,
          failedRuns: s.failed,
          failureRate: s.totalRuns > 0 ? Math.round((s.failed / s.totalRuns) * 100) : 0,
          lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
        };
      })
      .sort((a, b) => b.totalRuns - a.totalRuns);

    const recentFailures = executions
      .filter(e => e.status === 'FAILED')
      .slice(0, 10)
      .map(e => ({
        executionId: e.id,
        workflowId: e.workflowId,
        workflowName: nameMap.get(e.workflowId) ?? e.workflowId,
        createdAt: e.createdAt.toISOString(),
      }));

    return {
      totalRuns: executions.length,
      successRate,
      byStatus,
      runsByDay,
      byWorkflow,
      recentFailures,
      activeWorkflows: workflows.filter(w => w.status === 'ACTIVE').length,
      totalWorkflows: workflows.length,
    };
  }

  async listExecutions(
    filter: XyneFilter,
    params: {
      workflowId?: string;
      status?: string;
      limit?: number;
      cursor?: string;
      folderId?: string;
    },
  ): Promise<{ items: ExecutionRecord[]; nextCursor?: string }> {
    const limit = params.limit;
    // Executions inherit their workflow's visibility.
    const visibleIds = await this.visibleWorkflowIds(filter);
    if (visibleIds.length === 0) return { items: [] };
    if (params.workflowId && !visibleIds.includes(params.workflowId)) return { items: [] };

    const rows = await db.workflowExecution.findMany({
      where: {
        workflowType: SDK_WORKFLOW_TYPE,
        workflowId: params.workflowId ? params.workflowId : { in: visibleIds },
        ...(params.status ? { status: params.status } : {}),
        ...(params.cursor ? { createdAt: { lt: new Date(Number(params.cursor)) } } : {}),
        ...(params.folderId ? { workflow: { folderId: params.folderId } } : {}),
      },
      select: {
        id: true,
        workflowId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        sourceExecutionId: true,
        // Joined so the list can show the workflow name without a second round-trip.
        workflow: { select: { metadata: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(limit !== undefined ? { take: limit + 1 } : {}),
    });

    const hasMore = limit !== undefined && rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(r => {
      const workflowName = nameFromMetadata(r.workflow.metadata) ?? r.workflowId;
      return {
        id: r.id,
        workflowId: r.workflowId,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        workflowName,
        ...(r.sourceExecutionId != null ? { sourceExecutionId: r.sourceExecutionId } : {}),
      };
    });
    const nextCursor =
      hasMore && items.length > 0
        ? String(items[items.length - 1]!.createdAt.getTime())
        : undefined;
    return {
      items,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  // ── Execution state (workflow.workflow_execution_states) ──────────────────

  async getExecutionState(executionId: string): Promise<ExecutionStateRecord | null> {
    const r = await db.workflowExecutionState.findUnique({
      where: { workflowExecutionId: executionId },
    });
    if (!r) return null;
    return {
      context: r.context,
      currentStepIndex: r.currentStepIndex,
      pausePath: r.pausePath,
      ...(r.pauseType != null ? { pauseType: r.pauseType as ExecutionPauseType } : {}),
    };
  }

  /**
   * Cross-run read used by LOAD_LAST_RESULT-style steps: the most recent prior
   * COMPLETED execution of `workflowId` (excluding `excludeExecutionId`), with
   * its full stored WorkflowContext.
   */
  async getPreviousExecution(
    workflowId: string,
    opts?: { status?: string; excludeExecutionId?: string },
  ): Promise<{ executionId: string; runAt: string; context: Record<string, unknown> } | null> {
    // System path (runs inside a step, no caller) — query executions directly,
    // NOT through the ACL-filtered listExecutions.
    const items = await db.workflowExecution.findMany({
      where: {
        workflowType: SDK_WORKFLOW_TYPE,
        workflowId,
        status: opts?.status ?? 'COMPLETED',
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const prevRow = items.find(e => e.id !== opts?.excludeExecutionId);
    if (!prevRow) return null;
    const state = await this.getExecutionState(prevRow.id);
    if (!state?.context) return null;
    let context: Record<string, unknown>;
    try {
      context = JSON.parse(state.context) as Record<string, unknown>;
    } catch {
      return null;
    }
    return {
      executionId: prevRow.id,
      runAt: prevRow.createdAt.toISOString(),
      context,
    };
  }

  async persistState(
    executionId: string,
    data: {
      context: string;
      currentStepIndex?: number;
      pausePath?: string;
      pauseType?: ExecutionPauseType;
    },
  ): Promise<void> {
    // The workspaceId stamp for the (rare) insert path comes from the execution.
    const workspaceId = await workspaceOfExecution(executionId);
    await db.workflowExecutionState.upsert({
      where: { workflowExecutionId: executionId },
      create: {
        workspaceId,
        workflowExecutionId: executionId,
        context: data.context,
        currentStepIndex: data.currentStepIndex ?? 0,
        pausePath: data.pausePath ?? null,
        pauseType: data.pauseType ?? null,
      },
      update: {
        context: data.context,
        ...(data.currentStepIndex !== undefined ? { currentStepIndex: data.currentStepIndex } : {}),
        pausePath: data.pausePath ?? null,
        pauseType: data.pauseType ?? null,
      },
    });
  }

  // ── Step tracking (workflow.workflow_steps) ───────────────────────────────

  async upsertStep(
    executionId: string,
    stepName: string,
    data: { status: string; executorType: string; data?: string },
  ): Promise<void> {
    const workspaceId = await workspaceOfExecution(executionId);
    await db.workflowStep.upsert({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName },
      },
      create: {
        workspaceId,
        workflowExecutionId: executionId,
        stepName,
        status: data.status,
        stepExecutorType: data.executorType,
        data: data.data ?? null,
      },
      update: {
        status: data.status,
        stepExecutorType: data.executorType,
        ...(data.data !== undefined ? { data: data.data } : {}),
      },
    });
  }

  async getStepRows(executionId: string): Promise<StepRecord[]> {
    const rows = await db.workflowStep.findMany({
      where: { workflowExecutionId: executionId },
    });
    return rows.map(r => ({
      stepName: r.stepName ?? '',
      status: r.status ?? '',
      executorType: r.stepExecutorType,
      data: r.data,
    }));
  }

  async getStep(executionId: string, stepName: string): Promise<StepRecord | null> {
    const r = await db.workflowStep.findUnique({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName },
      },
    });
    if (!r) return null;
    return {
      stepName: r.stepName ?? '',
      status: r.status ?? '',
      executorType: r.stepExecutorType,
      data: r.data,
    };
  }

  // ── Failure handling ──────────────────────────────────────────────────────

  async markFailed(
    executionId: string,
    _error: string,
  ): Promise<'marked' | 'skipped-terminal' | 'not-found'> {
    const result = await db.workflowExecution.updateMany({
      where: {
        id: executionId,
        workflowType: SDK_WORKFLOW_TYPE,
        status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
      },
      data: { status: 'FAILED' },
    });
    if (result.count > 0) return 'marked';

    const existing = await db.workflowExecution.findFirst({
      where: { id: executionId, workflowType: SDK_WORKFLOW_TYPE },
      select: { id: true },
    });
    return existing ? 'skipped-terminal' : 'not-found';
  }

  // ── Static data (workflow.sdk_static_data) ────────────────────────────────

  async getStaticData(workflowId: string, key: string): Promise<unknown> {
    const r = await db.sdkStaticData.findUnique({
      where: { workflowId_key: { workflowId, key } },
    });
    return r?.value ?? null;
  }

  async setStaticData(workflowId: string, key: string, value: unknown): Promise<void> {
    const jsonValue = value as Prisma.InputJsonValue;
    await db.sdkStaticData.upsert({
      where: { workflowId_key: { workflowId, key } },
      create: {
        workflowId,
        workspaceId: await workspaceOfWorkflow(workflowId),
        key,
        value: jsonValue,
        updatedAt: Date.now(),
      },
      update: { value: jsonValue, updatedAt: Date.now() },
    });
  }

  async deleteStaticData(workflowId: string, key: string): Promise<void> {
    await db.sdkStaticData.deleteMany({ where: { workflowId, key } });
  }

  // ── Step events (workflow.sdk_step_events) ────────────────────────────────

  async appendStepEvent(
    executionId: string,
    stepName: string,
    event: { type: string; data: string },
  ): Promise<void> {
    await db.sdkStepEvent.create({
      data: {
        id: createId(),
        workspaceId: await workspaceOfExecution(executionId),
        executionId,
        stepName,
        type: event.type,
        data: event.data,
        createdAt: Date.now(),
      },
    });
  }

  async getStepEvents(
    executionId: string,
    stepName: string,
    after?: Date,
  ): Promise<Array<{ id: string; type: string; data: string; createdAt: Date }>> {
    const rows = await db.sdkStepEvent.findMany({
      where: {
        executionId,
        stepName,
        ...(after ? { createdAt: { gt: after.getTime() } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(r => ({
      id: r.id,
      type: r.type,
      data: r.data,
      createdAt: new Date(Number(r.createdAt)),
    }));
  }

  // ── Credentials (workflow.sdk_credentials) ────────────────────────────────

  async listCredentials(
    filter: XyneFilter,
    page?: { limit?: number; offset?: number },
  ): Promise<CredentialListItem[]> {
    const rows = await db.sdkCredential.findMany({
      where: { workspaceId: filter.workspaceId },
      // Safe metadata only — never select `data`.
      select: {
        workspaceId: true,
        name: true,
        credType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
      ...(page?.limit !== undefined ? { take: page.limit } : {}),
      ...(page?.offset !== undefined ? { skip: page.offset } : {}),
    });
    const owners = await getResourceOwners(
      rows.map(row => ({
        type: 'credential' as const,
        id: credentialPermissionId(row.workspaceId, row.name),
      })),
    );

    return rows.map(row => ({
      summary: toCredentialSummary(row),
      attributes: {
        workspaceId: row.workspaceId,
        createdBy:
          owners.get(`credential:${credentialPermissionId(row.workspaceId, row.name)}`)?.email ??
          null,
      } satisfies XyneResourceAttrs,
    }));
  }

  /**
   * Create a credential. Insert-only (no upsert): duplicate names throw, which
   * the router maps to a 409. The creator receives the Owner permission; the
   * values are validated against the auth type and stored encrypted.
   */
  async createCredential(
    attributes: XyneResourceAttrs,
    input: CreateCredentialInput,
  ): Promise<CredentialSummary> {
    const workspaceId = attributes.workspaceId;
    const createdByUserId = attributes.createdByUserId;

    const validatedValues = validateCredentialValues(input.authType, input.values);
    const existing = await db.sdkCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name: input.name } },
      select: { name: true },
    });
    if (existing) {
      throw new Error(`Credential "${input.name}" already exists`);
    }

    const now = Date.now();
    await db.$transaction(async tx => {
      await tx.sdkCredential.create({
        data: {
          workspaceId,
          name: input.name,
          credType: input.authType,
          data: encrypt(JSON.stringify(validatedValues)),
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      });
      if (createdByUserId !== undefined) {
        await grantSdkPermission(
          tx,
          workspaceId,
          createdByUserId,
          'credential',
          credentialPermissionId(workspaceId, input.name),
          SdkResourceRole.Owner,
        );
      }
    });

    return {
      name: input.name,
      authType: input.authType,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
  }

  async replaceCredentialValues(
    attributes: XyneResourceAttrs,
    name: string,
    values: AuthSpecificValues,
  ): Promise<CredentialSummary | null> {
    const workspaceId = attributes.workspaceId;
    const existing = await db.sdkCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: { name: true, credType: true, status: true, createdAt: true, updatedAt: true },
    });
    if (!existing) return null;
    if (existing.status === 'REVOKED') return null;

    const validatedValues = validateCredentialValues(
      existing.credType as CredentialAuthType,
      values,
    );

    const now = Date.now();
    await db.sdkCredential.update({
      where: { workspaceId_name: { workspaceId, name } },
      data: { data: encrypt(JSON.stringify(validatedValues)), updatedAt: now },
    });

    return toCredentialSummary({ ...existing, updatedAt: now });
  }

  async revokeCredential(
    attributes: XyneResourceAttrs,
    name: string,
  ): Promise<CredentialSummary | null> {
    const workspaceId = attributes.workspaceId;
    const existing = await db.sdkCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: { name: true, credType: true, status: true, createdAt: true, updatedAt: true },
    });
    if (!existing) return null;
    if (existing.status === 'REVOKED') {
      return toCredentialSummary(existing);
    }

    const now = Date.now();
    await db.sdkCredential.update({
      where: { workspaceId_name: { workspaceId, name } },
      data: { status: 'REVOKED', updatedAt: now },
    });

    return toCredentialSummary({ ...existing, status: 'REVOKED', updatedAt: now });
  }

  /**
   * Resolve a credential for execution-time use — the ONLY method that decrypts
   * and returns `values`. Returns null for missing OR revoked credentials, so
   * the executor fails a step before making any outbound request with a dead
   * credential. The decrypted JSON is re-validated against the stored auth type.
   */
  async resolveCredential(
    workflowOrAttributes: WorkflowContext['workflow'] | XyneResourceAttrs,
    name: string,
  ): Promise<ResolvedCredential | null> {
    // Workflow executions pass the complete workflow identity. The standalone
    // credential-test route has no running workflow, so it passes its trusted
    // workspace attributes directly.
    const attributes =
      'attributes' in workflowOrAttributes ? workflowOrAttributes.attributes : workflowOrAttributes;
    const workspaceId = attributes.workspaceId;
    const r = await db.sdkCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (!r) return null;
    if (r.status === 'REVOKED') return null;
    const parsed = JSON.parse(decrypt(r.data)) as unknown;
    const auth = validateCredentialAuth(r.credType as CredentialAuthType, parsed);

    return {
      name: r.name,
      status: r.status as CredentialStatus,
      ...auth,
    };
  }

  // ── Webhook registration (workflow.sdk_webhooks) ──────────────────────────

  async storeWebhookPath(workflowId: string, path: string, secret: string): Promise<void> {
    await db.sdkWebhook.upsert({
      where: { workflowId },
      create: {
        workflowId,
        workspaceId: await workspaceOfWorkflow(workflowId),
        path,
        secret,
        createdAt: Date.now(),
      },
      update: { path, secret },
    });
  }

  async removeWebhookPath(workflowId: string): Promise<void> {
    await db.sdkWebhook.deleteMany({ where: { workflowId } });
  }

  async getWebhookByPath(path: string): Promise<WebhookRecord | null> {
    const r = await db.sdkWebhook.findUnique({ where: { path } });
    return r ? { workflowId: r.workflowId, path: r.path, secret: r.secret } : null;
  }

  // ── Resume payload (workflow.sdk_resume_payloads) ─────────────────────────

  async persistResumePayload(executionId: string, payload: ResumePayload): Promise<void> {
    await db.sdkResumePayload.upsert({
      where: { executionId },
      create: {
        executionId,
        workspaceId: await workspaceOfExecution(executionId),
        payload: JSON.stringify(payload),
        createdAt: Date.now(),
      },
      update: { payload: JSON.stringify(payload) },
    });
  }

  async getResumePayload(executionId: string): Promise<ResumePayload | null> {
    // Read-then-delete inbox semantics, atomic in a transaction.
    return db.$transaction(async tx => {
      const r = await tx.sdkResumePayload.findUnique({ where: { executionId } });
      if (!r) return null;
      await tx.sdkResumePayload.delete({ where: { executionId } });
      return JSON.parse(r.payload) as ResumePayload;
    });
  }

  // ── Workflow callbacks (workflow.sdk_workflow_callbacks) ──────────────────

  async storeWorkflowCallback(record: WorkflowCallbackRecord): Promise<void> {
    await db.sdkWorkflowCallback.upsert({
      where: { workflowId: record.workflowId },
      create: {
        workflowId: record.workflowId,
        workspaceId: await workspaceOfWorkflow(record.workflowId),
        secret: record.secret,
        createdAt: Date.now(),
      },
      update: { secret: record.secret },
    });
  }

  async getWorkflowCallbackBySecret(secret: string): Promise<WorkflowCallbackRecord | null> {
    const r = await db.sdkWorkflowCallback.findUnique({ where: { secret } });
    return r
      ? { workflowId: r.workflowId, secret: r.secret, createdAt: new Date(Number(r.createdAt)) }
      : null;
  }

  async getWorkflowCallback(workflowId: string): Promise<WorkflowCallbackRecord | null> {
    const r = await db.sdkWorkflowCallback.findUnique({ where: { workflowId } });
    return r
      ? { workflowId: r.workflowId, secret: r.secret, createdAt: new Date(Number(r.createdAt)) }
      : null;
  }

  async rotateWorkflowCallback(
    workflowId: string,
    newSecret: string,
  ): Promise<WorkflowCallbackRecord> {
    const now = Date.now();
    await db.sdkWorkflowCallback.update({
      where: { workflowId },
      data: { secret: newSecret },
    });
    return { workflowId, secret: newSecret, createdAt: new Date(now) };
  }

  async removeWorkflowCallback(workflowId: string): Promise<void> {
    await db.sdkWorkflowCallback.deleteMany({ where: { workflowId } });
  }
}
