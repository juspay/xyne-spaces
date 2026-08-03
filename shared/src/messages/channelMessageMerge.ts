import type {
  Conversation,
  ThreadConversation,
} from '../machines/queryCacheMachine.js';

export const compareConversations = (
  left: Conversation,
  right: Conversation,
): number =>
  left.createdAt - right.createdAt ||
  left.conversationId.localeCompare(right.conversationId);

export const dedupeAndSortConversations = (
  current: readonly Conversation[],
  incoming: readonly Conversation[],
): Conversation[] => {
  const byId = new Map<string, Conversation>();
  for (const conversation of current) {
    byId.set(conversation.conversationId, conversation);
  }
  for (const conversation of incoming) {
    byId.set(conversation.conversationId, conversation);
  }
  return Array.from(byId.values()).sort(compareConversations);
};

type ThreadMessage = ThreadConversation['messages'][number];

const compareThreadMessages = (
  rootMessageId: string | undefined,
  left: ThreadMessage,
  right: ThreadMessage,
): number => {
  if (rootMessageId === left.messageId) return -1;
  if (rootMessageId === right.messageId) return 1;
  return (
    left.createdAt - right.createdAt ||
    left.messageId.localeCompare(right.messageId)
  );
};

/**
 * Deduplicates thread rows by message identity and keeps the thread root first.
 * The second argument wins on a collision, which lets callers pass pending rows
 * first and authoritative/live rows second.
 */
const dedupeAndSortThreadMessages = (
  current: readonly ThreadMessage[],
  incoming: readonly ThreadMessage[],
): ThreadMessage[] => {
  const byMessageId = new Map<string, ThreadMessage>();
  for (const message of current) {
    byMessageId.set(message.messageId, message);
  }
  for (const message of incoming) {
    byMessageId.set(message.messageId, message);
  }

  const rootMessageId = incoming[0]?.messageId ?? current[0]?.messageId;
  return Array.from(byMessageId.values()).sort((left, right) =>
    compareThreadMessages(rootMessageId, left, right),
  );
};

/**
 * Merges server/live channel rows with pending render rows. Server rows win by
 * both render identity and initial-message identity; pending state itself is
 * not removed here, because an optimistic local row can still roll back.
 */
export const mergeServerAndPendingConversations = (
  serverRows: readonly Conversation[],
  pendingRows: readonly Conversation[],
): Conversation[] => {
  const serverConversationIds = new Set(
    serverRows.map(conversation => conversation.conversationId),
  );
  const serverMessageIds = new Set(
    serverRows
      .map(conversation => conversation.initialMessageId)
      .filter((messageId): messageId is string => Boolean(messageId)),
  );
  const renderablePendingRows = pendingRows.filter(
    row =>
      !serverConversationIds.has(row.conversationId) &&
      !serverMessageIds.has(row.initialMessageId),
  );

  return dedupeAndSortConversations(renderablePendingRows, serverRows);
};

/**
 * Merges server/live thread messages with pending render rows. Message identity
 * is the only valid thread render key; the shared conversation id identifies the
 * thread container and must not remove an unrelated pending reply.
 */
export const mergeServerAndPendingThreadMessages = (
  serverRows: readonly ThreadMessage[],
  pendingRows: readonly ThreadMessage[],
): ThreadMessage[] => {
  const serverMessageIds = new Set(
    serverRows.map(message => message.messageId),
  );
  const renderablePendingRows = pendingRows.filter(
    message => !serverMessageIds.has(message.messageId),
  );

  return dedupeAndSortThreadMessages(renderablePendingRows, serverRows);
};

/** Replaces one live viewport window without disturbing rows outside that window. */
export const reconcileConversationWindow = (
  current: Conversation[],
  incomingWindow: Conversation[],
): Conversation[] => {
  if (incomingWindow.length === 0) return current;

  const incoming = [...incomingWindow].sort(compareConversations);
  const incomingById = new Map(
    incoming.map(conversation => [conversation.conversationId, conversation]),
  );
  const first = incoming[0];
  const last = incoming[incoming.length - 1];
  if (!first || !last) return current;

  const reconciled = current
    .filter(
      conversation =>
        conversation.createdAt < first.createdAt ||
        conversation.createdAt > last.createdAt ||
        incomingById.has(conversation.conversationId),
    )
    .map(conversation => incomingById.get(conversation.conversationId) ?? conversation);

  return dedupeAndSortConversations(reconciled, incoming);
};

/**
 * Merges the currently rendered `fetched` list with a live `latest` tail window.
 *
 * Matches dashboard's `mergeWithLatest` in ChatListV4.tsx exactly:
 *   - Overlap: trim `fetched` to the tail portion strictly OLDER than the
 *     overlap point, then append `latest`. `latestClear: true` signals the
 *     caller may drop the queued `latestConversationsListRef`.
 *   - Disjoint: return `fetched` alone and `latestClear: false`. The tail
 *     is not merged into the main list — callers keep it as a queued "new
 *     messages" pill until the user scrolls into range. This is critical
 *     for anchored opens (unread boundary, deeplink) where the fetched
 *     window sits far above `latest` and eager merging would drag the
 *     bottom of the list onto the tail and hide the anchor context.
 *   - Empty latest: pass fetched through unchanged.
 *   - Empty fetched: promote latest after initial load, or immediately for a
 *     normal unanchored open. Anchored opens keep waiting for their
 *     authoritative window.
 */
export const mergeConversationsWithLatest = (
  fetched: Conversation[],
  latest: Conversation[],
  isInitialLoadComplete: boolean,
  allowProvisionalPromotion = false,
): { merged: Conversation[]; latestClear: boolean } => {
  if (latest.length === 0) {
    return { merged: dedupeAndSortConversations(fetched, []), latestClear: false };
  }
  if (fetched.length === 0) {
    return isInitialLoadComplete || allowProvisionalPromotion
      ? { merged: dedupeAndSortConversations(latest, []), latestClear: true }
      : { merged: [], latestClear: false };
  }

  const sortedFetched = [...fetched].sort(compareConversations);
  const latestIds = new Set(latest.map(conversation => conversation.conversationId));
  const overlapIndex = sortedFetched.findIndex(conversation =>
    latestIds.has(conversation.conversationId),
  );

  if (overlapIndex !== -1) {
    return {
      merged: dedupeAndSortConversations(sortedFetched.slice(0, overlapIndex), latest),
      latestClear: true,
    };
  }

  // Disjoint — do NOT merge latest into the main list. The tail stays queued
  // in the caller's latestConversationsListRef until the fetched window grows
  // to overlap with it (via loadNewer or a follow-up latest emission).
  return {
    merged: dedupeAndSortConversations(fetched, []),
    latestClear: false,
  };
};

export const mergeCachedConversations = (
  cached: Conversation[],
  fetched: Conversation[],
): Conversation[] => {
  // Zero can emit `complete` from its persisted local state before the server diff arrives.
  // Keep a valid warm page during that empty handoff so cached-first opens do not flash blank.
  if (fetched.length === 0) return cached;

  const sortedCached = [...cached].sort(compareConversations);
  const sortedFetched = [...fetched].sort(compareConversations);
  const fetchedIds = new Set(sortedFetched.map(conversation => conversation.conversationId));
  const overlapIndex = sortedCached.findIndex(conversation =>
    fetchedIds.has(conversation.conversationId),
  );

  if (overlapIndex === -1) return sortedFetched;

  const overlapId = sortedCached[overlapIndex]!.conversationId;
  const fetchedOverlapIndex = sortedFetched.findIndex(
    conversation => conversation.conversationId === overlapId,
  );
  return fetchedOverlapIndex === 0
    ? dedupeAndSortConversations(sortedCached.slice(0, overlapIndex), sortedFetched)
    : dedupeAndSortConversations(sortedFetched, sortedCached.slice(overlapIndex + 1));
};
