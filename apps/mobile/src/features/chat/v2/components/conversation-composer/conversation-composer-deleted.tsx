import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { DELETED_MESSAGE_PLACEHOLDER } from './utils/getConversationKind';
import { DebugBoundary } from './utils/debug-boundary';

export const DeletedMessagePlaceholderText = (): ReactElement => (
  <Text className='text-[16px] italic leading-5 text-secondary-foreground'>
    {DELETED_MESSAGE_PLACEHOLDER}
  </Text>
);

const Deleted = memo((): ReactElement => (
  <DebugBoundary>
    <View className='mb-2.5'>
      <DeletedMessagePlaceholderText />
    </View>
  </DebugBoundary>
));
Deleted.displayName = 'ConversationComposer.Deleted';

export { Deleted };
