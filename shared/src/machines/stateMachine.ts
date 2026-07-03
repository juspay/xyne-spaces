import { setup, assign, createActor } from 'xstate';
import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { queries } from '../zero/queries.js';
import { QueryResultType } from '@rocicorp/zero';
import type { Channel } from '../zero/schema.js';

// Safe localStorage access for cross-platform compatibility
const safeGetItem = (key: string): string | null => {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch { /* no-op on native */ }
  return null;
};

const safeSetItem = (key: string, value: string): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch { /* no-op on native */ }
};

const safeRemoveItem = (key: string): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch { /* no-op on native */ }
};

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

export type User = QueryResultType<typeof queries.getUsersV2>[number];
export type Bookmarks = QueryResultType<typeof queries.userBookmarks>[number];
export type VisibleChannel = NonNullable<QueryResultType<typeof queries.userVisibleChannelsV3>[number]['channel']>;
export type UserGroup = QueryResultType<typeof queries.getAllUserGroups>[number];
export type UserGroupMapping = QueryResultType<typeof queries.getUserGroupMappingsByUserId>[number];
export type UserPermission = {
  resourceName: string;
  accessType: 'READ' | 'WRITE' | 'ADMIN';
};
export type UserChannelStatus = QueryResultType<typeof queries.getAllChannelsUserStatus>[number];

export type Conversation = QueryResultType<typeof queries.channelConversationsPaginatedV3>[number];

export type DraftMessageDB = QueryResultType<typeof queries.userDrafts>[number];
export type DelayedMessageDB = QueryResultType<typeof queries.userDelayedMessages>[number];
export type UnreadActivity = QueryResultType<typeof queries.userUnreadActivities>[number];
export type UserPreference = QueryResultType<typeof queries.getCurrentUserPreference>;

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

export interface ThreadTrackingEntry {
  lastReadAt: number | null;
  scrollTop: number | null;
  updatedAt: number;
}

export interface ThreadTrackingMap {
  [conversationId: string]: ThreadTrackingEntry | undefined;
}

const THREAD_TRACKING_STORAGE_KEY = 'xyne:thread-tracking';
const MAX_THREAD_TRACKING_ENTRIES = 300;

const pruneThreadTracking = (tracking: ThreadTrackingMap): ThreadTrackingMap => {
  const entries = Object.entries(tracking).filter(([, value]) => value !== undefined) as Array<
    [string, ThreadTrackingEntry]
  >;
  if (entries.length <= MAX_THREAD_TRACKING_ENTRIES) {
    return tracking;
  }

  const sorted = entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(sorted.slice(0, MAX_THREAD_TRACKING_ENTRIES));
};

const hydrateThreadTracking = (): ThreadTrackingMap => {
  try {
    const raw = safeGetItem(THREAD_TRACKING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: ThreadTrackingMap = {};
    for (const [conversationId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<ThreadTrackingEntry>;
      result[conversationId] = {
        lastReadAt: typeof candidate.lastReadAt === 'number' ? candidate.lastReadAt : null,
        scrollTop: typeof candidate.scrollTop === 'number' ? candidate.scrollTop : null,
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
      };
    }
    return pruneThreadTracking(result);
  } catch {
    return {};
  }
};

const persistThreadTracking = (tracking: ThreadTrackingMap): void => {
  try {
    safeSetItem(THREAD_TRACKING_STORAGE_KEY, JSON.stringify(tracking));
  } catch {
    // no-op when storage unavailable
  }
};

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
}

export interface UserStatusSyncEvent {
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
  visibleChannels: VisibleChannel[];
  allChannels: Channel[];
  permissions: UserPermission[];
  userChannelStatuses: UserChannelStatus[];
  lastVisitedChannelIds: Record<string, string>;
  /** Per-route-keyword saved paths, populated by the SaveRoute HOC. */
  savedRoutes: Record<string, string>;
  drafts: DraftMessages; // Draft messages per channel/conversation
  draftMessages: DraftMessageDB[];
  delayedMessages: DelayedMessageDB[];
  userPreference: UserPreference;
  allUserGroups: UserGroup[];
  userGroupMappings: UserGroupMapping[];
  currentUserRoleIds: string[];
  metrics: MetricsState;
  filteredTicketIds: string[];
  zeroRefreshCounter?: number;
  /** List of all currently online users from Redis */
  onlineUsers: OnlineUser[];
  /** Overlay depth for tracking open dialogs/modals */
  overlayDepth: number;
  /** Per-conversation thread read/scroll tracking */
  threadTracking: ThreadTrackingMap;
  /** Unread activities from zero query, used to derive unread counts */
  unreadActivities: UnreadActivity[];
}

type StateMachineEvent =
  | { type: 'ADD_USERS'; users: User[]; usersUpdatedAt?: number }
  | { type: 'MERGE_USERS'; users: User[]; usersUpdatedAt: number }
  | { type: 'ADD_USER_BOOKMARKS'; bookmarks: Bookmarks[] }
  | { type: 'ADD_VISIBLE_CHANNELS'; channels: VisibleChannel[] }
  | { type: 'ADD_ALL_CHANNELS'; channels: Channel[]; allChannelsUpdatedAt?: number }
  | { type: 'MERGE_ALL_CHANNELS'; channels: Channel[]; allChannelsUpdatedAt: number }
  | { type: 'SET_USER_PERMISSIONS'; permissions: UserPermission[] }
  | { type: 'ADD_USER_CHANNEL_STATUSES'; userChannelStatuses: UserChannelStatus[] }
  | { type: 'UPDATE_USER_CHANNEL_STATUS'; channelId: string; updates: Partial<UserChannelStatus> }
  | { type: 'SET_LAST_VISITED_CHANNEL'; channelId: string | null; workspaceId: string }
  | { type: 'SET_SAVED_ROUTE'; keyword: string; path: string | null }
  | { type: 'SAVE_DRAFT'; lookupId: string; html: string; text: string }
  | { type: 'REMOVE_DRAFT'; lookupId: string }
  | { type: 'ADD_ALL_USER_GROUPS'; userGroups: UserGroup[] }
  | { type: 'ADD_USER_GROUP_MAPPINGS'; userGroupMappings: UserGroupMapping[] }
  | { type: 'SET_CURRENT_USER_ROLE_IDS'; roleIds: string[] }
  | { type: 'ADD_USER_DRAFTS'; draftMessages: DraftMessageDB[] }
  | { type: 'ADD_USER_DELAYED_MESSAGES'; delayedMessages: DelayedMessageDB[] }
  | { type: 'SET_USER_PREFERENCE'; userPreference: UserPreference }
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
  | { type: 'UPDATE_USER_STATUS'; userId: string; status: PresenceStatus }
  | { type: 'PUSH_OVERLAY' }
  | { type: 'POP_OVERLAY' }
  | { type: 'ARCHIVE_CHANNEL'; channelId: string }
  | { type: 'UNARCHIVE_CHANNEL'; channelId: string }
  | { type: 'SET_THREAD_LAST_READ'; conversationId: string; lastReadAt: number }
  | { type: 'SET_THREAD_SCROLL'; conversationId: string; scrollTop: number }
  | { type: 'SET_UNREAD_ACTIVITIES'; unreadActivities: UnreadActivity[] };

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
    updateUserChannelStatus: assign({
      userChannelStatuses: ({ context, event }) => {
        if (event.type === 'UPDATE_USER_CHANNEL_STATUS') {
          return context.userChannelStatuses.map(status =>
            status.channelId === event.channelId ? { ...status, ...event.updates } : status,
          );
        }
        return context.userChannelStatuses;
      },
    }),
    setLastVisitedChannel: assign({
      lastVisitedChannelIds: ({ context, event }) => {
        if (event.type === 'SET_LAST_VISITED_CHANNEL') {
          const key = `lastVisitedChannelId_${event.workspaceId}`;
          if (event.channelId) {
            safeSetItem(key, event.channelId);
            return { ...context.lastVisitedChannelIds, [event.workspaceId]: event.channelId };
          } else {
            safeRemoveItem(key);
            const next = { ...context.lastVisitedChannelIds };
            delete next[event.workspaceId];
            return next;
          }
        }
        return context.lastVisitedChannelIds;
      },
    }),
    setSavedRoute: assign({
      savedRoutes: ({ context, event }) => {
        if (event.type !== 'SET_SAVED_ROUTE') return context.savedRoutes;
        const next = { ...context.savedRoutes };
        if (event.path) {
          next[event.keyword] = event.path;
        } else {
          delete next[event.keyword];
        }
        try {
          safeSetItem('savedRoutes', JSON.stringify(next));
        } catch {
          // storage unavailable — fall through
        }
        return next;
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
            safeSetItem(DRAFT_STORAGE_KEY, JSON.stringify(updatedDrafts));
          } catch {
            safeSetItem(DRAFT_STORAGE_KEY, JSON.stringify(updatedDrafts));
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
            safeSetItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
          } catch {
            safeSetItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
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
    addUserGroupMappings: assign({
      userGroupMappings: ({ context, event }) => {
        if (event.type === 'ADD_USER_GROUP_MAPPINGS') {
          return event.userGroupMappings;
        }
        return context.userGroupMappings;
      },
    }),
    addCurrentUserRoleMappings: assign({
      currentUserRoleIds: ({ context, event }) => {
        if (event.type === 'SET_CURRENT_USER_ROLE_IDS') {
          return event.roleIds;
        }
        return context.currentUserRoleIds;
      },
    }),
    addUserDrafts: assign({
      draftMessages: ({ context, event }) => {
        if (event.type === 'ADD_USER_DRAFTS') {
          return event.draftMessages.filter(d => {
            const hasContent = d.content.trim() !== '';
            const hasAttachments = (d.attachments?.length ?? 0) > 0;
            return hasContent || hasAttachments;
          });
        }
        return context.draftMessages;
      },
    }),
    addUserDelayedMessages: assign({
      delayedMessages: ({ context, event }) => {
        if (event.type === 'ADD_USER_DELAYED_MESSAGES') {
          return event.delayedMessages;
        }
        return context.delayedMessages;
      },
    }),
    setUserPreference: assign({
      userPreference: ({ context, event }) => {
        if (event.type === 'SET_USER_PREFERENCE') {
          return event.userPreference;
        }
        return context.userPreference;
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
    updateUserStatus: assign({
      onlineUsers: ({ context, event }) => {
        if (event.type === 'UPDATE_USER_STATUS') {
          if (event.status === 'OFFLINE') {
            return context.onlineUsers.filter(u => u.userId !== event.userId);
          }
          const existing = context.onlineUsers.find(u => u.userId === event.userId);
          if (existing) {
            return context.onlineUsers.map(u => 
              u.userId === event.userId ? { ...u, status: event.status } : u
            );
          } else {
            return [...context.onlineUsers, { userId: event.userId, status: event.status }];
          }
        }
        return context.onlineUsers;
      }
    }),
    pushOverlay: assign({
      overlayDepth: ({ context }) => context.overlayDepth + 1,
    }),
    popOverlay: assign({
      overlayDepth: ({ context }) => Math.max(0, context.overlayDepth - 1),
    }),
    archiveChannel: assign({
      visibleChannels: ({ context, event }) => {
        if (event.type === 'ARCHIVE_CHANNEL') {
          return context.visibleChannels.filter(c => c.id !== event.channelId);
        }
        return context.visibleChannels;
      },
      allChannels: ({ context, event }) => {
        if (event.type === 'ARCHIVE_CHANNEL') {
          return context.allChannels.map(c =>
            c.id === event.channelId ? { ...c, isArchived: true } : c,
          );
        }
        return context.allChannels;
      },
    }),
    unarchiveChannel: assign({
      visibleChannels: ({ context, event }) => {
        if (event.type === 'UNARCHIVE_CHANNEL') {
          const channel = context.allChannels.find(c => c.id === event.channelId);
          if (channel && !context.visibleChannels.some(c => c.id === event.channelId)) {
            return [
              ...context.visibleChannels,
              { ...channel, isArchived: false },
            ] as VisibleChannel[];
          }
        }
        return context.visibleChannels;
      },
      allChannels: ({ context, event }) => {
        if (event.type === 'UNARCHIVE_CHANNEL') {
          return context.allChannels.map(c =>
            c.id === event.channelId ? { ...c, isArchived: false } : c,
          );
        }
        return context.allChannels;
      },
    }),
    setThreadLastRead: assign({
      threadTracking: ({ context, event }) => {
        if (event.type !== 'SET_THREAD_LAST_READ') {
          return context.threadTracking;
        }
        const existing = context.threadTracking[event.conversationId];
        const next = pruneThreadTracking({
          ...context.threadTracking,
          [event.conversationId]: {
            lastReadAt: event.lastReadAt,
            scrollTop: existing?.scrollTop ?? null,
            updatedAt: Date.now(),
          },
        });
        persistThreadTracking(next);
        return next;
      },
    }),
    setThreadScroll: assign({
      threadTracking: ({ context, event }) => {
        if (event.type !== 'SET_THREAD_SCROLL') {
          return context.threadTracking;
        }
        const existing = context.threadTracking[event.conversationId];
        const next = pruneThreadTracking({
          ...context.threadTracking,
          [event.conversationId]: {
            lastReadAt: existing?.lastReadAt ?? null,
            scrollTop: event.scrollTop,
            updatedAt: Date.now(),
          },
        });
        persistThreadTracking(next);
        return next;
      },
    }),
    setUnreadActivities: assign({
      unreadActivities: ({ event }) => {
        if (event.type === 'SET_UNREAD_ACTIVITIES') {
          return event.unreadActivities;
        }
        return [];
      },
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
    lastVisitedChannelIds: (() => {
      const result: Record<string, string> = {};
      try {
        if (typeof localStorage !== 'undefined') {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('lastVisitedChannelId_')) {
              const wsId = key.slice('lastVisitedChannelId_'.length);
              const value = localStorage.getItem(key);
              if (value) result[wsId] = value;
            }
          }
        }
      } catch {
        // ignore
      }
      return result;
    })(),
    savedRoutes: (() => {
      try {
        const raw = safeGetItem('savedRoutes');
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, string>;
        }
      } catch {
        // ignore
      }
      return {};
    })(),
    drafts: JSON.parse(safeGetItem(DRAFT_STORAGE_KEY) || '{}') as DraftMessages,
    draftMessages: [],
    delayedMessages: [],
    userPreference: undefined,
    allUserGroups: [],
    userGroupMappings: [],
    currentUserRoleIds: [],
    metrics: initialMetricsState,
    filteredTicketIds: [],
    onlineUsers: [],
    overlayDepth: 0,
    threadTracking: hydrateThreadTracking(),
    unreadActivities: [],
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
        UPDATE_USER_CHANNEL_STATUS: {
          actions: 'updateUserChannelStatus',
        },
        SET_LAST_VISITED_CHANNEL: {
          actions: 'setLastVisitedChannel',
        },
        SET_SAVED_ROUTE: {
          actions: 'setSavedRoute',
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
        ADD_USER_GROUP_MAPPINGS: {
          actions: 'addUserGroupMappings',
        },
        SET_CURRENT_USER_ROLE_IDS: {
          actions: 'addCurrentUserRoleMappings',
        },
        ADD_USER_DRAFTS: {
          actions: 'addUserDrafts',
        },
        ADD_USER_DELAYED_MESSAGES: {
          actions: 'addUserDelayedMessages',
        },
        SET_USER_PREFERENCE: {
          actions: 'setUserPreference',
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
        UPDATE_USER_STATUS: {
          actions: 'updateUserStatus',
        },
        PUSH_OVERLAY: {
          actions: 'pushOverlay',
        },
        POP_OVERLAY: {
          actions: 'popOverlay',
        },
        ARCHIVE_CHANNEL: {
          actions: 'archiveChannel',
        },
        UNARCHIVE_CHANNEL: {
          actions: 'unarchiveChannel',
        },
        SET_THREAD_LAST_READ: {
          actions: 'setThreadLastRead',
        },
        SET_THREAD_SCROLL: {
          actions: 'setThreadScroll',
        },
        SET_UNREAD_ACTIVITIES: {
          actions: 'setUnreadActivities',
        },
      },
    },
  },
});

export const stateMachineActor = createActor(stateMachine).start();

export function getThreadTrackingSnapshot(
  conversationId: string,
): ThreadTrackingEntry | undefined {
  return stateMachineActor.getSnapshot().context.threadTracking[conversationId];
}

export function setThreadLastRead(conversationId: string, lastReadAt: number): void {
  stateMachineActor.send({ type: 'SET_THREAD_LAST_READ', conversationId, lastReadAt });
}

export function setThreadScroll(conversationId: string, scrollTop: number): void {
  stateMachineActor.send({ type: 'SET_THREAD_SCROLL', conversationId, scrollTop });
}

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
  websocketService.on<UserStatusSyncEvent>('user_status_sync', data => {
    stateMachineActor.send({ type: 'SET_ONLINE_USERS', onlineUsers: data.onlineUsers });
  });

  websocketService.on<UserStatusUpdatedEvent>('user_status_updated', data => {
    stateMachineActor.send({ type: 'UPDATE_USER_STATUS', userId: data.userId, status: data.status });
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
  websocketService.removeListener('user_status_sync');

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
