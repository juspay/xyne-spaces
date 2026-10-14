import { observable } from '@legendapp/state';
import { syncObservable } from '@legendapp/state/sync';
import { Appearance } from 'react-native';

import {
  DEFAULT_THEME_ID,
  resolveTheme,
  type Theme,
  type ThemeId,
  type ThemeMode,
} from '../tokens/palettes';
import { persistedToUi } from './persistence';

/** `system` tracks the OS; the other two pin it regardless of the OS. */
export type ModePreference = ThemeMode | 'system';

const STORAGE_KEY = '@lotus_appearance_v1';

function systemScheme(): ThemeMode {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/**
 * The theme, as one observable tree.
 *
 * Two inputs and three computeds. `preference` is what the user and the
 * only part that persists; `systemScheme` is the live OS value;
 * everything else is derived; so no code anywhere recomputes a theme
 * or caches a stale one.
 *
 * The computeds are functions on purpose - that is how v3 expresses derived state. They are lazy, activating on first `get()`, and they re-run only when soemthing they read actually changes. Resolved colors are never *store* here, which is what keeps this from becoming a JS theme context that re-renders the tree on every switch.
 */
export const theme$ = observable({
  preference: {
    themeId: DEFAULT_THEME_ID as ThemeId,
    mode: 'system' as ModePreference,
    /**
     * Whether the pre-Legend-Stat preference has been read across. Removable once no install can still be carryig only the old key.
     */
    migrated: false,
  },

  systemScheme: systemScheme(),

  /** The mode actually in effect, with `system` already resolved */
  mode: (): ThemeMode => {
    const preferred = theme$.preference.mode.get();
    return preferred === 'system' ? theme$.systemScheme.get() : preferred;
  },

  /** The theme on screen. The writer reads this; so can any JS consumer. */
  active: (): Theme => resolveTheme(theme$.preference.themeId.get(), theme$.mode.get()),

  isDark: (): boolean => theme$.mode.get() === 'dark',
});

/** Persists the preference sub-node only — not the OS input, not the computeds. */
syncObservable(theme$.preference, persistedToUi({ persist: { name: STORAGE_KEY } }));

export function setThemeMode(mode: ModePreference): void {
  theme$.preference.mode.set(mode);
}

export function setThemeId(themeId: ThemeId): void {
  theme$.preference.themeId.set(themeId);
}
