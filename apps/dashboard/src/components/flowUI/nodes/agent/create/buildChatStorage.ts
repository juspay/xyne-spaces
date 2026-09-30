import type { Message } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { BuildQuestionState } from './BuildChatExtras';
import type { DraftActivity, DraftSuggestion } from './agentDraftStream';
import { DRAFT_MAX_AGE_MS } from './agentCreateDraftStorage';

/**
 * The Build chat next to an unsaved draft, so a reload brings back the
 * conversation along with the canvas. Kept apart from the draft itself: a first
 * turn can ask questions before anything lands on the canvas.
 */

const VERSION = 1;
/** Only the latest messages are kept; the draft reads the last few anyway. */
export const BUILD_CHAT_MAX_MESSAGES = 60;

/** What a Build reply carries besides its text. */
export interface BuildTurnExtras {
  activities: DraftActivity[];
  suggestions: DraftSuggestion[];
  question?: BuildQuestionState;
}

export interface BuildChatThread {
  messages: Message[];
  extras: Record<string, BuildTurnExtras>;
  /** User turns sent from a question card: the answered card stands in for their bubble. */
  fromCard: string[];
}

export const EMPTY_BUILD_CHAT: BuildChatThread = { messages: [], extras: {}, fromCard: [] };

interface StoredMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  at: number;
  aborted?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStored(message: Message): StoredMessage {
  return {
    id: message.id,
    type: message.type,
    content: message.content ?? '',
    at: message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now(),
    // A reply still streaming when the page went away was cut off.
    ...(message.isAborted || message.isStreaming ? { aborted: true } : {}),
  };
}

function fromStored(row: unknown): Message[] {
  if (!isRecord(row)) return [];
  const { id, type, content, at, aborted } = row;
  if (
    typeof id !== 'string' ||
    (type !== 'user' && type !== 'bot') ||
    typeof content !== 'string'
  ) {
    return [];
  }
  return [
    {
      id,
      type,
      content,
      timestamp: new Date(typeof at === 'number' ? at : Date.now()),
      ...(aborted === true ? { isAborted: true } : {}),
    },
  ];
}

function parseExtras(value: unknown, ids: ReadonlySet<string>): Record<string, BuildTurnExtras> {
  if (!isRecord(value)) return {};
  const out: Record<string, BuildTurnExtras> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!ids.has(id) || !isRecord(raw)) continue;
    out[id] = {
      activities: Array.isArray(raw['activities']) ? (raw['activities'] as DraftActivity[]) : [],
      suggestions: Array.isArray(raw['suggestions'])
        ? (raw['suggestions'] as DraftSuggestion[])
        : [],
      ...(isRecord(raw['question']) && Array.isArray(raw['question']['questions'])
        ? { question: raw['question'] as unknown as BuildQuestionState }
        : {}),
    };
  }
  return out;
}

export function parseStoredBuildChat(
  raw: string | null,
  now: number = Date.now(),
): BuildChatThread | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['v'] !== VERSION) return null;
  const savedAt = typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : 0;
  if (now - savedAt > DRAFT_MAX_AGE_MS) return null;
  const messages = Array.isArray(parsed['messages']) ? parsed['messages'].flatMap(fromStored) : [];
  if (messages.length === 0) return null;
  const ids = new Set(messages.map(message => message.id));
  return {
    messages,
    extras: parseExtras(parsed['extras'], ids),
    fromCard: Array.isArray(parsed['fromCard'])
      ? parsed['fromCard'].filter((id): id is string => typeof id === 'string' && ids.has(id))
      : [],
  };
}

/** What goes into storage: the latest messages and only what belongs to them. */
export function serializeBuildChat(thread: BuildChatThread, now: number = Date.now()): string {
  const messages = thread.messages.slice(-BUILD_CHAT_MAX_MESSAGES).map(toStored);
  const ids = new Set(messages.map(message => message.id));
  const extras = Object.fromEntries(Object.entries(thread.extras).filter(([id]) => ids.has(id)));
  return JSON.stringify({
    v: VERSION,
    savedAt: now,
    messages,
    extras,
    fromCard: thread.fromCard.filter(id => ids.has(id)),
  });
}

export function readBuildChat(key: string): BuildChatThread | null {
  try {
    return parseStoredBuildChat(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeBuildChat(key: string, thread: BuildChatThread): void {
  try {
    if (thread.messages.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, serializeBuildChat(thread));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a reload.
  }
}
