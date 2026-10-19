import {
  Component,
  createElement,
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { logger, Logger } from '../../utils/logger';

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

// Panels whose chunk failed to load, and how to give each a fresh try. React
// caches a lazy component's failed import for good, so a retry needs a new one.
const failedPanels = new Set<() => void>();

const retryFailedPanels = (): void => {
  for (const reset of failedPanels) reset();
  failedPanels.clear();
};

/** React.lazy, but one whose failed import can be retried (see PanelBoundary). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint as React.lazy
function lazyPanel<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T {
  const create = (): LazyExoticComponent<T> =>
    lazy(() =>
      load().catch((error: unknown) => {
        failedPanels.add(reset);
        throw error;
      }),
    );
  let Lazy = create();
  function reset(): void {
    Lazy = create();
  }
  const LazyPanel = (props: ComponentProps<T>): ReactElement => createElement(Lazy, props);
  return LazyPanel as unknown as T;
}

export const LazyThreadMessages = lazyPanel(loadThreadMessages);
export const LazyCallNotesPanel = lazyPanel(() =>
  loadCallNotesPanel().then(m => ({ default: m.CallNotesPanel })),
);
export const LazyCallChatPanel = lazyPanel(() =>
  loadCallChatPanel().then(m => ({ default: m.CallChatPanel })),
);
export const LazyCallWhiteboardView = lazyPanel(() =>
  loadCallWhiteboardView().then(m => ({ default: m.CallWhiteboardView })),
);
export const LazyPresentationModeOverlay = lazyPanel(() =>
  loadPresentationModeOverlay().then(m => ({ default: m.PresentationModeOverlay })),
);
export const LazyAIInviteDialog = lazyPanel(() =>
  loadAIInviteDialog().then(m => ({ default: m.AIInviteDialog })),
);
export const LazyCreateTicketModal = lazyPanel(() =>
  loadCreateTicketModal().then(m => ({ default: m.CreateTicketModal })),
);

/**
 * Fetch the presentation overlay now. Entering presentation goes full screen,
 * which the browser allows only during the click: if the click has to wait for
 * this chunk first, full screen is refused. Called once the button is shown.
 */
export const preloadPresentationModeOverlay = (): void => {
  void loadPresentationModeOverlay().catch(() => undefined);
};

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

interface PanelBoundaryProps {
  children: ReactNode;
  // Shown while the code loads.
  fallback: ReactNode;
  // For a dialog or overlay: no inline error, a toast instead, and a new try
  // the next time it opens (`isOpen` turns true).
  silent?: boolean;
  isOpen?: boolean;
}

/**
 * Suspense for a lazy panel, plus what to do if its code fails to load (e.g. a
 * tab opened before a deploy asks for a chunk that is gone). Without this the
 * failure reaches the app's error boundary, which replaces the whole page while
 * the call stays connected underneath.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    logger.error(Logger.Event.FRONTEND_ERROR, {
      feature: 'call-lazy-panel',
      reason: 'panel-load-failed',
      error: error instanceof Error ? error.message : String(error),
    });
    if (this.props.silent) {
      toast.error('Could not load this part of the call', {
        description: 'Check your connection and try again.',
      });
    }
  }

  override componentDidUpdate(prev: PanelBoundaryProps): void {
    if (this.state.failed && this.props.silent && !prev.isOpen && this.props.isOpen) {
      this.retry();
    }
  }

  retry = (): void => {
    retryFailedPanels();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      if (this.props.silent) return null;
      return (
        <div className='flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load this panel.</p>
          <button
            type='button'
            data-track-category='CALLS'
            data-track-name='CALL_PANEL_LOAD_RETRY'
            onClick={this.retry}
            className='rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted'
          >
            Retry
          </button>
        </div>
      );
    }
    return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}

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
  return (
    <PanelBoundary fallback={null} silent isOpen={open}>
      {children}
    </PanelBoundary>
  );
}
