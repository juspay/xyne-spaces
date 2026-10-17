import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserProfile } from '@/src/features/dms/components/dms-header';

export function ChannelsHeader(): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingTop: insets.top }}
      className='flex-row items-center justify-between px-4 py-3 bg-spaces-background'
    >
      <Text className='text-[28px] font-semibold text-spaces-foreground'>Channels</Text>
      <UserProfile />
    </View>
  );
}
