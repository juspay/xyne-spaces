import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { QuickActionsFab } from '@/src/features/quick-actions';
import { PullDownSearchShell, ScreenHeader } from '@/src/features/screen-header';

import { DmsList } from './dms-list';

export function DmsScreen(): ReactElement {
  const scrollOffset = useSharedValue(0);

  return (
    <PullDownSearchShell tab='chats' scrollOffset={scrollOffset}>
      <View className='flex-1 bg-spaces-background'>
        <ScreenHeader title='DMs' searchTab='chats' />
        <DmsList scrollOffset={scrollOffset} />
        <QuickActionsFab tab='dms' />
      </View>
    </PullDownSearchShell>
  );
}
