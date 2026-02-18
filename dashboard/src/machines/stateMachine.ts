import { setup, assign, createActor } from 'xstate';
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

// Keeping same type for browsable channels and user channels
interface StateMachineContext {
  users: User[];
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
}

type StateMachineEvent =
  | { type: 'ADD_USERS'; users: User[] }
  | { type: 'ADD_USER_BOOKMARKS'; bookmarks: Bookmarks[] }
  | { type: 'ADD_VISIBLE_CHANNELS'; channels: Channel[] }
  | { type: 'ADD_ALL_CHANNELS'; channels: Channel[] }
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
  | { type: 'SET_FILTERED_TICKET_IDS'; ids: string[] };

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
  },
}).createMachine({
  id: 'stateMachine',
  context: {
    users: [],
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
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        ADD_USERS: {
          actions: 'addUsers',
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
      },
    },
  },
});

export const stateMachineActor = createActor(stateMachine).start();
