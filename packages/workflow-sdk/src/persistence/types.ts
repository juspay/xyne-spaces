/**
 * Persistence interfaces for the workflow SDK.
 *
 * The runtime depends on these abstractions — hosts provide concrete
 * implementations (Prisma, MongoDB, in-memory for testing, etc.).
 */

import type { Action } from '../authz/types.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { WorkflowContext } from '../types/context.js';
import type { TriggerEvent } from '../ingest/types.js';
import type { GateCategory } from '../types/known-types.js';

import type {
  CredentialSummary,
  CredentialListItem,
  ResolvedCredential,
  CreateCredentialInput,
  AuthSpecificValues,
} from '../common/credentials.js';

// ─── Record Shapes ───

/** What the engine stores about a workflow definition. */
export interface WorkflowRecord {
  id: string;
  status: string;
  /** JSON string — the full WorkflowConfig (trigger + steps + settings). */
  config: string | null;
  /** JSON string — host-defined metadata (description, name, etc.). */
  metadata: string | null;
  /** Maps to trigger type for event routing. */
  eventType: string;
  /** Human-facing workflow summary/readme. First-class column (listable). */
  summary: string | null;
  /**
   * Folder this workflow belongs to. Every workflow belongs to exactly one
   * folder — there is no "ungrouped" state. Set at create, changed by "move".
   */
  folderId: string;
  /** When the workflow was first created. */
  createdAt: Date;
  /**
   * Last change to the definition or its status. What "waiting since" means in
   * a review queue: a workflow enters PENDING_APPROVAL by a status write, so
   * this is when it was submitted.
   */
  updatedAt: Date;
  /**
   * The actions the requesting caller may perform on this workflow, from the
   * authorizer — the UI gates buttons on it. Populated by the runtime on both
   * single-fetch (`getWorkflow`) and list rows (batched), so inline row actions
   * gate without an extra fetch. Absent only on system-path reads.
   */
  permittedActions?: readonly Action[];
  /**
   * Product-defined scoping attributes set at creation (e.g. a team). Typed via
   * {@link Register}; carried and stored opaquely by the framework and read,
   * typed, by the host authorizer and UI. Distinct from `metadata` (SDK-internal).
   */
  attributes?: ResourceAttributes<'workflow'>;
}

/**
 * A folder for organizing workflows. Supports nesting via parentId.
 * Membership is keyed by {@link WorkflowRecord.folderId}.
 */
export interface FolderRecord {
  id: string;
  name: string;
  /** JSON string — host-defined metadata (SDK-internal). */
  metadata: string | null;
  /** Parent folder ID for nested folders. Null means top-level. */
  parentId?: string | null;
  /**
   * Product-defined scoping attributes set at creation (e.g. a department).
   * Typed via {@link Register}; carried/stored opaquely and read, typed, by the
   * host authorizer and UI.
   */
  attributes?: ResourceAttributes<'folder'>;
  /**
   * Actions the requesting caller may perform on this folder — including the
   * CONTAINER actions (`workflow:create` / `folder:create`) that tell the UI
   * whether to offer "New workflow"/"New folder" *inside* this folder.
   * Populated on single-fetch (`getFolder`) and on list rows (batched).
   */
  permittedActions?: readonly Action[];
}

/**
 * A credential. Addressed by a stable `id` for management; resolved at execution
 * time by `(tenant, name)` — see {@link PersistenceAdapter.resolveCredential}.
 * The secret itself is never part of this record.
 */
export interface CredentialRecord {
  id: string;
  name: string;
  type: string;
  attributes?: ResourceAttributes<'credential'>;
  permittedActions?: readonly Action[];
}


export interface AnalyticsSummaryResult {
  totalRuns: number;
  successRate: number;
  byStatus: Record<string, number>;
  runsByDay: Array<{ date: string; COMPLETED: number; FAILED: number; RUNNING: number; CANCELLED: number }>;
  byWorkflow: Array<{
    workflowId: string;
    name: string;
    status: string;
    eventType: string;
    totalRuns: number;
    failedRuns: number;
    failureRate: number;
    lastRunAt: string | null;
  }>;
  recentFailures: Array<{ executionId: string; workflowId: string; workflowName: string; createdAt: string }>;
  activeWorkflows: number;
  totalWorkflows: number;
}

/** What the engine stores per execution run. */
/**
 * Where a run came from, kept beside the run rather than inside its context.
 *
 * `context` is what the workflow READS — trigger data, step outputs, variables.
 * Provenance is what an operator reads: which event started this, when it
 * happened, and why a scheduled run fires when it does. Mixing the two means a
 * multi-megabyte blob has to be rewritten to record a fact nobody can query.
 */
export interface ExecutionOrigin {
  /**
   * The event as it arrived. A delayed run is admitted from this when it fires,
   * so it is the durable input — never the enriched payload, which is read afresh
   * at that moment and only then written into `context.trigger`.
   */
  readonly event: TriggerEvent;
  /** What decided the fire time, for a run that waited. */
  readonly anchor?: { readonly source: string; readonly value: string };
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  /** The run's identifier — unique within the workflow. See {@link WorkflowRunNaming}. */
  name?: string;
  /**
   * True when nobody named this run and `name` was generated from its start
   * time. UIs hide such placeholders; telling them apart by the string's shape
   * would misfire on a run a person called "Run-42".
   */
  nameAutoGenerated?: boolean;
  status: string;
  createdAt: Date;
  /** Last state change — ≈ completion time for terminal runs; powers run duration. */
  updatedAt?: Date;
  /** Set when this execution was created via `rerunFromStep()` — links to the source. */
  sourceExecutionId?: string;
  /** When a SCHEDULED run becomes eligible. Absent for runs that start at once. */
  fireAt?: Date;
  /** Where this run came from. See {@link ExecutionOrigin}. */
  origin?: ExecutionOrigin;
  /**
   * Why a run ended without doing its work — the filter said no, the subject was
   * gone, the workflow was switched off before it fired. A column rather than a
   * note inside the context, because "show me everything the filter skipped" is a
   * question worth being able to ask.
   */
  endReason?: string;
  /** Parent workflow's display name (from its metadata), resolved server-side via the
   *  executions↔workflows join. Absent when the host doesn't populate it; UIs fall back
   *  to workflowId. */
  workflowName?: string;
}

/**
 * Why the execution is paused.
 * - `step`: a step called `ctx.pause()` mid-execution (tool approval, input required, etc.)
 * - `review`: the step completed successfully but `onComplete: 'review'` gated advancement
 *
 * Determines the resume path: `step` resumes via `onResume`, `review` either advances
 * (approve) or re-executes the step (retry with feedback).
 */
export type ExecutionPauseType = 'step' | 'review';

/** Execution state — separate from execution for size (context can be multi-MB). */
export interface ExecutionStateRecord {
  /** JSON string — full WorkflowContext snapshot. */
  context: string | null;
  currentStepIndex: number;
  /** JSON string — PausePath for nested pause/resume. */
  pausePath: string | null;
  /** Why the execution is paused. Absent for non-paused executions. */
  pauseType?: ExecutionPauseType;
}

/** Per-step tracking within an execution. */
export interface StepRecord {
  stepName: string;
  status: string;
  executorType: string;
  /** JSON string — { type, input?, output, error?, statePatch? }. */
  data: string | null;
  /** Who a parked record waits on. Absent on records that are not gates. */
  category?: GateCategory;
}

// ─── Pagination ───

/**
 * A page of a list. The ONLY paging shape in this port — there is no offset
 * variant, deliberately, and new lists must not add one.
 *
 * `limit` is REQUIRED, and that is the point: an optional bound is one a caller
 * forgets, and a forgotten bound is indistinguishable from a deliberate full
 * scan right up until the table is large. The runtime supplies a default and a
 * cap (see `runtime/paging.ts`) so no caller has to invent one — but nobody can
 * express "unbounded" through this port at all.
 *
 * ## The cursor
 *
 * `cursor` is an OPAQUE token, produced by the adapter as `nextCursor` and
 * handed back unread. Callers must not parse, construct or compare one; the UI
 * passes it through and the router forwards it as a string.
 *
 * It encodes the SORT POSITION of the last row of the previous page — its sort
 * key plus its id as a tiebreaker — not the row's id. That distinction is the
 * whole contract:
 *
 * - **It must match the ORDER BY.** A list ordered by `created_at DESC, id`
 *   seeks with `WHERE (created_at, id) < (:ts, :id)`. Seeking on the id alone
 *   while ordering by a date returns nonsense, and an adapter told the cursor
 *   "is the id" would write exactly that.
 * - **It must survive the row's departure.** The seek is positional — "rows
 *   sorting after this point" — not "rows after the row with this id". Rows
 *   leave these lists by design: an approval gets approved, a run gets resumed.
 *   An adapter that looks the cursor row up by id and pages from its index
 *   returns an empty page the moment someone resolves the row the cursor names,
 *   stranding every row behind it until a full refresh.
 *
 * Both fall out of a tuple comparison, which is also what keeps the read an
 * indexed seek at any depth. Build the cursor from the same columns the ORDER BY
 * names, in the same order.
 *
 * A UI that wants a total asks a `count*` method for one. It does not read a
 * page to measure it.
 */
export interface CursorPage {
  limit: number;
  cursor?: string;
}

/**
 * One page of results plus the cursor that reads the next one.
 *
 * `nextCursor` absent means this was the last page. An adapter must not return
 * a cursor for an empty tail — a UI reading "there is more" from its presence
 * would offer a Load-more that fetches nothing, forever.
 */
export interface Paged<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * One row of the approvals inbox, already joined. Everything the queue renders
 * is projected here so the inbox costs one statement.
 */
export interface PendingApprovalRow {
  /** Execution id. */
  id: string;
  workflowId: string;
  /** From the workflow's metadata `name`; absent if it was never named. */
  workflowName?: string;
  /** The identifier of the run this gate paused — which loan, which ticket. */
  runName?: string;
  /** As {@link ExecutionRecord.nameAutoGenerated}: hide the name when true. */
  runNameAutoGenerated?: boolean;
  /** The paused step's config `title`, else its leaf id. */
  pausedStepName: string;
  /**
   * Full node-path of the paused record (`parallel_x:swot#0/approve`) — what a
   * resume addresses. The display name above is lossy and cannot serve.
   */
  pausedNodePath: string;
  createdAt: Date;
  /**
   * When this gate falls due, from the pause state the WAIT step wrote. Absent
   * whenever the approval step declared no `dueInMs` — most gates have none.
   */
  dueAt?: Date;
  /** Workflow tags (from its metadata) — the inbox's tag filter reads these. */
  tags?: string[];
}

/** Facet counts for the approvals inbox filters, computed in the query. */
export interface PendingApprovalFacets {
  workflows: Array<{ workflowId: string; name: string; count: number }>;
  stages: Array<{ name: string; count: number }>;
  tags: string[];
}

/**
 * How an approvals page is ordered. `'due'` is soonest-deadline-first, which
 * puts the most overdue gate at the top of an overdue page; it only orders
 * rows that HAVE a deadline, so pair it with a {@link PendingApprovalBucket}.
 */
export type PendingApprovalSort = 'newest' | 'oldest' | 'due';

/**
 * A slice of the queue, by deadline.
 *
 * Grouping cannot be done in the browser: a page holds a handful of rows, so
 * counting "how many are overdue" over it describes the page, not the queue.
 * Worse, a gate due today was raised recently with a short deadline, which
 * sorts it to the END of an oldest-first queue — exactly where a first page
 * never reaches. So the store answers this, not the caller.
 */
export type PendingApprovalBucket = 'overdue' | 'dueToday' | 'dueSoon';

/** Approvals decided in a window, split by whether they beat their deadline. */
export interface ApprovalAnalyticsResult {
  /** Decided before the deadline, or had no deadline. */
  onTime: number;
  /** Decided after the deadline. */
  late: number;
}

/** Filters the approvals inbox applies IN THE QUERY, never in the browser. */
export interface PendingApprovalQuery extends CursorPage {
  /** Restrict to these workflows. Empty/absent means all visible ones. */
  workflowIds?: readonly string[];
  /** Restrict to gates whose display name matches. */
  stages?: readonly string[];
  /** ANY-match over workflow tags. */
  tags?: readonly string[];
  /** Free-text over execution id, workflow name and gate name. */
  search?: string;
  /** Defaults to `'newest'`. */
  sort?: PendingApprovalSort;
  /** Restrict to one deadline bucket. Absent means the whole queue. */
  bucket?: PendingApprovalBucket;
  /**
   * End of the caller's day, epoch ms — the upper edge of `'dueToday'`.
   *
   * It comes from the caller because "today" is the reader's day, and the
   * store has no idea what timezone they are in. Absent, the store falls back
   * to its own midnight, which is right only when the two agree.
   */
  dayEnd?: number;
}

/**
 * Narrows {@link PersistenceAdapter.countPendingApprovals} to one bucket, so a
 * section can show how many gates it really covers rather than how many it has
 * downloaded. Deliberately not the full query: a count is not a page, and it
 * ignores the inbox's own filters by design — the badge counts the queue.
 */
export interface PendingApprovalCountQuery {
  bucket?: PendingApprovalBucket;
  /** As {@link PendingApprovalQuery.dayEnd}. */
  dayEnd?: number;
}

/** The most recent run of one workflow — what a "Last run" column shows. */
export interface LastRun {
  status: string;
  createdAt: Date;
}

// ─── Persistence Adapter ───

/**
 * The data port. `TFilter` is the host's own list predicate, produced by
 * `WorkflowAuthorizer.visibleFilter` and handed here verbatim — the SDK never
 * looks inside it. **Push it into your query**: the whole point is that listing
 * is one indexed, paginated statement (`… WHERE tenant = ? AND (mine OR public)
 * LIMIT ? OFFSET ?`), not "materialise every visible id, then re-query by id".
 *
 * Every list method here takes a REQUIRED bound ({@link CursorPage} /
 * {@link OffsetPage}) and every aggregate has its own `count*` / `*Facets`
 * method. Both are deliberate: a list that can be called unbounded eventually
 * is, and a count answered by listing rows and reading `.length` is a full scan
 * wearing a small return type.
 *
 * The adapter holds NO authorization logic of its own — it applies the filter
 * the authorizer produced. Use `IdScope` as `TFilter` for a zero-config start.
 */
export interface PersistenceAdapter<TFilter> {
  // --- Workflow definitions ---

  getWorkflow(id: string): Promise<WorkflowRecord | null>;

  /**
   * List workflows matching the caller's `filter`, paginated in the query.
   * Totals come from {@link countWorkflowsByFolder}, not from counting rows.
   */
  listWorkflows(
    filter: TFilter,
    page: CursorPage & { folderId?: string },
  ): Promise<Paged<WorkflowRecord>>;

  /**
   * Workflows awaiting review, newest first, cursor-paged.
   *
   * Its own method rather than a status filter on {@link listWorkflows}: that
   * one pages by offset for a numbered-page UI, and mixing two paging modes on
   * one call is how you get a page that quietly skips rows. `cursor` is the id
   * of the last row of the previous page, the same contract
   * {@link listExecutions} uses.
   */
  listPendingWorkflows(
    filter: TFilter,
    params: CursorPage,
  ): Promise<Paged<WorkflowRecord>>;

  /**
   * Workflow counts within the caller's `filter`: grand total plus a per-folder
   * breakdown, so the UI shows folder counts without fetching every workflow.
   */
  countWorkflowsByFolder(
    filter: TFilter,
  ): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }>;
  /**
   * Find active workflows matching a dispatched event. This is SYSTEM event
   * routing, not user authorization — `eventScope` is the event's own origin
   * scope (from `DispatchEventInput.metadata`), used to route the event to the
   * right workflows.
   */
  findActiveWorkflows(
    eventType: string,
    eventScope: Record<string, unknown>,
  ): Promise<WorkflowRecord[]>;

  /** Create a new workflow definition. Returns the assigned workflow ID. */
  createWorkflow(data: {
    id?: string;
    status: string;
    config: string;
    metadata: string;
    eventType: string;
    summary?: string | null;
    /** Folder membership — required (every workflow belongs to one folder). */
    folderId: string;
    /** Opaque product attributes to persist; returned on the record as-is. */
    attributes?: ResourceAttributes<'workflow'>;
  }): Promise<string>;

  /** Update an existing workflow definition. */
  updateWorkflow(
    id: string,
    data: {
      status?: string;
      config?: string;
      metadata?: string;
      eventType?: string;
      summary?: string | null;
      /** Move the workflow to another folder. */
      folderId?: string;
    },
  ): Promise<void>;

  // --- Folders (organize workflows; flat, scope-aware) ---

  /** Fetch a single folder by id (for read/mutate guards + UI gating). */
  getFolder(id: string): Promise<FolderRecord | null>;

  /** List folders matching the caller's `filter`, paginated in the query. */
  listFolders(filter: TFilter, page: CursorPage): Promise<Paged<FolderRecord>>;

  /**
   * Every folder in the deployment, unfiltered. This is a SYSTEM integrity
   * read, not a caller read — the reparent cycle check must see folders the
   * caller cannot, or a hidden descendant lets the cycle through. Never
   * return these rows to a caller.
   */
  listAllFolders(): Promise<FolderRecord[]>;

  /**
   * Count of workflows in a folder, unfiltered. SYSTEM integrity read: folder
   * deletion is blocked while the folder holds *any* workflow, including ones
   * the caller cannot see. Counting only visible rows would let a caller
   * delete a folder out from under someone else's workflows.
   */
  countWorkflowsInFolder(folderId: string): Promise<number>;

  /** Create a folder. Returns the assigned folder ID. */
  createFolder(data: {
    id?: string;
    name: string;
    metadata: string;
    /** Parent folder ID for nesting. Null or omitted means top-level. */
    parentId?: string | null;
    /** Opaque product attributes to persist; returned on the record as-is. */
    attributes?: ResourceAttributes<'folder'>;
  }): Promise<string>;

  /** Update a folder (rename or reparent). */
  updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<void>;

  /** Delete a folder. Callers must ensure it holds no workflows. */
  deleteFolder(id: string): Promise<void>;

  // --- Execution lifecycle ---

  createExecution(data: {
    workflowId: string;
    /** The run's identifier. Absent: generate `Run-<UTC start time>`. */
    name?: string;
    /**
     * What a name already taken in this workflow does: `suffix` retries as
     * `name#1`, `name#2`…; `reject` fails so a person can choose another.
     * Enforce it atomically (a unique index), not with a read-then-insert.
     */
    nameConflict?: 'suffix' | 'reject';
    status: string;
    /** Initial WorkflowContext as JSON. */
    context: string;
    /** Source execution this run was derived from (rerun). */
    sourceExecutionId?: string;
    /**
     * When a SCHEDULED run becomes eligible.
     *
     * The queue's delay is the fast path; this column is the truth. A host that
     * stores and indexes it can sweep for runs whose delayed job was lost and
     * re-enqueue them, so a dropped job makes a run late rather than losing it.
     */
    fireAt?: Date;
    /**
     * Where the run came from. Required for a SCHEDULED run — it is admitted from
     * this when it fires — and useful provenance on any other.
     */
    origin?: ExecutionOrigin;
    /**
     * The tenant this run acts as — the owning workflow's attributes.
     *
     * Required, like the other write paths below. A host whose execution tables carry
     * a tenant key has no other way to fill it: there is no caller at execution time
     * (a cron tick or webhook has no user), and deriving it from ambient state means
     * a second scoping mechanism the framework knows nothing about.
     */
    attributes: ResourceAttributes<'workflow'>;
  }): Promise<string>; // returns executionId

  updateExecutionStatus(
    executionId: string,
    status: string,
    /**
     * Why, in words, when a run ends without doing its work. Surfaced as
     * {@link ExecutionRecord.endReason}; a host that does not store it loses only
     * the explanation, never the outcome.
     */
    reason?: string,
  ): Promise<void>;

  getExecution(
    executionId: string,
  ): Promise<ExecutionRecord | null>;

  /**
   * List executions visible to the caller. An execution is visible iff its
   * workflow is, so `filter` is the **workflow** filter — join it through
   * `workflowId` rather than authorizing executions separately.
   */
  listExecutions(
    filter: TFilter,
    params: CursorPage & {
      workflowId?: string;
      status?: string;
      folderId?: string;
    },
  ): Promise<Paged<ExecutionRecord>>;

  /**
   * One page of the approvals inbox — every run paused on an APPROVER gate the
   * caller can see, joined to its workflow and its paused step.
   *
   * Approver gates alone: it asks for `waiting_on_approver` and nothing else.
   * A build callback, a clock, and a customer waiting mid-conversation are all
   * somebody's — or nobody's — but not an approver's. A gate recorded before
   * gates carried a category has none and still counts, because a missed
   * approval is worse than a stale row. Neither is a caller's choice, so
   * neither is a parameter.
   *
   * Implement as ONE query joining executions → steps (the paused, non-control
   * leaf) → workflows, projecting {@link PendingApprovalRow}; do NOT loop. Every
   * filter in {@link PendingApprovalQuery} is applied here, in the query.
   */
  listPendingApprovals(
    filter: TFilter,
    params: PendingApprovalQuery,
  ): Promise<Paged<PendingApprovalRow>>;

  /**
   * How many runs are waiting on a gate the caller can see — the sidebar badge.
   * Its own statement: the badge needs a number, not a page of rows.
   */
  countPendingApprovals(
    filter: TFilter,
    params?: PendingApprovalCountQuery,
  ): Promise<number>;

  /**
   * Facet counts for the approvals inbox filters. Separate from
   * {@link listPendingApprovals} because they describe the WHOLE visible set
   * while the list shows one page of it.
   */
  pendingApprovalFacets(filter: TFilter): Promise<PendingApprovalFacets>;

  /**
   * The most recent run of each named workflow — the "Last run" column. One
   * grouped query (`DISTINCT ON (workflow_id) … ORDER BY created_at DESC`).
   * Workflows with no runs are absent from the result.
   */
  lastRunByWorkflow(
    filter: TFilter,
    params: { folderId?: string; workflowIds?: readonly string[] },
  ): Promise<Record<string, LastRun>>;

  getTopErrors?(
    filter: TFilter,
    params: { since?: Date; limit?: number; folderId?: string },
  ): Promise<Array<{ message: string; count: number; runs: Array<{ id: string; workflowId: string }> }>>;

  /** Analytics over the caller's visible workflows — same filter, joined. */
  getAnalyticsSummary?(
    filter: TFilter,
    params: { since: Date; rangeDays: number; folderId?: string },
  ): Promise<AnalyticsSummaryResult>;

  /** On-time vs late for approvals decided since `since`, over visible workflows. */
  getApprovalAnalytics?(
    filter: TFilter,
    params: { since: Date },
  ): Promise<ApprovalAnalyticsResult>;

  // --- Execution state (separate for large payloads) ---

  getExecutionState(
    executionId: string,
  ): Promise<ExecutionStateRecord | null>;

  persistState(
    executionId: string,
    data: {
      context: string;
      currentStepIndex?: number;
      pausePath?: string;
      pauseType?: ExecutionPauseType;
      /** The tenant this run acts as. See {@link PersistenceAdapter.createExecution}. */
      attributes: ResourceAttributes<'workflow'>;
    },
  ): Promise<void>;

  // --- Step tracking ---

  upsertStep(
    executionId: string,
    stepName: string,
    data: {
      status: string;
      executorType: string;
      data?: string;
      /** The tenant this run acts as. See {@link PersistenceAdapter.createExecution}. */
      attributes: ResourceAttributes<'workflow'>;
      /**
       * Who this gate waits on, when the record is a gate. Store it in a
       * queryable column, not inside `data`: the approvals inbox filters on it.
       */
      category?: GateCategory;
    },
  ): Promise<void>;

  getStepRows(executionId: string): Promise<StepRecord[]>;

  getStep(
    executionId: string,
    stepName: string,
  ): Promise<StepRecord | null>;

  // --- Failure handling (atomic) ---

  markFailed(
    executionId: string,
    error: string,
  ): Promise<'marked' | 'skipped-terminal' | 'not-found'>;

  // --- Static data (persistent KV per workflow) ---

  getStaticData(workflowId: string, key: string): Promise<unknown>;
  setStaticData(
    workflowId: string,
    key: string,
    value: unknown,
  ): Promise<void>;
  deleteStaticData(workflowId: string, key: string): Promise<void>;

  // --- Step events (progress streaming) ---

  appendStepEvent(
    executionId: string,
    stepName: string,
    event: { type: string; data: string },
    /** The tenant this run acts as. See {@link PersistenceAdapter.createExecution}. */
    attributes: ResourceAttributes<'workflow'>,
  ): Promise<void>;

  getStepEvents(
    executionId: string,
    stepName: string,
    after?: Date,
  ): Promise<
    Array<{ id: string; type: string; data: string; createdAt: Date }>
  >;

  // --- Credentials ---

  /**
   * List all credentials in the workspace, returning safe summaries only.
   *
   * - Ordered by credential name.
   * - Includes both `ACTIVE` and `REVOKED` credentials.
   * - NEVER selects, decrypts, or returns stored values.
   *
   * @param filter - Host-defined visibility filter for the authenticated caller.
   * @param page   - Required database-level pagination. See {@link CursorPage}.
   * @returns One page of safe credential summaries (no `values` field).
   */
  listCredentials(
    filter: TFilter,
    page: CursorPage,
  ): Promise<Paged<CredentialListItem>>;

  /**
   * One credential by name, or null — an indexed lookup used by the management
   * routes (replace values, revoke, test) instead of scanning a list.
   *
   * Returns a safe summary; values are never selected here. Use
   * {@link PersistenceAdapter.resolveCredential} on the execution path.
   */
  getCredentialByName(
    filter: TFilter,
    name: string,
  ): Promise<CredentialListItem | null>;

  /**
   * Create a new credential.
   *
   * - Insert only — never upsert. Duplicate names must be rejected by
   *   the implementation (the caller may translate this to a `409`).
   * - Sets both `createdAt` and `updatedAt` to the current time.
   * - Status is always `ACTIVE` on creation.
   *
   * @param attributes - Host-defined credential scope and actor attributes.
   * @param input     - Validated create input: `name`, `authType`, `values`.
   * @returns The safe summary of the newly created credential.
   */
  createCredential(
    attributes: ResourceAttributes<'credential'>,
    input: CreateCredentialInput,
  ): Promise<CredentialSummary>;

  /**
   * Completely replace the stored values of an existing credential.
   *
   * - Does NOT decrypt old values — the new values replace the encrypted
   *   blob entirely.
   * - Validates the new complete value object using the STORED auth type
   *   (the client cannot change the auth type).
   * - Preserves `createdAt` and sets `updatedAt` to the current time.
   * - Must reject if the credential is `REVOKED` (return `null` or throw,
   *   depending on implementation convention).
   *
   * @param attributes - Host-defined credential scope and actor attributes.
   * @param name      - The credential name (from the URL path).
   * @param values    - The complete replacement value set (validated
   *                    against the stored auth type's schema).
   * @returns The safe summary of the updated credential, or `null` if
   *          the credential was not found or is revoked.
   */
  replaceCredentialValues(
    attributes: ResourceAttributes<'credential'>,
    name: string,
    values: AuthSpecificValues,
  ): Promise<CredentialSummary | null>;

  /**
   * Revoke a credential — terminal transition from ACTIVE to REVOKED.
   *
   * - Preserve `createdAt`.
   * - Sets `status` to `REVOKED`.
   * - Sets `updatedAt` to the current time.
   * - Never deletes the row — the credential remains visible.
   * - If the credential is already revoked, return the existing summary
   *   WITHOUT changing the original revocation identity/time (idempotent).
   *
   * @param attributes - Host-defined credential scope and actor attributes.
   * @param name      - The credential name (from the URL path).
   * @returns The safe summary of the revoked credential, or `null` if
   *          the credential was not found.
   */
  revokeCredential(
    attributes: ResourceAttributes<'credential'>,
    name: string,
  ): Promise<CredentialSummary | null>;

  /**
   * Resolve a credential for execution-time use.
   *
   * This is the ONLY method that decrypts and returns stored values.
   *
   * - During execution, scope by the running workflow and credential name.
   * - A raw workflow-attribute scope is also accepted for server-side
   *   credential testing, where no workflow is running.
   * - Return `null` for missing credentials.
   * - Return `null` for revoked credentials — the executor uses this
   *   to fail before making an external request.
   * - Decrypt values, validate the decrypted JSON against the stored
   *   auth type's schema, and return the in-memory `ResolvedCredential`.
   *
   * @param workflowOrAttributes - The running workflow, or host-defined scope
   *                               attributes for a non-execution test request.
   * @param name                 - The selected credential name.
   * @returns The decrypted, validated credential, or `null` if the
   *          credential is missing or revoked.
   */
  resolveCredential(
    workflowOrAttributes:
      | WorkflowContext['workflow']
      | ResourceAttributes<'workflow'>,
    name: string,
  ): Promise<ResolvedCredential | null>;

}

// ─── Queue Adapter ───

export interface QueueAdapter {
  /**
   * Ask for a pass over this execution.
   *
   * **With no `delay`, the pass is due now, and that supersedes a delayed pass
   * already pending for the same execution.** Both are the same job — a host
   * keeps one writer per execution by collapsing on `singletonKey` — so a
   * pending timer would otherwise swallow this call and a delivered answer
   * would wait for the deadline instead of being applied. A host that collapses
   * duplicates must therefore promote the pending job rather than drop the
   * request.
   */
  enqueue(data: {
    executionId: string;
    /** When the pass is wanted. A gate's own clock: see `wakeAt` on its record. */
    delay?: number;
    /**
     * Optional per-execution dedup/serialization key. The runtime passes
     * `executionId` so a host backed by pg-boss (or similar) can set a
     * singleton key — ensuring at most one pass mutates a given execution at a
     * time (single-writer). Hosts without singleton support may ignore it.
     */
    singletonKey?: string;
    /**
     * The `metadata.kind` of the workflow this pass belongs to, when it has one
     * — `conversational_flow` for anything built in the screens editor.
     *
     * A pass with somebody waiting on it and a pass that may run for ten minutes
     * want opposite settings: how many run at once, how long a lost one is
     * waited for, how long a deploy lets them finish. A host that cares routes
     * on this; one that does not may ignore it, as it may ignore `singletonKey`.
     *
     * **A host that routes on it must send every pass of one execution to the
     * same place.** Per-execution single-writer is whatever the host builds on
     * `singletonKey`, and two destinations are usually two keyspaces — so a run
     * that changed lanes mid-life could be walked twice at once. The runtime
     * therefore reads this from the workflow record on every enqueue rather than
     * from anything per-pass.
     */
    kind?: string;
  }): Promise<void>;
}

// ─── Scheduler Adapter (for cron triggers) ───

export interface SchedulerAdapter {
  schedule(
    workflowId: string,
    cronExpression: string,
    timezone?: string,
  ): Promise<void>;
  unschedule(workflowId: string): Promise<void>;
}
