import { type ReactElement } from 'react';
import { View } from 'react-native';

import { QuickActionsFab } from '@/src/features/quick-actions';
import { BlurTarget } from '@/src/ui/chrome-blur';

import { ChannelActionsProvider } from '../hooks/use-channel-actions';
import { ChannelsHeader } from './channels-header';
import { ChannelsList } from './channels-list';
import { SectionTray } from './section-tray';

export function ChannelsScreen(): ReactElement {
  return (
    <ChannelActionsProvider>
      <View className='flex-1 bg-spaces-background'>
        {/* The list is what the header and the bottom bar blur; the header floats over it. */}
        <BlurTarget style={{ flex: 1 }}>
          <ChannelsList />
        </BlurTarget>
        <ChannelsHeader />
        <QuickActionsFab tab='channels' />
        <SectionTray />
      </View>
    </ChannelActionsProvider>
  );
}
