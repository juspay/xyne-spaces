import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "xyne-theme";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

/** Read the user's saved theme, falling back to the OS color scheme when
 *  no explicit choice has been made. SSR-safe: returns "light" when
 *  `window` is unavailable. Explicit choice in localStorage always wins. */
function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.(SYSTEM_QUERY).matches ? "dark" : "light";
}

export function useTheme() {
  // Initial value follows OS color scheme when there's no stored choice.
  // Once the user clicks the toggle (in the V3 sidebar), that explicit
  // choice is persisted and used on every subsequent load.
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Live-follow OS changes when there's no stored preference. Stops as
  // soon as the user makes an explicit choice (toggle button persists to
  // localStorage). Re-running this hook in a different tab won't conflict
  // because each tab maintains its own `theme` state but reads the same
  // localStorage on first mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.localStorage.getItem(STORAGE_KEY)) return; // explicit choice overrides system
    const mq = window.matchMedia(SYSTEM_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (window.localStorage.getItem(STORAGE_KEY)) return; // user has chosen since mount
      setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
