import { useSyncExternalStore } from 'react';
import { setup, assign, createActor } from 'xstate';
import { indexedDBService } from '../services/indexedDBService';

export interface UserPreferences {
  sdlcSidebarCollapsed: boolean;
  sdlcSidebarWidth: number;
  sdlcFinderColumnWidths: Record<string, number>;
  sdlcFinderGroupBy: 'none' | 'type';
  sdlcFinderPathByTrack: Record<
    string,
    Array<{ type: 'TRACK' | 'FOLDER'; id: string; name: string }>
  >;
  sdlcSidebarSectionsCollapsed: Record<string, boolean>;
  sdlcSidebarSectionHeights: Record<string, number>;
  sdlcShowClosedTracks: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  sdlcSidebarCollapsed: false,
  sdlcSidebarWidth: 260,
  sdlcFinderColumnWidths: {},
  sdlcFinderGroupBy: 'none',
  sdlcFinderPathByTrack: {},
  sdlcSidebarSectionsCollapsed: Object.fromEntries(
    ['sdlc-sidebar-artifacts', 'sdlc-sidebar-repositories'].map(id => [id, true]),
  ),
  sdlcSidebarSectionHeights: {},
  sdlcShowClosedTracks: false,
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
