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

/**
 * A remembered row, but only while it still belongs to the open chat.
 *
 * The badge keeps the last row it resolved so it cannot blank mid-move. Reused
 * without this check, opening a chat that no cached list holds fell back to the
 * PREVIOUS chat's row — so the header named the wrong chat's project, and a move
 * from that badge moved the wrong chat.
 */
export function rememberedSessionFor<T extends { sessionId: string }>(
  remembered: T | null | undefined,
  conversationId: string | null | undefined,
): T | null {
  if (!remembered || !conversationId) return null;
  return remembered.sessionId === conversationId ? remembered : null;
}

/**
 * The session the project badge should describe.
 *
 * `moved` is what the user just picked, honoured until the cached lists agree:
 * applying a move drops the row from the old project's list while the new
 * project's list is usually not loaded, so for a moment no list holds it.
 * `undefined` means nothing is pending — distinct from `null`, which is a
 * deliberate "remove from project".
 */
export function sessionWithPendingProject<T extends { projectId?: string | null }>(
  resolved: T | null | undefined,
  moved: string | null | undefined,
): T | null {
  if (!resolved) return null;
  if (moved === undefined) return resolved;
  return { ...resolved, projectId: moved };
}
