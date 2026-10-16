import { memo, type ReactElement } from 'react';
import { Bookmark } from 'lucide-react-native';
import { BookmarkEntityType } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import { DebugBoundary } from './utils/debug-boundary';

const Bookmarked = memo((): ReactElement | null => {
  const { summary, item, kind } = useConversationComposer();
  const iconColor = useCSSVariable(
    kind === 'CURRENT_USER'
      ? '--color-conversation-composer-icon-user'
      : '--color-conversation-composer-icon-other',
  ) as string;
  const { isEntityBookmarked } = useUserBookmarks();

  const messageId = summary?.messageId ?? item.initialMessageId ?? '';
  if (!messageId) return null;
  if (!isEntityBookmarked(messageId, BookmarkEntityType.MESSAGE)) return null;

  return (
    <DebugBoundary>
      <Bookmark size={12} color={iconColor} fill={iconColor} />
    </DebugBoundary>
  );
});
Bookmarked.displayName = 'ConversationComposer.Bookmarked';

export { Bookmarked };
