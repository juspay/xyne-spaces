import { useMemo, useCallback } from 'react';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '@/src/zero/queries';
import { isActiveBookmark } from '@/src/features/bookmarks/bookmark-utils';
import { BookmarkEntityType } from '@xyne/shared';
import type { Bookmark } from '@xyne/shared';

export interface UseUserBookmarksReturn {
  bookmarks: readonly Bookmark[] | undefined;
  isEntityBookmarked: (entityId: string, entityType: BookmarkEntityType) => Bookmark | undefined;
  getBookmarkByEntity: (entityId: string, entityType: BookmarkEntityType) => Bookmark | undefined;
  isLoading: boolean;
}

type UseUserBookmarksOptions = {
  /** Bookmark actions can opt into the live query; indicators use cache only. */
  enabled?: boolean;
};

export const useUserBookmarks = ({
  enabled = false,
}: UseUserBookmarksOptions = {}): UseUserBookmarksReturn => {
  const bookmarksQuery = useMemo(() => queries.userBookmarks(), []);
  const [bookmarks, { type: queryType }] = useCachedQuery(bookmarksQuery, {
    enabled,
    ttl: '10m',
  });

  const isEntityBookmarked = useCallback(
    (entityId: string, entityType: BookmarkEntityType): Bookmark | undefined => {
      if (!bookmarks) return undefined;
      return bookmarks.find(
        bookmark =>
          bookmark.entityId === entityId &&
          bookmark.entityType === entityType &&
          isActiveBookmark(bookmark),
      );
    },
    [bookmarks],
  );

  const getBookmarkByEntity = useCallback(
    (entityId: string, entityType: BookmarkEntityType): Bookmark | undefined => {
      return isEntityBookmarked(entityId, entityType);
    },
    [isEntityBookmarked],
  );

  const isLoading = queryType === 'unknown';

  return useMemo(
    () => ({
      bookmarks,
      isEntityBookmarked,
      getBookmarkByEntity,
      isLoading,
    }),
    [bookmarks, isEntityBookmarked, getBookmarkByEntity, isLoading],
  );
};
