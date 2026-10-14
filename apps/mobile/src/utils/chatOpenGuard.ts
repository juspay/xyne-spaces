export const CHAT_OPEN_GUARD_WINDOW_MS = 4_000;
type ChatOpenGuardEntry = {
  attemptId: ChatOpenAttemptId;
  timeout: ReturnType<typeof setTimeout>;
};

const inFlightChatOpens = new Map<string, ChatOpenGuardEntry>();
const keyByAttemptId = new Map<ChatOpenAttemptId, string>();
let nextChatOpenAttempt = 0;

export type ChatOpenAttemptId = string;

export type ChatOpenGuardTarget = {
  channelId: string;
  threadId?: string | undefined;
  conversationId?: string | undefined;
  messageId?: string | undefined;
};

export const getChatOpenGuardKey = ({
  channelId,
  threadId,
  conversationId,
  messageId,
}: ChatOpenGuardTarget): string => {
  const containerId = threadId ?? conversationId ?? 'channel';
  return `${channelId}:${containerId}:${messageId ?? ''}`;
};

/** Covers duplicate taps in the short window before navigation state commits. */
export const tryBeginChatOpen = (target: ChatOpenGuardTarget): ChatOpenAttemptId | null => {
  const key = getChatOpenGuardKey(target);
  if (inFlightChatOpens.has(key)) {
    return null;
  }

  const attemptId = `chat-open-${++nextChatOpenAttempt}`;
  const timeout = setTimeout(() => {
    const current = inFlightChatOpens.get(key);
    if (current?.attemptId !== attemptId) return;
    inFlightChatOpens.delete(key);
    keyByAttemptId.delete(attemptId);
  }, CHAT_OPEN_GUARD_WINDOW_MS);
  inFlightChatOpens.set(key, { attemptId, timeout });
  keyByAttemptId.set(attemptId, key);
  return attemptId;
};

/** Returns the active attempt so a repeated tap can re-assert the same route. */
export const getChatOpenAttemptId = (target: ChatOpenGuardTarget): ChatOpenAttemptId | null => {
  return inFlightChatOpens.get(getChatOpenGuardKey(target))?.attemptId ?? null;
};

export const releaseChatOpen = (attemptId: ChatOpenAttemptId | null | undefined): void => {
  if (!attemptId) return;
  const key = keyByAttemptId.get(attemptId);
  if (!key) return;
  const entry = inFlightChatOpens.get(key);
  if (entry?.attemptId !== attemptId) return;
  clearTimeout(entry.timeout);
  inFlightChatOpens.delete(key);
  keyByAttemptId.delete(attemptId);
};
