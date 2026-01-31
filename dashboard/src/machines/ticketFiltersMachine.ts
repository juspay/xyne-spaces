import { setup, assign } from 'xstate';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';
import { TicketPriority } from '@xyne/shared';

/* -------------------------- CONSTANTS -------------------------- */

const STORAGE_KEY_PREFIX = 'ticket-filters';

/* -------------------------- TYPES -------------------------- */

interface StorageData {
  filters: TicketFilters;
  viewType?: 'status' | 'stage' | 'board';
}

export interface TicketFiltersContext {
  filters: TicketFilters;
  viewType: 'status' | 'stage' | 'board';
  channelId?: string;
  projectId?: string;
  boardId?: string;
  viewMode?: string;
  enabled: boolean;
  storageKey: string;
  urlFilters: TicketFilters;
  urlViewType?: 'status' | 'stage' | 'board';
  currentSearchParams?: URLSearchParams;
  setSearchParams?: (
    params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  ) => void;
}

export type TicketFiltersEvent =
  | {
      type: 'INIT';
      channelId?: string | undefined;
      projectId?: string | undefined;
      boardId?: string | undefined;
      viewMode?: string | undefined;
      enabled?: boolean | undefined;
      searchParams: URLSearchParams;
      setSearchParams: (
        params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
      ) => void;
    }
  | { type: 'SET_FILTERS'; filters: TicketFilters }
  | { type: 'SET_VIEW_TYPE'; viewType: 'status' | 'stage' | 'board' }
  | { type: 'URL_CHANGED'; searchParams: URLSearchParams };

/* -------------------------- UTILITY FUNCTIONS -------------------------- */

/**
 * Generate a unique storage key based on channelId or boardId or ProjectId or viewMode
 */
const getStorageKey = (
  channelId?: string,
  viewMode?: string,
  projectId?: string,
  boardId?: string,
): string => {
  // Channel filters (for /chat/:channelId/tickets)
  if (channelId) return `${STORAGE_KEY_PREFIX}-channel-${channelId}`;

  // Board-specific filters (for /projects/:projectId/:boardId)
  if (boardId) return `${STORAGE_KEY_PREFIX}-board-${boardId}`;

  // Project-level filters (for /projects/:projectId)
  if (projectId) return `${STORAGE_KEY_PREFIX}-project-${projectId}`;

  // General view mode filters (for /projects, my-tickets, etc.)
  if (viewMode) return `${STORAGE_KEY_PREFIX}-${viewMode}`;

  return `${STORAGE_KEY_PREFIX}-default`;
};

/**
 * Read filters from URL search parameters
 */
const readFiltersFromUrl = (params: URLSearchParams): TicketFilters => {
  const filters: TicketFilters = {};

  const boards = params.getAll('board');
  if (boards.length) filters.boards = boards;

  const priorities = params.getAll('priority');
  if (priorities.length) {
    // Validate priorities against TicketPriority enum
    const validPriorities = priorities.filter((p): p is TicketPriority =>
      Object.values(TicketPriority).includes(p as TicketPriority),
    );
    if (validPriorities.length > 0) {
      filters.priority = validPriorities;
    }
  }

  const assignees = params.getAll('assignee');
  if (assignees.length) filters.assignee = assignees;

  const userGroups = params.getAll('userGroups');
  if (userGroups.length) filters.userGroups = userGroups;

  const createdBy = params.getAll('createdBy');
  if (createdBy.length) filters.createdBy = createdBy;

  const tags = params.getAll('tags');
  if (tags.length) filters.tags = tags;

  const dueDateStart = params.get('dueDateStart');
  if (dueDateStart) filters.dueDateStart = Number(dueDateStart);

  const dueDateEnd = params.get('dueDateEnd');
  if (dueDateEnd) filters.dueDateEnd = Number(dueDateEnd);

  const createdDateStart = params.get('createdDateStart');
  if (createdDateStart) filters.createdDateStart = Number(createdDateStart);

  const createdDateEnd = params.get('createdDateEnd');
  if (createdDateEnd) filters.createdDateEnd = Number(createdDateEnd);

  // Read dynamic fields from URL
  // Dynamic fields are stored with format: df_{fieldId}=value or df_{fieldId}_start=value&df_{fieldId}_end=value
  const dynamicFields: Record<string, string[] | { start?: number; end?: number }> = {};

  for (const [key, value] of params.entries()) {
    if (key.startsWith('df_')) {
      const parts = key.substring(3).split('_');
      const fieldId = parts[0];

      if (!fieldId) continue; // Skip if fieldId is empty

      if (parts.length === 2 && parts[1] === 'start') {
        // Range start (for DATE or NUMBER fields)
        if (!dynamicFields[fieldId]) dynamicFields[fieldId] = {};
        (dynamicFields[fieldId] as { start?: number; end?: number }).start = Number(value);
      } else if (parts.length === 2 && parts[1] === 'end') {
        // Range end (for DATE or NUMBER fields)
        if (!dynamicFields[fieldId]) dynamicFields[fieldId] = {};
        (dynamicFields[fieldId] as { start?: number; end?: number }).end = Number(value);
      } else {
        // Array value (for SELECT, STRING, BOOLEAN, USER fields)
        if (!dynamicFields[fieldId]) dynamicFields[fieldId] = [];
        (dynamicFields[fieldId] as string[]).push(value);
      }
    }
  }

  if (Object.keys(dynamicFields).length > 0) {
    filters.dynamicFields = dynamicFields;
  }

  return filters;
};

/**
 * Write filters to URL search parameters
 */
const writeFiltersToUrl = (params: URLSearchParams, filters: TicketFilters): void => {
  // Clear existing filter params
  params.delete('board');
  params.delete('priority');
  params.delete('assignee');
  params.delete('userGroups');
  params.delete('createdBy');
  params.delete('tags');
  params.delete('dueDateStart');
  params.delete('dueDateEnd');
  params.delete('createdDateStart');
  params.delete('createdDateEnd');

  // Clear existing dynamic field params
  for (const key of Array.from(params.keys())) {
    if (key.startsWith('df_')) {
      params.delete(key);
    }
  }

  // Add new filter params
  filters.boards?.forEach((b: string) => params.append('board', b));
  filters.priority?.forEach((p: TicketPriority) => params.append('priority', p));
  filters.assignee?.forEach((a: string) => params.append('assignee', a));
  filters.userGroups?.forEach((g: string) => params.append('userGroups', g));
  filters.createdBy?.forEach((u: string) => params.append('createdBy', u));
  filters.tags?.forEach((t: string) => params.append('tags', t));

  if (filters.dueDateStart !== undefined) {
    params.set('dueDateStart', filters.dueDateStart.toString());
  }
  if (filters.dueDateEnd !== undefined) {
    params.set('dueDateEnd', filters.dueDateEnd.toString());
  }
  if (filters.createdDateStart !== undefined) {
    params.set('createdDateStart', filters.createdDateStart.toString());
  }
  if (filters.createdDateEnd !== undefined) {
    params.set('createdDateEnd', filters.createdDateEnd.toString());
  }

  // Add dynamic field params
  if (filters.dynamicFields) {
    Object.entries(filters.dynamicFields).forEach(([fieldId, value]) => {
      if (Array.isArray(value)) {
        // Array values (for SELECT, STRING, BOOLEAN, USER fields)
        value.forEach(v => params.append(`df_${fieldId}`, v));
      } else if (typeof value === 'object') {
        // Range values (for DATE or NUMBER fields)
        if (value.start !== undefined) {
          params.set(`df_${fieldId}_start`, value.start.toString());
        }
        if (value.end !== undefined) {
          params.set(`df_${fieldId}_end`, value.end.toString());
        }
      }
    });
  }
};

/**
 * Load filters and viewType from sessionStorage
 */
const loadFromStorage = (key: string): StorageData => {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as StorageData;
      const result: StorageData = {
        filters: parsed.filters || {},
      };
      if (parsed.viewType) {
        result.viewType = parsed.viewType;
      }
      return result;
    }
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
  return { filters: {} };
};

/**
 * Save filters and viewType to sessionStorage
 */
const saveToStorage = (
  key: string,
  filters: TicketFilters,
  viewType?: 'status' | 'stage' | 'board',
): void => {
  try {
    const data: StorageData = { filters };
    if (viewType) {
      data.viewType = viewType;
    }
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

/* -------------------------- STATE MACHINE -------------------------- */

/**
 * XState machine for managing ticket filter persistence
 *
 * Handles synchronization between:
 * - Component state (filters, viewType)
 * - URL search parameters (for shareability and browser history)
 * - sessionStorage (for session persistence)
 *
 * States:
 * - idle: Initial state, waiting for initialization
 * - initialized: Ready to handle filter updates and URL changes
 *
 * Events:
 * - INIT: Initialize machine with channelId, viewMode, and current URL params
 * - SET_FILTERS: Update filters (syncs to URL and storage)
 * - SET_VIEW_TYPE: Update viewType (syncs to URL and storage)
 * - URL_CHANGED: Browser navigation detected (syncs from URL to state)
 */
export const ticketFiltersMachine = setup({
  types: {
    context: {} as TicketFiltersContext,
    events: {} as TicketFiltersEvent,
  },
  actions: {
    /**
     * Initialize machine from URL params or storage
     * Priority: URL params > sessionStorage > defaults
     */
    initializeFromUrl: assign(({ event, context }) => {
      if (event.type !== 'INIT') return context;

      const urlFilters = readFiltersFromUrl(event.searchParams);
      const urlViewType = event.searchParams.get('viewType');
      // UPDATED: Pass projectId and boardId to getStorageKey
      const storageKey = getStorageKey(
        event.channelId,
        event.viewMode,
        event.projectId,
        event.boardId,
      );
      const enabled = event.enabled ?? true;

      let filters: TicketFilters = {};
      let viewType: 'status' | 'stage' | 'board' = 'stage';

      if (enabled) {
        // Priority: URL > Storage > Default
        if (Object.keys(urlFilters).length > 0) {
          filters = urlFilters;
        } else {
          filters = loadFromStorage(storageKey).filters;
        }

        if (urlViewType === 'status' || urlViewType === 'stage' || urlViewType === 'board') {
          viewType = urlViewType;
        } else {
          viewType = loadFromStorage(storageKey).viewType || 'stage';
        }
      }

      const result: TicketFiltersContext = {
        ...context,
        filters,
        viewType,
        enabled,
        storageKey,
        urlFilters,
        currentSearchParams: event.searchParams,
        setSearchParams: event.setSearchParams,
      };

      // Store optional properties only if they exist
      if (event.channelId !== undefined) {
        result.channelId = event.channelId;
      }
      if (event.viewMode !== undefined) {
        result.viewMode = event.viewMode;
      }
      if (event.projectId !== undefined) {
        result.projectId = event.projectId;
      }
      if (event.boardId !== undefined) {
        result.boardId = event.boardId;
      }
      if (urlViewType === 'status' || urlViewType === 'stage' || urlViewType === 'board') {
        result.urlViewType = urlViewType;
      }

      return result;
    }),

    /**
     * Update filters in context
     */
    updateFilters: assign(({ event, context }) => {
      if (event.type !== 'SET_FILTERS') return context;
      return { ...context, filters: event.filters };
    }),

    /**
     * Update viewType in context
     */
    updateViewType: assign(({ event, context }) => {
      if (event.type !== 'SET_VIEW_TYPE') return context;
      return { ...context, viewType: event.viewType };
    }),

    /**
     * Sync URL params to context (browser back/forward)
     */
    syncFromUrl: assign(({ event, context }) => {
      if (event.type !== 'URL_CHANGED') return context;

      const urlFilters = readFiltersFromUrl(event.searchParams);
      const urlViewType = event.searchParams.get('viewType');

      // Destructure to remove old urlViewType and prevent it from being stale
      const { urlViewType: _old, ...restOfContext } = context;

      const result: TicketFiltersContext = {
        ...restOfContext,
        urlFilters,
        currentSearchParams: event.searchParams,
      };

      // Only add urlViewType if it exists in the URL, otherwise it's undefined (cleared)
      if (urlViewType === 'status' || urlViewType === 'stage' || urlViewType === 'board') {
        result.urlViewType = urlViewType;
      }

      return result;
    }),

    /**
     * Apply URL filters to state (when URL changes via browser navigation)
     */
    applyUrlFilters: assign(({ context }) => {
      if (!context.enabled || Object.keys(context.urlFilters).length === 0) {
        return context;
      }

      return {
        ...context,
        filters: context.urlFilters,
        viewType: context.urlViewType || context.viewType,
      };
    }),

    /**
     * Save current filters and viewType to sessionStorage
     */
    saveToStorage: ({ context }) => {
      if (!context.enabled) return;
      saveToStorage(context.storageKey, context.filters, context.viewType);
    },

    /**
     * Syncs current filters and viewType to the URL.
     * Updates both the context's currentSearchParams and the actual URL.
     */
    syncStateToUrl: assign(({ context }) => {
      if (!context.enabled || !context.setSearchParams) return context;

      // Create new params from current search params to preserve other URL params
      const params = new URLSearchParams(context.currentSearchParams ?? window.location.search);

      // Write filters and viewType to params
      writeFiltersToUrl(params, context.filters);

      params.set('viewType', context.viewType);

      // Update the URL
      context.setSearchParams(params);

      // Update context with new search params for next sync
      return {
        ...context,
        currentSearchParams: params,
      };
    }),
  },
  guards: {
    /**
     * Check if URL has filter parameters
     */
    hasUrlFilters: ({ context }) => Object.keys(context.urlFilters).length > 0,

    /**
     * Check if persistence is enabled
     */
    isEnabled: ({ context }) => context.enabled,
  },
}).createMachine({
  id: 'ticketFilters',
  initial: 'idle',
  context: {
    filters: {},
    viewType: 'stage',
    enabled: true,
    storageKey: `${STORAGE_KEY_PREFIX}-default`,
    urlFilters: {},
  },
  states: {
    /**
     * Initial state - waiting for initialization
     */
    idle: {
      on: {
        INIT: {
          target: 'initialized',
          actions: 'initializeFromUrl',
        },
      },
    },

    /**
     * Initialized state - ready to handle filter updates
     * Also handles INIT events to re-initialize when props change (e.g., different channelId/viewMode)
     */
    initialized: {
      entry: 'saveToStorage',
      on: {
        INIT: {
          target: 'initialized',
          actions: 'initializeFromUrl',
        },
        SET_FILTERS: {
          actions: ['updateFilters', 'syncStateToUrl', 'saveToStorage'],
        },
        SET_VIEW_TYPE: {
          actions: ['updateViewType', 'syncStateToUrl', 'saveToStorage'],
        },
        URL_CHANGED: {
          actions: ['syncFromUrl', 'applyUrlFilters', 'saveToStorage'],
        },
      },
    },
  },
});
