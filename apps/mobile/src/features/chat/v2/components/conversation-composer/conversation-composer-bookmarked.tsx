import { memo, type ReactElement } from 'react';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import { MessageBookmarkReminderIndicator } from '@/src/features/chat/v2/components/chat/message-bookmark-reminder-indicator';

const Bookmarked = memo((): ReactElement | null => {
  const { summary, item, kind } = useConversationComposer();
  const iconColor = useCSSVariable(
    kind === 'CURRENT_USER'
      ? '--color-conversation-composer-icon-user'
      : '--color-conversation-composer-icon-other',
  ) as string;
  const messageId = summary?.messageId ?? item.initialMessageId ?? '';

  return (
    <DebugBoundary>
      <MessageBookmarkReminderIndicator messageId={messageId} iconColor={iconColor} />
    </DebugBoundary>
  );
});
Bookmarked.displayName = 'ConversationComposer.Bookmarked';

export { Bookmarked };
