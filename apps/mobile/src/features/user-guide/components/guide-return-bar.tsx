import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useSegments, type Href } from 'expo-router';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { BookOpen, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { haptics } from '@/src/utils/haptics';

import { clearGuideReturn, useGuideReturnTarget } from '../guide-return-store';
import { isOnTabShell } from '@/src/navigation/routes';

const EDGE_MARGIN = 16;
const BOTTOM_GAP = 12;
const ANIMATION_MS = 220;

/**
 * Full-width floating bar shown on the screen a guide's "Try it" opened, so
 * the reader can hop back to where they were. One tap returns; the small X
 * dismisses. It hides itself on guide screens and clears once the user is
 * back in the guide by any route, so it never lingers.
 *
 * Mounted once in the protected layout, next to the ongoing-call banner.
 */
export function GuideReturnBar(): ReactElement | null {
  const target = useGuideReturnTarget();
  const router = useRouter();
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const { tabBarHeight } = useTabBarHeight();

  // Inverted surface: foreground as ground, background as ink. Reads as a
  // system toast in both themes without needing its own tokens.
  const barBg = useCSSVariable('--color-foreground') as string;
  const barFg = useCSSVariable('--color-background') as string;

  const isOnGuide = segments.includes('guide');
  const isOnTabs = isOnTabShell(segments);
  const hasLeftGuideRef = useRef(false);

  // Arm on the guide screen, show once the user has left it, and clear the
  // moment they are back inside the guide by any route.
  useEffect(() => {
    if (!target) {
      hasLeftGuideRef.current = false;
      return;
    }
    if (!isOnGuide) {
      hasLeftGuideRef.current = true;
      return;
    }
    if (hasLeftGuideRef.current) {
      clearGuideReturn();
    }
  }, [isOnGuide, target]);

  useEffect(() => (): void => clearGuideReturn(), []);

  const returnToGuide = useCallback((): void => {
    if (!target) return;
    void haptics.buttonTap();
    const { guideId } = target;
    clearGuideReturn();
    // navigate() reuses the guide screen if it is still in the stack, and
    // pushes a fresh one otherwise.
    router.navigate({ pathname: '/(protected)/guide/[guideId]', params: { guideId } } as Href);
  }, [router, target]);

  const dismiss = useCallback((): void => {
    void haptics.selection();
    clearGuideReturn();
  }, []);

  if (!target || isOnGuide) return null;

  const bottom = (isOnTabs ? tabBarHeight : insets.bottom) + BOTTOM_GAP;

  return (
    <View pointerEvents='box-none' style={[styles.host, { bottom }]}>
      <Animated.View
        entering={FadeInDown.duration(ANIMATION_MS)}
        exiting={FadeOutDown.duration(ANIMATION_MS)}
        style={[styles.bar, { backgroundColor: barBg }]}
      >
        <Pressable
          onPress={returnToGuide}
          accessibilityRole='button'
          accessibilityLabel={`Back to guide: ${target.title}`}
          style={({ pressed }) => [styles.main, { opacity: pressed ? 0.75 : 1 }]}
        >
          <BookOpen size={18} color={barFg} strokeWidth={2.2} />
          <View style={styles.textColumn}>
            <Text style={[styles.title, { color: barFg }]} numberOfLines={1}>
              Back to guide
            </Text>
            <Text style={[styles.subtitle, { color: barFg }]} numberOfLines={1}>
              {target.title}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={dismiss}
          accessibilityRole='button'
          accessibilityLabel='Dismiss'
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.6 : 1 }]}
        >
          <X size={16} color={barFg} strokeWidth={2.4} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: EDGE_MARGIN,
    zIndex: 900,
    elevation: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  textColumn: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  subtitle: { fontSize: 12, lineHeight: 16, opacity: 0.72 },
  dismiss: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
