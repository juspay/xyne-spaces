import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  BottomSheetFlatList,
  BottomSheetFooter,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Hash, Search } from 'lucide-react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import Avatar from '@/src/components/ui/avatar';
import { withAlpha } from '@/src/theme/accent-contrast';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import { useChannelMembers } from '../hooks/useChannelMembers';
import { OptionRow, Tile, type Row } from './PeopleSheet';

const SELECT_ALL_ID = 'select-all';

interface ChannelMembersSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once the sheet has finished closing; the form unmounts it then (see the screen). */
  onClosed: () => void;
  channel: { id: string; name: string; excludedUserIds?: string[] | undefined };
  /** Called with the ids left out when Done is tapped. Swiping the sheet away discards the draft. */
  onApply: (excludedUserIds: string[]) => void;
}

/** Who from a picked channel is invited: everyone ticked, with untick to leave someone out. */
export const ChannelMembersSheet = ({
  isOpen,
  onOpenChange,
  onClosed,
  channel,
  onApply,
}: ChannelMembersSheetProps): ReactElement => {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  const members = useChannelMembers(channel.id);
  const mutedColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const iconColor = useCSSVariable('--color-settings-description') as string;
  const sheetBackground = useCSSVariable('--color-bottomsheet-bg') as string;

  const [excluded, setExcluded] = useState(() => new Set(channel.excludedUserIds ?? []));
  const [query, setQuery] = useState('');

  const dismiss = useCallback((): void => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismiss, isOpen]);

  const toggle = useCallback((id: string): void => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const q = query.trim().toLowerCase();
  const total = members?.length ?? 0;
  const selectedCount = total - (members?.filter(m => excluded.has(m.id)).length ?? 0);

  const rows = useMemo((): Row[] => {
    if (!members) return [];
    const matching = members.filter(
      m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
    const allSelected = matching.length > 0 && matching.every(m => !excluded.has(m.id));
    const selectAll: Row = {
      id: SELECT_ALL_ID,
      title: q ? 'Select all matches' : 'Select all',
      subtitle: `${total} members`,
      selected: allSelected,
      leading: (
        <Tile>
          <Hash size={18} color={iconColor} />
        </Tile>
      ),
      onPress: () =>
        setExcluded(prev => {
          const next = new Set(prev);
          matching.forEach(m => (allSelected ? next.add(m.id) : next.delete(m.id)));
          return next;
        }),
    };
    const people = matching.map((user): Row => ({
      id: user.id,
      title: user.name,
      subtitle: user.email,
      selected: !excluded.has(user.id),
      leading: <Avatar userIds={[user.id]} size={40} />,
      onPress: () => toggle(user.id),
    }));
    return matching.length > 0 ? [selectAll, ...people] : [];
  }, [excluded, iconColor, members, q, toggle, total]);

  const handleDone = useCallback((): void => {
    if (selectedCount === 0) return;
    void haptics.buttonTap();
    onApply(members?.filter(m => excluded.has(m.id)).map(m => m.id) ?? []);
    dismiss();
  }, [dismiss, excluded, members, onApply, selectedCount]);

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps): ReactElement => (
      <BottomSheetFooter {...props}>
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} pointerEvents='box-none'>
          <View
            pointerEvents='box-none'
            className='px-4 pt-12'
            style={{ paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 12) : 12 }}
          >
            <LinearGradient
              colors={[withAlpha(sheetBackground, 0), sheetBackground]}
              locations={[0, 0.6]}
              pointerEvents='none'
              style={StyleSheet.absoluteFill}
            />
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Done'
              accessibilityState={{ disabled: selectedCount === 0 }}
              onPress={handleDone}
              className='h-12 items-center justify-center rounded-full active:opacity-80'
              style={{ backgroundColor: accentBg, opacity: selectedCount === 0 ? 0.45 : 1 }}
            >
              <Text className='text-base font-semibold' style={{ color: accentFg }}>
                {members === null
                  ? 'Loading…'
                  : selectedCount === 0
                    ? 'Pick at least one'
                    : `Done · ${selectedCount} of ${total}`}
              </Text>
            </Pressable>
          </View>
        </KeyboardStickyView>
      </BottomSheetFooter>
    ),
    [accentBg, accentFg, handleDone, insets.bottom, members, selectedCount, sheetBackground, total],
  );

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClose={onClosed}
      mode='fullscreen'
      footerComponent={renderFooter}
      keyboardBehavior='extend'
      backdropOpacity={0.4}
    >
      <View className='flex-1'>
        <Text
          className='px-5 pb-2.5 pt-1.5 text-xl font-bold text-bottomsheet-text-header'
          numberOfLines={1}
        >
          #{channel.name}
        </Text>

        <View className='mx-4 h-11 flex-row items-center gap-2.5 rounded-full bg-secondary px-4'>
          <Search size={17} color={mutedColor} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder='Search members'
            placeholderTextColor={mutedColor}
            accessibilityLabel='Search members'
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

        <View className='flex-1 pt-3' style={{ minHeight: 0 }}>
          {members === null ? (
            <Text className='py-8 text-center text-bottomsheet-text-muted'>Loading members…</Text>
          ) : rows.length === 0 ? (
            <Text className='py-8 text-center text-bottomsheet-text-muted'>
              {q ? 'No matches' : 'No other members'}
            </Text>
          ) : (
            <BottomSheetFlatList
              style={{ flex: 1 }}
              data={rows}
              keyExtractor={row => row.id}
              renderItem={({ item }) => <OptionRow row={item} />}
              ListFooterComponent={<View className='h-36' />}
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
