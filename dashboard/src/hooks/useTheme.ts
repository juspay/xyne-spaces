import { useState, useEffect } from 'react';

export type Theme = 'classic' | 'midnight' | 'summer_breeze';

const THEME_STORAGE_KEY = 'xyne-theme';
const DEFAULT_THEME: Theme = 'classic';

export const useTheme = (): { theme: Theme; changeTheme: (newTheme: Theme) => void } => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Initialize from localStorage or use default
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      return stored ?? DEFAULT_THEME;
    }
    return DEFAULT_THEME;
  });

  useEffect(() => {
    // Apply theme to HTML element
    document.documentElement.setAttribute('data-theme', theme);
    // Persist to localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const changeTheme = (newTheme: Theme): void => {
    setTheme(newTheme);
  };

  return { theme, changeTheme };
};
