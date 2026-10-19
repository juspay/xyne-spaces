import { useCallback, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InputV2 } from '@/src/components/ui/input-v2';
import {
  SectionChannelRow,
  useFilteredPickerChannels,
  type PickerChannel,
} from './section-channel-picker';

/**
 * The channel picker both section flows share: create's second step and the
 * manage-channels sheet render this and nothing else below their header, so the
 * list owns every pixel the sheet has left.
 *
 * Selection lives with the parent — create holds it until Done, manage diffs it
 * against what is already stored — while the search text is local, since
 * neither parent has any use for it.
 */

type SectionChannelPickerStepProps = {
  channels: readonly PickerChannel[];
  selectedIds: ReadonlySet<string>;
  onToggle: (channelId: string) => void;
};

export function SectionChannelPickerStep({
  channels,
  selectedIds,
  onToggle,
}: SectionChannelPickerStepProps): ReactElement {
  const insets = useSafeAreaInsets();
  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;

  const [filter, setFilter] = useState('');
  const filteredChannels = useFilteredPickerChannels(channels, filter);

  const renderChannelRow = useCallback(
    ({ item }: { item: PickerChannel }): ReactElement => (
      <SectionChannelRow channel={item} isSelected={selectedIds.has(item.id)} onToggle={onToggle} />
    ),
    [onToggle, selectedIds],
  );

  const hasChannels = channels.length > 0;

  return (
    <View className='flex-1'>
      <View className='px-4 pt-3'>
        <InputV2
          value={filter}
          onChangeText={setFilter}
          variant='bottomsheet'
          inputClassName='text-sm'
          placeholder='Search channels'
          placeholderTextColor={placeholderColor}
          leftIconColor={placeholderColor}
          clearIconColor={placeholderColor}
          autoCapitalize='none'
          autoCorrect={false}
        />
      </View>

      <BottomSheetFlatList
        data={filteredChannels}
        keyExtractor={item => item.id}
        renderItem={renderChannelRow}
        extraData={selectedIds}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingTop: 8,
          paddingBottom: insets.bottom + 16,
        }}
        ListEmptyComponent={
          <Text className='py-10 text-center text-sm text-bottomsheet-text-muted'>
            {hasChannels ? 'No channels found' : 'No channels available'}
          </Text>
        }
      />
    </View>
  );
}
