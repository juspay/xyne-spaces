/** §8.1 reuse gate: **Adopt** v2 reminder read-path and write-path (presets + upsert). */

import { decodeBasicEntitiesExact, HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

export type PendingReminderMetadata = {
  enabled: true;
  /** Legacy bookmarks may store epoch milliseconds; new writes use ISO strings. */
  remindAt: string | number;
  status: 'PENDING';
};

const metadataRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const reminderTimestamp = (remindAt: unknown): number | null => {
  if (typeof remindAt === 'number' && Number.isFinite(remindAt)) {
    return remindAt;
  }
  if (typeof remindAt !== 'string') {
    return null;
  }
  const parsed = Date.parse(remindAt);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getPendingReminderFromMetadata = (
  metadata: unknown,
): PendingReminderMetadata | null => {
  const reminder = metadataRecord(metadataRecord(metadata)['reminder']);
  if (reminder['enabled'] !== true) {
    return null;
  }
  if (reminder['status'] !== 'PENDING') {
    return null;
  }
  const remindAt = reminder['remindAt'];
  if (reminderTimestamp(remindAt) === null) {
    return null;
  }
  return { enabled: true, remindAt: remindAt as string | number, status: 'PENDING' };
};

export const getReminderDueInLabel = (reminder: PendingReminderMetadata): string => {
  const remindAt = reminderTimestamp(reminder.remindAt);
  if (remindAt === null) {
    return 'Reminder Set';
  }
  const diff = remindAt - Date.now();
  if (diff <= 0) {
    return 'Due now';
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) {
    return `Due in ${Math.max(1, Math.round(diff / minute))}m`;
  }
  if (diff < day) {
    return `Due in ${Math.max(1, Math.round(diff / hour))}h`;
  }
  if (diff < 7 * day) {
    return `Due in ${Math.max(1, Math.round(diff / day))}d`;
  }
  return `Due ${new Date(remindAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
};

export type ReminderMetadataContext = {
  messagePreview: string;
  conversationId: string;
  initialMessageId: string;
  channelId: string;
  threadId?: string;
  channelName?: string;
  senderName?: string;
};

export type ReminderPreset = {
  id: string;
  label: string;
  getTime: () => number;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const CUSTOM_REMINDER_DEFAULT_DELAY_MS = HOUR_MS;

const nextTimeAt = (hour: number, minute: number, dayOffset: number): number => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
};

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { id: '20m', label: 'In 20 minutes', getTime: (): number => Date.now() + 20 * MINUTE_MS },
  { id: '1h', label: 'In 1 hour', getTime: (): number => Date.now() + HOUR_MS },
  { id: 'tomorrow', label: 'Tomorrow morning', getTime: (): number => nextTimeAt(9, 0, 1) },
  { id: 'next-week', label: 'Next week', getTime: (): number => Date.now() + 7 * DAY_MS },
];

export const upsertReminderMetadataWithContext = (
  metadata: unknown,
  remindAtMs: number,
  context: ReminderMetadataContext,
): Record<string, unknown> => {
  const nextMetadata = metadataRecord(metadata);
  const previousReminder = metadataRecord(nextMetadata['reminder']);
  const now = new Date().toISOString();
  nextMetadata['reminder'] = {
    ...previousReminder,
    enabled: true,
    remindAt: new Date(remindAtMs).toISOString(),
    status: 'PENDING',
    messagePreview: context.messagePreview,
    conversationId: context.conversationId,
    initialMessageId: context.initialMessageId,
    channelId: context.channelId,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    ...(context.channelName ? { channelName: context.channelName } : {}),
    ...(context.senderName ? { senderName: context.senderName } : {}),
    createdAt:
      typeof previousReminder['createdAt'] === 'string' ? previousReminder['createdAt'] : now,
    updatedAt: now,
  };
  delete nextMetadata['completion'];
  delete nextMetadata['snoozeUntil'];
  return nextMetadata;
};

const REMINDER_PREVIEW_MAX_LENGTH = 140;

export const buildReminderMessagePreview = (
  content: string | null | undefined,
  hasAttachment: boolean,
): string => {
  const text = decodeBasicEntitiesExact(
    stripHtmlTags(
      (content ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
        .replace(/<img[^>]*data-emoji="true"[^>]*alt="([^"]*)"[^>]*>/gi, '$1'),
      HTML_TAG_OR_EMPTY,
    ),
  )
    .replace(/\s+/g, ' ')
    .trim();
  const preview = text || (hasAttachment ? 'Attachment' : 'Message');
  return preview.length > REMINDER_PREVIEW_MAX_LENGTH
    ? `${preview.slice(0, REMINDER_PREVIEW_MAX_LENGTH - 1)}...`
    : preview;
};

export const mergeDatePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  return next;
};

export const mergeTimePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
};

export const isFutureReminder = (remindAtMs: number, nowMs: number): boolean => remindAtMs > nowMs;

export type ReminderBookmark = {
  entityId: string;
  entityType: string;
  metadata: unknown;
};

export const reminderLabelByMessageId = (
  bookmarks: readonly ReminderBookmark[] | undefined,
): ReadonlyMap<string, string> => {
  const next = new Map<string, string>();
  if (!bookmarks) {
    return next;
  }
  for (const bookmark of bookmarks) {
    if (bookmark.entityType !== 'MESSAGE') {
      continue;
    }
    const pending = getPendingReminderFromMetadata(bookmark.metadata);
    if (!pending) {
      continue;
    }
    next.set(bookmark.entityId, `Reminder Set - ${getReminderDueInLabel(pending)}`);
  }
  return next;
};
