import type { DraftChatMessage, DraftChatThread } from './useDraftChat';

/**
 * The test chat, kept for one draft for as long as the tab is open. Connecting
 * an account leaves the page for the provider's sign-in and reloads it on the
 * way back; without this the test conversation would be gone. Leaving the
 * create page in the app clears it, as it does the conversation on claw.
 */
export interface StoredDraftChat {
  threads: DraftChatThread[];
  activeThreadId: string;
  /** Whether the chat was open, so it comes back as it was. */
  open: boolean;
}

export function draftChatStorageKey(draftKey: string): string {
  return `${draftKey}:test-chat`;
}

function isMessage(value: unknown): value is DraftChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<DraftChatMessage>;
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}

/** A reply cut off by the reload can't resume: it stops where it got to. */
function settled(message: DraftChatMessage): DraftChatMessage {
  if (!message.streaming) return message;
  const { streaming: _streaming, ...rest } = message;
  return rest.content || rest.error ? rest : { ...rest, error: 'Stopped when the page reloaded.' };
}

export function parseStoredDraftChat(raw: string | null): StoredDraftChat | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDraftChat>;
    if (!Array.isArray(value.threads) || typeof value.activeThreadId !== 'string') return null;
    const threads = value.threads.flatMap(thread =>
      thread && typeof thread.id === 'string' && Array.isArray(thread.messages)
        ? [{ id: thread.id, messages: thread.messages.filter(isMessage).map(settled) }]
        : [],
    );
    if (!threads.some(thread => thread.id === value.activeThreadId)) return null;
    return { threads, activeThreadId: value.activeThreadId, open: value.open === true };
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readDraftChat(key: string, storage = sessionStore()): StoredDraftChat | null {
  try {
    return parseStoredDraftChat(storage?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

export function writeDraftChat(
  key: string,
  value: StoredDraftChat,
  storage = sessionStore(),
): void {
  try {
    if (value.threads.every(thread => thread.messages.length === 0)) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the chat still works, it just won't survive a reload.
  }
}

export function clearStoredDraftChat(key: string, storage = sessionStore()): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
