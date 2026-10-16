import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Check, Hash, Link2, Lock, Search, Users, X } from 'lucide-react-native';
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
/** Gorhom's drag handle, which sits inside the 100% snap box above our content. */
const SHEET_HANDLE_HEIGHT = 24;

type ShareSearchItem = {
  id: string;
  type: 'channel' | 'user';
  name: string;
  description?: string;
  isPrivate?: boolean;
};

/** Someone who already has access, listed under "Shared with" (the owner is pinned first). */
export type ShareAccessEntry = {
  key: string;
  label: string;
  kind: 'owner' | 'user' | 'channel' | 'user_group';
  targetId: string;
  isPrivate?: boolean;
  /** The card the share posted, when there is one to jump to. */
  post?: { channelId: string; conversationId: string } | null;
};

interface ShareRecordingSheetProps {
  callId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Sheet heading. Defaults to "Share Recording". */
  title?: string;
  /** Overrides the recording share call — e.g. a regular call shares via /calls/:id/sharing. */
  onShare?: (targets: Array<{ type: 'user' | 'channel'; id: string }>) => Promise<void>;
  /** Alert body when sharing fails. */
  errorMessage?: string;
  /** Existing access, shown under "Shared with" while the search is empty. */
  sharedWith?: ShareAccessEntry[];
  /** Remove a share. Rows only get a remove button when this is set. */
  onRevoke?: (entry: ShareAccessEntry) => Promise<void>;
  /** Open the conversation a share posted into. */
  onOpenSharedPost?: (entry: ShareAccessEntry) => void;
}

export function ShareRecordingSheet({
  callId,
  isOpen,
  onClose,
  title = 'Share Recording',
  onShare,
  errorMessage = 'Failed to share recording.',
  sharedWith,
  onRevoke,
  onOpenSharedPost,
}: ShareRecordingSheetProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Same sizing as the create-DM drawer: a flex-1 root inside the sheet has no
  // definite height, so the list would grow to every row instead of scrolling.
  const sheetBodyHeight =
    windowHeight -
    insets.top -
    (Platform.OS === 'android' ? insets.bottom : 0) -
    SHEET_HANDLE_HEIGHT;

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
      const targets = selectedTargets.map(t => ({ type: t.type, id: t.id }));
      if (onShare) {
        await onShare(targets);
      } else {
        await recordingService.shareRecording(callId, targets);
      }
      void haptics.success();
      onClose();
    } catch (err) {
      logRecordingError('ShareRecordingSheet.share', err);
      void haptics.error();
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [callId, selectedTargets, isSubmitting, onClose, onShare, errorMessage]);

  const sharedTargetKeys = useMemo(
    () => new Set((sharedWith ?? []).map(entry => `${entry.kind}-${entry.targetId}`)),
    [sharedWith],
  );

  const handleRevoke = useCallback(
    (entry: ShareAccessEntry): void => {
      if (!onRevoke) return;
      Alert.alert('Remove access?', `${entry.label} will no longer have access.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: (): void => {
            onRevoke(entry).catch(err => {
              logRecordingError('ShareRecordingSheet.revoke', err);
              void haptics.error();
              Alert.alert('Error', 'Failed to remove access.');
            });
          },
        },
      ]);
    },
    [onRevoke],
  );

  const sharedWithHeader =
    !searchQuery.trim() && sharedWith && sharedWith.length > 0 ? (
      <View className='pb-2'>
        <Text className='px-5 pb-1 pt-2 text-[13px] font-medium' style={{ color: mutedColor }}>
          Shared with
        </Text>
        {sharedWith.map(entry => (
          <View
            key={entry.key}
            style={{ height: ROW_HEIGHT }}
            className='flex-row items-center gap-3.5 px-5'
          >
            {entry.kind === 'channel' || entry.kind === 'user_group' ? (
              <View className='size-9 items-center justify-center rounded-lg bg-foreground/5'>
                {entry.kind === 'user_group' ? (
                  <Users size={16} color={foreground} />
                ) : entry.isPrivate ? (
                  <Lock size={16} color={foreground} />
                ) : (
                  <Hash size={16} color={foreground} />
                )}
              </View>
            ) : (
              <Avatar userIds={[entry.targetId]} size={36} />
            )}
            <Text className='min-w-0 flex-1 text-[16px] text-foreground' numberOfLines={1}>
              {entry.label}
            </Text>
            {entry.post && onOpenSharedPost ? (
              <Pressable
                onPress={() => onOpenSharedPost(entry)}
                hitSlop={8}
                accessibilityRole='link'
                accessibilityLabel='Open shared conversation'
                className='p-1 active:opacity-60'
              >
                <Link2 size={16} color={mutedColor} />
              </Pressable>
            ) : null}
            {entry.kind === 'owner' ? (
              <Text className='text-[13px]' style={{ color: mutedColor }}>
                Owner
              </Text>
            ) : onRevoke ? (
              <Pressable
                onPress={() => handleRevoke(entry)}
                hitSlop={8}
                accessibilityRole='button'
                accessibilityLabel={`Remove access for ${entry.label}`}
                className='p-1 active:opacity-60'
              >
                <X size={16} color={mutedColor} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <Text className='px-5 pb-1 pt-3 text-[13px] font-medium' style={{ color: mutedColor }}>
          Share with more
        </Text>
      </View>
    ) : null;

  const renderItem = useCallback(
    ({ item }: { item: ShareSearchItem }): ReactElement => {
      const isSelected = selectedTargets.some(t => t.id === item.id && t.type === item.type);
      const isShared =
        sharedTargetKeys.has(`${item.type}-${item.id}`) ||
        (item.type === 'user' && sharedTargetKeys.has(`owner-${item.id}`));
      return (
        <Pressable
          accessibilityRole='button'
          accessibilityState={{ selected: isSelected, disabled: isShared }}
          accessibilityLabel={item.name}
          onPress={() => handleToggleSelect(item)}
          disabled={isShared}
          style={{ height: ROW_HEIGHT, opacity: isShared ? 0.5 : 1 }}
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
          {isShared ? (
            <Text className='text-[13px]' style={{ color: mutedColor }}>
              Has access
            </Text>
          ) : isSelected ? (
            <Check size={18} color={accentBg} strokeWidth={2.5} />
          ) : null}
        </Pressable>
      );
    },
    [selectedTargets, sharedTargetKeys, handleToggleSelect, foreground, mutedColor, accentBg],
  );

  return (
    <View style={{ height: sheetBodyHeight }}>
      <View className='h-12 flex-row items-center px-5'>
        <Text className='flex-1 text-[17px] font-semibold text-foreground'>{title}</Text>
        {/* In the header, not at the bottom: the search field auto-focuses, and the
            keyboard would otherwise cover the submit button. */}
        <Pressable
          onPress={() => void handleSubmit()}
          disabled={selectedTargets.length === 0 || isSubmitting}
          accessibilityRole='button'
          accessibilityState={{ disabled: selectedTargets.length === 0 || isSubmitting }}
          hitSlop={6}
          className='h-8 min-w-[64px] items-center justify-center rounded-full px-3.5 active:opacity-70'
          style={{
            backgroundColor: accentBg,
            opacity: selectedTargets.length === 0 || isSubmitting ? 0.4 : 1,
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

      {selectedTargets.length > 0 ? (
        // Plain ScrollView: a horizontal BottomSheetScrollView registers as the
        // sheet's active scrollable and steals the list's vertical drags.
        <ScrollView
          horizontal
          keyboardShouldPersistTaps='handled'
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
        </ScrollView>
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
          keyboardDismissMode='on-drag'
          showsVerticalScrollIndicator={false}
          renderItem={renderItem}
          ListHeaderComponent={sharedWithHeader}
          contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 8 }}
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
    </View>
  );
}
