import { BookmarkEntityType, ChannelScopeType, type Bookmark as BookmarkRow } from '@xyne/shared';

const PREVIEW_MAX_LENGTH = 180;

export type BookmarkTab = 'all' | 'reminder' | 'complete';

export type BookmarkReminderRecord = {
  channelId?: string;
  channelName?: string;
  channelScopeType?: string;
  conversationId?: string;
  enabled?: boolean;
  initialMessageId?: string;
  messagePreview?: string;
  remindAt?: string;
  senderName?: string;
  status?: string;
  threadId?: string;
};

export type HydratedBookmarkMessage = {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: number;
  hasAttachment: boolean;
  isDeleted: boolean;
  conversation?: {
    channelId?: string;
    conversationId?: string;
    initialMessageId?: string;
    createdAt?: number;
  } | null;
  attachments?: readonly unknown[] | null;
};

export const BOOKMARK_TABS: readonly { id: BookmarkTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'complete', label: 'Complete' },
];

const metadataRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (record: Record<string, unknown> | null, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const REMINDER_STRING_FIELDS = [
  'channelId',
  'channelName',
  'channelScopeType',
  'conversationId',
  'initialMessageId',
  'messagePreview',
  'remindAt',
  'senderName',
  'status',
  'threadId',
] as const;

export const readReminderRecord = (metadata: unknown): BookmarkReminderRecord | null => {
  const reminder = metadataRecord(metadataRecord(metadata)?.['reminder']);
  if (!reminder) return null;

  const context = metadataRecord(reminder['context']);
  const out: BookmarkReminderRecord = {};

  for (const field of REMINDER_STRING_FIELDS) {
    const value = readString(reminder, field) ?? readString(context, field);
    if (!value) continue;

    switch (field) {
      case 'channelId':
        out.channelId = value;
        break;
      case 'channelName':
        out.channelName = value;
        break;
      case 'channelScopeType':
        out.channelScopeType = value;
        break;
      case 'conversationId':
        out.conversationId = value;
        break;
      case 'initialMessageId':
        out.initialMessageId = value;
        break;
      case 'messagePreview':
        out.messagePreview = value;
        break;
      case 'remindAt':
        out.remindAt = value;
        break;
      case 'senderName':
        out.senderName = value;
        break;
      case 'status':
        out.status = value;
        break;
      case 'threadId':
        out.threadId = value;
        break;
    }
  }

  if (typeof reminder['enabled'] === 'boolean') {
    out.enabled = reminder['enabled'];
  }

  return out;
};

export const isBookmarkMarkedDone = (metadata: unknown): boolean => {
  const completion = metadataRecord(metadataRecord(metadata)?.['completion']);
  const completedAt = completion?.['completedAt'];
  return (
    completion?.['done'] === true && typeof completedAt === 'string' && completedAt.trim() !== ''
  );
};

export const getCompletionTimestamp = (bookmark: BookmarkRow): number => {
  const completion = metadataRecord(metadataRecord(bookmark.metadata)?.['completion']);
  const completedAt = completion?.['completedAt'];
  if (typeof completedAt === 'string') {
    const parsed = Date.parse(completedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return bookmark.updatedAt;
};

export const isMessageBookmark = (bookmark: BookmarkRow): boolean =>
  bookmark.entityType === BookmarkEntityType.MESSAGE && !bookmark.isDeleted;

export const isCompletedBookmark = (bookmark: BookmarkRow): boolean =>
  bookmark.isCompleted || isBookmarkMarkedDone(bookmark.metadata);

export const isCompletedMessageBookmark = (bookmark: BookmarkRow): boolean =>
  isMessageBookmark(bookmark) && isCompletedBookmark(bookmark);

export const isActiveMessageBookmark = (bookmark: BookmarkRow): boolean =>
  isMessageBookmark(bookmark) && !isCompletedBookmark(bookmark);

export const isActiveBookmark = (bookmark: BookmarkRow): boolean =>
  !bookmark.isDeleted && !isCompletedBookmark(bookmark);

const bookmarkEntityKey = (bookmark: BookmarkRow): string =>
  `${bookmark.entityType}:${bookmark.entityId}`;

export const getReminderTimestamp = (bookmark: BookmarkRow): number | null => {
  const reminder = readReminderRecord(bookmark.metadata);
  if (!reminder?.remindAt) return null;
  const parsed = Date.parse(reminder.remindAt);
  return Number.isFinite(parsed) ? parsed : null;
};

export const hasActiveReminder = (bookmark: BookmarkRow): boolean => {
  const reminder = readReminderRecord(bookmark.metadata);
  if (!reminder) return false;
  if (reminder.enabled === false) return false;
  if (reminder.status === 'SENT' || reminder.status === 'CANCELLED') return false;
  return getReminderTimestamp(bookmark) !== null;
};

export const compareActiveBookmarks = (a: BookmarkRow, b: BookmarkRow): number => {
  const now = Date.now();
  const reminderA = getReminderTimestamp(a);
  const reminderB = getReminderTimestamp(b);
  const rankA = reminderA === null ? 2 : reminderA <= now ? 0 : 1;
  const rankB = reminderB === null ? 2 : reminderB <= now ? 0 : 1;

  if (rankA !== rankB) return rankA - rankB;
  if (rankA !== 2 && reminderA !== null && reminderB !== null) {
    return reminderA - reminderB;
  }
  return b.createdAt - a.createdAt;
};

export const compareCompletedBookmarks = (a: BookmarkRow, b: BookmarkRow): number =>
  b.updatedAt - a.updatedAt;

export const partitionMessageBookmarks = (
  bookmarks: readonly BookmarkRow[],
): {
  all: BookmarkRow[];
  reminder: BookmarkRow[];
  complete: BookmarkRow[];
} => {
  const messageBookmarks = bookmarks.filter(isMessageBookmark);
  const all = messageBookmarks.filter(isActiveMessageBookmark).sort(compareActiveBookmarks);
  const reminder = all.filter(hasActiveReminder);
  const activeKeys = new Set(all.map(bookmarkEntityKey));
  const seenIds = new Set<string>();
  const complete = messageBookmarks
    .filter(isCompletedMessageBookmark)
    .filter(bookmark => {
      if (seenIds.has(bookmark.id)) return false;
      seenIds.add(bookmark.id);
      return !activeKeys.has(bookmarkEntityKey(bookmark));
    })
    .sort(compareCompletedBookmarks);

  return { all, reminder, complete };
};

export const truncateBookmarkPreview = (value: string): string =>
  value.length > PREVIEW_MAX_LENGTH ? `${value.slice(0, PREVIEW_MAX_LENGTH - 1)}...` : value;

export const formatBookmarkDateLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const formatReminderFallbackLabel = (reminder: BookmarkReminderRecord): string => {
  if (reminder.status === 'SENT') return 'Reminder sent';
  if (reminder.status === 'CANCELLED') return 'Reminder cancelled';
  if (reminder.remindAt) {
    const parsed = Date.parse(reminder.remindAt);
    if (Number.isFinite(parsed)) {
      return `Reminder for ${new Date(parsed).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })}`;
    }
  }
  return 'Reminder set';
};

export const normalizeScopeType = (value: string | undefined): ChannelScopeType | undefined => {
  if (
    value === ChannelScopeType.DEFAULT ||
    value === ChannelScopeType.DM ||
    value === ChannelScopeType.GROUP_DM ||
    value === ChannelScopeType.TICKET ||
    value === ChannelScopeType.DOCUMENT
  ) {
    return value;
  }
  return undefined;
};

export const getBookmarkSurface = (scopeType: string | undefined): 'channels' | 'dms' =>
  scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM ? 'dms' : 'channels';

export type BookmarkChatOpenTarget = {
  channelId: string;
  messageId: string;
  conversationId?: string;
  threadId?: string;
  createdAt?: number;
  surface: 'channels' | 'dms';
  scopeType?: ChannelScopeType;
};

/**
 * Builds the chat-open payload for a bookmark row. Channel opens must include
 * `createdAt` so the list can load the linked historical window instead of the
 * latest page (which cannot reach very old messages within expansion budget).
 */
export const resolveBookmarkChatOpenTarget = ({
  bookmarkEntityId,
  channelId,
  conversationId,
  scopeType,
  reminder,
  hydratedMessage,
}: {
  bookmarkEntityId: string;
  channelId: string;
  conversationId?: string | null | undefined;
  scopeType?: string | undefined;
  reminder?: BookmarkReminderRecord | null | undefined;
  hydratedMessage?: HydratedBookmarkMessage | null | undefined;
}): BookmarkChatOpenTarget | null => {
  const trimmedChannelId = channelId.trim();
  if (!trimmedChannelId) return null;

  const resolvedConversationId =
    (typeof conversationId === 'string' && conversationId.trim()
      ? conversationId.trim()
      : undefined) ??
    (typeof reminder?.conversationId === 'string' && reminder.conversationId.trim()
      ? reminder.conversationId.trim()
      : undefined) ??
    (typeof hydratedMessage?.conversation?.conversationId === 'string' &&
    hydratedMessage.conversation.conversationId.trim()
      ? hydratedMessage.conversation.conversationId.trim()
      : undefined) ??
    (typeof hydratedMessage?.conversationId === 'string' && hydratedMessage.conversationId.trim()
      ? hydratedMessage.conversationId.trim()
      : undefined);

  const initialMessageId =
    reminder?.initialMessageId ?? hydratedMessage?.conversation?.initialMessageId;
  const threadId =
    reminder?.threadId ??
    (initialMessageId && initialMessageId !== bookmarkEntityId && resolvedConversationId
      ? resolvedConversationId
      : undefined);

  const conversationCreatedAt =
    typeof hydratedMessage?.conversation?.createdAt === 'number' &&
    Number.isFinite(hydratedMessage.conversation.createdAt)
      ? hydratedMessage.conversation.createdAt
      : typeof hydratedMessage?.createdAt === 'number' && Number.isFinite(hydratedMessage.createdAt)
        ? hydratedMessage.createdAt
        : undefined;

  const normalizedScope = normalizeScopeType(scopeType);

  return {
    channelId: trimmedChannelId,
    messageId: bookmarkEntityId,
    ...(resolvedConversationId ? { conversationId: resolvedConversationId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(conversationCreatedAt !== undefined ? { createdAt: conversationCreatedAt } : {}),
    surface: getBookmarkSurface(normalizedScope),
    ...(normalizedScope ? { scopeType: normalizedScope } : {}),
  };
};
