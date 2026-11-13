/**
 * Types for the WorkflowRuntime orchestrator.
 */

import type { PersistenceAdapter, QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import type { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { WorkflowExecutor, ExecutorLogger } from '../engine/workflow-executor.js';
import type { ServiceRegistry } from '../engine/service-registry.js';
import type { StorageAdapter } from '../storage/types.js';
import type { SandboxAdapter } from '../sandbox/types.js';
import type { EventBusAdapter } from '../events/types.js';
import type { Action, WorkflowAuthorizer } from '../authz/types.js';
import type { IdScope } from '../authz/id-scope.js';
import type { ApprovalConfig } from '../types/approval.js';

// ─── Execution Result ───

export type ExecutionResult =
  | { status: 'completed' }
  | { status: 'paused'; reason: string; externalRef?: string }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string }
  | { status: 'not_found' };

// ─── Runtime Config ───

export interface AiBuilderConfig {
  /** LiteLLM base URL (e.g. https://grid.ai.juspay.net/). */
  baseUrl: string;
  /** LiteLLM API key. */
  apiKey: string;
  /** Model to use. Defaults to claude-sonnet-4-20250514. */
  model?: string;
  /** Max tokens for the AI response. Defaults to 16384. */
  maxTokens?: number;
}

/**
 * Plain runtime settings — host policy expressed as data, grouped under one bag
 * so the top-level constructor signature stays focused on adapters and
 * registries.
 *
 * Everything here has a sensible default except {@link RuntimeConfig.approval},
 * which is why the bag itself is required: a security control that can be left
 * out is one a deployment can inherit without choosing it, and TypeScript
 * cannot insist on a field inside an optional object.
 */
export interface RuntimeConfig {
  /**
   * Which configurations need a second pair of eyes before they go live.
   *
   * Required, deliberately — for the reason {@link RuntimeOptions.authorizer}
   * is. A deployment that wants no review says so in one line:
   * `{ default: ApprovalRequirement.NOT_REQUIRED }`. That is a statement, and
   * `grep NOT_REQUIRED` is then a complete audit of where the gate is open.
   */
  approval: ApprovalConfig;
  /** Base URL for webhook URL generation (e.g. 'https://api.example.com'). Default: `''`. */
  baseUrl?: string;
  /**
   * IANA timezone string applied to every cron-triggered workflow scheduled
   * by this runtime. Cron triggers don't expose timezone to workflow authors —
   * every cron job in a deployment runs against this single zone.
   * Default: `'Asia/Kolkata'`.
   */
  defaultCronTimezone?: string;
  /**
   * Allow uploads of files with executable MIME types / extensions
   * (.exe, .dll, .sh, .jar, .docm, etc). The upload route rejects them at
   * the perimeter unless this is `true`. Default: `false`.
   */
  allowExecutableUploads?: boolean;
  /**
   * AI builder config. When provided, the workflow router includes the
   * POST /api/ai-builder/chat route automatically.
   */
  aiBuilder?: AiBuilderConfig;
}

// ─── Runtime Options ───

export interface RuntimeOptions<
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
  TFilter = IdScope,
> {
  // Adapters / registries — explicit dependencies.
  persistence: PersistenceAdapter<TFilter>;
  queue: QueueAdapter;
  scheduler: SchedulerAdapter;
  services: ServiceRegistry<TServices>;
  /**
   * Every step and trigger this deployment provides. A component reaches the
   * engine only by belonging to a connector registered here.
   */
  connectors: ConnectorRegistry;
  executor: WorkflowExecutor<TServices>;
  /**
   * Optional storage adapter for file attachments. Required if any workflow
   * uses the trigger `attachments` slot or accepts attachments in resume
   * payloads. Routes that need storage will return 501 if it's omitted.
   */
  storage?: StorageAdapter;
  /**
   * Optional sandbox adapter for code execution. Required if any workflow uses
   * the built-in `run_code` agent tool (or a future sandboxed CODE step).
   * The framework ships only the contract — the host plugs in E2B/Docker/etc.
   */
  sandbox?: SandboxAdapter;
  /**
   * Pub/sub transport for live execution events. Omit it and the engine simply
   * publishes nothing — the SSE stream route then answers 501 rather than
   * holding a connection open that can never produce a frame.
   *
   * Pass {@link InMemoryEventBus} for a single-process host. A host whose queue
   * worker and HTTP API are separate processes must pass a distributed one;
   * see {@link EventBusAdapter} for why the in-memory bus fails silently there.
   */
  eventBus?: EventBusAdapter;
  logger?: ExecutorLogger;

  /**
   * Authorization port — the single surface for access control, and the sole
   * source of the `TFilter` that reaches the adapter.
   *
   * Required, deliberately. There is no default: a default could only ever be
   * {@link AllowAllAuthorizer}, which grants everything — so omitting this
   * would make *forgetting* access control indistinguishable from *choosing*
   * to have none. It would also be unsound. `TFilter` is inferred from the
   * `persistence` adapter too, so a host with its own filter shape that
   * supplied no authorizer would get AllowAll's `{kind:'all'}` handed to an
   * adapter expecting something else — the adapter's real predicate reads
   * `undefined`, and every tenant's rows leak, silently.
   *
   * For local dev, tests, and single-tenant deployments, pass
   * `new AllowAllAuthorizer()` explicitly. One line, and it makes
   * `grep AllowAllAuthorizer` a complete audit of where enforcement is off.
   */
  authorizer: WorkflowAuthorizer<TCtx, TFilter>;

  // Host policy as data. Required because one of its fields is — see
  // {@link RuntimeConfig}.
  config: RuntimeConfig;
}

// ─── Activation Outcome ───

/**
 * What activating a workflow did.
 *
 * Activating is one action with two possible endings — live, or waiting on a
 * reviewer — and which one you get depends on the deployment's policy, not on
 * anything the caller chose. So the call reports its own outcome rather than
 * the UI predicting it beforehand and hoping the two agree.
 */
export interface ActivationOutcome {
  /** ACTIVE, or PENDING_APPROVAL when the policy sent it for review. */
  status: string;
  /**
   * Component types that obliged the review, so the author can be told why.
   * Empty when the workflow went live.
   */
  gatedBy: readonly string[];
}

// ─── Pending Workflows ───

/**
 * A workflow waiting on a reviewer, as the review queue shows it.
 *
 * Carries no author: this runtime has no notion of who anyone is, and inventing
 * one to fill a column would be the wrong place to start. A host that wants
 * "submitted by" joins it from its own records on `workflowId`.
 */
export interface PendingWorkflowSummary {
  workflowId: string;
  /** From the workflow's metadata; absent if it was never named. */
  name?: string;
  folderId: string;
  triggerType: string;
  /** Component types that obliged this workflow to be reviewed. */
  gatedBy: readonly string[];
  /** When it entered review — the last write to the record. */
  submittedAt: Date;
  /** The caller's actions on it; the UI offers Approve only if it holds `workflow:approve`. */
  permittedActions?: readonly Action[];
}

// ─── Mutation Options ───

/**
 * Cross-cutting options for a mutation, kept apart from its domain input because
 * they describe the *call*, not the thing being written.
 */
export interface MutationOptions {
  /**
   * Opaque identifier of the writer, echoed back on the change event this
   * mutation emits.
   *
   * A client that stamps its own writes can then recognise the echo of its own
   * work and ignore it. That matters most in an editor: without it, a user's own
   * save arrives back as "this workflow changed somewhere else", and the editor
   * has no way to tell that apart from a real concurrent edit.
   *
   * Never interpreted by the engine and never trusted: a hint for a UI, not an
   * identity, and a client may forge any value it likes without consequence.
   */
  origin?: string;
}

// ─── Dispatch Event Input ───

export interface DispatchEventInput {
  type: string;
  payload: Record<string, unknown>;
  /** Host metadata — passed to persistence.findActiveWorkflows(). */
  metadata: Record<string, unknown>;
  /**
   * When the source says it happened, ISO 8601. Reaches the trigger's hooks as
   * {@link TriggerEvent.occurredAt}; omit it when the host has no such clock.
   */
  occurredAt?: string;
}

// ─── Resume Input ───

import type { ResumePayload } from '../common/resume-payload.js';

export interface ResumeInput {
  /** Resume payload submitted by the host UI. */
  data?: ResumePayload;
  /**
   * Node-path of the specific paused gate to resume (a step's record key, e.g.
   * `parallel_x:swot#0/approve`). The UI sends this when resolving a gate inside
   * a control-flow branch, or when more than one gate is open at once. Omit when
   * the execution has a single open gate — the runtime resolves it automatically.
   */
  nodePath?: string;
  /**
   * If true, the execution is aborted rather than continued. Equivalent to
   * `data: { action: 'abort' }` — kept as a top-level convenience.
   */
  abort?: boolean;
}
