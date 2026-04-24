export type ReminderStatus = 'PENDING' | 'SENT' | 'DISMISSED';

export interface ReminderNotificationContext {
  messagePreview?: string | undefined;
  conversationId?: string | undefined;
  initialMessageId?: string | undefined;
  channelId?: string | undefined;
  channelName?: string | undefined;
  channelScopeType?: string | undefined;
  senderName?: string | undefined;
}

export interface ReminderMetadata {
  enabled: boolean;
  remindAt: string;
  status: ReminderStatus;
  context?: ReminderNotificationContext | undefined;
}

export interface BookmarkCompletionMetadata {
  done: true;
  completedAt: string;
}

export interface BookmarkMetadata {
  reminder?: ReminderMetadata | null;
  completion?: BookmarkCompletionMetadata | null;
  [key: string]: unknown;
}

const LEGACY_REMINDER_AT_METADATA_KEY = 'snoozeUntil';
const COMPLETION_METADATA_KEY = 'completion';

export type ReminderPresetOption = '20mins' | '1hour' | '3hours' | 'tomorrow' | 'nextWeek';
export type ReminderMenuOption = ReminderPresetOption | 'custom';
export type ReminderTimeOption = string;
export interface ReminderPresetMenuItem {
  option: ReminderMenuOption;
  label: string;
}

export const MESSAGE_REMINDER_MENU_OPTIONS: ReminderPresetMenuItem[] = [
  { option: '20mins', label: 'In 20 minutes' },
  { option: '1hour', label: 'In 1 hour' },
  { option: '3hours', label: 'In 3 hours' },
  { option: 'tomorrow', label: 'Tomorrow' },
  { option: 'nextWeek', label: 'Next week' },
  { option: 'custom', label: 'Custom' },
];

export const BOOKMARK_REMINDER_MENU_OPTIONS: ReminderPresetMenuItem[] = [
  { option: '20mins', label: 'In 20 minutes' },
  { option: '1hour', label: 'In 1 hour' },
  { option: '3hours', label: 'In 3 hours' },
  { option: 'tomorrow', label: 'Tomorrow' },
  { option: 'nextWeek', label: 'Monday' },
  { option: 'custom', label: 'Custom' },
];

export const REMINDER_TIME_OPTIONS: Array<{ value: ReminderTimeOption; label: string }> =
  Array.from({ length: 96 }, (_, index) => {
    const totalMinutes = index * 15;
    const hours24 = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const meridiem = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const paddedHours = String(hours24).padStart(2, '0');
    const paddedMinutes = String(minutes).padStart(2, '0');

    return {
      value: `${paddedHours}:${paddedMinutes}`,
      label: `${hours12}:${paddedMinutes} ${meridiem}`,
    };
  });

// Helper function to format date as "Today", "Yesterday", or "Month Day, Year"
export const formatDateHeader = (timestamp: number): string => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset hours for comparison
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return 'Today';
  }
  if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// Helper function to get date key for grouping
export const getDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pickString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const parseReminderStatus = (status: unknown): ReminderStatus => {
  if (status === 'SENT' || status === 'DISMISSED' || status === 'PENDING') {
    return status;
  }
  return 'PENDING';
};

const parseReminderContext = (contextData: unknown): ReminderNotificationContext | undefined => {
  if (!isRecord(contextData)) {
    return undefined;
  }

  const messagePreview = pickString(contextData, 'messagePreview');
  const conversationId = pickString(contextData, 'conversationId');
  const initialMessageId = pickString(contextData, 'initialMessageId');
  const channelId = pickString(contextData, 'channelId');
  const channelName = pickString(contextData, 'channelName');
  const channelScopeType = pickString(contextData, 'channelScopeType');
  const senderName = pickString(contextData, 'senderName');

  const context: ReminderNotificationContext = {
    ...(messagePreview && { messagePreview }),
    ...(conversationId && { conversationId }),
    ...(initialMessageId && { initialMessageId }),
    ...(channelId && { channelId }),
    ...(channelName && { channelName }),
    ...(channelScopeType && { channelScopeType }),
    ...(senderName && { senderName }),
  };

  return Object.keys(context).length > 0 ? context : undefined;
};

const cloneMetadata = (metadata: unknown): BookmarkMetadata =>
  isRecord(metadata) ? { ...(metadata as BookmarkMetadata) } : {};

export const getBookmarkCompletionFromMetadata = (
  metadata: unknown,
): BookmarkCompletionMetadata | null => {
  if (!isRecord(metadata)) {
    return null;
  }

  const bookmarkMetadata = metadata as BookmarkMetadata;
  const completionData = bookmarkMetadata[COMPLETION_METADATA_KEY];
  if (!isRecord(completionData) || completionData.done !== true) {
    return null;
  }

  const completedAt = pickString(completionData, 'completedAt');
  if (!completedAt) {
    return null;
  }

  return {
    done: true,
    completedAt,
  };
};

export const isBookmarkMarkedDone = (metadata: unknown): boolean =>
  getBookmarkCompletionFromMetadata(metadata) !== null;

export const getReminderFromMetadata = (metadata: unknown): ReminderMetadata | null => {
  if (!isRecord(metadata)) {
    return null;
  }

  const bookmarkMetadata = metadata as BookmarkMetadata;
  const reminderData = bookmarkMetadata.reminder;

  if (isRecord(reminderData) && reminderData.enabled === true) {
    const remindAt = pickString(reminderData, 'remindAt');
    if (remindAt) {
      return {
        enabled: true,
        remindAt,
        status: parseReminderStatus(reminderData.status),
        context: parseReminderContext(reminderData.context),
      };
    }
  }

  const legacyReminderAt = bookmarkMetadata[LEGACY_REMINDER_AT_METADATA_KEY];
  if (typeof legacyReminderAt === 'string' && legacyReminderAt.length > 0) {
    return {
      enabled: true,
      remindAt: legacyReminderAt,
      status: 'PENDING',
    };
  }

  return null;
};

export const upsertReminderMetadata = (
  metadata: unknown,
  remindAtISO: string,
): BookmarkMetadata => {
  const nextMetadata = cloneMetadata(metadata);
  const existingReminder = getReminderFromMetadata(metadata);

  delete (nextMetadata as Record<string, unknown>)[LEGACY_REMINDER_AT_METADATA_KEY];
  delete nextMetadata[COMPLETION_METADATA_KEY];

  nextMetadata.reminder = {
    enabled: true,
    remindAt: remindAtISO,
    status: 'PENDING',
    ...(existingReminder?.context && { context: existingReminder.context }),
  };

  return nextMetadata;
};

export const upsertReminderMetadataWithContext = (
  metadata: unknown,
  remindAtISO: string,
  context: ReminderNotificationContext,
): BookmarkMetadata => {
  const nextMetadata = upsertReminderMetadata(metadata, remindAtISO);
  const nextReminder = nextMetadata.reminder;

  if (!nextReminder) {
    return nextMetadata;
  }

  nextReminder.context = {
    ...(nextReminder.context || {}),
    ...context,
  };

  return nextMetadata;
};

export const createReminderMessagePreview = (content: string | undefined): string | undefined => {
  if (!content) {
    return undefined;
  }

  if (typeof DOMParser === 'undefined') {
    return undefined;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const plainText = doc.body.textContent?.trim().replace(/\s+/g, ' ');

  if (!plainText) {
    return undefined;
  }

  const trimmed = plainText.slice(0, 80);
  return plainText.length > 80 ? `${trimmed}...` : trimmed;
};

export const removeReminderMetadata = (metadata: unknown): BookmarkMetadata => {
  const nextMetadata = cloneMetadata(metadata);

  delete (nextMetadata as Record<string, unknown>)[LEGACY_REMINDER_AT_METADATA_KEY];
  delete nextMetadata.reminder;

  return nextMetadata;
};

export const upsertBookmarkCompletionMetadata = (
  metadata: unknown,
  completedAtISO: string = new Date().toISOString(),
): BookmarkMetadata => {
  const nextMetadata = cloneMetadata(metadata);

  delete (nextMetadata as Record<string, unknown>)[LEGACY_REMINDER_AT_METADATA_KEY];
  delete nextMetadata.reminder;

  nextMetadata[COMPLETION_METADATA_KEY] = {
    done: true,
    completedAt: completedAtISO,
  };

  return nextMetadata;
};

export const formatReminderDueIn = (remindAt: string): string => {
  const now = Date.now();
  const targetTime = new Date(remindAt).getTime();
  const diff = targetTime - now;

  if (diff < 0) {
    return 'Overdue';
  }

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `Due in ${days}d`;
  }
  if (hours > 0) {
    return `Due in ${hours}h`;
  }
  if (minutes > 0) {
    return `Due in ${minutes}m`;
  }
  return `In ${seconds}s`;
};

// Helper function to format full date with time (e.g., "Dec 5, 2024 at 10:30 AM")
export const formatDateWithTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} at ${timeStr}`;
};

export const calculateReminderTime = (option: ReminderPresetOption): Date | null => {
  const now = new Date();
  const remindAt = new Date(now);

  switch (option) {
    case '20mins': {
      remindAt.setTime(now.getTime() + 20 * 60 * 1000);
      break;
    }
    case '1hour': {
      remindAt.setTime(now.getTime() + 60 * 60 * 1000);
      break;
    }
    case '3hours': {
      remindAt.setTime(now.getTime() + 3 * 60 * 60 * 1000);
      break;
    }
    case 'tomorrow': {
      remindAt.setDate(remindAt.getDate() + 1);
      remindAt.setHours(9, 0, 0, 0);
      break;
    }
    case 'nextWeek': {
      const daysUntilMonday = (8 - remindAt.getDay()) % 7 || 7;
      remindAt.setDate(remindAt.getDate() + daysUntilMonday);
      remindAt.setHours(9, 0, 0, 0);
      break;
    }
    default:
      return null;
  }

  return remindAt;
};

export const calculateCustomReminderTime = (date: Date, time: ReminderTimeOption): Date => {
  const remindAt = new Date(date);

  const [hoursPart, minutesPart] = time.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);

  remindAt.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );

  return remindAt;
};
