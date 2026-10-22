import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

export function ListEmpty(): ReactElement {
  return (
    <View className='flex-1 items-center justify-center gap-2 bg-chat-screen px-6'>
      <Text className='text-center text-base font-semibold text-foreground'>No messages yet</Text>
      <Text className='text-center text-sm text-muted'>
        Send the first one to start the conversation.
      </Text>
    </View>
  );
}
