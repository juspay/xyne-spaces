import type { BrowserHistoryPage } from '../../types/electron';

export type { BrowserHistoryPage };

/** What the browsing history offers for what is typed. */
export interface HistorySuggestions {
  searches: string[];
  pages: BrowserHistoryPage[];
}

/** Where an address bar asks: the desktop app, or — from inside a frame — its host. */
export interface HistorySource {
  suggest: (typed: string, limit: number) => Promise<HistorySuggestions>;
  top: (limit: number) => Promise<BrowserHistoryPage[]>;
}

const NOTHING: HistorySuggestions = { searches: [], pages: [] };

/**
 * The desktop app's own record of where its browsers have been. A desktop app from
 * before it kept one answers nothing, and the bar suggests only what is open.
 */
export const desktopHistory: HistorySource = {
  suggest: async (typed, limit) => {
    const api = window.electronAPI;
    if (!api?.browserHistorySuggest) return NOTHING;
    return api.browserHistorySuggest(typed, limit).catch(() => NOTHING);
  },
  top: async limit => {
    const api = window.electronAPI;
    if (!api?.browserHistoryTop) return [];
    return api.browserHistoryTop(limit).catch(() => []);
  },
};

/**
 * Connects ahead to where the address bar is about to go, so the page starts sooner.
 * Nothing where the desktop app can't.
 */
export function preconnect(url: string): void {
  void window.electronAPI?.preconnectBrowserPage?.(url).catch(() => undefined);
}

/** Whether this desktop app keeps a browsing history at all, for Preferences to offer clearing it. */
export function canClearBrowsingHistory(): boolean {
  return typeof window.electronAPI?.clearBrowserHistory === 'function';
}

/** Forgets every page visited and search made in the in-app browsers. */
export async function clearBrowsingHistory(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.clearBrowserHistory) return false;
  const result = await api.clearBrowserHistory().catch(() => null);
  return result?.success === true;
}
