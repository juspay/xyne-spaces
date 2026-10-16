import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { useTray } from '@/src/ui/tray';
import { haptics } from '@/src/utils/haptics';

import { useChannelActions } from '../hooks/use-channel-actions';
import { useManagedSection } from './section-options-view';
import { BackHeader, PillButton } from './section-tray-parts';

/**
 * Confirms before deleting. The wording is the dashboard's: what happens to the
 * channels, and — because it is the thing people fear — that nobody is removed
 * from any channel.
 */
export function DeleteSectionView(): ReactElement {
  const { close, goBack } = useTray();
  const { deleteSection } = useChannelActions();
  const section = useManagedSection();

  const confirm = (): void => {
    if (section === null) return;
    void haptics.success();
    deleteSection(section.id);
    close();
  };

  return (
    <View className='px-3 pt-4 pb-3' style={{ flexShrink: 1 }}>
      <BackHeader title='Delete section' onBack={goBack} />

      <View className='px-1'>
        <Text className='pb-3 text-[20px] font-semibold text-spaces-foreground'>
          Delete this section?
        </Text>
        <Text className='pb-3 text-[15px] leading-[22px] text-spaces-foreground'>
          Any channels you added to <Text className='font-semibold'>{section?.name ?? ''}</Text>{' '}
          will move back to the Channels list.
        </Text>
        <Text className='text-[15px] leading-[22px] text-spaces-muted'>
          Don&apos;t worry — deleting this section won&apos;t remove you from any channels.
        </Text>
      </View>

      <View className='mt-5 flex-row gap-3'>
        <View className='flex-1'>
          <PillButton label='Cancel' tone='neutral' onPress={goBack} />
        </View>
        <View className='flex-1'>
          <PillButton label='Delete' onPress={confirm} />
        </View>
      </View>
    </View>
  );
}
