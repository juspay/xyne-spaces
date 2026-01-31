import { setup, assign } from 'xstate';

export interface EditorTab {
  id: string;
  type: 'ticket' | 'notification' | 'main' | 'workspace';
  title: string;
  conversationId?: string;
  channelId?: string;
  xyneId?: string;
  ticketId?: string;
  workspaceInfo?: {
    folderUrl: string;
    folderPath: string;
    folderName: string;
  };
}

export interface LastWorkspace {
  path: string;
  url: string;
  branchName?: string | undefined;
  repoName?: string | undefined;
  ticketId?: string | undefined;
}

export interface VSCodeWorkspaceContext {
  tabs: EditorTab[];
  activeTabId: string | null;
  tabSummaryStates: Record<string, boolean>;
  isThreadOpen: boolean;
  activeVSCodeSessions: string[];
  lastWorkspace: LastWorkspace | null;
}

export type VSCodeWorkspaceEvent =
  | { type: 'ADD_TAB'; tab: EditorTab }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SET_ACTIVE_TAB'; tabId: string }
  | { type: 'TOGGLE_SUMMARY'; tabId: string; show: boolean }
  | { type: 'SET_THREAD_OPEN'; isOpen: boolean }
  | { type: 'SYNC_TICKET_TAB'; xyneId: string; conversationId: string; channelId: string }
  | { type: 'UPDATE_TAB_TITLE'; tabId: string; title: string }
  | { type: 'LOAD_PERSISTED_STATE'; state: Partial<VSCodeWorkspaceContext> }
  | { type: 'REGISTER_SESSION'; workspacePath: string }
  | { type: 'UNREGISTER_SESSION'; workspacePath: string }
  | { type: 'SET_LAST_WORKSPACE'; workspace: LastWorkspace }
  | { type: 'SWITCH_TO_WORKSPACE'; folderUrl: string; folderPath: string; folderName: string };

const STORAGE_KEY = 'vscode-workspace-state';
const LAST_WORKSPACE_KEY = 'vscode-last-workspace';

export const vscodeWorkspaceMachine = setup({
  types: {
    context: {} as VSCodeWorkspaceContext,
    events: {} as VSCodeWorkspaceEvent,
  },
  actions: {
    saveToStorage: ({ context }) => {
      try {
        const serialized = JSON.stringify({
          tabs: context.tabs,
          activeTabId: context.activeTabId,
          tabSummaryStates: context.tabSummaryStates,
          isThreadOpen: context.isThreadOpen,
        });
        sessionStorage.setItem(STORAGE_KEY, serialized);
      } catch (e) {
        console.error('Failed to save VS Code workspace state', e);

        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
            sessionStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({
                tabs: context.tabs.slice(-5),
                activeTabId: context.activeTabId,
                tabSummaryStates: {},
                isThreadOpen: context.isThreadOpen,
              }),
            );
          } catch (retryError) {
            console.warn('Failed to save even reduced state', retryError);
          }
        }
      }
    },
    saveLastWorkspace: ({ context }) => {
      if (context.lastWorkspace) {
        localStorage.setItem(LAST_WORKSPACE_KEY, JSON.stringify(context.lastWorkspace));
      }
    },
  },
}).createMachine({
  id: 'vscodeWorkspace',
  context: () => {
    let initialWorkspaceState: Partial<VSCodeWorkspaceContext> = {
      tabs: [],
      activeTabId: null,
      tabSummaryStates: {},
      isThreadOpen: false,
    };
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        initialWorkspaceState = JSON.parse(stored) as Partial<VSCodeWorkspaceContext>;
      }
    } catch (e) {
      console.error('Failed to load VS Code workspace state', e);
    }

    // Load Last Workspace
    let lastWorkspace: LastWorkspace | null = null;
    try {
      const storedLast = localStorage.getItem(LAST_WORKSPACE_KEY);
      if (storedLast) {
        lastWorkspace = JSON.parse(storedLast) as LastWorkspace;
      }
    } catch (e) {
      console.error('Failed to load last workspace', e);
    }

    return {
      tabs: initialWorkspaceState.tabs || [],
      activeTabId: initialWorkspaceState.activeTabId || null,
      tabSummaryStates: initialWorkspaceState.tabSummaryStates || {},
      isThreadOpen: initialWorkspaceState.isThreadOpen ?? false,
      activeVSCodeSessions: [],
      lastWorkspace,
    };
  },
  on: {
    LOAD_PERSISTED_STATE: {
      actions: assign(({ event, context }) => {
        return {
          ...context,
          ...event.state,
        };
      }),
    },
    ADD_TAB: {
      actions: [
        assign(({ event, context }) => {
          const exists = context.tabs.find(t => t.id === event.tab.id);
          const newTabs = exists ? context.tabs : [...context.tabs, event.tab];
          return {
            tabs: newTabs,
            activeTabId: event.tab.id,
            isThreadOpen: true,
          };
        }),
        'saveToStorage',
      ],
    },
    CLOSE_TAB: {
      actions: [
        assign(({ event, context }) => {
          const filtered = context.tabs.filter(t => t.id !== event.tabId);
          let newActiveTabId = context.activeTabId;
          let newIsThreadOpen = context.isThreadOpen;

          if (context.activeTabId === event.tabId) {
            const lastTab = filtered[filtered.length - 1];
            newActiveTabId = lastTab ? lastTab.id : null;
            if (filtered.length === 0) newIsThreadOpen = false;
          }

          return {
            tabs: filtered,
            activeTabId: newActiveTabId,
            isThreadOpen: newIsThreadOpen,
          };
        }),
        'saveToStorage',
      ],
    },
    SET_ACTIVE_TAB: {
      actions: [
        assign({
          activeTabId: ({ event }) => event.tabId,
          isThreadOpen: true,
        }),
        'saveToStorage',
      ],
    },
    TOGGLE_SUMMARY: {
      actions: [
        assign(({ event, context }) => ({
          tabSummaryStates: {
            ...context.tabSummaryStates,
            [event.tabId]: event.show,
          },
        })),
        'saveToStorage',
      ],
    },
    SET_THREAD_OPEN: {
      actions: [
        assign({
          isThreadOpen: ({ event }) => event.isOpen,
        }),
        'saveToStorage',
      ],
    },
    SYNC_TICKET_TAB: {
      actions: [
        assign(({ event, context }) => {
          const newTabs = context.tabs.map(tab => {
            if (tab.xyneId === event.xyneId) {
              return {
                ...tab,
                conversationId: event.conversationId,
                channelId: event.channelId,
              };
            }
            return tab;
          });
          return { tabs: newTabs };
        }),
        'saveToStorage',
      ],
    },
    UPDATE_TAB_TITLE: {
      actions: [
        assign(({ event, context }) => {
          const newTabs = context.tabs.map(tab => {
            if (tab.id === event.tabId) {
              return { ...tab, title: event.title };
            }
            return tab;
          });
          return { tabs: newTabs };
        }),
        'saveToStorage',
      ],
    },
    REGISTER_SESSION: {
      actions: assign(({ event, context }) => ({
        activeVSCodeSessions: context.activeVSCodeSessions.includes(event.workspacePath)
          ? context.activeVSCodeSessions
          : [...context.activeVSCodeSessions, event.workspacePath],
      })),
    },
    UNREGISTER_SESSION: {
      actions: assign(({ event, context }) => ({
        activeVSCodeSessions: context.activeVSCodeSessions.filter(p => p !== event.workspacePath),
      })),
    },
    SET_LAST_WORKSPACE: {
      actions: [
        assign({
          lastWorkspace: ({ event }) => event.workspace,
        }),
        'saveLastWorkspace',
      ],
    },
    SWITCH_TO_WORKSPACE: {
      actions: [
        assign(({ event, context }) => {
          const existingTab = context.tabs.find(
            t => t.type === 'workspace' && t.workspaceInfo?.folderPath === event.folderPath,
          );

          if (existingTab) {
            return {
              activeTabId: existingTab.id,
              lastWorkspace: {
                path: event.folderPath,
                url: event.folderUrl,
                branchName: undefined,
                repoName: undefined,
              },
            };
          }

          const newTab: EditorTab = {
            id: `workspace-${Date.now()}`,
            type: 'workspace',
            title: event.folderName,
            workspaceInfo: {
              folderUrl: event.folderUrl,
              folderPath: event.folderPath,
              folderName: event.folderName,
            },
          };

          return {
            tabs: [...context.tabs, newTab],
            activeTabId: newTab.id,
            lastWorkspace: {
              path: event.folderPath,
              url: event.folderUrl,
              branchName: undefined,
              repoName: undefined,
            },
          };
        }),
        'saveLastWorkspace',
        'saveToStorage',
      ],
    },
  },
});
