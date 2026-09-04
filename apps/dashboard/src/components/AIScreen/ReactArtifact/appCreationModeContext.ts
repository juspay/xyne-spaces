/**
 * Tells cards deep in the transcript that the app is already on screen in the
 * right-hand pane — and lets them drive which version it shows, and which
 * version is current.
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
import type { ArtifactAppRestoreEvent } from '../../../services/claw/artifactAppsService';

export interface AppCreationModeSignal {
  /** True while the split-view pane is rendering this thread's app. */
  active: boolean;
  /** The app the pane is showing; cards for THIS app become references. */
  appId: string | null;
  /** The build currently in the pane, so a card can show itself as selected. */
  viewingVersionId: string | null;
  /** The build that IS the app right now — what the agent's next update builds
   *  on. A card offers Restore precisely when it is not this. */
  headVersionId: string | null;
  /** The app's icon id, so transcript cards draw the same mark as the pane. */
  icon: string | null;
  /** Recorded restores, oldest first, so the transcript can show them in place.
   *  Available whether or not the pane is open: closing a panel must not erase
   *  history from the thread. */
  restores: ArtifactAppRestoreEvent[];
  /** Point the pane at a version. A VIEW, not a restore — head does not move. */
  viewVersion: (versionId: string | null) => void;
  /** Make a version current. Durable, and recorded in the thread. */
  restoreVersion: (versionId: string) => void;
  /** True while a restore is in flight, so cards can disable themselves. */
  restoring: boolean;
  /**
   * Enter App Creation mode for a specific app, from the card that knows it.
   *
   * The card is the one component that holds the app id, the version id, and
   * the fact that a build is on screen — all at once, with no intermediate
   * state. Routing entry through it, rather than through a scan of the message
   * list that reports upward into screen state and then into a URL effect,
   * removes every link in the chain that used to make entry order-dependent.
   */
  enterForApp: (appId: string, versionId: string | null) => void;
  /**
   * Send a message into the thread this app belongs to, as if typed into its
   * composer. Returns false when the thread refused it (a reply is still
   * streaming). Null where there is no thread — the Library's app screen —
   * which is what hides "Fix with AI" there.
   */
  submitPrompt: ((text: string) => boolean) | null;
}

const AppCreationModeContext = createContext<AppCreationModeSignal>({
  active: false,
  appId: null,
  viewingVersionId: null,
  headVersionId: null,
  icon: null,
  restores: [],
  viewVersion: () => undefined,
  restoreVersion: () => undefined,
  restoring: false,
  enterForApp: () => undefined,
  submitPrompt: null,
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
