import { type ReactElement } from 'react';
import { View } from 'react-native';

import { DmsHeader } from './dms-header';
import { DmsList } from './dms-list';
import { QuickActionsFab } from '@/src/features/quick-actions';
import { BlurTarget } from '@/src/ui/chrome-blur';

export function DmsScreen(): ReactElement {
  return (
    <View className='flex-1 bg-spaces-background'>
      {/* The list is what the header and the bottom bar blur; the header floats over it. */}
      <BlurTarget style={{ flex: 1 }}>
        <DmsList />
      </BlurTarget>
      <DmsHeader />
      <QuickActionsFab tab='dms' />
    </View>
  );
}
