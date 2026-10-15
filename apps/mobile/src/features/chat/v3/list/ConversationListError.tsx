import { type ReactElement } from 'react';
import { View } from 'react-native';

import type { OpenFailure } from '../types/openFailure';
import { ListError } from './ListError';

export function ConversationListError({
  failure,
  onRetry,
  onOpenLatest,
}: {
  failure: OpenFailure;
  onRetry: () => void;
  onOpenLatest: () => void;
}): ReactElement {
  return (
    <View className='flex-1 bg-chat-screen'>
      <ListError failure={failure} onRetry={onRetry} onOpenLatest={onOpenLatest} />
    </View>
  );
}
