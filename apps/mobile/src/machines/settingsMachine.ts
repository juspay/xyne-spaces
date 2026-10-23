import { setup, assign, createActor } from 'xstate';
import { useSelector } from '@xstate/react';
import { AppState, type AppStateStatus } from 'react-native';

import { getByPath, setByPath, type Path, type PathValue } from '@/src/utils/typePath';
import {
  DEFAULTS,
  SCHEMA_VERSION,
  SettingsSchema,
  migrators,
  type Settings,
  type StoredSettings,
} from '@/src/machines/settingsMachine.schema';
import { readStoredSettings, writeStoredSettings } from '@/src/services/settingsStorage';
import { DEFAULT_SOUND_ID } from '@/src/notifications/soundMetadata';
import { writeNotificationSoundPreference } from '@/src/notifications/soundPreference';
import {
  readStoredChatBubblePreference,
  writeStoredChatBubblePreference,
} from '@/src/services/chatBubblePreferenceStorage';
import { DEFAULT_CHAT_BUBBLE_COLOR_VAR, isChatBubbleColorVar } from '@/src/theme/chatBubbleTheme';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const deepMergeOverDefaults = <T>(base: T, partial: unknown): T => {
  if (!isPlainObject(partial) || !isPlainObject(base)) {
    return partial === undefined ? base : (partial as T);
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(partial)) {
    if (key in (base as Record<string, unknown>)) {
      result[key] = deepMergeOverDefaults((base as Record<string, unknown>)[key], partial[key]);
    }
  }
  return result as T;
};

const runMigrators = (stored: StoredSettings): unknown => {
  let current: unknown = stored.settings;
  for (let v = stored.version; v < SCHEMA_VERSION; v++) {
    const migrator = migrators[v];
    if (migrator) {
      current = migrator(current);
    }
  }
  return current;
};

const getDefaultAtPath = (path: string): unknown => {
  let cursor: unknown = DEFAULTS;
  for (const segment of path.split('.')) {
    if (!isPlainObject(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
};

let parseWarningLogged = false;

const normalizeLegacySettings = (settings: unknown): unknown => {
  if (!isPlainObject(settings)) return settings;
  const notifications = settings['notifications'];
  if (isPlainObject(notifications) && notifications['soundId'] === 'none') {
    return {
      ...settings,
      notifications: { ...notifications, soundId: DEFAULT_SOUND_ID },
    };
  }
  return settings;
};

const hydrate = (): Settings => {
  const stored = readStoredSettings();
  const storedChatBubbleColorVar = readStoredChatBubblePreference();

  if (!stored) {
    const defaults = storedChatBubbleColorVar
      ? setByPath(DEFAULTS, 'chatTheme.bubbleColorVar', storedChatBubbleColorVar)
      : DEFAULTS;
    if (!storedChatBubbleColorVar) {
      writeStoredChatBubblePreference(DEFAULTS.chatTheme.bubbleColorVar);
    }
    writeNotificationSoundPreference(defaults.notifications.soundId);
    return defaults;
  }

  const migrated = normalizeLegacySettings(runMigrators(stored));
  const merged = deepMergeOverDefaults(DEFAULTS, migrated);
  const settingsWithDirectChatBubble = storedChatBubbleColorVar
    ? setByPath(merged, 'chatTheme.bubbleColorVar', storedChatBubbleColorVar)
    : merged;
  const result = SettingsSchema.safeParse(settingsWithDirectChatBubble);
  if (!result.success) {
    if (!parseWarningLogged) {
      console.warn(
        '[settingsMachine] stored settings failed schema validation, falling back to defaults',
        result.error,
      );
      parseWarningLogged = true;
    }
    return storedChatBubbleColorVar
      ? setByPath(DEFAULTS, 'chatTheme.bubbleColorVar', storedChatBubbleColorVar)
      : DEFAULTS;
  }
  writeNotificationSoundPreference(result.data.notifications.soundId);
  if (!storedChatBubbleColorVar) {
    writeStoredChatBubblePreference(result.data.chatTheme.bubbleColorVar);
  }
  return result.data;
};

type SettingsEvent =
  { type: 'SET'; path: string; value: unknown } | { type: 'RESET'; path?: string };

const settingsMachine = setup({
  types: {
    context: {} as Settings,
    events: {} as SettingsEvent,
    input: {} as Settings,
  },
  actions: {
    setPath: assign(({ context, event }) => {
      if (event.type !== 'SET') {
        return context;
      }
      return setByPath(context, event.path, event.value);
    }),
    resetPath: assign(({ context, event }) => {
      if (event.type !== 'RESET') {
        return context;
      }
      if (!event.path) {
        return DEFAULTS;
      }
      const defaultValue = getDefaultAtPath(event.path);
      return setByPath(context, event.path, defaultValue);
    }),
  },
}).createMachine({
  id: 'settings',
  context: ({ input }) => input,
  on: {
    SET: { actions: 'setPath' },
    RESET: { actions: 'resetPath' },
  },
});

export const settingsActor = createActor(settingsMachine, { input: hydrate() }).start();

const DEBOUNCE_MS = 300;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: StoredSettings | null = null;
let persistenceSetup = false;
let appStateSubscription: { remove: () => void } | null = null;
let skipFirstEmission = true;
let isAppActive = AppState.currentState === 'active';

const cancelPendingWrite = (): void => {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
};

const flushPendingWrite = (): void => {
  cancelPendingWrite();
  if (pendingPayload) {
    writeStoredSettings(pendingPayload);
    pendingPayload = null;
  }
};

const scheduleWrite = (settings: Settings): void => {
  pendingPayload = { version: SCHEMA_VERSION, settings };
  if (!isAppActive) {
    return;
  }
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (pendingPayload) {
      writeStoredSettings(pendingPayload);
      pendingPayload = null;
    }
  }, DEBOUNCE_MS);
};

export const setupSettingsPersistence = (): void => {
  if (persistenceSetup) {
    return;
  }
  persistenceSetup = true;

  settingsActor.subscribe(state => {
    if (skipFirstEmission) {
      skipFirstEmission = false;
      return;
    }
    scheduleWrite(state.context);
  });

  appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    isAppActive = status === 'active';
    if (!isAppActive) {
      // Settings are recoverable preferences. Never begin a shared-MMKV write
      // while iOS is about to suspend the process.
      cancelPendingWrite();
    } else if (pendingPayload) {
      scheduleWrite(pendingPayload.settings);
    }
  });
};

export const teardownSettingsPersistence = (): void => {
  if (isAppActive) {
    // Teardown while active is a normal app-owned transition (for example,
    // logout), not an iOS suspension boundary. Preserve the prior durability
    // contract in that case.
    flushPendingWrite();
  } else {
    cancelPendingWrite();
    pendingPayload = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  persistenceSetup = false;
  skipFirstEmission = true;
};

export const useSetting = <P extends Path<Settings>>(path: P): PathValue<Settings, P> =>
  useSelector(settingsActor, state => getByPath(state.context, path));

export const setSetting = <P extends Path<Settings>>(
  path: P,
  value: PathValue<Settings, P>,
): void => {
  const nextValue: unknown = value;
  if (path === 'chatTheme.bubbleColorVar' && isChatBubbleColorVar(nextValue)) {
    writeStoredChatBubblePreference(nextValue);
  } else if (path === 'chatTheme' && isPlainObject(nextValue)) {
    const nextBubbleColorVar = nextValue['bubbleColorVar'];
    if (isChatBubbleColorVar(nextBubbleColorVar)) {
      writeStoredChatBubblePreference(nextBubbleColorVar);
    }
  }
  settingsActor.send({ type: 'SET', path, value });
};

export const resetSetting = (path?: Path<Settings>): void => {
  if (path === undefined || path === 'chatTheme' || path === 'chatTheme.bubbleColorVar') {
    writeStoredChatBubblePreference(DEFAULT_CHAT_BUBBLE_COLOR_VAR);
  }
  if (path === undefined) {
    settingsActor.send({ type: 'RESET' });
  } else {
    settingsActor.send({ type: 'RESET', path });
  }
};
