import { format, isToday, isYesterday } from 'date-fns';
import type { ReactElement } from 'react';
import { Calendar, Check, Folder, Paperclip, Star, Tag, UserRound } from 'lucide-react-native';
import { ActivityType } from '@xyne/shared';

export type ActivityText = {
  prefix: string;
  oldValue: string | undefined;
  newValue: string | undefined;
  emphasize: string | undefined;
};

export function formatDayLabel(ts: number): string {
  if (isToday(ts)) return `TODAY, ${format(ts, 'MMM d').toUpperCase()}`;
  if (isYesterday(ts)) return `YESTERDAY, ${format(ts, 'MMM d').toUpperCase()}`;
  return format(ts, 'EEEE, MMM d').toUpperCase();
}

export function activityText(
  activity: { activityType: ActivityType; value: unknown },
  users: Array<{ id: string; name: string }>,
): ActivityText {
  const value = (activity.value ?? {}) as { oldValue?: string; newValue?: string };
  switch (activity.activityType) {
    case ActivityType.STATUS:
    case ActivityType.STAGE_NAME:
      return {
        prefix: 'changed status',
        oldValue: value.oldValue,
        newValue: value.newValue,
        emphasize: undefined,
      };
    case ActivityType.ETA:
    case ActivityType.STAGE_ETA:
      return {
        prefix: 'moved due date',
        oldValue: formatDateValue(value.oldValue),
        newValue: formatDateValue(value.newValue),
        emphasize: undefined,
      };
    case ActivityType.ASSIGNED_TO: {
      const oldUser = users.find(u => u.id === value.oldValue)?.name ?? value.oldValue;
      const newUser = users.find(u => u.id === value.newValue)?.name ?? value.newValue;
      return {
        prefix: 'assigned',
        oldValue: oldUser,
        newValue: newUser,
        emphasize: undefined,
      };
    }
    case ActivityType.PRIORITY:
      return {
        prefix: 'raised priority to',
        oldValue: undefined,
        newValue: undefined,
        emphasize: value.newValue ?? '',
      };
    case ActivityType.TAGS:
      return {
        prefix: 'added labels',
        oldValue: undefined,
        newValue: undefined,
        emphasize: value.newValue ?? value.oldValue ?? '',
      };
    case ActivityType.BOARD:
      return {
        prefix: 'moved board',
        oldValue: value.oldValue,
        newValue: value.newValue,
        emphasize: undefined,
      };
    case ActivityType.DESCRIPTION:
      return {
        prefix: 'updated description',
        oldValue: undefined,
        newValue: undefined,
        emphasize: undefined,
      };
    case ActivityType.TITLE:
      return {
        prefix: 'updated title',
        oldValue: undefined,
        newValue: undefined,
        emphasize: undefined,
      };
    default:
      return {
        prefix: activity.activityType.toLowerCase().replaceAll('_', ' '),
        oldValue: undefined,
        newValue: undefined,
        emphasize: undefined,
      };
  }
}

export function getTicketStatusDotClass(
  statusLabel?: string | null,
  statusV2?: string | null,
): string {
  const raw = `${statusLabel ?? statusV2 ?? ''}`.toLowerCase().trim();
  if (
    raw.includes('cancel') ||
    raw.includes('reported') ||
    raw.includes('blocked') ||
    raw.includes('rejected')
  ) {
    return 'bg-ticket-status-cancelled';
  }
  if (raw.includes('complete') || raw.includes('done') || raw.includes('resolved')) {
    return 'bg-ticket-status-completed';
  }
  if (raw.includes('pause') || raw.includes('review') || raw.includes('testing')) {
    return 'bg-ticket-status-paused';
  }
  if (
    raw.includes('start') ||
    raw.includes('progress') ||
    raw.includes('doing') ||
    raw.includes('develop') ||
    raw.includes('investigating') ||
    raw.includes('fixing')
  ) {
    return 'bg-ticket-status-started';
  }
  return 'bg-ticket-status-todo';
}

export function getPriorityTextClass(priority?: string | null): string {
  const value = (priority ?? '').toLowerCase();
  if (value.includes('critical')) return 'text-ticket-priority-critical';
  if (value.includes('high')) return 'text-ticket-priority-high';
  if (value.includes('medium')) return 'text-ticket-priority-medium';
  return 'text-ticket-priority-low';
}

export function getLabelChipClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes('bug') || value.includes('incident')) {
    return 'bg-ticket-label-red-bg';
  }
  if (
    value.includes('release') ||
    value.includes('rel') ||
    value.includes('version') ||
    value.includes('sprint')
  ) {
    return 'bg-ticket-label-blue-bg';
  }
  if (value.includes('payment') || value.includes('success')) {
    return 'bg-ticket-label-green-bg';
  }
  return 'bg-ticket-label-neutral-bg';
}

export function getLabelTextClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes('bug') || value.includes('incident')) {
    return 'text-ticket-label-red-text';
  }
  if (
    value.includes('release') ||
    value.includes('rel') ||
    value.includes('version') ||
    value.includes('sprint')
  ) {
    return 'text-ticket-label-blue-text';
  }
  if (value.includes('payment') || value.includes('success')) {
    return 'text-ticket-label-green-text';
  }
  return 'text-ticket-label-neutral-text';
}

export function getActivityIcon(activityType: ActivityType, color: string): ReactElement {
  switch (activityType) {
    case ActivityType.STATUS:
    case ActivityType.STAGE_NAME:
      return <Check size={10} color={color} />;
    case ActivityType.ETA:
    case ActivityType.STAGE_ETA:
      return <Calendar size={10} color={color} />;
    case ActivityType.ASSIGNED_TO:
      return <UserRound size={10} color={color} />;
    case ActivityType.PRIORITY:
      return <Star size={10} color={color} />;
    case ActivityType.TAGS:
      return <Tag size={10} color={color} />;
    case ActivityType.BOARD:
      return <Folder size={10} color={color} />;
    case ActivityType.DESCRIPTION:
    case ActivityType.TITLE:
      return <Paperclip size={10} color={color} />;
    default:
      return <Check size={10} color={color} />;
  }
}

export function parseLabelValues(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function normalizeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;

  const candidates = [Math.floor(num), Math.floor(num / 1000), Math.floor(num * 1000)];
  const sane = candidates.find(ms => {
    const year = new Date(ms).getFullYear();
    return year >= 2000 && year <= 2100;
  });
  if (sane) return sane;

  const valid = candidates.find(ms => Number.isFinite(new Date(ms).getTime()));
  return valid ?? null;
}

export { formatETADisplay, isStageDeadlineOverdue, isTicketDueDateOverdue } from './eta-display';

export function formatDateValue(raw?: string): string | undefined {
  if (!raw) return raw;
  const normalized = normalizeTimestamp(raw);
  if (normalized) return format(new Date(normalized), 'MMM d, yyyy');

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'MMM d, yyyy');
  return raw;
}
