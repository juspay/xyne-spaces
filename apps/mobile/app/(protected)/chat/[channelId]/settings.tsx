import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Archive,
  ArchiveRestore,
  ClipboardList,
  Globe,
  Mail,
  UserCog,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import {
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelVisibility,
} from '@xyne/shared';

import { ChannelNotificationsCard } from '@/src/features/chat/channel-settings/channel-notifications-card';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { haptics } from '@/src/utils/haptics';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useVisibleChannelById } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

const POLICY_OPTIONS = [
  { value: ChannelAddUserPolicy.EVERYONE, label: 'Everyone' },
  { value: ChannelAddUserPolicy.ADMINS_ONLY, label: 'Admins only' },
] as const;

const SectionLabel = ({ children }: { children: string }): ReactElement => {
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  return (
    <Text
      className='mb-2 ml-4 text-xs font-semibold uppercase tracking-wide'
      style={{ color: descriptionColor }}
    >
      {children}
    </Text>
  );
};

const SectionFootnote = ({ children }: { children: string }): ReactElement => {
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  return (
    <Text className='mx-4 mt-2 text-xs' style={{ color: descriptionColor }}>
      {children}
    </Text>
  );
};

const Card = ({ children }: { children: ReactNode }): ReactElement => (
  <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>{children}</View>
);

const RowDivider = ({ inset = 58 }: { inset?: number }): ReactElement => {
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  return <View className='h-px' style={{ marginLeft: inset, backgroundColor: dividerColor }} />;
};

type SettingRowProps = {
  icon: LucideIcon;
  label: string;
  description?: string;
  destructive?: boolean;
  trailing?: ReactElement;
  onPress?: () => void;
};

const SettingRow = ({
  icon: Icon,
  label,
  description,
  destructive,
  trailing,
  onPress,
}: SettingRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const dangerColor = useCSSVariable('--color-settings-icon-red') as string;
  const color = destructive ? dangerColor : labelColor;

  const content = (
    <View className='min-h-[56px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
      <View className='h-9 w-9 items-center justify-center'>
        <Icon size={21} color={destructive ? dangerColor : descriptionColor} strokeWidth={2.1} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text className='text-base' style={{ color }} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text className='mt-0.5 text-xs' style={{ color: descriptionColor }}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={label}
      android_ripple={{ color: dividerColor }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      {content}
    </Pressable>
  );
};

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T;
  disabled?: boolean;
  onSelect: (next: T) => void;
};

const SegmentedControl = <T extends string>({
  options,
  selected,
  disabled,
  onSelect,
}: SegmentedControlProps<T>): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;

  return (
    <View
      className='flex-row gap-1 rounded-xl p-1'
      style={{ backgroundColor: dividerColor, opacity: disabled ? 0.5 : 1 }}
    >
      {options.map(option => {
        const isActive = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!isActive) void haptics.selection();
              onSelect(option.value);
            }}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={option.label}
            className='flex-1 items-center justify-center rounded-lg py-1.5'
            style={{ backgroundColor: isActive ? sectionBg : 'transparent' }}
          >
            <Text
              className='text-xs font-medium'
              style={{ color: isActive ? labelColor : descriptionColor }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const ChannelSettingsScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const zero = useZero();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const channel = useVisibleChannelById(channelId ?? '');
  const { userID: currentUserId } = useAuthContextValues();
  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
  );
  const allUsers = useUsers();

  const usersById = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const u of allUsers) map.set(u.id, { name: u.name, email: u.email ?? '' });
    return map;
  }, [allUsers]);

  const isAdmin = useMemo(
    () =>
      participants?.some(p => p.userId === currentUserId && p.role === ChannelRole.ADMIN) ?? false,
    [participants, currentUserId],
  );

  const isDefaultChannel = channel?.scopeType === ChannelScopeType.DEFAULT;
  const isDM = channel?.scopeType === ChannelScopeType.DM;
  const isGroupDM = channel?.scopeType === ChannelScopeType.GROUP_DM;
  const isPrivateChannel = channel?.visibility === ChannelVisibility.PRIVATE;
  const isArchived = !!channel?.isArchived;
  const channelName = channel?.name ?? '';

  const currentPolicy = channel?.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const [selectedPolicy, setSelectedPolicy] = useState<ChannelAddUserPolicy>(currentPolicy);

  const handlePolicyChange = useCallback(
    (policy: ChannelAddUserPolicy): void => {
      if (!isAdmin) return;
      const previous = selectedPolicy;
      setSelectedPolicy(policy);
      try {
        zero.mutate(mutators.channel.updateAddUserPolicy({ channelId: channelId ?? '', policy }));
      } catch {
        setSelectedPolicy(previous);
      }
    },
    [isAdmin, selectedPolicy, zero, channelId],
  );

  const handleCopyNames = useCallback(async (): Promise<void> => {
    const names = (participants ?? [])
      .map(p => usersById.get(p.userId)?.name)
      .filter((n): n is string => !!n)
      .join(', ');
    if (names) {
      await Clipboard.setStringAsync(names);
      void haptics.success();
    }
  }, [participants, usersById]);

  const handleCopyEmails = useCallback(async (): Promise<void> => {
    const emails = (participants ?? [])
      .map(p => usersById.get(p.userId)?.email)
      .filter((e): e is string => !!e)
      .join(', ');
    if (emails) {
      await Clipboard.setStringAsync(emails);
      void haptics.success();
    }
  }, [participants, usersById]);

  const handleMakePublic = useCallback((): void => {
    void haptics.warning();
    Alert.alert(
      `Make #${channelName} public?`,
      'Anyone in your workspace will be able to find and join this channel.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make public',
          onPress: () => {
            zero.mutate(mutators.channel.makeChannelPublic({ channelId: channelId ?? '' }));
            void haptics.success();
          },
        },
      ],
    );
  }, [zero, channelId, channelName]);

  const handleArchive = useCallback((): void => {
    void haptics.warning();
    Alert.alert(
      `Archive #${channelName}?`,
      'The channel will be hidden from the sidebar, but its contents will still be browsable and searchable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            zero.mutate(mutators.channel.archiveChannel({ channelId: channelId ?? '' }));
            void haptics.success();
            router.back();
          },
        },
      ],
    );
  }, [zero, channelId, channelName, router]);

  const handleUnarchive = useCallback((): void => {
    void haptics.warning();
    Alert.alert(
      `Unarchive #${channelName}?`,
      'The channel will be restored and members will be able to send messages again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unarchive',
          onPress: () => {
            zero.mutate(mutators.channel.unarchiveChannel({ channelId: channelId ?? '' }));
            void haptics.success();
            router.back();
          },
        },
      ],
    );
  }, [zero, channelId, channelName, router]);

  return (
    <View className='flex-1 bg-settings-bg' style={{ paddingTop: insets.top }}>
      <View className='flex-row items-center gap-2 px-2 py-3'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} />
        <Text className='text-lg font-semibold' style={{ color: labelColor }}>
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel>Notifications</SectionLabel>
        <ChannelNotificationsCard channelId={channelId ?? ''} isDM={isDM} isGroupDM={isGroupDM} />

        {isDefaultChannel ? (
          <>
            <View className='mt-7'>
              <SectionLabel>Permissions</SectionLabel>
              <Card>
                <SettingRow icon={UserCog} label='Who can add users' />
                <View className='px-4 pb-3.5'>
                  <SegmentedControl
                    options={POLICY_OPTIONS}
                    selected={selectedPolicy}
                    disabled={!isAdmin}
                    onSelect={handlePolicyChange}
                  />
                </View>
              </Card>
              {!isAdmin ? (
                <SectionFootnote>
                  Only channel admins can change who is allowed to add users.
                </SectionFootnote>
              ) : null}
            </View>

            <View className='mt-7'>
              <SectionLabel>Members</SectionLabel>
              <Card>
                <SettingRow
                  icon={ClipboardList}
                  label='Copy member names'
                  onPress={() => void handleCopyNames()}
                />
                <RowDivider />
                <SettingRow
                  icon={Mail}
                  label='Copy member email addresses'
                  onPress={() => void handleCopyEmails()}
                />
              </Card>
            </View>

            {isPrivateChannel ? (
              <View className='mt-7'>
                <SectionLabel>Visibility</SectionLabel>
                <Card>
                  <SettingRow
                    icon={Globe}
                    label='Change to public channel'
                    {...(isAdmin ? { onPress: handleMakePublic } : {})}
                  />
                </Card>
                <SectionFootnote>
                  {isAdmin
                    ? 'Anyone in your workspace will be able to find and join this channel.'
                    : "You don't have permission to change this channel to public."}
                </SectionFootnote>
              </View>
            ) : null}

            {isAdmin ? (
              <View className='mt-7'>
                <Card>
                  {isArchived ? (
                    <SettingRow
                      icon={ArchiveRestore}
                      label='Unarchive channel'
                      onPress={handleUnarchive}
                    />
                  ) : (
                    <SettingRow
                      icon={Archive}
                      label='Archive channel'
                      destructive
                      onPress={handleArchive}
                    />
                  )}
                </Card>
                <SectionFootnote>
                  {isArchived
                    ? 'Restores the channel so members can send messages again.'
                    : 'Archived channels are hidden from the channel list but stay browsable and searchable. You can unarchive later.'}
                </SectionFootnote>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default ChannelSettingsScreen;
