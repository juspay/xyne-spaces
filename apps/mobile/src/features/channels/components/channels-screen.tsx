import { type ReactElement } from 'react';
import { View } from 'react-native';

import { QuickActionsFab } from '@/src/features/quick-actions';

import { ChannelActionsProvider } from '../hooks/use-channel-actions';
import { ChannelsList } from './channels-list';
import { SectionTray } from './section-tray';
import { ScreenHeader } from '@/src/features/screen-header';
import { BlurTarget } from '@/src/ui/chrome-blur';

export function ChannelsScreen(): ReactElement {
  return (
    <ChannelActionsProvider>
      <View className='flex-1 bg-spaces-background'>
        {/* The list is what the header and the bottom bar blur; the header floats over it. */}
        <BlurTarget style={{ flex: 1 }}>
          <ChannelsList />
        </BlurTarget>
        <ScreenHeader title='Channels' searchTab='channels' />
        <QuickActionsFab tab='channels' />
        <SectionTray />
      </View>
    </ChannelActionsProvider>
  );
}
