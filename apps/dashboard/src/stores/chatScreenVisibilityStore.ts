// What the chat screen (ChatView) is actually showing: the channel whose message
// list is visible and the thread whose replies are visible. Null when hidden,
// covered or when ChatView isn't mounted.
export interface ChatScreenVisibility {
  listChannelId: string | null;
  threadId: string | null;
}

const HIDDEN: ChatScreenVisibility = { listChannelId: null, threadId: null };

let current = HIDDEN;
let owner: symbol | null = null;

export function setChatScreenVisibility(writer: symbol, visibility: ChatScreenVisibility): void {
  owner = writer;
  current = visibility;
}

/** Clears only if `writer` still owns the value, so an unmounting ChatView can't wipe a newer one. */
export function clearChatScreenVisibility(writer: symbol): void {
  if (owner !== writer) return;
  owner = null;
  current = HIDDEN;
}

export function getChatScreenVisibility(): ChatScreenVisibility {
  return current;
}

// Which tab each mounted ThreadMessages shows. ChatView only sees ?selectedTab,
// but the panel keeps its own tab when that param is absent.
const threadMessagesShowing = new Map<symbol, { threadId: string; showing: boolean }>();

export function setThreadMessagesShowing(writer: symbol, threadId: string, showing: boolean): void {
  threadMessagesShowing.set(writer, { threadId, showing });
}

export function clearThreadMessagesShowing(writer: symbol): void {
  threadMessagesShowing.delete(writer);
}

/** False until a panel for `threadId` reports its messages tab. */
export function isThreadMessagesShowing(threadId: string): boolean {
  for (const entry of threadMessagesShowing.values()) {
    if (entry.threadId === threadId && entry.showing) return true;
  }
  return false;
}
