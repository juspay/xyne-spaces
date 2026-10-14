import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserProfile } from '@/src/features/dms/components/dms-header';

export function ActivityHeader(): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingTop: insets.top }}
      className='flex-row items-center justify-between px-4 py-3 bg-spaces-background'
    >
      <Text className='text-[28px] font-semibold text-spaces-foreground'>Activity</Text>
      <UserProfile />
    </View>
  );
}
