import { ReactElement, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Bookmark, ArrowLeft } from 'lucide-react';
import { BookmarkItem } from '../BookmarkItem/BookmarkItem';
import { VirtualizedList } from '../../VirtualizedList';
import { queries } from '../../../zero/queries';
import type { Bookmark as BookmarkType } from '@xyne/shared';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { usePlatform } from '../../../hooks/usePlatform';

const BookmarksPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const location = useLocation();

  const isOnIndexRoute = location.pathname === '/chat/bookmarks';

  const bookmarksPanelRef = useRef<ImperativePanelHandle>(null);

  // Render the left panel content (exact same UI)
  const renderLeftPanel = (): ReactElement => (
    <div className='flex-1 h-full flex flex-col overflow-hidden bg-background'>
      {/* Header */}
      <div className='relative p-4 bg-background'>
        <div className='flex items-center gap-2'>
          {/* Back Button */}
          {!isMobile && (
            <Link
              to='/chat/dir'
              className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
              aria-label='Go back'
              data-testid='bookmarks-go-back-link'
            >
              <ArrowLeft size={20} />
            </Link>
          )}

          <h3 className='font-semibold text-foreground'>Bookmarks</h3>
        </div>
      </div>

      {/* Bookmarks List */}
      <div className='flex-1 overflow-y-auto'>
        <VirtualizedList<BookmarkType, { id: string; createdAt: number }>
          pagination={{
            createQuery: ({ cursor }) =>
              queries.userBookmarksPaginated({
                limit: 25,
                start: cursor,
              }),
            getCursor: bookmark => ({ id: bookmark.id, createdAt: bookmark.createdAt }),
            getKey: bookmark => bookmark.id,
            mergePages: (prev, next) => {
              const map = new Map(prev.map(item => [item.id, item]));
              for (const item of next) map.set(item.id, item);
              return [...map.values()].sort(
                (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
              );
            },
            windowSize: 25,
            threshold: 10,
            resetKey: 'bookmarks',
          }}
          renderItem={bookmark => (
            <BookmarkItem
              key={bookmark.id}
              bookmarkId={bookmark.id}
              entityId={bookmark.entityId}
              entityType={bookmark.entityType}
              createdAt={bookmark.createdAt}
              bookmarkMetadata={bookmark.metadata}
              showChannelName={true}
              enableSnooze={!isMobile}
              isMobile={isMobile}
            />
          )}
          emptyState={
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <Bookmark className='text-muted-foreground mb-4' size={48} />
              <p className='text-muted-foreground text-lg font-medium mb-2'>No bookmarks yet</p>
              <p className='text-muted-foreground text-sm max-w-md'>
                Save messages for later by clicking the bookmark icon when you hover over a message
              </p>
            </div>
          }
          className='h-full'
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );

  // Mobile view - show bookmarks list on index route, detail view otherwise
  if (isMobile) {
    // If on a specific bookmark route, render the outlet for detail view with white background
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show bookmarks list on index route
    return renderLeftPanel();
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full overflow-hidden shadow-md'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='bookmarks-screen-resize'
      >
        {/* LEFT PANEL - Bookmarks List */}
        <Panel ref={bookmarksPanelRef} defaultSize={20} minSize={30} maxSize={40}>
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'></div>
        </PanelResizeHandle>

        {/* RIGHT PANEL - Detail View */}
        <Panel>
          <div className='flex-1 flex flex-col bg-background relative h-full'>
            <div className='flex-1 h-full overflow-hidden flex items-center justify-center'>
              {isOnIndexRoute ? (
                <div className='flex flex-col items-center justify-center p-8 text-center'>
                  <Bookmark className='text-muted-foreground mb-4' size={64} />
                  <h3 className='text-xl font-medium text-foreground mb-2'>Select a bookmark</h3>
                  <p className='text-muted-foreground max-w-md'>
                    Choose a bookmark from the list to view its details
                  </p>
                </div>
              ) : (
                <div className='w-full h-full'>
                  <Outlet />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

BookmarksPanel.displayName = 'BookmarksPanel';

export default BookmarksPanel;
