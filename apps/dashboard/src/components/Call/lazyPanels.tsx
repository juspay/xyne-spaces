import { lazy, Suspense, useState, type ReactElement, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The call's on-demand panels and dialogs, loaded only when first needed.
 *
 * They are most of the call UI's code: the thread panel and call notes bring
 * the whole chat stack (editor, message rendering and everything a message can
 * link to), the ticket dialog the ticket forms, the whiteboard Excalidraw.
 * Importing them statically made the desktop call window load nearly the whole
 * app before it could show a call. None is needed to show the call itself, and
 * preloadCallPanels() fetches them in the background once it is up, so opening
 * one is still immediate.
 */

const loadThreadMessages = (): Promise<typeof import('../Chat/ThreadPannel')> =>
  import('../Chat/ThreadPannel');
const loadCallNotesPanel = (): Promise<typeof import('./CallNotesPanel/CallNotesPanel')> =>
  import('./CallNotesPanel/CallNotesPanel');
const loadCallChatPanel = (): Promise<typeof import('./CallChatPanel/CallChatPanel')> =>
  import('./CallChatPanel/CallChatPanel');
const loadCallWhiteboardView = (): Promise<typeof import('./CallWhiteboard/CallWhiteboardView')> =>
  import('./CallWhiteboard/CallWhiteboardView');
const loadPresentationModeOverlay = (): Promise<
  typeof import('./PresentationMode/PresentationModeOverlay')
> => import('./PresentationMode/PresentationModeOverlay');
const loadAIInviteDialog = (): Promise<typeof import('./CallModals/AIInviteDialog')> =>
  import('./CallModals/AIInviteDialog');
const loadCreateTicketModal = (): Promise<
  typeof import('../Tickets/CreateTicketModal/CreateTicketModal')
> => import('../Tickets/CreateTicketModal/CreateTicketModal');

export const LazyThreadMessages = lazy(loadThreadMessages);
export const LazyCallNotesPanel = lazy(() =>
  loadCallNotesPanel().then(m => ({ default: m.CallNotesPanel })),
);
export const LazyCallChatPanel = lazy(() =>
  loadCallChatPanel().then(m => ({ default: m.CallChatPanel })),
);
export const LazyCallWhiteboardView = lazy(() =>
  loadCallWhiteboardView().then(m => ({ default: m.CallWhiteboardView })),
);
export const LazyPresentationModeOverlay = lazy(() =>
  loadPresentationModeOverlay().then(m => ({ default: m.PresentationModeOverlay })),
);
export const LazyAIInviteDialog = lazy(() =>
  loadAIInviteDialog().then(m => ({ default: m.AIInviteDialog })),
);
export const LazyCreateTicketModal = lazy(() =>
  loadCreateTicketModal().then(m => ({ default: m.CreateTicketModal })),
);

let preloaded = false;

/**
 * Fetch every panel in the background, once per page. Called when a call
 * connects; waits for the browser to be idle so it never competes with
 * showing the call.
 */
export const preloadCallPanels = (): void => {
  if (preloaded) return;
  preloaded = true;
  const load = (): void => {
    for (const loadPanel of [
      loadCallChatPanel,
      loadThreadMessages,
      loadCallNotesPanel,
      loadCallWhiteboardView,
      loadPresentationModeOverlay,
      loadAIInviteDialog,
      loadCreateTicketModal,
    ]) {
      // Only a warm-up: the panel loads itself when opened either way.
      void loadPanel().catch(() => undefined);
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1000);
  }
};

/** Shown in a side panel while its code loads (normally already preloaded). */
export function PanelLoading(): ReactElement {
  return (
    <div className='flex h-full w-full items-center justify-center'>
      <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
    </div>
  );
}

/**
 * For a dialog or overlay that animates on its own `isOpen`: mounted from the
 * first time it opens and kept mounted after, so its close animation still
 * plays, but never loaded for a call where it is not used.
 */
export function MountOnceOpen({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}): ReactElement | null {
  const [hasOpened, setHasOpened] = useState(open);
  if (open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}
