import { useSyncExternalStore } from 'react';
import type { Variants } from 'framer-motion';
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
import {
  getDMSearchableNames,
  isDMChannel,
  parseDMParticipantIds,
} from '../ChatDirectory/ChatDirectory.utils';

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
  const names = getDMSearchableNames(channel, currentUserId, usersById);

  return {
    label: isSelfDm ? 'You' : names.join(', ') || 'Direct message',
    scopeType: channel.scopeType,
    visibility: channel.visibility,
  };
};

export const XYNE_CALENDAR_SIDEBAR_DEFAULT_WIDTH = 384;
export const XYNE_CALENDAR_SIDEBAR_MIN_WIDTH = 320;
export const XYNE_CALENDAR_SIDEBAR_MAX_WIDTH = 640;

const XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY = 'xyne-calendar-sidebar-width';

export const XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION = 0.32;

export const xyneCalendarSidebarMotionVariants: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

/** Returns the saved sidebar width, limited to the supported size range. */
export const getXyneCalendarSidebarWidth = (): number => {
  try {
    const savedWidth = Number(localStorage.getItem(XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      return Math.min(
        XYNE_CALENDAR_SIDEBAR_MAX_WIDTH,
        Math.max(XYNE_CALENDAR_SIDEBAR_MIN_WIDTH, savedWidth),
      );
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  return XYNE_CALENDAR_SIDEBAR_DEFAULT_WIDTH;
};

/** Saves the resized sidebar width for the next session. */
export const saveXyneCalendarSidebarWidth = (width: number): void => {
  const nextWidth = Math.round(
    Math.min(XYNE_CALENDAR_SIDEBAR_MAX_WIDTH, Math.max(XYNE_CALENDAR_SIDEBAR_MIN_WIDTH, width)),
  );

  try {
    localStorage.setItem(XYNE_CALENDAR_SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  } catch {
    // Resizing still works for the current session when storage is unavailable.
  }
};

export interface XyneCalendarSidebarState {
  isOpen: boolean;
  transition: 'animated' | 'handoff';
}

let sidebarState: XyneCalendarSidebarState = {
  isOpen: false,
  transition: 'animated',
};
const listeners = new Set<() => void>();

const emitChange = (): void => {
  for (const listener of listeners) listener();
};

const setOpen = (
  nextOpen: boolean,
  transition: XyneCalendarSidebarState['transition'] = 'animated',
): void => {
  if (sidebarState.isOpen === nextOpen && sidebarState.transition === transition) return;
  sidebarState = { isOpen: nextOpen, transition };
  emitChange();
};

/** Opens the Calendar sidebar ~ animated. */
export const openXyneCalendarSidebar = (): void => setOpen(true);

/** Closes the Calendar sidebar ~ animated. */
export const closeXyneCalendarSidebar = (): void => setOpen(false);

/** Opens the Calendar sidebar handoff ~ immediate. */
export const openXyneCalendarSidebarForHandoff = (): void => setOpen(true, 'handoff');

/** Opens the Calendar sidebar handoff ~ immediate. */
export const closeXyneCalendarSidebarForHandoff = (): void => setOpen(false, 'handoff');

/** Toggles Calendar view. */
export const toggleXyneCalendarSidebar = (): void => setOpen(!sidebarState.isOpen);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): XyneCalendarSidebarState => sidebarState;

/** Subscribes a component to the complete Calendar sidebar state. */
export const useXyneCalendarSidebarState = (): XyneCalendarSidebarState =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** Returns whether the Calendar sidebar is currently open. */
export const useIsXyneCalendarSidebarOpen = (): boolean => useXyneCalendarSidebarState().isOpen;
