import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { withAlpha } from '@/src/theme/accent-contrast';

/** Scroll distance over which the big title hands over to the nav bar title. */
const COLLAPSE_START = 40;
const COLLAPSE_END = 80;

interface CollapsingHeaderProps {
  /** Scroll offset of the form; written on the UI thread, so scrolling never re-renders. */
  scrollY: SharedValue<number>;
  title: string;
  subtitle: string;
  onBack: () => void;
}

/**
 * Back button only. As the form scrolls, the call's name and time slide in between the nav bar
 * edges and a soft fade appears under the bar, so content scrolls away beneath it.
 */
export const CollapsingHeader = ({
  scrollY,
  title,
  subtitle,
  onBack,
}: CollapsingHeaderProps): ReactElement => {
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const background = useCSSVariable('--color-settings-bg') as string;
  const foreground = useCSSVariable('--color-foreground') as string;

  const collapsedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.get(),
      [COLLAPSE_START, COLLAPSE_END],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity: progress, transform: [{ translateY: (1 - progress) * 8 }] };
  });

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.get(),
      [COLLAPSE_START, COLLAPSE_END],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <>
      <View className='z-10 bg-settings-bg' style={{ paddingTop: topSafeHeight }}>
        <AppHeader absolute={false}>
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Go back'
            iconColor={foreground}
            onPress={onBack}
          />
          <Animated.View
            className='pointer-events-none absolute inset-x-16 inset-y-0 items-center justify-center'
            style={collapsedStyle}
          >
            <Text className='text-base font-semibold leading-5 text-foreground' numberOfLines={1}>
              {title}
            </Text>
            <Text className='text-xs leading-4 text-secondary-foreground' numberOfLines={1}>
              {subtitle}
            </Text>
          </Animated.View>
        </AppHeader>
      </View>
      <Animated.View
        className='pointer-events-none absolute inset-x-0 z-10 h-12'
        style={[{ top: topSafeHeight + headerHeight }, fadeStyle]}
      >
        <LinearGradient
          colors={[background, withAlpha(background, 0)]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </>
  );
};
