import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

export function GlobalSearchScreen(): ReactElement {
  return (
    <View className='flex-1 items-center justify-center bg-spaces-background'>
      <Text className='text-[20px] font-bold text-spaces-foreground'>Global Search</Text>
    </View>
  );
}
