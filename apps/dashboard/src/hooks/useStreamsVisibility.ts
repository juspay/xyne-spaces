import { useSyncExternalStore } from 'react';

export const STREAMS_VISIBILITY_KEY = 'xyne:show-streams';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Whether Streams exists for this person at all.
 *
 * Opt-in, unlike `useClawDashboardVisibility` which reads `!== 'false'`: Streams
 * is new, so the absence of a stored value means off and nobody meets a surface
 * they did not ask for.
 *
 * This is the feature's single flag. `useVisibleNavigationItems` is the one source
 * both the sidebar and Preferences > Toolbar read, so gating there hides Streams
 * from the rail *and* from the toolbar settings together — off means absent, not
 * "available to switch on somewhere else".
 *
 * Once it is on, `/streams` is an ordinary nav item and the toolbar preference
 * takes over: it starts hidden (it is not in DEFAULT_TOOLBAR_PATHS) and the user
 * promotes it to the rail from Preferences > Toolbar if they want it there.
 *
 * Per browser, and `WorkspaceSelectionScreen`'s `localStorage.clear()` resets it.
 * Acceptable for a rollout gate; a settled preference would belong in
 * `user_preferences` instead.
 */
const getSnapshot = (): boolean => localStorage.getItem(STREAMS_VISIBILITY_KEY) === 'true';

export const useStreamsVisibility = (): {
  showStreams: boolean;
  setShowStreams: (value: boolean) => void;
} => {
  const showStreams = useSyncExternalStore(subscribe, getSnapshot);

  const setShowStreams = (value: boolean): void => {
    localStorage.setItem(STREAMS_VISIBILITY_KEY, String(value));
    listeners.forEach(listener => listener());
  };

  return { showStreams, setShowStreams };
};
