import { useShortcutById } from '../shortcuts';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import type { RefObject } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { roomActor } from '../machines/roomMachine';

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
  const { channelId, conversationId } = useParams<{
    channelId?: string;
    conversationId?: string;
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
