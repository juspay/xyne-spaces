import { Fragment, useMemo, type ComponentType, type ReactElement } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import {
  Bell,
  ChevronRight,
  LogOut,
  MessageCircle,
  Palette,
  Signal,
  UserCheck,
  SmilePlus,
  FlaskConical,
  UserRound,
  Vibrate,
  X,
  type LucideProps,
} from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { haptics } from '@/src/utils/haptics';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { IS_COMMUNITY_APP } from '@/src/config';
import { useAuth } from '@/src/contexts/AuthContext';
import { useClearOwnStatus } from '@/src/hooks/useClearOwnStatus';
import { useQuery } from '@/src/hooks/useQuery';
import { useUserPresence } from '@/src/hooks/usePresence';
import { useUser } from '@/src/hooks/useUsers';
import { setSetting, useSetting } from '@/src/machines/settingsMachine';
import { Switch } from '@/src/components/ui/switch';
import { queries } from '@/src/zero/queries';
import {
  getActiveUserStatusContent,
  getActiveUserStatusEmoji,
  hasActiveCustomStatus,
} from '@/src/utils/statusUtils';
import { showMessageToast } from '@/src/utils/toast';
import { APP_VERSION_LABEL } from '@/src/utils/appVersion';

import { formatDateTime, resolveAssignmentUnavailableUntil } from './utils';
import { useThemeMode } from '@/src/design-system';

type SettingsColors = {
  bg: string;
  sectionBg: string;
  divider: string;
  label: string;
  description: string;
  chevron: string;
  iconRed: string;
};

const useSettingsColors = (): SettingsColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  sectionBg: useCSSVariable('--color-settings-section-bg') as string,
  divider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  description: useCSSVariable('--color-settings-description') as string,
  chevron: useCSSVariable('--color-settings-chevron') as string,
  iconRed: useCSSVariable('--color-settings-icon-red') as string,
});

type SettingsRowProps = {
  colors: SettingsColors;
  icon: ComponentType<LucideProps>;
  leading?: ReactElement | undefined;
  label: string;
  value?: string | undefined;
  onPress: () => void;
  trailing?: ReactElement | undefined;
};

function SettingsRow(props: SettingsRowProps): ReactElement {
  const { colors, icon: Icon, leading, label, value, onPress, trailing } = props;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={value ? `${label}, ${value}` : label}
      android_ripple={{ color: colors.divider }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      <View className='min-h-[62px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
        {leading ?? (
          <View className='h-9 w-9 items-center justify-center'>
            <Icon size={22} color={colors.label} strokeWidth={2.1} />
          </View>
        )}
        <View className='min-w-0 flex-1'>
          <Text className='text-[17px] text-settings-label' numberOfLines={1}>
            {label}
          </Text>
          {value ? (
            <Text className='mt-0.5 text-[13px] text-settings-description' numberOfLines={1}>
              {value}
            </Text>
          ) : null}
        </View>
        {trailing ?? <ChevronRight size={19} color={colors.chevron} strokeWidth={2.5} />}
      </View>
    </Pressable>
  );
}

export default function AccountSettingsScreen(): ReactElement {
  const router = useRouter();
  const colors = useSettingsColors();
  const clearOwnStatus = useClearOwnStatus();
  const { user, signOut } = useAuth();
  const userId = user?.user_id ?? '';
  const userData = useUser(userId);
  const [usersWithPresence] = useQuery(queries.getUsers());
  const { isOnline } = useUserPresence(userId);
  const selectedTheme = useThemeMode();

  const hasCustomStatus = hasActiveCustomStatus(userData);
  const statusEmoji = getActiveUserStatusEmoji(userData);
  const statusContent = getActiveUserStatusContent(userData);
  const themeLabel = selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1);
  const hapticsEnabled = useSetting('appearance.haptics');

  const handleHapticsToggle = (next: boolean): void => {
    setSetting('appearance.haptics', next);
    // The Switch fires its own haptic before calling this, so when enabling it
    // fired while the setting was still off and was swallowed by the gate.
    // Confirm explicitly, otherwise turning haptics on produces no feedback at
    // the one moment the user expects it. Disabling needs no such handling —
    // its haptic already landed before the setting flipped.
    if (next) {
      void haptics.toggleOn();
    }
  };

  const userWithPresence = useMemo(
    () => usersWithPresence.find(candidate => candidate.id === userId),
    [usersWithPresence, userId],
  );
  const assignmentUnavailableUntil = resolveAssignmentUnavailableUntil(
    userData?.assignmentUnavailableUntil,
    userWithPresence?.assignmentUnavailableUntil,
    userWithPresence?.presenceStatus?.assignmentUnavailableUntil,
  );
  const assignmentAvailabilityLabel = assignmentUnavailableUntil
    ? `Paused until ${formatDateTime(assignmentUnavailableUntil)}`
    : 'Available for ticket assignment';

  const clearStatus = (): void => {
    clearOwnStatus();
    showMessageToast('Status cleared', 'success');
  };

  const copyEmail = async (): Promise<void> => {
    const email = user?.email?.trim();
    if (!email) return;

    try {
      await Clipboard.setStringAsync(email);
      showMessageToast(`Copied ${email}`, 'success');
    } catch {
      showMessageToast('Unable to copy email', 'error');
    }
  };

  // Community app only; and only org owners/admins can list or review join requests server-side.
  const canReviewJoinRequests =
    IS_COMMUNITY_APP && (user?.orgRole === 'OWNER' || user?.orgRole === 'ADMIN');

  const rows: SettingsRowProps[] = [
    {
      colors,
      icon: SmilePlus,
      leading:
        hasCustomStatus && statusEmoji ? (
          <View className='h-9 w-9 items-center justify-center'>
            <ReactionEmojiDisplay emojiName={statusEmoji} size={20} />
          </View>
        ) : undefined,
      label: hasCustomStatus ? statusContent || 'Status set' : 'Set status',
      value: hasCustomStatus ? 'Tap to update your status' : 'Let people know what you’re doing',
      onPress: () => router.push('/settings/status' as Href),
      trailing: hasCustomStatus ? (
        <Pressable
          onPress={event => {
            event.stopPropagation();
            clearStatus();
          }}
          accessibilityRole='button'
          accessibilityLabel='Remove status'
          hitSlop={10}
          className='rounded-full p-1.5 active:opacity-60'
        >
          <X size={18} color={colors.description} />
        </Pressable>
      ) : undefined,
    },
    {
      colors,
      icon: Signal,
      label: 'Online status',
      value: isOnline ? 'Active' : 'Inactive',
      onPress: () => router.push('/settings/online-status' as Href),
    },
    {
      colors,
      icon: UserCheck,
      label: 'Availability',
      value: assignmentAvailabilityLabel,
      onPress: () => router.push('/settings/availability' as Href),
    },
    {
      colors,
      icon: UserRound,
      label: 'Profile details',
      onPress: () => router.push('/profile'),
    },
    {
      colors,
      icon: Palette,
      label: 'Theme',
      value: themeLabel,
      onPress: () => router.push('/settings/theme' as Href),
    },
    {
      colors,
      icon: MessageCircle,
      label: 'Chat bubble',
      onPress: () => router.push('/settings/chat-theme/chat-bubble'),
    },
    {
      colors,
      icon: Bell,
      label: 'Notifications',
      onPress: () => router.push('/settings/notifications'),
    },
    {
      colors,
      icon: Vibrate,
      label: 'Haptic feedback',
      trailing: <Switch isSelected={hapticsEnabled} onSelectedChange={handleHapticsToggle} />,
      onPress: () => handleHapticsToggle(!hapticsEnabled),
    },
    {
      colors,
      icon: FlaskConical,
      label: 'Beta',
      value: 'Try unfinished features',
      onPress: (): void => router.push('/settings/beta'),
    },
    ...(canReviewJoinRequests
      ? [
          {
            colors,
            icon: UserCheck,
            label: 'Workspace join requests',
            onPress: () => router.push('/settings/join-requests' as Href),
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <View className='min-h-14 flex-row items-center px-2'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={colors.label} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
      >
        <View className='items-center px-5 pb-8 pt-2'>
          <Pressable
            onPress={() => router.push('/settings/profile-photo' as Href)}
            accessibilityRole='button'
            accessibilityLabel='Preview profile photo'
            className='relative rounded-full active:opacity-80'
          >
            <Avatar userIds={user?.user_id ? [user.user_id] : []} size={124} />
            {/* Inset by 6px so the 24px dot centres on the circle's rim at 45°, not the corner. */}
            {userId ? (
              <PresenceDot
                userId={userId}
                className='bottom-1.5 right-1.5 size-6 border-[3px] border-settings-bg'
              />
            ) : null}
          </Pressable>
          <View className='mt-5 flex-row items-center justify-center gap-2'>
            <Text
              className='max-w-[85%] text-center text-[26px] font-bold text-settings-label'
              numberOfLines={1}
            >
              {userData?.name ?? user?.name ?? 'User'}
            </Text>
            {hasCustomStatus ? (
              <View
                className='items-center justify-center'
                accessibilityRole='text'
                accessibilityLabel={`Status: ${statusContent || 'Status set'}`}
              >
                {statusEmoji ? <ReactionEmojiDisplay emojiName={statusEmoji} size={16} /> : null}
              </View>
            ) : null}
          </View>
          {user?.email ? (
            <Pressable
              onPress={() => {
                void copyEmail();
              }}
              accessibilityRole='button'
              accessibilityLabel={`Copy email ${user.email}`}
              hitSlop={8}
              className='mt-1.5 rounded-md px-1.5 py-0.5 active:opacity-60'
            >
              <Text className='text-center text-[15px] text-settings-description' numberOfLines={1}>
                {user.email}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>
          {rows.map((row, index) => (
            <Fragment key={row.label}>
              <SettingsRow {...row} />
              {index < rows.length - 1 ? (
                <View className='ml-[58px] h-px' style={{ backgroundColor: colors.divider }} />
              ) : null}
            </Fragment>
          ))}
        </View>

        <Pressable
          onPress={() => {
            // Sign-out is destructive and has no confirmation step, so it gets
            // the heavier warning haptic rather than a plain tap.
            void haptics.warning();
            void signOut();
          }}
          accessibilityRole='button'
          accessibilityLabel='Sign out'
          className='mt-7 min-h-12 flex-row items-center justify-center gap-2 rounded-full active:opacity-80'
          style={{ backgroundColor: colors.iconRed }}
        >
          <LogOut size={18} color='#FFFFFF' strokeWidth={2.4} />
          <Text className='text-[16px] font-semibold text-white'>Sign out</Text>
        </Pressable>

        {APP_VERSION_LABEL ? (
          <Text className='pb-2 pt-6 text-center text-xs text-settings-description'>
            App Version {APP_VERSION_LABEL}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
