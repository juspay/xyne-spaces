import { useSyncExternalStore } from 'react';
import { setup, assign, createActor } from 'xstate';
import { indexedDBService } from '../services/indexedDBService';

export interface UserPreferences {
  sdlcSidebarCollapsed: boolean;
  sdlcSidebarWidth: number;
  /** Which tabs a folder page has open, per folder. The active one lives in the
   *  URL instead, so a shared link opens the item you meant rather than a copy
   *  of someone else's working set. */
  sdlcFolderTabs: Record<
    string,
    Array<{
      kind: 'CANVAS' | 'LINK' | 'ATTACHMENT' | 'BROWSER';
      id: string;
      /** A browsing tab's page, title and icon, so it reopens where it was. */
      url?: string;
      title?: string;
      favicon?: string;
    }>
  >;
  sdlcFolderTreeExpanded: Record<string, boolean>;
  /** Where a folder's browser opens when it has nowhere else to be: the tab Xyne AI
   *  asks for when it browses for you. Set on the browsing start page. */
  sdlcBrowserHomePage: string;
  /** The browser panel's tabs, in order, and the one that was open: kept so a reload
   *  or a restart finds them as they were. */
  browserTabs: {
    tabs: Array<{ id: string; url: string; title: string; favicon?: string }>;
    activeTabId: string | null;
  };
  /** Each site's zoom in the in-app browsers, by host, as Chrome remembers it; only
   *  sites not at 100%. */
  browserZoom: Record<string, number>;
  /** A playing video floats in its own window when its tab is left. */
  browserAutoPictureInPicture: boolean;
  /** When each browser profile's sign-ins were last imported, and from how many sites:
   *  shown in Preferences → Browser. By source id. */
  browserImports: Record<string, { at: number; sites: number }>;
  /** The folder page's explorer, folded away to give the page its full width. */
  sdlcExplorerCollapsed: boolean;
  sdlcSidebarSectionsCollapsed: Record<string, boolean>;
  sdlcShowClosedTracks: boolean;
  // TODO: move relatedContextEnabled and relatedContextDebounceMs to the server-side
  // user_preferences table (with the other Messaging preferences) once the
  // related-context feature is confirmed; kept per device while it is on trial.
  /**
   * Suggest threads, tickets, canvases and calls related to the message being
   * written, as chips in the composer. Off until turned on in Preferences →
   * Messaging.
   */
  relatedContextEnabled: boolean;
  /** How long after the last keystroke to look them up, in ms. Never below 1000. */
  relatedContextDebounceMs: number;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  sdlcSidebarCollapsed: false,
  sdlcSidebarWidth: 280,
  sdlcFolderTabs: {},
  sdlcFolderTreeExpanded: {},
  sdlcBrowserHomePage: 'https://www.google.com',
  browserImports: {},
  browserTabs: { tabs: [], activeTabId: null },
  browserZoom: {},
  browserAutoPictureInPicture: true,
  sdlcExplorerCollapsed: false,
  sdlcSidebarSectionsCollapsed: {},
  sdlcShowClosedTracks: false,
  relatedContextEnabled: false,
  relatedContextDebounceMs: 1000,
};

export interface UserPreferencesContext {
  preferences: UserPreferences;
  hydrated: boolean;
  ownerId: string | null;
}

export type UserPreferencesEvent =
  | { type: 'HYDRATED'; userId: string | null; preferences: Partial<UserPreferences> }
  | { type: 'SET'; key: keyof UserPreferences; value: UserPreferences[keyof UserPreferences] }
  | { type: 'RESET' };

const STORAGE_KEY = 'userPreferences';

let pendingWrite: ReturnType<typeof setTimeout> | null = null;

function persist(preferences: UserPreferences): void {
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    if (!indexedDBService.isInitialized()) return;
    void indexedDBService.saveContextProperty(STORAGE_KEY, preferences).catch(() => {});
  }, 200);
}

export const userPreferencesMachine = setup({
  types: {
    context: {} as UserPreferencesContext,
    events: {} as UserPreferencesEvent,
  },
  actions: {
    persistPreferences: ({ context }) => persist(context.preferences),
  },
}).createMachine({
  id: 'userPreferences',
  context: {
    preferences: DEFAULT_USER_PREFERENCES,
    hydrated: false,
    ownerId: null,
  },
  on: {
    HYDRATED: {
      actions: assign(({ context, event }) => {
        const sameReader = context.ownerId === null || context.ownerId === event.userId;
        return {
          preferences:
            sameReader && context.hydrated
              ? context.preferences
              : { ...DEFAULT_USER_PREFERENCES, ...event.preferences },
          hydrated: true,
          ownerId: event.userId,
        };
      }),
    },
    SET: {
      actions: [
        assign(({ context, event }) => ({
          preferences: { ...context.preferences, [event.key]: event.value },
          hydrated: true,
        })),
        'persistPreferences',
      ],
    },
    RESET: {
      actions: [
        assign(() => ({ preferences: DEFAULT_USER_PREFERENCES, hydrated: true })),
        'persistPreferences',
      ],
    },
  },
});

export const userPreferencesActor = createActor(userPreferencesMachine).start();

export async function hydrateUserPreferences(userId: string | null): Promise<void> {
  try {
    if (!indexedDBService.isInitialized()) return;
    const stored = await indexedDBService.loadContextProperty(STORAGE_KEY);
    userPreferencesActor.send({
      type: 'HYDRATED',
      userId,
      preferences: stored && typeof stored === 'object' ? (stored as Partial<UserPreferences>) : {},
    });
  } catch {
    // Defaults are a working app.
  }
}

export function setUserPreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
): void {
  userPreferencesActor.send({ type: 'SET', key, value });
}

export function userPreferencesSnapshot(): UserPreferences {
  return userPreferencesActor.getSnapshot().context.preferences;
}

export function useUserPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
  return useSyncExternalStore(
    onChange => {
      const subscription = userPreferencesActor.subscribe(() => onChange());
      return () => subscription.unsubscribe();
    },
    () => userPreferencesActor.getSnapshot().context.preferences[key],
  );
}
