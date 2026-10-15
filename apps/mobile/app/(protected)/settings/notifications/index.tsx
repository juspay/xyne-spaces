import { type ComponentType, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter, type Href } from 'expo-router';
import {
  ChevronRight,
  SlidersHorizontal,
  Volume2,
  type LucideProps,
  Bell,
  BellOff,
} from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { useSetting } from '@/src/machines/settingsMachine';
import { haptics } from '@/src/utils/haptics';
import { NOTIFICATION_SOUND_OPTIONS } from '@/src/notifications/soundMetadata';

import { usePauseNotifications } from '@/src/hooks/usePauseNotifications';
import { formatPauseUntilLabel } from '@/src/utils/pauseNotifications';

type SettingsColors = {
  bg: string;
  sectionBg: string;
  divider: string;
  label: string;
  description: string;
  chevron: string;
};

const useSettingsColors = (): SettingsColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  sectionBg: useCSSVariable('--color-settings-section-bg') as string,
  divider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  description: useCSSVariable('--color-settings-description') as string,
  chevron: useCSSVariable('--color-settings-chevron') as string,
});

export default function NotificationSettingsScreen(): ReactElement {
  const router = useRouter();
  const colors = useSettingsColors();
  const soundId = useSetting('notifications.soundId');
  const selectedSound = NOTIFICATION_SOUND_OPTIONS.find(sound => sound.id === soundId);

  const { isPaused, pausedUntil } = usePauseNotifications();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <Header colors={colors} onBack={() => router.back()} title='Notifications' />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>
          <SettingsRow
            colors={colors}
            icon={SlidersHorizontal}
            label='Notification Preferences'
            onPress={() => router.push('/settings/notifications/preferences' as Href)}
          />
          <View className='ml-[58px] h-px' style={{ backgroundColor: colors.divider }} />
          <SettingsRow
            colors={colors}
            icon={Volume2}
            label='Notification Sound'
            value={selectedSound?.label ?? 'Default'}
            onPress={() => router.push('/settings/notifications/sound')}
          />
          <View className='ml-[58px] h-px' style={{ backgroundColor: colors.divider }} />
          <SettingsRow
            colors={colors}
            icon={isPaused ? BellOff : Bell}
            label='Pause Notifications'
            value={isPaused && pausedUntil ? formatPauseUntilLabel(pausedUntil) : undefined}
            onPress={() => router.push('/settings/notifications/pause' as Href)}
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

function SettingsRow({
  colors,
  icon: Icon,
  label,
  value,
  onPress,
}: {
  colors: SettingsColors;
  icon: ComponentType<LucideProps>;
  label: string;
  value?: string | undefined;
  onPress: () => void;
}): ReactElement {
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
        <View className='h-9 w-9 items-center justify-center'>
          <Icon size={22} color={colors.label} strokeWidth={2.1} />
        </View>
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
        <ChevronRight size={19} color={colors.chevron} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}
