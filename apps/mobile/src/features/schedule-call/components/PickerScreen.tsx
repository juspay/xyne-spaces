import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { InputV2 } from '@/src/components/ui/input-v2';
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

interface PickerSearchProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}

export const PickerSearch = ({
  value,
  onChangeText,
  placeholder,
}: PickerSearchProps): ReactElement => {
  const secondaryTextColor = useCSSVariable('--color-secondary-foreground') as string;
  return (
    <InputV2
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={secondaryTextColor}
      leftIcon={<Search size={16} color={secondaryTextColor} strokeWidth={2.2} />}
      leftIconColor={secondaryTextColor}
      clearIconColor={secondaryTextColor}
      autoCapitalize='none'
      autoCorrect={false}
      spellCheck={false}
      autoComplete='off'
      returnKeyType='search'
      inputClassName='text-base'
    />
  );
};

/** Small caps section heading, as in the reference ("SUGGESTED", "CHANNELS · PICK ONE"). */
export const ListLabel = ({ children }: { children: string }): ReactElement => (
  <Text className='px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-secondary-foreground'>
    {children}
  </Text>
);

/** The rounded 44px tile that leads a row (channel `#`, group initials, guest mail icon). */
export const Tile = ({ children }: { children: ReactNode }): ReactElement => (
  <View className='size-10 items-center justify-center rounded-xl bg-secondary'>{children}</View>
);
