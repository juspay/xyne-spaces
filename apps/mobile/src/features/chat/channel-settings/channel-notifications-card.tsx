import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AtSign, MessagesSquare, Monitor, Smartphone, type LucideIcon } from 'lucide-react-native';
import { NotificationLevel } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import { Switch } from '@/src/components/ui/switch';
import { useGetChannelUserStatus } from '@/src/hooks/useChannels';
import { useGlobalNotificationSettings } from '@/src/hooks/useGlobalNotificationSettings';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { haptics } from '@/src/utils/haptics';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import {
  nextChannelOverrideLevel,
  resolveChannelNotificationViewState,
} from './channel-notifications';

const CHANNEL_LEVEL_OPTIONS = [
  { value: NotificationLevel.ALL, label: 'Everything' },
  { value: NotificationLevel.MENTIONS_ONLY, label: 'Mentions only' },
] as const;

type Device = 'desktop' | 'mobile';

type ChannelNotificationsCardProps = {
  channelId: string;
  isDM: boolean;
  isGroupDM: boolean;
};

const Card = ({ children }: { children: React.ReactNode }): ReactElement => (
  <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>{children}</View>
);

const RowDivider = ({ inset = 0 }: { inset?: number }): ReactElement => {
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  return <View className='h-px' style={{ marginLeft: inset, backgroundColor: dividerColor }} />;
};

const SettingRow = ({
  icon: Icon,
  label,
  description,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  trailing: ReactElement;
}): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  return (
    <View className='min-h-[56px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
      <View className='h-9 w-9 items-center justify-center'>
        <Icon size={21} color={descriptionColor} strokeWidth={2.1} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text className='text-base' style={{ color: labelColor }} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text className='mt-0.5 text-xs' style={{ color: descriptionColor }}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
};

const SegmentedControl = ({
  selected,
  disabled,
  onSelect,
}: {
  selected: NotificationLevel;
  disabled?: boolean;
  onSelect: (next: NotificationLevel) => void;
}): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;

  return (
    <View
      className='flex-row gap-1 rounded-xl p-1'
      style={{ backgroundColor: dividerColor, opacity: disabled ? 0.5 : 1 }}
    >
      {CHANNEL_LEVEL_OPTIONS.map(option => {
        const isActive = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (disabled || isActive) return;
              void haptics.selection();
              onSelect(option.value);
            }}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityState={{ selected: isActive, disabled }}
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

export function ChannelNotificationsCard({
  channelId,
  isDM,
  isGroupDM,
}: ChannelNotificationsCardProps): ReactElement {
  const zero = useZero();
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const globalSettings = useGlobalNotificationSettings();
  const statusFromHook = useGetChannelUserStatus(channelId);
  const [statusFromQuery, statusDetails] = useQuery(queries.getChannelUserStatus({ channelId }), {
    enabled: statusFromHook === undefined && Boolean(channelId),
  });

  const channelUserStatus = statusFromHook ?? statusFromQuery ?? null;
  const settingsReady = statusFromHook !== undefined || statusDetails.type !== 'unknown';
  const isParticipant = !!channelUserStatus;

  const {
    desktopEnabled,
    mobileEnabled,
    pickedDesktopLevel,
    pickedMobileLevel,
    displayedThreadReply,
    displayedChannelWideMentions,
    splitDeliveryHint,
  } = resolveChannelNotificationViewState({
    isGroupDM,
    stored: channelUserStatus,
    global: globalSettings,
  });

  const hasAnyDeliveryEnabled = desktopEnabled || mobileEnabled;

  const setNotificationLevel = (field: Device, level: NotificationLevel | null): void => {
    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId,
        ...(field === 'desktop'
          ? { desktopNotificationLevel: level }
          : { mobileNotificationLevel: level }),
        timestamp: Date.now(),
      }),
    );
  };

  if (!isParticipant && settingsReady) {
    return (
      <Card>
        <View className='px-4 py-3.5'>
          <Text className='text-sm' style={{ color: descriptionColor }}>
            Join this channel to manage notification settings.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <SettingRow
        icon={Monitor}
        label='Desktop'
        description='Notifications on your computer'
        trailing={
          <Switch
            isSelected={desktopEnabled}
            isDisabled={!settingsReady}
            onSelectedChange={checked => {
              setNotificationLevel('desktop', nextChannelOverrideLevel(checked));
            }}
          />
        }
      />
      {!isDM && desktopEnabled ? (
        <View className='px-4 pb-3.5'>
          <SegmentedControl
            selected={pickedDesktopLevel}
            disabled={!settingsReady}
            onSelect={next => setNotificationLevel('desktop', next)}
          />
        </View>
      ) : null}

      <RowDivider />

      <SettingRow
        icon={Smartphone}
        label='Mobile'
        description='Notifications on this device'
        trailing={
          <Switch
            isSelected={mobileEnabled}
            isDisabled={!settingsReady}
            onSelectedChange={checked => {
              setNotificationLevel('mobile', nextChannelOverrideLevel(checked));
            }}
          />
        }
      />
      {!isDM && mobileEnabled ? (
        <View className='px-4 pb-3.5'>
          <SegmentedControl
            selected={pickedMobileLevel}
            disabled={!settingsReady}
            onSelect={next => setNotificationLevel('mobile', next)}
          />
        </View>
      ) : null}

      {!isDM ? (
        <>
          <RowDivider />
          <SettingRow
            icon={MessagesSquare}
            label='Thread replies'
            description={
              splitDeliveryHint
                ? `Replies in threads you follow · ${splitDeliveryHint}`
                : 'Replies in threads you follow'
            }
            trailing={
              <Switch
                isSelected={displayedThreadReply}
                isDisabled={!settingsReady || !hasAnyDeliveryEnabled}
                onSelectedChange={checked => {
                  void zero.mutate(
                    mutators.notificationSettings.setChannelNotificationLevel({
                      channelId,
                      threadReplyNotificationsEnabled: checked,
                      timestamp: Date.now(),
                    }),
                  );
                }}
              />
            }
          />
          <RowDivider />
          <SettingRow
            icon={AtSign}
            label='@channel and @here'
            description={
              splitDeliveryHint
                ? `Notify when @channel or @here is used · ${splitDeliveryHint}`
                : 'Notify when @channel or @here is used'
            }
            trailing={
              <Switch
                isSelected={displayedChannelWideMentions}
                isDisabled={!settingsReady || !hasAnyDeliveryEnabled}
                onSelectedChange={checked => {
                  void zero.mutate(
                    mutators.notificationSettings.setChannelNotificationLevel({
                      channelId,
                      channelWideMentionsEnabled: checked,
                      timestamp: Date.now(),
                    }),
                  );
                }}
              />
            }
          />
        </>
      ) : null}
    </Card>
  );
}
