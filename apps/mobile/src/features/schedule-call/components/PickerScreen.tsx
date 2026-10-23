import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';

interface PickerScreenProps {
  title: string;
  /** Pinned under the header (search or entry field). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/** Shell for the pushed picker screens: glass back button, centred title, then the content. */
export const PickerScreen = ({ title, headerExtra, children }: PickerScreenProps): ReactElement => {
  const router = useRouter();
  const { topSafeHeight } = useHeaderHeight();
  const foreground = useCSSVariable('--color-foreground') as string;
  return (
    <View className='flex-1 bg-settings-bg' style={{ paddingTop: topSafeHeight }}>
      {/* The same bar and back button as the desk, recordings and conversation screens. */}
      <AppHeader absolute={false}>
        <HeaderBackButton
          liquidGlass
          accessibilityLabel='Go back'
          iconColor={foreground}
          onPress={() => router.back()}
        />
        <AppHeader.Title className='text-foreground'>{title}</AppHeader.Title>
        {/* Balances the back button so the title stays centred. */}
        <View className='size-11' />
      </AppHeader>
      {headerExtra ? <View className='px-4 pb-2'>{headerExtra}</View> : null}
      {children}
    </View>
  );
};
