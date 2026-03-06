import { setup, assign } from 'xstate';

const STORAGE_KEY_PREFIX = 'workflow-screen';

export interface WorkflowScreenContext {
  ticketId: string;
  selectedExecutionId: string | null;
  activeTabId: string;
  isGraphViewOpen: boolean;
  isAgentChatOpen: boolean;
  selectedNodeStepIds: string[];
  selectedFilePath: string | null;
  scrollPosition: number;
}

export type WorkflowScreenEvent =
  | {
      type: 'INIT';
      ticketId: string;
      defaultActiveTabId?: string;
      defaultAgentChatOpen?: boolean;
    }
  | { type: 'SET_SELECTED_EXECUTION_ID'; executionId: string | null }
  | { type: 'SET_ACTIVE_TAB_ID'; tabId: string }
  | { type: 'SET_GRAPH_VIEW_OPEN'; isOpen: boolean }
  | { type: 'SET_AGENT_CHAT_OPEN'; isOpen: boolean }
  | { type: 'SET_SELECTED_NODE_STEP_IDS'; stepIds: string[] }
  | { type: 'SET_SELECTED_FILE_PATH'; filePath: string | null }
  | { type: 'SET_SCROLL_POSITION'; position: number }
  | { type: 'RESET' };

interface StorageData {
  selectedExecutionId: string | null;
  activeTabId: string;
  isGraphViewOpen: boolean;
  isAgentChatOpen: boolean;
  selectedNodeStepIds: string[];
  selectedFilePath: string | null;
  scrollPosition: number;
}

const getStorageKey = (ticketId: string): string => {
  return `${STORAGE_KEY_PREFIX}-${ticketId}`;
};

const loadFromStorage = (
  ticketId: string,
  defaultActiveTabId: string,
  defaultAgentChatOpen = false,
): StorageData => {
  try {
    const raw = sessionStorage.getItem(getStorageKey(ticketId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StorageData>;
      return {
        selectedExecutionId: parsed.selectedExecutionId ?? null,
        activeTabId: parsed.activeTabId ?? defaultActiveTabId,
        isGraphViewOpen: parsed.isGraphViewOpen ?? false,
        isAgentChatOpen: parsed.isAgentChatOpen ?? defaultAgentChatOpen,
        selectedNodeStepIds: parsed.selectedNodeStepIds ?? [],
        selectedFilePath: parsed.selectedFilePath ?? null,
        scrollPosition: parsed.scrollPosition ?? 0,
      };
    }
  } catch {
    // Ignore storage errors
  }
  return {
    selectedExecutionId: null,
    activeTabId: defaultActiveTabId,
    isGraphViewOpen: false,
    isAgentChatOpen: defaultAgentChatOpen,
    selectedNodeStepIds: [],
    selectedFilePath: null,
    scrollPosition: 0,
  };
};

const saveToStorage = (context: WorkflowScreenContext): void => {
  if (!context.ticketId) return;
  try {
    const data: StorageData = {
      selectedExecutionId: context.selectedExecutionId,
      activeTabId: context.activeTabId,
      isGraphViewOpen: context.isGraphViewOpen,
      isAgentChatOpen: context.isAgentChatOpen,
      selectedNodeStepIds: context.selectedNodeStepIds,
      selectedFilePath: context.selectedFilePath,
      scrollPosition: context.scrollPosition,
    };
    sessionStorage.setItem(getStorageKey(context.ticketId), JSON.stringify(data));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

const clearStorage = (ticketId: string): void => {
  try {
    sessionStorage.removeItem(getStorageKey(ticketId));
  } catch {
    // Ignore storage errors
  }
};

/* -------------------------- STATE MACHINE -------------------------- */

/**
 * XState machine for managing workflow screen state persistence
 *
 * Handles synchronization between:
 * - Component state (selectedExecutionId, activeTabId, isGraphViewOpen, selectedNodeStepIds, selectedFilePath)
 * - sessionStorage (for session persistence across navigation)
 *
 * States:
 * - idle: Initial state, waiting for initialization
 * - initialized: Ready to handle state updates
 *
 * Events:
 * - INIT: Initialize machine with ticketId and load persisted state
 * - SET_SELECTED_EXECUTION_ID: Update selected execution ID
 * - SET_ACTIVE_TAB_ID: Update active tab ID
 * - SET_GRAPH_VIEW_OPEN: Update graph view overlay state
 * - SET_SELECTED_NODE_STEP_IDS: Update selected node step IDs
 * - SET_SELECTED_FILE_PATH: Update selected file path in code viewer
 * - RESET: Clear persisted state for current ticket
 */
export const workflowScreenMachine = setup({
  types: {
    context: {} as WorkflowScreenContext,
    events: {} as WorkflowScreenEvent,
  },
  actions: {
    initializeFromStorage: assign(({ event, context }) => {
      if (event.type !== 'INIT') return context;

      const defaultActiveTabId = event.defaultActiveTabId || 'live-edits';
      const defaultAgentChatOpen = event.defaultAgentChatOpen || false;
      const stored = loadFromStorage(event.ticketId, defaultActiveTabId, defaultAgentChatOpen);

      return {
        ticketId: event.ticketId,
        selectedExecutionId: stored.selectedExecutionId,
        activeTabId: stored.activeTabId,
        isGraphViewOpen: stored.isGraphViewOpen,
        isAgentChatOpen: stored.isAgentChatOpen,
        selectedNodeStepIds: stored.selectedNodeStepIds,
        selectedFilePath: stored.selectedFilePath,
        scrollPosition: stored.scrollPosition,
      };
    }),

    setSelectedExecutionId: assign(({ event, context }) => {
      if (event.type !== 'SET_SELECTED_EXECUTION_ID') return context;
      const newContext = { ...context, selectedExecutionId: event.executionId };
      saveToStorage(newContext);
      return newContext;
    }),

    setActiveTabId: assign(({ event, context }) => {
      if (event.type !== 'SET_ACTIVE_TAB_ID') return context;
      const newContext = { ...context, activeTabId: event.tabId };
      saveToStorage(newContext);
      return newContext;
    }),

    setGraphViewOpen: assign(({ event, context }) => {
      if (event.type !== 'SET_GRAPH_VIEW_OPEN') return context;
      const newContext = { ...context, isGraphViewOpen: event.isOpen };
      saveToStorage(newContext);
      return newContext;
    }),

    setAgentChatOpen: assign(({ event, context }) => {
      if (event.type !== 'SET_AGENT_CHAT_OPEN') return context;
      const newContext = { ...context, isAgentChatOpen: event.isOpen };
      saveToStorage(newContext);
      return newContext;
    }),

    setSelectedNodeStepIds: assign(({ event, context }) => {
      if (event.type !== 'SET_SELECTED_NODE_STEP_IDS') return context;
      const newContext = { ...context, selectedNodeStepIds: event.stepIds };
      saveToStorage(newContext);
      return newContext;
    }),

    setSelectedFilePath: assign(({ event, context }) => {
      if (event.type !== 'SET_SELECTED_FILE_PATH') return context;
      const newContext = { ...context, selectedFilePath: event.filePath };
      saveToStorage(newContext);
      return newContext;
    }),

    setScrollPosition: assign(({ event, context }) => {
      if (event.type !== 'SET_SCROLL_POSITION') return context;
      const newContext = { ...context, scrollPosition: event.position };
      saveToStorage(newContext);
      return newContext;
    }),

    resetState: assign(({ context }) => {
      clearStorage(context.ticketId);
      return {
        ...context,
        selectedExecutionId: null,
        activeTabId: 'live-edits',
        isGraphViewOpen: false,
        isAgentChatOpen: false,
        selectedNodeStepIds: [],
        selectedFilePath: null,
        scrollPosition: 0,
      };
    }),
  },
}).createMachine({
  id: 'workflowScreen',
  initial: 'idle',
  context: {
    ticketId: '',
    selectedExecutionId: null,
    activeTabId: 'live-edits',
    isGraphViewOpen: false,
    isAgentChatOpen: false,
    selectedNodeStepIds: [],
    selectedFilePath: null,
    scrollPosition: 0,
  },
  states: {
    idle: {
      on: {
        INIT: {
          target: 'initialized',
          actions: 'initializeFromStorage',
        },
      },
    },
    initialized: {
      on: {
        SET_SELECTED_EXECUTION_ID: {
          actions: 'setSelectedExecutionId',
        },
        SET_ACTIVE_TAB_ID: {
          actions: 'setActiveTabId',
        },
        SET_GRAPH_VIEW_OPEN: {
          actions: 'setGraphViewOpen',
        },
        SET_AGENT_CHAT_OPEN: {
          actions: 'setAgentChatOpen',
        },
        SET_SELECTED_NODE_STEP_IDS: {
          actions: 'setSelectedNodeStepIds',
        },
        SET_SELECTED_FILE_PATH: {
          actions: 'setSelectedFilePath',
        },
        SET_SCROLL_POSITION: {
          actions: 'setScrollPosition',
        },
        RESET: {
          actions: 'resetState',
        },
      },
    },
  },
});
