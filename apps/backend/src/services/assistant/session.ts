import {
  EMPTY_CONVERSATION,
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
  if (!raw) return EMPTY_SESSION;
  try {
    const value = JSON.parse(raw) as Partial<AssistantSession>;
    const valid =
      value.version === 1 &&
      value.conversation?.version === 1 &&
      Array.isArray(value.conversation.parked) &&
      value.question !== undefined &&
      value.run !== undefined;
    return valid ? (value as AssistantSession) : EMPTY_SESSION;
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
