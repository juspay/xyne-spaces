import { type ReactElement, useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import XyneAppIcon from '@/assets/images/Xyne_Spaces-Default-1024x1024.png';
import { XyneLogo } from '@/src/assets/icons/XyneLogo';
import { useBubbleAccentForSurface } from '@/src/theme/BubbleAccentProvider';

const clampProgress = (progress: number): number => Math.max(0.08, Math.min(progress, 1));

type ProtectedStartupScreenProps = {
  label: string;
  progress: number;
};

export function ProtectedStartupScreen({
  label,
  progress: progressValue,
}: ProtectedStartupScreenProps): ReactElement {
  const backgroundColor = (useCSSVariable('--color-background') as string) || '#171717';
  const foregroundColor = (useCSSVariable('--color-foreground') as string) || '#F8FAFC';
  // The progress fill follows the chosen chat bubble colour, measured against the
  // track rather than the page: in dark the track (#2e2e2e) is lighter than the
  // background (#0a0a0a), so an accent tuned to the page can sit too close to the
  // very bar it is filling. One instance on a startup screen, so the extra
  // subscriptions this hook carries are not a concern.
  const { accentBg: brandColor } = useBubbleAccentForSurface('--color-base-150');
  const trackColor = (useCSSVariable('--color-base-150') as string) || '#2E2E2E';
  const borderColor = (useCSSVariable('--color-border') as string) || '#404040';

  const progress = clampProgress(progressValue);
  const animatedProgress = useSharedValue(progress);

  useEffect(() => {
    animatedProgress.value = withTiming(progress, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [animatedProgress, progress]);

  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${Math.round(animatedProgress.value * 100)}%`,
  }));

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <View style={styles.brandLockup}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode='contain'
            source={XyneAppIcon}
            style={styles.appIcon}
          />
          <View style={styles.wordmarkWrap}>
            <XyneLogo width={128} height={26} />
          </View>
        </View>
        <View
          accessibilityLabel={label}
          accessibilityRole='progressbar'
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          style={[styles.progressTrack, { backgroundColor: trackColor, borderColor }]}
        >
          <Animated.View
            style={[
              styles.progressFill,
              progressFillStyle,
              {
                backgroundColor: brandColor,
              },
            ]}
          />
        </View>
        <Text numberOfLines={1} style={[styles.label, { color: foregroundColor }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    width: '100%',
  },
  brandLockup: {
    alignItems: 'center',
    marginBottom: 30,
  },
  appIcon: {
    height: 72,
    width: 72,
  },
  wordmarkWrap: {
    marginTop: 14,
  },
  progressTrack: {
    borderRadius: 999,
    borderWidth: 1,
    height: 9,
    maxWidth: 320,
    overflow: 'hidden',
    width: '76%',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 14,
    maxWidth: 280,
    textAlign: 'center',
  },
});
