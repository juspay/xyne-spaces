/**
 * In-memory PersistenceAdapter for testing.
 *
 * All data lives in Maps — no external deps. Useful for unit tests
 * and for hosts bootstrapping without a database.
 */

import type {
  PersistenceAdapter,
  WorkflowRecord,
  FolderRecord,
  ExecutionOrigin,
  ExecutionRecord,
  ExecutionStateRecord,
  StepRecord,
  CursorPage,
  Paged,
  PendingApprovalRow,
  PendingApprovalQuery,
  PendingApprovalBucket,
  PendingApprovalCountQuery,
  PendingApprovalFacets,
  LastRun,
} from './types.js';
import { leafStepId } from '../engine/node-path.js';
import { GateCategory } from '../types/known-types.js';
import { type IdScope, applyIdScope } from '../authz/id-scope.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import { WorkflowStatus } from '../types/status.js';
import type { WorkflowContext } from '../types/context.js';

import type {
  CredentialSummary,
  CredentialListItem,
  ResolvedCredential,
  CreateCredentialInput,
  AuthSpecificValues,
  CredentialAuthType,
  CredentialStatus,
} from '../common/credentials.js';
import {
  validateCredentialAuth,
  validateCredentialValues,
} from '../common/credentials.js';

/**
 * Where a row sits in a list's order. `key` is rendered so lexicographic
 * comparison matches the intended order (an ISO timestamp, a name).
 */
interface SortPosition {
  key: string;
  id: string;
}

const encodeCursor = (position: SortPosition): string =>
  `${position.key}\u0000${position.id}`;

const decodeCursor = (cursor: string): SortPosition | null => {
  const sep = cursor.indexOf('\u0000');
  if (sep < 0) return null;
  return { key: cursor.slice(0, sep), id: cursor.slice(sep + 1) };
};

/** Compare two positions as a tuple, in the list's own direction. */
function comparePositions(a: SortPosition, b: SortPosition, direction: 'asc' | 'desc'): number {
  const keyOrder = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  if (keyOrder !== 0) return direction === 'asc' ? keyOrder : -keyOrder;
  // The tiebreaker always ascends, matching the sorts below.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Take one cursor page out of an already-sorted, already-filtered array — the
 * stand-in for `WHERE (sort_key, id) > (:key, :id) … LIMIT :n`.
 *
 * The seek is positional, not "the row after this id": rows leave these lists
 * by design, and an index-based seek would strand everything behind a resolved
 * row. `nextCursor` is set only when rows actually remain, so Load-more never
 * fetches an empty page.
 */
/**
 * Keep only the rows in one deadline bucket — the in-memory twin of the SQL
 * adapter's bucket predicate.
 *
 * It exists so the test double cannot quietly disagree with the real store: a
 * suite that passes against a double which ignores `bucket` would prove
 * nothing about the queue a reviewer actually sees. Rows with no deadline are
 * in NO bucket, only in the unbucketed queue.
 */
function inBucket<T extends { dueAt?: Date }>(
  rows: T[],
  params: { bucket?: PendingApprovalBucket; dayEnd?: number },
  now: number = Date.now(),
): T[] {
  if (!params.bucket) return rows;
  const endOfToday = params.dayEnd ?? new Date(now).setHours(24, 0, 0, 0);
  return rows.filter((r) => {
    const due = r.dueAt?.getTime();
    if (due === undefined) return false;
    if (params.bucket === 'overdue') return due < now;
    // Due soon: tomorrow or the day after — today has its own bucket.
    if (params.bucket === 'dueSoon') return due >= endOfToday && due < endOfToday + 2 * 86_400_000;
    return due >= now && due < endOfToday;
  });
}

function cursorPage<T>(
  items: readonly T[],
  page: CursorPage,
  positionOf: (item: T) => SortPosition,
  direction: 'asc' | 'desc' = 'asc',
): Paged<T> {
  let rest = items;

  if (page.cursor !== undefined) {
    const from = decodeCursor(page.cursor);
    // A caller error, not a vanished row — serving page one would hide it.
    if (!from) return { items: [] };
    const start = rest.findIndex(
      (item) => comparePositions(positionOf(item), from, direction) > 0,
    );
    rest = start < 0 ? [] : rest.slice(start);
  }

  const slice = rest.slice(0, page.limit);
  const result: Paged<T> = { items: [...slice] };
  if (slice.length > 0 && rest.length > slice.length) {
    result.nextCursor = encodeCursor(positionOf(slice[slice.length - 1]!));
  }
  return result;
}

/** A position ordered by time, newest first, with the id breaking ties. */
const byTime = (createdAt: Date, id: string): SortPosition => ({
  key: createdAt.toISOString(),
  id,
});

/** A position ordered by name, with the id breaking ties. */
const byName = (name: string, id: string): SortPosition => ({ key: name, id });

/**
 * Find a step config by id anywhere in a workflow config tree. A step node is
 * any object carrying both `id` and `type`. Labels paused gates in the queue;
 * a real adapter would read the title in the same query rather than walk JSON.
 */
function findStepConfigById(
  config: unknown,
  id: string,
): { id: string; title?: string } | null {
  let found: { id: string; title?: string } | null = null;
  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj['id'] === 'string' && typeof obj['type'] === 'string' && obj['id'] === id) {
      found = { id, ...(typeof obj['title'] === 'string' ? { title: obj['title'] } : {}) };
      return;
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(config);
  return found;
}

/** Read a workflow's JSON `metadata` without making a parse failure fatal. */
function workflowMeta(record: WorkflowRecord | undefined): {
  name?: string;
  tags?: string[];
} {
  if (!record?.metadata) return {};
  try {
    const meta = JSON.parse(record.metadata) as Record<string, unknown>;
    const tags = Array.isArray(meta['tags'])
      ? (meta['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : undefined;
    return {
      ...(typeof meta['name'] === 'string' ? { name: meta['name'] } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Speaks {@link IdScope} — the SDK's default `TFilter`. A production adapter
 * should choose its own filter type and push it into a real query instead.
 */
export class InMemoryPersistenceAdapter implements PersistenceAdapter<IdScope> {
  readonly workflows = new Map<string, WorkflowRecord>();
  readonly folders = new Map<string, FolderRecord>();
  readonly executions = new Map<string, ExecutionRecord>();
  readonly executionStates = new Map<string, ExecutionStateRecord>();
  /** Keyed by `${executionId}::${stepName}`. */
  readonly steps = new Map<string, StepRecord>();
  /** Keyed by `${workflowId}::${key}`. */
  readonly staticData = new Map<string, unknown>();
  /**
   * In-memory credential store.
   *
   * Each entry is the full vault record: metadata fields (name, authType,
   * status, createdAt, updatedAt) PLUS the decrypted `values` object.
   * In production (Drizzle adapter) the values are encrypted in the `data`
   * column; here they're stored in plaintext since this is a test adapter.
   *
   * Keyed by credential `name` — the same key used for lookup by
   * `resolveCredential` and for duplicate-name checks in `createCredential`.
   * The workspace scope from `metadata` is ignored in the in-memory adapter
   * (tests run single-workspace); the Drizzle adapter scopes by
   * `(workspace_id, name)` via SQL WHERE clauses.
   */
  readonly credentials = new Map<
    string,
    {
      name: string;
      credType: string;
      authType: CredentialAuthType;
      status: CredentialStatus;
      createdAt: number;
      updatedAt: number;
      values: AuthSpecificValues;
      attributes?: ResourceAttributes<'credential'>;
    }
  >();
  /** Keyed by `${executionId}::${stepName}`, stores ordered event arrays. */
  readonly stepEvents = new Map<
    string,
    Array<{ id: string; type: string; data: string; createdAt: Date }>
  >();

  private nextId = 1;

  private genId(): string {
    return `id_${String(this.nextId++)}`;
  }

  // --- Workflow definitions ---

  async getWorkflow(id: string): Promise<WorkflowRecord | null> {
    return this.workflows.get(id) ?? null;
  }

  async listWorkflows(
    filter: IdScope,
    page: CursorPage & { folderId?: string },
  ): Promise<Paged<WorkflowRecord>> {
    let items = applyIdScope(Array.from(this.workflows.values()), filter);
    if (page.folderId !== undefined) {
      items = items.filter((w) => w.folderId === page.folderId);
    }
    // Stable order is what makes the cursor mean anything, and the cursor is
    // built from exactly these two columns. Newest first, with the id breaking
    // ties so two workflows created in the same millisecond cannot swap places
    // between pages.
    items.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    return cursorPage(items, page, (w) => byTime(w.createdAt, w.id), 'desc');
  }

  async listPendingWorkflows(
    filter: IdScope,
    params: CursorPage,
  ): Promise<Paged<WorkflowRecord>> {
    const items = applyIdScope(Array.from(this.workflows.values()), filter).filter(
      (w) => w.status === WorkflowStatus.PENDING_APPROVAL,
    );

    // Newest first, and `updatedAt` rather than `createdAt`: the queue is
    // ordered by when things were submitted, not when they were written.
    items.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
    );

    return cursorPage(items, params, (w) => byTime(w.updatedAt, w.id), 'desc');
  }

  async countWorkflowsByFolder(
    filter: IdScope,
  ): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }> {
    const byFolder: Record<string, { total: number; active: number }> = {};
    let total = 0;
    for (const w of applyIdScope(Array.from(this.workflows.values()), filter)) {
      total++;
      const entry = byFolder[w.folderId] ?? { total: 0, active: 0 };
      entry.total++;
      if (w.status === 'ACTIVE') entry.active++;
      byFolder[w.folderId] = entry;
    }
    return { total, byFolder };
  }

  async findActiveWorkflows(
    eventType: string,
    _eventScope: Record<string, unknown>,
  ): Promise<WorkflowRecord[]> {
    return Array.from(this.workflows.values()).filter(
      (w) => w.eventType === eventType && w.status === 'ACTIVE',
    );
  }

  async createWorkflow(data: {
    id?: string;
    status: string;
    config: string;
    metadata: string;
    eventType: string;
    summary?: string | null;
    folderId: string;
    attributes?: WorkflowRecord['attributes'];
  }): Promise<string> {
    const id = data.id ?? this.genId();
    const now = new Date();
    const record: WorkflowRecord = {
      id,
      status: data.status,
      config: data.config,
      metadata: data.metadata,
      eventType: data.eventType,
      summary: data.summary ?? null,
      folderId: data.folderId,
      createdAt: now,
      updatedAt: now,
      ...(data.attributes !== undefined ? { attributes: data.attributes } : {}),
    };
    this.workflows.set(id, record);
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
    const existing = this.workflows.get(id);
    if (!existing) throw new Error(`Workflow ${id} not found`);
    if (data.status !== undefined) existing.status = data.status;
    if (data.config !== undefined) existing.config = data.config;
    if (data.metadata !== undefined) existing.metadata = data.metadata;
    if (data.eventType !== undefined) existing.eventType = data.eventType;
    if (data.summary !== undefined) existing.summary = data.summary;
    if (data.folderId !== undefined) existing.folderId = data.folderId;
    existing.updatedAt = new Date();
  }

  // --- Folders ---

  async getFolder(id: string): Promise<FolderRecord | null> {
    return this.folders.get(id) ?? null;
  }

  async listFolders(filter: IdScope, page: CursorPage): Promise<Paged<FolderRecord>> {
    const items = applyIdScope(Array.from(this.folders.values()), filter);
    // By name, which is how the rail shows them. The cursor carries that name
    // plus the id, so a folder inserted above the cursor does not shift the page.
    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return cursorPage(items, page, (f) => byName(f.name, f.id));
  }

  /** System integrity read — deliberately unfiltered. See the port docs. */
  async listAllFolders(): Promise<FolderRecord[]> {
    return Array.from(this.folders.values());
  }

  /** System integrity read — deliberately unfiltered. See the port docs. */
  async countWorkflowsInFolder(folderId: string): Promise<number> {
    let n = 0;
    for (const w of this.workflows.values()) if (w.folderId === folderId) n++;
    return n;
  }

  async createFolder(data: {
    id?: string;
    name: string;
    metadata: string;
    parentId?: string | null;
    attributes?: FolderRecord['attributes'];
  }): Promise<string> {
    const id = data.id ?? this.genId();
    this.folders.set(id, {
      id,
      name: data.name,
      metadata: data.metadata,
      parentId: data.parentId ?? null,
      ...(data.attributes !== undefined ? { attributes: data.attributes } : {}),
    });
    return id;
  }

  async updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<void> {
    const existing = this.folders.get(id);
    if (!existing) throw new Error(`Folder ${id} not found`);
    if (data.name !== undefined) existing.name = data.name;
    if ('parentId' in data) existing.parentId = data.parentId ?? null;
  }

  async deleteFolder(id: string): Promise<void> {
    this.folders.delete(id);
  }

  // --- Execution lifecycle ---

  /**
   * The in-memory twin of the SQL adapter's unique (workflow, name) rule, so
   * tests exercise the same clash behaviour a real store enforces.
   */
  private claimRunName(
    data: { workflowId: string; name?: string; nameConflict?: 'suffix' | 'reject' },
    at: Date,
  ): { name: string; nameAutoGenerated: boolean } {
    const provided = data.name?.trim();
    const base =
      provided ||
      `Run-${at.toISOString().replace('T', '-').replace(/[:.]/g, '-').replace('Z', '-UTC')}`;
    const taken = new Set(
      [...this.executions.values()]
        .filter((e) => e.workflowId === data.workflowId)
        .map((e) => e.name),
    );
    const mode = provided ? (data.nameConflict ?? 'suffix') : 'suffix';
    for (let n = 0; ; n++) {
      const name = n === 0 ? base : `${base}#${String(n)}`;
      if (!taken.has(name)) return { name, nameAutoGenerated: !provided };
      if (mode === 'reject') throw new Error(`Workflow run identifier "${base}" already exists`);
    }
  }

  async createExecution(data: {
    workflowId: string;
    name?: string;
    nameConflict?: 'suffix' | 'reject';
    status: string;
    context: string;
    sourceExecutionId?: string;
    fireAt?: Date;
    origin?: ExecutionOrigin;
    // Accepted to satisfy the interface and ignored: this adapter is a Map, with no
    // tenant-keyed rows to scope. A real adapter stamps its rows with this.
    attributes?: unknown;
  }): Promise<string> {
    const id = this.genId();
    const createdAt = new Date();
    const { name, nameAutoGenerated } = this.claimRunName(data, createdAt);
    const record: ExecutionRecord = {
      id,
      workflowId: data.workflowId,
      name,
      nameAutoGenerated,
      status: data.status,
      createdAt,
    };
    if (data.sourceExecutionId !== undefined) {
      record.sourceExecutionId = data.sourceExecutionId;
    }
    if (data.fireAt !== undefined) {
      record.fireAt = data.fireAt;
    }
    if (data.origin !== undefined) {
      record.origin = data.origin;
    }
    this.executions.set(id, record);
    this.executionStates.set(id, {
      context: data.context,
      currentStepIndex: 0,
      pausePath: null,
    });
    return id;
  }

  async updateExecutionStatus(
    executionId: string,
    status: string,
    reason?: string,
  ): Promise<void> {
    const exec = this.executions.get(executionId);
    if (exec) {
      exec.status = status;
      if (reason !== undefined) exec.endReason = reason;
    }
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }

  /**
   * Executions the caller can see, newest first — the shared
   * `FROM executions JOIN workflows … WHERE <filter>` the runs list, the
   * approvals inbox and the last-run lookup all start from.
   */
  private visibleExecutions(
    filter: IdScope,
    scope: { workflowId?: string; status?: string; folderId?: string },
  ): ExecutionRecord[] {
    const visibleWorkflows = new Set(
      applyIdScope(Array.from(this.workflows.values()), filter).map((w) => w.id),
    );

    let items = Array.from(this.executions.values()).filter((e) =>
      visibleWorkflows.has(e.workflowId),
    );

    if (scope.folderId !== undefined) {
      const folderWorkflowIds = new Set(
        Array.from(this.workflows.values())
          .filter((w) => w.folderId === scope.folderId)
          .map((w) => w.id),
      );
      items = items.filter((e) => folderWorkflowIds.has(e.workflowId));
    }
    if (scope.workflowId) {
      items = items.filter((e) => e.workflowId === scope.workflowId);
    }
    if (scope.status) {
      items = items.filter((e) => e.status === scope.status);
    }

    // Id breaks ties so the cursor cannot straddle two runs created in the
    // same millisecond.
    items.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    return items;
  }

  async listExecutions(
    filter: IdScope,
    params: CursorPage & {
      workflowId?: string;
      status?: string;
      folderId?: string;
    },
  ): Promise<Paged<ExecutionRecord>> {
    const items = this.visibleExecutions(filter, params);
    return cursorPage(items, params, (e) => byTime(e.createdAt, e.id), 'desc');
  }

  // --- Approvals inbox ---

  /**
   * The paused gate of one execution. Prefers the resumable leaf over a control
   * step merely waiting on a branch — the leaf is what a resume addresses.
   */
  private pausedGate(
    executionId: string,
  ): { nodePath: string; displayName: string; dueAt?: Date } | null {
    const prefix = `${executionId}::`;
    const rows: StepRecord[] = [];
    for (const [key, value] of this.steps) {
      if (key.startsWith(prefix)) rows.push(value);
    }

    // The inbox is an approver's work list: not a machine gate, not a clock, and
    // not a customer mid-conversation. A record written before gates carried a
    // category has none and still counts — a missed approval is worse than a
    // stale row, and those drain as their runs finish.
    const wanted = (s: StepRecord): boolean =>
      s.category === GateCategory.WaitingOnApprover || s.category === undefined;

    const parked = (s: StepRecord): boolean =>
      s.status === 'EXTERNAL_WAIT' || s.status === 'REVIEW_WAIT';

    const step =
      rows.find((s) => parked(s) && s.executorType !== 'conditional' && wanted(s)) ??
      rows.find((s) => s.status === 'EXTERNAL_WAIT' && wanted(s));
    if (!step) return null;

    // The deadline the WAIT step stamped when it opened this gate. A gate
    // without one simply has no deadline — never treated as overdue.
    let dueAt: Date | undefined;
    if (step.data) {
      try {
        const raw = (JSON.parse(step.data) as Record<string, unknown>)['dueAt'];
        if (typeof raw === 'string') {
          const parsed = new Date(raw);
          if (!isNaN(parsed.getTime())) dueAt = parsed;
        }
      } catch {
        // An unreadable pause state costs the deadline, never the row.
      }
    }

    return {
      nodePath: step.stepName,
      displayName: leafStepId(step.stepName),
      ...(dueAt !== undefined ? { dueAt } : {}),
    };
  }

  async listPendingApprovals(
    filter: IdScope,
    params: PendingApprovalQuery,
  ): Promise<Paged<PendingApprovalRow>> {
    let rows = inBucket(this.pendingApprovalRows(filter), params);

    if (params.workflowIds && params.workflowIds.length > 0) {
      const wanted = new Set(params.workflowIds);
      rows = rows.filter((r) => wanted.has(r.workflowId));
    }
    if (params.stages && params.stages.length > 0) {
      const wanted = new Set(params.stages);
      rows = rows.filter((r) => wanted.has(r.pausedStepName));
    }
    if (params.tags && params.tags.length > 0) {
      const wanted = new Set(params.tags);
      rows = rows.filter((r) => (r.tags ?? []).some((t) => wanted.has(t)));
    }
    if (params.search) {
      const q = params.search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          (r.workflowName ?? r.workflowId).toLowerCase().includes(q) ||
          r.pausedStepName.toLowerCase().includes(q),
      );
    }
    // Deadline order is only meaningful on a bucketed page — off it, most rows
    // have no deadline at all. Matches the SQL adapter's own guard.
    const byDue = params.sort === 'due' && params.bucket !== undefined;
    if (byDue) {
      rows = [...rows].sort(
        (a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0),
      );
      return cursorPage(rows, params, (r) => byTime(r.dueAt ?? r.createdAt, r.id), 'asc');
    }

    // `pendingApprovalRows` builds newest-first; reversing gives oldest-first,
    // and the cursor direction has to follow or the seek runs the wrong way.
    const direction = params.sort === 'oldest' ? 'asc' : 'desc';
    if (direction === 'asc') rows.reverse();

    return cursorPage(rows, params, (r) => byTime(r.createdAt, r.id), direction);
  }

  async countPendingApprovals(
    filter: IdScope,
    params?: PendingApprovalCountQuery,
  ): Promise<number> {
    return inBucket(this.pendingApprovalRows(filter), params ?? {}).length;
  }

  async pendingApprovalFacets(filter: IdScope): Promise<PendingApprovalFacets> {
    const rows = this.pendingApprovalRows(filter);

    const workflows = new Map<string, { workflowId: string; name: string; count: number }>();
    const stages = new Map<string, number>();
    const tags = new Set<string>();

    for (const row of rows) {
      const entry = workflows.get(row.workflowId) ?? {
        workflowId: row.workflowId,
        name: row.workflowName ?? row.workflowId,
        count: 0,
      };
      entry.count++;
      workflows.set(row.workflowId, entry);

      stages.set(row.pausedStepName, (stages.get(row.pausedStepName) ?? 0) + 1);
      for (const tag of row.tags ?? []) tags.add(tag);
    }

    return {
      workflows: [...workflows.values()].sort((a, b) => b.count - a.count),
      stages: [...stages].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      tags: [...tags].sort(),
    };
  }

/**
   * Every visible run parked on a gate — the one pass {@link listPendingApprovals},
   * {@link countPendingApprovals} and {@link pendingApprovalFacets} share, so
   * they cannot disagree about what "pending" means.
   */
  private pendingApprovalRows(filter: IdScope): PendingApprovalRow[] {
    const rows: PendingApprovalRow[] = [];

    for (const exec of this.visibleExecutions(filter, { status: 'EXTERNAL_WAIT' })) {
      const gate = this.pausedGate(exec.id);
      if (!gate) continue;

      const workflow = this.workflows.get(exec.workflowId);
      const meta = workflowMeta(workflow);

      // The author's own label, which is what a reviewer recognises.
      let pausedStepName = gate.displayName;
      if (workflow?.config) {
        try {
          const stepConfig = findStepConfigById(
            JSON.parse(workflow.config),
            gate.displayName,
          );
          if (stepConfig?.title) pausedStepName = stepConfig.title;
        } catch {
          // An unparseable config costs the label, never the row.
        }
      }

      rows.push({
        id: exec.id,
        workflowId: exec.workflowId,
        ...(meta.name !== undefined ? { workflowName: meta.name } : {}),
        ...(exec.name !== undefined ? { runName: exec.name } : {}),
        ...(exec.nameAutoGenerated !== undefined
          ? { runNameAutoGenerated: exec.nameAutoGenerated }
          : {}),
        pausedStepName,
        pausedNodePath: gate.nodePath,
        createdAt: exec.createdAt,
        ...(gate.dueAt !== undefined ? { dueAt: gate.dueAt } : {}),
        ...(meta.tags !== undefined ? { tags: meta.tags } : {}),
      });
    }

    return rows;
  }

  async lastRunByWorkflow(
    filter: IdScope,
    params: { folderId?: string; workflowIds?: readonly string[] },
  ): Promise<Record<string, LastRun>> {
    const scope: { folderId?: string } = {};
    if (params.folderId !== undefined) scope.folderId = params.folderId;

    const wanted = params.workflowIds ? new Set(params.workflowIds) : null;
    const out: Record<string, LastRun> = {};

    // Newest-first, so the first row per workflow is its latest — the in-memory
    // stand-in for `DISTINCT ON`.
    for (const exec of this.visibleExecutions(filter, scope)) {
      if (wanted && !wanted.has(exec.workflowId)) continue;
      if (out[exec.workflowId]) continue;
      out[exec.workflowId] = { status: exec.status, createdAt: exec.createdAt };
    }

    return out;
  }

  // --- Execution state ---

  async getExecutionState(
    executionId: string,
  ): Promise<ExecutionStateRecord | null> {
    return this.executionStates.get(executionId) ?? null;
  }

  async persistState(
    executionId: string,
    data: {
      context: string;
      currentStepIndex?: number;
      pausePath?: string;
      pauseType?: import('./types.js').ExecutionPauseType;
    },
  ): Promise<void> {
    const existing = this.executionStates.get(executionId);
    const next: ExecutionStateRecord = {
      context: data.context,
      currentStepIndex: data.currentStepIndex ?? existing?.currentStepIndex ?? 0,
      pausePath: data.pausePath ?? null,
    };
    if (data.pauseType !== undefined) {
      next.pauseType = data.pauseType;
    }
    this.executionStates.set(executionId, next);
  }

  // --- Step tracking ---

  async upsertStep(
    executionId: string,
    stepName: string,
    data: {
      status: string;
      executorType: string;
      data?: string;
      /** Ignored — see createExecution. */
      attributes?: unknown;
      category?: GateCategory;
    },
  ): Promise<void> {
    const key = `${executionId}::${stepName}`;
    this.steps.set(key, {
      stepName,
      status: data.status,
      executorType: data.executorType,
      data: data.data ?? null,
      ...(data.category !== undefined ? { category: data.category } : {}),
    });
  }

  async getTopErrors(
    filter: IdScope,
    { since, limit = 5, folderId }: { since?: Date; limit?: number; folderId?: string },
  ): Promise<Array<{ message: string; count: number; runs: Array<{ id: string; workflowId: string }> }>> {
    const errorMap = new Map<string, { count: number; runs: Array<{ id: string; workflowId: string; ts: number }> }>();

    // Only errors from workflows the caller can see.
    const visible = applyIdScope(Array.from(this.workflows.values()), filter);
    const scoped = new Set(
      (folderId !== undefined ? visible.filter((w) => w.folderId === folderId) : visible).map((w) => w.id),
    );

    for (const exec of this.executions.values()) {
      if (exec.status !== 'FAILED') continue;
      if (!scoped.has(exec.workflowId)) continue;
      const execTs = exec.createdAt instanceof Date ? exec.createdAt.getTime() : new Date(exec.createdAt as string).getTime();
      if (since && execTs < since.getTime()) continue;

      let errorMsg: string | undefined;
      const prefix = `${exec.id}::`;
      for (const [key, step] of this.steps) {
        if (key.startsWith(prefix) && step.status === 'FAILED' && step.data) {
          try {
            errorMsg = (JSON.parse(step.data) as { error?: string }).error;
          } catch { /* ignore */ }
          break;
        }
      }

      const msg = errorMsg ?? 'Unknown error';
      const existing = errorMap.get(msg);
      if (existing) {
        existing.count++;
        existing.runs.push({ id: exec.id, workflowId: exec.workflowId, ts: execTs });
      } else {
        errorMap.set(msg, { count: 1, runs: [{ id: exec.id, workflowId: exec.workflowId, ts: execTs }] });
      }
    }

    return Array.from(errorMap.entries())
      .map(([message, { count, runs }]) => ({
        message,
        count,
        runs: runs
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 10)
          .map(({ id, workflowId }) => ({ id, workflowId })),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getAnalyticsSummary(
    filter: IdScope,
    { since, rangeDays, folderId }: { since: Date; rangeDays: number; folderId?: string },
  ): Promise<import('./types.js').AnalyticsSummaryResult> {
    // Deliberately not the paged `listWorkflows`: this is an aggregate over
    // everything in range, which a real adapter writes as `SELECT … GROUP BY`.
    let workflows = applyIdScope(Array.from(this.workflows.values()), filter);
    if (folderId !== undefined) {
      workflows = workflows.filter((w) => w.folderId === folderId);
    }
    const workflowIds = new Set(workflows.map((w) => w.id));

    const sinceTs = since.getTime();
    const executions = Array.from(this.executions.values()).filter((e) => {
      const ts = e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt as string).getTime();
      const inRange = ts >= sinceTs;
      return inRange && workflowIds.has(e.workflowId);
    });

    // byStatus
    const byStatus: Record<string, number> = {};
    for (const e of executions) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }

    const completed = byStatus['COMPLETED'] ?? 0;
    const failed = byStatus['FAILED'] ?? 0;
    const terminal = completed + failed;
    const successRate = terminal > 0 ? Math.round((completed / terminal) * 100) : 0;

    // runsByDay
    const now = Date.now();
    const dayBuckets = new Map<string, { COMPLETED: number; FAILED: number; RUNNING: number; CANCELLED: number }>();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now - i * 86_400_000);
      dayBuckets.set(d.toISOString().slice(0, 10), { COMPLETED: 0, FAILED: 0, RUNNING: 0, CANCELLED: 0 });
    }
    for (const e of executions) {
      const key = new Date(e.createdAt).toISOString().slice(0, 10);
      const bucket = dayBuckets.get(key);
      if (bucket && e.status in bucket) {
        bucket[e.status as keyof typeof bucket]++;
      }
    }
    const runsByDay = Array.from(dayBuckets.entries()).map(([date, counts]) => ({ date, ...counts }));

    // byWorkflow
    const nameMap = new Map(workflows.map((w) => {
      try { return [w.id, (JSON.parse(w.metadata ?? '{}') as { name?: string }).name ?? w.id]; }
      catch { return [w.id, w.id]; }
    }));
    const wfStats = new Map<string, { totalRuns: number; failed: number; lastRunAt: string | null }>();
    for (const e of executions) {
      const s = wfStats.get(e.workflowId) ?? { totalRuns: 0, failed: 0, lastRunAt: null };
      s.totalRuns++;
      if (e.status === 'FAILED') s.failed++;
      const iso = new Date(e.createdAt).toISOString();
      if (!s.lastRunAt || iso > s.lastRunAt) s.lastRunAt = iso;
      wfStats.set(e.workflowId, s);
    }
    const byWorkflow = workflows
      .map((wf) => {
        const s = wfStats.get(wf.id) ?? { totalRuns: 0, failed: 0, lastRunAt: null };
        return {
          workflowId: wf.id,
          name: nameMap.get(wf.id) ?? wf.id,
          status: wf.status,
          eventType: wf.eventType,
          totalRuns: s.totalRuns,
          failedRuns: s.failed,
          failureRate: s.totalRuns > 0 ? Math.round((s.failed / s.totalRuns) * 100) : 0,
          lastRunAt: s.lastRunAt,
        };
      })
      .sort((a, b) => b.totalRuns - a.totalRuns);

    // recentFailures
    const recentFailures = executions
      .filter((e) => e.status === 'FAILED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map((e) => ({
        executionId: e.id,
        workflowId: e.workflowId,
        workflowName: nameMap.get(e.workflowId) ?? e.workflowId,
        createdAt: new Date(e.createdAt).toISOString(),
      }));

    return {
      totalRuns: executions.length,
      successRate,
      byStatus,
      runsByDay,
      byWorkflow,
      recentFailures,
      activeWorkflows: workflows.filter((w) => w.status === 'ACTIVE').length,
      totalWorkflows: workflows.length,
    };
  }

  async getStepRows(executionId: string): Promise<StepRecord[]> {
    const prefix = `${executionId}::`;
    const result: StepRecord[] = [];
    for (const [key, value] of this.steps) {
      if (key.startsWith(prefix)) {
        result.push(value);
      }
    }
    return result;
  }

  async getStep(
    executionId: string,
    stepName: string,
  ): Promise<StepRecord | null> {
    return this.steps.get(`${executionId}::${stepName}`) ?? null;
  }

  // --- Failure handling ---

  async markFailed(
    executionId: string,
    _error: string,
  ): Promise<'marked' | 'skipped-terminal' | 'not-found'> {
    const exec = this.executions.get(executionId);
    if (!exec) return 'not-found';
    if (exec.status === 'COMPLETED' || exec.status === 'FAILED') {
      return 'skipped-terminal';
    }
    exec.status = 'FAILED';
    return 'marked';
  }

  // --- Static data ---

  async getStaticData(workflowId: string, key: string): Promise<unknown> {
    return this.staticData.get(`${workflowId}::${key}`);
  }

  async setStaticData(
    workflowId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    this.staticData.set(`${workflowId}::${key}`, value);
  }

  async deleteStaticData(workflowId: string, key: string): Promise<void> {
    this.staticData.delete(`${workflowId}::${key}`);
  }

  // --- Step events ---

  async appendStepEvent(
    executionId: string,
    stepName: string,
    event: { type: string; data: string },
    /** Ignored — see createExecution. */
    _attributes?: unknown,
  ): Promise<void> {
    const key = `${executionId}::${stepName}`;
    let events = this.stepEvents.get(key);
    if (!events) {
      events = [];
      this.stepEvents.set(key, events);
    }
    events.push({
      id: this.genId(),
      type: event.type,
      data: event.data,
      createdAt: new Date(),
    });
  }

  async getStepEvents(
    executionId: string,
    stepName: string,
    after?: Date,
  ): Promise<
    Array<{ id: string; type: string; data: string; createdAt: Date }>
  > {
    const key = `${executionId}::${stepName}`;
    const events = this.stepEvents.get(key) ?? [];
    if (after) {
      return events.filter((e) => e.createdAt > after);
    }
    return [...events];
  }

  /**
   * List all credentials as safe summaries (no values).
   *
   * Returns metadata fields only — `values` is never included. The
   * list is sorted by credential name, matching the spec requirement.
   * Includes both ACTIVE and REVOKED credentials.
   */
  async listCredentials(
    filter: IdScope,
    page: CursorPage,
  ): Promise<Paged<CredentialListItem>> {
    let credentials = Array.from(this.credentials.values())
      .map((c) => ({
        summary: {
          name: c.name,
          credType: c.credType,
          authType: c.authType,
          status: c.status,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
        ...(c.attributes !== undefined ? { attributes: c.attributes } : {}),
      }))
      .sort((a, b) => a.summary.name.localeCompare(b.summary.name));

    if (filter.kind === 'none') return { items: [] };
    if (filter.kind === 'ids') {
      const allowedNames = new Set(filter.ids);
      credentials = credentials.filter((credential) =>
        allowedNames.has(credential.summary.name),
      );
    }

    // Sorted by name above, which is also the cursor's sort key. Names are
    // unique here, so the name doubles as the tiebreaker: a credential created
    // mid-paging lands in its alphabetical place without shifting the rows
    // after the cursor.
    return cursorPage(credentials, page, (c) => byName(c.summary.name, c.summary.name));
  }

  async getCredentialByName(
    filter: IdScope,
    name: string,
  ): Promise<CredentialListItem | null> {
    if (filter.kind === 'none') return null;
    if (filter.kind === 'ids' && !new Set(filter.ids).has(name)) return null;

    const record = this.credentials.get(name);
    if (!record) return null;

    return {
      summary: {
        name: record.name,
        credType: record.credType,
        authType: record.authType,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
      ...(record.attributes !== undefined ? { attributes: record.attributes } : {}),
    };
  }

  /**
   * Create a new credential.
   *
   * - Validates `input.values` against the Zod schema for `input.authType`.
   * - Rejects duplicate names by throwing (the router translates this to 409).
   * - Sets createdAt/updatedAt to the current time.
   * - Status is always ACTIVE.
   */
  async createCredential(
    attributes: ResourceAttributes<'credential'>,
    input: CreateCredentialInput,
  ): Promise<CredentialSummary> {
    if (this.credentials.has(input.name)) {
      throw new Error(`Credential "${input.name}" already exists`);
    }

    const validatedValues = validateCredentialValues(input.authType, input.values);
    const now = Date.now();

    const record = {
      name: input.name,
      credType: input.credType,
      authType: input.authType,
      status: 'ACTIVE' as CredentialStatus,
      createdAt: now,
      updatedAt: now,
      values: validatedValues,
      attributes,
    };

    this.credentials.set(input.name, record);

    return {
      name: record.name,
      credType: record.credType,
      authType: record.authType,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Completely replace the stored values of an existing credential.
   *
   * - Does NOT decrypt/read old values — replacement is total.
   * - Validates new values against the STORED auth type (not the client's).
   * - Preserves createdAt.
   * - Returns null if credential not found or is revoked.
   */
  async replaceCredentialValues(
    _attributes: ResourceAttributes<'credential'>,
    name: string,
    values: AuthSpecificValues,
  ): Promise<CredentialSummary | null> {
    const existing = this.credentials.get(name);
    if (!existing) return null;

    if (existing.status === 'REVOKED') return null;

    const validatedValues = validateCredentialValues(existing.authType, values);
    existing.values = validatedValues;
    existing.updatedAt = Date.now();

    return {
      name: existing.name,
      credType: existing.credType,
      authType: existing.authType,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  /**
   * Revoke a credential — terminal transition ACTIVE → REVOKED.
   *
   * - Preserves createdAt.
   * - If already revoked, returns the existing summary WITHOUT changing
   *   the original revocation time (idempotent).
   * - Never deletes the row.
   * - Returns null if credential not found.
   */
  async revokeCredential(
    _attributes: ResourceAttributes<'credential'>,
    name: string,
  ): Promise<CredentialSummary | null> {

    const existing = this.credentials.get(name);
    if (!existing) return null;

    if (existing.status === 'REVOKED') {
      return {
        name: existing.name,
        credType: existing.credType,
        authType: existing.authType,
        status: existing.status,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    existing.status = 'REVOKED';
    existing.updatedAt = Date.now();

    return {
      name: existing.name,
      credType: existing.credType,
      authType: existing.authType,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  /**
   * Resolve a credential for execution-time use.
   *
   * This is the ONLY method that returns `values`. Returns null for
   * missing or revoked credentials — the executor uses this to fail
   * before making an external request.
   *
   * Values are re-validated against the stored auth type's Zod schema
   * (same as the Drizzle adapter does after decrypt). This guards
   * against corrupted or tampered in-memory data.
   */
  async resolveCredential(
    _workflowOrAttributes:
      | WorkflowContext['workflow']
      | ResourceAttributes<'workflow'>,
    name: string,
  ): Promise<ResolvedCredential | null> {
    const existing = this.credentials.get(name);
    if (!existing) return null;

    if (existing.status === 'REVOKED') return null;

    const credentialAuth = validateCredentialAuth(
      existing.authType,
      existing.values,
    );

    return {
      name: existing.name,
      credType: existing.credType,
      status: existing.status,
      ...credentialAuth,
    };
  }


  // --- Test helpers ---

  /**
   * Seed a workflow record for testing. `summary` and `folderId` default when
   * omitted so tests can seed minimal records without restating every column.
   */
  seedWorkflow(
    record: Omit<WorkflowRecord, 'summary' | 'folderId' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<WorkflowRecord, 'summary' | 'folderId' | 'createdAt' | 'updatedAt'>>,
  ): void {
    const now = new Date();
    this.workflows.set(record.id, {
      summary: null,
      folderId: 'folder_default',
      createdAt: now,
      updatedAt: now,
      ...record,
    });
  }

  /**
   * Seed a credential for testing.
   *
   * Accepts the new vault record shape: `authType` (not `type`), `values`
   * (not `data`), and optional status/timestamp fields. Defaults are provided
   * for the metadata fields so tests can seed minimal credentials without
   * restating every column.
   *
   * The `values` object is validated against the auth type's schema before
   * storage — same as `createCredential` does. This ensures seeded test
   * data is valid.
   */
  seedCredential(
    name: string,
    cred: {
      /** Defaults to the builtin type of the same shape, e.g. `BUILTIN_BEARER`. */
      credType?: string;
      authType: CredentialAuthType;
      values: AuthSpecificValues;
      status?: CredentialStatus;
      createdAt?: number;
      updatedAt?: number;
    },
  ): void {
    const validatedValues = validateCredentialValues(cred.authType, cred.values);

    const now = Date.now();
    this.credentials.set(name, {
      name,
      credType: cred.credType ?? `BUILTIN_${cred.authType.toUpperCase()}`,
      authType: cred.authType,
      status: cred.status ?? 'ACTIVE',
      createdAt: cred.createdAt ?? now,
      updatedAt: cred.updatedAt ?? now,
      values: validatedValues,
    });
  }

  /** Clear all data. */
  clear(): void {
    this.workflows.clear();
    this.folders.clear();
    this.executions.clear();
    this.executionStates.clear();
    this.steps.clear();
    this.staticData.clear();
    this.credentials.clear();
    this.stepEvents.clear();
  }
}
