import { useValue } from '@legendapp/state/react';

import { theme$, type ModePreference } from './state/store';
import type { Theme, ThemeId, ThemeMode } from './tokens/palettes';

/**
 * `useValue`, never `use$`.
 *
 * They are the same function under two names, but React identifies hooks as
 * `use` followed by an uppercase letter or digit. `$` is neither, so React
 * Compiler — which this app enables — treats `use$(...)` as an ordinary pure
 * call and may memoize, hoist or skip it. That changes the hook count between
 * renders and throws "Should have a queue" at the next hook in the component.
 * Legend State deprecated `use$` for exactly this reason in 3.0.0-beta.20.
 *
 * For the same reason: no bare `.get()` inside a component, and no `observer` —
 * the migration guide now calls it an optional optimisation, incompatible with
 * the Compiler.
 */
export function useThemeMode(): ModePreference {
  return useValue(theme$.preference.mode);
}

export function useThemeId(): ThemeId {
  return useValue(theme$.preference.themeId);
}

/** The mode in effect, with `system` resolved. */
export function useResolvedMode(): ThemeMode {
  return useValue(theme$.mode);
}

export function useIsDark(): boolean {
  return useValue(theme$.isDark);
}

/** The whole resolved theme, for the rare consumer that needs its roles in JS. */
export function useTheme(): Theme {
  return useValue(theme$.active);
}
