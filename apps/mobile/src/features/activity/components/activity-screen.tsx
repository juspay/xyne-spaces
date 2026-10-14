import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

export function ActivityScreen(): ReactElement {
  return (
    <View className='flex-1 items-center justify-center bg-spaces-background'>
      <Text className='text-base font-medium text-spaces-foreground'>Activity Screen</Text>
    </View>
  );
}
