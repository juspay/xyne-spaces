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
