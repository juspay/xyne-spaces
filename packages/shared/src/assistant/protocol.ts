import { z } from 'zod';
import type { Plan } from './core/operations.js';
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
    /** The page route, for tracing and page-specific help. */
    route: z.string().max(500),
    /** What is open on screen: the channel or DM, the thread inside it. */
    onScreen: z.array(entityRefSchema).max(10),
    /** What the user attached to the Ask AI panel as context. */
    attached: z.array(entityRefSchema).max(20),
  })
  .strict();

const operationResult = z
  .object({ ok: z.boolean(), produced: entityRefSchema.optional(), error: z.string().max(500).optional() })
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
      results: z.array(operationResult).max(20),
    })
    .strict(),
]);

/** What the dashboard sends for every turn. Checked on arrival. */
export const turnRequestSchema = z
  .object({
    /** One conversation; the dashboard keeps it for the life of the panel. */
    sessionId: z.string().min(1).max(100),
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
