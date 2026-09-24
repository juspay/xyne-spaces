import { createBarItemsStore } from './barItemsStore';
import { setAppSnapshot } from './appSnapshotsStore';
import { appItemId } from './appItemId';
import {
  DEFAULT_TOOLBAR_PATHS,
  NAVIGATION_ITEMS,
} from '../../components/AppSidebar/navigationConfig';

/** Apps a single bar may hold. Keeps a pinning spree from pushing nav off-screen. */
export const MAX_APPS_PER_BAR = 8;

// Pre-v2 keys. The toolbar used to be an unordered set of paths, and pinned
// apps were a separate list rendered after it; both fold into one ordered list.
const LEGACY_TOOLBAR_KEY = 'xyne:toolbar-items';
const LEGACY_PINNED_APPS_KEY = 'xyne:pinned-artifact-apps';

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

const migrateToolbar = (): string[] | null => {
  const legacyPaths = readJson(LEGACY_TOOLBAR_KEY);
  const legacyPinned = readJson(LEGACY_PINNED_APPS_KEY);
  if (legacyPaths === null && legacyPinned === null) return null;

  // The old set rendered in canonical NAVIGATION_ITEMS order, so seed the list
  // in that order rather than the set's insertion order — nothing should
  // visibly move on upgrade.
  const canonicalIndex = new Map(NAVIGATION_ITEMS.map((item, i) => [item.path, i]));
  const paths = Array.isArray(legacyPaths)
    ? legacyPaths
        .filter((p): p is string => typeof p === 'string')
        .sort((a, b) => (canonicalIndex.get(a) ?? Infinity) - (canonicalIndex.get(b) ?? Infinity))
    : [...DEFAULT_TOOLBAR_PATHS];

  const apps: string[] = [];
  if (Array.isArray(legacyPinned)) {
    for (const entry of legacyPinned) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, title, icon } = entry as { id?: unknown; title?: unknown; icon?: unknown };
      if (typeof id !== 'string' || typeof title !== 'string') continue;
      setAppSnapshot(id, { title, icon: typeof icon === 'string' ? icon : null });
      apps.push(appItemId(id));
    }
  }

  try {
    localStorage.removeItem(LEGACY_TOOLBAR_KEY);
    localStorage.removeItem(LEGACY_PINNED_APPS_KEY);
  } catch {
    // Leaving the old keys behind is harmless: v2 exists after this returns.
  }

  return [...paths, ...apps];
};

/** Rail order: nav paths and `app:<id>` entries. */
export const toolbarItemsStore = createBarItemsStore({
  storageKey: 'xyne:toolbar-items-v2',
  defaults: DEFAULT_TOOLBAR_PATHS,
  migrate: migrateToolbar,
});

/**
 * Inbox menubar (above the channel list): ChatNavKey values and `app:<id>`.
 * Starts with every built-in the menubar had before it became customizable;
 * New Message and Threads stay put.
 */
export const inboxItemsStore = createBarItemsStore({
  storageKey: 'xyne:inbox-items',
  defaults: ['new-message', 'threads', 'unreads', 'bookmarks', 'drafts-sent', 'recap', 'radar'],
  locked: ['new-message', 'threads'],
});
