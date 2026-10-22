import { z } from 'zod';
import { DEFAULT_SOUND_ID } from '@/src/notifications/soundMetadata';

import { CHAT_BUBBLE_COLOR_VARS, DEFAULT_CHAT_BUBBLE_COLOR_VAR } from '@/src/theme/chatBubbleTheme';

export const SettingsSchema = z
  .object({
    appearance: z
      .object({
        reduceMotion: z.boolean().default(false),
        // Master switch for in-app haptic feedback. Defaults on so existing
        // installs are unchanged; `deepMergeOverDefaults` in the machine's
        // hydrate() falls back to this when the key is absent from storage,
        // so no SCHEMA_VERSION bump or migrator is needed.
        haptics: z.boolean().default(true),
      })
      .prefault({}),
    chatTheme: z
      .object({
        bubbleColorVar: z.enum(CHAT_BUBBLE_COLOR_VARS).default(DEFAULT_CHAT_BUBBLE_COLOR_VAR),
      })
      .prefault({}),
    notifications: z
      .object({
        sound: z.boolean().default(true),
        soundId: z.enum(['default', 'bell', 'string']).default(DEFAULT_SOUND_ID),
        preview: z.enum(['always', 'whenLocked', 'never']).default('always'),
      })
      .prefault({}),
    developers: z
      .object({
        showConversationComposerBoundaries: z.boolean().default(false),
        showMessageComposerBoundaries: z.boolean().default(false),
      })
      .prefault({}),
  })
  .prefault({});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULTS: Settings = SettingsSchema.parse({});

export const SCHEMA_VERSION = 2;

export type Migrator = (old: unknown) => unknown;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const migrators: Record<number, Migrator> = {
  // v1 → v2: app default notification sound switched from device default → String.
  1: old => {
    if (!isPlainObject(old)) return old;
    const notifications = old['notifications'];
    if (!isPlainObject(notifications)) return old;
    if (notifications['soundId'] !== 'default') return old;
    return {
      ...old,
      notifications: { ...notifications, soundId: DEFAULT_SOUND_ID },
    };
  },
};

export interface StoredSettings {
  version: number;
  settings: Settings;
}
