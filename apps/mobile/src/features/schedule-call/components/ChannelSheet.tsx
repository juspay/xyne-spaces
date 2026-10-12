import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { ChannelScopeType, ChannelType, ChannelVisibility } from '@xyne/shared';
import { Hash, Lock, Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import type { PostCallUpdatesChannel } from '../hooks/usePostCallUpdates';
import { OptionRow, Tile } from './PeopleSheet';

interface ChannelSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once the sheet has finished closing; the form unmounts it then (see the screen). */
  onClosed: () => void;
  selected: PostCallUpdatesChannel | null;
  onSelect: (channel: PostCallUpdatesChannel) => void;
}

/** Pick the one channel that call updates are posted to; tapping another one changes it. */
export const ChannelSheet = ({
  isOpen,
  onOpenChange,
  onClosed,
  selected,
  onSelect,
}: ChannelSheetProps): ReactElement => {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const { accentBg } = useBubbleAccent();
  const allChannels = useAllVisibleChannels();
  const mutedColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const iconColor = useCSSVariable('--color-settings-description') as string;
  const [query, setQuery] = useState('');

  // Real workspace channels only (no DMs, desks or email channels), public and private, as on the
  // dashboard.
  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allChannels.filter(
      c =>
        c.type === ChannelType.DEFAULT &&
        c.scopeType === ChannelScopeType.DEFAULT &&
        !c.isArchived &&
        c.name.toLowerCase().includes(q),
    );
  }, [allChannels, query]);

  const pick = useCallback(
    (channel: PostCallUpdatesChannel): void => {
      onSelect(channel);
      Keyboard.dismiss();
      sheetRef.current?.dismiss();
    },
    [onSelect],
  );

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClose={onClosed}
      mode='fullscreen'
      keyboardBehavior='extend'
      backdropOpacity={0.4}
    >
      <View className='flex-1'>
        <Text className='px-5 pb-2.5 pt-1.5 text-xl font-bold text-bottomsheet-text-header'>
          Post updates to
        </Text>
        <View className='mx-4 h-11 flex-row items-center gap-2.5 rounded-full bg-secondary px-4'>
          <Search size={17} color={mutedColor} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder='Search channels'
            placeholderTextColor={mutedColor}
            accessibilityLabel='Search channels'
            autoCapitalize='none'
            autoCorrect={false}
            spellCheck={false}
            autoComplete='off'
            returnKeyType='search'
            cursorColor={accentBg}
            selectionColor={accentBg}
            className='min-w-0 flex-1 px-0 py-0 text-base text-foreground'
          />
        </View>
        <View className='flex-1' style={{ minHeight: 0 }}>
          {channels.length === 0 ? (
            <Text className='py-8 text-center text-bottomsheet-text-muted'>No channels found</Text>
          ) : (
            // A gorhom scrollable, so the sheet can tell a list scroll from a sheet drag.
            <BottomSheetFlatList
              style={{ flex: 1 }}
              data={channels}
              keyExtractor={c => c.id}
              renderItem={({ item }) => {
                const Icon = item.visibility === ChannelVisibility.PRIVATE ? Lock : Hash;
                return (
                  <OptionRow
                    row={{
                      id: item.id,
                      title: item.name,
                      selected: item.id === selected?.id,
                      leading: (
                        <Tile>
                          <Icon size={18} color={iconColor} />
                        </Tile>
                      ),
                      onPress: () => pick({ id: item.id, name: item.name }),
                    }}
                  />
                );
              }}
              extraData={selected?.id}
              ListHeaderComponent={<View className='h-3' />}
              ListFooterComponent={<View className='h-8' />}
              keyboardShouldPersistTaps='handled'
              keyboardDismissMode='on-drag'
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </AppBottomSheet>
  );
};
