import { z } from 'zod';

// ─── Built-in Step Types ───

/**
 * All step types shipped by the SDK.
 * Host adds domain-specific types as plain strings (e.g. 'SEND_MESSAGE').
 */
export enum BuiltinStepType {
  // Control flow
  CONDITIONAL = 'CONDITIONAL',
  SWITCH = 'SWITCH',
  LOOP = 'LOOP',
  CYCLE = 'CYCLE',
  PARALLEL = 'PARALLEL',
  MAP = 'MAP',
  // Action
  CODE = 'CODE',
  /**
   * Wait for a person to answer — the only kind that reaches the approvals
   * inbox.
   *
   * The wire value stays `WAIT`: every stored screen of every conversational
   * flow is one of these, and the step's other two modes could never resume in
   * any deployment. So this is not a rename, it is the step saying what it has
   * always been, and no config has to move.
   */
  WAIT_FOR_HUMAN = 'WAIT',
  /** Wait for an external system to post its result back. */
  WAIT_FOR_WEBHOOK = 'WAIT_FOR_WEBHOOK',
  /** Wait for the clock. */
  DELAY = 'DELAY',
  HTTP_REQUEST = 'HTTP_REQUEST',
  DEDUP = 'DEDUP',
  CLASSIFIER_AGENT = 'CLASSIFIER_AGENT',
  GO_TO = 'GO_TO',
  FINISH = 'FINISH',
}

export const BuiltinStepTypeSchema = z.nativeEnum(BuiltinStepType);

// ─── Workflow kinds ───

/**
 * `metadata.kind` of a workflow built in the conversational-flow editor.
 *
 * Platform vocabulary rather than that module's own: the editor a workflow
 * belongs to decides who its waits are addressed to, and the engine reads that
 * without depending on the feature.
 */
export const CONVERSATIONAL_FLOW_KIND = 'conversational_flow';

// ─── Gate Categories ───

/**
 * Who a parked run is waiting on, written when the pause is created.
 *
 * Without it the approvals inbox can only filter on the run's status, which
 * says THAT a run is parked and never who it is parked on — so a dispatched
 * agent run, a build callback and a customer mid-chat all read as somebody's
 * work to approve.
 */
export enum GateCategory {
  /**
   * Somebody inside the product: an approval, a review of a step's output, an
   * agent asking its operator a question. **The only category the approvals
   * inbox asks for** — it is the one place a person finds work waiting on them,
   * so whatever lands here has to be theirs to act on.
   */
  WaitingOnApprover = 'waiting_on_approver',
  /**
   * The person a conversation is with: a screen of a conversational flow,
   * waiting on the customer at the other end.
   *
   * Deliberately not in the inbox. They are already looking at the
   * conversation, and these outnumber real approvals several times over.
   */
  WaitingOnConsumer = 'waiting_on_consumer',
  /** An external system that will post its result back. */
  WaitingOnApiCall = 'waiting_on_api_call',
  /** A clock. Nobody is called, and nobody can answer. */
  Delay = 'delay',
}


// ─── Control Flow subset ───

const _CONTROL_FLOW_STEP_TYPES = [
  BuiltinStepType.CONDITIONAL,
  BuiltinStepType.SWITCH,
  BuiltinStepType.LOOP,
  BuiltinStepType.CYCLE,
  BuiltinStepType.PARALLEL,
  BuiltinStepType.MAP,
] as const;

export type ControlFlowStepType = (typeof _CONTROL_FLOW_STEP_TYPES)[number];

/** Set of control-flow step types — for runtime checks like `CONTROL_FLOW_STEP_TYPES.has(step.type)`. */
export const CONTROL_FLOW_STEP_TYPES: ReadonlySet<string> = new Set(
  _CONTROL_FLOW_STEP_TYPES,
);

export const ControlFlowStepTypeSchema = z.enum([
  BuiltinStepType.CONDITIONAL,
  BuiltinStepType.SWITCH,
  BuiltinStepType.LOOP,
  BuiltinStepType.CYCLE,
  BuiltinStepType.PARALLEL,
  BuiltinStepType.MAP,
]);

// ─── Built-in Trigger Types ───

/**
 * Trigger types shipped by the SDK.
 * Host adds domain-specific triggers as plain strings (e.g. 'TICKET_CREATED').
 */
export enum BuiltinTriggerType {
  EVENT = 'EVENT',
  CRON = 'CRON',
  MANUAL = 'MANUAL',
  WEBHOOK_V2 = 'WEBHOOK_V2',
}

export const BuiltinTriggerTypeSchema = z.nativeEnum(BuiltinTriggerType);
