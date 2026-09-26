import type { OperationResult, Plan } from './core/operations.js';
import type { ChoiceOption, EntityRef } from './core/references.js';

/**
 * The messages the dashboard and the assistant backend exchange, and nothing else.
 *
 * One turn: the dashboard sends what the user said (or tapped) and what is on screen; the
 * backend answers with what to say and show. When a request is ready, the answer also carries
 * the whole plan; the dashboard runs it with the user's session and sends the results back in
 * one follow-up turn, and the backend replies with the final words.
 */

export interface ClientContext {
  /** The page route, for tracing and page-specific help. */
  route: string;
  /** What is open on screen: the channel or DM, the thread inside it. */
  onScreen: EntityRef[];
  /** What the user attached to the Ask AI panel as context. */
  attached: EntityRef[];
}

export type TurnInput =
  | { kind: 'text'; text: string; via: 'voice' | 'typed' }
  /** A button tap: the option id from the last response. */
  | { kind: 'choose'; optionId: string }
  /** The results of the plan in the last response, one per operation, in order. */
  | { kind: 'planResult'; runId: string; results: OperationResult[] };

export interface TurnRequest {
  /** One conversation; the dashboard keeps it for the life of the panel. */
  sessionId: string;
  /** Correlates logs and traces across speech-to-text, the backend, and the plan runner. */
  requestId: string;
  input: TurnInput;
  context: ClientContext;
}

export type Display =
  /** A question with buttons ("Public or private?", "Which Daniel?"). */
  | { kind: 'choices'; prompt: string; options: ChoiceOption[] }
  /** "Shall I…?" before an action runs. */
  | { kind: 'preview'; summary: string; confirmLabel: string; cancelLabel: string }
  /** Results to pick from, such as found threads. */
  | { kind: 'list'; title: string; items: ChoiceOption[]; hasMore: boolean };

/** A plan for the dashboard to run now. */
export interface PlanRun {
  /** Identifies this run; the results turn must quote it. Issued by the backend. */
  runId: string;
  plan: Plan;
}

export interface TurnResponse {
  turnId: string;
  /** Spoken, and shown when text is visible. Empty while a plan runs. */
  say: string;
  display?: Display;
  /** Run this plan, then send a `planResult` turn. */
  run?: PlanRun;
  /** The assistant asked something (listen again after speaking, in hands-free mode). */
  expectsReply: boolean;
  session: { hasDraft: boolean; parked: number };
  tone?: 'error';
}
