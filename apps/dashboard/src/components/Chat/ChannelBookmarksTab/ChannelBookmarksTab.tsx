import { ReactElement, useMemo, useState } from 'react';
import { BookmarkEntityType, type Bookmark as BookmarkRow } from '@xyne/shared';
import { Bookmark } from 'lucide-react';
import { BookmarkItem } from '../BookmarkItem/BookmarkItem';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { DelayedSpinner } from '../../ui/DelayedSpinner';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import { getReminderFromMetadata, isBookmarkMarkedDone } from '../utils/bookmarkUtils';

type ChannelBookmarksFilter = 'all' | 'reminder';

const FILTERS: Array<{ id: ChannelBookmarksFilter; label: string; trackName: string }> = [
  { id: 'all', label: 'All', trackName: 'Switch_Channel_Bookmarks_All' },
  { id: 'reminder', label: 'Reminder', trackName: 'Switch_Channel_Bookmarks_Reminder' },
];

const isActiveMessageBookmark = (bookmark: BookmarkRow): boolean =>
  bookmark.entityType === BookmarkEntityType.MESSAGE &&
  !bookmark.isCompleted &&
  !isBookmarkMarkedDone(bookmark.metadata);

/** Overdue reminders first, then upcoming reminders, then newest bookmarks. */
const reminderSortKey = (metadata: unknown, now: number): [number, number] => {
  const remindAt = getReminderFromMetadata(metadata)?.remindAt;
  const ts = remindAt ? new Date(remindAt).getTime() : Number.NaN;
  if (!Number.isFinite(ts)) return [2, Number.POSITIVE_INFINITY];
  return [ts <= now ? 0 : 1, ts];
};

export const sortChannelBookmarks = (bookmarks: BookmarkRow[], now: number): BookmarkRow[] =>
  [...bookmarks].sort((a, b) => {
    const [aBucket, aTs] = reminderSortKey(a.metadata, now);
    const [bBucket, bTs] = reminderSortKey(b.metadata, now);
    if (aBucket !== bBucket) return aBucket - bBucket;
    if (aBucket < 2 && aTs !== bTs) return aTs - bTs;
    return b.createdAt - a.createdAt;
  });

interface ChannelBookmarksTabProps {
  channelId: string;
}

/**
 * The current user's own bookmarks from this channel (and its threads). Bookmarks are
 * personal: the query is row-scoped to ctx.userID by BookmarksACL, so other members
 * never see them. Rows are matched by the server-stamped `bookmarks.channelId`.
 */
const ChannelBookmarksTab = ({ channelId }: ChannelBookmarksTabProps): ReactElement => {
  const { isMobile } = usePlatform();
  const [filter, setFilter] = useState<ChannelBookmarksFilter>('all');
  const [rows, details] = useCachedQuery(queries.userChannelBookmarks({ channelId }));

  const visible = useMemo(() => {
    const active = sortChannelBookmarks(rows.filter(isActiveMessageBookmark), Date.now());
    return filter === 'reminder'
      ? active.filter(bookmark => !!getReminderFromMetadata(bookmark.metadata))
      : active;
  }, [rows, filter]);

  if (details.type !== 'complete' && rows.length === 0) {
    return (
      <DelayedSpinner className='flex flex-1 items-center justify-center bg-background py-8' />
    );
  }

  return (
    <div
      className='flex h-full flex-col overflow-hidden bg-background'
      data-testid='channel-bookmarks-tab'
    >
      <div className='flex items-center gap-1 border-b border-border px-4'>
        {FILTERS.map(item => (
          <button
            key={item.id}
            type='button'
            onClick={(): void => setFilter(item.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              filter === item.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            data-testid={`channel-bookmarks-filter-${item.id}`}
            data-track-category='CHAT_BOOKMARK'
            data-track-name={item.trackName}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className='flex flex-1 flex-col items-center justify-center p-8 text-center'>
          <Bookmark className='mb-4 text-muted-foreground' size={40} />
          <p className='mb-2 text-base font-medium text-muted-foreground'>
            {filter === 'reminder'
              ? 'No reminders in this channel'
              : 'No bookmarks in this channel yet'}
          </p>
          <p className='max-w-md text-sm text-muted-foreground'>
            Bookmark a message from its hover menu and it will show up here. Only you can see
            your bookmarks.
          </p>
        </div>
      ) : (
        <div className='flex-1 overflow-y-auto no-scrollbar'>
          {visible.map(bookmark => (
            <BookmarkItem
              key={bookmark.id}
              entityId={bookmark.entityId}
              entityType={bookmark.entityType}
              bookmarkMetadata={bookmark.metadata}
              enableReminder={!isMobile}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChannelBookmarksTab;
