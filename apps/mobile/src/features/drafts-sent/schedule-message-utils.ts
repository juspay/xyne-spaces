import { addDays, format, setHours, setMilliseconds, setMinutes, setSeconds } from 'date-fns';

export const MAX_SCHEDULE_AHEAD_MS = 100 * 24 * 60 * 60 * 1000;
export const CUSTOM_SCHEDULE_MIN_DELAY_MS = 60 * 1000;

export type SchedulePresetId = 'tomorrow-9am' | 'next-monday-9am';

export type SchedulePreset = {
  id: SchedulePresetId;
  label: string;
  getTime: (now?: Date) => number;
};

const atNine = (date: Date): Date =>
  setMilliseconds(setSeconds(setMinutes(setHours(date, 9), 0), 0), 0);

export const tomorrowNineAm = (now = new Date()): number => atNine(addDays(now, 1)).getTime();

export const nextMondayNineAm = (now = new Date()): number => {
  const day = now.getDay();
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  return atNine(addDays(now, daysUntilMonday)).getTime();
};

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'tomorrow-9am', label: 'Tomorrow 9:00 AM', getTime: tomorrowNineAm },
  { id: 'next-monday-9am', label: 'Next Monday 9:00 AM', getTime: nextMondayNineAm },
];

export const defaultCustomScheduleTime = (now = new Date()): Date => {
  const next = new Date(now.getTime() + CUSTOM_SCHEDULE_MIN_DELAY_MS);
  next.setSeconds(0, 0);
  return next;
};

export const validateScheduledFor = (scheduledFor: number, now = Date.now()): string | null => {
  if (scheduledFor <= now) return 'Scheduled messages must be in the future.';
  if (scheduledFor - now > MAX_SCHEDULE_AHEAD_MS) {
    return 'You can only schedule up to 100 days ahead.';
  }
  return null;
};

export const formatScheduleConfirmCopy = (
  scheduledFor: number,
  mode: 'create' | 'reschedule',
): string => {
  const when = format(scheduledFor, 'MMM d, yyyy h:mm a');
  return mode === 'reschedule'
    ? `This message will be rescheduled to ${when}.`
    : `This message will be sent on ${when}.`;
};

export const formatScheduledToast = (scheduledFor: number): string =>
  `Message scheduled for ${format(scheduledFor, 'MMM d, yyyy h:mm a')}`;

export const formatUpcomingBanner = (scheduledFor: number): string =>
  `Your message will be sent at ${format(scheduledFor, 'h:mm a')} on ${format(scheduledFor, 'MMM d')}.`;

export const formatUpcomingBannerCount = (count: number): string =>
  count === 1 ? 'You have 1 scheduled message.' : `You have ${count} scheduled messages.`;

export const listUpcomingDelayedMessages = <
  T extends {
    channelId: string;
    conversationId: string | null;
    scheduledFor: number;
    status: string;
  },
>(
  rows: readonly T[],
  channelId: string,
  conversationId: string | null,
  now = Date.now(),
): T[] =>
  rows
    .filter(
      row =>
        row.status === 'PENDING' &&
        row.channelId === channelId &&
        (row.conversationId ?? null) === conversationId &&
        row.scheduledFor > now,
    )
    .sort((a, b) => a.scheduledFor - b.scheduledFor);

export const pickUpcomingDelayedMessage = <
  T extends {
    channelId: string;
    conversationId: string | null;
    scheduledFor: number;
    status: string;
  },
>(
  rows: readonly T[],
  channelId: string,
  conversationId: string | null,
  now = Date.now(),
): T | undefined => listUpcomingDelayedMessages(rows, channelId, conversationId, now)[0];
