/**
 * Tells cards deep in the transcript that the app is already on screen in the
 * right-hand pane — and lets them drive which version it shows.
 *
 * Without this, App Creation mode runs the same app TWICE: the pane and every
 * inline card each mount their own Sandpack iframe, their own `useXyneData`
 * bridge and their own agent bridge. That means duplicate queries, duplicate
 * live streams, and — worst — writes firing from whichever copy the user
 * happened to click. A context rather than prop drilling because
 * `MessageReactArtifacts` sits many levels below `AIScreen`, and threading this
 * through `AIChatThread` would put it in the dependency arrays of components
 * that must not re-render for it.
 */

import { createContext, useContext } from 'react';

export interface AppCreationModeSignal {
  /** True while the split-view pane is rendering this thread's app. */
  active: boolean;
  /** The app the pane is showing; cards for THIS app become references. */
  appId: string | null;
  /** The build currently in the pane, so a card can show itself as selected. */
  viewingVersionId: string | null;
  /** Point the pane at a version. A VIEW, not a restore — head does not move. */
  viewVersion: (versionId: string | null) => void;
}

const AppCreationModeContext = createContext<AppCreationModeSignal>({
  active: false,
  appId: null,
  viewingVersionId: null,
  viewVersion: () => undefined,
});

export const AppCreationModeProvider = AppCreationModeContext.Provider;

export function useAppCreationModeSignal(): AppCreationModeSignal {
  return useContext(AppCreationModeContext);
}

/** Whether this card should become a reference instead of running its own copy. */
export function useIsShownInPane(cardAppId: string | undefined): boolean {
  const { active, appId } = useContext(AppCreationModeContext);
  return active && Boolean(cardAppId) && cardAppId === appId;
}
