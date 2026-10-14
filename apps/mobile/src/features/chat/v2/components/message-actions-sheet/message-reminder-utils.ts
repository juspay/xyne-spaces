import type { ChannelScopeType } from '@xyne/shared';
import { decodeBasicEntitiesExact, HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

const REMINDER_PREVIEW_MAX_LENGTH = 140;

export type ReminderMetadataContext = {
  messagePreview: string;
  conversationId: string;
  initialMessageId: string;
  channelId: string;
  threadId?: string;
  channelName?: string;
  channelScopeType?: ChannelScopeType;
  senderName?: string;
};

export type PendingReminderMetadata = ReminderMetadataContext & {
  enabled: true;
  remindAt: string;
  status: 'PENDING';
  createdAt: string;
  updatedAt: string;
};

const metadataRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const reminderTimestamp = (remindAt: unknown): number | null => {
  if (typeof remindAt === 'number' && Number.isFinite(remindAt)) return remindAt;
  if (typeof remindAt !== 'string') return null;
  const parsed = Date.parse(remindAt);
  return Number.isFinite(parsed) ? parsed : null;
};

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
    ...(context.channelScopeType ? { channelScopeType: context.channelScopeType } : {}),
    ...(context.senderName ? { senderName: context.senderName } : {}),
    createdAt:
      typeof previousReminder['createdAt'] === 'string' ? previousReminder['createdAt'] : now,
    updatedAt: now,
  } satisfies PendingReminderMetadata;

  delete nextMetadata['completion'];
  delete nextMetadata['snoozeUntil'];

  return nextMetadata;
};

export const getPendingReminderFromMetadata = (
  metadata: unknown,
): PendingReminderMetadata | null => {
  const reminder = metadataRecord(metadataRecord(metadata)['reminder']);
  if (reminder['enabled'] !== true) return null;
  if (reminder['status'] !== 'PENDING') return null;
  const remindAt = reminder['remindAt'];
  if (reminderTimestamp(remindAt) === null) return null;

  return reminder as PendingReminderMetadata;
};

export const getReminderDueInLabel = (reminder: PendingReminderMetadata): string => {
  const remindAt = reminderTimestamp(reminder.remindAt);
  if (remindAt === null) return 'Reminder Set';

  const diff = remindAt - Date.now();
  if (diff <= 0) return 'Due now';

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) return `Due in ${Math.max(1, Math.round(diff / minute))}m`;
  if (diff < day) return `Due in ${Math.max(1, Math.round(diff / hour))}h`;
  if (diff < 7 * day) return `Due in ${Math.max(1, Math.round(diff / day))}d`;

  return `Due ${new Date(remindAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`;
};

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
