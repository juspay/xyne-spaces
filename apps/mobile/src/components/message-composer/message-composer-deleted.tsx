import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const Deleted = memo((): ReactElement | null => {
  const { kind } = useMessageComposer();

  if (kind !== 'DELETED') return null;

  return (
    <DebugBoundary>
      <Text className='text-sm italic text-secondary-foreground'>This message was deleted</Text>
    </DebugBoundary>
  );
});
Deleted.displayName = 'MessageComposer.Deleted';

export { Deleted };
