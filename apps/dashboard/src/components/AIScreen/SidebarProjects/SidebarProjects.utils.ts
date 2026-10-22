const EXPANDED_STORAGE_PREFIX = 'xyne.ai.sidebar.projects.expanded';

export function expandedStorageKey(userId: string | undefined): string {
  return userId ? `${EXPANDED_STORAGE_PREFIX}.${userId}` : EXPANDED_STORAGE_PREFIX;
}

export function readExpandedProjectIds(userId: string | undefined): string[] {
  try {
    const raw = window.localStorage.getItem(expandedStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function writeExpandedProjectIds(userId: string | undefined, ids: string[]): void {
  try {
    window.localStorage.setItem(expandedStorageKey(userId), JSON.stringify(ids));
  } catch {
    return;
  }
}

export const DEFAULT_PROJECT_ICON = '📁';

export const PROJECT_NAME_MAX_CHARS = 80;

/**
 * Whether a chat can be filed into a project.
 *
 * Mirrors isDirectChatConversation in claw-auth, which the conversation PATCH
 * uses to answer 400 "Only direct chats can be moved into a project". A Spaces
 * thread lists one row per agent while membership is keyed by conversation
 * alone, so it cannot be filed — offering the option on those rows only ever
 * produced "Could not move chat".
 */
export function canFileSession(session: { sessionId: string }): boolean {
  return session.sessionId.startsWith('chat-');
}

/**
 * The row for a conversation, looked for across every cached list view.
 *
 * The unfiltered view holds only its first page, so a chat opened from a
 * project's own list in the sidebar is routinely absent from it while sitting
 * in that project's view. Reading every view is what lets the chat header name
 * the project the open chat is in without a request of its own.
 *
 * Takes pages already read out of the cache rather than a QueryClient: the
 * caller owns the cache, this owns the search, and the search stays testable
 * without loading the API client.
 */
export function findSessionInCachedPages<T extends { sessionId: string }>(
  views: Array<Array<{ conversations: T[] }> | undefined>,
  conversationId: string,
): T | null {
  for (const pages of views) {
    for (const page of pages ?? []) {
      const match = page.conversations.find(row => row.sessionId === conversationId);
      if (match) {
        return match;
      }
    }
  }
  return null;
}
