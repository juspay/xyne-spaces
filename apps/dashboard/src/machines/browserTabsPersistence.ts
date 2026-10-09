import { browserPanelActor, type BrowserTab } from './browserPanelMachine';
import {
  setUserPreference,
  userPreferencesActor,
  userPreferencesSnapshot,
  type UserPreferences,
} from './userPreferencesMachine';
import {
  keepsBrowserStateSecurely,
  readSecureBrowserState,
  writeSecureBrowserState,
} from '../utils/browserSecureState';
import { loadSiteZoom } from '../components/InAppBrowser/zoom';

type KeptTabs = UserPreferences['browserTabs'];

const NO_TABS: KeptTabs = { tabs: [], activeTabId: null };

/** Only web pages and new tabs are kept: anything else can't be opened again. */
const keepable = (url: string): boolean => url === '' || /^https?:\/\//.test(url);

function keptFrom(tabs: readonly BrowserTab[], activeTabId: string | null): KeptTabs {
  const kept = tabs
    .filter(tab => keepable(tab.url))
    .map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      ...(tab.favicon && { favicon: tab.favicon }),
    }));
  return {
    tabs: kept,
    activeTabId: kept.some(tab => tab.id === activeTabId) ? activeTabId : null,
  };
}

/** Kept tabs as the desktop app gives them back, taken only in the shape they should have. */
function keptTabsFrom(value: unknown): KeptTabs | null {
  if (typeof value !== 'object' || value === null || !('tabs' in value)) return null;
  const { tabs } = value;
  if (!Array.isArray(tabs)) return null;
  const valid = tabs.flatMap(tab => {
    if (typeof tab !== 'object' || tab === null) return [];
    const { id, url, title, favicon } = tab as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof url !== 'string' || !keepable(url)) return [];
    return [
      {
        id,
        url,
        title: typeof title === 'string' ? title : '',
        ...(typeof favicon === 'string' && favicon && { favicon }),
      },
    ];
  });
  const activeTabId = 'activeTabId' in value ? value.activeTabId : null;
  return {
    tabs: valid,
    activeTabId:
      typeof activeTabId === 'string' && valid.some(tab => tab.id === activeTabId)
        ? activeTabId
        : null,
  };
}

function restored(kept: KeptTabs): BrowserTab[] {
  return kept.tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  }));
}

/**
 * Keeps the browser panel's tabs across a reload or a restart: their order, where
 * each is, its title and icon, and which was open — with each site's zoom.
 *
 * Kept by the desktop app, encrypted, where it can; tabs kept in the app's own
 * preferences before are moved over once and go from there. A desktop app from
 * before it could leaves them in the preferences.
 *
 * They come back once this device's preferences have loaded — ahead of any tab
 * opened before then — and are written as they change, but never before they have
 * come back: an empty list written first would lose them.
 */
export function keepBrowserTabs(): () => void {
  let started = false;
  let ready = false;
  let lastWritten = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const secure = keepsBrowserStateSecurely();

  const restore = async (): Promise<void> => {
    const local = userPreferencesSnapshot().browserTabs;
    let kept: KeptTabs | null = local;
    if (secure) {
      kept = keptTabsFrom(await readSecureBrowserState('tabs'));
      if ((!kept || kept.tabs.length === 0) && local.tabs.length > 0) {
        kept = local;
        writeSecureBrowserState('tabs', local);
      }
      if (local.tabs.length > 0 || local.activeTabId) setUserPreference('browserTabs', NO_TABS);
      await loadSiteZoom();
    }
    if (kept && kept.tabs.length > 0) {
      browserPanelActor.send({
        type: 'RESTORE_TABS',
        tabs: restored(kept),
        activeTabId: kept.activeTabId,
      });
    }
    ready = true;
  };

  const startWhenReady = (): void => {
    if (started || !userPreferencesActor.getSnapshot().context.hydrated) return;
    started = true;
    void restore();
  };
  startWhenReady();
  const preferences = userPreferencesActor.subscribe(startWhenReady);

  const tabs = browserPanelActor.subscribe(state => {
    if (!ready) return;
    const next = keptFrom(state.context.tabs, state.context.activeTabId);
    if (timer) clearTimeout(timer);
    // Once a page settles, not on every step of a redirect.
    timer = setTimeout(() => {
      timer = null;
      const written = JSON.stringify(next);
      if (written === lastWritten) return;
      lastWritten = written;
      if (secure) writeSecureBrowserState('tabs', next);
      else if (written !== JSON.stringify(userPreferencesSnapshot().browserTabs)) {
        setUserPreference('browserTabs', next);
      }
    }, 500);
  });

  return () => {
    if (timer) clearTimeout(timer);
    preferences.unsubscribe();
    tabs.unsubscribe();
  };
}
