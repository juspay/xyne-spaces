import type { ThemeName } from 'uniwind';

import { neutral } from './primitives';
import type { RoleValues } from './roles';

export type ThemeMode = 'light' | 'dark';

type Palette = {
  /**
   * Which uniwind theme each side resolves to. Uniwind holds one flat list of theme names, so an identity and a mode together pick exactly one.
   *
   * The default identity claims `light`/`dark` deliberately: those are the only names Uniwind wires to `prefers-color-scheme`, so it follows the OS for free. A second identity needs its own names registered as `extraThemes`.
   */
  variant: Record<ThemeMode, ThemeName>;
  light: RoleValues;
  dark: RoleValues;
};

const PALETTES = {
  default: {
    variant: { light: 'light', dark: 'dark' },
    light: {
      background: neutral[50],
      foreground: neutral[900],
    },
    dark: {
      background: neutral[900],
      foreground: neutral[0],
    },
  },
} satisfies Record<string, Palette>;

export type ThemeId = keyof typeof PALETTES;

export const DEFAULT_THEME_ID: ThemeId = 'default';

export const THEME_IDS = Object.keys(PALETTES) as readonly ThemeId[];

/** A resolved theme: what is on screen, as data */
export type Theme = {
  id: ThemeId;
  /**
   * Read this for "is the UI dark right now?" - status bar style, keyboard appearance, a palette injected into a WebView. Recognising a theme by its name breaks the moment a second identity exists.
   */
  mode: ThemeMode;
  variant: ThemeName;
  roles: RoleValues;
};

/**
 * Falls back to the default identity rather than throwing.
 *
 * A stored id outlives the build that wrote it. someone who picks a palette and then installs an older build must still be able to launch.
 */
export function resolveTheme(id: ThemeId, mode: ThemeMode): Theme {
  const palette = PALETTES[id] ?? PALETTES[DEFAULT_THEME_ID];

  return {
    id,
    mode,
    variant: palette.variant[mode],
    roles: palette[mode],
  };
}

/** Every variant the design ships, for the generator and its tests. */
export function allThemes(): readonly Theme[] {
  return THEME_IDS.flatMap(id => [resolveTheme(id, 'light'), resolveTheme(id, 'dark')]);
}
