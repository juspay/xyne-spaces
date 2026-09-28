import { z } from 'zod';
import {
  EMPTY_CONVERSATION,
  entityRefSchema,
  MAX_PARKED,
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
  /** Said after `done`, e.g. a reminder that another request is on hold. */
  after?: string;
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
const pendingResolutionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('choice'),
      field: z.string().min(1),
      mention: z.string(),
      candidates: z.array(candidateSchema),
    })
    .strict(),
  z
    .object({ kind: z.literal('notFound'), field: z.string().min(1), mention: z.string() })
    .strict(),
]);
const draftSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    values: z.record(fieldValueSchema),
    certain: z.record(z.boolean()),
    offered: z.array(z.string()),
    skipped: z.array(z.string()),
    asking: z.string().nullable(),
    choosing: z
      .object({
        field: z.string().min(1),
        mention: z.string(),
        candidates: z.array(candidateSchema),
      })
      .strict()
      .nullable(),
    notFound: z
      .object({ field: z.string().min(1), mention: z.string() })
      .strict()
      .nullable(),
    resolutionQueue: z.array(pendingResolutionSchema).default([]),
    pendingLookup: z
      .object({ field: z.string().min(1), mention: z.string() })
      .strict()
      .nullable()
      .default(null),
    previewFingerprint: z.string().nullable(),
  })
  .strict();
const conversationSchema = z
  .object({
    version: z.literal(1),
    seq: z.number().int().nonnegative(),
    active: draftSchema.nullable(),
    parked: z.array(draftSchema).max(MAX_PARKED),
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
    after: z.string().optional(),
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

/** The JSON to store. Over the size limit, requests set aside for later are dropped first. */
export function serializeSession(session: AssistantSession): string {
  const json = JSON.stringify(session);
  if (json.length <= MAX_BYTES) return json;
  const trimmed = { ...session, conversation: { ...session.conversation, parked: [] } };
  return JSON.stringify(trimmed);
}
