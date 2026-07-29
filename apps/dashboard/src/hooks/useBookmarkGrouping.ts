import { useMemo } from 'react';
import { getDateKey } from '../components/Chat/utils/bookmarkUtils';

interface Bookmark {
  id: string;
  createdAt: number;
  [key: string]: unknown;
}

interface UseBookmarkGroupingResult<T extends Bookmark> {
  groupedBookmarks: Record<string, T[]>;
  sortedDateKeys: string[];
}

/**
 * Hook to group and sort bookmarks by date
 */
export const useBookmarkGrouping = <T extends Bookmark>(
  bookmarks: T[] | undefined,
): UseBookmarkGroupingResult<T> => {
  // Group bookmarks by date
  const groupedBookmarks = useMemo(() => {
    if (!bookmarks) return {};

    const groups: Record<string, T[]> = {};

    bookmarks.forEach(bookmark => {
      const dateKey = getDateKey(bookmark.createdAt);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(bookmark);
    });

    return groups;
  }, [bookmarks]);

  // Sort date keys (most recent first)
  const sortedDateKeys = useMemo(() => {
    return Object.keys(groupedBookmarks).sort((a, b) => {
      return new Date(b).getTime() - new Date(a).getTime();
    });
  }, [groupedBookmarks]);

  return { groupedBookmarks, sortedDateKeys };
};
