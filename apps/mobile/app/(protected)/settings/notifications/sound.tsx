import { Fragment, useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter } from 'expo-router';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Check } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { setSetting, useSetting } from '@/src/machines/settingsMachine';
import { haptics } from '@/src/utils/haptics';
import { NOTIFICATION_SOUNDS, type SoundOption } from '@/src/notifications/sound';
import { writeNotificationSoundPreference } from '@/src/notifications/soundPreference';

interface ThemeColors {
  bg: string;
  sectionBg: string;
  sectionLabel: string;
  rowDivider: string;
  label: string;
  description: string;
  iconBlue: string;
}

const useSettingsColors = (): ThemeColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  sectionBg: useCSSVariable('--color-settings-section-bg') as string,
  sectionLabel: useCSSVariable('--color-settings-section-label') as string,
  rowDivider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  description: useCSSVariable('--color-settings-description') as string,
  iconBlue: useCSSVariable('--color-settings-icon-blue') as string,
});

export default function NotificationSoundSettingsScreen(): ReactElement {
  const router = useRouter();
  const colors = useSettingsColors();
  const selectedSoundId = useSetting('notifications.soundId');
  const previewRef = useRef<AudioPlayer | null>(null);
  const previewStatusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRunRef = useRef(0);

  const unloadPreview = useCallback((): void => {
    if (previewStatusTimerRef.current !== null) {
      clearInterval(previewStatusTimerRef.current);
      previewStatusTimerRef.current = null;
    }
    const current = previewRef.current;
    previewRef.current = null;
    if (!current) return;
    current.pause();
    current.remove();
  }, []);

  useEffect(() => {
    return () => {
      previewRunRef.current += 1;
      unloadPreview();
    };
  }, [unloadPreview]);

  const playPreview = useCallback(
    async (option: SoundOption): Promise<void> => {
      const run = previewRunRef.current + 1;
      previewRunRef.current = run;

      unloadPreview();

      if (!option.previewAsset) return;

      try {
        await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });

        const player = createAudioPlayer(option.previewAsset);

        if (previewRunRef.current !== run) {
          player.remove();
          return;
        }

        previewRef.current = player;
        previewStatusTimerRef.current = setInterval(() => {
          if (player.currentStatus.didJustFinish) {
            if (previewRef.current === player) previewRef.current = null;
            if (previewStatusTimerRef.current !== null) {
              clearInterval(previewStatusTimerRef.current);
              previewStatusTimerRef.current = null;
            }
            player.remove();
          }
        }, 250);
        player.play();
      } catch (error) {
        console.warn('[NotificationSoundSettings] preview failed', error);
      }
    },
    [unloadPreview],
  );

  const handleSelect = useCallback(
    (option: SoundOption): void => {
      setSetting('notifications.soundId', option.id);
      writeNotificationSoundPreference(option.id);
      void playPreview(option);
    },
    [playPreview],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <Header colors={colors} onBack={() => router.back()} title='Sound' />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel colors={colors}>Message sound</SectionLabel>
        <SectionCard colors={colors}>
          {NOTIFICATION_SOUNDS.map((option, index) => (
            <Fragment key={option.id}>
              <SoundRow
                colors={colors}
                option={option}
                isSelected={option.id === selectedSoundId}
                onPress={() => handleSelect(option)}
              />
              {index < NOTIFICATION_SOUNDS.length - 1 ? <Divider colors={colors} /> : null}
            </Fragment>
          ))}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const Header = ({
  colors,
  onBack,
  title,
}: {
  colors: ThemeColors;
  onBack: () => void;
  title: string;
}): ReactElement => (
  <View
    className='min-h-14 flex-row items-center gap-2 border-b px-2'
    style={{ borderColor: colors.rowDivider }}
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

const SectionLabel = ({
  colors,
  children,
}: {
  colors: ThemeColors;
  children: ReactNode;
}): ReactElement => (
  <Text
    style={{ color: colors.sectionLabel, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 }}
    className='uppercase'
  >
    {children}
  </Text>
);

const SectionCard = ({
  colors,
  children,
}: {
  colors: ThemeColors;
  children: ReactNode;
}): ReactElement => (
  <View className='rounded-2xl overflow-hidden' style={{ backgroundColor: colors.sectionBg }}>
    {children}
  </View>
);

const Divider = ({ colors }: { colors: ThemeColors }): ReactElement => (
  <View style={{ height: 0.5, backgroundColor: colors.rowDivider, marginLeft: 16 }} />
);

const SoundRow = ({
  colors,
  option,
  isSelected,
  onPress,
}: {
  colors: ThemeColors;
  option: SoundOption;
  isSelected: boolean;
  onPress: () => void;
}): ReactElement => (
  <Pressable
    onPress={() => {
      if (!isSelected) void haptics.selection();
      onPress();
    }}
    accessibilityRole='radio'
    accessibilityState={{ checked: isSelected }}
    accessibilityLabel={option.label}
    android_ripple={{ color: colors.rowDivider }}
    style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
  >
    <View
      className='flex-row items-center'
      style={{ minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 }}
    >
      <View className='flex-1 pr-3'>
        <Text style={{ color: colors.label, fontSize: 18 }} numberOfLines={1}>
          {option.label}
        </Text>
        {option.description ? (
          <Text style={{ color: colors.description, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
            {option.description}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 28, alignItems: 'flex-end' }}>
        {isSelected ? <Check size={22} color={colors.iconBlue} strokeWidth={2.6} /> : null}
      </View>
    </View>
  </Pressable>
);
