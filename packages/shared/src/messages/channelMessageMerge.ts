import type { Conversation, ThreadConversation } from '../machines/queryCacheMachine.js';

export const compareConversations = (left: Conversation, right: Conversation): number =>
  left.createdAt - right.createdAt || left.conversationId.localeCompare(right.conversationId);

export const dedupeAndSortConversations = (
  current: readonly Conversation[],
  incoming: readonly Conversation[],
): Conversation[] => {
  const byId = new Map<string, Conversation>();
  for (const conversation of current) byId.set(conversation.conversationId, conversation);
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
  return left.createdAt - right.createdAt || left.messageId.localeCompare(right.messageId);
};

/**
 * Dedupes thread rows by message identity and keeps the thread root first.
 * The second argument wins a collision, so callers pass pending rows first and
 * authoritative rows second.
 */
const dedupeAndSortThreadMessages = (
  current: readonly ThreadMessage[],
  incoming: readonly ThreadMessage[],
  rootMessageId?: string | null,
): ThreadMessage[] => {
  const byMessageId = new Map<string, ThreadMessage>();
  for (const message of current) byMessageId.set(message.messageId, message);
  for (const message of incoming) byMessageId.set(message.messageId, message);

  const resolvedRootMessageId = rootMessageId ?? incoming[0]?.messageId ?? current[0]?.messageId;
  return Array.from(byMessageId.values()).sort((left, right) =>
    compareThreadMessages(resolvedRootMessageId, left, right),
  );
};

/**
 * Merges server/live channel rows with optimistic pending rows. A server row
 * wins by BOTH render identity and initial-message identity — matching only on
 * `initialMessageId` leaves a pending row rendered beside the server row that
 * replaced it. Pending state itself is not cleared here, because an optimistic
 * row can still roll back.
 */
export const mergeServerAndPendingConversations = (
  serverRows: readonly Conversation[],
  pendingRows: readonly Conversation[],
): Conversation[] => {
  const serverConversationIds = new Set(serverRows.map(row => row.conversationId));
  const serverMessageIds = new Set(
    serverRows
      .map(row => row.initialMessageId)
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
 * Merges server/live thread messages with pending rows. Message identity is the
 * only valid thread render key: the conversation id identifies the thread
 * container, so matching on it would drop an unrelated pending reply.
 */
export const mergeServerAndPendingThreadMessages = (
  serverRows: readonly ThreadMessage[],
  pendingRows: readonly ThreadMessage[],
  rootMessageId?: string | null,
): ThreadMessage[] => {
  return dedupeAndSortThreadMessages(pendingRows, serverRows, rootMessageId);
};

export type ConversationWindowReconcileOptions = {
  /** Lower createdAt boundary supplied by a cursor. */
  lowerBound?: number;
  /** Cursor queries are exclusive unless the query explicitly says otherwise. */
  lowerBoundInclusive?: boolean;
  /** An anchor is removable only when the query includes it in its result. */
  anchorConversationId?: string;
  anchorIncludesResult?: boolean;
};

/** Replaces one live viewport window without disturbing rows outside that window. */
export const reconcileConversationWindow = (
  current: Conversation[],
  incomingWindow: Conversation[],
  options: ConversationWindowReconcileOptions = {},
): Conversation[] => {
  if (incomingWindow.length === 0) return current;

  const incoming = [...incomingWindow].sort(compareConversations);
  const incomingById = new Map(
    incoming.map(conversation => [conversation.conversationId, conversation]),
  );
  const first = incoming[0];
  const last = incoming[incoming.length - 1];
  if (!first || !last) return current;

  // The live query is a bounded window, not a complete channel snapshot.
  // Replace rows inside the timestamp range represented by this emission and
  // retain rows outside it. Using the returned timestamps (rather than waiting
  // for the last returned id) is important when the boundary row is new and
  // therefore does not exist in `current`.
  const lowerBound = options.lowerBound ?? first.createdAt;
  const lowerBoundInclusive = options.lowerBoundInclusive ?? true;
  const itemsToDelete = new Set<string>();
  for (const conversation of current) {
    const afterLowerBound = lowerBoundInclusive
      ? conversation.createdAt >= lowerBound
      : conversation.createdAt > lowerBound;
    const insideWindow = afterLowerBound && conversation.createdAt <= last.createdAt;
    if (insideWindow && !incomingById.has(conversation.conversationId)) {
      itemsToDelete.add(conversation.conversationId);
    }
  }
  // Forward cursor queries include their anchor. If it disappears, remove it;
  // backward queries are exclusive and must retain an absent anchor because
  // absence is normal rather than evidence of deletion.
  if (
    options.anchorIncludesResult &&
    options.anchorConversationId &&
    !incomingById.has(options.anchorConversationId)
  ) {
    itemsToDelete.add(options.anchorConversationId);
  }

  const replaced = current
    .filter(conversation => !itemsToDelete.has(conversation.conversationId))
    .map(conversation => incomingById.get(conversation.conversationId) ?? conversation);

  return dedupeAndSortConversations(replaced, incoming);
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
 *   - Empty fetched: promote latest after initial load, or immediately when
 *     the caller opted into provisional promotion for an unanchored open.
 *     Anchored opens keep waiting for their authoritative window.
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
