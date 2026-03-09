import { ReactElement } from 'react';
import { Bookmark } from 'lucide-react';
import { BookmarkEntityType } from '@xyne/shared';
import { formatDateHeader } from '../utils/bookmarkUtils';
import { useBookmarkGrouping } from '../../../hooks/useBookmarkGrouping';
import { BookmarkItem } from '../BookmarkItem/BookmarkItem';
import { useUserBookmarks } from '../../../hooks/useUserBookmarks';

interface ChannelBookmarksListProps {
  channelId: string;
}

const ChannelBookmarksList = ({ channelId }: ChannelBookmarksListProps): ReactElement => {
  const { bookmarks } = useUserBookmarks();

  // Filter bookmarks to only show messages (channel filtering happens in BookmarkItem component)
  const channelMessageBookmarks = bookmarks?.filter(bookmark => {
    return bookmark.entityType === BookmarkEntityType.MESSAGE;
  });

  // Use shared hook for grouping and sorting
  const { groupedBookmarks, sortedDateKeys } = useBookmarkGrouping(channelMessageBookmarks);

  return (
    <div className='flex-1 h-full flex flex-col overflow-hidden bg-background'>
      {/* Bookmarks List */}
      <div className='flex-1 overflow-y-auto'>
        {!channelMessageBookmarks || channelMessageBookmarks.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
            <Bookmark className='text-muted-foreground/50 mb-4' size={48} />
            <p className='text-muted-foreground text-lg font-medium mb-2'>
              No bookmarks in this channel yet
            </p>
            <p className='text-muted-foreground text-sm max-w-md'>
              Save messages for later by clicking the bookmark icon when you hover over a message
            </p>
          </div>
        ) : (
          <div>
            {sortedDateKeys.map(dateKey => (
              <div key={dateKey}>
                {/* Date Header */}
                <div className='sticky top-0 bg-background px-4 py-2 border-b border-border z-10'>
                  <h3
                    className='text-xs font-medium text-[#788187] leading-[100%]'
                    style={{ fontFamily: 'Geist Mono' }}
                  >
                    {formatDateHeader(new Date(dateKey).getTime())}
                  </h3>
                </div>

                {/* Bookmarks for this date */}
                <div className='divide-y divide-border'>
                  {groupedBookmarks[dateKey]?.map(bookmark => (
                    <BookmarkItem
                      key={bookmark.id}
                      bookmarkId={bookmark.id}
                      entityId={bookmark.entityId}
                      entityType={bookmark.entityType}
                      createdAt={bookmark.createdAt}
                      channelId={channelId}
                      bookmarkMetadata={bookmark.metadata}
                      showChannelName={false}
                      enableSnooze={true}
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
};

export default ChannelBookmarksList;
