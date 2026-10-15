import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  BackHandler,
} from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { X, Check, Search } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';

import { useUserSearch } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';
import { useQuery } from '@/src/hooks/useQuery';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { cn } from '@/src/utils/cn';

const NATIVE_GLASS = (() => {
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
}: GlassButtonProps) => {
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
          style={[glassStyles.glassBase, { width: size, height, borderRadius }]}
        >
          {(className || fillColor) && (
            <View
              className={className ?? ''}
              style={[
                StyleSheet.absoluteFill,
                { borderRadius, ...(fillColor ? { backgroundColor: fillColor } : {}) },
              ]}
            />
          )}
          {children}
        </GlassView>
      ) : (
        <View
          className={className ?? ''}
          style={[
            glassStyles.fallbackBase,
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

const ActionBar = ({
  onCancel,
  onSubmit,
  canSubmit,
  isSubmitting,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
}) => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';

  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  if (Platform.OS === 'ios') {
    return (
      <View style={[glassStyles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>Add Members</Text>
        <GlassButton
          onPress={onSubmit}
          disabled={!canSubmit || isSubmitting}
          size={44}
          height={44}
          borderRadius={30}
          isDark={isDark}
        >
          <Check size={22} color={foregroundColor} strokeWidth={2.5} />
        </GlassButton>
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between' style={{ paddingHorizontal: 14 }}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-lg font-semibold text-bottomsheet-text-header'>Add Members</Text>

      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit || isSubmitting}
        className={cn(
          'items-center justify-center rounded-full p-3 bg-bottomsheet-container-bg',
          canSubmit && !isSubmitting ? 'active:opacity-70' : 'opacity-35',
        )}
      >
        <Check size={22} color={headerColor} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
};

const glassStyles = StyleSheet.create({
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
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
});

const UserListItem = memo(
  ({
    user,
    isSelected,
    isAlreadyMember,
    onToggle,
  }: {
    user: { id: string; name: string; email: string; picture?: string | null };
    isSelected: boolean;
    isAlreadyMember?: boolean;
    onToggle: (user: { id: string; name: string; email: string; picture?: string | null }) => void;
  }) => (
    <Pressable
      onPress={() => !isAlreadyMember && onToggle(user)}
      disabled={isAlreadyMember}
      className={cn(
        'flex-row items-center px-3 py-3',
        isAlreadyMember ? 'opacity-50' : 'active:bg-secondary/50',
      )}
    >
      <View className='size-8 rounded-lg overflow-hidden'>
        <Avatar userIds={[user.id]} size={32} rounded={false} />
      </View>
      <View className='flex-1 ml-3 min-w-0'>
        <Text
          className='text-base font-medium text-bottomsheet-container-foreground'
          numberOfLines={1}
        >
          {user.name}
        </Text>
        {isAlreadyMember ? (
          <Text className='text-sm text-bottomsheet-text-muted'>Already a member</Text>
        ) : user.email && user.email !== user.name ? (
          <Text
            className='text-xs text-bottomsheet-container-text-secondary mt-0.5'
            numberOfLines={1}
          >
            {user.email}
          </Text>
        ) : null}
      </View>
      <View
        className={`size-4.5 rounded-xs border items-center justify-center ${
          isSelected ? 'bg-[#335E40] border-[#335E40]' : 'border-gray-300 bg-transparent'
        }`}
      >
        {isSelected && <Check size={14} color='white' strokeWidth={1.6} />}
      </View>
    </Pressable>
  ),
);
UserListItem.displayName = 'UserListItem';

interface AddPeopleModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
}

interface SelectedUser {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
}

export const AddPeopleModal: React.FC<AddPeopleModalProps> = ({ isOpen, onClose, channelId }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    }
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  if (!shouldRender) {
    return null;
  }

  return (
    <AddPeopleModalSheet
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
      channelId={channelId}
    />
  );
};

const AddPeopleModalSheet = ({
  isOpen,
  onOpenChange,
  onDismiss,
  channelId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  channelId: string;
}) => {
  const zero = useZero();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const containerBg = useCSSVariable('--color-bottomsheet-container-bg') as string;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<TextInput>(null);

  const [participants] = useQuery(queries.channelParticipants({ channelId }));

  const existingUserIds = useMemo(
    () => new Set(participants?.map(p => p.userId) ?? []),
    [participants],
  );

  const searchedUsers = useUserSearch(searchQuery, 20);

  // When not searching, hide existing members. When searching, show them so the
  // user can see they're already in the channel (rendered as disabled rows).
  const userList = useMemo(() => {
    if (searchQuery.length === 0) {
      return searchedUsers.filter(u => !existingUserIds.has(u.id));
    }
    return searchedUsers;
  }, [searchQuery, searchedUsers, existingUserIds]);

  const selectedUserIds = useMemo(() => new Set(selectedUsers.map(u => u.id)), [selectedUsers]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return () => subscription.remove();
  }, [dismissSheet]);

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const handleToggleUser = useCallback(
    (user: { id: string; name: string; email: string; picture?: string | null }) => {
      if (existingUserIds.has(user.id)) return;
      setSelectedUsers(prev => {
        const exists = prev.some(u => u.id === user.id);
        if (exists) {
          return prev.filter(u => u.id !== user.id);
        }
        const newUser: SelectedUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture ?? null,
        };
        return [...prev, newUser];
      });
      setSearchQuery('');
    },
    [existingUserIds],
  );

  const removeSelectedUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  }, []);

  const isUserSelected = useCallback(
    (userId: string) => selectedUserIds.has(userId),
    [selectedUserIds],
  );

  const handleSubmit = useCallback(async () => {
    if (selectedUsers.length === 0 || !zero) return;

    setIsSubmitting(true);

    try {
      const userIds = selectedUsers.map(u => u.id);

      const participantIds = userIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      const userStatusIds = userIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      await zero.mutate(
        mutators.channel.addParticipants({
          channelId,
          userIds,
          timestamp: Date.now(),
          participantIds,
          userStatusIds,
        }),
      );

      dismissSheet();
    } catch (err) {
      console.error('Error adding participants:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedUsers, zero, channelId, dismissSheet]);

  const canAdd = selectedUsers.length > 0 && !isSubmitting;

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='fullscreen'
      keyboardBehavior='extend'
      backdropOpacity={0.4}
      onDismiss={handleDismiss}
    >
      <ActionBar
        onCancel={dismissSheet}
        onSubmit={() => void handleSubmit()}
        canSubmit={canAdd}
        isSubmitting={isSubmitting}
      />

      <View className='flex-1 mt-4 px-4' style={{ minHeight: 0 }}>
        <InputV2
          inputRef={inputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          variant='bottomsheet'
          placeholder='Search name'
          placeholderTextColor={placeholderColor}
          leftIcon={<Search size={18} color={placeholderColor} />}
          clearIconColor={placeholderColor}
          autoCapitalize='none'
          autoCorrect={false}
          inputClassName='font-medium'
        />

        {selectedUsers.length > 0 && (
          <View className='mt-2 bg-bottomsheet-container-bg rounded-xl'>
            <ScrollView
              horizontal
              contentContainerStyle={{
                padding: 12,
                gap: 12,
              }}
              keyboardShouldPersistTaps='handled'
            >
              {selectedUsers.map(user => (
                <Pressable
                  key={user.id}
                  onPress={() => removeSelectedUser(user.id)}
                  className='relative items-center w-12 gap-1'
                >
                  <Avatar userIds={[user.id]} size={40} rounded={false} />
                  <Text
                    className='text-xs font-medium text-bottomsheet-text-header'
                    numberOfLines={1}
                  >
                    {user.name}
                  </Text>
                  <View className='absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 z-10 bg-bottomsheet-text-header rounded-full p-0.5 border-2 border-bottomsheet-container-bg'>
                    <X size={10} color={containerBg} />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {searchQuery.trim() && searchedUsers.length === 0 ? (
          <Text className='text-center text-bottomsheet-text-header py-8'>No users found</Text>
        ) : !searchQuery.trim() && userList.length === 0 ? (
          <Text className='text-center text-bottomsheet-text-header py-8'>
            Type to search for users
          </Text>
        ) : (
          <View className='mt-2 rounded-[10px] flex-1' style={{ minHeight: 0 }}>
            {/* A bare list inside a gorhom sheet never registers as the sheet's
                scrollable, so its pan gesture swallows every drag and the rows
                never move. Capped at 20 users, so virtualization is moot. */}
            <BottomSheetFlatList
              style={{ flex: 1 }}
              data={userList}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <UserListItem
                  user={item}
                  isSelected={isUserSelected(item.id) || existingUserIds.has(item.id)}
                  isAlreadyMember={existingUserIds.has(item.id)}
                  onToggle={handleToggleUser}
                />
              )}
              keyboardShouldPersistTaps='handled'
              keyboardDismissMode='on-drag'
              extraData={selectedUserIds}
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
      </View>
    </AppBottomSheet>
  );
};

export default AddPeopleModal;
