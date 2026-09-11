/**
 * `PersistenceAdapter` for `@xyne/workflow-sdk`, over Prisma.
 *
 * SDK workflows are automations with a wider step vocabulary, so this adapter maps
 * onto the EXISTING tables under a third `workflowType` discriminator rather than a
 * parallel set. See `docs/guidelines/workflows/PERSISTENCE.md` for why each table
 * is reused, which columns were added, and — importantly — why several methods below
 * are deliberately empty.
 *
 * Storage map:
 *   workflows        -> public.workflows              (config in `context`, NOT `configuration`)
 *   executions       -> public.workflow_executions
 *   execution_states -> workflow.workflow_execution_states
 *   step_records     -> workflow.workflow_steps       (node-paths in `stepName`)
 *   folders          -> workflow.workflow_folders
 *   credentials      -> workflow.workflow_credentials
 *
 * Tenant scoping is belt-and-braces. `db` already ANDs `{ workspaceId }` onto every
 * read and stamps it on insert (see `database/tenant/`), and this adapter ALSO pushes
 * `XyneFilter` into its queries because that is the SDK's contract and the surface the
 * authorizer will extend with sharing. Methods that are genuinely cross-tenant say so
 * and wrap themselves in `runAsSystem()` — without it the ambient scope silently
 * reduces them to the caller's workspace and they return nothing.
 *
 * @see docs/guidelines/workflows/PERSISTENCE.md
 */
import type {
  AuthSpecificValues,
  CreateCredentialInput,
  CredentialAuthType,
  CredentialListItem,
  CredentialStatus,
  CredentialSummary,
  ExecutionPauseType,
  ExecutionRecord,
  ExecutionStateRecord,
  FolderRecord,
  PersistenceAdapter,
  ResolvedCredential,
  ResourceAttributes,
  StepRecord,
  WebhookRecord,
  WorkflowCallbackRecord,
  WorkflowContext,
  WorkflowRecord,
} from '@xyne/workflow-sdk';
import { validateCredentialAuth, validateCredentialValues } from '@xyne/workflow-sdk';
import type { ResumePayload } from '@xyne/workflow-sdk/common';
import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { decrypt, encrypt } from '@/services/encryptionService';
import { triggerTypeToEventType } from '@/automations/types/workflow-adapter';
import {
  CREDENTIAL_ACTIVE,
  CREDENTIAL_REVOKED,
  CREDENTIAL_SUMMARY_SELECT,
  DEFAULT_FOLDER_ID,
  WORKFLOWS_SCOPE,
  TERMINAL_EXECUTION_STATUSES,
  WORKFLOWS_TYPE,
} from '../constants';
import type { XyneFilter, XyneResourceAttrs } from '../types';
import {
  decodeCursor,
  encodeCursor,
  notBacked,
  readNameFromMetadata,
  requireWorkspaceId,
  toCredentialSummary,
  toExecutionRecord,
  toFolderRecord,
  toStepRecord,
  toWorkflowRecord,
} from '../utils';

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class PrismaPersistenceAdapter implements PersistenceAdapter<XyneFilter> {
  // ── Workflow definitions ───────────────────────────────────────────────────

  async getWorkflow(id: string): Promise<WorkflowRecord | null> {
    const row = await db.workflow.findFirst({ where: { id, ...WORKFLOWS_SCOPE } });
    return row ? toWorkflowRecord(row) : null;
  }

  async listWorkflows(
    filter: XyneFilter,
    page?: { folderId?: string; limit?: number; offset?: number },
  ): Promise<WorkflowRecord[]> {
    const rows = await db.workflow.findMany({
      where: {
        workspaceId: filter.workspaceId,
        ...WORKFLOWS_SCOPE,
        ...(page?.folderId !== undefined ? { folderId: page.folderId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...(page?.limit !== undefined ? { take: page.limit } : {}),
      ...(page?.offset !== undefined ? { skip: page.offset } : {}),
    });
    return rows.map(toWorkflowRecord);
  }

  /**
   * Grouped in the query rather than by listing workflows and counting in JS — the
   * UI calls this to label every folder, so the naive version is an unbounded read.
   */
  async countWorkflowsByFolder(
    filter: XyneFilter,
  ): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }> {
    const grouped = await db.workflow.groupBy({
      by: ['folderId', 'status'],
      where: { workspaceId: filter.workspaceId, ...WORKFLOWS_SCOPE },
      _count: { _all: true },
    });

    const byFolder: Record<string, { total: number; active: number }> = {};
    let total = 0;

    for (const g of grouped) {
      const key = g.folderId ?? DEFAULT_FOLDER_ID;
      const count = g._count._all;
      const bucket = (byFolder[key] ??= { total: 0, active: 0 });
      bucket.total += count;
      if (g.status === 'ACTIVE') bucket.active += count;
      total += count;
    }

    return { total, byFolder };
  }

  /**
   * SYSTEM event routing, not user authorization — the SDK's own wording. A dispatched
   * event has no caller, so this must not be reduced to anyone's workspace by the
   * ambient scope; hence `runAsSystem`. The event's origin workspace arrives in
   * `eventScope` (from `DispatchEventInput.metadata`) and is applied explicitly.
   */
  async findActiveWorkflows(
    eventType: string,
    eventScope: Record<string, unknown>,
  ): Promise<WorkflowRecord[]> {
    const workspaceId =
      typeof eventScope['workspaceId'] === 'string' ? eventScope['workspaceId'] : undefined;

    return runAsSystem(async () => {
      const rows = await db.workflow.findMany({
        where: {
          ...WORKFLOWS_SCOPE,
          eventType,
          status: 'ACTIVE',
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      return rows.map(toWorkflowRecord);
    });
  }

  /**
   * Every ACTIVE SDK workflow across all workspaces. Not part of the SDK interface —
   * the worker's cold-start cron recovery needs it to re-register schedules after a
   * restart, which is inherently cross-tenant.
   */
  async listAllActiveWorkflows(): Promise<WorkflowRecord[]> {
    return runAsSystem(async () => {
      const rows = await db.workflow.findMany({ where: { ...WORKFLOWS_SCOPE, status: 'ACTIVE' } });
      return rows.map(toWorkflowRecord);
    });
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
    const workspaceId = requireWorkspaceId(data.attributes, 'createWorkflow');
    const row = await db.workflow.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        workspaceId,
        workflowType: WORKFLOWS_TYPE,
        status: data.status,
        context: data.config,
        metadata: data.metadata,
        eventType: triggerTypeToEventType(data.eventType),
        summary: data.summary ?? null,
        folderId: data.folderId,
        workflowName: readNameFromMetadata(data.metadata),
      },
      select: { id: true },
    });
    return row.id;
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
    const patch: Prisma.WorkflowUpdateManyMutationInput = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.config !== undefined) patch.context = data.config;
    // Same enum constraint and fallback as createWorkflow — see the note there.
    if (data.eventType !== undefined) patch.eventType = triggerTypeToEventType(data.eventType);
    if (data.summary !== undefined) patch.summary = data.summary;
    if (data.folderId !== undefined) patch.folderId = data.folderId;
    if (data.metadata !== undefined) {
      patch.metadata = data.metadata;
      patch.workflowName = readNameFromMetadata(data.metadata);
    }

    // updateMany, not update: it lets the WORKFLOWS_SCOPE narrowing ride along, so an id
    // belonging to an automation can never be mutated through this adapter.
    await db.workflow.updateMany({ where: { id, ...WORKFLOWS_SCOPE }, data: patch });
  }

  // ── Folders ────────────────────────────────────────────────────────────────

  async getFolder(id: string): Promise<FolderRecord | null> {
    const row = await db.workflowFolder.findUnique({ where: { id } });
    return row ? toFolderRecord(row) : null;
  }

  async listFolders(filter: XyneFilter): Promise<FolderRecord[]> {
    const rows = await db.workflowFolder.findMany({
      where: { workspaceId: filter.workspaceId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toFolderRecord);
  }

  /**
   * SYSTEM integrity read — the reparent cycle check must see folders the caller
   * cannot, or a hidden descendant lets a cycle through. These rows must never be
   * returned to a caller.
   */
  async listAllFolders(): Promise<FolderRecord[]> {
    return runAsSystem(async () => {
      const rows = await db.workflowFolder.findMany();
      return rows.map(toFolderRecord);
    });
  }

  /**
   * SYSTEM integrity read — deletion is blocked while a folder holds ANY workflow,
   * including ones the caller cannot see. Counting only visible rows would let a
   * caller delete a folder out from under someone else's workflows.
   */
  async countWorkflowsInFolder(folderId: string): Promise<number> {
    return runAsSystem(() => db.workflow.count({ where: { folderId, ...WORKFLOWS_SCOPE } }));
  }

  async createFolder(data: {
    id?: string;
    name: string;
    metadata: string;
    parentId?: string | null;
    attributes?: ResourceAttributes<'folder'>;
  }): Promise<string> {
    const workspaceId = requireWorkspaceId(data.attributes, 'createFolder');
    const now = new Date();
    const row = await db.workflowFolder.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        workspaceId,
        name: data.name,
        metadata: data.metadata,
        parentId: data.parentId ?? null,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    return row.id;
  }

  async updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<void> {
    // `updatedAt` is not managed by Prisma here (no @updatedAt), so every write sets it.
    const patch: Prisma.WorkflowFolderUpdateManyMutationInput = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.parentId !== undefined) patch.parentId = data.parentId;
    await db.workflowFolder.updateMany({ where: { id }, data: patch });
  }

  async deleteFolder(id: string): Promise<void> {
    await db.workflowFolder.deleteMany({ where: { id } });
  }
  // ── Execution lifecycle ────────────────────────────────────────────────────

  /**
   * `workspaceId` comes from `attributes` — the owning workflow's tenant, threaded by the
   * SDK from `context.workflow.attributes` (>= 3.2.34). The tenant stamper would also
   * fill it from the ambient context, but taking it from the framework's own scope
   * carrier means there is exactly one answer to "which tenant is this run", rather than
   * two mechanisms that can disagree.
   *
   * The same applies to `persistState` and `upsertStep` below.
   */
  async createExecution(data: {
    workflowId: string;
    status: string;
    context: string;
    sourceExecutionId?: string;
    attributes: ResourceAttributes<'workflow'>;
  }): Promise<string> {
    const workspaceId = requireWorkspaceId(data.attributes, 'createExecution');
    const row = await db.$transaction(async (tx) => {
      const created = await tx.workflowExecution.create({
        data: {
          workspaceId,
          workflowId: data.workflowId,
          workflowType: WORKFLOWS_TYPE,
          status: data.status,
          ...(data.sourceExecutionId
            ? { parentWorkflowExecutionId: data.sourceExecutionId, tag: 'rerun' }
            : { tag: 'root' }),
        },
        select: { id: true },
      });

      await tx.workflowExecutionState.create({
        data: {
          workflowExecutionId: created.id,
          workspaceId,
          context: data.context,
          currentStepIndex: 0,
        },
      });

      return created;
    });

    return row.id;
  }

  async updateExecutionStatus(executionId: string, status: string): Promise<void> {
    await db.workflowExecution.updateMany({
      where: { id: executionId, ...WORKFLOWS_SCOPE },
      data: { status },
    });
  }

  /**
   * SYSTEM read. The worker calls this to discover which workspace an execution belongs
   * to — i.e. *before* it can open a tenant context — so it must not itself be scoped by
   * one. Without `runAsSystem` the ambient filter would reduce it to the caller's
   * workspace, and in the worker (no context yet) it would return nothing at all.
   */
  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return runAsSystem(async () => {
      const row = await db.workflowExecution.findFirst({
        where: { id: executionId, ...WORKFLOWS_SCOPE },
        include: { workflow: { select: { metadata: true } } },
      });
      return row ? toExecutionRecord(row, row.workflow?.metadata ?? null) : null;
    });
  }

  /**
   * Executions inherit their workflow's visibility, so the filter is applied through
   * the relation rather than by materialising a list of visible workflow ids — that
   * keeps it one indexed query and does not defeat pagination.
   */
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
    const { limit } = params;
    const rows = await db.workflowExecution.findMany({
      where: {
        ...WORKFLOWS_SCOPE,
        workflow: {
          workspaceId: filter.workspaceId,
          ...WORKFLOWS_SCOPE,
          ...(params.folderId !== undefined ? { folderId: params.folderId } : {}),
        },
        ...(params.workflowId !== undefined ? { workflowId: params.workflowId } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.cursor !== undefined ? { createdAt: { lt: decodeCursor(params.cursor) } } : {}),
      },
      include: { workflow: { select: { metadata: true } } },
      orderBy: { createdAt: 'desc' },
      // One extra row is the cheapest way to answer "is there another page?".
      ...(limit !== undefined ? { take: limit + 1 } : {}),
    });

    const hasMore = limit !== undefined && rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((r) => toExecutionRecord(r, r.workflow?.metadata ?? null));
    const last = page[page.length - 1];

    return hasMore && last
      ? { items, nextCursor: encodeCursor(last.createdAt) }
      : { items };
  }

  // ── Execution state ────────────────────────────────────────────────────────

  async getExecutionState(executionId: string): Promise<ExecutionStateRecord | null> {
    const row = await db.workflowExecutionState.findUnique({
      where: { workflowExecutionId: executionId },
      select: { context: true, currentStepIndex: true, pausePath: true, pauseType: true },
    });
    if (!row) return null;
    return {
      context: row.context,
      currentStepIndex: row.currentStepIndex,
      pausePath: row.pausePath,
      ...(row.pauseType ? { pauseType: row.pauseType as ExecutionPauseType } : {}),
    };
  }

  async persistState(
    executionId: string,
    data: {
      context: string;
      currentStepIndex?: number;
      pausePath?: string;
      pauseType?: ExecutionPauseType;
      attributes: ResourceAttributes<'workflow'>;
    },
  ): Promise<void> {
    const shared = {
      context: data.context,
      pausePath: data.pausePath ?? null,
      pauseType: data.pauseType ?? null,
      ...(data.currentStepIndex !== undefined ? { currentStepIndex: data.currentStepIndex } : {}),
    };
    await db.workflowExecutionState.upsert({
      where: { workflowExecutionId: executionId },
      create: {
        workflowExecutionId: executionId,
        workspaceId: requireWorkspaceId(data.attributes, 'persistState'),
        ...shared,
      },
      update: shared,
    });
  }

  // ── Step records ───────────────────────────────────────────────────────────

  /**
   * `stepName` is a NODE-PATH (`parallel_x:swot#0/approve`), not a flat step id — that
   * is what lets two PARALLEL branches park independently and resume by address. The
   * upsert target is `workflow_steps`' pre-existing `@@unique([workflowExecutionId,
   * stepName])`, which happens to be exactly the SDK's composite key.
   */
  async upsertStep(
    executionId: string,
    stepName: string,
    data: {
      status: string;
      executorType: string;
      data?: string;
      attributes: ResourceAttributes<'workflow'>;
    },
  ): Promise<void> {
    const shared = {
      status: data.status,
      stepExecutorType: data.executorType,
      data: data.data ?? null,
    };
    await db.workflowStep.upsert({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      create: {
        workflowExecutionId: executionId,
        workspaceId: requireWorkspaceId(data.attributes, 'upsertStep'),
        stepName,
        ...shared,
      },
      update: shared,
    });
  }

  async getStepRows(executionId: string): Promise<StepRecord[]> {
    const rows = await db.workflowStep.findMany({
      where: { workflowExecutionId: executionId },
      select: { stepName: true, status: true, stepExecutorType: true, data: true },
    });
    return rows.map(toStepRecord);
  }

  async getStep(executionId: string, stepName: string): Promise<StepRecord | null> {
    const row = await db.workflowStep.findUnique({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      select: { stepName: true, status: true, stepExecutorType: true, data: true },
    });
    return row ? toStepRecord(row) : null;
  }

  /**
   * Atomic by contract. The terminal-status guard lives in the WHERE clause so a
   * concurrent pass cannot resurrect a finished run: either the conditional update
   * matches a live row, or it matched nothing and we distinguish "already terminal"
   * from "never existed" with a follow-up read.
   *
   * `error` is intentionally not persisted to a column. The SDK's own error channel is
   * `__meta.error` inside the execution context, which `persistState` has already
   * written; duplicating it here would give two sources of truth that can disagree.
   */
  async markFailed(
    executionId: string,
    _error: string,
  ): Promise<'marked' | 'skipped-terminal' | 'not-found'> {
    const { count } = await db.workflowExecution.updateMany({
      where: {
        id: executionId,
        ...WORKFLOWS_SCOPE,
        status: { notIn: [...TERMINAL_EXECUTION_STATUSES] },
      },
      data: { status: 'FAILED' },
    });
    if (count > 0) return 'marked';

    const exists = await db.workflowExecution.findFirst({
      where: { id: executionId, ...WORKFLOWS_SCOPE },
      select: { id: true },
    });
    return exists ? 'skipped-terminal' : 'not-found';
  }

  // ── Credentials ────────────────────────────────────────────────────────────

  async listCredentials(
    filter: XyneFilter,
    page?: { limit?: number; offset?: number },
  ): Promise<CredentialListItem[]> {
    const rows = await db.workflowCredential.findMany({
      where: { workspaceId: filter.workspaceId },
      select: CREDENTIAL_SUMMARY_SELECT,
      orderBy: { name: 'asc' },
      ...(page?.limit !== undefined ? { take: page.limit } : {}),
      ...(page?.offset !== undefined ? { skip: page.offset } : {}),
    });
    return rows.map((row) => ({
      summary: toCredentialSummary(row),
      attributes: { workspaceId: row.workspaceId } satisfies XyneResourceAttrs,
    }));
  }

  async createCredential(
    attributes: ResourceAttributes<'credential'>,
    input: CreateCredentialInput,
  ): Promise<CredentialSummary> {
    const workspaceId = requireWorkspaceId(attributes, 'createCredential');
    const values = validateCredentialValues(input.authType, input.values);

    const existing = await db.workflowCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name: input.name } },
      select: { name: true },
    });
    if (existing) {
      throw new Error(`Credential "${input.name}" already exists`);
    }

    const now = new Date();
    const row = await db.workflowCredential.create({
      data: {
        workspaceId,
        name: input.name,
        credType: input.authType,
        data: encrypt(JSON.stringify(values)),
        status: CREDENTIAL_ACTIVE,
        createdAt: now,
        updatedAt: now,
      },
      select: CREDENTIAL_SUMMARY_SELECT,
    });
    return toCredentialSummary(row);
  }

  async replaceCredentialValues(
    attributes: ResourceAttributes<'credential'>,
    name: string,
    values: AuthSpecificValues,
  ): Promise<CredentialSummary | null> {
    const workspaceId = requireWorkspaceId(attributes, 'replaceCredentialValues');
    const existing = await db.workflowCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: { credType: true },
    });
    if (!existing) return null;
    const validated = validateCredentialValues(existing.credType as CredentialAuthType, values);
    const row = await db.workflowCredential.update({
      where: { workspaceId_name: { workspaceId, name } },
      data: {
        data: encrypt(JSON.stringify(validated)),
        status: CREDENTIAL_ACTIVE,
        updatedAt: new Date(),
      },
      select: CREDENTIAL_SUMMARY_SELECT,
    });
    return toCredentialSummary(row);
  }

  /**
   * Revocation is a status flip, not a delete: steps referencing the credential by name
   * must keep resolving to a row so they fail with "revoked" rather than "not found",
   * and the audit trail survives.
   */
  async revokeCredential(
    attributes: ResourceAttributes<'credential'>,
    name: string,
  ): Promise<CredentialSummary | null> {
    const workspaceId = requireWorkspaceId(attributes, 'revokeCredential');
    const { count } = await db.workflowCredential.updateMany({
      where: { workspaceId, name },
      data: { status: CREDENTIAL_REVOKED, updatedAt: new Date() },
    });
    if (count === 0) return null;
    const row = await db.workflowCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: CREDENTIAL_SUMMARY_SELECT,
    });
    return row ? toCredentialSummary(row) : null;
  }

  /**
   * The only path that decrypts. Called by the executor to hand a step its auth, and by
   * the credential-test route.
   *
   * A running execution passes the workflow identity (whose `attributes` carry the
   * tenant the run acts as); the test route has no execution, so it passes trusted
   * workspace attributes directly. Revoked credentials resolve to null so a step fails
   * closed.
   */
  async resolveCredential(
    workflowOrAttributes: WorkflowContext['workflow'] | ResourceAttributes<'workflow'>,
    name: string,
  ): Promise<ResolvedCredential | null> {
    const attributes =
      workflowOrAttributes && typeof workflowOrAttributes === 'object' && 'attributes' in workflowOrAttributes
        ? (workflowOrAttributes as WorkflowContext['workflow']).attributes
        : workflowOrAttributes;
    const workspaceId = requireWorkspaceId(attributes, 'resolveCredential');

    const row = await db.workflowCredential.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: { name: true, credType: true, status: true, data: true },
    });
    if (!row || row.status !== CREDENTIAL_ACTIVE) return null;

    const values = JSON.parse(decrypt(row.data)) as unknown;
    const auth = validateCredentialAuth(row.credType as CredentialAuthType, values);
    return { name: row.name, status: row.status as CredentialStatus, ...auth };
  }
  // ═════════════════════════════════════════════════════════════════════════════
  // NOT BACKED BY DESIGN — no table exists, and none is planned for the first cut.
  //
  // Unlike the slices above, these are NOT unfinished work. Each is empty for a
  // specific reason recorded below and in PERSISTENCE.md. Adding a table to "fix"
  // one of them undoes a deliberate decision — read the doc first.
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * DEFERRED — step_events table not created.
   *
   * Safe as a no-op: the executor calls this fire-and-forget with a `.catch()` that
   * only warns, and forwards the same event to the SSE bus on a separate path. Live
   * streaming is therefore unaffected; only *replay* is lost, so a client joining
   * mid-run or reloading sees no prior within-step progress.
   */
  async appendStepEvent(
    _executionId: string,
    _stepName: string,
    _event: { type: string; data: string },
    _attributes: ResourceAttributes<'workflow'>,
  ): Promise<void> {
    return Promise.resolve();
  }

  /** DEFERRED — see {@link appendStepEvent}. Empty history, never an error. */
  async getStepEvents(
    _executionId: string,
    _stepName: string,
    _after?: Date,
  ): Promise<Array<{ id: string; type: string; data: string; createdAt: Date }>> {
    return Promise.resolve([]);
  }

  /**
   * DEFERRED — static_data table not created.
   *
   * THROWS ON PURPOSE, rather than returning undefined. Only two things use static
   * data: `CronTrigger.poll()` — which `DefaultCronTrigger` does not implement, so
   * cron never reaches here — and the DEDUP step, which `StepRegistry` auto-registers
   * in its constructor with no way to exclude it. DEDUP therefore appears in the step
   * picker whether or not we back it. A silent no-op would give authors a DEDUP step
   * that runs and never deduplicates; failing loudly is the lesser harm.
   */
  async getStaticData(_workflowId: string, _key: string): Promise<unknown> {
    return notBacked('getStaticData', 'the DEDUP step is not supported in this deployment');
  }

  /** DEFERRED — see {@link getStaticData}. */
  async setStaticData(_workflowId: string, _key: string, _value: unknown): Promise<void> {
    return notBacked('setStaticData', 'the DEDUP step is not supported in this deployment');
  }

  /** DEFERRED — see {@link getStaticData}. */
  async deleteStaticData(_workflowId: string, _key: string): Promise<void> {
    return notBacked('deleteStaticData', 'the DEDUP step is not supported in this deployment');
  }

  /**
   * UNUSED BY DESIGN — webhooks table not created, and unreachable.
   *
   * `storeWebhookPath` is called only under `if (trigger instanceof WebhookTrigger)`.
   * We register `DefaultWebhookV2Trigger`, which extends `ManualTrigger`, and the v2
   * public trigger route resolves a workflow by id in the path rather than by a stored
   * secret. Nothing can reach this unless the classic `DefaultWebhookTrigger` is
   * registered — at which point this table becomes required.
   */
  async storeWebhookPath(_workflowId: string, _path: string, _secret: string): Promise<void> {
    return notBacked(
      'storeWebhookPath',
      'only the v2 webhook trigger is registered, which needs no stored path',
    );
  }

  /** UNUSED — see {@link storeWebhookPath}. */
  async removeWebhookPath(_workflowId: string): Promise<void> {
    return Promise.resolve();
  }

  /**
   * UNUSED — see {@link storeWebhookPath}. Returns null rather than throwing: this is
   * the inbound lookup for the legacy `/webhooks/:id/:secret` route, and null makes it
   * a clean 404, which is the correct answer when no workflow can carry that trigger.
   */
  async getWebhookByPath(_path: string): Promise<WebhookRecord | null> {
    return Promise.resolve(null);
  }

  /**
   * UNUSED BY DESIGN — resume_payloads table not created, and not needed.
   *
   * Resume payloads are per-STEP: `resumeInternal` routes them onto the target gate's
   * own step record (`data.resumePayload`), addressed by node-path, which is what lets
   * two PARALLEL branches pause and resume independently. This per-EXECUTION slot is a
   * back-compat fallback the executor itself labels legacy, reached only when a paused
   * execution has ZERO identifiable gate records — impossible on a greenfield install.
   *
   * It throws while {@link getResumePayload} returns null, and that asymmetry is
   * deliberate: see there.
   */
  async persistResumePayload(_executionId: string, _payload: ResumePayload): Promise<void> {
    return notBacked(
      'persistResumePayload',
      'resume payloads ride on the gate step record; this legacy per-execution slot should be unreachable',
    );
  }

  /**
   * UNUSED — but MUST NOT THROW.
   *
   * Unlike its writer, this sits on the routine read path: the executor calls it on
   * every resume pass that has a sole open gate, as a back-compat bridge. Throwing
   * here would break ordinary resumes. Null means "no legacy payload", which is always
   * true for us.
   */
  async getResumePayload(_executionId: string): Promise<ResumePayload | null> {
    return Promise.resolve(null);
  }

  /**
   * DEFERRED — workflow_callbacks table not created.
   *
   * Serves only the WAIT step's `webhook` mode. WAIT's `delay` and `approval` modes are
   * unaffected, and `approval` is the one review gates use. The host is what surfaces a
   * callback URL, so leaving these unimplemented and the `/wait/callback/...` route
   * unmounted keeps webhook-mode WAIT unreachable rather than half-working.
   */
  async storeWorkflowCallback(_record: WorkflowCallbackRecord): Promise<void> {
    return notBacked('storeWorkflowCallback', "WAIT webhook mode is not enabled");
  }

  /** DEFERRED — see {@link storeWorkflowCallback}. Null → the callback route 404s. */
  async getWorkflowCallbackBySecret(_secret: string): Promise<WorkflowCallbackRecord | null> {
    return Promise.resolve(null);
  }

  /** DEFERRED — see {@link storeWorkflowCallback}. */
  async getWorkflowCallback(_workflowId: string): Promise<WorkflowCallbackRecord | null> {
    return Promise.resolve(null);
  }

  /** DEFERRED — see {@link storeWorkflowCallback}. */
  async rotateWorkflowCallback(
    _workflowId: string,
    _newSecret: string,
  ): Promise<WorkflowCallbackRecord> {
    return notBacked('rotateWorkflowCallback', "WAIT webhook mode is not enabled");
  }

  /** DEFERRED — see {@link storeWorkflowCallback}. */
  async removeWorkflowCallback(_workflowId: string): Promise<void> {
    return Promise.resolve();
  }
}
