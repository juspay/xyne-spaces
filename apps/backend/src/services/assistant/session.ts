import { z } from 'zod';
import {
  EMPTY_CONVERSATION,
  entityRefSchema,
  type ChoiceOption,
  type ConversationState,
} from '@xyne/shared/assistant';

/**
 * One person's conversation with the assistant, kept between turns. Stored as JSON in Redis
 * under one key per user and panel session, and forgotten after two idle hours.
 */
export interface AssistantSession {
  version: 1;
  conversation: ConversationState;
  /** The question on screen, so "yes", "2", or a button tap can answer it without a model. */
  question: OpenQuestion | null;
  /** A plan the dashboard is running; its results must quote this `runId`. */
  run: PendingRun | null;
}

export interface PendingRun {
  runId: string;
  action: string;
  /** The dashboard must return one result for each completed operation. */
  expectedResults?: number;
  /** Said when every operation succeeded. */
  done: string;
}

export type OpenQuestion =
  /** Asked for a detail; `options` when it has buttons ("Public or private?"). */
  | { kind: 'detail'; field: string; options: ChoiceOption[] }
  /** Showed a preview and waits for "yes". */
  | { kind: 'preview' }
  /** Asked which of a few actions the user meant; option ids are action ids. */
  | { kind: 'action'; options: ChoiceOption[]; text: string };

export const EMPTY_SESSION: AssistantSession = {
  version: 1,
  conversation: EMPTY_CONVERSATION,
  question: null,
  run: null,
};

export const SESSION_IDLE_SECONDS = 2 * 60 * 60;
/** Far above any real conversation; stops a runaway session from growing without bound. */
const MAX_BYTES = 64 * 1024;

const choiceOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();
const fieldValueSchema = z.union([z.string(), entityRefSchema, z.array(entityRefSchema)]);
const candidateSchema = choiceOptionSchema.extend({ value: fieldValueSchema }).strict();
const openNameSchema = z
  .object({ field: z.string().min(1), said: z.string(), options: z.array(candidateSchema) })
  .strict();
const draftSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    values: z.record(fieldValueSchema),
    unsure: z.array(z.string()),
    open: z.array(openNameSchema),
    later: z.array(z.object({ field: z.string().min(1), said: z.string() }).strict()),
    offered: z.array(z.string()),
    awaiting: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('field'), field: z.string().min(1) }).strict(),
        z.object({ kind: z.literal('preview'), fingerprint: z.string().min(1) }).strict(),
      ])
      .nullable(),
  })
  .strict();
const conversationSchema = z
  .object({
    version: z.literal(2),
    seq: z.number().int().nonnegative(),
    active: draftSchema.nullable(),
  })
  .strict();
const openQuestionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('detail'),
      field: z.string().min(1),
      options: z.array(choiceOptionSchema),
    })
    .strict(),
  z.object({ kind: z.literal('preview') }).strict(),
  z
    .object({
      kind: z.literal('action'),
      options: z.array(choiceOptionSchema).min(1),
      text: z.string(),
    })
    .strict(),
]);
const pendingRunSchema = z
  .object({
    runId: z.string().min(1),
    action: z.string().min(1),
    expectedResults: z.number().int().nonnegative().optional(),
    done: z.string(),
  })
  .strict();
const assistantSessionSchema: z.ZodType<AssistantSession, z.ZodTypeDef, unknown> = z
  .object({
    version: z.literal(1),
    conversation: conversationSchema,
    question: openQuestionSchema.nullable(),
    run: pendingRunSchema.nullable(),
  })
  .strict();

export interface SessionIdentity {
  workspaceId: string;
  userId: string;
  sessionId: string;
}

export interface SessionStore {
  load(identity: SessionIdentity): Promise<AssistantSession>;
  save(identity: SessionIdentity, session: AssistantSession): Promise<void>;
}

export function sessionKey({ workspaceId, userId, sessionId }: SessionIdentity): string {
  return `assistant:session:${workspaceId}:${userId}:${sessionId}`;
}

/**
 * Anything unreadable, from another version, or not this shape starts a fresh conversation
 * rather than being half-used.
 */
export function parseSession(raw: string | null): AssistantSession {
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return EMPTY_SESSION;
  try {
    const parsed = assistantSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_SESSION;
  } catch {
    return EMPTY_SESSION;
  }
}

export function serializeSession(session: AssistantSession): string {
  return JSON.stringify(session);
}
