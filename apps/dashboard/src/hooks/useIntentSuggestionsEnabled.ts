import { useSyncExternalStore } from 'react';

/**
 * User preference for on-device intent suggestions (Settings → Developer).
 *
 * Mirrors useClawDashboardVisibility: localStorage + a listener set via
 * useSyncExternalStore, so every consumer re-renders on change.
 *
 * Defaults ON. The feature is local-only — classification runs in a Web Worker
 * and surfaces as a toast, with no server call and no cost — so the failure mode
 * of it being on is a suggestion you ignore, not a bill.
 *
 * `isIntentSuggestionsEnabled()` exists because the classifier is a plain module
 * singleton, not a component, and must read the same value the toggle writes.
 * It is deliberately read at submit time so flipping the switch takes effect
 * immediately — the worker does not hot-reload, and requiring a refresh to turn
 * a preference on is how people conclude a feature is broken.
 *
 * See docs/ON_DEVICE_INTENT.md
 */
export const INTENT_SUGGESTIONS_KEY = 'xyne:intent-suggestions';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Plain reader for non-React callers. Storage can throw in locked-down contexts. */
export const isIntentSuggestionsEnabled = (): boolean => {
  try {
    return localStorage.getItem(INTENT_SUGGESTIONS_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const useIntentSuggestionsEnabled = (): {
  intentSuggestionsEnabled: boolean;
  setIntentSuggestionsEnabled: (value: boolean) => void;
} => {
  const intentSuggestionsEnabled = useSyncExternalStore(subscribe, isIntentSuggestionsEnabled);

  const setIntentSuggestionsEnabled = (value: boolean): void => {
    try {
      localStorage.setItem(INTENT_SUGGESTIONS_KEY, String(value));
    } catch {
      // Preference is best-effort; a blocked store must not break the switch.
    }
    listeners.forEach(listener => listener());
  };

  return { intentSuggestionsEnabled, setIntentSuggestionsEnabled };
};
