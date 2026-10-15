import { Fragment, type ReactElement } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Check } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { useUserPresence } from '@/src/hooks/usePresence';

const OPTIONS = [
  {
    value: 'ONLINE' as const,
    label: 'Active',
    description: 'Show others that you are available',
    color: '#22C55E',
  },
  {
    value: 'AWAY' as const,
    label: 'Inactive',
    description: 'Show others that you are away',
    color: '#9CA3AF',
  },
] as const;

export default function OnlineStatusScreen(): ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline, setStatus } = useUserPresence(user?.user_id ?? '');
  const bg = useCSSVariable('--color-settings-bg') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const blue = useCSSVariable('--color-settings-icon-blue') as string;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
      <View
        className='min-h-14 flex-row items-center gap-2 border-b px-2'
        style={{ borderColor: divider }}
      >
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={labelColor} />
        <Text className='flex-1 text-[20px] font-semibold' style={{ color: labelColor }}>
          Online status
        </Text>
      </View>

      <View className='px-4 pt-6'>
        <View className='overflow-hidden rounded-2xl' style={{ backgroundColor: sectionBg }}>
          {OPTIONS.map((option, index) => {
            const selected = option.value === (isOnline ? 'ONLINE' : 'AWAY');
            return (
              <Fragment key={option.value}>
                <Pressable
                  onPress={() => {
                    if (!selected) void haptics.selection();
                    setStatus(option.value);
                  }}
                  accessibilityRole='radio'
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option.label}
                  android_ripple={{ color: divider }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
                >
                  <View className='min-h-[68px] flex-row items-center gap-3 px-4 py-3'>
                    <View
                      className='h-3 w-3 rounded-full'
                      style={{ backgroundColor: option.color }}
                    />
                    <View className='min-w-0 flex-1'>
                      <Text className='text-[17px]' style={{ color: labelColor }}>
                        {option.label}
                      </Text>
                      <Text className='mt-0.5 text-[13px]' style={{ color: descriptionColor }}>
                        {option.description}
                      </Text>
                    </View>
                    {selected ? <Check size={22} color={blue} strokeWidth={2.7} /> : null}
                  </View>
                </Pressable>
                {index < OPTIONS.length - 1 ? (
                  <View className='ml-[44px] h-px' style={{ backgroundColor: divider }} />
                ) : null}
              </Fragment>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}
