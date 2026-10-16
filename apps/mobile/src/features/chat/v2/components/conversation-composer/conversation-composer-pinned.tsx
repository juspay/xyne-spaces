import { memo, type ReactElement } from 'react';
import { Pin } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const Pinned = memo((): ReactElement | null => {
  const { item, kind } = useConversationComposer();
  const iconColor = useCSSVariable(
    kind === 'CURRENT_USER'
      ? '--color-conversation-composer-icon-user'
      : '--color-conversation-composer-icon-other',
  ) as string;

  if (!item.pinned) return null;

  return (
    <DebugBoundary>
      <Pin size={12} color={iconColor} fill={iconColor} />
    </DebugBoundary>
  );
});
Pinned.displayName = 'ConversationComposer.Pinned';

export { Pinned };
