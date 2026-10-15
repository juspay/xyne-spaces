import { memo, type ReactElement } from 'react';
import { Pin } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const Pinned = memo((): ReactElement | null => {
  const { item, kind } = useMessageComposer();
  const iconColor = useCSSVariable(
    kind === 'CURRENT_USER'
      ? '--color-conversation-composer-icon-user'
      : '--color-conversation-composer-icon-other',
  ) as string;

  const metadata = item.metadata as Record<string, unknown> | null | undefined;
  const isPinned = metadata?.['pinned'] === true;
  if (!isPinned) return null;

  return (
    <DebugBoundary>
      <Pin size={12} color={iconColor} fill={iconColor} />
    </DebugBoundary>
  );
});
Pinned.displayName = 'MessageComposer.Pinned';

export { Pinned };
