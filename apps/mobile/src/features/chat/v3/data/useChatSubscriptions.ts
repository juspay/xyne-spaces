import { useMemo } from 'react';
import type { Channel, User } from '@xyne/shared';

import { useChannel } from '@/src/hooks/useChannels';
import { useUserBookmarks, type UseUserBookmarksReturn } from '@/src/hooks/useUserBookmarks';
import { useSelf } from '@/src/hooks/useUsers';

export type ChatSubscriptions = {
  channel: Channel | undefined;
  self: User | undefined;
  bookmarks: UseUserBookmarksReturn;
};

/**
 * Channel / self / bookmark lookups the rows need. Not a message window.
 * User and reaction lookups stay on the row (`useUser`, `reactions_md`).
 * Per-row `usePendingStatusByMessageId` stays on the row (failed-send chrome).
 *
 * `useUserBookmarks()` defaults to cache-only (`enabled: false`) — the
 * library's indicator path, not a live query.
 */
export const useChatSubscriptions = (channelId: string): ChatSubscriptions => {
  const channel = useChannel(channelId);
  const self = useSelf();
  const bookmarks = useUserBookmarks();
  return useMemo(() => ({ channel, self, bookmarks }), [channel, self, bookmarks]);
};
