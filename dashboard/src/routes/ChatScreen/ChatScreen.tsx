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
  const { isWideScreen: measuredWideScreen, containerRef } = useResizablePanel({ isMobile });
  // On desktop, always treat as wide-screen regardless of the measured container
  // width. Without this, when the browser panel opens and the left panel shrinks
  // to 65 %, the measurement can briefly dip below the 700 px threshold and flip
  // isWideScreen false → triggering a second remount of ConversationPanelV2 /
  // ChatListV3 and losing scroll position a second time.
  const isWideScreen = !isMobile || measuredWideScreen;
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

  // Collapse (don't unmount) the sidebar on full-screen pages — keeps rows mounted.
  useEffect(() => {
    const panel = chatSidebarPanelRef.current;
    if (!panel) return;
    if (isFullScreenPage) {
      if (!panel.isCollapsed()) panel.collapse();
    } else if (panel.isCollapsed()) {
      panel.expand();
    }
  }, [isFullScreenPage]);

  // Browser-panel webview: skip the sidebar + chrome, render only the conversation.
  if (isInPanelWebview) {
    return (
      <main className='h-full relative overflow-hidden'>
        <Outlet />
      </main>
    );
  }

  // Full-screen pages render the full layout with the sidebar collapsed (see effect
  // above) rather than unmounting it. The sidebar is persistent chrome — Slack,
  // Discord, Linear all keep it mounted and just show/hide. Unmounting 500 rows on
  // every dir↔dm trip was the leak; keep-alive trades a flat higher baseline for it.

  return (
    <TypingStateProvider>
      <ConversationPrefetcher />
      <div
        ref={containerRef}
        className='h-full relative overflow-hidden'
        data-component='ChatScreen'
      >
        {isWideScreen ? (
          <PanelGroup
            direction='horizontal'
            className='flex align-top h-full'
            autoSaveId='chat-screen-resize'
          >
            {/* Sidebar — mobile shows only on directory root, desktop always (collapsed on full-screen) */}
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
              <Panel
                ref={chatSidebarPanelRef}
                defaultSize={20}
                minSize={15}
                maxSize={30}
                collapsible
                collapsedSize={0}
              >
                <aside className='w-full h-full'>
                  <ChatDirectory
                    channelData={channelData}
                    allChannelsUserStatus={allChannelsUserStatus}
                  />
                </aside>
              </Panel>
            )}

            {/* RESIZE HANDLE — hidden on full-screen pages where the sidebar is collapsed */}
            <PanelResizeHandle
              className={cn(
                'w-[2px] transition-colors cursor-col-resize flex items-center justify-center group',
                isFullScreenPage && 'hidden',
              )}
            >
              <div
                id='panel-resize-divider'
                className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'
              ></div>
            </PanelResizeHandle>

            <Panel defaultSize={80} minSize={30}>
              <main
                data-id='conversation-view'
                className={cn(
                  'flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl',
                  // DM + Bookmarks + Canvas routes render their own transparent left
                  // sidebar + an opaque detail panel; keep this wrapper transparent so
                  // the wallpaper shows through those sidebars.
                  !pathnameWithoutWorkspace.startsWith('/chat/dm') &&
                    !pathnameWithoutWorkspace.startsWith('/chat/bookmarks') &&
                    !pathnameWithoutWorkspace.startsWith('/chat/canvas') &&
                    'border border-border bg-background',
                )}
              >
                <div className='flex-1 overflow-hidden relative'>
                  <Outlet context={{ shouldStackThread }} />
                </div>
              </main>
            </Panel>
          </PanelGroup>
        ) : (
          // Narrow screen: overlay pattern
          <>
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
            {pathnameWithoutWorkspace !== '/chat/dir' &&
              pathnameWithoutWorkspace !== '/chat/dir/' &&
              !pathnameWithoutWorkspace.startsWith('/chat/dir/my-tickets') && (
                <div className='absolute inset-0 z-40 bg-background'>
                  <main
                    data-id='chat-screen'
                    className='h-full overflow-hidden flex flex-col relative'
                  >
                    <div className='flex-1 overflow-hidden relative'>
                      <Outlet context={{ shouldStackThread }} />
                    </div>
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
