import { useShortcutById } from '../shortcuts';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import type { RefObject } from 'react';
import { CHAT_SIDEBAR_KEYBOARD_STEP } from '../routes/ChatScreen/chatSidebarWidth';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { roomActor } from '../machines/roomMachine';
import { browserPanelActor } from '../machines/browserPanelMachine';
import { subscribeToAppKeys } from '../components/InAppBrowser';

interface UseGlobalShortcutsProps {
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
}

/**
 * Global keyboard shortcuts for the application
 *
 * Registers shortcuts that work across the entire app:
 * - Sidebar resize ([ / ])
 * - Right sidebar toggle (⌘+/)
 * - Open activity (⌘+Shift+A)
 */
export const useGlobalShortcuts = ({ leftPanelRef }: UseGlobalShortcutsProps): void => {
  const navigate = useNavigate();
  const location = useLocation();
  const { channelId, conversationId, workspaceId } = useParams<{
    channelId?: string;
    conversationId?: string;
    workspaceId?: string;
  }>();
  const isChatOpen = useSelector(roomActor, state => state.context.isChatOpen);

  // The top-level panel is percentage-sized; the ChatScreen sidebar is pixel-pinned,
  // so each gets its own step.
  const resizeLeftPanel = useCallback(
    (percentDelta: number) => {
      if (leftPanelRef.current) {
        const { asPercentage } = leftPanelRef.current.getSize();
        const newSize = Math.min(80, Math.max(0, asPercentage + percentDelta));
        leftPanelRef.current.resize(`${newSize}%`);
        return;
      }

      // If the top-level panel isn't present (e.g., WebView closed), forward to ChatScreen panel
      window.dispatchEvent(
        new CustomEvent('chat-resize-left-panel', {
          detail: {
            pixelDelta: Math.sign(percentDelta) * CHAT_SIDEBAR_KEYBOARD_STEP,
          },
        }),
      );
    },
    [leftPanelRef],
  );

  // Open activity view
  useShortcutById('global.openActivity', () => {
    void navigate('/chat/activity');
  });

  // Open threads view
  useShortcutById('global.openThreads', () => {
    void navigate('/chat/dir/threads');
  });

  // Open preferences (dispatch the same app-wide event the settings menu uses;
  // AppSidebar owns the Preferences modal and listens for this event).
  useShortcutById('global.openPreferences', () => {
    window.dispatchEvent(new CustomEvent('xyne-open-preferences'));
  });

  // Set a status (AppSidebar owns the status modal and listens for this event).
  useShortcutById('global.setStatus', () => {
    window.dispatchEvent(new CustomEvent('xyne-open-status'));
  });

  /**
   * Shows or hides the in-app browser docked on the right. Hiding keeps its tabs and
   * their pages. Full screen, it does nothing: ⌘⇧F docks it first.
   */
  const toggleBrowser = (): void => {
    if (/\/browser(\/|$)/.test(location.pathname)) return;
    const panelState = browserPanelActor.getSnapshot().context.browserPanelState;

    if (panelState === 'open') {
      browserPanelActor.send({ type: 'CLOSE' });
    } else {
      browserPanelActor.send({ type: 'OPEN' });
    }
  };

  /** Takes the in-app browser full screen, or docks it back on the right. */
  const toggleBrowserDock = (): void => {
    if (/\/browser(\/|$)/.test(location.pathname)) {
      void navigate(-1);
      browserPanelActor.send({ type: 'OPEN' });
    } else {
      browserPanelActor.send({ type: 'CLOSE' });
      void navigate(workspaceId ? `/${workspaceId}/browser` : '/browser');
    }
  };

  useShortcutById('global.toggleBrowser', toggleBrowser);
  useShortcutById('global.toggleBrowserDock', toggleBrowserDock);

  // The same keys, pressed inside a page of a browser, which has the keyboard then.
  const browserKeysRef = useRef({ toggleBrowser, toggleBrowserDock });
  browserKeysRef.current = { toggleBrowser, toggleBrowserDock };
  useEffect(
    () =>
      subscribeToAppKeys(command => {
        if (command === 'toggleBrowser') browserKeysRef.current.toggleBrowser();
        else browserKeysRef.current.toggleBrowserDock();
      }),
    [],
  );

  // Go back in navigation history
  useShortcutById('global.goBack', () => {
    void navigate(-1);
  });

  // Go forward in navigation history
  useShortcutById('global.goForward', () => {
    void navigate(1);
  });

  // Toggle right sidebar (close thread panel if open)
  useShortcutById('global.toggleRightSidebar', () => {
    // Check if we're in a call thread panel
    if (isChatOpen) {
      roomActor.send({ type: 'TOGGLE_CHAT' });
      return;
    }

    // Check if we're in a regular chat thread panel (URL pattern: /chat/{channelId}/{conversationId})
    if (
      channelId &&
      conversationId &&
      location.pathname.includes(`/chat/dir/${channelId}/${conversationId}`)
    ) {
      void navigate(`/chat/dir/${channelId}`);
    }
  });

  // Resize left sidebar - shrink
  useShortcutById('sidebar.resizeLeft', () => {
    resizeLeftPanel(-5);
  });

  // Resize left sidebar - expand
  useShortcutById('sidebar.resizeRight', () => {
    resizeLeftPanel(5);
  });
};
