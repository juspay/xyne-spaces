/**
 * WorkflowRuntime — the central orchestrator.
 *
 * Ties together: persistence, queue, scheduler, executor, triggers, and steps.
 * The host creates one runtime instance and uses it for all workflow operations:
 *
 * - Activate/deactivate triggers (cron, webhook)
 * - Dispatch domain events → matching workflows
 * - Handle incoming webhooks
 * - Fire manual triggers
 * - Resume paused executions
 * - Process queued jobs (the worker loop body)
 */

import type {
  RuntimeOptions,
  DispatchEventInput,
  MutationOptions,
  ResumeInput,
  ExecutionResult,
  AiBuilderConfig,
  PendingWorkflowSummary,
  ActivationOutcome,
} from './types.js';
import { executionTopic, workflowTopic, folderTopic } from '../events/types.js';
import type {
  BusEvent,
  EventBusAdapter,
  EventTopic,
  ExecutionStreamEvent,
  WorkflowChangeKind,
} from '../events/types.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { projectVariables } from '../types/workflow-variable.js';
import type {
  ValidationIssue,
  ValidationIssueLocation,
  ValidationResult,
} from '../types/validation.js';
import { ValidationIssueCode } from '../types/validation.js';
import type { ApprovalConfig, ApprovalGate } from '../types/approval.js';
import { WorkflowStatus } from '../types/status.js';
import { approvalGate } from '../util/approval-gate.js';
import { ConfigValidator } from '../engine/config-validator.js';
import { VariableResolver } from '../engine/variable-resolver.js';
import { literalValues } from '../util/literal-values.js';
import type { WorkflowContext } from '../types/context.js';
import { readWorkflowConfig } from '../engine/read-config.js';
import type { Address, Delivery, DeliveryOutcome } from '../completion/types.js';
import { collectStepIds, resolveGate } from '../completion/address.js';
import { attachDeliveryFiles } from '../completion/attach.js';
import { coerceTextFields } from '../common/multipart-values.js';
import type { PayloadError } from '../common/validate-payload.js';
import type {
  WorkflowRecord,
  FolderRecord,
  ExecutionRecord,
  StepRecord,
  PersistenceAdapter,
  QueueAdapter,
  SchedulerAdapter,
  Paged,
  PendingApprovalRow,
  PendingApprovalQuery,
  PendingApprovalCountQuery,
  PendingApprovalFacets,
  LastRun,
} from '../persistence/types.js';
import { resolvePage } from './paging.js';
import type { StorageAdapter, StorageScope } from '../storage/types.js';
import type { SandboxAdapter } from '../sandbox/types.js';
import { validateTriggerPayload } from '../common/validate-payload.js';
import type {
  CredentialSummary,
  CredentialListItem,
  ResolvedCredential,
  CreateCredentialInput,
  AuthSpecificValues,
} from '../common/credentials.js';
import type { WorkflowExecutor, ExecutorLogger } from '../engine/workflow-executor.js';
import type {
  WorkflowAuthorizer,
  Action,
  ResourceRef,
  ResourceType,
} from '../authz/types.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { IdScope } from '../authz/id-scope.js';
import { AccessDeniedError, ResourceNotFoundError } from '../authz/default.js';
import type { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { AnyStep, AnyTrigger } from '../connectors/core/base-connector.js';
import type { ServiceRegistry } from '../engine/service-registry.js';
import { EventTrigger } from '../triggers/event-trigger.js';
import { WebhookTrigger } from '../triggers/webhook-trigger.js';
import { ApiTrigger } from '../triggers/api-trigger.js';
import type { HydrateResult, TriggerExecutionContext } from '../triggers/base-trigger.js';
import { CredentialResolver } from '../engine/credential-resolver.js';
import { headerValue } from '../ingest/headers.js';
import { parseInboundBody } from '../ingest/body.js';
import { matchesTriggerFilter } from '../ingest/filter.js';
import type { FieldOptionsContext, FieldOptionsPage } from '../schema/options.js';
import {
  isDelayedStart,
  readAnchor,
  resolveStartAt,
  startNeedsPayload,
  startSkipReason,
  type StartDecision,
} from '../ingest/start-policy.js';
import type {
  InboundHttpRequest,
  InboundReply,
  TriggerEvent,
  WebhookIngestResult,
} from '../ingest/types.js';
import { CronTrigger } from '../triggers/cron-trigger.js';
import { PauseStep } from '../engine/pause-step.js';
import { leafStepId } from '../engine/node-path.js';

// ─── Helpers ───

/**
 * What the runtime decided about one event offered to one workflow.
 *
 * `rejected` is a normal outcome — most events are not for most workflows.
 * `gone` means the event's subject no longer exists, so there is nothing to act
 * on: separate from rejection because it is worth saying out loud.
 */
type Admission =
  | { kind: 'ok'; payload: Record<string, unknown> }
  | { kind: 'rejected'; by: 'scope' | 'conditions' }
  | { kind: 'gone'; reason: string };

/** Why an event was not admitted, for logs and for the error a manual run gets. */
function reasonOf(decision: Exclude<Admission, { kind: 'ok' }>): string {
  if (decision.kind === 'gone') return `the subject is gone (${decision.reason})`;
  switch (decision.by) {
    case 'scope':
      return 'this workflow does not watch that event';
    case 'conditions':
      return "the workflow's conditions did not match";
  }
}

/**
 * What arming an event produced: a run now, a run parked until its moment, or
 * nothing at all.
 */
type Armed =
  | { kind: 'started'; executionId: string }
  | { kind: 'scheduled'; executionId: string; fireAt: Date }
  | { kind: 'dropped'; reason: string };

/** What a scheduled run's moment produced. */
type Activation =
  | { kind: 'started' }
  | { kind: 'deferred'; reason: string }
  | { kind: 'ended'; status: 'SKIPPED' | 'CANCELLED'; reason: string };

/**
 * How early a wake-up is tolerated before the run re-arms itself.
 *
 * A delayed job can fire a little early (clock skew between the queue and this
 * process), and a host sweeper re-enqueueing a run whose job was lost can be
 * eager. Neither should admit an event before its moment, because admission is
 * what reads the world.
 */
const EARLY_WAKE_TOLERANCE_MS = 1_000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const noopLogger: ExecutorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The run form's identifier travels in the trigger payload under this key, and
 * is lifted out before the payload is validated or stored: it names the run,
 * it is not input to it, so the trigger schema and the steps never see it.
 */
export const RUN_IDENTIFIER_FIELD = '__runIdentifier';

/** The trigger's author-supplied input schema, when it has one. */
function inputSchemaOf(config: WorkflowConfig): Record<string, unknown> | undefined {
  const inputSchema = (config.trigger.config ?? {})['inputSchema'];
  return inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)
    ? (inputSchema as Record<string, unknown>)
    : undefined;
}



/**
 * The author's declared shape, checked the same way a manual trigger's input
 * is — required fields and attachment invariants, not a deep type check. A
 * sender that gets this back learns what it sent wrong instead of the run
 * carrying on with a field that is not there.
 */
function checkAgainstContract(contract: unknown, payload: unknown): PayloadError[] {
  if (contract === undefined || contract === null || typeof contract !== 'object') return [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [{ path: '', message: 'Expected a JSON object' }];
  }
  return validateTriggerPayload(
    contract as Record<string, unknown>,
    payload as Record<string, unknown>,
  );
}

/** The author-given name out of the metadata column, if it has one. */
function parseWorkflowName(raw: string | null): string | undefined {
  const meta = JSON.parse(raw ?? '{}') as Record<string, unknown>;
  return typeof meta['name'] === 'string' ? meta['name'] : undefined;
}

// ─── WorkflowRuntime ───

/**
 * The `kind` a workflow's metadata declares, if any — what a host routes a pass
 * on. Absent, unparseable or unset metadata all read the same: no kind, and the
 * host's single default lane.
 */
function kindOf(workflow: Pick<WorkflowRecord, 'metadata'> | null | undefined): string | undefined {
  if (!workflow?.metadata) return undefined;
  try {
    const meta = JSON.parse(workflow.metadata) as Record<string, unknown>;
    return typeof meta['kind'] === 'string' ? meta['kind'] : undefined;
  } catch {
    return undefined;
  }
}

export class WorkflowRuntime<
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
  TFilter = IdScope,
> {
  private readonly persistence: PersistenceAdapter<TFilter>;
  /** Authorization port — host-supplied, always. See {@link RuntimeOptions.authorizer}. */
  private readonly authorizer: WorkflowAuthorizer<TCtx, TFilter>;
  private readonly queue: QueueAdapter;
  private readonly scheduler: SchedulerAdapter;
  private readonly services: ServiceRegistry<TServices>;
  readonly connectors: ConnectorRegistry;
  private readonly executor: WorkflowExecutor<TServices>;
  private readonly credentialResolver: CredentialResolver;
  private readonly log: ExecutorLogger;
  private readonly baseUrl: string;
  /** Pub/sub transport for live execution events. Exposed for the router's SSE stream. */
  readonly eventBus?: EventBusAdapter | undefined;
  /** Storage adapter for file attachments. Exposed for the router. */
  readonly storage?: StorageAdapter | undefined;
  /** Sandbox adapter for code execution. Threaded into step execution context. */
  readonly sandbox?: SandboxAdapter | undefined;
  /** When true, the upload route accepts executable MIME types / extensions. */
  readonly allowExecutableUploads: boolean;
  /** IANA timezone applied to every cron-triggered workflow. */
  readonly defaultCronTimezone: string;
  /** AI builder config — when present, the router includes the ai-builder chat route. */
  readonly aiBuilder?: AiBuilderConfig | undefined;
  /** Which configurations need approval before going live. Host-supplied, always. */
  private readonly approval: ApprovalConfig;

  constructor(opts: RuntimeOptions<TServices, TCtx, TFilter>) {
    this.persistence = opts.persistence;
    // No fallback and no cast: the authorizer and the adapter must agree on
    // `TFilter`, and the only way to guarantee that is to make the host supply
    // both. See {@link RuntimeOptions.authorizer}.
    this.authorizer = opts.authorizer;
    this.queue = opts.queue;
    this.scheduler = opts.scheduler;
    this.services = opts.services;
    this.connectors = opts.connectors;
    this.executor = opts.executor;
    this.credentialResolver = new CredentialResolver(opts.persistence);
    this.log = opts.logger ?? noopLogger;
    this.eventBus = opts.eventBus;
    this.storage = opts.storage;
    this.sandbox = opts.sandbox;

    const config = opts.config;
    this.approval = config.approval;
    this.baseUrl = config.baseUrl ?? '';
    this.allowExecutableUploads = config.allowExecutableUploads ?? false;
    this.defaultCronTimezone = config.defaultCronTimezone ?? 'Asia/Kolkata';
    this.aiBuilder = config.aiBuilder;
  }

  /**
   * Publish to the bus. Fire-and-forget for the same reason the executor's
   * `emitEvent` is: the bus may cross a network, and a mutation must not fail
   * because the thing it was announcing itself to is unreachable. A lost
   * notification costs a stale view until the next read; a failed write costs
   * the user their work.
   */
  private publish(topic: EventTopic, event: BusEvent): void {
    const bus = this.eventBus;
    if (!bus) return;
    void bus.publish(topic, event).catch((err: unknown) => {
      this.log.warn(`event bus publish failed (${event.event} on ${topic}): ${String(err)}`);
    });
  }

  private publishEvent(executionId: string, event: ExecutionStreamEvent): void {
    this.publish(executionTopic(executionId), event);
  }

  /**
   * Queue one pass, saying which kind of run it belongs to.
   *
   * Every enqueue goes through here so the kind is read from the workflow record
   * in one place: a host that routes passes by it has to send every pass of one
   * execution to the same place, and a call site that forgot to pass the record
   * would quietly send that one somewhere else. See `QueueAdapter.enqueue`.
   */
  private async enqueuePass(
    data: { executionId: string; delay?: number; singletonKey?: string },
    workflow: Pick<WorkflowRecord, 'metadata'> | null | undefined,
  ): Promise<void> {
    const kind = kindOf(workflow);
    await this.queue.enqueue(kind === undefined ? data : { ...data, kind });
  }

  /**
   * Announce that a run appeared or changed status, to the run's own topic, the
   * workflow's and its folder's — the screens that need it are scoped all three
   * ways.
   *
   * The run's own topic carries it for a reason the other two do not need: this
   * is the only event published *after* the execution row's new status is
   * committed. `execution_paused` is emitted while the step row is written, a
   * moment before, so a reader woken by that alone finds the run still RUNNING.
   *
   * Fire-and-forget, like every publish here.
   */
  private publishRunChange(
    workflow: Pick<WorkflowRecord, 'id' | 'folderId'>,
    executionId: string,
    status: string,
  ): void {
    if (!this.eventBus) return;
    const event = {
      event: 'run_changed' as const,
      data: {
        workflowId: workflow.id,
        executionId,
        status,
        at: new Date().toISOString(),
      },
    };
    this.publish(executionTopic(executionId), event);
    this.publish(workflowTopic(workflow.id), event);
    if (workflow.folderId) this.publish(folderTopic(workflow.folderId), event);
  }

  /**
   * Announce that a workflow definition changed.
   *
   * Emitted from the runtime rather than the router on purpose: every writer goes
   * through here — the builder, an agent's tool call, a host calling the runtime
   * directly — so no caller can change a workflow without saying so. Put this in
   * the HTTP layer instead and the first non-HTTP writer silently stops notifying.
   */
  private publishWorkflowChange(
    workflowId: string,
    change: WorkflowChangeKind,
    origin?: string,
  ): void {
    this.publish(workflowTopic(workflowId), {
      event: 'workflow_changed',
      data: {
        workflowId,
        change,
        ...(origin === undefined ? {} : { origin }),
        at: new Date().toISOString(),
      },
    });
  }

  // ─── Authorization primitives ───
  //
  // Every caller-facing operation goes through exactly one of these. There is no
  // bypass: system-initiated work lives on `this.system` and never reaches here.

  /**
   * Guard an action on a ref the caller already has. Throws
   * {@link AccessDeniedError} if denied; returns the full action set so callers
   * can reuse it as the resource's `permittedActions` for the UI.
   */
  private async require(
    ctx: TCtx,
    action: Action,
    ref: ResourceRef,
  ): Promise<readonly Action[]> {
    const perms = await this.authorizer.permissions(ctx, ref);
    if (!perms.includes(action)) throw new AccessDeniedError(action, ref);
    return perms;
  }

  /**
   * Fetch a workflow AND decide on it, atomically. This is the ONLY way a
   * caller-facing op obtains a workflow — so "forgot to authorize" is not
   * expressible, rather than merely discouraged.
   */
  private async authorizedWorkflow(
    ctx: TCtx,
    id: string,
    action: Action,
  ): Promise<{ record: WorkflowRecord; permittedActions: readonly Action[] }> {
    const record = await this.persistence.getWorkflow(id);
    if (!record) throw new ResourceNotFoundError('Workflow', id);
    const permittedActions = await this.require(ctx, action, this.workflowRef(record));
    return { record, permittedActions };
  }

  /** Fetch a folder AND decide on it, atomically. See {@link authorizedWorkflow}. */
  private async authorizedFolder(
    ctx: TCtx,
    id: string,
    action: Action,
  ): Promise<{ record: FolderRecord; permittedActions: readonly Action[] }> {
    const record = await this.persistence.getFolder(id);
    if (!record) throw new ResourceNotFoundError('Folder', id);
    const permittedActions = await this.require(ctx, action, this.folderRef(record));
    return { record, permittedActions };
  }

  /** The caller's list predicate for `type`, handed to the adapter verbatim. */
  private filterFor(ctx: TCtx, type: ResourceType): Promise<TFilter> {
    return this.authorizer.visibleFilter(ctx, type);
  }

  /**
   * The container a new resource would land in: the named folder, or `root`
   * when there is no parent. Create is guarded against this — the container is
   * the only thing that exists to ask about before the resource does.
   */
  private async containerRef(parentId: string | null | undefined): Promise<ResourceRef> {
    if (!parentId) return { type: 'root' };
    const folder = await this.persistence.getFolder(parentId);
    if (!folder) throw new ResourceNotFoundError('Folder', parentId);
    return this.folderRef(folder);
  }

  /** Build a workflow ref — the record already carries typed `attributes`. */
  private workflowRef(wf: WorkflowRecord): ResourceRef {
    return { type: 'workflow', id: wf.id, record: wf };
  }

  /** Build a folder ref from the stored record — carries the folder's typed `attributes`. */
  private folderRef(folder: FolderRecord): ResourceRef {
    return { type: 'folder', id: folder.id, record: folder };
  }

  private executionRef(exec: ExecutionRecord): ResourceRef {
    return { type: 'execution', id: exec.id, record: exec };
  }

  /**
   * Build a gate ref for the parked step an answer is addressed to.
   *
   * Two identities, and they are not interchangeable. `id` is the NODE PATH,
   * which addresses this one parked record; `record.stepId` is the CONFIG step
   * id, which is what a host keys an assignee on. One config step inside a loop
   * or a parallel yields many node paths, so an authorizer that keyed on the
   * path would need a grant per iteration.
   *
   * `assignee` is deliberately left unset. The host owns what an assignee IS and
   * resolves it from its own store, so the SDK carries no principal model and
   * emails becoming teams costs nothing here. The denormalized ancestry
   * (`workflowId`, `folderId`) is what lets an authorizer reach the workflow
   * anchor without a lookup of its own.
   */
  private approvalStepRef(
    gate: StepRecord,
    executionId: string,
    workflow: WorkflowRecord,
  ): ResourceRef {
    return {
      type: 'approvalStep',
      id: gate.stepName,
      record: {
        stepId: leafStepId(gate.stepName),
        executionId,
        workflowId: workflow.id,
        folderId: workflow.folderId,
      },
    };
  }

  /** Build a credential ref without exposing secret values to authorization. */
  private credentialRef(item: CredentialListItem): ResourceRef {
    return {
      type: 'credential',
      id: item.summary.name,
      record: {
        id: item.summary.name,
        name: item.summary.name,
        type: item.summary.authType,
        ...(item.attributes !== undefined ? { attributes: item.attributes } : {}),
        ...(item.permittedActions !== undefined
          ? { permittedActions: item.permittedActions }
          : {}),
      },
    };
  }

  /**
   * Populate each list row's `permittedActions` in one authorizer round-trip
   * (via `permissionsBatch`, falling back to per-item) so the UI gates inline
   * row actions synchronously — no N+1 fetch, no optimistic buttons.
   */
  private async project<T extends { permittedActions?: readonly Action[] }>(
    ctx: TCtx,
    records: T[],
    toRef: (r: T) => ResourceRef,
  ): Promise<T[]> {
    if (records.length === 0) return records;
    const refs = records.map(toRef);
    const perms = this.authorizer.permissionsBatch
      ? await this.authorizer.permissionsBatch(ctx, refs)
      : await Promise.all(refs.map((ref) => this.authorizer.permissions(ctx, ref)));
    return records.map((r, i) => ({ ...r, permittedActions: perms[i] }));
  }

  // ─── Validation ───

  /**
   * Validate a workflow config before saving.
   *
   * The host's save handler should call this and reject the save if
   * `result.valid` is false. Returns structured issues the frontend
   * can render inline in the workflow builder.
   */
  async validateConfig(
    ctx: TCtx,
    config: WorkflowConfig,
    workflowId?: string,
  ): Promise<ValidationResult> {
    const result = new ConfigValidator(this.connectors).validate(config);
    if (!result.valid || workflowId === undefined) return result;

    const attributes = await this.editingScope(ctx, { workflowId });
    const issues = [...result.issues, ...(await this.checkComponents(ctx, config, attributes))];
    return { valid: issues.length === 0, issues };
  }

  // ─── Workflow Lifecycle ───

  /**
   * Whether this configuration needs a reviewer, and which component types
   * asked for it. The reading of the policy is {@link approvalGate}; this only
   * supplies it with what the configuration is made of.
   */
  private gateFor(config: WorkflowConfig): ApprovalGate {
    return approvalGate(this.approval, new ConfigValidator(this.connectors).components(config));
  }

  /**
   * Activate a workflow's trigger.
   *
   * - Every trigger: its credential slots must resolve to accepted credentials
   * - CronTrigger: registers with the scheduler
   *
   * Only then is the workflow marked ACTIVE. Webhook ingest and event dispatch
   * both key off that status, so it is what actually turns a workflow on.
   *
   * Unless the deployment's {@link ApprovalConfig} gates this configuration, in
   * which case it goes to PENDING_APPROVAL and none of the above happens yet —
   * a workflow awaiting review must not hold a cron registration.
   *
   * `workflow:activate` stays the maker's action throughout: authorization says
   * whether you may turn workflows on, the policy says whether this one needs a
   * second look first. Neither stands in for the other.
   */
  async activateWorkflow(
    ctx: TCtx,
    workflowId: string,
    opts?: MutationOptions,
  ): Promise<ActivationOutcome> {
    // Guard up front, before any external side-effects (webhook/scheduler).
    const { record, permittedActions } = await this.authorizedWorkflow(
      ctx,
      workflowId,
      'workflow:activate',
    );

    const gate = this.gateFor(readWorkflowConfig(record.config));
    // A caller who may approve is approving by activating — otherwise an admin
    // toggling their own workflow would queue a review of their own work.
    // Strict four-eyes is the authorizer's to impose: withhold
    // `workflow:approve` when the caller is the author and this branch stops
    // applying to them.
    if (gate.required && !permittedActions.includes('workflow:approve')) {
      await this.persistence.updateWorkflow(workflowId, {
        status: WorkflowStatus.PENDING_APPROVAL,
      });
      this.log.info(
        `workflow ${workflowId} submitted for approval — gated by ${gate.gatedBy.join(', ')}`,
      );
      this.publishWorkflowChange(workflowId, 'submitted', opts?.origin);
      return { status: WorkflowStatus.PENDING_APPROVAL, gatedBy: gate.gatedBy };
    }

    await this.activateInternal(ctx, record);
    await this.persistence.updateWorkflow(workflowId, { status: WorkflowStatus.ACTIVE });
    // After the side-effects, never before: an activation that failed is not a
    // change worth telling anyone about.
    this.publishWorkflowChange(workflowId, 'activated', opts?.origin);
    return { status: WorkflowStatus.ACTIVE, gatedBy: [] };
  }

  /**
   * Approve a workflow awaiting review and put it live.
   *
   * Approval and activation are one act, deliberately: the checker's consent is
   * expressed by the workflow starting, so there is no "approved but off" state
   * to explain, and no second click for someone to forget. The trigger's
   * side-effects run here — at the moment it actually goes live, not when it
   * was submitted.
   */
  async approveWorkflow(
    ctx: TCtx,
    workflowId: string,
    opts?: MutationOptions,
  ): Promise<void> {
    const { record } = await this.authorizedWorkflow(ctx, workflowId, 'workflow:approve');
    if (record.status !== WorkflowStatus.PENDING_APPROVAL) {
      throw new Error(
        `Cannot approve workflow ${workflowId}: it is ${record.status}, not awaiting approval`,
      );
    }
    await this.activateInternal(ctx, record);
    await this.persistence.updateWorkflow(workflowId, { status: WorkflowStatus.ACTIVE });
    this.log.info(`workflow ${workflowId} approved and activated`);
    this.publishWorkflowChange(workflowId, 'approved', opts?.origin);
  }

  /**
   * Decline a workflow awaiting review.
   *
   * REJECTED rather than back to DRAFT, so the author can tell "declined" from
   * "nobody has looked yet". Editing it returns it to DRAFT — see
   * {@link updateWorkflow}. The reason and the reviewer are the host's to
   * record: this runtime has no notion of who anyone is.
   */
  async rejectWorkflow(
    ctx: TCtx,
    workflowId: string,
    opts?: MutationOptions,
  ): Promise<void> {
    const { record } = await this.authorizedWorkflow(ctx, workflowId, 'workflow:approve');
    if (record.status !== WorkflowStatus.PENDING_APPROVAL) {
      throw new Error(
        `Cannot reject workflow ${workflowId}: it is ${record.status}, not awaiting approval`,
      );
    }
    await this.persistence.updateWorkflow(workflowId, { status: WorkflowStatus.REJECTED });
    this.log.info(`workflow ${workflowId} rejected`);
    this.publishWorkflowChange(workflowId, 'rejected', opts?.origin);
  }

  /**
   * The activation work, already authorized. Used by the guarded
   * {@link activateWorkflow} and by `createWorkflow` (whose create was itself
   * authorized against the target folder).
   */
  /**
   * Every component's verdict on the config, merged into issues that path like
   * any other.
   *
   * Components run concurrently and independently: one slow connector must not
   * hold up the rest, and one that throws must not hide what the others found. A
   * rejection becomes a MISCONFIGURED issue rather than an exception — failing
   * closed, because refusing to activate is the safe answer when the check that
   * would have caught a problem could not be made.
   */
  private async checkComponents(
    ctx: TCtx,
    config: WorkflowConfig,
    attributes: ResourceAttributes<'workflow'>,
  ): Promise<ValidationIssue[]> {
    const refs = new ConfigValidator(this.connectors)
      .components(config)
      .map((ref) => ({
        ref,
        impl:
          ref.kind === 'trigger'
            ? (this.connectors.getTrigger(ref.type) as AnyTrigger)
            : (this.connectors.getStep(ref.type) as AnyStep),
      }))
      .filter((entry) => entry.impl.validateConfig !== undefined);

    if (refs.length === 0) return [];

    const settled = await Promise.allSettled(
      refs.map(async ({ ref, impl }) => {
        // A half-configured credential is the component's problem to report, not
        // a reason to crash — the same choice getFieldOptions makes.
        let credentials: Readonly<Record<string, ResolvedCredential>> = {};
        try {
          credentials = await this.credentialResolver.resolve(attributes, impl, ref.config);
        } catch (err) {
          this.log.info(
            `validateConfig for ${ref.kind} "${ref.type}": no usable credential — ${messageOf(err)}`,
          );
        }

        const issues = await impl.validateConfig!({
          config: ref.config,
          known: literalValues(ref.config),
          credentials,
          attributes,
          services: this.services,
          caller: ctx,
        } as never);
        return { ref, issues };
      }),
    );

    const out: ValidationIssue[] = [];
    settled.forEach((result, index) => {
      const { ref } = refs[index]!;
      const location: ValidationIssueLocation =
        ref.kind === 'trigger'
          ? { scope: 'trigger' }
          : { scope: 'step', ...(ref.stepId !== undefined ? { stepId: ref.stepId } : {}) };

      if (result.status === 'rejected') {
        this.log.warn(
          `validateConfig threw for ${ref.kind} "${ref.type}": ${messageOf(result.reason)}`,
        );
        out.push({
          path: ref.path,
          code: ValidationIssueCode.MISCONFIGURED,
          // Says "unknown", not "wrong" — the author should retry, not go hunting
          // for a mistake that may not exist.
          message: `Could not verify the ${ref.kind} "${ref.type}" — please try again.`,
          location,
        });
        return;
      }

      for (const issue of result.value.issues) {
        out.push({
          path: issue.path ? `${ref.path}.${issue.path}` : ref.path,
          code: ValidationIssueCode.MISCONFIGURED,
          message: issue.message,
          ...(issue.path !== undefined
            ? { location: { ...location, field: issue.path } }
            : { location }),
        });
      }
    });
    return out;
  }

  private async activateInternal(ctx: TCtx, workflow: WorkflowRecord): Promise<void> {
    const workflowId = workflow.id;
    const config = readWorkflowConfig(workflow.config);
    const activateAttributes = workflow.attributes as ResourceAttributes<'workflow'>;

    // A configuration naming things that do not exist, or that its author may
    // not use, fails here — beside the credential check below and for the same
    // reason: better now than on the first event. Saving is deliberately left
    // alone, because a draft in progress is allowed to be wrong.
    const unresolved = await this.checkComponents(ctx, config, activateAttributes);
    if (unresolved.length > 0) {
      throw new Error(
        `Cannot activate workflow ${workflowId}: ${unresolved.map((issue) => issue.message).join('; ')}`,
      );
    }
    if (!this.connectors.hasTrigger(config.trigger.type)) {
      throw new Error(
        `Trigger type "${config.trigger.type}" is not registered`,
      );
    }

    const trigger = this.connectors.getTrigger(config.trigger.type);

    // A missing, revoked or wrong-type credential fails here, naming the slot,
    // rather than on the first event.
    if (trigger.credentialSlots?.length) {
      await this.credentialResolver.resolve(
        workflow.attributes as ResourceAttributes<'workflow'>,
        trigger,
        config.trigger.config,
      );
    }

    if (trigger instanceof WebhookTrigger) {
      this.log.info(`activated webhook trigger for workflow ${workflowId}`);
    } else if (trigger instanceof CronTrigger) {
      const { expression } = trigger.getSchedule(config.trigger.config);
      await this.scheduler.schedule(
        workflowId,
        expression,
        this.defaultCronTimezone,
      );
      this.log.info(
        `activated cron trigger for workflow ${workflowId}: ${expression} (${this.defaultCronTimezone})`,
      );
    }
    // EventTrigger and ManualTrigger require no activation
  }

  /**
   * Deactivate a workflow's trigger.
   */
  async deactivateWorkflow(
    ctx: TCtx,
    workflowId: string,
    opts?: MutationOptions,
  ): Promise<void> {
    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    await this.require(ctx, 'workflow:activate', this.workflowRef(workflow));

    const config = readWorkflowConfig(workflow.config);
    // Falls through rather than returning early on an unregistered trigger type:
    // the call still succeeded, and every successful call must leave by the same
    // door so that none of them can quietly skip the notification below.
    const trigger = this.connectors.hasTrigger(config.trigger.type)
      ? this.connectors.getTrigger(config.trigger.type)
      : null;

    if (trigger instanceof CronTrigger) {
      await this.scheduler.unschedule(workflowId);
      this.log.info(
        `deactivated cron trigger for workflow ${workflowId}`,
      );
    }
    // Webhook, event and manual triggers need no teardown: webhook ingest and
    // event dispatch only reach ACTIVE workflows, so the status below stops them.
    await this.persistence.updateWorkflow(workflowId, { status: 'DISABLED' });

    this.publishWorkflowChange(workflowId, 'deactivated', opts?.origin);
  }

  // ─── Workflow callback secret ───

  // ─── Trigger Firing ───

  /**
   * Dispatch a domain event to every active workflow watching for it.
   *
   * Each candidate goes through the same admission as any other entry path —
   * `accepts`, then {@link admit} — so an event workflow, a webhook workflow and
   * a manual run all decide the same way. Hydration is shared across candidates:
   * fifty workflows on one ticket update cost one read, not fifty.
   *
   * Returns the execution IDs that were created.
   */
  async dispatchEvent(event: DispatchEventInput): Promise<string[]> {
    const workflows = await this.persistence.findActiveWorkflows(
      event.type,
      event.metadata,
    );
    const executionIds: string[] = [];
    const hydrations = new Map<string, HydrateResult>();

    const triggerEvent: TriggerEvent = {
      type: event.type,
      payload: event.payload,
      ...(event.occurredAt !== undefined ? { occurredAt: event.occurredAt } : {}),
    };

    for (const workflow of workflows) {
      const config = readWorkflowConfig(workflow.config);
      if (!this.connectors.hasTrigger(config.trigger.type)) continue;

      const trigger = this.connectors.getTrigger(config.trigger.type);
      if (!(trigger instanceof EventTrigger)) continue;

      const armed = await this.arm(workflow, config, triggerEvent, { hydrations });
      if (armed.kind === 'dropped') {
        this.log.info(
          `dispatchEvent: ${event.type} not admitted by workflow ${workflow.id} — ${armed.reason}`,
        );
        continue;
      }

      executionIds.push(armed.executionId);
    }

    return executionIds;
  }

  /**
   * Ingest a request to a workflow's webhook URL, `<baseUrl>/webhooks/<workflowId>`.
   *
   * The order is fixed, and the trigger's own code runs only after the sender is
   * authenticated:
   *
   * 1. The workflow exists, is ACTIVE and uses a webhook trigger — else 404, the
   *    same answer for each so workflow ids cannot be probed.
   * 2. The trigger's credentials resolve — else 401, before any connector code runs.
   * 3. The trigger's `handshake` may answer the request outright. It is the one
   *    connector hook that sees an unauthenticated request, so it can only reply,
   *    never start a run. A GET it does not answer gets 404: GET reaches nothing else.
   * 4. The trigger's own `verify` accepts the request — else 401.
   * 5. The body is parsed from the raw bytes — else 400.
   * 6. The trigger turns the request into events and a reply.
   * 7. Each event is admitted the same way every other entry path is — `accepts`,
   *    then hydration, then the trigger's own filter and the author's — or dropped.
   * 8. Survivors are enqueued before the reply is returned.
   *
   * Reasons for a rejection go to the log; responses stay generic.
   */
  async handleWebhook(
    workflowId: string,
    request: InboundHttpRequest,
  ): Promise<WebhookIngestResult> {
    const notFound: WebhookIngestResult = {
      reply: { status: 404, body: { error: 'Webhook not found' } },
      executionIds: [],
    };
    const unauthorized: WebhookIngestResult = {
      reply: { status: 401, body: { error: 'Unauthorized' } },
      executionIds: [],
    };

    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow || workflow.status !== 'ACTIVE') return notFound;
    const config = readWorkflowConfig(workflow.config);
    const trigger = this.connectors.findTrigger(config.trigger.type)?.trigger;
    if (!(trigger instanceof WebhookTrigger)) return notFound;

    const attributes = workflow.attributes as ResourceAttributes<'workflow'>;
    const triggerConfig = config.trigger.config;

    let ctx: TriggerExecutionContext;
    try {
      const credentials = await this.credentialResolver.resolve(attributes, trigger, triggerConfig);
      ctx = { credentials, attributes, baseUrl: this.baseUrl };
    } catch (err) {
      // Fail closed: verification never runs without the credentials it needs.
      this.log.warn(`webhook ${workflowId}: rejected, ${messageOf(err)}`);
      return unauthorized;
    }

    let handshakeReply: InboundReply | undefined;
    try {
      handshakeReply = await trigger.handshake(request, triggerConfig, ctx);
    } catch (err) {
      // A broken handshake must not block signed deliveries: carry on to verification.
      this.log.warn(`webhook ${workflowId}: handshake threw: ${messageOf(err)}`);
    }
    if (handshakeReply) return { reply: handshakeReply, executionIds: [] };
    if (request.method !== 'POST') return notFound;

    let verified = false;
    try {
      verified = await trigger.verify(request, triggerConfig, ctx);
    } catch (err) {
      this.log.warn(`webhook ${workflowId}: verification threw: ${messageOf(err)}`);
    }
    if (!verified) {
      this.log.warn(`webhook ${workflowId}: rejected by ${trigger.type} verification`);
      return unauthorized;
    }

    let body: unknown;
    try {
      body = parseInboundBody(request.rawBody, headerValue(request.headers, 'content-type'));
    } catch (err) {
      this.log.warn(`webhook ${workflowId}: rejected, ${messageOf(err)}`);
      return { reply: { status: 400, body: { error: 'Malformed request body' } }, executionIds: [] };
    }

    const translation = await trigger.handleRequest({ ...request, body }, triggerConfig, ctx);

    const executionIds: string[] = [];
    for (const event of translation.events) {
      const armed = await this.arm(workflow, config, event, { triggerCtx: ctx });
      if (armed.kind === 'dropped') {
        this.log.info(`webhook ${workflowId}: ${event.type} not admitted — ${armed.reason}`);
        continue;
      }
      executionIds.push(armed.executionId);
    }

    return {
      reply: translation.reply ?? { status: 200, body: { ok: true } },
      executionIds,
    };
  }

  /**
   * Fire a workflow manually via API.
   *
   * The `payload` is the full manual input — including any file fields, whose
   * values are {@link Attachment} refs (single or array) the caller obtained
   * from `POST /uploads`. It is validated against the trigger's `inputSchema`
   * (required fields present; attachment fields carry real refs satisfying
   * `accept`/`maxSize` and `minItems`/`maxItems`) and then merged into
   * `context.trigger` — so a field `pan` is reachable as `{{trigger.pan}}`.
   *
   * Returns the execution ID.
   */
  async triggerManual(
    ctx: TCtx,
    workflowId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    await this.require(ctx, 'workflow:run', this.workflowRef(workflow));

    if (workflow.status === WorkflowStatus.PENDING_APPROVAL) {
      throw new Error(
        `Cannot run workflow ${workflowId}: it is awaiting approval. ` +
          `Deactivate it to keep editing and testing, or wait for a decision.`,
      );
    }

    const config = readWorkflowConfig(workflow.config);
    const triggerCfg = (config.trigger.config ?? {}) as Record<string, unknown>;
    const inputSchema = triggerCfg['inputSchema'] as Record<string, unknown> | undefined;

    const { [RUN_IDENTIFIER_FIELD]: requestedRunIdentifier, ...triggerInput } = payload;

    const errors = validateTriggerPayload(inputSchema, triggerInput);
    if (errors.length > 0) {
      throw new Error(`Invalid trigger payload: ${errors.map((e) => e.message).join('; ')}`);
    }

    const armed = await this.arm(
      workflow,
      config,
      { type: config.trigger.type, payload: triggerInput },
      requestedRunIdentifier !== undefined ? { requestedRunIdentifier } : undefined,
    );
    if (armed.kind === 'dropped') {
      throw new Error(`Workflow did not accept this run: ${armed.reason}`);
    }

    return armed.executionId;
  }

  /**
   * Start a workflow from the API trigger route.
   *
   * No caller reaches the SDK here: the route has no session, and the SDK does
   * not authorize whoever calls it. A host that exposes the route guards it
   * itself, for example with an API key. The workflow must use an API trigger,
   * and the payload must satisfy its input schema.
   *
   * Runs are marked as public triggers, so privileged steps refuse them.
   */
  async triggerViaApi(
    workflowId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const { workflow, config } = await this.apiTriggerWorkflow(workflowId);

    const inputSchema = inputSchemaOf(config);
    // Uploaded documents are optional on this route even when the schema lists
    // them as required.
    const apiInputSchema =
      inputSchema && Array.isArray(inputSchema['required'])
        ? {
            ...inputSchema,
            required: inputSchema['required'].filter((field) => field !== 'documents'),
          }
        : inputSchema;
    const errors = validateTriggerPayload(apiInputSchema, payload);
    if (errors.length > 0) {
      throw new Error(`Invalid trigger payload: ${errors.map((e) => e.message).join('; ')}`);
    }

    const armed = await this.arm(workflow, config, { type: config.trigger.type, payload });
    if (armed.kind === 'dropped') {
      throw new Error(`Workflow did not accept this run: ${armed.reason}`);
    }

    return armed.executionId;
  }

  /**
   * What the API trigger route needs before it builds a payload: the trigger's
   * input schema, and the workflow's scope for storing uploaded files. Checked
   * the same way as {@link triggerViaApi}.
   */
  async getApiTriggerTarget(
    workflowId: string,
  ): Promise<{
    inputSchema: Record<string, unknown> | undefined;
    storageScope: ResourceAttributes<'workflow'>;
  }> {
    const { workflow, config } = await this.apiTriggerWorkflow(workflowId);
    return {
      inputSchema: inputSchemaOf(config),
      storageScope: workflow.attributes as ResourceAttributes<'workflow'>,
    };
  }

  /** The workflow exists and uses an API trigger. */
  private async apiTriggerWorkflow(
    workflowId: string,
  ): Promise<{ workflow: WorkflowRecord; config: WorkflowConfig }> {
    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow) throw new ResourceNotFoundError('Workflow', workflowId);

    const config = readWorkflowConfig(workflow.config);
    const trigger = this.connectors.findTrigger(config.trigger.type)?.trigger;
    if (!(trigger instanceof ApiTrigger)) {
      throw new Error(`Workflow ${workflowId} does not use an API trigger`);
    }
    return { workflow, config };
  }

  /**
   * Return the configured trigger input schema for routes that need to translate
   * transport-level payloads before calling `triggerManual()`.
   */
  async getWorkflowTriggerInputSchema(
    ctx: TCtx,
    workflowId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    await this.require(ctx, 'workflow:run', this.workflowRef(workflow));

    return inputSchemaOf(readWorkflowConfig(workflow.config));
  }

  /**
   * Resume a paused execution. Guards `execution:approve` against the GATE being
   * answered, falling back to the run when no single gate can be named.
   *
   * Why the gate and not the run: whoever may answer a gate is a question about
   * that gate — a step's assignee holds one gate without holding the workflow,
   * so asking "may you approve this run?" denies exactly the person the gate was
   * addressed to. The ref has to name the gate for the authorizer to have
   * anything to decide on.
   *
   * Resolution happens BEFORE the guard, because a gate you have not identified
   * cannot be authorized. One consequence worth knowing: on a run with several
   * gates open and no `nodePath`, the caller now meets `resumeInternal`'s
   * "specify nodePath" before any 403 — the gate must be named before anyone can
   * be judged.
   */
  async resume(ctx: TCtx, executionId: string, input?: ResumeInput): Promise<void> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) throw new ResourceNotFoundError('Execution', executionId);

    // Covers abort too: Reject arrives as `{ abort: true, nodePath }` with no
    // `data`, and it is still an answer to a gate — so it is authorized as one.
    const gate = await this.resolveGateForAuth(executionId, input);
    // Only needed to reach `folderId` for the ref; skip the read when there is
    // no gate to describe.
    const workflow = gate ? await this.persistence.getWorkflow(exec.workflowId) : null;

    const ref =
      gate && workflow
        ? this.approvalStepRef(gate, executionId, workflow)
        : this.executionRef(exec);

    await this.require(ctx, 'execution:approve', ref);
    return this.resumeInternal(executionId, input);
  }

  /**
   * Best-effort: which open gate is this resume addressed to?
   *
   * For AUTHORIZATION only — it answers "which gate" so the guard can ask about
   * that gate rather than about the whole run. An assignee holds a gate, not a
   * run, so authorizing the run is the wrong question for them.
   *
   * Two deliberate differences from the strict resolution inside
   * {@link resumeInternal}, which stays exactly where it is:
   *
   *  - **Non-throwing.** An abort today succeeds on a run with several open
   *    gates, because it short-circuits before any gate is resolved. A resolver
   *    that threw on ambiguity would start failing it. Unresolvable ⇒ `null` ⇒
   *    the caller authorizes the execution, precisely as before.
   *  - **Not keyed off `input.data`.** Reject arrives as `{ abort: true,
   *    nodePath }` with no `data` at all, so a resolver that waited for a
   *    payload would never run for the action most likely to be an assignee's.
   *
   * The gate test is applied uniformly, including when a `nodePath` names the
   * record explicitly — stricter than {@link resumeInternal}, which checks only
   * the status there. A parked control marker is not a gate, and refusing to
   * build a gate ref for one can only fall back to the execution ref, i.e. it
   * errs tighter, never looser.
   */
  private async resolveGateForAuth(
    executionId: string,
    input?: ResumeInput,
  ): Promise<StepRecord | null> {
    const isOpenGate = (row: StepRecord): boolean =>
      (row.status === 'EXTERNAL_WAIT' || row.status === 'REVIEW_WAIT') &&
      row.executorType !== 'conditional';

    if (input?.nodePath) {
      const row = await this.persistence.getStep(executionId, input.nodePath);
      return row && isOpenGate(row) ? row : null;
    }

    const gates = (await this.persistence.getStepRows(executionId)).filter(isOpenGate);
    // Exactly one gate, or nothing we can name: an ambiguous run falls back to
    // the execution ref, and `resumeInternal` still raises its own
    // "specify nodePath to resume one" for the data path.
    return gates.length === 1 ? (gates[0] ?? null) : null;
  }

  /**
   * The resume work, already authorized. Private, and {@link resume} is its only
   * caller — so every answer that reaches here has been judged against the gate
   * it is answering.
   *
   * The system path is NOT here: an external system reporting a result goes
   * through {@link deliver}, which carries no principal and is authorized by the
   * host's own middleware. Nothing enters this method unauthenticated.
   *
   * Deliberately still resolves the target gate itself rather than taking the
   * row {@link resume} already found. The resolution here is the STRICT one — it
   * raises "no open gate at …", "multiple open gates", "already has an answer
   * waiting" — while the resolver feeding authorization is lenient by design.
   * Two sources of truth for "which gate" is worth less than one extra indexed
   * read on a button press.
   */
  private async resumeInternal(executionId: string, input?: ResumeInput): Promise<void> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) {
      throw new Error(`Execution ${executionId} not found`);
    }
    if (exec.status !== 'EXTERNAL_WAIT') {
      throw new Error(
        `Execution ${executionId} is not paused (status: ${exec.status})`,
      );
    }

    // Read once: the step write below needs its attributes, and the enqueue at
    // the end needs its kind to pick a lane.
    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${exec.workflowId} not found for execution ${executionId}`);
    }

    // Unified abort: either the explicit `abort` flag OR `data.action === 'abort'`.
    //
    // NOTE — this cancels the WHOLE run, and that is the second door to
    // CANCELLED. The two doors are guarded differently, on purpose:
    //
    //   "Cancel run"        → `execution:cancel` on the `execution` ref
    //   "Reject" at a gate  → `execution:approve` on the `approvalStep` ref
    //
    // So a host may deny a gate's assignee the power to cancel a run while
    // still letting them Reject at their own gate — which ends the run anyway.
    // That asymmetry is a deliberate trade, not an oversight: Reject is one of
    // the two default pause actions, so routing it to the execution ref would
    // 403 for every assignee and leave half the panel dead. Do not "fix" one
    // side of it in isolation.
    //
    // The real fix is for a gate-scoped reject to resume THAT gate with a
    // rejection and let the workflow branch on it, rather than cancelling the
    // run. That is a change to this block alone — authorization already names
    // the gate, so it needs nothing from the authorizer.
    const isAbort = input?.abort === true || input?.data?.action === 'abort';
    if (isAbort) {
      await this.persistence.updateExecutionStatus(executionId, 'CANCELLED');
      this.publishEvent(executionId, { event: 'execution_cancelled', data: {} });
      this.log.info(`execution ${executionId} aborted by user`);
      return;
    }

    if (input?.data) {
      // Route the payload to the target gate's own record — the walk reads
      // `resumePayload` off that node on the next pass. Two concurrent gates =
      // two records, each resumed independently by node-path.
      let targetRow: StepRecord | null = null;
      if (input.nodePath) {
        targetRow = await this.persistence.getStep(executionId, input.nodePath);
        if (
          !targetRow ||
          (targetRow.status !== 'EXTERNAL_WAIT' && targetRow.status !== 'REVIEW_WAIT')
        ) {
          throw new Error(
            `No open gate at "${input.nodePath}" for execution ${executionId}`,
          );
        }
      } else {
        // No explicit target — resolve the sole open gate. A "gate" is a
        // non-control parked record (control steps get marker records too).
        const gates = (await this.persistence.getStepRows(executionId)).filter(
          (r) =>
            (r.status === 'EXTERNAL_WAIT' || r.status === 'REVIEW_WAIT') &&
            r.executorType !== 'conditional',
        );
        if (gates.length > 1) {
          throw new Error(
            `Execution ${executionId} has multiple open gates — specify nodePath to resume one`,
          );
        }
        targetRow = gates[0] ?? null;
      }

      if (targetRow) {
        const data = targetRow.data
          ? (JSON.parse(targetRow.data) as Record<string, unknown>)
          : {};
        // A gate takes one answer. Until the walk applies it (and marks the gate
        // COMPLETED), a second resume would silently replace the first.
        if (data['resumePayload'] !== undefined) {
          throw new Error(
            `Gate "${targetRow.stepName}" of execution ${executionId} already has an answer waiting to be applied`,
          );
        }
        data['resumePayload'] = input.data;
        await this.persistence.upsertStep(executionId, targetRow.stepName, {
          status: targetRow.status,
          executorType: targetRow.executorType,
          data: JSON.stringify(data),
          attributes: workflow.attributes as ResourceAttributes<'workflow'>,
        });
      } else {
        // Addressing is per node now, so there is nowhere for an answer with no
        // gate to go. Say so rather than park it in a slot that may later be
        // applied to whichever gate happens to be the only one open.
        throw new Error(`Execution ${executionId} has no open gate to resume`);
      }
    }

    // Keep status as EXTERNAL_WAIT — the executor detects this as a resume and
    // reconciles from the node records. singletonKey=executionId serializes
    // passes per execution (single-writer) on hosts that support it.
    await this.enqueuePass({ executionId, singletonKey: executionId }, workflow);
    this.log.info(`execution ${executionId} resume enqueued`);
  }

  /**
   * Apply what an external system reported to the node that is waiting for it.
   *
   * The counterpart of {@link handleWebhook} for a run already under way: the
   * host authenticates the caller however it likes, mounts whatever route it
   * likes, and calls this. The SDK names no URL and checks no credential — what
   * it owns is finding the gate, refusing a stale or repeated answer, and
   * checking the body against the contract the author declared.
   *
   * No caller to authorize, by construction: a delivery carries no principal,
   * so the host's middleware is the authorization and this is the system path.
   * Answers with a {@link DeliveryOutcome} rather than throwing, because the
   * sender has to decide from it whether to retry, stop, or fix its body.
   */
  async deliver(address: Address, delivery: Delivery): Promise<DeliveryOutcome> {
    // The host streamed any files into storage while parsing the request, so
    // they exist before this method can judge them. Anything but `applied`
    // therefore hands them back — in one place, because there are six ways to
    // decline and forgetting one leaks a blob per occurrence.
    const outcome = await this.decideDelivery(address, delivery);
    if (outcome.kind !== 'applied') await this.discardDelivered(address, delivery);
    return outcome;
  }

  /**
   * Give back the files of a delivery that was not applied.
   *
   * The run's scope is looked up here rather than threaded out of the decision,
   * because this only runs when there are files to reclaim — a declined
   * delivery that carried none returns before asking, so the ordinary path
   * costs nothing. When the run cannot be found there is no scope to pass, and
   * the adapter falls back to validating the key alone, which is the right
   * answer: nobody can say whose it was.
   *
   * Best-effort by contract: a storage failure here must not turn a clean
   * `invalid` into a server error. A host that wants certainty sweeps for
   * objects no run references.
   */
  private async discardDelivered(address: Address, delivery: Delivery): Promise<void> {
    const files = delivery.files;
    if (!this.storage || !files || files.length === 0) return;
    const storage = this.storage;
    const scope = await this.scopeOfExecution(address.executionId);
    await Promise.all(
      files.map((f) =>
        storage.delete(f.attachment, scope).catch((err: unknown) => {
          this.log.warn(
            `could not discard ${f.attachment.name} after a declined delivery: ${String(err)}`,
          );
        }),
      ),
    );
  }

  /** The tenant a run acts as, or undefined when the run is unknown. */
  private async scopeOfExecution(executionId: string): Promise<StorageScope | undefined> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) return undefined;
    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    return workflow?.attributes as StorageScope | undefined;
  }

  private async decideDelivery(address: Address, delivery: Delivery): Promise<DeliveryOutcome> {
    const exec = await this.persistence.getExecution(address.executionId);
    if (!exec) return { kind: 'unknown' };
    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    if (!workflow) return { kind: 'unknown' };

    const rows = await this.persistence.getStepRows(address.executionId);
    const known = collectStepIds(readWorkflowConfig(workflow.config));
    const resolved = resolveGate(address, exec.status, rows, known);
    if (resolved.kind === 'outcome') return resolved.outcome;

    const row = resolved.row;
    const data = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : {};

    // A gate that re-parks keeps the attempt it is on; an answer to the one
    // before would otherwise be applied as if it were current.
    const fence = data['fence'];
    if (address.fence !== undefined && fence !== undefined && fence !== address.fence) {
      return { kind: 'ignored', reason: 'superseded' };
    }

    // A gate takes one answer. The same delivery arriving twice is the sender
    // retrying; a different one is a second answer, and neither replaces the
    // first.
    const already = data['delivery'] as { deliveryId?: string } | undefined;
    if (already !== undefined || data['resumePayload'] !== undefined) {
      const repeat =
        delivery.deliveryId !== undefined && already?.deliveryId === delivery.deliveryId;
      return { kind: 'ignored', reason: repeat ? 'duplicate' : 'already_answered' };
    }

    // References merge straight in — there are no bytes here to move. A text
    // field is re-read against the contract first, because multipart delivers
    // every field as a string whatever the contract says it is.
    const contract = data['contract'] as Record<string, unknown> | undefined;
    const coerced =
      delivery.encoding === 'multipart'
        ? coerceTextFields(delivery.payload, contract)
        : delivery.payload;
    const payload = attachDeliveryFiles(coerced, delivery.files ?? [], contract);

    const issues = checkAgainstContract(contract, payload);
    if (issues.length > 0) return { kind: 'invalid', issues };

    data['delivery'] = {
      payload,
      receivedAt: new Date().toISOString(),
      ...(delivery.deliveryId !== undefined ? { deliveryId: delivery.deliveryId } : {}),
    };
    await this.persistence.upsertStep(address.executionId, row.stepName, {
      status: row.status,
      executorType: row.executorType,
      data: JSON.stringify(data),
      attributes: workflow.attributes as ResourceAttributes<'workflow'>,
      ...(row.category !== undefined ? { category: row.category } : {}),
    });
    await this.enqueuePass({ executionId: address.executionId, singletonKey: address.executionId }, workflow);
    this.log.info(`delivery applied to ${address.executionId} at ${row.stepName}`);
    return { kind: 'applied', nodePath: row.stepName };
  }

  /**
   * Rerun a workflow from a specific step, using the source execution's
   * cached outputs for all prior steps. Creates a new execution.
   *
   * Used for:
   * - "Rerun from step N" — replay downstream with same upstream data
   * - "Modify input and rerun" — pass `configOverrides` to change the
   *   entry step's input
   * - Agent feedback after execution completed — pass `configOverrides`
   *   with new `userMessage`; agent receives `priorState.messages` and
   *   continues the conversation
   *
   * Returns the new execution ID.
   */
  async rerunFromStep(
    ctx: TCtx,
    sourceExecutionId: string,
    fromStepId: string,
    options?: {
      configOverrides?: Record<string, unknown>;
      inheritStepState?: boolean;
    },
  ): Promise<string> {
    const source = await this.persistence.getExecution(sourceExecutionId);
    if (!source) throw new Error(`Execution ${sourceExecutionId} not found`);
    await this.require(ctx, 'execution:rerun', this.executionRef(source));
    const newExecutionId = await this.executor.rerunFromStep(
      sourceExecutionId,
      fromStepId,
      options,
    );
    // The rerun is a run of the same workflow, so it belongs in the same lane.
    await this.enqueuePass(
      { executionId: newExecutionId },
      await this.persistence.getWorkflow(source.workflowId),
    );
    return newExecutionId;
  }

  // ─── CRUD (used by router) ───

  /**
   * List the workflows visible to `ctx`. The host's filter is pushed *into*
   * the adapter's query — the SDK never enumerates ids to post-filter.
   */
  async listWorkflows(
    ctx: TCtx,
    page?: { folderId?: string; limit?: number; cursor?: string },
  ): Promise<Paged<WorkflowRecord>> {
    const filter = await this.filterFor(ctx, 'workflow');
    const result = await this.persistence.listWorkflows(filter, {
      ...resolvePage(page),
      ...(page?.folderId !== undefined ? { folderId: page.folderId } : {}),
    });
    const items = await this.project(ctx, result.items, (wf) => this.workflowRef(wf));
    return {
      items,
      ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
    };
  }

  async listPendingWorkflows(
    ctx: TCtx,
    params?: { limit?: number; cursor?: string },
  ): Promise<{ items: PendingWorkflowSummary[]; nextCursor?: string }> {
    const filter = await this.filterFor(ctx, 'workflow');
    const page = await this.persistence.listPendingWorkflows(filter, resolvePage(params));
    const rows = await this.project(ctx, page.items, (wf) => this.workflowRef(wf));

    const items = rows.map((wf) => {
      const config = readWorkflowConfig(wf.config);
      const name = parseWorkflowName(wf.metadata);
      return {
        workflowId: wf.id,
        // Spread-when-present, like every other optional the SDK returns: a
        // consumer tests presence rather than comparing against a placeholder.
        ...(name !== undefined ? { name } : {}),
        folderId: wf.folderId,
        triggerType: config.trigger.type,
        gatedBy: this.gateFor(config).gatedBy,
        submittedAt: wf.updatedAt,
        ...(wf.permittedActions !== undefined
          ? { permittedActions: wf.permittedActions }
          : {}),
      };
    });

    return page.nextCursor === undefined
      ? { items }
      : { items, nextCursor: page.nextCursor };
  }

  /** Workflow counts for the visible set — total + per-folder, for the folder rail. */
  async workflowCounts(
    ctx: TCtx,
  ): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }> {
    return this.persistence.countWorkflowsByFolder(await this.filterFor(ctx, 'workflow'));
  }

  /**
   * Get a single workflow by ID. Guards `workflow:read` and attaches the
   * caller's `permittedActions` for the UI.
   */
  async getWorkflow(
    ctx: TCtx,
    workflowId: string,
  ): Promise<WorkflowRecord & { permittedActions: readonly Action[] }> {
    const { record, permittedActions } = await this.authorizedWorkflow(
      ctx, workflowId, 'workflow:read',
    );
    return { ...record, permittedActions };
  }

  /**
   * Create a new workflow definition.
   *
   * Validates the config, persists it, and optionally activates the trigger.
   * Returns the created WorkflowRecord.
   */
  async createWorkflow(
    ctx: TCtx,
    input: {
      name: string;
      config: WorkflowConfig;
      metadata?: Record<string, unknown>;
      summary?: string | null;
      /** Folder this workflow belongs to — required (no ungrouped state). */
      folderId: string;
      /** Product-defined scoping attributes (typed via {@link Register}). */
      attributes?: ResourceAttributes<'workflow'>;
    },
    opts?: MutationOptions,
  ): Promise<WorkflowRecord> {
    // Create is an action on the *container*: the folder is the thing that
    // exists, so this same decision is what the UI projects onto its "New
    // workflow" button. Also proves the folder exists — no separate lookup.
    await this.authorizedFolder(ctx, input.folderId, 'workflow:create');

    const validation = new ConfigValidator(this.connectors).validate(input.config);

    // Create goes live here, so it is an activation and has to face the same
    // gate — otherwise "build it fresh" is the way around every other check.
    const gate = this.gateFor(input.config);

    const metadata = { ...input.metadata, name: input.name };
    const id = await this.persistence.createWorkflow({
      // A gated configuration lands awaiting review. The promotion below is
      // what lets someone who may approve create one live, and it has to come
      // after the insert: the authorizer decides about a workflow, and until
      // the row exists there is no workflow to decide about.
      status: gate.required ? WorkflowStatus.PENDING_APPROVAL : WorkflowStatus.ACTIVE,
      config: JSON.stringify(input.config),
      metadata: JSON.stringify(metadata),
      eventType: input.config.trigger.type,
      summary: input.summary ?? null,
      folderId: input.folderId,
      attributes: input.attributes,
    });

    let record = await this.persistence.getWorkflow(id);
    if (!record) throw new Error('Failed to read created workflow');

    let live = !gate.required;
    if (gate.required) {
      const permitted = await this.authorizer.permissions(ctx, this.workflowRef(record));
      if (permitted.includes('workflow:approve')) {
        await this.persistence.updateWorkflow(id, { status: WorkflowStatus.ACTIVE });
        record = (await this.persistence.getWorkflow(id)) ?? record;
        live = true;
      } else {
        this.log.info(
          `created workflow ${id} awaiting approval — gated by ${gate.gatedBy.join(', ')}`,
        );
      }
    }

    if (live && validation.valid) {
      try {
        // Internal post-create activation — already authorized by the create above.
        await this.activateInternal(ctx, record);
      } catch (err) {
        // Non-fatal — the workflow is created, and its trigger can be activated
        // once whatever failed is fixed.
        this.log.warn(`created workflow ${id} but could not activate its trigger: ${messageOf(err)}`);
      }
    }

    this.log.info(`created workflow ${id} (${input.name})`);
    // One event, not also an `activated` one from the self-activation above: a
    // subscriber re-reads and sees the settled state either way, and two frames
    // for one call would just cost it a second read.
    this.publishWorkflowChange(id, 'created', opts?.origin);
    return record;
  }

  /**
   * Update an existing workflow definition.
   *
   * Accepts partial updates: config, metadata, or both.
   * If config changes, validates it and updates the trigger type.
   */
  async updateWorkflow(
    ctx: TCtx,
    workflowId: string,
    input: {
      name?: string;
      config?: WorkflowConfig;
      metadata?: Record<string, unknown>;
      summary?: string | null;
      /** Move the workflow to another (existing) folder. */
      folderId?: string;
    },
    opts?: MutationOptions,
  ): Promise<WorkflowRecord> {
    const { record: existing } = await this.authorizedWorkflow(ctx, workflowId, 'workflow:update');

    const update: {
      config?: string;
      metadata?: string;
      eventType?: string;
      summary?: string | null;
      folderId?: string;
      status?: string;
    } = {};
    if (input.summary !== undefined) update.summary = input.summary;

    // Move to another folder — needs `workflow:create` on the destination, the
    // same decision that gates creating one there. `authorizedFolder` also
    // proves the folder exists.
    if (input.folderId !== undefined && input.folderId !== existing.folderId) {
      await this.authorizedFolder(ctx, input.folderId, 'workflow:create');
      update.folderId = input.folderId;
    }

    // Update config if provided.
    // NOTE: validation is intentionally NOT enforced on save — drafts with
    // unresolved variable refs / incomplete steps can be saved as work-in-
    // progress. (Validation still runs at activate/run time.)
    if (input.config) {
      update.config = JSON.stringify(input.config);
      update.eventType = input.config.trigger.type;

      // An ACTIVE workflow was approved as it stands, so editing it in place
      // would put something unreviewed live — and it is the obvious way round
      // the gate: ship something harmless, then edit the rest in. Refusing is
      // also why a maker cannot take production down by accident: stopping it
      // stays a separate, deliberate act.
      //
      // Only when the NEW configuration is gated. An edit that removes the
      // gated component, or never had one, is not what this protects — and
      // under a policy that gates nothing, none of this ever fires.
      const gate = this.gateFor(input.config);
      if (gate.required && existing.status === WorkflowStatus.ACTIVE) {
        throw new Error(
          `Cannot edit workflow ${workflowId} while it is active: the new configuration ` +
            `needs approval (${gate.gatedBy.join(', ')}). Deactivate it first.`,
        );
      }
      // Editing withdraws a submission and clears a rejection — whatever a
      // reviewer saw or declined is no longer what is on the table.
      if (
        existing.status === WorkflowStatus.PENDING_APPROVAL ||
        existing.status === WorkflowStatus.REJECTED
      ) {
        update.status = WorkflowStatus.DRAFT;
      }
    }

    // Update metadata if name or metadata provided
    if (input.name !== undefined || input.metadata !== undefined) {
      const existingMeta = JSON.parse(existing.metadata ?? '{}') as Record<string, unknown>;
      if (input.metadata) Object.assign(existingMeta, input.metadata);
      if (input.name !== undefined) existingMeta['name'] = input.name;
      update.metadata = JSON.stringify(existingMeta);
    }

    await this.persistence.updateWorkflow(workflowId, update);

    const updated = await this.persistence.getWorkflow(workflowId);
    if (!updated) throw new Error('Failed to read updated workflow');

    this.log.info(`updated workflow ${workflowId}`);
    this.publishWorkflowChange(workflowId, 'updated', opts?.origin);
    return updated;
  }

  // ─── Folders ───

  /** List folders the caller may see, one page at a time. */
  async listFolders(
    ctx: TCtx,
    page?: { limit?: number; cursor?: string },
  ): Promise<Paged<FolderRecord>> {
    const result = await this.persistence.listFolders(
      await this.filterFor(ctx, 'folder'),
      resolvePage(page),
    );
    const items = await this.project(ctx, result.items, (f) => this.folderRef(f));
    return {
      items,
      ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
    };
  }

  /**
   * Get a single folder by id. Guards `folder:read` and attaches the caller's
   * `permittedActions` — which include the container actions
   * (`workflow:create` / `folder:create`), so the UI gates this folder's "New…"
   * menu off the same decision the runtime will enforce.
   */
  async getFolder(
    ctx: TCtx,
    folderId: string,
  ): Promise<FolderRecord & { permittedActions: readonly Action[] }> {
    const { record, permittedActions } = await this.authorizedFolder(ctx, folderId, 'folder:read');
    return { ...record, permittedActions };
  }

  /**
   * What may the caller do at the top level — create a root folder, manage
   * credentials? Container actions on a resource that has no instance, so the
   * client can gate its top-level "New…" buttons without inventing a resource.
   */
  async capabilities(ctx: TCtx): Promise<readonly Action[]> {
    return this.authorizer.permissions(ctx, { type: 'root' });
  }

  /** Create a folder for organizing workflows. */
  async createFolder(
    ctx: TCtx,
    input: {
      name: string;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      /** Product-defined scoping attributes (typed via {@link Register}). */
      attributes?: ResourceAttributes<'folder'>;
    },
  ): Promise<FolderRecord> {
    // Create is an action on the container: a nested folder is gated by its
    // parent, a top-level folder by `root`. Both are things the client can ask
    // about before rendering "New folder".
    await this.require(ctx, 'folder:create', await this.containerRef(input.parentId));
    const name = input.name.trim();
    if (!name) throw new Error('Folder name is required');
    const id = await this.persistence.createFolder({
      name,
      metadata: JSON.stringify(input.metadata ?? {}),
      parentId: input.parentId ?? null,
      attributes: input.attributes,
    });
    const created = await this.persistence.getFolder(id);
    if (!created) throw new Error('Failed to read created folder');
    return created;
  }

  /** Reorganize folders and workflows in one batch (drag-and-drop). */
  async moveBatch(
    ctx: TCtx,
    input: {
      folders: Array<{ id: string; parentId: string | null }>;
      workflows: Array<{ id: string; folderId: string }>;
    },
    opts?: MutationOptions,
  ): Promise<void> {
    // Each item is authorized individually by the op it delegates to, which
    // guards both ends of the move: `*:update` on the thing moved and
    // `*:create` on the destination container.
    await Promise.all([
      ...input.folders.map((f) => this.updateFolder(ctx, f.id, { parentId: f.parentId })),
      ...input.workflows.map((w) =>
        this.updateWorkflow(ctx, w.id, { folderId: w.folderId }, opts),
      ),
    ]);
  }

  async updateFolder(
    ctx: TCtx,
    id: string,
    input: { name?: string; parentId?: string | null },
  ): Promise<void> {
    await this.authorizedFolder(ctx, id, 'folder:update');
    if (input.name !== undefined && !input.name.trim()) {
      throw new Error('Folder name cannot be empty');
    }
    const data: { name?: string; parentId?: string | null } = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if ('parentId' in input) {
      const newParent = input.parentId ?? null;
      // Reparenting adds a child to the destination, so it needs the same
      // permission as creating one there — otherwise `folder:create` gates the
      // "New folder" button and a drag-and-drop walks straight around it.
      await this.require(ctx, 'folder:create', await this.containerRef(newParent));
      // Moving a folder into itself or any of its own descendants creates a
      // cycle — the folder would disappear from all reachable tree paths.
      if (newParent !== null) {
        const allFolders = await this.persistence.listAllFolders();
        const descendants = new Set<string>([id]);
        const queue = [id];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          for (const f of allFolders) {
            if (f.parentId === cur && !descendants.has(f.id)) {
              descendants.add(f.id);
              queue.push(f.id);
            }
          }
        }
        if (descendants.has(newParent)) {
          throw new Error('Cannot move a folder into itself or one of its descendants');
        }
      }
      data.parentId = newParent;
    }
    await this.persistence.updateFolder(id, data);
  }

  /**
   * Delete a folder. Blocked while it still holds workflows — every workflow
   * must belong to a folder, so callers must move/remove its members first.
   */
  async deleteFolder(ctx: TCtx, id: string): Promise<void> {
    await this.authorizedFolder(ctx, id, 'folder:delete');
    // Unfiltered on purpose: emptiness is a property of the folder, not of what
    // this caller can see. Counting only visible workflows would let someone
    // delete a folder out from under workflows they have no access to.
    if ((await this.persistence.countWorkflowsInFolder(id)) > 0) {
      throw new Error('Folder not empty');
    }
    await this.persistence.deleteFolder(id);
  }

  /**
   * Top N recurring error messages across failed executions in a time window.
   */
  async getTopErrors(
    ctx: TCtx,
    params: { since?: Date; limit?: number; folderId?: string },
  ): Promise<Array<{ message: string; count: number; runs: Array<{ id: string; workflowId: string }> }>> {
    if (typeof this.persistence.getTopErrors !== 'function') return [];
    // Derived from executions, so it carries the same visibility as them.
    return this.persistence.getTopErrors(await this.filterFor(ctx, 'workflow'), params);
  }

  /**
   * Full analytics summary computed server-side — replaces fetching all executions on the client.
   */
  async getAnalyticsSummary(ctx: TCtx, params: { since: Date; rangeDays: number; folderId?: string }) {
    const empty = {
      totalRuns: 0,
      successRate: 0,
      byStatus: {},
      runsByDay: [],
      byWorkflow: [],
      recentFailures: [],
      activeWorkflows: 0,
      totalWorkflows: 0,
    };
    if (typeof this.persistence.getAnalyticsSummary !== 'function') return empty;
    // Analytics is derived from workflows — scope it to the caller's visible
    // workflows via the authorizer, exactly like listExecutions.
    return this.persistence.getAnalyticsSummary(await this.filterFor(ctx, 'workflow'), params);
  }

  /** On-time vs late for approvals decided since `since` — the Home dashboard's ring. */
  async getApprovalAnalytics(ctx: TCtx, params: { since: Date }) {
    if (typeof this.persistence.getApprovalAnalytics !== 'function') return { onTime: 0, late: 0 };
    return this.persistence.getApprovalAnalytics(await this.filterFor(ctx, 'workflow'), params);
  }

  /**
   * Per-step progress events (agent thinking / tool calls / logs) for the run
   * view's activity timeline. Delegates to persistence.
   */
  async getStepEvents(
    ctx: TCtx,
    executionId: string,
    stepName: string,
    after?: Date,
  ): Promise<Array<{ id: string; type: string; data: string; createdAt: Date }>> {
    const exec = await this.persistence.getExecution(executionId);
    if (exec) await this.require(ctx, 'execution:read', this.executionRef(exec));
    return this.persistence.getStepEvents(executionId, stepName, after);
  }

  /**
   * List executions with optional filters and cursor pagination. Scoped to the
   * caller's visible workflows (an execution is visible iff its workflow is).
   */
  async listExecutions(
    ctx: TCtx,
    params: {
      workflowId?: string;
      status?: string;
      limit?: number;
      cursor?: string;
      folderId?: string;
    },
  ): Promise<Paged<ExecutionRecord>> {
    // Executions inherit their workflow's visibility — the adapter joins the
    // workflow filter rather than us enumerating workflow ids first.
    return this.persistence.listExecutions(await this.filterFor(ctx, 'workflow'), {
      ...resolvePage(params),
      ...(params.workflowId !== undefined ? { workflowId: params.workflowId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.folderId !== undefined ? { folderId: params.folderId } : {}),
    });
  }

  /**
   * One page of the approvals inbox — a pass-through to the adapter, which
   * answers it in a single joined query.
   */
  async listPendingApprovals(
    ctx: TCtx,
    params?: Omit<PendingApprovalQuery, 'limit'> & { limit?: number },
  ): Promise<Paged<PendingApprovalRow>> {
    // Visible-workflow scoped: any caller who can see the workflow sees its
    // pending gates. Narrowing this to the step's assignee is P3, and lands as
    // `visibleFilter(ctx, 'approval')` — this stays the workflow filter until
    // approval steps actually carry an assignee.
    return this.persistence.listPendingApprovals(await this.filterFor(ctx, 'workflow'), {
      ...resolvePage(params),
      ...(params?.workflowIds !== undefined ? { workflowIds: params.workflowIds } : {}),
      ...(params?.stages !== undefined ? { stages: params.stages } : {}),
      ...(params?.tags !== undefined ? { tags: params.tags } : {}),
      ...(params?.search !== undefined ? { search: params.search } : {}),
      ...(params?.sort !== undefined ? { sort: params.sort } : {}),
      ...(params?.bucket !== undefined ? { bucket: params.bucket } : {}),
      ...(params?.dayEnd !== undefined ? { dayEnd: params.dayEnd } : {}),
    });
  }

  /** How many runs are waiting on a gate this caller can see. */
  async countPendingApprovals(
    ctx: TCtx,
    params?: PendingApprovalCountQuery,
  ): Promise<number> {
    return this.persistence.countPendingApprovals(
      await this.filterFor(ctx, 'workflow'),
      params,
    );
  }

  /**
   * Filter facets for the approvals inbox, over the whole visible set —
   * deliberately not derived from a page, which would offer fewer choices the
   * further someone pages.
   */
  async pendingApprovalFacets(ctx: TCtx): Promise<PendingApprovalFacets> {
    return this.persistence.pendingApprovalFacets(await this.filterFor(ctx, 'workflow'));
  }

  /** The latest run of each workflow in scope, as one grouped query. */
  async lastRunByWorkflow(
    ctx: TCtx,
    params: { folderId?: string; workflowIds?: readonly string[] } = {},
  ): Promise<Record<string, LastRun>> {
    return this.persistence.lastRunByWorkflow(await this.filterFor(ctx, 'workflow'), params);
  }

  /**
   * Get execution detail including step records.
   *
   * `opts.triggerData` reads the execution's context to pull the trigger payload
   * out of it, which is what a run page shows. It is on by default and a
   * conversation turns it off: a turn is read several times per exchange and
   * never looks at the trigger, so it would otherwise pay for the whole context
   * — the largest row of the four — on every look.
   */
  async getExecutionDetail(ctx: TCtx, executionId: string, opts: { triggerData?: boolean } = {}): Promise<{
    execution: ExecutionRecord;
    steps: StepRecord[];
    config?: WorkflowConfig;
    triggerData?: Record<string, unknown>;
    summary?: string | null;
    name?: string;
    permittedActions?: readonly Action[];
  } | null> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) return null;
    const perms = await this.require(ctx, 'execution:read', this.executionRef(exec));

    const stepRows = await this.persistence.getStepRows(executionId);

    // Try to attach the workflow config snapshot
    const result: {
      execution: ExecutionRecord;
      steps: StepRecord[];
      config?: WorkflowConfig;
      triggerData?: Record<string, unknown>;
      summary?: string | null;
      name?: string;
      permittedActions?: readonly Action[];
    } = { execution: exec, steps: stepRows, permittedActions: perms };

    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    if (workflow) {
      result.summary = workflow.summary;
      try {
        const meta = JSON.parse(workflow.metadata ?? '{}') as Record<string, unknown>;
        if (typeof meta['name'] === 'string') result.name = meta['name'];
      } catch { /* metadata optional */ }
    }
    if (workflow?.config) {
      try {
        result.config = JSON.parse(workflow.config) as WorkflowConfig;
      } catch {
        // config is optional — skip if corrupt
      }
    }

    // Extract trigger data from execution state context
    try {
      const state = opts.triggerData === false ? null : await this.persistence.getExecutionState(executionId);
      if (state?.context) {
        const wfCtx = JSON.parse(state.context) as WorkflowContext;
        if (wfCtx.trigger) {
          result.triggerData = wfCtx.trigger;
        }
      }
    } catch {
      // trigger data is optional — skip if missing or corrupt
    }

    return result;
  }

  /**
   * Cancel a running or paused execution.
   */
  async cancelExecution(ctx: TCtx, executionId: string): Promise<void> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) {
      throw new Error(`Execution ${executionId} not found`);
    }
    await this.require(ctx, 'execution:cancel', this.executionRef(exec));
    if (exec.status === 'COMPLETED' || exec.status === 'FAILED' || exec.status === 'CANCELLED') {
      throw new Error(
        `Execution ${executionId} is already terminal (status: ${exec.status})`,
      );
    }
    await this.persistence.updateExecutionStatus(executionId, 'CANCELLED');
    this.publishEvent(executionId, { event: 'execution_cancelled', data: {} });
    // A cancel never passes through `processJob`, so the lists need telling here.
    const owner = await this.persistence.getWorkflow(exec.workflowId);
    if (owner) this.publishRunChange(owner, executionId, 'CANCELLED');
    this.log.info(`execution ${executionId} cancelled`);
  }

  /** List the credentials visible to `ctx` as safe, paginated summaries. */
  async listCredentials(
    ctx: TCtx,
    page?: { limit?: number; cursor?: string },
  ): Promise<Paged<CredentialListItem>> {
    const filter = await this.filterFor(ctx, 'credential');
    const result = await this.persistence.listCredentials(filter, resolvePage(page));
    const items = await this.project(ctx, result.items, (credential) =>
      this.credentialRef(credential),
    );
    return {
      items,
      ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
    };
  }

  /** One visible credential by name — an indexed lookup, not a list scan. */
  async getCredentialByName(
    ctx: TCtx,
    name: string,
  ): Promise<CredentialListItem | null> {
    const filter = await this.filterFor(ctx, 'credential');
    const record = await this.persistence.getCredentialByName(filter, name);
    if (!record) return null;
    const [projected] = await this.project(ctx, [record], (credential) =>
      this.credentialRef(credential),
    );
    return projected ?? null;
  }

  /* Create a new credential in the workspace.*/
  async createCredential(
    attributes: ResourceAttributes<'credential'>,
    input: CreateCredentialInput,
  ): Promise<CredentialSummary> {
    return this.persistence.createCredential(attributes, input);
  }

  /*Completely replace an existing credential's values.*/
  async replaceCredentialValues(
    attributes: ResourceAttributes<'credential'>,
    name: string,
    values: AuthSpecificValues,
  ): Promise<CredentialSummary | null> {
    return this.persistence.replaceCredentialValues(
      attributes,
      name,
      values,
    );
  }

  /**
   * Revoke a credential — the terminal ACTIVE → REVOKED transition.
   *
   * The row is never deleted; it stays visible. `createdAt` is preserved and
   * `updatedAt` records when it was revoked. Idempotent: revoking an
   * already-revoked credential returns the existing summary without changing
   * the original revocation time. Returns
   * `null` when the credential does not exist (router maps to `404`).
   *
   * @param attributes - Host-defined credential scope and actor attributes.
   * @param name     - Credential name (from the URL path).
   */
  async revokeCredential(
    attributes: ResourceAttributes<'credential'>,
    name: string,
  ): Promise<CredentialSummary | null> {
    return this.persistence.revokeCredential(attributes, name);
  }

  /**
   * Resolve a credential for execution-time use.
   */
  async resolveCredential(
    attributes: ResourceAttributes<'workflow'>,
    name: string,
  ): Promise<ResolvedCredential | null> {
    return this.persistence.resolveCredential(attributes, name);
  }

  // ─── Job Processing ───

  /**
   * The queue consumer body. The host's queue worker calls this for each job.
   *
   * ```ts
   * workflowQueue.process((job) => runtime.processJob(job.data.executionId));
   * ```
   */
  /**
   * What the open gates of a parked run are waiting for: whether any already
   * has its answer, and the earliest clock among them.
   */
  private async readGates(
    executionId: string,
  ): Promise<{ answered: boolean; wakeAt: number | undefined }> {
    const rows = await this.persistence.getStepRows(executionId);
    let answered = false;
    let wakeAt: number | undefined;

    for (const row of rows) {
      if ((row.status !== 'EXTERNAL_WAIT' && row.status !== 'REVIEW_WAIT') || !row.data) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (data['resumePayload'] !== undefined || data['delivery'] !== undefined) answered = true;
      const at = typeof data['wakeAt'] === 'string' ? Date.parse(data['wakeAt']) : Number.NaN;
      if (!Number.isNaN(at) && (wakeAt === undefined || at < wakeAt)) wakeAt = at;
    }

    return { answered, wakeAt };
  }

  async processJob(executionId: string): Promise<ExecutionResult> {
    const exec = await this.persistence.getExecution(executionId);
    if (!exec) return { status: 'not_found' };

    if (exec.status === 'SCHEDULED') {
      const activation = await this.activate(exec);
      if (activation.kind !== 'started') {
        return { status: 'skipped', reason: activation.reason };
      }
    } else if (!['PENDING', 'EXTERNAL_WAIT'].includes(exec.status)) {
      return {
        status: 'skipped',
        reason: `execution status is ${exec.status}`,
      };
    }

    try {
      await this.executor.runExecution(executionId);

      // Check final status after execution
      const final = await this.persistence.getExecution(executionId);
      if (!final) return { status: 'not_found' };

      // One frame per pass, not per step — a list shows only the run's status.
      const owner = await this.persistence.getWorkflow(final.workflowId);
      if (owner) this.publishRunChange(owner, executionId, final.status);

      if (final.status === 'EXTERNAL_WAIT') {
        const gates = await this.readGates(executionId);

        // Liveness (level-triggered): an answer routed to a gate *during* this
        // pass, after the walk had read that node, leaves the gate parked with
        // an unconsumed one. Re-enqueue once so the next pass applies it;
        // consume-once (the walk marks the gate COMPLETED) prevents a loop.
        if (gates.answered) {
          await this.enqueuePass({ executionId, singletonKey: executionId }, owner);
          this.log.info(`execution ${executionId} re-enqueued (answer arrived mid-pass)`);
        } else if (gates.wakeAt !== undefined) {
          // A gate's own clock — a delay, or an API call's deadline. The queue's
          // delay IS the timer; nothing sweeps. A pass that fires on a gate
          // which has since been answered simply re-parks, costing one walk.
          await this.enqueuePass(
            { executionId, singletonKey: executionId, delay: Math.max(0, gates.wakeAt - Date.now()) },
            owner,
          );
          this.log.info(
            `execution ${executionId} waking at ${new Date(gates.wakeAt).toISOString()}`,
          );
        }
        return { status: 'paused', reason: 'Step requested pause' };
      }
      if (final.status === 'COMPLETED') {
        return { status: 'completed' };
      }
      if (final.status === 'FAILED') {
        return { status: 'failed', error: 'Execution failed' };
      }
      if (final.status === 'CANCELLED') {
        return { status: 'failed', error: 'Execution cancelled' };
      }
      if (final.status === 'SKIPPED') {
        return { status: 'skipped', reason: 'Trigger filter mismatch' };
      }
      return { status: 'completed' };
    } catch (err) {
      if (PauseStep.is(err)) {
        // The executor already persisted the pause state
        return { status: 'paused', reason: (err as PauseStep).message };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`processJob ${executionId} failed: ${errMsg}`);
      return { status: 'failed', error: errMsg };
    }
  }

  /**
   * Process a cron tick for a workflow.
   *
   * Called by the scheduler when a cron job fires. Checks poll() if available,
   * otherwise fires unconditionally.
   */
  async processCronTick(workflowId: string): Promise<string | null> {
    const workflow = await this.persistence.getWorkflow(workflowId);
    if (!workflow || workflow.status !== 'ACTIVE') return null;

    const config = readWorkflowConfig(workflow.config);
    if (!this.connectors.hasTrigger(config.trigger.type)) return null;

    const trigger = this.connectors.getTrigger(config.trigger.type);
    if (!(trigger instanceof CronTrigger)) return null;

    const metadata = JSON.parse(workflow.metadata ?? '{}') as Record<string, unknown>;

    if (trigger.poll) {
      const data = await trigger.poll(config.trigger.config, {
        staticData: {
          get: (key) => this.persistence.getStaticData(workflowId, key),
          set: (key, value) =>
            this.persistence.setStaticData(workflowId, key, value),
          delete: (key) =>
            this.persistence.deleteStaticData(workflowId, key),
        },
        services: this.services,
        metadata,
      });

      if (data === null) return null; // nothing new, skip
      return this.admitAndEnqueue(workflow, config, data);
    }

    // Pure cron — always fire
    const payload = trigger.buildPayload
      ? trigger.buildPayload(config.trigger.config)
      : { firedAt: new Date().toISOString() };

    return this.admitAndEnqueue(workflow, config, payload);
  }

  /** A cron tick's payload, through the same admission as every other event. */
  private async admitAndEnqueue(
    workflow: WorkflowRecord,
    config: WorkflowConfig,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const event: TriggerEvent = {
      type: config.trigger.type,
      payload,
      occurredAt: new Date().toISOString(),
    };
    const armed = await this.arm(workflow, config, event);
    if (armed.kind === 'dropped') {
      this.log.info(`cron tick for workflow ${workflow.id} not admitted — ${armed.reason}`);
      return null;
    }
    return armed.executionId;
  }

  /**
   * Choices for one config field, from the step or trigger that owns it.
   *
   * Authoring, not running: this answers a person editing a form, so it runs as
   * THEM. The tenant comes from the workflow being edited, or from the folder a
   * new one is being created in — either way from a record the caller has just
   * been authorized against, never from the request body.
   */
  async getFieldOptions(
    ctx: TCtx,
    input: {
      kind: 'step' | 'trigger';
      type: string;
      field: string;
      config?: Record<string, unknown>;
      search?: string;
      cursor?: string;
      values?: readonly string[];
      /** The workflow being edited… */
      workflowId?: string;
      /** …or the folder a new one is being created in. One of the two. */
      folderId?: string;
      /** Aborted when the author types again, or closes the tab. */
      signal?: AbortSignal;
    },
  ): Promise<FieldOptionsPage> {
    const attributes = await this.editingScope(ctx, input);

    const component =
      input.kind === 'step'
        ? this.connectors.hasStep(input.type)
          ? this.connectors.getStep(input.type)
          : null
        : this.connectors.hasTrigger(input.type)
          ? this.connectors.getTrigger(input.type)
          : null;
    if (!component) throw new ResourceNotFoundError(input.kind, input.type);

    const getOptions = component.getOptions?.bind(component);
    // Not every field is a picker, and a component need not offer any. Nothing
    // to say is an empty page, not an error — the editor falls back to a text box.
    if (!getOptions) return { items: [] };

    const config = input.config ?? {};

    // A half-filled form is the NORMAL state here — the author may not have
    // chosen a connection yet, and that is a question the loader answers with a
    // notice ("Choose a connection first"), not a failure the editor should
    // raise. Hand over what resolved; let the component say what it needs.
    let credentials: Readonly<Record<string, ResolvedCredential>> = {};
    try {
      credentials = await this.credentialResolver.resolve(attributes, component, config);
    } catch (err) {
      this.log.info(
        `field options for ${input.kind} "${input.type}": no usable credential yet — ${messageOf(err)}`,
      );
    }

    const optionsCtx: FieldOptionsContext = {
      field: input.field,
      config,
      literal: literalValues(config),
      ...(input.search !== undefined ? { search: input.search } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.values !== undefined ? { values: input.values } : {}),
      credentials,
      attributes,
      services: this.services,
      caller: ctx,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };

    return getOptions(optionsCtx as never);
  }

  /**
   * Whose data the picker may read.
   *
   * This lookup is not really a capability check — it is how the TENANT is
   * derived. `attributes` decides which workspace's credential the loader runs
   * with, and the only trustworthy source for that is a record the caller has
   * already been authorized against. Take it from the request body instead and
   * anyone can ask one workspace's connector to list another's channels. That is
   * why there is no ungated version of this.
   *
   * So the action asked for is the weakest that proves the caller belongs to the
   * tenant: reading the workflow in front of them, or being allowed to create one
   * in the folder they are working in. Browsing and naming stored ids share it
   * deliberately — `workflow:update` locked a read-only viewer out of resolving
   * labels, so they saw raw ids where the author saw names, and splitting the two
   * only moved the problem: the weaker half would then leak the stronger half back
   * by letting a reader name ids it guessed.
   *
   * What a picker then SHOWS is settled by the credential, not by a second
   * per-person rule: whoever may read the workflow sees what that workflow's
   * connection can reach. That is deliberate — the credential belongs to the
   * workspace, and narrowing it per viewer would be a policy the connector
   * cannot express and the tenant did not ask for.
   */
  private async editingScope(
    ctx: TCtx,
    input: { workflowId?: string; folderId?: string },
  ): Promise<ResourceAttributes<'workflow'>> {
    if (input.workflowId !== undefined) {
      const { record } = await this.authorizedWorkflow(ctx, input.workflowId, 'workflow:read');
      return record.attributes as ResourceAttributes<'workflow'>;
    }
    if (input.folderId !== undefined) {
      const { record } = await this.authorizedFolder(ctx, input.folderId, 'workflow:create');
      return record.attributes as ResourceAttributes<'workflow'>;
    }
    throw new Error('Needs the workflow being edited, or the folder a new one will live in');
  }

  // ─── Internal ───

  /**
   * Arm one event for one workflow: start a run now, or park one until its moment.
   *
   * The binding's start policy decides which. An immediate binding is admitted
   * here and now. A delayed one is armed on SCOPE alone — `accepts` — and stores
   * the raw event; the conditions that decide whether it acts are judged when it
   * fires, by {@link activate}. That is deliberate: a rule like "escalate if still
   * unassigned after two hours" must arm even when the ticket is assigned right
   * now, or it can never fire.
   */
  private async arm(
    workflow: WorkflowRecord,
    config: WorkflowConfig,
    event: TriggerEvent,
    opts?: {
      hydrations?: Map<string, HydrateResult>;
      triggerCtx?: TriggerExecutionContext;
      /** What the person starting the run typed, for `runNaming: { mode: 'user' }`. */
      requestedRunIdentifier?: unknown;
    },
  ): Promise<Armed> {
    const start = config.trigger.start;

    if (!isDelayedStart(start)) return this.startNow(workflow, config, event, opts);

    const trigger = this.connectors.getTrigger(config.trigger.type);
    if (!trigger.accepts(event, config.trigger.config)) {
      return { kind: 'dropped', reason: reasonOf({ kind: 'rejected', by: 'scope' }) };
    }

    // Only an anchor that lives in the payload costs a read here — "two hours
    // after the event" needs none. What it reads is used for the TIME alone and
    // then dropped: the run is armed from the raw event and enriched again when
    // it fires, which is what makes the wait worth anything.
    let anchorPayload: Record<string, unknown> = { ...event.payload };
    const hydrate = startNeedsPayload(start) ? trigger.hydrate?.bind(trigger) : undefined;
    if (hydrate) {
      const hydrated = await this.hydrateFor(
        workflow,
        trigger,
        hydrate,
        event,
        config.trigger.config,
        opts,
      );
      if (hydrated.kind === 'gone') {
        return { kind: 'dropped', reason: reasonOf({ kind: 'gone', reason: hydrated.reason }) };
      }
      anchorPayload = hydrated.payload;
    }

    const anchorValue =
      start?.kind === 'at'
        ? await readAnchor(start.anchor, anchorPayload, config.variables)
        : undefined;
    const when = resolveStartAt(start, event, anchorValue, new Date());
    if (when.kind === 'skip') return { kind: 'dropped', reason: startSkipReason(when.reason) };
    if (when.kind === 'now') return this.startNow(workflow, config, event, opts);

    const executionId = await this.createAndEnqueue(workflow, {}, {
      scheduled: { when, event },
      ...(opts?.requestedRunIdentifier !== undefined
        ? { requestedRunIdentifier: opts.requestedRunIdentifier }
        : {}),
    });
    return { kind: 'scheduled', executionId, fireAt: when.at };
  }

  /** Admit now, and enqueue the run if the event survives. */
  private async startNow(
    workflow: WorkflowRecord,
    config: WorkflowConfig,
    event: TriggerEvent,
    opts?: {
      hydrations?: Map<string, HydrateResult>;
      triggerCtx?: TriggerExecutionContext;
      requestedRunIdentifier?: unknown;
    },
  ): Promise<Armed> {
    const decision = await this.admit(workflow, config, event, opts);
    if (decision.kind !== 'ok') return { kind: 'dropped', reason: reasonOf(decision) };

    const executionId = await this.createAndEnqueue(
      workflow,
      { type: event.type, ...decision.payload },
      opts?.requestedRunIdentifier !== undefined
        ? { requestedRunIdentifier: opts.requestedRunIdentifier }
        : undefined,
    );
    return { kind: 'started', executionId };
  }

  /**
   * A scheduled run's moment has come.
   *
   * Everything that could have changed while it waited is re-read here: the
   * workflow definition (it may have been switched off or edited), and the event's
   * subject (it may have moved on, or stopped existing). The run is then admitted
   * exactly as an arriving event would be — same `admit`, same filters — which is
   * what makes "in two hours" behave like "now".
   */
  private async activate(exec: ExecutionRecord): Promise<Activation> {
    const origin = exec.origin;
    if (!origin) {
      // A scheduled run is admitted from the event on its record. Without one
      // there is nothing to admit, and nothing worth walking.
      return this.endScheduled(exec.id, 'CANCELLED', 'the scheduled run has no stored event');
    }

    const workflow = await this.persistence.getWorkflow(exec.workflowId);
    if (!workflow || workflow.status !== 'ACTIVE') {
      return this.endScheduled(exec.id, 'CANCELLED', 'the workflow is no longer active');
    }

    const fireAt = exec.fireAt?.getTime() ?? Number.NaN;
    if (!Number.isNaN(fireAt) && fireAt - Date.now() > EARLY_WAKE_TOLERANCE_MS) {
      // Woken early — re-arm rather than read the world before the moment.
      await this.enqueuePass(
        { executionId: exec.id, delay: fireAt - Date.now(), singletonKey: exec.id },
        workflow,
      );
      return { kind: 'deferred', reason: `not due until ${exec.fireAt?.toISOString() ?? 'its fire time'}` };
    }

    const config = readWorkflowConfig(workflow.config);
    if (!this.connectors.hasTrigger(config.trigger.type)) {
      return this.endScheduled(
        exec.id,
        'CANCELLED',
        `trigger "${config.trigger.type}" is no longer registered`,
      );
    }

    const decision = await this.admit(workflow, config, origin.event);
    if (decision.kind !== 'ok') {
      return this.endScheduled(
        exec.id,
        decision.kind === 'gone' ? 'CANCELLED' : 'SKIPPED',
        reasonOf(decision),
      );
    }

    // The context is built HERE, not when the run was armed: a run that has not
    // started has nothing to read, and `context.trigger` should only ever mean
    // the payload the run actually acts on.
    const context = this.initialContext(workflow, {
      type: origin.event.type,
      ...decision.payload,
    });

    await this.persistence.persistState(exec.id, {
      context: JSON.stringify(context),
      attributes: context.workflow.attributes,
    });
    await this.persistence.updateExecutionStatus(exec.id, 'PENDING');
    this.log.info(`execution ${exec.id} admitted at its scheduled time`);
    return { kind: 'started' };
  }

  /** End a scheduled run that will never act, saying why on the run itself. */
  private async endScheduled(
    executionId: string,
    status: 'SKIPPED' | 'CANCELLED',
    reason: string,
  ): Promise<Activation> {
    await this.persistence.updateExecutionStatus(executionId, status, reason);
    this.log.info(`scheduled execution ${executionId} ended as ${status}: ${reason}`);
    return { kind: 'ended', status, reason };
  }

  /**
   * Admit one event to one workflow — the single place that decides whether an
   * event deserves a run, and with what data.
   *
   * Every entry path goes through here: a domain dispatch, a webhook delivery, a
   * cron tick, a manual run. That is the point. Filtering used to happen at two
   * points on one path, one point on another and nowhere at all on the rest, so
   * the same author-written filter meant different things depending on how the
   * run started.
   *
   * In order: `accepts` prunes on the raw event — the trigger's one say, and it
   * is about what arrived — then `hydrate` resolves ids into objects once, and the
   * author's conditions judge the enriched payload. What this returns is frozen
   * into `context.trigger` and never re-read: a step that needs the world as it is
   * later reads it itself.
   */
  private async admit(
    workflow: WorkflowRecord,
    config: WorkflowConfig,
    event: TriggerEvent,
    opts?: {
      /** Shared across candidates of one dispatch, so one event costs one read. */
      hydrations?: Map<string, HydrateResult>;
      /** Already resolved by the caller (the webhook path), so it is not resolved twice. */
      triggerCtx?: TriggerExecutionContext;
    },
  ): Promise<Admission> {
    const trigger = this.connectors.getTrigger(config.trigger.type);
    const triggerConfig = config.trigger.config;

    if (!trigger.accepts(event, triggerConfig)) return { kind: 'rejected', by: 'scope' };

    let payload: Record<string, unknown> = { ...event.payload };
    const hydrate = trigger.hydrate?.bind(trigger);
    if (hydrate) {
      const hydrated = await this.hydrateFor(
        workflow,
        trigger,
        hydrate,
        event,
        triggerConfig,
        opts,
      );
      if (hydrated.kind === 'gone') return hydrated;
      payload = hydrated.payload;
    }

    if (!(await matchesTriggerFilter(config.trigger.filter, payload, config.variables))) {
      return { kind: 'rejected', by: 'conditions' };
    }

    return { kind: 'ok', payload };
  }

  /** One hydration, shared by key across the candidates of a single dispatch. */
  private async hydrateFor(
    workflow: WorkflowRecord,
    trigger: AnyTrigger,
    hydrate: NonNullable<AnyTrigger['hydrate']>,
    event: TriggerEvent,
    triggerConfig: Readonly<Record<string, unknown>> | undefined,
    opts?: {
      hydrations?: Map<string, HydrateResult>;
      triggerCtx?: TriggerExecutionContext;
    },
  ): Promise<HydrateResult> {
    const key = trigger.hydrationKey?.(event);
    const memoKey = key === undefined ? undefined : `${trigger.type}:${key}`;
    const cached = memoKey === undefined ? undefined : opts?.hydrations?.get(memoKey);
    if (cached) return cached;

    let result: HydrateResult;
    try {
      const ctx =
        opts?.triggerCtx ?? (await this.triggerCtxFor(workflow, trigger, triggerConfig));
      result = await hydrate(event, triggerConfig, ctx);
    } catch (err) {
      // Enrichment failing is no licence to run on bare ids — drop the event and
      // say why, the same outcome as a subject that no longer exists.
      this.log.warn(`hydrate failed for workflow ${workflow.id}: ${messageOf(err)}`);
      result = { kind: 'gone', reason: `hydration failed: ${messageOf(err)}` };
    }

    if (memoKey !== undefined) opts?.hydrations?.set(memoKey, result);
    return result;
  }

  /** Credentials and tenant for a trigger's server-side hooks. */
  private async triggerCtxFor(
    workflow: WorkflowRecord,
    trigger: AnyTrigger,
    triggerConfig: Readonly<Record<string, unknown>> | undefined,
  ): Promise<TriggerExecutionContext> {
    const attributes = workflow.attributes as ResourceAttributes<'workflow'>;
    const credentials = await this.credentialResolver.resolve(attributes, trigger, triggerConfig);
    return { credentials, attributes, baseUrl: this.baseUrl };
  }

  /**
   * The context a run starts with — its identity, its tenant, the author's
   * constants, and the trigger payload it acts on.
   *
   * Built in one place because it is built at two moments: when an immediate run
   * is created, and when a delayed one is admitted. Those must produce the same
   * shape, or a rule would behave differently for having waited.
   */
  /**
   * The identifier a new run is stored under, per the workflow's `runNaming`.
   *
   * Returns nothing when there is no real name to give — no naming configured,
   * a blank field, a template that resolved empty. The store then generates
   * `Run-<time>` AND flags it as generated. Making up that string here instead
   * would land it unflagged, and the UI would show a placeholder as though a
   * person had chosen it.
   */
  private runNameFor(
    config: WorkflowConfig,
    context: WorkflowContext,
    requested: unknown,
  ): { name?: string; nameConflict?: 'suffix' | 'reject' } {
    const naming = config.settings?.runNaming;
    if (naming?.mode === 'user') {
      const typed = typeof requested === 'string' ? requested.trim() : '';
      // A person chose it, so a clash is theirs to resolve: refuse it rather
      // than hand them `name#1`, which they did not type.
      return typed ? { name: typed, nameConflict: 'reject' } : {};
    }
    if (naming?.mode === 'template') {
      const resolved = new VariableResolver().resolveString(naming.template, context);
      const name = (typeof resolved === 'string' ? resolved : String(resolved ?? '')).trim();
      // Templates repeat by nature (the same loan re-submitted), so a clash is
      // expected and gets a suffix.
      return name ? { name, nameConflict: 'suffix' } : {};
    }
    return {};
  }

  private initialContext(
    workflow: WorkflowRecord,
    triggerPayload: Record<string, unknown>,
  ): WorkflowContext {
    const metadata = JSON.parse(workflow.metadata ?? '{}') as Record<string, unknown>;

    return {
      workflow: {
        id: workflow.id,
        // The execution's tenant, carried by the resource. The executor
        // re-hydrates this from the record on every run, so this is a seed
        // rather than the authority.
        attributes: workflow.attributes as ResourceAttributes<'workflow'>,
        metadata,
      },
      trigger: triggerPayload as WorkflowContext['trigger'],
      // Placeholder: the execution row is created below, so its id does not
      // exist yet. The executor stamps the real one on every run.
      execution: { id: '' },
      steps: {},
      vars: projectVariables(readWorkflowConfig(workflow.config).variables),
    };
  }

  private async createAndEnqueue(
    workflow: WorkflowRecord,
    triggerPayload: Record<string, unknown>,
    opts?: {
      /**
       * Park the run until its moment instead of running it now. The event is
       * kept on the record, not in a context: a run that has not started has
       * nothing to read, and it is admitted from this when it fires.
       */
      scheduled?: {
        when: Extract<StartDecision, { kind: 'at' }>;
        event: TriggerEvent;
      };
      /** What the person starting the run typed, for `runNaming: { mode: 'user' }`. */
      requestedRunIdentifier?: unknown;
    },
  ): Promise<string> {
    const scheduled = opts?.scheduled;
    const attributes = workflow.attributes as ResourceAttributes<'workflow'>;
    const initialContext = this.initialContext(workflow, triggerPayload);
    const naming = this.runNameFor(
      readWorkflowConfig(workflow.config),
      initialContext,
      opts?.requestedRunIdentifier,
    );

    const execId = await this.persistence.createExecution({
      workflowId: workflow.id,
      ...naming,
      status: scheduled ? 'SCHEDULED' : 'PENDING',
      context: scheduled ? '{}' : JSON.stringify(initialContext),
      attributes,
      ...(scheduled
        ? {
            fireAt: scheduled.when.at,
            origin: { event: scheduled.event, anchor: scheduled.when.anchor },
          }
        : {}),
    });

    // Announced here rather than per call site: every run passes through.
    this.publishRunChange(workflow, execId, scheduled ? 'SCHEDULED' : 'PENDING');

    if (scheduled) {
      // The delay is the fast path; `fireAt` on the row is the truth. A host that
      // sweeps for overdue runs makes a lost job late rather than lost.
      await this.enqueuePass(
        { executionId: execId, delay: Math.max(0, scheduled.when.at.getTime() - Date.now()), singletonKey: execId },
        workflow,
      );
      this.log.info(
        `scheduled execution ${execId} for workflow ${workflow.id} at ` +
          `${scheduled.when.at.toISOString()} (anchor: ${scheduled.when.anchor.source})`,
      );
      return execId;
    }

    await this.enqueuePass({ executionId: execId }, workflow);
    this.log.info(
      `created execution ${execId} for workflow ${workflow.id}`,
    );

    return execId;
  }
}
