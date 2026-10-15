import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday } from 'date-fns';
import type { QueryResultType } from '@rocicorp/zero';

import { queries } from '@/src/zero/queries';
import { decodeEntitySet, stripHtmlTags } from '@/src/utils/htmlText';

export type DraftsSentTab = 'drafts' | 'scheduled' | 'sent' | 'twin';

export const DRAFTS_SENT_TABS: readonly { id: DraftsSentTab; label: string }[] = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'twin', label: 'Twin drafts' },
  { id: 'sent', label: 'Sent' },
];

export const SENT_PAGE_SIZE = 25;
const PREVIEW_MAX_LENGTH = 180;
const DUE_SOON_MS = 60 * 60 * 1000;

export type DraftMessageRow = QueryResultType<typeof queries.userDrafts>[number] & {
  origin?: string | null;
  metadata?: string | null;
};
export type DelayedMessageRow = QueryResultType<typeof queries.userDelayedMessages>[number];
export type SentMessageRow = QueryResultType<typeof queries.userSentMessagesPaginated>[number];

export type SentListEntry =
  | { type: 'header'; id: string; label: string }
  | { type: 'row'; id: string; message: SentMessageRow };

const DRAFT_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

export const stripDraftHtml = (html: string): string =>
  decodeEntitySet(
    stripHtmlTags(html.replace(/<br\s*\/?>/gi, ' ')),
    DRAFT_ENTITIES,
    Object.keys(DRAFT_ENTITIES),
  )
    .replace(/\s+/g, ' ')
    .trim();

export const truncatePreview = (value: string): string =>
  value.length > PREVIEW_MAX_LENGTH ? `${value.slice(0, PREVIEW_MAX_LENGTH - 1)}...` : value;

export const draftPreviewText = (
  content: string,
  hasAttachment: boolean,
  attachmentFallback = 'Attachment',
  emptyFallback = '(empty draft)',
): string => {
  const plain = stripDraftHtml(content);
  if (plain.length > 0) return truncatePreview(plain);
  if (hasAttachment) return attachmentFallback;
  return emptyFallback;
};

export const canSendDraft = (content: string, hasAttachment: boolean): boolean =>
  stripDraftHtml(content).length > 0 || hasAttachment;

export const compareDrafts = (a: DraftMessageRow, b: DraftMessageRow): number => {
  const updated = b.updatedAt - a.updatedAt;
  if (updated !== 0) return updated;
  return b.id.localeCompare(a.id);
};

export const isVisibleUserDraft = (row: DraftMessageRow): boolean =>
  row.origin !== 'twin' &&
  ((row.content ?? '').trim() !== '' || (row.attachments?.length ?? 0) > 0);

export const compareScheduled = (a: DelayedMessageRow, b: DelayedMessageRow): number => {
  const scheduled = a.scheduledFor - b.scheduledFor;
  if (scheduled !== 0) return scheduled;
  return a.id.localeCompare(b.id);
};

export const sortDrafts = (rows: readonly DraftMessageRow[]): DraftMessageRow[] =>
  [...rows].filter(isVisibleUserDraft).sort(compareDrafts);

export const sortScheduled = (rows: readonly DelayedMessageRow[]): DelayedMessageRow[] =>
  [...rows].filter(row => row.status === 'PENDING').sort(compareScheduled);

export const formatRelativeTimestamp = (timestamp: number): string =>
  formatDistanceToNow(timestamp, { addSuffix: true });

export const formatSentTime = (timestamp: number): string => format(timestamp, 'h:mm a');

export const isScheduledDueSoon = (scheduledFor: number, now = Date.now()): boolean => {
  const remaining = scheduledFor - now;
  return remaining > 0 && remaining <= DUE_SOON_MS;
};

export const formatScheduledChip = (scheduledFor: number): string => {
  const date = new Date(scheduledFor);
  if (isToday(date)) {
    return `Today, ${format(date, 'h:mm a')}`;
  }
  if (isTomorrow(date)) {
    return `Tomorrow, ${format(date, 'h:mm a')}`;
  }
  return `${format(date, 'MMM d, h:mm a')}`;
};

export const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export const formatSentDayLabel = (timestamp: number, now = Date.now()): string => {
  const date = new Date(timestamp);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (new Date(now).getFullYear() === date.getFullYear()) {
    return format(date, 'EEEE, MMMM d');
  }
  return format(date, 'EEEE, MMMM d, yyyy');
};

export const groupSentByDay = (rows: readonly SentMessageRow[]): SentListEntry[] => {
  const entries: SentListEntry[] = [];
  let lastKey: string | null = null;

  for (const message of rows) {
    const key = dayKey(message.createdAt);
    if (key !== lastKey) {
      entries.push({
        type: 'header',
        id: `day-${key}`,
        label: formatSentDayLabel(message.createdAt),
      });
      lastKey = key;
    }
    entries.push({ type: 'row', id: message.messageId, message });
  }

  return entries;
};

export const composerDraftLookupId = (
  channelId: string,
  conversationId: string | null | undefined,
): string => (conversationId ? `${channelId}:${conversationId}` : channelId);

export const isSentThreadReply = (message: SentMessageRow): boolean => {
  const initialMessageId = message.conversation?.initialMessageId;
  return !!initialMessageId && initialMessageId !== message.messageId;
};

export const parseDraftsSentTab = (value: string | undefined): DraftsSentTab => {
  if (value === 'scheduled' || value === 'sent' || value === 'drafts' || value === 'twin') {
    return value;
  }
  return 'drafts';
};
