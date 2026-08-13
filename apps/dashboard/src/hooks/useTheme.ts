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

const readStoredTheme = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
};

const clearStoredTheme = (): void => {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};

export const useTheme = (): { theme: Theme; changeTheme: (newTheme: Theme) => void } => {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const storedTheme = readStoredTheme();

      if (window.electronAPI?.getTheme) {
        const electronTheme = window.electronAPI.getTheme(storedTheme ?? undefined);
        clearStoredTheme();
        return electronTheme;
      }

      // Browser-panel webviews use the URL because they have separate storage.
      const urlTheme = readThemeFromUrl();
      if (urlTheme) return urlTheme;
      if (isValidTheme(storedTheme)) return storedTheme;
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
    document.documentElement.setAttribute('data-theme', theme);
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(theme);
      return;
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const changeTheme = (newTheme: Theme): void => {
    setTheme(newTheme);
  };

  return { theme, changeTheme };
};
