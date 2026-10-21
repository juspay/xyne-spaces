import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  BackHandler,
  StyleSheet,
} from 'react-native';
import { BottomSheetDraggableView, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';
import { Check, Hash, Phone, Search, X } from 'lucide-react-native';
import { router } from 'expo-router';

import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import {
  type InstantCallChannel,
  type InstantCallItem,
  type InstantCallParticipant,
  useInstantCall,
} from '@/src/hooks/useInstantCall';

// ─── Native glass availability ────────────────────────────────────────────────
// isGlassEffectAPIAvailable() validates iOS 26+ AND UIDesignRequiresCompatibility.
// Wrap in try/catch so it degrades silently if the native module isn't linked yet.
const NATIVE_GLASS = ((): boolean => {
  try {
    return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

interface GlassButtonProps {
  /** Solid fill, overriding the glass tint. Used for brand CTAs. */
  fillColor?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Square icon button — pass size for equal width/height */
  size?: number;
  height?: number;
  borderRadius?: number;
  isDark: boolean;
  className?: string;
  children: React.ReactNode;
}

const GlassButton = ({
  onPress,
  disabled = false,
  size,
  height = 36,
  borderRadius = 12,
  isDark,
  className,
  fillColor,
  children,
}: GlassButtonProps): React.ReactElement => {
  const accentBg = useCSSVariable('--color-accent') as string;
  const borderCol = useCSSVariable('--color-border') as string;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        opacity: pressed ? 0.58 : disabled ? 0.35 : 1,
      })}
    >
      {NATIVE_GLASS ? (
        <GlassView
          isInteractive
          colorScheme={isDark ? 'dark' : 'light'}
          {...(fillColor ? { tintColor: fillColor } : {})}
          style={[styles.glassBase, { width: size, height, borderRadius }]}
        >
          {/* GlassView ignores uniwind className backgrounds — paint an absolute
              fill layer. A brand CTA tints the glass instead, since an opaque
              fill would hide the material entirely. */}
          {className && !fillColor && (
            <View className={className} style={[StyleSheet.absoluteFill, { borderRadius }]} />
          )}
          {children}
        </GlassView>
      ) : (
        // ── Pre-iOS 26 / Android fallback ───────────────────────────────────
        <View
          className={className ?? ''}
          style={[
            styles.fallbackBase,
            {
              width: size,
              height,
              borderRadius,
              ...(fillColor
                ? { backgroundColor: fillColor }
                : !className && {
                    backgroundColor: accentBg,
                    borderColor: borderCol,
                  }),
            },
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
};

// ─── SelectedChip ─────────────────────────────────────────────────────────────

const SelectedChip = memo(
  ({ user, onRemove }: { user: InstantCallParticipant; onRemove: (id: string) => void }) => {
    const mutedColor = useCSSVariable('--color-muted-text') as string;
    return (
      <Pressable
        onPress={() => onRemove(user.id)}
        className='flex-row items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 active:opacity-70'
      >
        <Avatar userIds={[user.id]} size={20} />
        <Text className='text-sm font-medium text-foreground'>{user.name.split(' ')[0]}</Text>
        <X size={13} color={mutedColor} strokeWidth={2.5} />
      </Pressable>
    );
  },
);
SelectedChip.displayName = 'SelectedChip';

// ─── ChannelChip ─────────────────────────────────────────────────────────────

const ChannelChip = memo(
  ({ channel, onRemove }: { channel: InstantCallChannel; onRemove: () => void }) => {
    const mutedColor = useCSSVariable('--color-muted-text') as string;
    return (
      <Pressable
        onPress={onRemove}
        className='flex-row items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 active:opacity-70'
      >
        <View className='w-5 h-5 rounded-full bg-secondary-foreground/20 items-center justify-center'>
          <Hash size={11} color={mutedColor} strokeWidth={2.5} />
        </View>
        <Text className='text-sm font-medium text-foreground'>{channel.name}</Text>
        <X size={13} color={mutedColor} strokeWidth={2.5} />
      </Pressable>
    );
  },
);
ChannelChip.displayName = 'ChannelChip';

// ─── ChannelRow ───────────────────────────────────────────────────────────────

const ChannelRow = memo(
  ({
    channel,
    isDisabled,
    onToggle,
  }: {
    channel: InstantCallChannel;
    isDisabled: boolean;
    onToggle: (channel: InstantCallChannel) => void;
  }) => {
    const secondaryTextColor = useCSSVariable('--color-secondary-text') as string;
    return (
      <Pressable
        onPress={() => onToggle(channel)}
        disabled={isDisabled}
        className='flex-row items-center py-3 active:bg-accent/50'
        style={{ opacity: isDisabled ? 0.35 : 1 }}
      >
        <View className='w-9 h-9 rounded-xl bg-accent items-center justify-center'>
          <Hash size={16} strokeWidth={2.2} color={secondaryTextColor} />
        </View>
        <View className='flex-1 ml-3'>
          <Text className='text-[15px] text-foreground font-medium'>{channel.name}</Text>
        </View>
      </Pressable>
    );
  },
);
ChannelRow.displayName = 'ChannelRow';

// ─── UserRow ──────────────────────────────────────────────────────────────────

const UserRow = memo(
  ({
    user,
    isSelected,
    isDisabled = false,
    onToggle,
  }: {
    user: InstantCallParticipant;
    isSelected: boolean;
    isDisabled?: boolean;
    onToggle: (user: InstantCallParticipant) => void;
  }) => {
    const isDeactivated = isUserDeactivated(user);

    return (
      <Pressable
        onPress={() => onToggle(user)}
        disabled={isDisabled}
        className={cn('flex-row items-center py-3', isDisabled ? '' : 'active:bg-accent/50')}
        style={{ opacity: isDisabled ? 0.5 : 1 }}
      >
        <Avatar userIds={[user.id]} size={32} rounded={false} />
        <View className='flex-1 ml-3 min-w-0'>
          <Text
            className={cn(
              'text-[15px] font-medium',
              isDeactivated ? 'text-secondary-foreground' : 'text-foreground',
            )}
            numberOfLines={1}
          >
            {user.name}
          </Text>
          {isDeactivated ? (
            <Text className='text-xs text-secondary-foreground mt-0.5'>Deactivated</Text>
          ) : (
            user.email &&
            user.email !== user.name && (
              <Text className='text-xs text-secondary-foreground mt-0.5' numberOfLines={1}>
                {user.email}
              </Text>
            )
          )}
        </View>
        <View
          className={`size-6 rounded-full border-2 items-center justify-center ${
            isSelected ? 'bg-brand border-brand' : 'border-border bg-transparent'
          }`}
        >
          {isSelected && <Check size={13} color='white' strokeWidth={3} />}
        </View>
      </Pressable>
    );
  },
);
UserRow.displayName = 'UserRow';

// ─── ActionBar ────────────────────────────────────────────────────────────────

const ActionBar = ({
  onCancel,
  onStart,
  canStart,
}: {
  onCancel: () => void;
  onStart: () => void;
  canStart: boolean;
}): React.ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg: ctaBg } = useBubbleAccent();

  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedTextColor = useCSSVariable('--color-chat-card-muted') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.actionBarRow, { borderBottomColor: borderColor }]}>
        {/* Native glass × dismiss button */}
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>Start an Instant Call</Text>
        <GlassButton
          onPress={onStart}
          disabled={!canStart}
          size={44}
          height={44}
          borderRadius={30}
          isDark={isDark}
          fillColor={ctaBg}
        >
          <Phone size={22} color={canStart ? primaryTextColor : mutedTextColor} strokeWidth={2.5} />
        </GlassButton>
      </View>
    );
  }

  // ── Android ───────────────────────────────────────────────────────────────
  return (
    <View className='flex-row items-center justify-between' style={{ paddingHorizontal: 0 }}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-lg font-semibold text-bottomsheet-text-header'>
        Start an Instant Call
      </Text>

      <Pressable
        onPress={onStart}
        disabled={!canStart}
        className={cn(
          'items-center justify-center rounded-full p-3',
          canStart ? 'active:opacity-70' : 'opacity-35',
        )}
      >
        <Phone size={22} color='white' strokeWidth={2.5} />
      </Pressable>
    </View>
  );
};

// ─── InstantCallSheet ─────────────────────────────────────────────────────────

interface InstantCallSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstantCallSheet: React.FC<InstantCallSheetProps> = ({ isOpen, onClose }) => {
  const searchInputRef = useRef<TextInput>(null);
  const afterDismissRef = useRef<(() => void) | null>(null);
  const insets = useSafeAreaInsets();
  const safeBottom = insets.bottom;
  const secondaryTextColor = useCSSVariable('--color-secondary-text') as string;

  const {
    searchQuery,
    setSearchQuery,
    combinedResults,
    selectedUsers,
    selectedChannel,
    toggleUser,
    toggleChannel,
    removeUser,
    removeChannel,
    canStart,
    startCall,
    reset,
  } = useInstantCall();

  useEffect(() => {
    if (!isOpen) return;
    afterDismissRef.current = null;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 350);
    return (): void => clearTimeout(timer);
  }, [isOpen]);

  const dismissSheet = useCallback(
    (afterDismiss?: () => void) => {
      afterDismissRef.current = afterDismiss ?? null;
      Keyboard.dismiss();
      onClose();
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    const afterDismiss = afterDismissRef.current;
    afterDismissRef.current = null;
    reset();
    onClose();
    afterDismiss?.();
  }, [reset, onClose]);

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleClose = useCallback(() => {
    dismissSheet();
  }, [dismissSheet]);

  const handleStart = useCallback(() => {
    if (!canStart) return;
    void haptics.success();
    dismissSheet(() => {
      startCall();
      router.push('/(protected)/native-call');
    });
  }, [canStart, dismissSheet, startCall]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismissSheet, isOpen]);

  const handleToggleUser = useCallback(
    (user: InstantCallParticipant) => {
      if (isUserDeactivated(user)) return;
      void haptics.selection();
      toggleUser(user);
      setSearchQuery('');
    },
    [toggleUser, setSearchQuery],
  );

  const handleToggleChannel = useCallback(
    (channel: InstantCallChannel) => {
      void haptics.selection();
      toggleChannel(channel);
      setSearchQuery('');
    },
    [toggleChannel, setSearchQuery],
  );

  const selectedIds = useMemo(() => new Set(selectedUsers.map(u => u.id)), [selectedUsers]);
  const usersDisabled = selectedChannel !== null;
  const channelsDisabled = selectedUsers.length > 0;

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={handleSheetOpenChange}
      onDismiss={handleDismiss}
      mode='fullscreen'
    >
      {/* ── Pinned header — never scrolls ── */}
      <View className='flex flex-1 px-3.5'>
        <BottomSheetDraggableView>
          <ActionBar onCancel={handleClose} onStart={handleStart} canStart={canStart} />

          {/* Wrapped chips for selected participants / channel */}
          {(selectedUsers.length > 0 || selectedChannel) && (
            <ScrollView
              style={styles.chipsScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps='handled'
            >
              <View style={styles.chipsWrap}>
                {selectedChannel ? (
                  <ChannelChip channel={selectedChannel} onRemove={removeChannel} />
                ) : (
                  selectedUsers.map(u => <SelectedChip key={u.id} user={u} onRemove={removeUser} />)
                )}
              </View>
            </ScrollView>
          )}

          {/* Search input */}
          <View style={styles.searchWrapper}>
            <InputV2
              inputRef={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              variant='bottomsheet'
              placeholder='Search people & channels'
              placeholderTextColor={secondaryTextColor}
              leftIcon={<Search size={16} color={secondaryTextColor} strokeWidth={2.2} />}
              leftIconColor={secondaryTextColor}
              clearIconColor={secondaryTextColor}
              autoCapitalize='none'
              autoCorrect={false}
              spellCheck={false}
              autoComplete='off'
              returnKeyType='search'
              inputClassName='text-[15px]'
            />
          </View>

          {/* Section label — only shown when results exist */}
          {combinedResults.length > 0 && (
            <View style={styles.sectionLabel}>
              <Text className='text-xs font-semibold uppercase tracking-wide text-secondary-foreground'>
                {searchQuery.trim() ? 'Results' : 'People & Channels'}
              </Text>
            </View>
          )}
        </BottomSheetDraggableView>

        {/* ── Scrollable list ──
            Has to be a gorhom scrollable. The sheet wraps its content in a pan
            gesture and only yields to a *registered* scrollable; a bare list
            never registers, so every drag pans the sheet instead of scrolling. */}
        <BottomSheetFlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Math.max(safeBottom, 16) }}
          data={combinedResults}
          keyExtractor={(item: InstantCallItem) =>
            item.type === 'channel' ? `channel-${item.data.id}` : `user-${item.data.id}`
          }
          renderItem={({ item }: { item: InstantCallItem }) =>
            item.type === 'channel' ? (
              <ChannelRow
                channel={item.data}
                isDisabled={channelsDisabled}
                onToggle={handleToggleChannel}
              />
            ) : (
              <UserRow
                user={item.data}
                isSelected={selectedIds.has(item.data.id)}
                isDisabled={usersDisabled || isUserDeactivated(item.data)}
                onToggle={handleToggleUser}
              />
            )
          }
          ListEmptyComponent={
            searchQuery.trim().length > 0 ? (
              <View className='flex-1 items-center justify-center py-12 gap-3'>
                <View className='w-12 h-12 rounded-2xl bg-accent items-center justify-center'>
                  <Phone size={20} className='text-secondary-foreground' />
                </View>
                <Text className='text-sm text-secondary-foreground'>No results found</Text>
              </View>
            ) : (
              <View className='flex-1 items-center justify-center py-12'>
                <ActivityIndicator size='small' color={secondaryTextColor} />
              </View>
            )
          }
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          showsVerticalScrollIndicator={false}
        />
      </View>
    </AppBottomSheet>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  glassBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBase: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },

  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },

  // Layout
  chips: {
    gap: 8,
    paddingVertical: 10,
  },
  chipsScroll: {
    maxHeight: 88,
    paddingVertical: 8,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchWrapper: {
    paddingTop: 10,
    paddingBottom: 2,
  },
  sectionLabel: {
    paddingHorizontal: 0,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionSubLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    paddingVertical: 4,
  },
});
