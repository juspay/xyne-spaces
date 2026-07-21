import { useShortcutById } from '../shortcuts';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import type { RefObject } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { roomActor } from '../machines/roomMachine';
import { browserPanelActor } from '../machines/browserPanelMachine';

interface UseGlobalShortcutsProps {
  leftPanelRef: RefObject<ImperativePanelHandle | null>;
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

  const resizeLeftPanel = useCallback(
    (delta: number) => {
      if (leftPanelRef.current) {
        const currentSize = leftPanelRef.current.getSize();
        const newSize = Math.min(80, Math.max(0, currentSize + delta));
        leftPanelRef.current.resize(newSize);
        return;
      }

      // If the top-level panel isn't present (e.g., WebView closed), forward to ChatScreen panel
      window.dispatchEvent(
        new CustomEvent('chat-resize-left-panel', {
          detail: { delta },
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

  // Toggle between the main app and the in-app fullscreen browser.
  useShortcutById('global.toggleBrowser', () => {
    const onBrowser = /\/browser(\/|$)/.test(location.pathname);
    const panelState = browserPanelActor.getSnapshot().context.browserPanelState;

    if (onBrowser) {
      browserPanelActor.send({ type: 'CLOSE' });
      void navigate(-1);
    } else if (panelState === 'open') {
      browserPanelActor.send({ type: 'CLOSE' });
    } else {
      void navigate(workspaceId ? `/${workspaceId}/browser` : '/browser');
    }
  });

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
