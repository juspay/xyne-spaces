import { ReactElement, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Bookmark, ArrowLeft } from 'lucide-react';
import { useBookmarkGrouping } from '../../../hooks/useBookmarkGrouping';
import { BookmarkItem } from '../BookmarkItem/BookmarkItem';
import { useUserBookmarks } from '../../../hooks/useUserBookmarks';
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

  const { bookmarks } = useUserBookmarks();

  // Use shared hook for grouping and sorting
  const { groupedBookmarks, sortedDateKeys } = useBookmarkGrouping(bookmarks || []);

  // Render the left panel content (exact same UI)
  const renderLeftPanel = (): ReactElement => (
    <div className='flex-1 h-full flex flex-col rounded-lg overflow-hidden bg-white'>
      {/* Header */}
      <div className='relative p-4 bg-white'>
        <div className='flex items-center gap-2'>
          {/* Back Button */}
          <Link
            to='/chat/dir'
            className='p-1 rounded-md text-gray-900 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
            aria-label='Go back'
          >
            <ArrowLeft size={20} />
          </Link>

          <h3 className='font-semibold text-gray-900'>Bookmarks</h3>
        </div>
      </div>

      {/* Bookmarks List */}
      <div className='flex-1 overflow-y-auto'>
        {!bookmarks || bookmarks.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
            <Bookmark className='text-gray-300 mb-4' size={48} />
            <p className='text-gray-500 text-lg font-medium mb-2'>No bookmarks yet</p>
            <p className='text-gray-400 text-sm max-w-md'>
              Save messages for later by clicking the bookmark icon when you hover over a message
            </p>
          </div>
        ) : (
          <div>
            {sortedDateKeys.map(dateKey => (
              <div key={dateKey}>
                {/* Bookmarks for this date */}
                <div>
                  {groupedBookmarks[dateKey]?.map(bookmark => (
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Mobile view - show bookmarks list on index route, detail view otherwise
  if (isMobile) {
    // If on a specific bookmark route, render the outlet for detail view with white background
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-white text-gray-900 overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show bookmarks list on index route
    return renderLeftPanel();
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'>
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
          <div className='flex-1 flex flex-col bg-white relative h-full'>
            <div className='flex-1 h-full overflow-hidden flex items-center justify-center'>
              {isOnIndexRoute ? (
                <div className='flex flex-col items-center justify-center p-8 text-center'>
                  <Bookmark className='text-gray-300 mb-4' size={64} />
                  <h3 className='text-xl font-medium text-gray-900 mb-2'>Select a bookmark</h3>
                  <p className='text-gray-500 max-w-md'>
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
