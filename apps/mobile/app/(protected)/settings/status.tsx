import type { ReactElement } from 'react';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useCSSVariable } from 'uniwind';

import { UpdateStatusSheet } from '@/src/components/user-profile/update-status-sheet';
import { useSelf } from '@/src/hooks/useUsers';
import {
  getActiveUserStatusContent,
  getActiveUserStatusEmoji,
  hasActiveCustomStatus,
} from '@/src/utils/statusUtils';

export default function StatusSettingsScreen(): ReactElement {
  const router = useRouter();
  const user = useSelf();
  const backgroundColor = useCSSVariable('--color-settings-bg') as string;
  const hasCustomStatus = hasActiveCustomStatus(user);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor } }} />
      <View className='flex-1'>
        <UpdateStatusSheet
          isOpen
          presentation='page'
          onBack={() => router.back()}
          onOpenChange={open => {
            if (!open) router.back();
          }}
          currentStatus={
            hasCustomStatus
              ? {
                  emoji: getActiveUserStatusEmoji(user) ?? null,
                  content: getActiveUserStatusContent(user) ?? null,
                  expiryAt: user?.statusExpiryAt ?? null,
                }
              : null
          }
        />
      </View>
    </SafeAreaView>
  );
}
