import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DmsList } from './dms-list';
import { QuickActionsFab } from '@/src/features/quick-actions';
import { ScreenHeader } from '@/src/features/screen-header';
import { BlurTarget } from '@/src/ui/chrome-blur';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      {/* The list is what the header and the bottom bar blur; the header floats over it. */}
      <BlurTarget style={{ flex: 1 }}>
        <DmsList />
      </BlurTarget>
      <ScreenHeader title='DMs' searchTab='chats' />
      <QuickActionsFab tab='dms' />
    </View>
  );
}
