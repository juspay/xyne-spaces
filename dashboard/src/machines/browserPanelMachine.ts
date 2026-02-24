import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';

export type BrowserPanelState = 'closed' | 'open';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface BrowserPanelContext {
  browserPanelState: BrowserPanelState;
  pendingUrls: string[];
  tabs: BrowserTab[];
  activeTabId: string | null;
}

export type BrowserPanelEvent =
  | { type: 'OPEN'; urls?: string[] }
  | { type: 'CLOSE' }
  | { type: 'OPEN_URLS'; urls: string[] }
  | { type: 'ADD_TAB'; tab: BrowserTab }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SWITCH_TAB'; tabId: string }
  | { type: 'UPDATE_TAB'; tabId: string; patch: Partial<BrowserTab> };

interface PanelHandle {
  resize: (size: number) => void;
}

interface PanelRefs {
  left: RefObject<PanelHandle | null>;
  right: RefObject<PanelHandle | null>;
}

export let globalBrowserPanelRefs: PanelRefs = {
  left: { current: null },
  right: { current: null },
};

export const setBrowserPanelRefs = (panelRefs: PanelRefs): void => {
  globalBrowserPanelRefs = panelRefs;
};

export const browserPanelMachine = setup({
  types: {
    context: {} as BrowserPanelContext,
    events: {} as BrowserPanelEvent,
  },
  actions: {
    setOpen: assign(({ event }) => {
      if (event.type === 'OPEN') {
        return {
          browserPanelState: 'open' as BrowserPanelState,
          pendingUrls: event.urls ?? [],
        };
      }
      return { browserPanelState: 'open' as BrowserPanelState };
    }),
    setClosed: assign({
      browserPanelState: 'closed' as BrowserPanelState,
      pendingUrls: [],
    }),
    setPendingUrls: assign(({ event }) => {
      if (event.type === 'OPEN_URLS') {
        return { pendingUrls: event.urls };
      }
      return {};
    }),
    clearPendingUrls: assign({
      pendingUrls: [],
    }),
    addTab: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'ADD_TAB') return context.tabs;
        const exists = context.tabs.find(t => t.id === event.tab.id);
        if (exists) return context.tabs;
        return [...context.tabs, event.tab];
      },
      activeTabId: ({ context, event }) => {
        if (event.type !== 'ADD_TAB') return context.activeTabId;
        return event.tab.id;
      },
    }),
    closeTab: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'CLOSE_TAB') return context.tabs;
        return context.tabs.filter(t => t.id !== event.tabId);
      },
      activeTabId: ({ context, event }) => {
        if (event.type !== 'CLOSE_TAB') return context.activeTabId;
        if (context.activeTabId !== event.tabId) return context.activeTabId;
        const remaining = context.tabs.filter(t => t.id !== event.tabId);
        return remaining[remaining.length - 1]?.id ?? null;
      },
    }),
    switchTab: assign({
      activeTabId: ({ event }) => {
        if (event.type !== 'SWITCH_TAB') return null;
        return event.tabId;
      },
    }),
    updateTab: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'UPDATE_TAB') return context.tabs;
        return context.tabs.map(t => (t.id === event.tabId ? { ...t, ...event.patch } : t));
      },
    }),
  },
}).createMachine({
  context: () => ({
    browserPanelState: 'closed' as BrowserPanelState,
    pendingUrls: [],
    tabs: [] as BrowserTab[],
    activeTabId: null as string | null,
  }),
  id: 'browserPanelMachine',
  initial: 'closed',
  states: {
    closed: {
      on: {
        OPEN: {
          target: 'open',
          actions: 'setOpen',
        },
        OPEN_URLS: {
          actions: 'setPendingUrls',
        },
        ADD_TAB: {
          actions: 'addTab',
        },
        CLOSE_TAB: {
          actions: 'closeTab',
        },
        SWITCH_TAB: {
          actions: 'switchTab',
        },
        UPDATE_TAB: {
          actions: 'updateTab',
        },
      },
    },
    open: {
      on: {
        CLOSE: {
          target: 'closed',
          actions: 'setClosed',
        },
        OPEN_URLS: {
          actions: 'setPendingUrls',
        },
        ADD_TAB: {
          actions: 'addTab',
        },
        CLOSE_TAB: {
          actions: 'closeTab',
        },
        SWITCH_TAB: {
          actions: 'switchTab',
        },
        UPDATE_TAB: {
          actions: 'updateTab',
        },
      },
    },
  },
});

export const browserPanelActor = createActor(browserPanelMachine).start();
