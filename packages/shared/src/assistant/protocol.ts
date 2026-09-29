import { z } from 'zod';
import { operationResultSchema, type Plan } from './core/operations.js';
import { entityRefSchema, type ChoiceOption } from './core/references.js';

/**
 * The messages the dashboard and the assistant backend exchange, and nothing else.
 *
 * One turn: the dashboard sends what the user said (or tapped) and what is on screen; the
 * backend answers with what to say and show. When a request is ready, the answer also carries
 * the whole plan; the dashboard runs it with the user's session and sends the results back in
 * one follow-up turn, and the backend replies with the final words.
 */

const clientContext = z
  .object({
    /** What is open on screen, so "here" means it. */
    onScreen: z.array(entityRefSchema).max(10),
  })
  .strict();

const turnInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(2000), via: z.enum(['voice', 'typed']) }).strict(),
  /** A button tap: the option id from the last response. */
  z.object({ kind: z.literal('choose'), optionId: z.string().min(1).max(200) }).strict(),
  /** The results of the plan in the last response, one per operation, in order. */
  z
    .object({
      kind: z.literal('planResult'),
      runId: z.string().min(1).max(100),
      results: z.array(operationResultSchema).max(20),
    })
    .strict(),
]);

/** Path parameters for POST /api/assistant/sessions/{sessionId}/turns. */
export const assistantSessionParamsSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
  })
  .strict();

/** JSON body for one assistant turn. Session identity belongs in the route. */
export const turnRequestSchema = z
  .object({
    /** Correlates logs across speech-to-text, the backend, and the plan runner. */
    requestId: z.string().min(1).max(100),
    input: turnInput,
    context: clientContext,
  })
  .strict();

export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type TurnInput = z.infer<typeof turnInput>;
export type ClientContext = z.infer<typeof clientContext>;

export type Display =
  /** A question with buttons ("Public or private?", "Which Daniel?"). */
  | { kind: 'choices'; prompt: string; options: ChoiceOption[] }
  /** "Shall I…?" before an action runs. Its buttons send the option ids `yes` and `no`. */
  | { kind: 'preview'; summary: string; confirmLabel: string; cancelLabel: string };

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
  tone?: 'error';
  /** A question for Xyne AI rather than a task: the dashboard offers to ask it. */
  handoff?: { to: 'ask_ai'; text: string };
  /** How the sentence was understood, for the Diagnose log. Never sent in production. */
  debug?: TurnDebug;
}

/** Jev's view of one sentence: what kind it is, and the most likely actions. */
export interface TurnDebug {
  kind?: Record<string, number>;
  actions?: Array<{ action: string; probability: number }>;
  continues?: number;
  /** Local Diagnose timing summary; contains no user text or record IDs. */
  timings?: { backendMs: number; jevMs: number[] };
}
