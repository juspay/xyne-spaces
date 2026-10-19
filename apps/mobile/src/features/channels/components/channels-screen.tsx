import { type ReactElement } from 'react';
import { View } from 'react-native';

import { QuickActionsFab } from '@/src/features/quick-actions';

import { ChannelActionsProvider } from '../hooks/use-channel-actions';
import { ChannelsList } from './channels-list';
import { SectionTray } from './section-tray';
import { ScreenHeader } from '@/src/features/screen-header';

export function ChannelsScreen(): ReactElement {
  return (
    <ChannelActionsProvider>
      <View className='flex-1 bg-spaces-background'>
        <ScreenHeader title='Channels' searchTab='channels' />
        <ChannelsList />
        <QuickActionsFab tab='channels' />
        <SectionTray />
      </View>
    </ChannelActionsProvider>
  );
}
