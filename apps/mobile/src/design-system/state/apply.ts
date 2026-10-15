import { observe } from '@legendapp/state';
import { Appearance, Platform } from 'react-native';
import { Uniwind } from 'uniwind';

import { readStoredThemePreference } from '@/src/services/themePreferenceStorage';
import type { Theme } from '../tokens/palettes';
import { theme$, type ModePreference } from './store';

/** Uniwind's adaptive names. Only these two carry its `prefers-color-scheme`
 * wiring, so only these two can be handed to it as `'system'`.
 */
const ADAPTIVE_VARIANTS = new Set<string>(['light', 'dark']);

/**
 * The one place the app writes to Uniwind.
 *
 * Everything else sets `theme$.preference` and lets the observer land it, so
 * there is exactly one ordering of `setTheme` and the native chrome.
 */
function applyTheme(theme: Theme, preferred: ModePreference): void {
  const followsSystem = preferred === 'system' && ADAPTIVE_VARIANTS.has(theme.variant);

  // `'system'` is not a theme name — it tells Uniwind to track the OS itself
  // and to clear the app's native override, so the keyboard and system alerts
  // follow along. Only its adaptive names support that.
  Uniwind.setTheme(followsSystem ? 'system' : theme.variant);

  // A non-adaptive variant leaves Uniwind setting the native scheme to
  // `unspecified`, which renders a light keyboard under a dark app. The theme's
  // own mode is the honest answer, so state it. No variant reaches this today;
  // it is here so adding one needs no change to the writer.
  if (!followsSystem && !ADAPTIVE_VARIANTS.has(theme.variant) && Platform.OS !== 'web') {
    Appearance.setColorScheme(theme.mode);
  }
}

/**
 * Carries a theme chosen before this store existed.
 *
 * The legacy key is left in place: someone who installs an older build still
 * finds it.
 */
function migrateLegacyPreference(): void {
  if (theme$.preference.migrated.peek()) return;

  const legacy = readStoredThemePreference();
  if (legacy !== null) {
    theme$.preference.mode.set(legacy);
  }
  theme$.preference.migrated.set(true);
}

let dispose: (() => void) | null = null;

/**
 * Installs the writer. Call once at module scope, before the first render.
 *
 * `observe` runs its body immediately and synchronously, and MMKV reads are
 * synchronous, so the stored theme is on screen in the first frame rather than
 * one commit later — which would paint the default theme and then swap it.
 */
export function initTheme(): void {
  if (dispose !== null) return;

  migrateLegacyPreference();

  Appearance.addChangeListener(({ colorScheme }) => {
    theme$.systemScheme.set(colorScheme === 'dark' ? 'dark' : 'light');
  });

  dispose = observe(() => {
    applyTheme(theme$.active.get(), theme$.preference.mode.get());
  });
}
