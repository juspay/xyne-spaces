import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const Edited = memo((): ReactElement | null => {
  const { summary, kind } = useConversationComposer();

  if (kind !== 'CURRENT_USER' && kind !== 'OTHER_USER') return null;
  if (!summary?.edited) return null;

  return (
    <DebugBoundary>
      <Text className='text-[10px] text-secondary-foreground italic'>(edited)</Text>
    </DebugBoundary>
  );
});
Edited.displayName = 'ConversationComposer.Edited';

export { Edited };
