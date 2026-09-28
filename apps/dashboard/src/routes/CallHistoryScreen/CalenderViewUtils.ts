import type React from 'react';
import { RRule } from 'rrule';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call, isScheduledCallJoinable } from './callHistoryItem.utils';
import type { OtherUserCalls, OtherUserBusySlot } from '../../hooks/useOtherUserCalls';
import { formatDuration } from '../../utils/dateUtils';
import type { XyneCalendarCallPillVariant } from '../../components/Chat/XyneCalendarSidebar/XyneCalendarCallPill';

// ── Drag & Drop helpers ──────────────────────────────────────────────────────

/** Inverse of topPxForMinutes: pixel offset → minutes since midnight (raw, not snapped) */
export function minutesFromTopPx(px: number, hourHeight: number = HOUR_HEIGHT): number {
  return (px / hourHeight) * 60;
}

export interface CalendarCreateSlotOptions {
  clampToDay?: boolean;
  durationMins?: number;
  hourHeight?: number;
  snapMode?: 'floor' | 'nearest';
  snapIntervalMins?: number;
}

export function snapMinutes(minutes: number, intervalMins: number): number {
  return Math.round(minutes / intervalMins) * intervalMins;
}

export function getCalendarCreateSlot(
  date: Date,
  rawStartMins: number,
  {
    clampToDay = false,
    durationMins = 60,
    snapMode = 'floor',
    snapIntervalMins = 30,
  }: CalendarCreateSlotOptions = {},
): { startsAt: Date; endsAt: Date; startMins: number; endMins: number } {
  const latestStartMins = Math.max(0, 24 * 60 - durationMins);
  const snappedStartMins =
    snapMode === 'nearest'
      ? snapMinutes(rawStartMins, snapIntervalMins)
      : Math.floor(rawStartMins / snapIntervalMins) * snapIntervalMins;
  const startMins = clampToDay
    ? Math.max(0, Math.min(latestStartMins, snappedStartMins))
    : snappedStartMins;
  const endMins = clampToDay
    ? Math.min(24 * 60, startMins + durationMins)
    : startMins + durationMins;
  const startsAt = new Date(date);
  startsAt.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
  const endsAt = new Date(date);
  endsAt.setHours(Math.floor(endMins / 60), endMins % 60, 0, 0);

  return { startsAt, endsAt, startMins, endMins };
}

/**
 * Returns a click handler for time-grid slot cells (day/week views).
 * Computes the clicked time from the pointer Y offset, snaps to 30-min boundaries,
 * and calls onCreateCallAtSlot with a 1-hour window.
 */
export function createSlotClickHandler(
  date: Date,
  isPopoverOpen: boolean,
  consumeDragEnd: (() => boolean) | undefined,
  onCreateCallAtSlot: ((startsAt: Date, endsAt: Date) => void) | undefined,
  options: CalendarCreateSlotOptions = {},
): (e: React.MouseEvent<HTMLDivElement>) => void {
  return (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPopoverOpen || consumeDragEnd?.()) return;
    if (!onCreateCallAtSlot) return;
    if ((e.target as HTMLElement).closest('button')) return;

    const rawMins = minutesFromTopPx(
      e.clientY - e.currentTarget.getBoundingClientRect().top,
      options.hourHeight,
    );
    const { startsAt, endsAt } = getCalendarCreateSlot(date, rawMins, options);
    onCreateCallAtSlot(startsAt, endsAt);
  };
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

// Pill sizing thresholds shared by Day (XyneCalendarCallPill) and Week (WeekViewCallCard) views.
export const ALWAYS_VISIBLE_JOIN_MIN_WIDTH_PERCENTAGE = 75;
export const COMPACT_METADATA_MIN_WIDTH_PERCENTAGE = 75;

// computeEventPositions: max side-by-side columns per overlap cluster before pills
// start doubling up instead of shrinking further.
const MAX_OVERLAP_COLUMNS = 4;

/** Diagonal hatch used on a call pill's clipped edge when it continues from/to an adjacent day. */
export const HATCH_BACKGROUND =
  'repeating-linear-gradient(135deg, color-mix(in hsl, currentColor 55%, transparent) 0, color-mix(in hsl, currentColor 55%, transparent) 1px, transparent 1px, transparent 6px)';

/**
 * Whether a call has ended — either its status says so, or its endsAt has passed.
 */
export function hasCallEnded(call: Call, currentTime: Date): boolean {
  return (
    call.status === CallStatus.ENDED ||
    (call.endsAt !== null &&
      call.endsAt !== undefined &&
      new Date(call.endsAt).getTime() < currentTime.getTime())
  );
}

/**
 * Classifies a call into the pill variant that drives its color/emphasis —
 * shared by the Day pill (XyneCalendarCallPill) and Week/Month call cards.
 */
export function getCallPillVariant(
  call: Call,
  currentUserId: string | undefined,
  currentTime: Date,
): XyneCalendarCallPillVariant {
  if (currentUserId && call.createdByUserId === currentUserId) {
    return 'highlighted';
  }

  if (hasCallEnded(call, currentTime)) return 'past';

  const meetingStatus = getCurrentUserMeetingStatus(call, currentUserId);

  if (meetingStatus === MeetingStatus.DECLINED || meetingStatus === MeetingStatus.HIDDEN) {
    return 'declined';
  }

  return isScheduledCallJoinable(call, currentTime.getTime()) ? 'joinable' : 'scheduled';
}

export function isCallJoinableNow(
  call: Call,
  variant: XyneCalendarCallPillVariant,
  currentTime: Date,
): boolean {
  return (
    !hasCallEnded(call, currentTime) &&
    (variant === 'joinable' ||
      (variant === 'highlighted' && isScheduledCallJoinable(call, currentTime.getTime())))
  );
}

/**
 * Border/background/text classes for a pill variant — shared by the Day pill
 * (XyneCalendarCallPill) and Week call card, which render the same full-border style.
 */
export function getCallPillVariantClasses(variant: XyneCalendarCallPillVariant): string {
  switch (variant) {
    case 'past':
      return 'border-border bg-muted/60 text-muted-foreground';
    case 'highlighted':
      return 'border-primary bg-primary text-primary-foreground';
    case 'declined':
      return 'border-border bg-background text-muted-foreground';
    default:
      return 'border-primary bg-background text-foreground';
  }
}

export function mergeCallsById<T extends { id: string }>(calls: T[]): T[] {
  const callsById = new Map<string, T>();
  for (const call of calls) callsById.set(call.id, call);
  return Array.from(callsById.values());
}

export const MAX_AVATARS_TO_SHOW = 3;
export const RSVP_BADGE_BASE_CLASS =
  'absolute -bottom-0.5 -right-0.5 flex items-center justify-center size-4 rounded-full border-2 border-background';

export const POPOVER_CONTENT_CLASS =
  'z-[60] bg-background rounded-xl border border-border shadow-xl w-[400px] max-w-[calc(100vw-32px)] outline-none ' +
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
export function topPxForMinutes(minutes: number, hourHeight: number = HOUR_HEIGHT): number {
  return (minutes * hourHeight) / 60;
}

/**
 * Format hour number to human readable label with AM/PM. 24 wraps to midnight,
 * for callers (e.g. a 25-row hour grid) that label the trailing boundary too.
 */
export function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM';
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
 * Whether a participant actually attended the call.
 */
export function didAttend(participant: { joinedAt?: number | null }): boolean {
  return typeof participant.joinedAt === 'number';
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

export type EventPosition = {
  startMins: number;
  endMins: number;
  leftPct: number;
  widthPct: number;
};

export interface PositionableEvent {
  id: string;
  startsAt?: string | number | null;
  endsAt?: string | number | null;
}

/**
 * Calls whose [startsAt, endsAt) interval overlaps `day` — includes calls
 * that started the day before and spill past midnight into `day`, matching
 * Google Calendar's day view (a cross-midnight call shows a clipped segment
 * on both days it touches).
 */
export function getCallsOverlappingDay<
  T extends { startsAt?: string | number | null; endsAt?: string | number | null },
>(calls: T[], day: Date): T[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return calls.filter(call => {
    if (!call.startsAt) return false;
    const startsAtMs = new Date(call.startsAt).getTime();
    const endsAtMs = call.endsAt ? new Date(call.endsAt).getTime() : startsAtMs + 1;
    return startsAtMs < dayEnd && endsAtMs > dayStart;
  });
}

export function getVisibleMinutesForDay(
  call: PositionableEvent,
  referenceDay: Date,
): { startMins: number; endMins: number } {
  const startDate = new Date(call.startsAt!);
  const startMins = isSameDay(startDate, referenceDay) ? minutesSinceMidnight(startDate) : 0;

  const endDate = call.endsAt ? new Date(call.endsAt) : null;
  const rawEnd = endDate
    ? isSameDay(endDate, referenceDay)
      ? minutesSinceMidnight(endDate)
      : 24 * 60
    : startMins + 60;

  return { startMins, endMins: Math.max(rawEnd, startMins + 15) };
}

/**
 * Google Calendar-style cluster algorithm.
 * Groups overlapping events into clusters, assigns each event a column within
 * its cluster, then returns `leftPct` and `widthPct` (0–100) so events sit
 * side-by-side instead of stacking on top of each other.
 *
 * Returns a Map keyed by event.id for O(1) lookup in the renderer.
 */
export function computeEventPositions(
  dayCalls: PositionableEvent[],
  referenceDay: Date,
): Map<string, EventPosition> {
  const result = new Map<string, EventPosition>();
  const valid = dayCalls.filter(c => c.startsAt);
  if (valid.length === 0) return result;

  type Item = { id: string; startMins: number; endMins: number };

  const items: Item[] = valid.map(call => ({
    id: call.id,
    ...getVisibleMinutesForDay(call, referenceDay),
  }));

  // Sort by start time; break ties by longest duration first
  items.sort((a, b) =>
    a.startMins !== b.startMins ? a.startMins - b.startMins : b.endMins - a.endMins,
  );

  let i = 0;
  while (i < items.length) {
    // Expand cluster: include any event that starts before the current cluster ends
    const cluster: Item[] = [items[i]!];
    let clusterEnd = items[i]!.endMins;
    let j = i + 1;
    while (j < items.length && items[j]!.startMins < clusterEnd) {
      cluster.push(items[j]!);
      clusterEnd = Math.max(clusterEnd, items[j]!.endMins);
      j++;
    }

    // Greedy column assignment: place each event in the first column whose
    // last event has already ended before this one starts.
    const columns: Item[][] = [];
    for (const item of cluster) {
      let placed = false;
      for (const col of columns) {
        if (item.startMins >= col[col.length - 1]!.endMins) {
          col.push(item);
          placed = true;
          break;
        }
      }
      // If no column was found, create a new one (or double up in the last column if maxed out)
      if (!placed) {
        if (columns.length < MAX_OVERLAP_COLUMNS) {
          columns.push([item]);
        } else {
          columns[columns.length - 1]!.push(item);
        }
      }
    }

    const numCols = columns.length;
    const widthPct = 100 / numCols;

    columns.forEach((col, colIdx) => {
      for (const item of col) {
        result.set(item.id, {
          startMins: item.startMins,
          endMins: item.endMins,
          leftPct: colIdx * widthPct,
          widthPct,
        });
      }
    });

    i = j;
  }

  return result;
}

export type OtherSlotMeta = {
  color: string;
  title: string | undefined;
  startsAt: number;
  endsAt: number | null;
};

/**
 * Merges own day calls with other users' slots into a single event pool for
 * the cluster-overlap algorithm.  Pass a `dayFilter` predicate to restrict
 * which other-user slots belong to the current column/day.
 *
 * Returns:
 * - `allEvents`   – unified list for `computeEventPositions`
 * - `otherSlotMap` – keyed by synthetic id, used at render time
 */
export function buildDayEventPool(
  dayCalls: Call[],
  otherUsersCalls: OtherUserCalls[],
  dayFilter: (slot: OtherUserBusySlot) => boolean,
): { allEvents: PositionableEvent[]; otherSlotMap: Map<string, OtherSlotMeta> } {
  const otherSlotMap = new Map<string, OtherSlotMeta>();
  const allEvents: PositionableEvent[] = [];

  for (const call of dayCalls) {
    if (call.startsAt)
      allEvents.push({ id: call.id, startsAt: call.startsAt, endsAt: call.endsAt });
  }

  for (const { user, color, calls: userCalls } of otherUsersCalls) {
    for (const slot of userCalls) {
      if (!slot.startsAt || !dayFilter(slot)) continue;
      const id = `other-${user.id}-${slot.id ?? slot.startsAt}`;
      allEvents.push({ id, startsAt: slot.startsAt, endsAt: slot.endsAt });
      otherSlotMap.set(id, {
        color,
        title: slot.title,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });
    }
  }

  return { allEvents, otherSlotMap };
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
  const isDeclined =
    meetingStatus === MeetingStatus.DECLINED || meetingStatus === MeetingStatus.HIDDEN;
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

/**
 * Convert an RRULE string to a short human-readable label.
 * e.g. "FREQ=WEEKLY;BYDAY=TU" → "Every week on Tuesday"
 */
export function formatRecurrenceRule(ruleStr: string | null | undefined): string {
  if (!ruleStr) return 'This call repeats on a schedule';
  try {
    // Strip the "RRULE:" prefix if present, then parse
    const cleaned = ruleStr.replace(/^RRULE:/i, '');
    const options = RRule.parseString(cleaned);
    const rule = new RRule(options);
    const text = rule.toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return 'This call repeats on a schedule';
  }
}

/**
 * Format call duration from start and end timestamps.
 * Returns a human-readable string like "1h 10m" or "45m".
 */
export function formatCallDuration(
  startedAt: number | string | null | undefined,
  endedAt: number | string | null | undefined,
): string {
  if (!startedAt || !endedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const diffMs = end - start;
  if (diffMs <= 0) return '';
  return formatDuration(diffMs);
}
