/**
 * The event bus port — how live state transitions reach a watching client.
 *
 * The engine publishes at execution state transitions; the SSE route subscribes
 * and streams to the browser. Between them sits a topic-addressed pub/sub
 * channel that this file describes and deliberately does not implement.
 *
 * ## Why this is a port
 *
 * A bus backed by a process-local `Map` only works when the publisher and the
 * subscriber share a heap, and hosts routinely arrange for them not to: run the
 * queue worker in one process and the HTTP API in another — the ordinary way to
 * scale either independently — and the executor publishes into one map while the
 * stream route listens to a different one. Nothing errors. Every live run just
 * renders its opening snapshot and then appears to freeze.
 *
 * That failure is invisible from inside the engine, so the engine must not be the
 * thing that decides how events travel. A host that spans processes supplies a
 * Redis (or NATS, or Kafka) adapter; {@link InMemoryEventBus} stays the default
 * and stays correct whenever everything shares one process.
 *
 * ## Delivery contract
 *
 * At-most-once, unordered across publishers. Implementations are not required to
 * buffer, replay, or acknowledge — a subscriber that was not listening when an
 * event was published never sees it. Consumers must therefore treat a subscription
 * as a hint to re-read authoritative state, not as the state itself, and must
 * recover by re-reading after any reconnect.
 */

import type { PauseState } from '../types/pause-state.js';
import type { JumpSignal } from '../engine/branch-signal.js';

// ─── Event Vocabulary ───

// `stepName` is the bare config id (graph-node / aggregate key). `nodePath` is the
// full node-path of the record (`map1:item#0/validate` for nested steps, equal to
// the bare id at top level) — lets consumers patch the exact per-iteration record,
// not just the aggregated bare-id state. Equals `stepName` for top-level steps.
// `signal` is set when a step ended by jumping (CONTINUE/FINISH) rather than finishing.
export type ExecutionStreamEvent =
  | { event: 'step_started'; data: { stepName: string; stepType: string; nodePath?: string } }
  | { event: 'step_completed'; data: { stepName: string; output: Record<string, unknown>; nodePath?: string; signal?: JumpSignal } }
  | { event: 'step_failed'; data: { stepName: string; error: string; nodePath?: string } }
  | { event: 'step_progress'; data: { stepName: string; nodePath?: string } & Record<string, unknown> }
  | { event: 'execution_paused'; data: { stepName: string; pauseState: PauseState; nodePath?: string } }
  | { event: 'execution_completed'; data: { status: string } }
  | { event: 'execution_failed'; data: { error: string } }
  | { event: 'execution_cancelled'; data: Record<string, unknown> };

/** What happened to a workflow definition. */
export type WorkflowChangeKind =
  | 'created'
  | 'updated'
  | 'activated'
  | 'deactivated'
  /** Went to a reviewer instead of going live, under the approval policy. */
  | 'submitted'
  | 'approved'
  | 'rejected';

/**
 * A workflow definition changed. Carries no definition.
 *
 * Notification, not delivery — and deliberately so. The config is a large blob,
 * and the read path already authorizes per caller, which a topic-addressed bus
 * cannot: subscribers are addressed by resource id, never by principal. Shipping
 * the new config here would mean re-deciding who may see it at the fan-out layer,
 * keeping two delivery paths coherent, and serializing the whole workflow on every
 * save. A doorbell costs one authorized refetch and keeps all of that where it
 * already works.
 *
 * One frame name for every kind, with the kind in the payload: a subscriber
 * registers one listener, and a new kind does not require a new one.
 */
export interface WorkflowChangeEvent {
  event: 'workflow_changed';
  data: {
    workflowId: string;
    change: WorkflowChangeKind;
    /**
     * Opaque identifier of the writer, echoed straight back from the request that
     * caused this. A client that stamps its own writes can recognise — and ignore
     * — the echo of its own work. See {@link MutationOptions.origin}.
     */
    origin?: string;
    /** ISO-8601, server clock. For display and debugging, never for ordering. */
    at: string;
  };
}

/**
 * A run appeared, or its status changed. Carries no run.
 *
 * The LIST-level counterpart to {@link ExecutionStreamEvent}: that one is
 * addressed to a single run and patches step state in place, while this says
 * only that *some* run under a workflow or folder moved, so a list can re-read
 * its page.
 *
 * `status` is a hint, letting a subscriber skip a re-read it does not care
 * about. The authorized GET remains the truth, as with every frame here.
 */
export interface RunChangeEvent {
  event: 'run_changed';
  data: {
    workflowId: string;
    executionId: string;
    status: string;
    /** ISO-8601, server clock. For display and debugging, never for ordering. */
    at: string;
    workflowName?: string;
    createdAt?: number;
  };
}

/**
 * Everything the bus can carry, discriminated by `event` — which is also the SSE
 * frame name, so a transport can forward it without a translation table.
 *
 * A union rather than a bare alias: further entity families get added here, and
 * every adapter and subscriber then has to account for them.
 */
export type BusEvent = ExecutionStreamEvent | WorkflowChangeEvent | RunChangeEvent;

// ─── Topics ───

/**
 * A bus channel, namespaced `<entity>:<id>`.
 *
 * The namespace is what lets one bus carry several event families without
 * collision, and what lets a subscriber address exactly the entity it cares about
 * instead of filtering a firehose. Build these with the constructors below rather
 * than by hand — the template type will catch a typo, but only if nobody widens
 * it to `string` on the way in.
 */
export type EventTopic =
  | `execution:${string}`
  | `workflow:${string}`
  | `folder:${string}`
  | `root:${string}`;

/** The channel carrying one execution's lifecycle events. */
export const executionTopic = (executionId: string): EventTopic => `execution:${executionId}`;

/**
 * The channel carrying one workflow's change events — both changes to the
 * definition ({@link WorkflowChangeEvent}) and runs of it
 * ({@link RunChangeEvent}).
 */
export const workflowTopic = (workflowId: string): EventTopic => `workflow:${workflowId}`;

/**
 * The channel carrying everything happening inside one folder. Lists scoped to
 * a folder subscribe here; per-workflow topics would mean one per row,
 * re-subscribed on every page.
 */
export const folderTopic = (folderId: string): EventTopic => `folder:${folderId}`;

/**
 * The channel carrying every run change under one root scope — the list-level
 * feed behind the unscoped Executions view, which has no workflow or folder to
 * scope to. `root` is the top level of the host's resource tree (see the `root`
 * authz ref); the id is an opaque partition key the host supplies (a workspace,
 * tenant, org — whatever its top-level scope is), so the SDK stays agnostic.
 * Only {@link RunChangeEvent} travels here; definition changes stay on the
 * workflow topic. A caller may only ever subscribe to its own root scope, so the
 * route derives the id from the authenticated principal rather than the request.
 */
export const rootTopic = (rootId: string): EventTopic => `root:${rootId}`;

// ─── Port ───

export type BusListener = (event: BusEvent) => void;

/**
 * Detaches a listener. Safe to call more than once, and safe to call after the
 * bus has otherwise torn the topic down.
 */
export type Unsubscribe = () => void;

export interface EventBusAdapter {
  /**
   * Publish to every subscriber of `topic`, across every process sharing this bus.
   *
   * Rejects only on transport failure. Callers on an execution path must not await
   * it and must swallow the rejection: a bus outage degrades live updates, and must
   * never fail the run that was merely reporting on itself.
   */
  publish(topic: EventTopic, event: BusEvent): Promise<void>;

  /**
   * Attach `listener` to `topic`. Resolves once the subscription is live — for a
   * distributed adapter that means after the broker has acknowledged it, so that
   * awaiting this is sufficient to guarantee no subsequent publish is missed.
   */
  subscribe(topic: EventTopic, listener: BusListener): Promise<Unsubscribe>;
}
