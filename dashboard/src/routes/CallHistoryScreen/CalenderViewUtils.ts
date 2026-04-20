import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call } from './callHistoryItem.utils';

// ── Drag & Drop helpers ──────────────────────────────────────────────────────

/** Inverse of topPxForMinutes: pixel offset → minutes since midnight (raw, not snapped) */
export function minutesFromTopPx(px: number): number {
  return (px / HOUR_HEIGHT) * 60;
}

/** Snap a minute value to the nearest 15-minute interval */
export function snapTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/**
 * Parse a dayKey string (YYYY-M-D, 0-indexed month) back to a Date at local midnight.
 * Mirrors the dayKey() function above.
 */
export function parseDayKey(key: string): Date {
  const [yearStr, monthStr, dateStr] = key.split('-');

  if (yearStr === undefined || monthStr === undefined || dateStr === undefined) {
    throw new Error(`Invalid day key: ${key}`);
  }

  const year = Number(yearStr);
  const month = Number(monthStr);
  const date = Number(dateStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) {
    throw new Error(`Invalid day key: ${key}`);
  }

  return new Date(year, month, date, 0, 0, 0, 0);
}

/**
 * Whether a call card should be draggable.
 * Only the organizer (or creator, as fallback) can drag future/scheduled calls.
 */
export function isCallDraggable(call: Call, currentUserId: string | undefined): boolean {
  if (!currentUserId) return false;
  if (call.status === CallStatus.ENDED || call.status === CallStatus.CANCELLED) return false;
  if (!call.startsAt || new Date(call.startsAt).getTime() <= Date.now()) return false;
  // organizerId is optional — fall back to createdByUserId
  const owner = call.organizerId ?? call.createdByUserId;
  return owner === currentUserId;
}

// Shared constants
export const HOUR_HEIGHT = 64; // px per hour
export const MIN_EVENT_HEIGHT = 28; // px
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const OVERLAP_LEFT_MARGIN = 2; // px per overlap level

export const POPOVER_CONTENT_CLASS =
  'z-[60] bg-background rounded-xl border border-border shadow-lg w-[340px] outline-none ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2';

/**
 * Check if two dates are on the same calendar day
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Calculate number of minutes since midnight for a given date
 */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Convert minutes since midnight to pixel position on the calendar
 */
export function topPxForMinutes(minutes: number): number {
  return (minutes * HOUR_HEIGHT) / 60;
}

/**
 * Format hour number to human readable label with AM/PM
 */
export function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/**
 * Format date string/number to short time string
 */
export function formatTime(dateStr: string | number | undefined | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  return `${h}:${m}${ampm}`;
}

/**
 * Format Date object to 12-hour time format with AM/PM
 */
export function formatCurrentTime(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

/**
 * Get meeting status for current user from a call
 */
export function getCurrentUserMeetingStatus(call: Call, currentUserId?: string): MeetingStatus {
  if (!currentUserId) return MeetingStatus.PENDING;
  return (
    call.participants?.find(participant => participant.userId === currentUserId)?.meetingStatus ??
    MeetingStatus.PENDING
  );
}

/**
 * Generate unique day key string for a date
 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Get start of the week (Sunday), clamped to first day of month
 */
export function getWeekStartForMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // rewind to Sunday
  d.setHours(0, 0, 0, 0);

  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  if (d < firstOfMonth) {
    return firstOfMonth;
  }
  return d;
}

type OverlapInfo = {
  startMins: number;
  endMins: number;
  overlapIndex: number;
};

/**
 * Compute overlap indices for calls to handle overlapping events
 */
export function computeOverlapIndices(dayCalls: Call[]): OverlapInfo[] {
  const sorted = [...dayCalls]
    .filter(c => c.startsAt)
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());

  const result: OverlapInfo[] = [];

  for (const call of sorted) {
    const startMins = minutesSinceMidnight(new Date(call.startsAt!));
    const endMins = call.endsAt ? minutesSinceMidnight(new Date(call.endsAt)) : startMins + 60;

    let minIndex = 0;
    for (const existing of result) {
      if (startMins < existing.endMins && endMins > existing.startMins) {
        minIndex = Math.max(minIndex, existing.overlapIndex + 1);
      }
    }

    result.push({ startMins, endMins, overlapIndex: minIndex });
  }

  return result;
}

/**
 * Get call event styles and properties
 */
export function getCallEventProps(call: Call, currentUserId?: string) {
  if (!call.startsAt) return null;

  const startMins = minutesSinceMidnight(new Date(call.startsAt));
  const endMins = call.endsAt ? minutesSinceMidnight(new Date(call.endsAt)) : startMins + 60;
  const durationMins = Math.max(15, endMins - startMins);

  const top = topPxForMinutes(startMins);
  const height = Math.max(MIN_EVENT_HEIGHT, topPxForMinutes(durationMins));
  const isEnded = call.status === CallStatus.ENDED;
  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);
  const isDeclined = meetingStatus === MeetingStatus.DECLINED;
  const isMaybe = meetingStatus === MeetingStatus.MAYBE;

  return {
    startMins,
    endMins,
    durationMins,
    top,
    height,
    isEnded,
    meetingStatus,
    isDeclined,
    isMaybe,
  };
}
