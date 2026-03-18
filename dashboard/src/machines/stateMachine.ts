import { setup, assign, createActor } from 'xstate';
import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { queries } from '../zero/queries';
import { QueryResultType } from '@rocicorp/zero';

// Draft message types
export interface DraftMessage {
  html: string;
  text: string;
  updatedAt: number;
}

export interface DraftMessages {
  [lookupId: string]: DraftMessage | undefined;
}

const DRAFT_STORAGE_KEY = 'channel-draft-message';

export type User = QueryResultType<typeof queries.getUsers>[number];
export type Bookmarks = QueryResultType<typeof queries.userBookmarks>[number];
export type Channel = QueryResultType<typeof queries.userVisibleChannels>[number];
export type UserGroup = QueryResultType<typeof queries.getAllUserGroups>[number];
export type UserPermission = {
  resourceName: string;
  accessType: 'READ' | 'WRITE' | 'ADMIN';
};
export type UserChannelStatus = QueryResultType<typeof queries.getAllChannelsUserStatus>[number];

export type Conversation = QueryResultType<typeof queries.channelConversationsPaginated>[number];

export type DraftMessageDB = QueryResultType<typeof queries.userDrafts>[number];

// Metrics data for a single period
export interface PeriodMetrics {
  messages: number;
  users: number;
  calls: number;
  callsDuration: number;
}

// Metrics state for MetricsBar
export interface MetricsState {
  today: PeriodMetrics;
  allTime: PeriodMetrics;
  loading: boolean;
  error: string | null;
}

export const initialMetricsState: MetricsState = {
  today: { messages: 0, users: 0, calls: 0, callsDuration: 0 },
  allTime: { messages: 0, users: 0, calls: 0, callsDuration: 0 },
  loading: true,
  error: null,
};

export interface UnreadCounts {
  [channelId: string]: number;
}

/**
 * Presence status from Socket.IO (online/away/offline)
 * This is managed via Redis + Socket.IO, NOT Zero/DB
 */
export type PresenceStatus = 'ONLINE' | 'AWAY' | 'OFFLINE';

/**
 * Online user info received from backend
 */
export interface OnlineUser {
  userId: string;
  status: PresenceStatus;
}

/**
 * Socket.IO event payload for user_status_updated
 * Sent on connect (for connecting user) and on any status change (for all users)
 */
export interface UserStatusUpdatedEvent {
  userId: string;
  status: PresenceStatus;
  onlineUsers: OnlineUser[];
}

// Keeping same type for browsable channels and user channels
interface StateMachineContext {
  users: User[];
  /** Watermark timestamps for delta queries */
  watermark: {
    usersUpdatedAt: number;
    allChannelsUpdatedAt: number;
  };
  bookmarks: Bookmarks[];
  visibleChannels: Channel[];
  allChannels: Channel[];
  permissions: UserPermission[];
  userChannelStatuses: UserChannelStatus[];
  lastVisitedChannelId: string | null;
  drafts: DraftMessages; // Draft messages per channel/conversation
  draftMessages: DraftMessageDB[];
  allUserGroups: UserGroup[];
  metrics: MetricsState;
  filteredTicketIds: string[];
  zeroRefreshCounter?: number;
  /** List of all currently online users from Redis */
  onlineUsers: OnlineUser[];
  /** Overlay depth for tracking open dialogs/modals */
  overlayDepth: number;
}

type StateMachineEvent =
  | { type: 'ADD_USERS'; users: User[]; usersUpdatedAt?: number }
  | { type: 'MERGE_USERS'; users: User[]; usersUpdatedAt: number }
  | { type: 'ADD_USER_BOOKMARKS'; bookmarks: Bookmarks[] }
  | { type: 'ADD_VISIBLE_CHANNELS'; channels: Channel[] }
  | { type: 'ADD_ALL_CHANNELS'; channels: Channel[]; allChannelsUpdatedAt?: number }
  | { type: 'MERGE_ALL_CHANNELS'; channels: Channel[]; allChannelsUpdatedAt: number }
  | { type: 'SET_USER_PERMISSIONS'; permissions: UserPermission[] }
  | { type: 'ADD_USER_CHANNEL_STATUSES'; userChannelStatuses: UserChannelStatus[] }
  | { type: 'SET_LAST_VISITED_CHANNEL'; channelId: string | null }
  | { type: 'SAVE_DRAFT'; lookupId: string; html: string; text: string }
  | { type: 'REMOVE_DRAFT'; lookupId: string }
  | { type: 'ADD_ALL_USER_GROUPS'; userGroups: UserGroup[] }
  | { type: 'ADD_USER_DRAFTS'; draftMessages: DraftMessageDB[] }
  | { type: 'SET_METRICS'; metrics: Omit<MetricsState, 'loading' | 'error'> }
  | { type: 'SET_METRICS_LOADING'; loading: boolean }
  | { type: 'SET_METRICS_ERROR'; error: string | null }
  | { type: 'REFRESH_ZERO' }
  | {
      type: 'UPDATE_METRIC';
      period: 'today' | 'allTime';
      metric: keyof PeriodMetrics;
      value: number;
    }
  | { type: 'SET_FILTERED_TICKET_IDS'; ids: string[] }
  | { type: 'SET_ONLINE_USERS'; onlineUsers: OnlineUser[] }
  | { type: 'PUSH_OVERLAY' }
  | { type: 'POP_OVERLAY' };

export const stateMachine = setup({
  types: {
    context: {
      zeroRefreshCounter: 0,
    } as StateMachineContext,
    events: {} as StateMachineEvent,
  },
  actions: {
    addUsers: assign({
      users: ({ context, event }) => {
        if (event.type === 'ADD_USERS') {
          return event.users;
        }
        return context.users;
      },
      watermark: ({ context, event }) => {
        if (event.type === 'ADD_USERS' && event.usersUpdatedAt !== undefined) {
          return {
            ...context.watermark,
            usersUpdatedAt: Math.max(context.watermark.usersUpdatedAt, event.usersUpdatedAt),
          };
        }
        return context.watermark;
      },
    }),
    mergeUsers: assign({
      users: ({ context, event }) => {
        if (event.type === 'MERGE_USERS') {
          const userMap = new Map(context.users.map(u => [u.id, u]));
          for (const u of event.users) {
            userMap.set(u.id, u);
          }
          return Array.from(userMap.values());
        }
        return context.users;
      },
      watermark: ({ context, event }) => {
        if (event.type === 'MERGE_USERS') {
          return {
            ...context.watermark,
            usersUpdatedAt: Math.max(context.watermark.usersUpdatedAt, event.usersUpdatedAt),
          };
        }
        return context.watermark;
      },
    }),
    addUserBookmarks: assign({
      bookmarks: ({ context, event }) => {
        if (event.type === 'ADD_USER_BOOKMARKS') {
          return event.bookmarks;
        }
        return context.bookmarks;
      },
    }),
    addVisibleChannels: assign({
      visibleChannels: ({ context, event }) => {
        if (event.type === 'ADD_VISIBLE_CHANNELS') {
          return event.channels;
        }
        return context.visibleChannels;
      },
    }),
    addAllChannels: assign({
      allChannels: ({ context, event }) => {
        if (event.type === 'ADD_ALL_CHANNELS') {
          return event.channels;
        }
        return context.allChannels;
      },
      watermark: ({ context, event }) => {
        if (event.type === 'ADD_ALL_CHANNELS' && event.allChannelsUpdatedAt !== undefined) {
          return {
            ...context.watermark,
            allChannelsUpdatedAt: Math.max(
              context.watermark.allChannelsUpdatedAt,
              event.allChannelsUpdatedAt,
            ),
          };
        }
        return context.watermark;
      },
    }),
    mergeAllChannels: assign({
      allChannels: ({ context, event }) => {
        if (event.type === 'MERGE_ALL_CHANNELS') {
          const channelMap = new Map(context.allChannels.map(c => [c.id, c]));
          for (const c of event.channels) {
            channelMap.set(c.id, c);
          }
          return Array.from(channelMap.values());
        }
        return context.allChannels;
      },
      watermark: ({ context, event }) => {
        if (event.type === 'MERGE_ALL_CHANNELS') {
          return {
            ...context.watermark,
            allChannelsUpdatedAt: Math.max(
              context.watermark.allChannelsUpdatedAt,
              event.allChannelsUpdatedAt,
            ),
          };
        }
        return context.watermark;
      },
    }),
    setUserPermissions: assign({
      permissions: ({ context, event }) => {
        if (event.type === 'SET_USER_PERMISSIONS') {
          return event.permissions;
        }
        return context.permissions;
      },
    }),
    addUserChannelStatuses: assign({
      userChannelStatuses: ({ context, event }) => {
        if (event.type === 'ADD_USER_CHANNEL_STATUSES') {
          return event.userChannelStatuses;
        }
        return context.userChannelStatuses;
      },
    }),
    setLastVisitedChannel: assign({
      lastVisitedChannelId: ({ context, event }) => {
        if (event.type === 'SET_LAST_VISITED_CHANNEL') {
          if (event.channelId) {
            localStorage.setItem('lastVisitedChannelId', event.channelId);
          } else {
            localStorage.removeItem('lastVisitedChannelId');
          }
          return event.channelId;
        }
        return context.lastVisitedChannelId;
      },
    }),
    saveDraft: assign({
      drafts: ({ context, event }) => {
        if (event.type === 'SAVE_DRAFT') {
          const updatedDrafts = {
            ...context.drafts,
            [event.lookupId]: { html: event.html, text: event.text, updatedAt: Date.now() },
          };
          try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(updatedDrafts));
          } catch {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(updatedDrafts));
          }
          return updatedDrafts;
        }
        return context.drafts;
      },
    }),
    removeDraft: assign({
      drafts: ({ context, event }) => {
        if (event.type === 'REMOVE_DRAFT') {
          const { [event.lookupId]: _, ...rest } = context.drafts;
          try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
          } catch {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
          }
          return rest;
        }
        return context.drafts;
      },
    }),
    addAllUserGroups: assign({
      allUserGroups: ({ context, event }) => {
        if (event.type === 'ADD_ALL_USER_GROUPS') {
          return event.userGroups;
        }
        return context.allUserGroups;
      },
    }),
    addUserDrafts: assign({
      draftMessages: ({ context, event }) => {
        if (event.type === 'ADD_USER_DRAFTS') {
          return event.draftMessages;
        }
        return context.draftMessages;
      },
    }),
    setMetrics: assign({
      metrics: ({ context, event }) => {
        if (event.type === 'SET_METRICS') {
          return { ...context.metrics, ...event.metrics, loading: false, error: null };
        }
        return context.metrics;
      },
    }),
    setMetricsLoading: assign({
      metrics: ({ context, event }) => {
        if (event.type === 'SET_METRICS_LOADING') {
          return { ...context.metrics, loading: event.loading };
        }
        return context.metrics;
      },
    }),
    refreshZero: assign({
      zeroRefreshCounter: ({ context }) => {
        return (context.zeroRefreshCounter || 0) + 1;
      },
    }),
    setMetricsError: assign({
      metrics: ({ context, event }) => {
        if (event.type === 'SET_METRICS_ERROR') {
          return { ...context.metrics, error: event.error, loading: false };
        }
        return context.metrics;
      },
    }),
    updateMetric: assign({
      metrics: ({ context, event }) => {
        if (event.type === 'UPDATE_METRIC') {
          return {
            ...context.metrics,
            [event.period]: {
              ...context.metrics[event.period],
              [event.metric]: event.value,
            },
          };
        }
        return context.metrics;
      },
    }),
    setFilteredTicketIds: assign({
      filteredTicketIds: ({ context, event }) => {
        if (event.type === 'SET_FILTERED_TICKET_IDS') {
          return event.ids;
        }
        return context.filteredTicketIds;
      },
    }),
    setOnlineUsers: assign({
      onlineUsers: ({ event }) => {
        if (event.type === 'SET_ONLINE_USERS') {
          return event.onlineUsers;
        }
        return [];
      },
    }),
    pushOverlay: assign({
      overlayDepth: ({ context }) => context.overlayDepth + 1,
    }),
    popOverlay: assign({
      overlayDepth: ({ context }) => Math.max(0, context.overlayDepth - 1),
    }),
  },
}).createMachine({
  id: 'stateMachine',
  context: {
    users: [],
    watermark: {
      usersUpdatedAt: 0,
      allChannelsUpdatedAt: 0,
    },
    bookmarks: [],
    visibleChannels: [],
    allChannels: [],
    permissions: [],
    userChannelStatuses: [],
    lastVisitedChannelId: localStorage.getItem('lastVisitedChannelId'),
    drafts: JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}') as DraftMessages,
    draftMessages: [],
    allUserGroups: [],
    metrics: initialMetricsState,
    filteredTicketIds: [],
    onlineUsers: [],
    overlayDepth: 0,
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        ADD_USERS: {
          actions: 'addUsers',
        },
        MERGE_USERS: {
          actions: 'mergeUsers',
        },
        ADD_USER_BOOKMARKS: {
          actions: 'addUserBookmarks',
        },
        ADD_VISIBLE_CHANNELS: {
          actions: 'addVisibleChannels',
        },
        ADD_ALL_CHANNELS: {
          actions: 'addAllChannels',
        },
        MERGE_ALL_CHANNELS: {
          actions: 'mergeAllChannels',
        },
        SET_USER_PERMISSIONS: {
          actions: 'setUserPermissions',
        },
        ADD_USER_CHANNEL_STATUSES: {
          actions: 'addUserChannelStatuses',
        },
        SET_LAST_VISITED_CHANNEL: {
          actions: 'setLastVisitedChannel',
        },
        SAVE_DRAFT: {
          actions: 'saveDraft',
        },
        REMOVE_DRAFT: {
          actions: 'removeDraft',
        },
        ADD_ALL_USER_GROUPS: {
          actions: 'addAllUserGroups',
        },
        ADD_USER_DRAFTS: {
          actions: 'addUserDrafts',
        },
        SET_METRICS: {
          actions: 'setMetrics',
        },
        SET_METRICS_LOADING: {
          actions: 'setMetricsLoading',
        },
        SET_METRICS_ERROR: {
          actions: 'setMetricsError',
        },
        UPDATE_METRIC: {
          actions: 'updateMetric',
        },
        SET_FILTERED_TICKET_IDS: {
          actions: 'setFilteredTicketIds',
        },
        REFRESH_ZERO: {
          actions: 'refreshZero',
        },
        SET_ONLINE_USERS: {
          actions: 'setOnlineUsers',
        },
        PUSH_OVERLAY: {
          actions: 'pushOverlay',
        },
        POP_OVERLAY: {
          actions: 'popOverlay',
        },
      },
    },
  },
});

export const stateMachineActor = createActor(stateMachine).start();

// Flag to track if presence listeners are already set up
let presenceListenersSetup = false;
let currentPresenceUserId: string | null = null;

/**
 * Setup Socket.IO listeners for presence events
 * Called once when the app initializes and socket is connected
 */
export function setupPresenceListeners(
  userId: string,
  websocketService: {
    on: <T>(event: string, callback: (data: T) => void) => void;
    removeListener: (event: string) => void;
  },
): void {
  if (presenceListenersSetup && currentPresenceUserId === userId) {
    return;
  }

  // If user ID changed, clean up previous listeners
  if (presenceListenersSetup && currentPresenceUserId !== userId) {
    cleanupPresenceListeners(websocketService);
  }

  currentPresenceUserId = userId;

  // Listen for status updates - backend sends fresh onlineUsers list
  // This is sent on connect (for connecting user) and on any status change
  websocketService.on<UserStatusUpdatedEvent>('user_status_updated', data => {
    stateMachineActor.send({ type: 'SET_ONLINE_USERS', onlineUsers: data.onlineUsers });
  });

  presenceListenersSetup = true;
}

/**
 * Cleanup presence listeners (on logout/disconnect)
 */
export function cleanupPresenceListeners(websocketService: {
  removeListener: (event: string) => void;
}): void {
  if (!presenceListenersSetup) return;

  websocketService.removeListener('user_status_updated');

  stateMachineActor.send({ type: 'SET_ONLINE_USERS', onlineUsers: [] });
  presenceListenersSetup = false;
  currentPresenceUserId = null;
}

/**
 * Request a status update from the server
 * @param status - The desired status (ONLINE, AWAY, OFFLINE)
 */
export function updateMyStatus(
  status: PresenceStatus,
  websocketService: { emit: (event: string, data: unknown) => void },
): void {
  websocketService.emit('update_status', { status });
}

/**
 * Get current overlay state
 */
export function getHasOverlay(): boolean {
  return stateMachineActor.getSnapshot().context.overlayDepth > 0;
}

/**
 * Hook to check if any overlay (dialog/modal) is currently open
 */
export function useHasOverlay(): boolean {
  return useSelector(stateMachineActor, state => state.context.overlayDepth > 0);
}

/**
 * Hook to automatically manage overlay depth when a dialog/modal opens/closes
 * @param isOpen - Whether the overlay is currently open
 */
export function useOverlayEffect(isOpen: boolean): void {
  useEffect(() => {
    if (isOpen) {
      stateMachineActor.send({ type: 'PUSH_OVERLAY' });
      return () => {
        stateMachineActor.send({ type: 'POP_OVERLAY' });
      };
    }
    return undefined;
  }, [isOpen]);
}
