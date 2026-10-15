import { setup, createActor, assign } from 'xstate';
import { arrayMove } from '@dnd-kit/sortable';
import { RefObject } from 'react';
import { BrowserSettings, defaultBrowserSettings } from '../types/browserSettings';

export type BrowserPanelState = 'closed' | 'open';

export interface BrowserTab {
  id: string;
  /** Where the tab is; empty while it shows a new tab's start page. */
  url: string;
  title: string;
  favicon?: string | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** Silenced from its tab's speaker. */
  muted?: boolean;
}

export interface BrowserPanelContext {
  browserPanelState: BrowserPanelState;
  pendingUrls: string[];
  tabs: BrowserTab[];
  activeTabId: string | null;
  /** Tabs closed lately, the last closed last, and where each was: for ⌘⇧T. */
  closedTabs: Array<{ tab: BrowserTab; index: number }>;
  browserSettings: BrowserSettings;
  // Scroll position per channel — populated when ChatListV3 unmounts due to /browser navigation.
  // One-shot: consumed and cleared on the next mount of the same channel.
  channelScrollPositions: Map<string, string>; // channelId → conversationId
}

export type BrowserPanelEvent =
  | { type: 'OPEN'; urls?: string[] }
  | { type: 'CLOSE' }
  | { type: 'OPEN_URLS'; urls: string[] }
  /** A tab at the end, or just after `after`; opened unless `background`. */
  | { type: 'ADD_TAB'; tab: BrowserTab; after?: string; background?: boolean }
  /** A tab dragged onto another's place. */
  | { type: 'MOVE_TAB'; from: string; to: string }
  /** The tab closed last, back where it was. */
  | { type: 'REOPEN_TAB' }
  /** Tabs kept from before a reload or a restart, ahead of any opened since. */
  | { type: 'RESTORE_TABS'; tabs: BrowserTab[]; activeTabId: string | null }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SWITCH_TAB'; tabId: string }
  | { type: 'UPDATE_TAB'; tabId: string; patch: Partial<BrowserTab> }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<BrowserSettings> }
  | { type: 'SAVE_SCROLL_POSITION'; channelId: string; conversationId: string }
  | { type: 'CLEAR_SCROLL_POSITION'; channelId: string };

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

/** How many closed tabs ⌘⇧T can bring back. */
const MAX_CLOSED_TABS = 25;

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
        const at = event.after ? context.tabs.findIndex(t => t.id === event.after) : -1;
        return at < 0
          ? [...context.tabs, event.tab]
          : [...context.tabs.slice(0, at + 1), event.tab, ...context.tabs.slice(at + 1)];
      },
      activeTabId: ({ context, event }) => {
        if (event.type !== 'ADD_TAB') return context.activeTabId;
        return event.background && context.activeTabId ? context.activeTabId : event.tab.id;
      },
    }),
    moveTab: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'MOVE_TAB') return context.tabs;
        const from = context.tabs.findIndex(t => t.id === event.from);
        const to = context.tabs.findIndex(t => t.id === event.to);
        return from < 0 || to < 0 ? context.tabs : arrayMove(context.tabs, from, to);
      },
    }),
    restoreTabs: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'RESTORE_TABS') return context.tabs;
        const opened = context.tabs.filter(t => !event.tabs.some(kept => kept.id === t.id));
        return [...event.tabs, ...opened];
      },
      activeTabId: ({ context, event }) => {
        if (event.type !== 'RESTORE_TABS') return context.activeTabId;
        // A tab opened since — a link followed before the kept ones arrived — stays open.
        return context.activeTabId ?? event.activeTabId ?? event.tabs[0]?.id ?? null;
      },
    }),
    closeTab: assign({
      tabs: ({ context, event }) => {
        if (event.type !== 'CLOSE_TAB') return context.tabs;
        return context.tabs.filter(t => t.id !== event.tabId);
      },
      closedTabs: ({ context, event }) => {
        if (event.type !== 'CLOSE_TAB') return context.closedTabs;
        const index = context.tabs.findIndex(t => t.id === event.tabId);
        const tab = context.tabs[index];
        // A new tab that never went anywhere isn't worth bringing back.
        if (!tab || !tab.url) return context.closedTabs;
        return [...context.closedTabs, { tab, index }].slice(-MAX_CLOSED_TABS);
      },
      activeTabId: ({ context, event }) => {
        if (event.type !== 'CLOSE_TAB') return context.activeTabId;
        if (context.activeTabId !== event.tabId) return context.activeTabId;
        // The one that takes its place, else the one before it, as in a browser.
        const index = context.tabs.findIndex(t => t.id === event.tabId);
        const remaining = context.tabs.filter(t => t.id !== event.tabId);
        return remaining[index]?.id ?? remaining[index - 1]?.id ?? null;
      },
    }),
    reopenTab: assign(({ context }) => {
      const last = context.closedTabs[context.closedTabs.length - 1];
      if (!last) return {};
      const tab = { ...last.tab, isLoading: false, canGoBack: false, canGoForward: false };
      const at = Math.min(last.index, context.tabs.length);
      return {
        tabs: [...context.tabs.slice(0, at), tab, ...context.tabs.slice(at)],
        activeTabId: tab.id,
        closedTabs: context.closedTabs.slice(0, -1),
      };
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
    updateSettings: assign({
      browserSettings: ({ context, event }) => {
        if (event.type !== 'UPDATE_SETTINGS') return context.browserSettings;
        return { ...context.browserSettings, ...event.settings };
      },
    }),
    saveScrollPosition: assign({
      channelScrollPositions: ({ context, event }) => {
        if (event.type !== 'SAVE_SCROLL_POSITION') return context.channelScrollPositions;
        const next = new Map(context.channelScrollPositions);
        next.set(event.channelId, event.conversationId);
        return next;
      },
    }),
    clearScrollPosition: assign({
      channelScrollPositions: ({ context, event }) => {
        if (event.type !== 'CLEAR_SCROLL_POSITION') return context.channelScrollPositions;
        const next = new Map(context.channelScrollPositions);
        next.delete(event.channelId);
        return next;
      },
    }),
  },
}).createMachine({
  context: () => ({
    browserPanelState: 'closed' as BrowserPanelState,
    pendingUrls: [],
    tabs: [] as BrowserTab[],
    activeTabId: null as string | null,
    closedTabs: [],
    browserSettings: defaultBrowserSettings,
    channelScrollPositions: new Map<string, string>(),
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
        MOVE_TAB: {
          actions: 'moveTab',
        },
        RESTORE_TABS: {
          actions: 'restoreTabs',
        },
        REOPEN_TAB: {
          actions: 'reopenTab',
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
        UPDATE_SETTINGS: {
          actions: 'updateSettings',
        },
        SAVE_SCROLL_POSITION: {
          actions: 'saveScrollPosition',
        },
        CLEAR_SCROLL_POSITION: {
          actions: 'clearScrollPosition',
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
        MOVE_TAB: {
          actions: 'moveTab',
        },
        RESTORE_TABS: {
          actions: 'restoreTabs',
        },
        REOPEN_TAB: {
          actions: 'reopenTab',
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
        UPDATE_SETTINGS: {
          actions: 'updateSettings',
        },
        SAVE_SCROLL_POSITION: {
          actions: 'saveScrollPosition',
        },
        CLEAR_SCROLL_POSITION: {
          actions: 'clearScrollPosition',
        },
      },
    },
  },
});

export const browserPanelActor = createActor(browserPanelMachine).start();
