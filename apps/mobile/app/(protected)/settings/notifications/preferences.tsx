import { type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter } from 'expo-router';
import { AtSign, MessagesSquare, Monitor, Smartphone, type LucideIcon } from 'lucide-react-native';
import { NotificationLevel } from '@xyne/shared';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { Switch } from '@/src/components/ui/switch';
import { useGlobalNotificationSettings } from '@/src/hooks/useGlobalNotificationSettings';
import { haptics } from '@/src/utils/haptics';

const GLOBAL_LEVEL_OPTIONS = [
  { value: NotificationLevel.ALL, label: 'Everything' },
  { value: NotificationLevel.MENTIONS_ONLY, label: 'Mentions & DMs' },
] as const;

type SettingsColors = {
  bg: string;
  sectionBg: string;
  divider: string;
  label: string;
  description: string;
};

const useSettingsColors = (): SettingsColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  sectionBg: useCSSVariable('--color-settings-section-bg') as string,
  divider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  description: useCSSVariable('--color-settings-description') as string,
});

export default function NotificationPreferencesScreen(): ReactElement {
  const router = useRouter();
  const colors = useSettingsColors();
  const settings = useGlobalNotificationSettings();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <Header colors={colors} onBack={() => router.back()} title='Notification Preferences' />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>
          <View className='px-4 pb-2 pt-3.5'>
            <Text className='text-base' style={{ color: colors.label }}>
              Default notification level
            </Text>
            <Text className='mt-0.5 text-xs' style={{ color: colors.description }}>
              Channel-level settings override these defaults.
            </Text>
          </View>

          <View className='px-4 pb-3.5 pt-2'>
            <View className='mb-2 flex-row items-center gap-1.5'>
              <Monitor size={13} color={colors.description} strokeWidth={2.1} />
              <Text className='text-xs' style={{ color: colors.description }}>
                Desktop
              </Text>
            </View>
            <SegmentedControl
              selected={settings.globalDesktopNotificationLevel}
              onSelect={next => {
                void haptics.selection();
                settings.update({ globalDesktopNotificationLevel: next });
              }}
            />
          </View>

          <View className='px-4 pb-3.5'>
            <View className='mb-2 flex-row items-center gap-1.5'>
              <Smartphone size={13} color={colors.description} strokeWidth={2.1} />
              <Text className='text-xs' style={{ color: colors.description }}>
                Mobile
              </Text>
            </View>
            <SegmentedControl
              selected={settings.globalMobileNotificationLevel}
              onSelect={next => {
                void haptics.selection();
                settings.update({ globalMobileNotificationLevel: next });
              }}
            />
          </View>
        </View>

        <View className='mt-4 overflow-hidden rounded-2xl bg-settings-section-bg'>
          <SettingRow
            icon={AtSign}
            label='@channel and @here mentions'
            description='Receive notifications for channel-wide mentions'
            trailing={
              <Switch
                isSelected={settings.channelWideMentionsEnabled}
                onSelectedChange={checked => {
                  settings.update({ channelWideMentionsEnabled: checked });
                }}
              />
            }
          />
          <View className='ml-[58px] h-px' style={{ backgroundColor: colors.divider }} />
          <SettingRow
            icon={MessagesSquare}
            label='Thread reply notifications'
            description='Receive notifications for replies in threads you follow'
            trailing={
              <Switch
                isSelected={settings.threadReplyNotificationsEnabled}
                onSelectedChange={checked => {
                  settings.update({ threadReplyNotificationsEnabled: checked });
                }}
              />
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Header = ({
  colors,
  onBack,
  title,
}: {
  colors: SettingsColors;
  onBack: () => void;
  title: string;
}): ReactElement => (
  <View
    className='min-h-14 flex-row items-center gap-2 border-b px-2'
    style={{ borderColor: colors.divider }}
  >
    <HeaderBackButton liquidGlass onPress={onBack} iconColor={colors.label} />
    <Text
      className='flex-1 text-[20px] font-semibold'
      style={{ color: colors.label }}
      numberOfLines={1}
    >
      {title}
    </Text>
  </View>
);

const SettingRow = ({
  icon: Icon,
  label,
  description,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  trailing: ReactElement;
}): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  return (
    <View className='min-h-[62px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
      <View className='h-9 w-9 items-center justify-center'>
        <Icon size={21} color={descriptionColor} strokeWidth={2.1} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text className='text-base' style={{ color: labelColor }}>
          {label}
        </Text>
        <Text className='mt-0.5 text-xs' style={{ color: descriptionColor }}>
          {description}
        </Text>
      </View>
      {trailing}
    </View>
  );
};

const SegmentedControl = ({
  selected,
  onSelect,
}: {
  selected: NotificationLevel;
  onSelect: (next: NotificationLevel) => void;
}): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;

  return (
    <View className='flex-row gap-1 rounded-xl p-1' style={{ backgroundColor: dividerColor }}>
      {GLOBAL_LEVEL_OPTIONS.map(option => {
        const isActive = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (isActive) return;
              onSelect(option.value);
            }}
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
