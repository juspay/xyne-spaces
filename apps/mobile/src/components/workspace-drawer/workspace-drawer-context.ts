import { createContext, useContext } from 'react';

export type WorkspaceDrawerContextValue = {
  open: () => void;
  close: () => void;
};

export const WorkspaceDrawerContext = createContext<WorkspaceDrawerContextValue | null>(null);

/**
 * Controls for the workspace drawer, provided by `WorkspaceDrawer` around the
 * tab tree. Null outside that tree — `AppHeader` renders on a few screens the
 * drawer does not wrap, and the switcher is not among them.
 *
 * Deliberately a context rather than a module store: the open state then lives
 * and dies with the tree. A workspace switch remounts the shell via
 * `NativeShell key={workspaceSessionKey}`, so the drawer comes back closed on
 * its own, and there is no singleton to leak an open drawer across a sign-out.
 */
export function useWorkspaceDrawer(): WorkspaceDrawerContextValue | null {
  return useContext(WorkspaceDrawerContext);
}
