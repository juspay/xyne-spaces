import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const Edited = memo((): ReactElement | null => {
  const { item, kind } = useMessageComposer();

  if (kind === 'DELETED' || kind === 'SYSTEM') return null;
  if (!item.edited) return null;

  return (
    <DebugBoundary>
      <Text className='text-[10px] text-secondary-foreground italic'>(edited)</Text>
    </DebugBoundary>
  );
});
Edited.displayName = 'MessageComposer.Edited';

export { Edited };
