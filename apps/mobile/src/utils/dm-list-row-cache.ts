import type { InitialMessageSummary } from '@xyne/shared';
import { formatChannelTimestamp } from '@xyne/shared/utils';

import type { DmConversation } from '@/src/hooks/useDmsPaginatedMessagesV2';
import type {
  DmListItemData,
  DmListParticipantIdentity,
  LastMessagePreview,
} from '@/src/types/dm-list-item';
import {
  buildLastMessagePreviewFromSummary,
  getVisibleInitialMessageSummary,
} from '@/src/utils/message-preview';

type DmMessageEntry = {
  conversation: DmConversation | undefined;
  summary: InitialMessageSummary | null;
  senderName: string | undefined;
  lastMessage: LastMessagePreview;
};

/**
 * Per-channel derivation cache for the DM list.
 *
 * Building a row means parsing the conversation's initial-message markdown
 * blob and running regexes over it. That work is keyed on the conversation
 * object Zero hands back, which is identity-stable while the message does not
 * change — so on a tick caused by an unrelated unread count, every row is a
 * cache hit. `rows` additionally holds the last emitted row object per channel
 * so an unchanged row keeps its identity and memoised cells can bail out.
 */
export type DmRowCache = {
  messages: Map<string, DmMessageEntry>;
  rows: Map<string, DmListItemData>;
};

export const createDmRowCache = (): DmRowCache => ({
  messages: new Map(),
  rows: new Map(),
});

/** Drops channels that are no longer in the list (archived, workspace switch). */
export const pruneDmRowCache = (cache: DmRowCache, liveChannelIds: ReadonlySet<string>): void => {
  for (const id of cache.messages.keys()) {
    if (!liveChannelIds.has(id)) cache.messages.delete(id);
  }
  for (const id of cache.rows.keys()) {
    if (!liveChannelIds.has(id)) cache.rows.delete(id);
  }
};

/**
 * Parsed summary + built preview for one channel, reusing the cached result
 * whenever the conversation and the resolved sender name are both unchanged.
 *
 * `resolveSenderName` is a callback because the sender id only exists after
 * the parse, and the parse is the thing being cached.
 *
 * `timestampLabel` is deliberately NOT cached. `formatChannelTimestamp` is
 * relative to the current time — a message rolls from a clock time to
 * "Yesterday" to a weekday as it ages — so a label cached against the
 * conversation would keep showing the old wording until that conversation
 * next changed, which for a quiet DM can be days.
 */
export const getCachedDmMessage = (
  cache: DmRowCache,
  channelId: string,
  conversation: DmConversation | undefined,
  currentUserId: string,
  resolveSenderName: (summary: InitialMessageSummary | null) => string | undefined,
): {
  summary: InitialMessageSummary | null;
  lastMessage: LastMessagePreview;
  timestampLabel: string;
} => {
  const entry = cache.messages.get(channelId);
  const isSameConversation = entry !== undefined && entry.conversation === conversation;

  // The parse — reused whenever Zero handed back the same conversation object.
  const summary = isSameConversation
    ? entry.summary
    : getVisibleInitialMessageSummary(conversation, currentUserId);

  const senderName = resolveSenderName(summary);

  // Relative to now, so it is recomputed on every pass and never cached.
  const timestampLabel = conversation?.createdAt
    ? formatChannelTimestamp(conversation.createdAt)
    : '';

  // The preview — reused when the sender name did not move either.
  if (isSameConversation && entry.senderName === senderName) {
    return {
      summary,
      lastMessage: entry.lastMessage,
      timestampLabel,
    };
  }

  const lastMessage = buildLastMessagePreviewFromSummary(summary, currentUserId, senderName);

  cache.messages.set(channelId, {
    conversation,
    summary,
    senderName,
    lastMessage,
  });

  return { summary, lastMessage, timestampLabel };
};

// ─── Row identity reconciliation ──────────────────────────────────────────────
// Moved verbatim from dm-list-row.tsx. It belongs here: the point is to stop
// identities churning at the source, not to paper over the churn in the cell.

const areStringArraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const areParticipantIdentitiesEqual = (
  left: readonly DmListParticipantIdentity[] | undefined,
  right: readonly DmListParticipantIdentity[] | undefined,
): boolean => {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;

  return left.every((identity, index) => {
    const other = right[index];
    return (
      identity.id === other?.id &&
      identity.name === other?.name &&
      identity.displayName === other?.displayName &&
      identity.picture === other?.picture
    );
  });
};

const areLastMessagesEqual = (left: LastMessagePreview, right: LastMessagePreview): boolean => {
  if (left === right) return true;
  if (left.variant !== right.variant) return false;
  if (left.variant === 'text' && right.variant === 'text') {
    return left.text === right.text && left.isEmojiOnly === right.isEmojiOnly;
  }
  if (left.variant === 'system' && right.variant === 'system') {
    return left.text === right.text;
  }
  if (left.variant === 'attachment' && right.variant === 'attachment') {
    return (
      left.attachmentKind === right.attachmentKind &&
      left.text === right.text &&
      left.thumbnailUri === right.thumbnailUri
    );
  }
  return false;
};

const areDmListItemsEqual = (left: DmListItemData, right: DmListItemData): boolean =>
  left.id === right.id &&
  left.title === right.title &&
  areStringArraysEqual(left.participantUserIds, right.participantUserIds) &&
  areParticipantIdentitiesEqual(left.participantIdentities, right.participantIdentities) &&
  left.scopeType === right.scopeType &&
  areLastMessagesEqual(left.lastMessage, right.lastMessage) &&
  left.timestampLabel === right.timestampLabel &&
  left.unreadCount === right.unreadCount &&
  left.lastViewedAt === right.lastViewedAt &&
  left.lastViewedConversationId === right.lastViewedConversationId &&
  left.isLastMessageOutgoing === right.isLastMessageOutgoing &&
  left.isStarred === right.isStarred &&
  left.statusEmoji === right.statusEmoji &&
  left.lastActivityAtMs === right.lastActivityAtMs;

/**
 * Returns the previously emitted row object when nothing visible changed, so a
 * row's identity is stable across ticks and `memo` on the cell actually bails.
 */
export const reconcileDmRow = (cache: DmRowCache, next: DmListItemData): DmListItemData => {
  const previous = cache.rows.get(next.id);
  const row = previous !== undefined && areDmListItemsEqual(previous, next) ? previous : next;
  cache.rows.set(next.id, row);
  return row;
};
