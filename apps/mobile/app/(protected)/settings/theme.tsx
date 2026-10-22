import { Fragment, type ComponentType, type ReactElement } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Check, Moon, Smartphone, Sun, type LucideProps } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

import { setThemeMode, useThemeMode, type ModePreference } from '@/src/design-system';

const OPTIONS: readonly {
  value: ModePreference;
  label: string;
  description: string;
  icon: ComponentType<LucideProps>;
}[] = [
  {
    value: 'system',
    label: 'System',
    description: 'Match your device appearance',
    icon: Smartphone,
  },
  { value: 'light', label: 'Light', description: 'Always use the light theme', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme', icon: Moon },
];

export default function ThemeSettingsScreen(): ReactElement {
  const router = useRouter();
  const selected = useThemeMode();
  const bg = useCSSVariable('--color-settings-bg') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const label = useCSSVariable('--color-settings-label') as string;
  const description = useCSSVariable('--color-settings-description') as string;
  const blue = useCSSVariable('--color-settings-icon-blue') as string;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
      <View
        className='min-h-14 flex-row items-center gap-2 border-b px-2'
        style={{ borderColor: divider }}
      >
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={label} />
        <Text className='flex-1 text-[20px] font-semibold' style={{ color: label }}>
          Theme
        </Text>
      </View>

      <View className='px-4 pt-6'>
        <View className='overflow-hidden rounded-2xl' style={{ backgroundColor: sectionBg }}>
          {OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const isSelected = selected === option.value;
            return (
              <Fragment key={option.value}>
                <Pressable
                  onPress={() => {
                    if (!isSelected) void haptics.selection();
                    setThemeMode(option.value);
                  }}
                  accessibilityRole='radio'
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={option.label}
                  android_ripple={{ color: divider }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
                >
                  <View className='min-h-[68px] flex-row items-center gap-3 px-4 py-3'>
                    <Icon size={23} color={isSelected ? blue : description} strokeWidth={2.2} />
                    <View className='min-w-0 flex-1'>
                      <Text className='text-[17px]' style={{ color: label }}>
                        {option.label}
                      </Text>
                      <Text className='mt-0.5 text-[13px]' style={{ color: description }}>
                        {option.description}
                      </Text>
                    </View>
                    {isSelected ? <Check size={22} color={blue} strokeWidth={2.7} /> : null}
                  </View>
                </Pressable>
                {index < OPTIONS.length - 1 ? (
                  <View className='ml-[52px] h-px' style={{ backgroundColor: divider }} />
                ) : null}
              </Fragment>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}
