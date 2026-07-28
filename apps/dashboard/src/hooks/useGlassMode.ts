import { useEffect, useState, useSyncExternalStore } from 'react';
import { getGlassActive, setGlassActive, subscribeGlassActive } from '../stores/glassModeStore';

/** The only dark theme; everything else renders on a light surface. */
const DARK_THEMES = new Set(['midnight']);

function readDocumentTheme(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  return document.documentElement.getAttribute('data-theme') ?? '';
}

/**
 * The live theme, read from `<html data-theme>` rather than from `useTheme()`.
 *
 * This is deliberate and load-bearing. `useTheme` is a plain hook holding local
 * `useState` — not a context and not an external store — so every call site
 * gets an INDEPENDENT copy with no cross-instance sync. When the theme is
 * changed from settings, that instance's state updates and its effect writes
 * `data-theme` + localStorage, but every other `useTheme()` instance keeps its
 * stale mount-time value forever.
 *
 * Reading the DOM attribute sidesteps that entirely: it is the one place all
 * instances converge, it is written by whichever instance made the change, and
 * observing it costs nothing. Fixing `useTheme` itself (context or external
 * store) is the more correct fix but it has 22 consumer files and is a much
 * wider blast radius than this bug warrants.
 */
function useDocumentTheme(): string {
  const [theme, setTheme] = useState(readDocumentTheme);

  useEffect(() => {
    const sync = (): void => setTheme(readDocumentTheme());
    // index.html ships `data-theme="classic"` and useTheme's effect overwrites
    // it on mount, so re-read once here to catch a change that landed between
    // this component's render and this effect.
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return (): void => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Asks the main process, once per window, whether this window carries a native
 * OS material and therefore shows the real desktop behind it, and reflects the
 * answer as `html[data-glass="on"]` so plain CSS can key off it.
 *
 * Deliberately fails closed. On the web `window.electronAPI` is undefined, on
 * older desktop builds `isGlassActive` is undefined, and on any IPC error we
 * land on `false` — all of which mean "keep the wallpaper", i.e. exactly the
 * behaviour that shipped before this feature existed.
 *
 * Also keeps the OS material's tint matched to the app theme. The material
 * derives its colour from the window's native appearance, not from CSS, so
 * without this a light theme under macOS Dark Mode gets a dark plate behind
 * light chrome (and vice versa for midnight) — which reads as dingy, greyed-out
 * sidebars sitting next to a bright content card.
 *
 * Call once, high in the tree. `useGlassActive()` is the read-only consumer.
 */
export function useGlassMode(): void {
  useEffect(() => {
    let cancelled = false;

    const probe = window.electronAPI?.isGlassActive;
    if (!probe) {
      // Web build, or a desktop build whose preload predates this API.
      setGlassActive(false);
      return;
    }

    void probe()
      .then(active => {
        if (!cancelled) {
          setGlassActive(active === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGlassActive(false);
        }
      });

    // Stay subscribed for the life of the app, not just while Preferences is
    // open: this hook owns `html[data-glass]` and the wallpaper, and both have
    // to follow the toggle immediately rather than on the next reload.
    // `setGlassActive` early-returns when the value is unchanged, so this
    // overlapping with useGlassSettings' own listener is harmless.
    const unsubscribe = window.electronAPI?.glass?.onActiveChanged(active => {
      if (!cancelled) {
        setGlassActive(active === true);
      }
    });

    return (): void => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const glassActive = useGlassActive();
  const documentTheme = useDocumentTheme();

  useEffect(() => {
    if (!glassActive) {
      return;
    }
    window.electronAPI?.setGlassAppearance?.(DARK_THEMES.has(documentTheme) ? 'dark' : 'light');
  }, [glassActive, documentTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (glassActive) {
      root.setAttribute('data-glass', 'on');
    } else {
      root.removeAttribute('data-glass');
    }
    return (): void => {
      root.removeAttribute('data-glass');
    };
  }, [glassActive]);
}

/**
 * `true` only once the main process has confirmed this window is vibrant.
 * `null` (not yet answered) reads as "not glass" for styling purposes; use
 * {@link useGlassResolved} when you need to distinguish "unknown" from "no".
 */
export function useGlassActive(): boolean {
  return useSyncExternalStore(subscribeGlassActive, getGlassActive, getGlassActive) === true;
}

/**
 * Whether the main process has answered yet. The wallpaper uses this to avoid
 * painting a full-screen photo for one frame on a window that is about to turn
 * out to be vibrant.
 */
export function useGlassResolved(): boolean {
  return useSyncExternalStore(subscribeGlassActive, getGlassActive, getGlassActive) !== null;
}
