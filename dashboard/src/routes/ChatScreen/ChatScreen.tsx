import { ReactElement, useEffect, useRef, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import ChatDirectory from '../../components/Chat/ChatDirectory/ChatDirectory';
import ConversationPrefetcher from '../../components/Chat/ConversationPrefetcher';
import MobileChatDirectory from '../../components/Chat/ChatDirectory/MobileChatDirectory';
import { usePlatform } from '../../hooks/usePlatform';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { useUserChannelStatuses } from '../../hooks/useChannels';
import { TypingStateProvider } from '../../contexts/TypingStateContext';
import { cn } from '../../utils/classNames';
import { usePath } from '../../hooks/usePath';

interface ChatScreenProps {
  shouldStackThread?: boolean;
}

const ChatScreen = ({ shouldStackThread = false }: ChatScreenProps): ReactElement => {
  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();
  const channelData = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const pathnameWithoutWorkspace = usePath();

  const isFullScreenPage =
    pathnameWithoutWorkspace === '/chat/activity' ||
    pathnameWithoutWorkspace.startsWith('/chat/activity/') ||
    pathnameWithoutWorkspace === '/chat/my-tickets' ||
    pathnameWithoutWorkspace === '/chat/threads' ||
    pathnameWithoutWorkspace === '/chat/bookmarks' ||
    pathnameWithoutWorkspace.startsWith('/chat/bookmarks/') ||
    (pathnameWithoutWorkspace.startsWith('/chat/canvas') &&
      !pathnameWithoutWorkspace.startsWith('/chat/dir/canvas')) ||
    pathnameWithoutWorkspace.startsWith('/chat/dm');
  const { isWideScreen, containerRef } = useResizablePanel({ isMobile });
  const chatSidebarPanelRef = useRef<ImperativePanelHandle>(null);

  // Listen for resize events from global shortcuts
  const handleResizeEvent = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<{ delta: number }>;
    if (chatSidebarPanelRef.current) {
      const currentSize = chatSidebarPanelRef.current.getSize();
      const newSize = Math.min(30, Math.max(15, currentSize + customEvent.detail.delta));
      chatSidebarPanelRef.current.resize(newSize);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('chat-resize-left-panel', handleResizeEvent);
    return () => {
      window.removeEventListener('chat-resize-left-panel', handleResizeEvent);
    };
  }, [handleResizeEvent]);

  // For full-screen pages — and when rendered inside the browser-panel
  // webview, where we skip the ChatDirectory column for the same reason the
  // outer AppRoot chrome is skipped — render only the conversation view.
  // Drop the rounded corners + shadow in the panel so content stretches
  // edge-to-edge.
  if (isFullScreenPage || isInPanelWebview) {
    return (
      <main
        className={cn(
          'h-full relative overflow-hidden',
          !isInPanelWebview && 'md:rounded-2xl shadow-md',
        )}
      >
        <Outlet />
      </main>
    );
  }

  return (
    <TypingStateProvider>
      <ConversationPrefetcher />
      <div
        ref={containerRef}
        className='h-full relative md:rounded-2xl overflow-hidden shadow-md'
        data-component='ChatScreen'
      >
        {isWideScreen ? (
          <PanelGroup
            direction='horizontal'
            className='flex align-top h-full'
            autoSaveId='chat-screen-resize'
          >
            {/* LEFT PANEL (Sidebar) - Mobile shows only on directory root, web always shows */}
            {isMobile ? (
              pathnameWithoutWorkspace === '/chat/dir' ||
              pathnameWithoutWorkspace === '/chat/dir/' ? (
                <Panel ref={chatSidebarPanelRef} defaultSize={20} minSize={15} maxSize={30}>
                  <aside className='w-full h-full'>
                    <MobileChatDirectory
                      channelData={channelData}
                      allChannelsUserStatus={allChannelsUserStatus}
                    />
                  </aside>
                </Panel>
              ) : null
            ) : (
              <Panel ref={chatSidebarPanelRef} defaultSize={20} minSize={15} maxSize={30}>
                <aside className='w-full h-full'>
                  <ChatDirectory
                    channelData={channelData}
                    allChannelsUserStatus={allChannelsUserStatus}
                  />
                </aside>
              </Panel>
            )}

            {/* RESIZE HANDLE */}
            <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
              <div
                id='panel-resize-divider'
                className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'
              ></div>
            </PanelResizeHandle>

            {/* MIDDLE PANEL (Conversation View) */}
            <Panel defaultSize={80} minSize={30}>
              <main
                data-id='conversation-view'
                className='flex-1 h-full overflow-hidden bg-background'
              >
                <Outlet context={{ shouldStackThread }} />
              </main>
            </Panel>
          </PanelGroup>
        ) : (
          // Narrow screen: Overlay pattern
          <>
            {/* Mobile: Only show directory sidebar on directory root */}
            {isMobile ? (
              pathnameWithoutWorkspace === '/chat/dir' ||
              pathnameWithoutWorkspace === '/chat/dir/' ? (
                <aside className='h-full min-[500px]:px-4 border-r border-border w-screen'>
                  <MobileChatDirectory
                    channelData={channelData}
                    allChannelsUserStatus={allChannelsUserStatus}
                  />
                </aside>
              ) : null
            ) : (
              <aside className='h-full min-[500px]:px-4 border-r border-border w-screen'>
                <ChatDirectory
                  channelData={channelData}
                  allChannelsUserStatus={allChannelsUserStatus}
                />
              </aside>
            )}
            {/* Conversation overlay */}
            {pathnameWithoutWorkspace !== '/chat/dir' &&
              pathnameWithoutWorkspace !== '/chat/dir/' &&
              !pathnameWithoutWorkspace.startsWith('/chat/dir/my-tickets') && (
                <div className='absolute inset-0 z-50 bg-background'>
                  <main data-id='chat-screen' className='h-full overflow-hidden'>
                    <Outlet context={{ shouldStackThread }} />
                  </main>
                </div>
              )}
          </>
        )}
      </div>
    </TypingStateProvider>
  );
};

ChatScreen.displayName = 'ChatScreen';

export default ChatScreen;
