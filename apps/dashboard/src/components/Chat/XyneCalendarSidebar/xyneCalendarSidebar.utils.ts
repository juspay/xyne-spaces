import {
  MeetingStatus,
  type Call,
  type CallParticipant,
  type Channel,
  type ChannelScopeType,
  type ChannelVisibility,
} from '@xyne/shared';
import type { User } from '../../../machines/stateMachine';
import {
  isExternalCalendarEvent,
  isExternalCalendarEventForUser,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import { isDMChannel, parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

type XyneCalendarBadgeCall = Pick<
  Call,
  'callOrigin' | 'createdByUserId' | 'externalId' | 'startsAt'
> & {
  participants?: readonly Pick<CallParticipant, 'meetingStatus' | 'userId'>[];
};

const getNextDayStart = (now: number): number => {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 0);
  return nextDay.getTime();
};

/** Checks whether a call should be included in the user's Calendar badge. */
const isCalendarBadgeCallForUser = (
  call: XyneCalendarBadgeCall,
  userId: string | undefined,
): boolean => {
  if (isExternalCalendarEvent(call)) {
    return isExternalCalendarEventForUser(call, userId);
  }

  const participant = call.participants?.find(item => item.userId === userId);
  return Boolean(
    participant &&
    participant.meetingStatus !== MeetingStatus.DECLINED &&
    participant.meetingStatus !== MeetingStatus.HIDDEN,
  );
};

/** Counts the calls of the user still has scheduled for today. */
export const getPendingCalendarCallCount = (
  calls: readonly XyneCalendarBadgeCall[] | undefined,
  userId: string | undefined,
  now: number,
): number => {
  const nextDayStart = getNextDayStart(now);

  return (calls ?? []).reduce((count, call): number => {
    if (!call.startsAt || !isCalendarBadgeCallForUser(call, userId)) return count;

    const startsAt = new Date(call.startsAt).getTime();
    return startsAt > now && startsAt < nextDayStart ? count + 1 : count;
  }, 0);
};

/** Returns the next time the Calendar badge count needs to be refreshed. */
export const getNextCalendarBadgeBoundary = (
  calls: readonly XyneCalendarBadgeCall[] | undefined,
  userId: string | undefined,
  now: number,
): number => {
  const nextDayStart = getNextDayStart(now);

  return (calls ?? []).reduce((boundary, call): number => {
    if (!call.startsAt || !isCalendarBadgeCallForUser(call, userId)) return boundary;

    const startsAt = new Date(call.startsAt).getTime();
    return startsAt > now && startsAt < boundary ? startsAt : boundary;
  }, nextDayStart);
};

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

export const XYNE_CALENDAR_SIDEBAR_DEFAULT_SIZE = 25;
export const XYNE_CALENDAR_SIDEBAR_MIN_SIZE = 25;
export const XYNE_CALENDAR_SIDEBAR_MAX_SIZE = 40;
