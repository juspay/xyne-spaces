import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';
import { toast } from 'sonner';
import { isElectronApp } from '../utils/electronApp';

// Available webview states
export type WebviewState = 'idle' | 'open' | 'closed' | 'minimised';

// Tab interface for managing individual tabs
export interface TabType {
  currentUrl: string;
  history: string[]; // Array used as stack for previous URLs
}

// Context interface for the webview machine
export interface WebviewContext {
  webviewState: WebviewState;
  tabs: TabType[];
  activeTab: number | null; // Index of active tab, null if no tabs
}

// Event types for webview machine
export type WebviewEvent =
  | { type: 'RESOLVE'; url?: string }
  | { type: 'OPEN'; url?: string }
  | { type: 'CLOSE' }
  | { type: 'MINIMIZE' }
  | { type: 'RESET' }
  | { type: 'ADD_TAB'; url: string }
  | { type: 'REMOVE_TAB'; url: string }
  | { type: 'SWITCH_TAB'; url: string };

// Interface for panel handle (to avoid importing react-resizable-panels here)
interface PanelHandle {
  resize: (size: number) => void;
}

// Panel refs interface
interface PanelRefs {
  left: RefObject<PanelHandle | null>;
  right: RefObject<PanelHandle | null>;
}

// Global panel refs that will be set by AppRoot
export let globalPanelRefs: PanelRefs = {
  left: { current: null },
  right: { current: null },
};

// Function to set panel refs from AppRoot
export const setPanelRefs = (panelRefs: PanelRefs): void => {
  globalPanelRefs = panelRefs;
};

export const webviewMachine = setup({
  types: {
    context: {} as WebviewContext,
    events: {} as WebviewEvent,
  },
  actions: {
    // Update context when transitioning to different states
    setIdle: assign({
      webviewState: 'idle',
    }),
    setOpen: assign({
      webviewState: 'open',
    }),
    setClosed: assign({
      webviewState: 'closed',
    }),
    setMinimised: assign({
      webviewState: 'minimised',
    }),
    // Tab management actions
    addTab: assign(({ context, event }) => {
      if (event.type === 'ADD_TAB') {
        const newTab: TabType = {
          currentUrl: event.url,
          history: [],
        };
        const updatedTabs = [...context.tabs, newTab];
        return {
          tabs: updatedTabs,
          activeTab: context.activeTab === null ? 0 : context.activeTab,
        };
      }
      return {};
    }),
    removeTab: assign(({ context, event }) => {
      if (event.type === 'REMOVE_TAB') {
        const removedTabIndex = context.tabs.findIndex(tab => tab.currentUrl === event.url);
        if (removedTabIndex === -1) {
          return {}; // Tab not found, no changes
        }

        const updatedTabs = context.tabs.filter(tab => tab.currentUrl !== event.url);
        let newActiveTab = context.activeTab;

        if (context.activeTab !== null) {
          if (context.activeTab === removedTabIndex) {
            // Active tab was removed
            newActiveTab = updatedTabs.length > 0 ? Math.max(0, removedTabIndex - 1) : null;
          } else if (context.activeTab > removedTabIndex) {
            // Active tab was after removed tab, adjust index
            newActiveTab = context.activeTab - 1;
          }
          // If active tab was before removed tab, no change needed
        }

        return {
          tabs: updatedTabs,
          activeTab: newActiveTab,
        };
      }
      return {};
    }),
    switchTab: assign({
      activeTab: ({ context, event }) => {
        if (event.type === 'SWITCH_TAB') {
          const tabIndex = context.tabs.findIndex(tab => tab.currentUrl === event.url);
          if (tabIndex !== -1) {
            return tabIndex;
          }
          toast.error('Tab not found', {
            description: 'No tab found with the specified URL',
          });
          return context.activeTab;
        }
        return context.activeTab;
      },
    }),
    // Panel resizing actions
    resizeToDefault: () => {
      globalPanelRefs.left.current?.resize(50);
      globalPanelRefs.right.current?.resize(50);
    },
    resizeToMinimised: () => {
      globalPanelRefs.left.current?.resize(100);
      globalPanelRefs.right.current?.resize(0);
    },
    // Browser navigation actions
    openUrlInNewTab: ({ event }) => {
      if ('url' in event && event.url) {
        try {
          window.open(event.url, '_blank', 'noopener,noreferrer');
        } catch {
          toast.error('Failed to open URL', {
            description: 'Could not open the URL in a new tab',
          });
        }
      }
    },
  },
  guards: {
    // Guard that determines which state to transition to
    // For now, always returns true to go to 'open' state
    resolveState: () => {
      return true; // Always resolves to open for now
    },
    // Guard that checks if removing a tab would leave no tabs remaining
    noTabsRemaining: ({ context, event }) => {
      if (event.type === 'REMOVE_TAB') {
        const remainingTabs = context.tabs.filter(tab => tab.currentUrl !== event.url);
        return remainingTabs.length === 0;
      }
      return false;
    },
    // Environment detection guards
    isElectron: () => {
      return isElectronApp();
    },
    isBrowser: () => {
      return !isElectronApp();
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QHcwCMBuBLMyCyAhgMYAWWAdmAHRYQA2YAxAEoCiAygPIAyAaqwG0ADAF1EoAA4B7WFgAuWKeXEgAHogDMAFgBMVAKwaAjADYAHBpMaA7CaNGtAGhABPRCZMBOKjq1ahFmbW+kE2AL5hzqiYOPjEZJQ09ExsXHyCRmJIINKyCkoq6ghaGlRCQpZmQoZGQr4m1s5uCCZCRlTWOtZmJvqdnvq6EVHo2LiEpBTUtAyMnAAKrABywlmSMvKKytlF2no15pY2dg5NiN3eZl11-hWWtsMg0WNxk4kzTAvLApkquZsFHaIAC0Gm8Ok8nghWihZk89n0JicrkQRk8pRMOjaQQaGh0Hh0Gkez1iEwS02SjAAwtxOOxBKI-ht8ttQLtdAZjIcrLZ7MjmvjSv4sfdPFYSvpiaNSfEpklZngAJJLRVKgBaDLWOWZW0Kmg5BwsPJO-NRGgsVB6mLMRjhfVCUpi41l70pSpV6oyWv+LL1CGBJXa5rMNVtWmCXTOxRsVA0Nlq+P0Qm6YcdLzJco+jAAggARXMAfQAKtmAEKrJl5XVA-3m0r6BtohuGRFCU3+23WTlaVqeOG+e46NMyt4U2Z5wsl8u-bI+6tsxADMoaNr6Xw9oS9IyNFEdldlHteHQ6fSeXQQ4fO0fylKsPCcfjFssV2c6wELhB7TmmI3HPlRjQ+ioDw+RsLQLGsPtL1eckbxYO8H1YJ9p29N9WTURBBh8MwzF0NcGkGeFPCjYFfEuEN9CMQlNw8TpoIzV1ZnYAB1RUiypAAJZCX3WKt3ww-0uhMHx8QqM8PBsU92yorRLQcPpJNqCxDHol1qCkCQwHIalaXpHjtT49CiiMQYzA6QJ-BwrQk1MKME3aEITKEdELntVTrw0rTGHdVVFQ1fS5344zym8WwTxKeFrAcCo7KorsV2PewBk8ZyTHc2DPO0nzPR+VDDL9OKzJPHQTM6Hs4TqOznO8Hk4T7IwwSxax0rlTL4PpIsArQgqAlkyxagGWwPBtfQo0ooV8Iam0SvxZrIieaUrwyzTtInbjGVffKayopc416TpTD8YwjCq6pY26SCdB6W1cK0FrEjatap1yysASM1Eum8YxGyu3Cyo0KN4XaJLzFPZzcKue71JW+D70fZ6Nt4t6CtM8zzUs3CbJMWKTMtfw7CsFdISGeaSSW1qYbYOGkOemckd9baujM6xui0OLPCGgHdxtYSemqVyUzRKGqDali2M49a8uR7a9stZMoWshtwMjXdOj0VoHE6co+mCNLScWmC5SIOgZEgOZFhWRGDOlj9TEoqhwMRJFrG0KKGjswlhN0QDEWsiHumF43TYgc3vjp62GdtwafG0QCQsgtczDs3RZKCTGCZmsVA5N2AzdSVhOqtwL3oQUw+zKBrdGJgJIR0QHZL8HobMbhoWez4Oc3zSXXsjgS0VabC4zhbobR7Ovdwa-c7HRGESpCol9adQ3EiD3OQ6e59w+Lgqz1k-FCRXJNcLBaTPdjVpfGPEJqnMdu19hxDu82m2+6hdoUr8eFdHseWcf0DoWYJQajfBeIwl4MWoKvPOCF4abylr3YyZ5SidDXCub+Ngk4TzqA5W0TZtwhnxHrMB6Y1JUCgSHMW7EuII3gfOASWI2gdEGNYb+kE0TdEBl0HwYMcLHiRClUBC1wGkIALYUCwGI++XxLa0KCouQCVAGpOQaAmCwxEsGbg6GiLotouR1EEWTZe1AxHkAkVgKRFsXrPwQe4Lwii7DWXNEmS62MJ54nVoREqQQ1ynjMMLExZj740jpJqHudCijon-kopMKi6hqOTmdY4SCBpiksP48RkjoEdS6ltD8MJ2i8i6PiM85Q4SnysIPbQ25zAQm0Ok0xmT15dxoWEuRLROg+FqDCQC-g+yuOaFRK6sYBijyhO4wC9TAlmw3ihVpJdejCVtEg3QdhPpcwGZXRR9x5ZRU7JMxpD9YHliLt1GskStnKKinEsEydITAUsNUco09ISeH2eY6B1NuJb1OR+Xo-9egHzZiwkqHCsEchMkaEq3tMRvPvpQiWLTrHhPOA1YCNpMbohFCzeu-ywwlJUQ4O6jxyBSAgHAFQhiIFzL9AGSCsYcKhj+muHczRQQxk3C7OEmJBiewMQbCBN5qU1mBAiKgH8riAROLUQwUYzKQjtlC26UUzzC0ykK22lQfBeHGnYQYbZRoTxMqUHCv595Jj5cI685D1X0LqPFHsP9bB6puRPNcskGq62OmzDwsLIA2qKJ0YSJU+wrhYTPCEycSpiuir9IpWcIhhCAA */
  context: () => ({
    webviewState: 'idle' as WebviewState,
    tabs: [],
    activeTab: null,
  }),
  id: 'webviewMachine',
  initial: 'closed',
  states: {
    idle: {
      on: {
        RESOLVE: [
          {
            target: 'open',
            guard: 'isElectron',
            actions: ['setOpen', 'resizeToDefault'],
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        OPEN: [
          {
            target: 'open',
            guard: 'isElectron',
            actions: ['setOpen', 'resizeToDefault'],
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        CLOSE: {
          target: 'closed',
          actions: 'setClosed',
        },
        MINIMIZE: [
          {
            target: 'minimised',
            guard: 'isElectron',
            actions: ['setMinimised', 'resizeToMinimised'],
          },
          {
            guard: 'isBrowser',
            // No-op for browser, stays in current state
          },
        ],
        ADD_TAB: [
          {
            guard: 'isElectron',
            actions: 'addTab',
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        REMOVE_TAB: [
          {
            target: 'closed',
            guard: 'noTabsRemaining',
            actions: ['removeTab', 'setClosed'],
          },
          {
            actions: 'removeTab',
          },
        ],
        SWITCH_TAB: {
          actions: 'switchTab',
        },
      },
    },
    open: {
      // Open state - webview is visible and active
      on: {
        CLOSE: {
          target: 'closed',
          actions: 'setClosed',
        },
        MINIMIZE: [
          {
            target: 'minimised',
            guard: 'isElectron',
            actions: ['setMinimised', 'resizeToMinimised'],
          },
          {
            guard: 'isBrowser',
            // No-op for browser, stays in current state
          },
        ],
        RESET: {
          target: 'idle',
          actions: ['setIdle', 'resizeToDefault'],
        },
        ADD_TAB: [
          {
            guard: 'isElectron',
            actions: 'addTab',
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        REMOVE_TAB: [
          {
            target: 'closed',
            guard: 'noTabsRemaining',
            actions: ['removeTab', 'setClosed'],
          },
          {
            actions: 'removeTab',
          },
        ],
        SWITCH_TAB: {
          actions: 'switchTab',
        },
      },
    },
    closed: {
      // Closed state - webview is not visible
      on: {
        OPEN: [
          {
            target: 'open',
            guard: 'isElectron',
            actions: ['setOpen', 'resizeToDefault'],
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        RESET: {
          target: 'idle',
          actions: ['setIdle', 'resizeToDefault'],
        },
        ADD_TAB: [
          {
            guard: 'isElectron',
            actions: 'addTab',
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        REMOVE_TAB: [
          {
            target: 'closed',
            guard: 'noTabsRemaining',
            actions: ['removeTab', 'setClosed'],
          },
          {
            actions: 'removeTab',
          },
        ],
        SWITCH_TAB: {
          actions: 'switchTab',
        },
      },
    },
    minimised: {
      // Minimised state - webview is minimized
      on: {
        OPEN: [
          {
            target: 'open',
            guard: 'isElectron',
            actions: ['setOpen', 'resizeToDefault'],
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        CLOSE: {
          target: 'closed',
          actions: 'setClosed',
        },
        RESET: {
          target: 'idle',
          actions: ['setIdle', 'resizeToDefault'],
        },
        ADD_TAB: [
          {
            guard: 'isElectron',
            actions: 'addTab',
          },
          {
            guard: 'isBrowser',
            actions: 'openUrlInNewTab',
          },
        ],
        REMOVE_TAB: [
          {
            target: 'closed',
            guard: 'noTabsRemaining',
            actions: ['removeTab', 'setClosed'],
          },
          {
            actions: 'removeTab',
          },
        ],
        SWITCH_TAB: {
          actions: 'switchTab',
        },
      },
    },
  },
});

// Global webview actor instance
export const webviewActor = createActor(webviewMachine).start();
