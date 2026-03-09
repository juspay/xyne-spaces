import { ReactElement, useEffect, useRef, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ChatDirectory from '../../components/Chat/ChatDirectory/ChatDirectory';
import MobileChatDirectory from '../../components/Chat/ChatDirectory/MobileChatDirectory';
import { usePlatform } from '../../hooks/usePlatform';
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

interface ChatScreenProps {
  shouldStackThread?: boolean;
}

const ChatScreen = ({ shouldStackThread = false }: ChatScreenProps): ReactElement => {
  const { isMobile } = usePlatform();
  const channelData = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const location = useLocation();
  // Full-screen pages (no directory sidebar)
  // Note: /chat/dm and /chat/dm/* show DmsPage (which has its own sidebar), not ChatDirectory
  // /chat/bookmarks/* shows BookmarksPage with its own sidebar
  // /chat/activity/* shows ActivityListView with its own sidebar
  const isFullScreenPage =
    location.pathname === '/chat/activity' ||
    location.pathname.startsWith('/chat/activity/') ||
    location.pathname === '/chat/my-tickets' ||
    location.pathname === '/chat/threads' ||
    location.pathname === '/chat/bookmarks' ||
    location.pathname.startsWith('/chat/bookmarks/') ||
    (location.pathname.startsWith('/chat/canvas') &&
      !location.pathname.startsWith('/chat/dir/canvas')) ||
    location.pathname.startsWith('/chat/dm');
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

  // For full-screen pages, we don't need the directory sidebar
  if (isFullScreenPage) {
    return (
      <main
        className={cn(
          'h-full relative md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)]',
          isMobile ? 'border-none' : 'border-root-border border',
        )}
      >
        <Outlet />
      </main>
    );
  }

  return (
    <TypingStateProvider>
      <div
        ref={containerRef}
        className='h-full relative md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'
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
              location.pathname === '/chat/dir' || location.pathname === '/chat/dir/' ? (
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
              location.pathname === '/chat/dir' || location.pathname === '/chat/dir/' ? (
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
            {location.pathname !== '/chat/dir' &&
              location.pathname !== '/chat/dir/' &&
              !location.pathname.startsWith('/chat/dir/my-tickets') && (
                <div className='absolute inset-0 z-50 bg-background w-screen'>
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
