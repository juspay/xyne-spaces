/**
 * The renderer's last chosen theme, remembered by the main process.
 *
 * The main process paints two surfaces before any dashboard code runs — the window's own
 * background colour and the boot splash in assets/loading.html — and neither can read the
 * renderer's localStorage. Without this, a midnight user watched a white window and a white
 * splash turn dark once the bundle finished loading.
 */

import Store from 'electron-store';
import log from 'electron-log/main';

const STORE_KEY = 'app.theme';

/** Themes the dashboard can be in; mirrors useTheme's Theme union. */
export type AppTheme = 'classic' | 'midnight' | 'summer_breeze';

const DEFAULT_THEME: AppTheme = 'classic';

/**
 * Ground colour per theme, matching --background in the dashboard's global.css and --boot-bg in
 * its index.html. Kept as literals because the main process has no stylesheet to read.
 */
const THEME_BACKGROUND: Record<AppTheme, string> = {
    classic: '#ffffff',
    summer_breeze: '#ffffff',
    midnight: '#1a1a1f',
};

const store = new Store();

function isAppTheme(value: unknown): value is AppTheme {
    return value === 'classic' || value === 'midnight' || value === 'summer_breeze';
}

export function getAppTheme(): AppTheme {
    try {
        const stored = store.get(STORE_KEY);
        return isAppTheme(stored) ? stored : DEFAULT_THEME;
    } catch (error) {
        log.warn('[AppTheme] Could not read stored theme:', error);
        return DEFAULT_THEME;
    }
}

/**
 * Records the renderer's theme. Accepts both the theme names and the light/dark pair the
 * renderer already sends over `app:theme-changed`, so the existing channel needs no new message.
 */
export function setAppTheme(value: unknown): void {
    const theme: AppTheme | null = isAppTheme(value)
        ? value
        : value === 'dark'
          ? 'midnight'
          : value === 'light'
            ? 'classic'
            : null;

    if (!theme) return;

    try {
        store.set(STORE_KEY, theme);
    } catch (error) {
        log.warn('[AppTheme] Could not persist theme:', error);
    }
}

/** The window background to open with, so the frame is never painted browser-default white. */
export function getAppBackgroundColor(): string {
    return THEME_BACKGROUND[getAppTheme()];
}
