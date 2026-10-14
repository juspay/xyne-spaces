import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, Hash, Lock, Search, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { useDmPickerSearch } from '@/src/hooks/useDmPickerSearch';
import { useAuth } from '@/src/contexts/AuthContext';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { recordingService } from '@/src/services/recordingService';
import { logRecordingError } from '@/src/utils/recordingUtils';
import { haptics } from '@/src/utils/haptics';

const ROW_HEIGHT = 60;
const USER_LIMIT = 20;
const CHANNEL_LIMIT = 10;

type ShareSearchItem = {
  id: string;
  type: 'channel' | 'user';
  name: string;
  description?: string;
  isPrivate?: boolean;
};

interface ShareRecordingSheetProps {
  callId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareRecordingSheet({
  callId,
  isOpen,
  onClose,
}: ShareRecordingSheetProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState(state => state.isVisible);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<ShareSearchItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  const { user: currentUser } = useAuth();
  const allVisibleChannels = useAllVisibleChannels();
  const allUsers = useUsers();
  // Same default the Add DM sheet uses for its idle state — recent DM
  // partners — capped by the same USER_LIMIT the search results use.
  const defaultUsers = useDmPickerSearch('', USER_LIMIT, currentUser?.user_id);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedTargets([]);
      return undefined;
    }
    const timeout = setTimeout(() => searchInputRef.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [isOpen]);

  const filteredItems = useMemo((): ShareSearchItem[] => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (name: string, description?: string | null): boolean =>
      name.toLowerCase().includes(query) || !!description?.toLowerCase().includes(query);

    const baseUsers = query
      ? allUsers.filter(u => u.id !== currentUser?.user_id && matchesQuery(u.name, u.email))
      : defaultUsers;

    const users: ShareSearchItem[] = baseUsers.slice(0, USER_LIMIT).map(u => ({
      id: u.id,
      type: 'user' as const,
      name: u.name,
      ...(u.email ? { description: u.email } : {}),
    }));

    const channels: ShareSearchItem[] = allVisibleChannels
      .filter(
        channel =>
          channel.scopeType === ChannelScopeType.DEFAULT &&
          (query ? matchesQuery(channel.name, channel.description) : true),
      )
      .slice(0, CHANNEL_LIMIT)
      .map(channel => ({
        id: channel.id,
        type: 'channel' as const,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description ? { description: channel.description } : {}),
      }));

    return [...users, ...channels];
  }, [allUsers, allVisibleChannels, currentUser?.user_id, defaultUsers, searchQuery]);

  const handleToggleSelect = useCallback((item: ShareSearchItem): void => {
    void haptics.selection();
    setSelectedTargets(prev => {
      const isAlreadySelected = prev.some(t => t.id === item.id && t.type === item.type);
      if (isAlreadySelected) return prev.filter(t => !(t.id === item.id && t.type === item.type));
      return [...prev, item];
    });
  }, []);

  const handleRemoveTarget = useCallback((target: ShareSearchItem): void => {
    setSelectedTargets(prev => prev.filter(t => !(t.id === target.id && t.type === target.type)));
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (selectedTargets.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await recordingService.shareRecording(
        callId,
        selectedTargets.map(t => ({ type: t.type, id: t.id })),
      );
      void haptics.success();
      onClose();
    } catch (err) {
      logRecordingError('ShareRecordingSheet.share', err);
      void haptics.error();
      Alert.alert('Error', 'Failed to share recording.');
    } finally {
      setIsSubmitting(false);
    }
  }, [callId, selectedTargets, isSubmitting, onClose]);

  const renderItem = useCallback(
    ({ item }: { item: ShareSearchItem }): ReactElement => {
      const isSelected = selectedTargets.some(t => t.id === item.id && t.type === item.type);
      return (
        <Pressable
          accessibilityRole='button'
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={item.name}
          onPress={() => handleToggleSelect(item)}
          style={{ height: ROW_HEIGHT }}
          className='flex-row items-center gap-3.5 px-5 active:opacity-70'
        >
          {item.type === 'channel' ? (
            <View className='size-9 items-center justify-center rounded-lg bg-foreground/5'>
              {item.isPrivate ? (
                <Lock size={16} color={foreground} />
              ) : (
                <Hash size={16} color={foreground} />
              )}
            </View>
          ) : (
            <Avatar userIds={[item.id]} size={36} />
          )}
          <View className='min-w-0 flex-1 justify-center'>
            <Text className='text-[16px] font-normal text-foreground' numberOfLines={1}>
              {item.name}
            </Text>
            {item.description ? (
              <Text className='mt-0.5 text-[13px]' style={{ color: mutedColor }} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </View>
          {isSelected ? <Check size={18} color={accentBg} strokeWidth={2.5} /> : null}
        </Pressable>
      );
    },
    [selectedTargets, handleToggleSelect, foreground, mutedColor, accentBg],
  );

  return (
    <View className='min-h-0 flex-1'>
      <View className='h-12 flex-row items-center px-5'>
        <Text className='flex-1 text-[17px] font-semibold text-foreground'>Share Recording</Text>
      </View>

      {selectedTargets.length > 0 ? (
        <BottomSheetScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className='mb-2'
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
          }}
        >
          {selectedTargets.map(target => (
            <View
              key={`${target.type}-${target.id}`}
              className='flex-row items-center gap-2 rounded-full bg-foreground/5 py-1 pl-1.5 pr-2.5'
            >
              {target.type === 'channel' ? (
                <View className='size-6 items-center justify-center rounded-full bg-foreground/5'>
                  {target.isPrivate ? (
                    <Lock size={12} color={foreground} />
                  ) : (
                    <Hash size={12} color={foreground} />
                  )}
                </View>
              ) : (
                <Avatar userIds={[target.id]} size={24} />
              )}
              <Text className='text-[14px] font-medium text-foreground' numberOfLines={1}>
                {target.name}
              </Text>
              <Pressable onPress={() => handleRemoveTarget(target)} hitSlop={8}>
                <X size={14} color={mutedColor} />
              </Pressable>
            </View>
          ))}
        </BottomSheetScrollView>
      ) : null}

      <View className='px-4'>
        <InputV2
          inputRef={searchInputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          variant='bottomsheet'
          placeholder='Search channels or people'
          placeholderTextColor={mutedColor}
          autoCorrect={false}
          autoCapitalize='none'
          returnKeyType='search'
          leftIcon={<Search size={18} color={mutedColor} />}
        />
      </View>
      <View className='flex-1' style={{ minHeight: 0 }}>
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={filteredItems}
          keyExtractor={item => `${item.type}-${item.id}`}
          keyboardShouldPersistTaps='handled'
          showsVerticalScrollIndicator={false}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 8 }}
          ListEmptyComponent={
            <View className='flex-1 items-center justify-center gap-3 px-8'>
              <View
                className='size-16 items-center justify-center rounded-full'
                style={{ backgroundColor: `${accentBg}26` }}
              >
                <Search size={28} color={accentBg} />
              </View>
              <Text className='text-center text-lg font-semibold text-foreground'>No matches</Text>
              <Text className='text-center text-sm' style={{ color: mutedColor }}>
                Try a different name.
              </Text>
            </View>
          }
        />
      </View>

      <Pressable
        onPress={() => void handleSubmit()}
        disabled={selectedTargets.length === 0 || isSubmitting}
        className='mx-4 mt-2 items-center rounded-xl py-3 active:opacity-70'
        style={{
          backgroundColor: accentBg,
          opacity: selectedTargets.length === 0 || isSubmitting ? 0.4 : 1,
          marginBottom: isKeyboardVisible
            ? 4
            : Platform.OS === 'ios'
              ? Math.max(insets.bottom, 4)
              : 4,
        }}
      >
        {isSubmitting ? (
          <ActivityIndicator size='small' color={accentFg} />
        ) : (
          <Text className='text-sm font-semibold' style={{ color: accentFg }}>
            {selectedTargets.length > 1 ? `Share with ${selectedTargets.length}` : 'Share'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
