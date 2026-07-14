import { useEffect, useMemo, useState } from 'react';
import { BookmarkEntityType } from '@xyne/shared';

import { useUserBookmarks } from './useUserBookmarks';
import {
  getReminderFromMetadata,
  isBookmarkMarkedDone,
} from '../components/Chat/utils/bookmarkUtils';

// setTimeout coerces delays above this to 1ms, which would spin the timer.
const MAX_TIMEOUT_MS = 2_147_483_000;

/**
 * Count of bookmarks whose reminder is due but which the user hasn't acted on.
 *
 * Acting on a reminder always clears it from this count: marking done sets
 * isCompleted, removing the reminder drops metadata.reminder, and un-bookmarking
 * sets isDeleted (already excluded by the userBookmarks query).
 */
export const useOverdueRemindersCount = (): number => {
  const { bookmarks } = useUserBookmarks();
  const [now, setNow] = useState(() => Date.now());

  // Due timestamps of bookmarks still awaiting action, ascending.
  const pendingReminderTimes = useMemo(() => {
    return bookmarks
      .filter(bookmark => {
        if (bookmark.entityType !== BookmarkEntityType.MESSAGE) return false;
        if (bookmark.isCompleted) return false;
        if (isBookmarkMarkedDone(bookmark.metadata)) return false;
        return true;
      })
      .map(bookmark => getReminderFromMetadata(bookmark.metadata)?.remindAt)
      .map(remindAt => (remindAt ? new Date(remindAt).getTime() : Number.NaN))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }, [bookmarks]);

  const overdueCount = useMemo(
    () => pendingReminderTimes.filter(remindAtTs => remindAtTs <= now).length,
    [pendingReminderTimes, now],
  );

  // Nothing in the data changes when a reminder comes due, so wake up on the
  // next due timestamp rather than polling.
  useEffect(() => {
    const nextDueAt = pendingReminderTimes.find(remindAtTs => remindAtTs > now);
    if (nextDueAt === undefined) {
      return;
    }

    const delay = Math.min(Math.max(nextDueAt - Date.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);

    return (): void => clearTimeout(timer);
  }, [pendingReminderTimes, now]);

  return overdueCount;
};
