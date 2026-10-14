import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter } from 'expo-router';
import { ChevronRight, MessageSquare } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { haptics } from '@/src/utils/haptics';
import { useCSSVariable } from 'uniwind';

type ChatThemeColors = {
  bg: string;
  rowDivider: string;
  label: string;
  chevron: string;
  iconFg: string;
};

const useChatThemeColors = (): ChatThemeColors => ({
  bg: useCSSVariable('--color-settings-bg') as string,
  rowDivider: useCSSVariable('--color-settings-row-divider') as string,
  label: useCSSVariable('--color-settings-label') as string,
  chevron: useCSSVariable('--color-settings-chevron') as string,
  iconFg: useCSSVariable('--color-settings-icon-fg') as string,
});

export default function ChatThemeSettingsScreen(): ReactElement {
  const router = useRouter();
  const colors = useChatThemeColors();

  return (
    <SafeAreaView className='flex-1 bg-settings-bg' edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />

      <View className='min-h-14 flex-row items-center gap-2 border-b border-settings-row-divider px-2'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={colors.label} />
        <Text
          className='flex-1 text-[20px] font-medium leading-8 text-settings-label'
          numberOfLines={1}
        >
          Chat theme
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View className='px-4 pb-6'>
          <Text className='mb-2 mt-[18px] px-3.5 text-sm font-semibold text-settings-section-label'>
            Customize
          </Text>

          <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>
            <Pressable
              onPress={() => router.push('/settings/chat-theme/chat-bubble')}
              onPressIn={(): void => {
                void haptics.buttonTap();
              }}
              accessibilityRole='button'
              accessibilityLabel='Chat bubble'
              android_ripple={{ color: colors.rowDivider }}
              className='active:opacity-60'
            >
              <View className='min-h-14 flex-row items-center gap-3 px-3.5 py-3'>
                <View className='h-[30px] w-[30px] items-center justify-center rounded-[7px] bg-settings-icon-green'>
                  <MessageSquare size={18} color={colors.iconFg} strokeWidth={2.5} />
                </View>

                <Text
                  className='min-w-0 flex-1 text-[17px] leading-[22px] text-settings-label'
                  numberOfLines={1}
                >
                  Chat bubble
                </Text>

                <ChevronRight size={18} color={colors.chevron} strokeWidth={2.5} />
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
