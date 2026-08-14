import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { BookmarkEntityType, type Bookmark as BookmarkRow } from '@xyne/shared';
import { Bookmark } from 'lucide-react';
import { useShortcut } from '../../../shortcuts';
import { BookmarkItem } from '../BookmarkItem/BookmarkItem';
import { useUserBookmarks } from '../../../hooks/useUserBookmarks';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { DelayedSpinner } from '../../ui/DelayedSpinner';
import {
  getReminderFromMetadata,
  isBookmarkMarkedDone,
  upsertBookmarkCompletionMetadata,
} from '../utils/bookmarkUtils';
import { cn } from '../../../utils/classNames';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../../ui/Resizable/Resizable';
import {
  BOOKMARKS_SIDEBAR_DEFAULT_WIDTH,
  BOOKMARKS_SIDEBAR_MAX_WIDTH,
  BOOKMARKS_SIDEBAR_MIN_WIDTH,
} from './bookmarksSidebarWidth';
import { usePlatform } from '../../../hooks/usePlatform';
import AppNavigator from '../../AppNavigator/AppNavigator';

type BookmarksTab = 'all' | 'reminder' | 'complete';

const TAB_CONFIG: Array<{
  id: BookmarksTab;
  label: string;
  testId: string;
  trackName: string;
}> = [
  { id: 'all', label: 'All', testId: 'bookmarks-tab-all', trackName: 'Switch_Bookmarks_Tab_All' },
  {
    id: 'reminder',
    label: 'Reminder',
    testId: 'bookmarks-tab-reminder',
    trackName: 'Switch_Bookmarks_Tab_Reminder',
  },
  {
    id: 'complete',
    label: 'Complete',
    testId: 'bookmarks-tab-complete',
    trackName: 'Switch_Bookmarks_Tab_Complete',
  },
];

const EMPTY_STATE_TEXT: Record<BookmarksTab, { title: string; description: string }> = {
  all: {
    title: 'No bookmarks yet',
    description:
      'Save messages for later by clicking the bookmark icon when you hover over a message',
  },
  reminder: {
    title: 'No reminders yet',
    description:
      'Save messages for later by clicking the bookmark icon when you hover over a message',
  },
  complete: {
    title: 'No completed bookmarks yet',
    description: 'Marked-done bookmarks will appear here',
  },
};

const isMessageBookmark = (bookmark: BookmarkRow): boolean =>
  bookmark.entityType === BookmarkEntityType.MESSAGE;

const getReminderSortKey = (
  metadata: unknown,
  now: number,
): { bucket: number; remindAtTs: number } => {
  const reminder = getReminderFromMetadata(metadata);
  if (!reminder?.remindAt) {
    return { bucket: 2, remindAtTs: Number.POSITIVE_INFINITY };
  }

  const remindAtTs = new Date(reminder.remindAt).getTime();
  if (!Number.isFinite(remindAtTs)) {
    return { bucket: 2, remindAtTs: Number.POSITIVE_INFINITY };
  }

  return {
    bucket: remindAtTs <= now ? 0 : 1,
    remindAtTs,
  };
};

const BookmarksPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const pathWithoutWorkspace = workspaceId
    ? location.pathname.slice(`/${workspaceId}`.length)
    : location.pathname;

  const isOnIndexRoute = pathWithoutWorkspace === '/chat/bookmarks';

  const bookmarksPanelRef = useRef<PanelImperativeHandle>(null);
  const bookmarkListRef = useRef<HTMLDivElement>(null);

  const { bookmarks } = useUserBookmarks();
  // Track the underlying query's completion so an in-flight load shows a
  // loader rather than the "No bookmarks yet" empty state. Zero dedupes this
  // against the same subscription in InitialStateLoader, so it's not a 2nd fetch.
  const [, bookmarksQueryDetails] = useCachedQuery(queries.userBookmarks());
  const [optimisticCompletedBookmarks, setOptimisticCompletedBookmarks] = useState<BookmarkRow[]>(
    [],
  );
  const [activeTab, setActiveTab] = useState<BookmarksTab>('all');
  const [isCompleteTabFlashing, setIsCompleteTabFlashing] = useState(false);
  const completeTabFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerCompleteTabFlash = (): void => {
    if (activeTab === 'complete') {
      return;
    }

    setIsCompleteTabFlashing(true);

    if (completeTabFlashTimeoutRef.current) {
      clearTimeout(completeTabFlashTimeoutRef.current);
    }

    completeTabFlashTimeoutRef.current = setTimeout(() => {
      setIsCompleteTabFlashing(false);
      completeTabFlashTimeoutRef.current = null;
    }, 800);
  };

  useEffect(() => {
    return (): void => {
      if (completeTabFlashTimeoutRef.current) {
        clearTimeout(completeTabFlashTimeoutRef.current);
      }
    };
  }, []);

  const prioritizedBookmarks = useMemo(() => {
    const now = Date.now();
    const clonedBookmarks = bookmarks.filter(
      bookmark =>
        isMessageBookmark(bookmark) &&
        !bookmark.isCompleted &&
        !isBookmarkMarkedDone(bookmark.metadata),
    );

    clonedBookmarks.sort((a, b) => {
      const aPriority = getReminderSortKey(a.metadata, now);
      const bPriority = getReminderSortKey(b.metadata, now);

      if (aPriority.bucket !== bPriority.bucket) {
        return aPriority.bucket - bPriority.bucket;
      }

      if (aPriority.bucket < 2 && aPriority.remindAtTs !== bPriority.remindAtTs) {
        return aPriority.remindAtTs - bPriority.remindAtTs;
      }

      return b.createdAt - a.createdAt;
    });

    return clonedBookmarks;
  }, [bookmarks]);

  const reminderBookmarks = useMemo(() => {
    return prioritizedBookmarks.filter(bookmark => {
      return !!getReminderFromMetadata(bookmark.metadata);
    });
  }, [prioritizedBookmarks]);

  const completedBookmarks = useMemo(() => {
    const activeBookmarkEntityKeys = new Set(
      bookmarks
        .filter(bookmark => !bookmark.isCompleted && !isBookmarkMarkedDone(bookmark.metadata))
        .map(bookmark => `${bookmark.entityType}:${bookmark.entityId}`),
    );

    const mergedById = new Map<string, BookmarkRow>();

    bookmarks.filter(isMessageBookmark).forEach(bookmark => {
      if (!bookmark.isCompleted && !isBookmarkMarkedDone(bookmark.metadata)) {
        return;
      }

      mergedById.set(bookmark.id, bookmark);
    });

    optimisticCompletedBookmarks.forEach(bookmark => {
      if (!isMessageBookmark(bookmark)) {
        return;
      }

      const bookmarkEntityKey = `${bookmark.entityType}:${bookmark.entityId}`;
      if (activeBookmarkEntityKeys.has(bookmarkEntityKey)) {
        return;
      }

      if (!bookmark.isCompleted && !isBookmarkMarkedDone(bookmark.metadata)) {
        return;
      }

      if (!mergedById.has(bookmark.id)) {
        mergedById.set(bookmark.id, bookmark);
      }
    });

    return Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bookmarks, optimisticCompletedBookmarks]);

  const visibleBookmarks = useMemo(() => {
    if (activeTab === 'reminder') {
      return reminderBookmarks;
    }
    if (activeTab === 'complete') {
      return completedBookmarks;
    }
    return prioritizedBookmarks;
  }, [activeTab, completedBookmarks, prioritizedBookmarks, reminderBookmarks]);

  // j/k keyboard navigation through bookmarks list
  const bookmarkNavIdx = useRef(-1);
  const [keyboardNavEntityId, setKeyboardNavEntityId] = useState<string | null>(null);

  const navigateBookmark = useCallback(
    (delta: number) => {
      if (visibleBookmarks.length === 0) return;
      const nextIdx =
        bookmarkNavIdx.current < 0
          ? delta > 0
            ? 0
            : visibleBookmarks.length - 1
          : Math.max(0, Math.min(visibleBookmarks.length - 1, bookmarkNavIdx.current + delta));
      bookmarkNavIdx.current = nextIdx;

      const targetId = visibleBookmarks[nextIdx]?.entityId;
      if (!targetId) return;
      // Set nofocus on the target item so it navigates without focusing chat input
      setKeyboardNavEntityId(targetId);
      requestAnimationFrame(() => {
        const el = bookmarkListRef.current?.querySelector<HTMLElement>(
          `[data-testid="bookmark-item-${targetId}"]`,
        );
        if (el) {
          el.scrollIntoView({ block: 'nearest' });
          el.click();
        }
      });
    },
    [visibleBookmarks],
  );

  useShortcut('j', () => navigateBookmark(1), {
    scope: 'global',
    description: 'Next bookmark',
    category: 'Bookmarks',
    enabled: !isMobile && visibleBookmarks.length > 0,
  });
  useShortcut('k', () => navigateBookmark(-1), {
    scope: 'global',
    description: 'Previous bookmark',
    category: 'Bookmarks',
    enabled: !isMobile && visibleBookmarks.length > 0,
  });

  // Render the left panel content (exact same UI)
  const renderLeftPanel = (): ReactElement => (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden border-t border-sidebar-border-muted'>
        {/* Header */}
        <div className='relative px-4 pt-3'>
          <div className='flex items-center gap-2 mb-3 h-10'>
            <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
              Bookmarks
            </h2>
          </div>

          <div className='overflow-x-auto border-b border-border no-scrollbar -mx-4 px-4'>
            <div className='flex items-center sm:justify-start min-w-max'>
              {TAB_CONFIG.map(tab => {
                const isCompleteFlashing =
                  tab.id === 'complete' && isCompleteTabFlashing && activeTab !== 'complete';

                return (
                  <button
                    key={tab.id}
                    type='button'
                    onClick={(): void => setActiveTab(tab.id)}
                    className={cn(
                      'relative overflow-hidden px-1 py-2 flex items-center transition-colors duration-250 cursor-pointer sm:px-4 justify-start border-b-2 text-muted-foreground',
                      isCompleteFlashing
                        ? 'border-transparent bg-blue-200/70 dark:bg-blue-500/25 rounded-md'
                        : activeTab === tab.id
                          ? 'text-primary border-primary'
                          : 'text-muted-foreground border-transparent hover:text-foreground',
                    )}
                    data-testid={tab.testId}
                    data-track-category='CHAT_BOOKMARK'
                    data-track-name={tab.trackName}
                  >
                    <span className='relative z-10 text-xs sm:text-sm font-medium truncate'>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bookmarks List */}
        <div ref={bookmarkListRef} className='flex-1 overflow-y-auto no-scrollbar'>
          {bookmarksQueryDetails.type !== 'complete' && visibleBookmarks.length === 0 ? (
            <DelayedSpinner className='flex h-full items-center justify-center' />
          ) : visibleBookmarks.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <Bookmark className='text-muted-foreground mb-4' size={48} />
              <p className='text-muted-foreground text-lg font-medium mb-2'>
                {EMPTY_STATE_TEXT[activeTab].title}
              </p>
              <p className='text-muted-foreground text-sm max-w-md'>
                {EMPTY_STATE_TEXT[activeTab].description}
              </p>
            </div>
          ) : (
            <div>
              {visibleBookmarks.map(bookmark => (
                <div
                  key={bookmark.id}
                  className={cn(keyboardNavEntityId === bookmark.entityId && 'bg-accent')}
                >
                  <BookmarkItem
                    entityId={bookmark.entityId}
                    entityType={bookmark.entityType}
                    bookmarkMetadata={bookmark.metadata}
                    showChannelName={true}
                    enableReminder={!isMobile && activeTab !== 'complete'}
                    isMobile={isMobile}
                    showActions={activeTab !== 'complete'}
                    nofocus={keyboardNavEntityId === bookmark.entityId}
                    {...(activeTab === 'complete'
                      ? {}
                      : {
                          onMarkedDone: (): void => {
                            setOptimisticCompletedBookmarks(prev => {
                              const completedBookmark: BookmarkRow = {
                                ...bookmark,
                                isDeleted: false,
                                isCompleted: true,
                                updatedAt: Date.now(),
                                metadata: upsertBookmarkCompletionMetadata(
                                  bookmark.metadata,
                                ) as BookmarkRow['metadata'],
                              };
                              const withoutDuplicate = prev.filter(item => item.id !== bookmark.id);
                              return [completedBookmark, ...withoutDuplicate];
                            });
                            triggerCompleteTabFlash();
                          },
                        })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
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
    <div className='flex h-full w-full overflow-hidden'>
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='bookmarks-screen-resize'
      >
        {/* LEFT PANEL - Bookmarks List */}
        <Panel
          id='bookmarks-sidebar'
          panelRef={bookmarksPanelRef}
          defaultSize={BOOKMARKS_SIDEBAR_DEFAULT_WIDTH}
          minSize={BOOKMARKS_SIDEBAR_MIN_WIDTH}
          maxSize={BOOKMARKS_SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
        >
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'></div>
        </Separator>

        {/* RIGHT PANEL - Detail View */}
        <Panel id='bookmarks-content'>
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
      </ResizableGroup>
    </div>
  );
};

BookmarksPanel.displayName = 'BookmarksPanel';

export default BookmarksPanel;
