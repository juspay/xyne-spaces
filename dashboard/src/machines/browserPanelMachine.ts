import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';

export type BrowserPanelState = 'closed' | 'open';

export interface BrowserPanelContext {
  browserPanelState: BrowserPanelState;
  pendingUrls: string[];
}

export type BrowserPanelEvent =
  | { type: 'OPEN'; urls?: string[] }
  | { type: 'CLOSE' }
  | { type: 'OPEN_URLS'; urls: string[] };

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
  },
}).createMachine({
  context: () => ({
    browserPanelState: 'closed' as BrowserPanelState,
    pendingUrls: [],
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
      },
    },
  },
});

// Global browser panel actor instance
export const browserPanelActor = createActor(browserPanelMachine).start();
