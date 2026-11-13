/**
 * API contract types for the workflow client.
 *
 * These represent the request/response shapes for every router endpoint.
 * Both the typed HTTP client and the UI hooks depend on these types.
 * Persistence-level types (WorkflowRecord, ExecutionRecord, StepRecord)
 * are re-exported from persistence/types.ts — single source of truth.
 */

import type { WorkflowConfig, WorkflowSettings } from '../types/workflow-config.js';
import type { StepSummary, StepDescriptor } from '../steps/step-descriptor.js';
import type { TriggerSummary, TriggerDescriptor } from '../triggers/trigger-descriptor.js';
import type { OperatorDescriptor } from '../types/operators.js';
import type { FieldOptionsPage } from '../schema/options.js';
import type { AvailableContext } from '../engine/available-context.js';
import type {
  WorkflowRecord,
  FolderRecord,
  ExecutionRecord,
  StepRecord,
  AnalyticsSummaryResult,
  ApprovalAnalyticsResult,
  PendingApprovalBucket,
  PendingApprovalSort,
} from '../persistence/types.js';
import type { ResumePayload } from '../common/resume-payload.js';
import type { Attachment } from '../common/attachment.js';
import type { ConversationStreamEvent, Turn, TurnAnswer } from '../conversational-flow/turn.js';
import type { Action } from '../authz/types.js';
export type { ActivationOutcome, PendingWorkflowSummary } from '../runtime/types.js';
import type { ActivationOutcome, PendingWorkflowSummary } from '../runtime/types.js';
import type { ResourceAttributes } from '../authz/attributes.js';

import type {
  CredentialSummary,
  CreateCredentialRequest,
  ConnectorCredentialTypes,
  ReplaceCredentialValuesInput,
  CredentialListResponse,
} from '../common/credentials.js';

// ─── Re-export persistence types the client needs ───

export type {
  WorkflowRecord,
  FolderRecord,
  ExecutionRecord,
  StepRecord,
  AnalyticsSummaryResult,
  ApprovalAnalyticsResult,
};

import type { ValidationResult } from '../types/validation.js';
import type { EventsClient } from './events-client.js';

// ─── Client Configuration ───

export interface WorkflowClientConfig {
  /** Base URL for the workflow router (e.g. "/api/workflows"). */
  baseUrl: string;
  /** Called per-request to get auth headers. Supports async for token rotation. */
  getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  /** Optional custom fetch — for interceptors, logging, test mocking, etc. */
  fetch?: typeof globalThis.fetch;
  /**
   * Identifies this client on the writes it makes. Sent as `X-Workflow-Origin`
   * and echoed back on the change event the write causes, so the client can tell
   * its own work from somebody else's — an editor that cannot make that
   * distinction reports the user's own save as a concurrent edit.
   *
   * Generated per client instance when omitted, which is the right default:
   * two browser tabs are two writers and should not share one.
   */
  origin?: string;
}

// ─── Workflow CRUD Inputs ───

export interface CreateWorkflowInput {
  name: string;
  config: WorkflowConfig;
  metadata?: Record<string, unknown>;
  /** Workflow summary/readme (stored as a first-class column). */
  summary?: string | null;
  /** Folder this workflow belongs to — required (no ungrouped state). */
  folderId: string;
  /** Product-defined scoping attributes (typed via {@link Register}). */
  attributes?: ResourceAttributes<'workflow'>;
}

export interface UpdateWorkflowInput {
  name?: string;
  config?: WorkflowConfig;
  settings?: WorkflowSettings;
  metadata?: Record<string, unknown>;
  /** Workflow summary/readme (stored as a first-class column). */
  summary?: string | null;
  /** Move the workflow to another folder. */
  folderId?: string;
}

// ─── Folder Inputs ───

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
  /** Product-defined scoping attributes (typed via {@link Register}). */
  attributes?: ResourceAttributes<'folder'>;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

// ─── Execution Detail (enriched execution with steps) ───

export interface ExecutionDetail extends ExecutionRecord {
  steps: StepRecord[];
  /** The workflow config snapshot at execution time. */
  config?: WorkflowConfig;
  /** Trigger payload that started this execution. */
  triggerData?: Record<string, unknown>;
  /** Workflow summary/readme (from the workflow record). */
  summary?: string | null;
  /** Workflow display name (from the workflow record metadata). */
  name?: string;
  /**
   * Actions the requesting caller may perform on this execution (from the
   * authorizer). The UI reads it to gate Cancel / Rerun / Approve. Absent when
   * no authorizer is configured (the UI then treats all as allowed).
   */
  permittedActions?: readonly Action[];
}

// ─── Resume Input ───

export interface ResumeInput {
  data?: ResumePayload;
  /**
   * Node-path of the specific paused gate to resume (a step record's key, e.g.
   * `parallel_x:swot#0/approve`). Required when more than one gate is open at
   * once (e.g. a PARALLEL with two WAITs). Omit when a single gate is open — the
   * server resolves it automatically.
   */
  nodePath?: string;
  abort?: boolean;
}

// ─── Rerun Input ───

export interface RerunInput {
  fromStepId: string;
  /** Overrides merged into the entry step's config before variable resolution. */
  configOverrides?: Record<string, unknown>;
  /** Defaults to true. When true, the entry step receives the source row's data as `priorState`. */
  inheritStepState?: boolean;
}

// ─── Multipart Trigger Input ───

export interface TriggerV2Input {
  payload: Record<string, unknown>;
}

// ─── Credential Vault (re-export from common/credentials.ts) ──────────────
export type {
  CredentialSummary,
  CredentialListItem,
  CreateCredentialInput,
  CreateCredentialRequest,
  ConnectorCredentialTypes,
  CredentialTypeDescriptor,
  CredentialTypeRef,
  ReplaceCredentialValuesInput,
  CredentialListResponse,
} from '../common/credentials.js';

// ─── Pagination ───

export interface PaginatedList<T> {
  items: T[];
  nextCursor?: string;
}

// ─── Execution List Params ───

export interface ExecutionListParams {
  workflowId?: string;
  status?: string;
  limit?: number;
  cursor?: string;
  folderId?: string;
}

/**
 * Per-call options every read accepts. Pass React Query's `signal` so a
 * superseded read actually stops rather than merely being discarded.
 */
export interface RequestOpts {
  signal?: AbortSignal;
}

// ─── Client Interface ───

export interface TopError {
  message: string;
  count: number;
  runs: Array<{ id: string; workflowId: string }>;
}

export interface AnalyticsClient {
  summary(
    params: { since: string; rangeDays: number; folderId?: string },
    opts?: RequestOpts,
  ): Promise<AnalyticsSummaryResult>;
  /** On-time vs late for approvals decided since `since` (ISO). */
  approvals(params: { since: string }, opts?: RequestOpts): Promise<ApprovalAnalyticsResult>;
  topErrors(
    params?: { since?: string; limit?: number; folderId?: string },
    opts?: RequestOpts,
  ): Promise<{ topErrors: TopError[] }>;
}

// ─── Conversations ───

/**
 * One step of a conversation.
 *
 * Starting and answering are the same act — the conversation moves and tells you
 * where it is — so they are the same call. Send `workflowId` to begin, or
 * `conversationId` to go on; a `conversationId` with no `turnId` asks where it
 * is without changing anything.
 */
export interface AdvanceConversation extends TurnAnswer {
  /** Start a new conversation on this workflow. */
  workflowId?: string;
  /**
   * What it is started with — the trigger's own payload, exactly as
   * `POST /workflows/:id/trigger` takes it, read as `{{trigger.context.<key>}}`.
   * Everything the caller wants to carry goes here.
   */
  context?: Record<string, unknown>;

  /** Continue this conversation instead of starting one. */
  conversationId?: string;
  /** The turn being answered. Sending the same answer again is safe. */
  turnId?: string;

  /** How long to wait for the next turn (default 20 s, at most 25 s). Ignored when streaming. */
  waitMs?: number;
}

/**
 * Talk to a workflow as a chatbot: every call is about a {@link Turn} — what is
 * asked, how to answer, what happened, or how it ended. Answering a turn that is
 * no longer open rejects with a 409 `WorkflowClientError` whose `body.turn` is
 * the current turn.
 */
export interface ConversationsClient {
  /**
   * Move the conversation on, and answer with the turn it reached.
   *
   * With `stream`, the answer is the events instead, ending when it is someone's
   * move again — so the close is the "your turn" signal, and a reply arrives
   * exactly once, on the connection that asked for it. The format follows the
   * flag and nothing else: a fixed menu streams as a stream of one turn.
   */
  advance(input: AdvanceConversation): Promise<Turn>;
  advance(input: AdvanceConversation & { stream: true; signal?: AbortSignal }): AsyncIterable<ConversationStreamEvent>;
  /** Where the conversation is; with `waitMs`, waits while it is still working. */
  get(id: string, options?: { waitMs?: number }): Promise<Turn>;
  /**
   * Watch a conversation until it ends — for picking the thread back up after a
   * reload, or for a second viewer. Unlike `advance`, this does not stop at the
   * next move. Stop iterating (or abort `signal`) to disconnect; it does not
   * reconnect by itself.
   */
  watch(id: string, options?: { signal?: AbortSignal }): AsyncIterable<ConversationStreamEvent>;
  end(id: string): Promise<Turn>;
}

export interface WorkflowClient {
  /** Base URL, for a host that needs to build a URL this client does not cover. */
  readonly baseUrl: string;
  /**
   * This client's own {@link WorkflowClientConfig.origin} — resolved, so it is a
   * value even when the host supplied none.
   *
   * Exposed so a subscriber can compare it against `origin` on an inbound change
   * event and recognise the echo of its own write. Without it the suppression
   * would have to live in the client, which cannot know what a given UI wants to
   * do about it.
   */
  readonly origin: string;
  /** Live change notifications. See {@link EventsClient}. */
  readonly events: EventsClient;
  readonly schema: SchemaClient;
  readonly workflows: WorkflowsCrudClient;
  readonly folders: FoldersClient;
  readonly executions: ExecutionsClient;
  /** A run answered turn by turn, like a chatbot. See {@link ConversationsClient}. */
  readonly conversations: ConversationsClient;
  readonly credentials: CredentialsClient;
  readonly uploads: UploadsClient;
  readonly analytics: AnalyticsClient;
  /**
   * What the caller may do at the top level — chiefly whether to render the
   * root-level "New folder" / "New credential" buttons. Folder and workflow
   * rows already carry their own `permittedActions`, so this is only needed
   * where there is no row to read.
   */
  capabilities(): Promise<readonly Action[]>;
  moveBatch(input: {
    folders: Array<{ id: string; parentId: string | null }>;
    workflows: Array<{ id: string; folderId: string }>;
  }): Promise<void>;
}

export interface FoldersClient {
  list(params?: { limit?: number; cursor?: string }, opts?: RequestOpts): Promise<PaginatedList<FolderRecord>>;
  get(id: string, opts?: RequestOpts): Promise<FolderRecord>;
  create(input: CreateFolderInput): Promise<FolderRecord>;
  update(id: string, input: UpdateFolderInput): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SchemaClient {
  steps(): Promise<StepSummary[]>;
  step(type: string): Promise<StepDescriptor>;
  triggers(): Promise<TriggerSummary[]>;
  trigger(type: string): Promise<TriggerDescriptor>;
  /** Every credential type, grouped by connector, with its form fields. */
  credentialTypes(): Promise<ConnectorCredentialTypes[]>;
  operators(): Promise<OperatorDescriptor[]>;
  availableContext(
    config: WorkflowConfig,
    atStepId: string,
  ): Promise<AvailableContext | null>;
  fieldOptions(input: FieldOptionsRequest): Promise<FieldOptionsPage>;
}

export interface FieldOptionsRequest {
  kind: 'steps' | 'triggers';
  type: string;
  field: string;
  config?: Record<string, unknown>;
  search?: string;
  cursor?: string;
  values?: readonly string[];
  workflowId?: string;
  folderId?: string;
}

/** Workflow counts for the folder rail: grand total + per-folder breakdown. */
export interface WorkflowCounts {
  total: number;
  byFolder: Record<string, { total: number; active: number }>;
}

export interface WorkflowsCrudClient {
  /**
   * List workflows, optionally scoped to a folder and paginated (server-side).
   * `offset`/`limit` slice the result; pair with `counts()` for the total.
   */
  list(
    params?: { folderId?: string; limit?: number; cursor?: string },
    opts?: RequestOpts,
  ): Promise<PaginatedList<WorkflowRecord>>;
  /** Total + per-folder workflow counts for the current scope. */
  counts(opts?: RequestOpts): Promise<WorkflowCounts>;
  /**
   * The latest run of each workflow in scope, keyed by workflow id. Workflows
   * that have never run are absent.
   */
  lastRuns(
    params?: { folderId?: string; workflowIds?: readonly string[] },
    opts?: RequestOpts,
  ): Promise<Record<string, LastRun>>;
  get(id: string, opts?: RequestOpts): Promise<WorkflowRecord>;
  create(input: CreateWorkflowInput): Promise<WorkflowRecord>;
  update(id: string, input: UpdateWorkflowInput): Promise<WorkflowRecord>;
  validate(config: WorkflowConfig, workflowId?: string): Promise<ValidationResult>;
  /**
   * Turn a workflow on. Answers with what actually happened — live, or sent for
   * review — because the deployment's policy decides that, not the caller.
   */
  activate(id: string): Promise<ActivationOutcome>;
  deactivate(id: string): Promise<void>;
  /**
   * Workflows awaiting review. Scoped to what the caller can see, not to what
   * they can approve — the author who submitted one watches it here too, and
   * each row's `permittedActions` is what decides whether Approve is offered.
   */
  listPending(
    params?: { limit?: number; cursor?: string },
    opts?: RequestOpts,
  ): Promise<PaginatedList<PendingWorkflowSummary>>;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  trigger(
    id: string,
    payload?: Record<string, unknown>,
    attachments?: Attachment[],
  ): Promise<{ executionId: string }>;
  triggerV2(
    workflowId: string,
    input: TriggerV2Input,
  ): Promise<{ executionId: string }>;
}

export interface UploadsClient {
  /**
   * Upload one or more files as multipart/form-data. The server stores them
   * via its {@link StorageAdapter} and returns opaque {@link Attachment}
   * references the caller can attach to a workflow trigger or resume payload.
   */
  create(files: File[] | Blob[]): Promise<{ attachments: Attachment[] }>;
  url(attachment: Attachment): string;
}

/** A persisted per-step progress event (createdAt is an ISO string over HTTP). */
export interface StepEvent {
  id: string;
  type: string;
  /** JSON-encoded event payload. */
  data: string;
  createdAt: string;
}

export interface PendingApprovalSummary {
  id: string;
  workflowId: string;
  /** The workflow's display name, joined server-side. */
  workflowName?: string;
  /** The identifier of the run this gate paused. */
  runName?: string;
  /** True when `runName` was generated, not chosen — hide it then. */
  runNameAutoGenerated?: boolean;
  pausedStepName: string;
  /** Node-path of the paused record — what a resume must be addressed to. */
  pausedNodePath: string;
  createdAt: Date;
  /** When this gate falls due. Absent when its step declared no `dueInMs`. */
  dueAt?: Date;
  /** Workflow tags (from the workflow record metadata) — for filtering. */
  tags?: string[];
}

// The bucket vocabulary is defined once, on the persistence contract, and
// passed straight through to the wire — so a browser and a store can never
// disagree about what 'overdue' names.
export type { PendingApprovalBucket };

/** Approvals-inbox filters. Every one is applied in the query. */
export interface PendingApprovalParams {
  limit?: number;
  cursor?: string;
  workflowIds?: readonly string[];
  stages?: readonly string[];
  tags?: readonly string[];
  search?: string;
  sort?: PendingApprovalSort;
  bucket?: PendingApprovalBucket;
  dayEnd?: number;
}

/** Narrows the approvals count to one bucket, for a section's own total. */
export interface PendingApprovalCountParams {
  bucket?: PendingApprovalBucket;
  dayEnd?: number;
}

/** Filter facets over the whole visible set — not over the page in hand. */
export interface PendingApprovalFacets {
  workflows: Array<{ workflowId: string; name: string; count: number }>;
  stages: Array<{ name: string; count: number }>;
  tags: string[];
}

/** The most recent run of one workflow — the browser's "Last run" column. */
export interface LastRun {
  status: string;
  createdAt: string;
}

export interface ExecutionsClient {
  list(params?: ExecutionListParams, opts?: RequestOpts): Promise<PaginatedList<ExecutionRecord>>;
  listPendingApprovals(
    params?: PendingApprovalParams,
    opts?: RequestOpts,
  ): Promise<PaginatedList<PendingApprovalSummary>>;
  /** How many runs are waiting on a gate — a count, not a list. */
  countPendingApprovals(
    params?: PendingApprovalCountParams,
    opts?: RequestOpts,
  ): Promise<number>;
  /** Filter facets over the whole visible set. See {@link PendingApprovalFacets}. */
  pendingApprovalFacets(opts?: RequestOpts): Promise<PendingApprovalFacets>;
  get(id: string, opts?: RequestOpts): Promise<ExecutionDetail>;
  resume(id: string, input?: ResumeInput): Promise<void>;
  rerun(id: string, input: RerunInput): Promise<{ executionId: string }>;
  cancel(id: string): Promise<void>;
  getStepEvents(executionId: string, stepName: string, after?: string): Promise<StepEvent[]>;
}

export interface CredentialsClient {
  /**
   * List a page of credentials visible to the caller.
   *
   * Returns safe summaries but never values.
   * Includes both ACTIVE and REVOKED credentials, ordered by name.
   */
  list(
    params?: { limit?: number; cursor?: string },
    opts?: RequestOpts,
  ): Promise<CredentialListResponse>;

  /**
   * Create a new credential.
   *
   * Host authorization is applied outside the SDK client contract.
   */
  create(input: CreateCredentialRequest): Promise<CredentialSummary>;

  /**
   * Completely replace the stored values of an existing credential.
   *
   * The client must submit the COMPLETE new value set — no partial
   * merging. The credential name and auth type come from the stored
   * record and cannot be changed.
   */
  replaceValues(
    name: string,
    input: ReplaceCredentialValuesInput,
  ): Promise<CredentialSummary>;

  /**
   * Revoke a credential — terminal transition from ACTIVE to REVOKED.
   *
   * Idempotent: revoking an already-revoked credential returns the
   * existing summary without changing the original revocation time.
   */
  revoke(name: string): Promise<CredentialSummary>;
}
