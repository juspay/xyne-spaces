import { type ReactElement } from 'react';
import { View } from 'react-native';

import { ConversationSkeleton } from '@/src/components/conversation-composer';

type ListSkeletonProps = {
  /** v2 uses 4 on channel (`OPEN_PLACEHOLDER_ROW_KEYS`) and 5 on thread. */
  count?: number;
};

/**
 * v2 open placeholder: ConversationSkeleton overlay on `bg-chat-screen`,
 * pinned to the bottom. Shown only when there are no visible rows.
 */
export function ListSkeleton({ count = 4 }: ListSkeletonProps): ReactElement {
  const keys = Array.from({ length: count }, (_, index) => `open-placeholder-${index}`);
  return (
    <View
      className='flex-1 justify-end overflow-hidden bg-chat-screen px-4'
      accessibilityLabel='Loading messages'
    >
      {keys.map(key => (
        <ConversationSkeleton key={key} />
      ))}
    </View>
  );
}
