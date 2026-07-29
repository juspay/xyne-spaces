import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useMemo } from 'react';
import { BookmarkEntityType, Bookmark } from '@xyne/shared';

export const useUserBookmarks = () => {
  const bookmarksFromState = useSelector(stateMachineActor, state => state.context.bookmarks);

  const bookmarks = useMemo(() => {
    return bookmarksFromState;
  }, [bookmarksFromState]);

  const isEntityBookmarked = (entityId: string, entityType: BookmarkEntityType) => {
    return bookmarks.some(
      bookmark =>
        bookmark.entityId === entityId &&
        bookmark.entityType === entityType &&
        !bookmark.isCompleted,
    );
  };

  const getBookmarkByEntity = (
    entityId: string,
    entityType: BookmarkEntityType,
  ): Bookmark | undefined => {
    return bookmarks.find(
      bookmark =>
        bookmark.entityId === entityId &&
        bookmark.entityType === entityType &&
        !bookmark.isCompleted,
    );
  };

  return {
    bookmarks,
    isEntityBookmarked,
    getBookmarkByEntity,
  };
};
