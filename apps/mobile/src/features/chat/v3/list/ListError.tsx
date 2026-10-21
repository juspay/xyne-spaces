import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { assertNever } from '../machine/assertNever';
import { OFFLINE_COLD_COPY } from '../machine/offlineMatrix';
import type { OpenFailure } from '../types/openFailure';

const copyFor = (failure: OpenFailure): string => {
  switch (failure.reason) {
    case 'invalid-intent':
      return 'This link is not valid.';
    case 'not-found':
      return 'This conversation could not be found.';
    case 'no-access':
      return 'You do not have access to this conversation.';
    case 'anchor-unreachable':
      return 'That message is not in this conversation.';
    case 'timeout':
      return 'Loading took too long.';
    case 'live-error':
      return 'Messages could not be loaded.';
    case 'offline-cold':
      return OFFLINE_COLD_COPY;
    default:
      return assertNever(failure);
  }
};

export function ListError({
  failure,
  onRetry,
  onOpenLatest,
}: {
  failure: OpenFailure;
  onRetry?: () => void;
  onOpenLatest?: () => void;
}): ReactElement {
  const showLatest =
    onOpenLatest &&
    (failure.reason === 'timeout' ||
      failure.reason === 'not-found' ||
      failure.reason === 'anchor-unreachable');
  return (
    <View
      className='flex-1 items-center justify-center gap-2 bg-chat-screen px-6'
      accessibilityRole='alert'
    >
      <Text className='text-center text-base font-semibold text-foreground'>
        Could not load messages
      </Text>
      <Text className='text-center text-sm text-muted'>{copyFor(failure)}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole='button'
          onPress={onRetry}
          className='mt-2 rounded-md px-4 py-2'
        >
          <Text className='text-center text-sm font-semibold text-foreground'>Try again</Text>
        </Pressable>
      ) : null}
      {showLatest ? (
        <Pressable
          accessibilityRole='button'
          onPress={onOpenLatest}
          className='rounded-md px-4 py-2'
        >
          <Text className='text-center text-sm font-semibold text-foreground'>Open latest</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
