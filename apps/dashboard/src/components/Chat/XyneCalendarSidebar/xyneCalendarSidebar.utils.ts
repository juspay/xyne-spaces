import { type Channel, type ChannelScopeType, type ChannelVisibility } from '@xyne/shared';
import {
  addDays,
  addMonths,
  isSameMonth,
  isSameWeek,
  isToday,
  isTomorrow,
  isYesterday,
} from 'date-fns';
import type { User } from '../../../machines/stateMachine';
import { isDMChannel, parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export interface XyneCalendarChannelPresentation {
  label: string;
  scopeType: ChannelScopeType;
  visibility: ChannelVisibility;
}

/** Builds the channel label and type shown for a Calendar call. */
export const getXyneCalendarChannelPresentation = (
  channel: Channel,
  currentUserId: string,
  usersById: Map<string, User>,
): XyneCalendarChannelPresentation => {
  if (!isDMChannel(channel.scopeType)) {
    return {
      label: channel.name,
      scopeType: channel.scopeType,
      visibility: channel.visibility,
    };
  }

  const participantIds = parseDMParticipantIds(channel);
  const isSelfDm = participantIds.length === 1 && participantIds[0] === currentUserId;
  const names = participantIds
    .filter(id => id !== currentUserId)
    .map(id => getUserDisplayName(usersById.get(id)));

  return {
    label: isSelfDm ? 'You' : names.join(', ') || 'Direct message',
    scopeType: channel.scopeType,
    visibility: channel.visibility,
  };
};

/** "this/last/next week|month" or "today/yesterday/tomorrow" — null if the period is too far off. */
export const getNearPeriodPhrase = (
  viewMode: 'day' | 'week' | 'month',
  selectedDate: Date,
  today: Date,
): string | null => {
  if (viewMode === 'week') {
    if (isSameWeek(selectedDate, today, { weekStartsOn: 0 })) return 'this week';
    if (isSameWeek(selectedDate, addDays(today, -7), { weekStartsOn: 0 })) return 'last week';
    if (isSameWeek(selectedDate, addDays(today, 7), { weekStartsOn: 0 })) return 'next week';
    return null;
  }
  if (viewMode === 'month') {
    if (isSameMonth(selectedDate, today)) return 'this month';
    if (isSameMonth(selectedDate, addMonths(today, -1))) return 'last month';
    if (isSameMonth(selectedDate, addMonths(today, 1))) return 'next month';
    return null;
  }
  if (isToday(selectedDate)) return 'today';
  if (isYesterday(selectedDate)) return 'yesterday';
  if (isTomorrow(selectedDate)) return 'tomorrow';
  return null;
};

export interface PeriodCallCounts {
  callCount: number;
  liveCount: number;
  scheduledCount: number;
  endedCount: number;
}

/** The Calendar header's call-count badge text, e.g. "3 calls this week" / "No calls scheduled". */
export const getPeriodCallCountLabel = (
  { callCount, liveCount, scheduledCount, endedCount }: PeriodCallCounts,
  nearPeriodPhrase: string | null,
): string => {
  const callWord = callCount === 1 ? 'call' : 'calls';
  if (callCount === 0) return 'No calls scheduled';
  if (nearPeriodPhrase) return `${callCount} ${callWord} ${nearPeriodPhrase}`;
  if (liveCount > 0) return `${callCount} ${callWord} · ${liveCount} live now`;
  if (scheduledCount === callCount) return `${callCount} ${callWord} scheduled`;
  if (endedCount === callCount) return `${callCount} ${callWord} ended`;
  return `${callCount} ${callWord}`;
};

export const XYNE_CALENDAR_SIDEBAR_DEFAULT_SIZE = 25;
export const XYNE_CALENDAR_SIDEBAR_MIN_SIZE = 25;
export const XYNE_CALENDAR_SIDEBAR_MAX_SIZE = 40;
