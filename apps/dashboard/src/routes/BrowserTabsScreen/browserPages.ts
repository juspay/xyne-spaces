import { useSyncExternalStore } from 'react';
import { IDLE_PAGE, type PageLive, type WebviewElement } from '../../components/InAppBrowser';

/**
 * The browser panel's pages, apart from the screen that shows them.
 *
 * The pages live in one layer that never moves (BrowserPageLayer), drawn over a
 * hole the browser screen leaves — docked beside the app or full screen. A page
 * moved in the document is reloaded, so docking or undocking moves only the hole,
 * and the pages stay as they were: scrolled, signed in, mid-video.
 *
 * Here: each tab's page, what each is doing, where the hole is, and what a page
 * asks of the screen around it — the address bar, the tab list, find.
 */

/** What a page asks of the browser screen, from the keyboard or its menu. */
export type ChromeCommand = 'focusAddress' | 'tabs' | 'find';

const views = new Map<string, WebviewElement>();
/** Zooms the open page, while the browser has the keyboard: what the View menu's zoom
 *  does then. Null while it hasn't. */
let pageZoomer: ((step: 'in' | 'out' | 'reset') => boolean) | null = null;
let lives: Readonly<Record<string, PageLive>> = {};
let hole: HTMLElement | null = null;
const listeners = new Set<() => void>();
const commandListeners = new Set<(command: ChromeCommand) => void>();

const changed = (): void => listeners.forEach(listener => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const browserPages = {
  view: (tabId: string | null): WebviewElement | null =>
    tabId ? (views.get(tabId) ?? null) : null,
  setView(tabId: string, view: WebviewElement | null): void {
    if (view) {
      views.set(tabId, view);
      return;
    }
    views.delete(tabId);
    if (lives[tabId]) {
      lives = Object.fromEntries(Object.entries(lives).filter(([id]) => id !== tabId));
      changed();
    }
  },
  /** Whether the page with the keyboard is one of the panel's. */
  hasKeyboard: (): boolean => [...views.values()].some(view => view === document.activeElement),
  live: (tabId: string | null): PageLive => (tabId ? lives[tabId] : undefined) ?? IDLE_PAGE,
  setLive(tabId: string, change: Partial<PageLive>): void {
    lives = { ...lives, [tabId]: { ...(lives[tabId] ?? IDLE_PAGE), ...change } };
    changed();
  },
  /** The browser screen's place for the open page; null while none shows. */
  setHole(element: HTMLElement | null): void {
    if (hole === element) return;
    hole = element;
    changed();
  },
  setPageZoomer(zoomer: ((step: 'in' | 'out' | 'reset') => boolean) | null): void {
    pageZoomer = zoomer;
  },
  /** The View menu's zoom, on the open page if the browser has the keyboard. */
  zoomOpenPage: (step: 'in' | 'out' | 'reset'): boolean => pageZoomer?.(step) ?? false,
  /** Whether the browser is on screen, docked or full screen. */
  isShowing: (): boolean => hole !== null,
  /** Lets go of the hole, unless another screen has taken it since. */
  releaseHole(element: HTMLElement): void {
    if (hole !== element) return;
    hole = null;
    changed();
  },
  command(command: ChromeCommand): void {
    commandListeners.forEach(listener => listener(command));
  },
  onCommand(listener: (command: ChromeCommand) => void): () => void {
    commandListeners.add(listener);
    return () => commandListeners.delete(listener);
  },
};

/** Every page's state, by tab. */
export function usePageLives(): Readonly<Record<string, PageLive>> {
  return useSyncExternalStore(subscribe, () => lives);
}

/** Where the open page goes; null while the browser isn't showing. */
export function usePageHole(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => hole);
}
