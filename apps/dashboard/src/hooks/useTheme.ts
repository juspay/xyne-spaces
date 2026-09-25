import { useState, useEffect } from 'react';

export type Theme = 'classic' | 'midnight' | 'summer_breeze';

const THEME_STORAGE_KEY = 'xyne-theme';
const DEFAULT_THEME: Theme = 'classic';
const THEME_QUERY_PARAM = 'theme';
const VALID_THEMES: readonly Theme[] = ['classic', 'midnight', 'summer_breeze'];

const isValidTheme = (value: string | null): value is Theme =>
  value !== null && (VALID_THEMES as readonly string[]).includes(value);

const readThemeFromUrl = (): Theme | null => {
  if (typeof window === 'undefined') return null;
  const urlTheme = new URLSearchParams(window.location.search).get(THEME_QUERY_PARAM);
  return isValidTheme(urlTheme) ? urlTheme : null;
};

export const useTheme = (): { theme: Theme; changeTheme: (newTheme: Theme) => void } => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Prefer ?theme=… from the URL — this is how the main app hands its
    // theme off to a Xyne URL opened in the browser-panel webview (it has a
    // separate localStorage, so we can't share directly). Falls back to
    // localStorage, then to the default.
    if (typeof window !== 'undefined') {
      const urlTheme = readThemeFromUrl();
      if (urlTheme) return urlTheme;
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      if (isValidTheme(stored)) return stored;
    }
    return DEFAULT_THEME;
  });

  // Strip `?theme=` from the URL once applied, so copied / bookmarked links
  // don't carry someone else's theme preference.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has(THEME_QUERY_PARAM)) {
      url.searchParams.delete(THEME_QUERY_PARAM);
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, []);

  useEffect(() => {
    // Apply theme to HTML element
    document.documentElement.setAttribute('data-theme', theme);
    // Persist to localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.electronAPI?.ipcSend?.(
      'app:theme-changed',
      theme === 'midnight' ? 'dark' : 'light',
      theme,
    );
  }, [theme]);

  const changeTheme = (newTheme: Theme): void => {
    setTheme(newTheme);
  };

  return { theme, changeTheme };
};
