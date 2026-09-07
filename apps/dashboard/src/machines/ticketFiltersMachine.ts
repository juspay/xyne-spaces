import { setup, assign } from 'xstate';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';
import { TicketPriority } from '@xyne/shared';

/* -------------------------- CONSTANTS -------------------------- */

const STORAGE_KEY_PREFIX = 'ticket-filters';

/* -------------------------- TYPES -------------------------- */

interface StorageData {
  filters: TicketFilters;
  viewType?: 'status' | 'stage' | 'board';
  groupBy?: string;
  showOverdueOnly?: boolean;
  showSubStatus?: boolean;
}

export interface TicketFiltersContext {
  filters: TicketFilters;
  viewType: 'status' | 'stage' | 'board';
  groupBy: string;
  showOverdueOnly: boolean;
  showSubStatus: boolean;
  channelId?: string;
  projectId?: string;
  boardId?: string;
  viewMode?: string;
  enabled: boolean;
  storageKey: string;
  urlFilters: TicketFilters;
  urlViewType?: 'status' | 'stage' | 'board' | undefined;
  urlGroupBy?: string | undefined;
  urlShowOverdueOnly?: boolean | undefined;
  urlShowSubStatus?: boolean | undefined;
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
      viewId?: string | undefined;
      enabled?: boolean | undefined;
      selectedBoardIdFromDb?: string | null | undefined;
      searchParams: URLSearchParams;
      setSearchParams: (
        params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
      ) => void;
    }
  | { type: 'SET_FILTERS'; filters: TicketFilters }
  | { type: 'SET_VIEW_TYPE'; viewType: 'status' | 'stage' | 'board' }
  | { type: 'SET_GROUP_BY'; groupBy: string }
  | { type: 'SET_OVERDUE_ONLY'; showOverdueOnly: boolean }
  | { type: 'SET_SUB_STATUS'; showSubStatus: boolean }
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
  viewId?: string,
): string => {
  if (viewMode === 'support' && channelId) return `${STORAGE_KEY_PREFIX}-support-${channelId}`;
  // Channel filters (for /chat/:channelId/tickets)
  if (channelId) return `${STORAGE_KEY_PREFIX}-channel-${channelId}`;

  // Board-specific filters (for /projects/:projectId/:boardId)
  if (boardId) return `${STORAGE_KEY_PREFIX}-board-${boardId}`;

  // Project-level filters (for /projects/:projectId)
  if (projectId) return `${STORAGE_KEY_PREFIX}-project-${projectId}`;

  // Saved-view filters (for /projects/views/:viewId) — keyed per view so one
  // view's filters never bleed into the next.
  if (viewMode === 'workspace-view') {
    return `${STORAGE_KEY_PREFIX}-workspace-view-${viewId ?? 'new'}`;
  }

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

  const roleAssignmentsParams = params.getAll('roleAssignments');
  if (roleAssignmentsParams.length) {
    const roleAssignments: Array<{ roleId: string; userIds: string[] }> = [];
    for (const param of roleAssignmentsParams) {
      const [roleId, userIdsCsv] = param.split('|');
      if (!roleId) continue;
      const userIds = userIdsCsv ? userIdsCsv.split(',').filter(Boolean) : [];
      roleAssignments.push({ roleId, userIds });
    }
    if (roleAssignments.length) filters.roleAssignments = roleAssignments;
  }

  const tags = params.getAll('tags');
  if (tags.length) filters.tags = tags;

  const stages = params.getAll('stages');
  if (stages.length) filters.stages = stages;

  const ticketTypes = params.getAll('ticketTypes');
  if (ticketTypes.length) filters.ticketTypes = ticketTypes;

  const sourceChannels = params.getAll('sourceChannels');
  if (sourceChannels.length) filters.sourceChannels = sourceChannels;

  const aiCategory = params.getAll('aiCategory');
  if (aiCategory.length) filters.aiCategory = aiCategory;

  const generatedTags = params.getAll('generatedTags');
  if (generatedTags.length) filters.generatedTags = generatedTags;

  const hasAiDraft = params.get('hasAiDraft');
  if (hasAiDraft === '1') filters.hasAiDraft = true;

  const conversationLabelId = params.get('conversationLabelId');
  if (conversationLabelId) filters.conversationLabelId = conversationLabelId;

  const dueDateStart = params.get('dueDateStart');
  if (dueDateStart) filters.dueDateStart = Number(dueDateStart);

  const dueDateEnd = params.get('dueDateEnd');
  if (dueDateEnd) filters.dueDateEnd = Number(dueDateEnd);

  const createdDateStart = params.get('createdDateStart');
  if (createdDateStart) filters.createdDateStart = Number(createdDateStart);

  const createdDateEnd = params.get('createdDateEnd');
  if (createdDateEnd) filters.createdDateEnd = Number(createdDateEnd);

  const lastEmailAtStart = params.get('lastEmailAtStart');
  if (lastEmailAtStart) filters.lastEmailAtStart = Number(lastEmailAtStart);

  const lastEmailAtEnd = params.get('lastEmailAtEnd');
  if (lastEmailAtEnd) filters.lastEmailAtEnd = Number(lastEmailAtEnd);

  // My tickets filter toggles (assigned to me / created by me)
  const assigned = params.get('assigned');
  if (assigned === '1') filters.assigned = true;

  const created = params.get('created');
  if (created === '1') filters.created = true;

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

// Every URL param owned by ticket filters — keep in sync with readFiltersFromUrl/writeFiltersToUrl.
const FILTER_PARAM_KEYS = [
  'board',
  'priority',
  'assignee',
  'userGroups',
  'createdBy',
  'roleAssignments',
  'tags',
  'stages',
  'ticketTypes',
  'sourceChannels',
  'aiCategory',
  'generatedTags',
  'hasAiDraft',
  'conversationLabelId',
  'dueDateStart',
  'dueDateEnd',
  'createdDateStart',
  'createdDateEnd',
  'lastEmailAtStart',
  'lastEmailAtEnd',
  'assigned',
  'created',
] as const;

// Strips all ticket filter params (incl. df_* fields) — used when switching filter scopes (e.g. desk channels).
export const clearTicketFilterParams = (params: URLSearchParams): void => {
  for (const key of FILTER_PARAM_KEYS) {
    params.delete(key);
  }

  // Clear existing dynamic field params
  for (const key of Array.from(params.keys())) {
    if (key.startsWith('df_')) {
      params.delete(key);
    }
  }
};
const writeFiltersToUrl = (params: URLSearchParams, filters: TicketFilters): void => {
  clearTicketFilterParams(params);

  // Add new filter params
  filters.boards?.forEach((b: string) => params.append('board', b));
  filters.priority?.forEach((p: TicketPriority) => params.append('priority', p));
  filters.assignee?.forEach((a: string) => params.append('assignee', a));
  filters.userGroups?.forEach((g: string) => params.append('userGroups', g));
  filters.createdBy?.forEach((u: string) => params.append('createdBy', u));
  filters.roleAssignments?.forEach(ra => {
    if (!ra.userIds.length) return;
    params.append('roleAssignments', `${ra.roleId}|${ra.userIds.join(',')}`);
  });
  filters.tags?.forEach((t: string) => params.append('tags', t));
  filters.stages?.forEach((s: string) => params.append('stages', s));
  filters.ticketTypes?.forEach((t: string) => params.append('ticketTypes', t));
  filters.sourceChannels?.forEach((c: string) => params.append('sourceChannels', c));
  filters.aiCategory?.forEach((c: string) => params.append('aiCategory', c));
  filters.generatedTags?.forEach((t: string) => params.append('generatedTags', t));

  if (filters.hasAiDraft) {
    params.set('hasAiDraft', '1');
  }

  if (filters.conversationLabelId) {
    params.set('conversationLabelId', filters.conversationLabelId);
  }

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
  if (filters.lastEmailAtStart !== undefined) {
    params.set('lastEmailAtStart', filters.lastEmailAtStart.toString());
  }
  if (filters.lastEmailAtEnd !== undefined) {
    params.set('lastEmailAtEnd', filters.lastEmailAtEnd.toString());
  }

  // My tickets filter toggles (assigned to me / created by me)
  if (filters.assigned) {
    params.set('assigned', '1');
  }
  if (filters.created) {
    params.set('created', '1');
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
      if (parsed.groupBy) {
        result.groupBy = parsed.groupBy;
      }
      if (typeof parsed.showOverdueOnly === 'boolean') {
        result.showOverdueOnly = parsed.showOverdueOnly;
      }
      if (typeof parsed.showSubStatus === 'boolean') {
        result.showSubStatus = parsed.showSubStatus;
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
  groupBy?: string,
  showOverdueOnly?: boolean,
  showSubStatus?: boolean,
): void => {
  try {
    const data: StorageData = { filters };
    if (viewType) {
      data.viewType = viewType;
    }
    if (groupBy && groupBy !== 'none') {
      data.groupBy = groupBy;
    }
    if (showOverdueOnly) {
      data.showOverdueOnly = true;
    }
    if (showSubStatus) {
      data.showSubStatus = true;
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

      // Read directly from window.location.search instead of event.searchParams to avoid
      // a stale-closure bug: when INIT re-fires because selectedBoardIdFromDb changes (e.g.
      // after the user clears filters and the Zero optimistic update sets it to null),
      // the React effect closure may still hold the old searchParams from the previous render,
      // while window.location.search is already updated (React Router calls history.replaceState
      // synchronously). Using the live URL prevents initializeFromUrl from re-applying stale
      // saved-view filters.
      const currentParams = new URLSearchParams(window.location.search);
      const urlFilters = readFiltersFromUrl(currentParams);
      const urlViewType = currentParams.get('viewType');
      const urlGroupBy = currentParams.get('groupBy');
      const urlHasOverdue = currentParams.has('overdue');
      const urlShowOverdueOnly = currentParams.get('overdue') === '1';
      const urlHasSubStatus = currentParams.has('subStatus');
      const urlShowSubStatus = currentParams.get('subStatus') === '1';
      // UPDATED: Pass projectId and boardId to getStorageKey
      const storageKey = getStorageKey(
        event.channelId,
        event.viewMode,
        event.projectId,
        event.boardId,
        event.viewId,
      );
      const enabled = event.enabled ?? true;

      let filters: TicketFilters = {};
      let viewType: 'status' | 'stage' | 'board' = 'stage';
      let groupBy = 'none';
      let showOverdueOnly = false;
      let showSubStatus = false;

      if (enabled) {
        const storageData = loadFromStorage(storageKey);

        const boardFromUrl = urlFilters.boards?.length ? urlFilters.boards : undefined;
        const boardFromDb = event.selectedBoardIdFromDb ? [event.selectedBoardIdFromDb] : undefined;
        // When the user navigates directly to a board via the URL path (/projects/:projectId/:boardId),
        // the boardId is in the route params (not query params), so we use it as a fallback.
        const boardFromPath =
          event.viewMode === 'board' && event.boardId ? [event.boardId] : undefined;
        const boardFilter = boardFromUrl ?? boardFromDb ?? boardFromPath;

        if (Object.keys(urlFilters).length > 0) {
          filters = { ...urlFilters };
        } else {
          filters = storageData.filters;
        }

        if (boardFilter) {
          filters = { ...filters, boards: boardFilter };
        } else {
          const { boards: _, ...filtersWithoutBoards } = filters;
          filters = filtersWithoutBoards;
        }

        if (urlViewType === 'status' || urlViewType === 'stage' || urlViewType === 'board') {
          viewType = urlViewType;
        } else {
          viewType = storageData.viewType || 'stage';
        }

        if (urlGroupBy) {
          groupBy = urlGroupBy;
        } else if (storageData.groupBy) {
          groupBy = storageData.groupBy;
        }

        showOverdueOnly = urlHasOverdue
          ? urlShowOverdueOnly
          : (storageData.showOverdueOnly ?? false);
        showSubStatus = urlHasSubStatus ? urlShowSubStatus : (storageData.showSubStatus ?? false);
      }

      const result: TicketFiltersContext = {
        ...context,
        filters,
        viewType,
        groupBy,
        showOverdueOnly,
        showSubStatus,
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
      if (urlGroupBy) {
        result.urlGroupBy = urlGroupBy;
      }
      result.urlShowOverdueOnly = urlHasOverdue ? urlShowOverdueOnly : undefined;
      result.urlShowSubStatus = urlHasSubStatus ? urlShowSubStatus : undefined;

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
     * Update showOverdueOnly in context
     */
    updateOverdueOnly: assign(({ event, context }) => {
      if (event.type !== 'SET_OVERDUE_ONLY') return context;
      return { ...context, showOverdueOnly: event.showOverdueOnly };
    }),

    /**
     * Update showSubStatus in context
     */
    updateSubStatus: assign(({ event, context }) => {
      if (event.type !== 'SET_SUB_STATUS') return context;
      return { ...context, showSubStatus: event.showSubStatus };
    }),

    /**
     * Update viewType in context
     */
    updateViewType: assign(({ event, context }) => {
      if (event.type !== 'SET_VIEW_TYPE') return context;
      return { ...context, viewType: event.viewType };
    }),

    /**
     * Update groupBy in context
     */
    updateGroupBy: assign(({ event, context }) => {
      if (event.type !== 'SET_GROUP_BY') return context;
      return { ...context, groupBy: event.groupBy };
    }),

    /**
     * Sync URL params to context (browser back/forward)
     */
    syncFromUrl: assign(({ event, context }) => {
      if (event.type !== 'URL_CHANGED') return context;

      const urlFilters = readFiltersFromUrl(event.searchParams);
      const urlViewType = event.searchParams.get('viewType');
      const urlGroupBy = event.searchParams.get('groupBy');
      const urlHasOverdue = event.searchParams.has('overdue');
      const urlShowOverdueOnly = event.searchParams.get('overdue') === '1';
      const urlHasSubStatus = event.searchParams.has('subStatus');
      const urlShowSubStatus = event.searchParams.get('subStatus') === '1';
      const prevHadOverdue = context.currentSearchParams?.has('overdue') ?? false;
      const prevHadSubStatus = context.currentSearchParams?.has('subStatus') ?? false;

      return {
        urlFilters,
        currentSearchParams: event.searchParams,
        urlViewType:
          urlViewType === 'status' || urlViewType === 'stage' || urlViewType === 'board'
            ? urlViewType
            : undefined,
        urlGroupBy: urlGroupBy || undefined,
        urlShowOverdueOnly: urlHasOverdue ? urlShowOverdueOnly : prevHadOverdue ? false : undefined,
        urlShowSubStatus: urlHasSubStatus ? urlShowSubStatus : prevHadSubStatus ? false : undefined,
      };
    }),

    /**
     * Apply URL filters to state (when URL changes via browser navigation)
     */
    applyUrlFilters: assign(({ context }) => {
      if (!context.enabled) return context;

      const hasUrlFilters = Object.keys(context.urlFilters).length > 0;
      const hasUrlGroupBy = context.urlGroupBy !== undefined;

      if (
        !hasUrlFilters &&
        !hasUrlGroupBy &&
        context.urlShowOverdueOnly === undefined &&
        context.urlShowSubStatus === undefined
      ) {
        return context;
      }

      return {
        ...context,
        filters: hasUrlFilters ? context.urlFilters : context.filters,
        viewType: context.urlViewType || context.viewType,
        groupBy: context.urlGroupBy ?? context.groupBy,
        showOverdueOnly:
          context.urlShowOverdueOnly !== undefined
            ? context.urlShowOverdueOnly
            : context.showOverdueOnly,
        showSubStatus:
          context.urlShowSubStatus !== undefined ? context.urlShowSubStatus : context.showSubStatus,
      };
    }),

    /**
     * Save current filters, viewType, and groupBy to sessionStorage
     */
    saveToStorage: ({ context }) => {
      if (!context.enabled) return;
      const { boards: _, ...filtersWithoutBoards } = context.filters;
      saveToStorage(
        context.storageKey,
        filtersWithoutBoards,
        context.viewType,
        context.groupBy,
        context.showOverdueOnly,
        context.showSubStatus,
      );
    },

    /**
     * Syncs current filters, viewType, and groupBy to the URL.
     * Updates both the context's currentSearchParams and the actual URL.
     */
    syncStateToUrl: assign(({ context }) => {
      if (!context.enabled || !context.setSearchParams) return context;

      // Create new params from current search params to preserve other URL params
      const params = new URLSearchParams(context.currentSearchParams ?? window.location.search);

      // Write filters and viewType to params
      writeFiltersToUrl(params, context.filters);

      // The support desk has no status/stage/board view concept, so don't write viewType there.
      if (context.viewMode !== 'support') {
        params.set('viewType', context.viewType);
      }

      if (context.groupBy && context.groupBy !== 'none') {
        params.set('groupBy', context.groupBy);
      } else {
        params.delete('groupBy');
      }

      if (context.showOverdueOnly) {
        params.set('overdue', '1');
      } else {
        params.delete('overdue');
      }

      if (context.showSubStatus) {
        params.set('subStatus', '1');
      } else {
        params.delete('subStatus');
      }

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
    groupBy: 'none',
    showOverdueOnly: false,
    showSubStatus: false,
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
        SET_GROUP_BY: {
          actions: ['updateGroupBy', 'syncStateToUrl', 'saveToStorage'],
        },
        SET_OVERDUE_ONLY: {
          actions: ['updateOverdueOnly', 'syncStateToUrl', 'saveToStorage'],
        },
        SET_SUB_STATUS: {
          actions: ['updateSubStatus', 'syncStateToUrl', 'saveToStorage'],
        },
        URL_CHANGED: {
          actions: ['syncFromUrl', 'applyUrlFilters', 'saveToStorage'],
        },
      },
    },
  },
});
