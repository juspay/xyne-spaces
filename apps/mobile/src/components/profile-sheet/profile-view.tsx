import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  Check,
  ChevronDown,
  ChevronRight,
  LogOut,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { haptics } from '@/src/utils/haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { useUser } from '@/src/hooks/useUsers';
import { useUserPresence } from '@/src/hooks/usePresence';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import {
  getActiveUserStatusEmoji,
  hasActiveCustomStatus,
  isStatusExpired,
} from '@/src/utils/statusUtils';
import { APP_VERSION_LABEL } from '@/src/utils/appVersion';

const formatJoinedDate = (dateString: number | undefined): string => {
  if (!dateString) {
    return '';
  }
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const ProfileView = ({ onClose }: { onClose: () => void }): ReactElement => {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const userData = useUser(user?.user_id as string);
  const { isOnline, setStatus } = useUserPresence(user?.user_id ?? '');
  const [isPresenceMenuOpen, setIsPresenceMenuOpen] = useState(false);
  const presenceLabel = isOnline ? 'Active' : 'Away';

  const mutedIconColor = useCSSVariable('--color-muted') as string;

  const handleSetActive = (): void => {
    setStatus('ONLINE');
    setIsPresenceMenuOpen(false);
  };

  const handleSetInactive = (): void => {
    setStatus('AWAY');
    setIsPresenceMenuOpen(false);
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
  };

  const openSettings = (): void => {
    onClose();
    router.push('/settings');
  };

  const openProfile = (): void => {
    onClose();
    router.push('/profile');
  };

  // Three separate controls in this sheet open the profile; routing them all
  // through one handler keeps the haptic in a single place.
  const handleOpenProfile = (): void => {
    void haptics.buttonTap();
    openProfile();
  };

  return (
    <View className='px-4 gap-4'>
      {/* Identity */}
      <View className='flex-row items-start gap-4'>
        <Pressable
          className='active:opacity-70'
          onPress={handleOpenProfile}
          accessibilityRole='button'
          accessibilityLabel='Open profile'
        >
          <Avatar userIds={user?.user_id ? [user.user_id] : []} size={48} />
        </Pressable>
        <View className='flex-1 min-w-0'>
          <Pressable
            className='active:opacity-70'
            onPress={handleOpenProfile}
            accessibilityRole='button'
            accessibilityLabel='Open profile'
          >
            <Text className='text-lg font-semibold text-foreground' numberOfLines={1}>
              {userData?.name ?? 'User'}
            </Text>
          </Pressable>
          <View className='relative mt-0.5 self-start'>
            <Pressable
              className='flex-row items-center gap-1.5 rounded-md px-1.5 py-0.5 -ml-1.5 active:bg-accent'
              onPress={() => {
                void haptics.buttonTap();
                setIsPresenceMenuOpen(open => !open);
              }}
              accessibilityRole='button'
              accessibilityLabel={`Presence: ${presenceLabel}. Tap to change.`}
            >
              <View
                className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-[#9CA3AF]'}`}
              />
              <Text className='text-xs text-muted'>{presenceLabel}</Text>
              <ChevronDown
                size={14}
                color={mutedIconColor}
                style={{ transform: [{ rotate: isPresenceMenuOpen ? '180deg' : '0deg' }] }}
              />
            </Pressable>
            {isPresenceMenuOpen ? (
              <View className='absolute left-0 top-full z-10 mt-1 w-40 rounded-lg border border-border bg-background py-1 shadow-sm'>
                <Pressable
                  className='flex-row items-center gap-2 px-3 py-2.5 active:bg-accent'
                  onPress={() => {
                    void haptics.selection();
                    handleSetActive();
                  }}
                  accessibilityRole='button'
                  accessibilityLabel='Set presence to active'
                >
                  <View className='w-2 h-2 rounded-full bg-green-500' />
                  <Text className='flex-1 text-sm text-foreground'>Active</Text>
                  {isOnline ? <Check size={14} color={mutedIconColor} /> : null}
                </Pressable>
                <Pressable
                  className='flex-row items-center gap-2 px-3 py-2.5 active:bg-accent'
                  onPress={() => {
                    void haptics.selection();
                    handleSetInactive();
                  }}
                  accessibilityRole='button'
                  accessibilityLabel='Set presence to inactive'
                >
                  <View className='w-2 h-2 rounded-full bg-[#9CA3AF]' />
                  <Text className='flex-1 text-sm text-foreground'>Away</Text>
                  {!isOnline ? <Check size={14} color={mutedIconColor} /> : null}
                </Pressable>
              </View>
            ) : null}
          </View>
          {user?.email ? (
            <Text className='text-xs text-muted mt-1' numberOfLines={1}>
              {user.email}
            </Text>
          ) : null}
        </View>
        <Pressable
          className='pt-1 active:opacity-70'
          onPress={handleOpenProfile}
          accessibilityRole='button'
          accessibilityLabel='Open profile'
        >
          <ChevronRight size={18} color={mutedIconColor} />
        </Pressable>
      </View>

      {hasActiveCustomStatus(userData) ? (
        <View className='flex-row items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/50 border border-secondary'>
          {getActiveUserStatusEmoji(userData) ? (
            <ReactionEmojiDisplay emojiName={getActiveUserStatusEmoji(userData)!} size={24} />
          ) : null}
          <View className='flex-1'>
            <Text className='text-sm font-medium text-foreground' numberOfLines={1}>
              {userData?.statusContent}
            </Text>
            {userData?.statusExpiryAt && !isStatusExpired(userData.statusExpiryAt) ? (
              <Text className='text-xs text-muted'>
                Until {formatJoinedDate(userData.statusExpiryAt)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {hasActiveCustomStatus(userData) ? (
        <View className='flex-row items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/50 border border-secondary'>
          {getActiveUserStatusEmoji(userData) ? (
            <ReactionEmojiDisplay emojiName={getActiveUserStatusEmoji(userData)!} size={24} />
          ) : null}
          <View className='flex-1'>
            <Text className='text-sm font-medium text-foreground' numberOfLines={1}>
              {userData?.statusContent}
            </Text>
            {userData?.statusExpiryAt && !isStatusExpired(userData.statusExpiryAt) ? (
              <Text className='text-xs text-muted'>
                Until {formatJoinedDate(userData.statusExpiryAt)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Action list */}
      <View className='rounded-2xl border border-border bg-background overflow-hidden'>
        <Pressable
          className='flex-row items-center gap-3 px-4 py-3 active:bg-accent'
          onPress={() => {
            void haptics.buttonTap();
            openSettings();
          }}
          accessibilityRole='button'
          accessibilityLabel='Open settings'
        >
          <SettingsIcon size={18} color={mutedIconColor} />
          <Text className='flex-1 text-sm text-foreground'>Settings</Text>
          <ChevronRight size={18} color={mutedIconColor} />
        </Pressable>
      </View>

      {userData?.createdAt ? (
        <Text className='text-center text-xs text-muted'>
          Joined {formatJoinedDate(userData.createdAt)}
        </Text>
      ) : null}
      {userData?.createdAt ? (
        <Text className='text-center text-xs text-muted'>
          Joined {formatJoinedDate(userData.createdAt)}
        </Text>
      ) : null}

      <Pressable
        className='flex-row items-center justify-center gap-2 mt-2 px-4 py-3 rounded-full bg-[hsl(0,84.2%,60.2%)] active:opacity-90'
        onPress={() => {
          // Destructive and immediate — no confirmation step.
          void haptics.warning();
          handleSignOut();
        }}
        accessibilityRole='button'
        accessibilityLabel='Sign out'
      >
        <LogOut size={16} color='#FFFFFF' />
        <Text className='text-sm font-medium text-white'>Sign out</Text>
      </Pressable>

      {APP_VERSION_LABEL ? (
        <Text
          className='text-center text-xs text-muted mt-3'
          accessibilityRole='text'
          accessibilityLabel={`App version ${APP_VERSION_LABEL}`}
        >
          Version {APP_VERSION_LABEL}
        </Text>
      ) : null}
    </View>
  );
};
