import { useSyncExternalStore } from 'react';
import { setup, assign, createActor } from 'xstate';
import { indexedDBService } from '../services/indexedDBService';

/* -------------------------- TYPES -------------------------- */

/**
 * Everything the reader has chosen about how the app looks to them — as opposed
 * to anything about the workspace, which belongs to the workspace and not to
 * one person's browser.
 *
 * One flat, typed object rather than a key per preference: it is written and
 * read as a whole, so a new preference costs a field and a default and nothing
 * else. Every field needs a default, since a reader who has never expressed a
 * preference must still get a sensible app.
 */
export interface UserPreferences {
  /** SDLC hub sidebar folded to its icon rail. */
  sdlcSidebarCollapsed: boolean;
  /** Width in pixels of the SDLC hub sidebar when it is not folded. */
  sdlcSidebarWidth: number;
  /**
   * Width in pixels of each column in the track's folder browser, by the id of
   * the parent it lists. Per column rather than one shared width: a level you
   * widened to read long titles should stay wide without dragging every other
   * level with it.
   */
  sdlcFinderColumnWidths: Record<string, number>;
  /** How a column's contents are grouped: not at all, or by kind and artifact type. */
  sdlcFinderGroupBy: 'none' | 'type';
  /**
   * The folder path open in each track's browser, by track id — so returning to a
   * track puts you back where you were rather than at its root. Names are stored
   * with the ids because the column headers need them before the folders load.
   */
  sdlcFinderPathByTrack: Record<
    string,
    Array<{ type: 'TRACK' | 'FOLDER'; id: string; name: string }>
  >;
  /** SDLC hub sidebar sections that are folded to their header, by panel id. */
  sdlcSidebarSectionsCollapsed: Record<string, boolean>;
  /**
   * Height in pixels each SDLC sidebar section returns to when opened, by panel
   * id. Pixels rather than the group's own percentages: percentages are relative
   * to a container the sections do not fill on their own, so they drifted every
   * time one folded and another took the slack.
   */
  sdlcSidebarSectionHeights: Record<string, number>;
  /** Completed and parked tracks shown in the SDLC sidebar. */
  sdlcShowClosedTracks: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  sdlcSidebarCollapsed: false,
  sdlcSidebarWidth: 260,
  sdlcFinderColumnWidths: {},
  sdlcFinderGroupBy: 'none',
  sdlcFinderPathByTrack: {},
  // Hub and Tracks are what a reader arrives wanting; the other two are there to
  // be opened when needed. Ids are literals rather than an import so this module
  // stays free of the screen it stores preferences for, and are built into the
  // record rather than written as keys, which their kebab-case would fail lint on.
  sdlcSidebarSectionsCollapsed: Object.fromEntries(
    ['sdlc-sidebar-artifacts', 'sdlc-sidebar-repositories'].map(id => [id, true]),
  ),
  sdlcSidebarSectionHeights: {},
  sdlcShowClosedTracks: false,
};

export interface UserPreferencesContext {
  preferences: UserPreferences;
  /** False until IndexedDB has answered, so nothing is written over a stored value. */
  hydrated: boolean;
  /**
   * Whose preferences these are. The actor is a module singleton, so signing out
   * and in as someone else in the same tab would otherwise leave the previous
   * reader's choices in place — and then persist them into the new reader's store.
   */
  ownerId: string | null;
}

export type UserPreferencesEvent =
  | { type: 'HYDRATED'; userId: string | null; preferences: Partial<UserPreferences> }
  | { type: 'SET'; key: keyof UserPreferences; value: UserPreferences[keyof UserPreferences] }
  | { type: 'RESET' };

/* -------------------------- PERSISTENCE -------------------------- */

/** One row in the existing context store, rather than a store of its own. */
const STORAGE_KEY = 'userPreferences';

/**
 * Writes are fire-and-forget and coalesced to the end of the turn: preferences
 * change in bursts — a drag that collapses two sections at once — and each one
 * is worth less than the next render.
 */
let pendingWrite: ReturnType<typeof setTimeout> | null = null;

function persist(preferences: UserPreferences): void {
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    if (!indexedDBService.isInitialized()) return;
    void indexedDBService.saveContextProperty(STORAGE_KEY, preferences).catch(() => {
      // A preference is not worth surfacing an error for; the session keeps the
      // value in memory either way.
    });
  }, 200);
}

/* -------------------------- MACHINE -------------------------- */

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
    // Stored values win over defaults but never over a choice already made in
    // this session — hydration can land after the reader has clicked something.
    HYDRATED: {
      actions: assign(({ context, event }) => {
        // A different reader replaces everything: the in-session latch protects
        // one person's choices from a late load, not one person's choices from
        // another person.
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
          // A choice made before hydration is a choice: it must not be
          // overwritten by whatever IndexedDB says a moment later.
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

/**
 * Read stored preferences into the actor. Safe to call more than once — the
 * machine keeps whatever the reader has already chosen this session.
 */
export async function hydrateUserPreferences(userId: string | null): Promise<void> {
  try {
    if (!indexedDBService.isInitialized()) return;
    const stored = await indexedDBService.loadContextProperty(STORAGE_KEY);
    // Sent even when nothing is stored: a reader with no saved preferences still
    // has to displace the previous reader's, which an early return would keep.
    userPreferencesActor.send({
      type: 'HYDRATED',
      userId,
      preferences:
        stored && typeof stored === 'object' ? (stored as Partial<UserPreferences>) : {},
    });
  } catch {
    // Defaults are a working app.
  }
}

/* -------------------------- REACT -------------------------- */

export function setUserPreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
): void {
  userPreferencesActor.send({ type: 'SET', key, value });
}

/** Every preference, read once — for callers outside React's render cycle. */
export function userPreferencesSnapshot(): UserPreferences {
  return userPreferencesActor.getSnapshot().context.preferences;
}

/** One preference, re-rendering only the components that read it. */
export function useUserPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
  return useSyncExternalStore(
    onChange => {
      const subscription = userPreferencesActor.subscribe(() => onChange());
      return () => subscription.unsubscribe();
    },
    () => userPreferencesActor.getSnapshot().context.preferences[key],
  );
}
