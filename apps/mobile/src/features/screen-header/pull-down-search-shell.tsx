import { usePathname, useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useCSSVariable } from 'uniwind';

import type { GlobalSearchTab } from '@/src/features/global-search';
import { haptics } from '@/src/utils/haptics';

import { openGlobalSearch } from './open-global-search';

/** Drag past this and releasing opens search. */
const OPEN_AT = 88;
/** Cap so the screen cannot be pulled off the display. */
const MAX_DRAG = 168;

type PullDownSearchShellProps = {
  tab: GlobalSearchTab;
  /** The list writes this. A drag only moves the screen while it is at the top. */
  scrollOffset: SharedValue<number>;
  children: ReactNode;
};

/**
 * Slack-style pull: the whole screen follows the finger down and uncovers
 * search. The gesture stays on the UI thread. JavaScript runs only for the
 * haptic and the navigation.
 */
export function PullDownSearchShell({
  tab,
  scrollOffset,
  children,
}: PullDownSearchShellProps): ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const drag = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const crossed = useSharedValue(0);
  /** Leave the screen pulled down while search is open, then settle it on close. */
  const keepOffset = useSharedValue(0);
  const pathname = usePathname();
  const searchWasOpen = useRef(false);

  const pulse = useCallback(() => {
    void haptics.gestureEnd();
  }, []);

  useEffect(() => {
    const searchOpen = pathname.includes('global-search');
    if (searchWasOpen.current && !searchOpen && drag.value > 1) {
      keepOffset.value = 0;
      drag.value = withSpring(0, { damping: 22, stiffness: 240 });
      void haptics.gestureEnd();
    }
    searchWasOpen.current = searchOpen;
  }, [drag, keepOffset, pathname]);

  const open = useCallback(() => {
    openGlobalSearch(router, tab);
  }, [router, tab]);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)
    .onTouchesDown(event => {
      const touch = event.allTouches[0];
      if (touch) touchStartY.value = touch.y;
    })
    .onTouchesMove((event, state) => {
      if (scrollOffset.value > 8) {
        state.fail();
        return;
      }
      const touch = event.allTouches[0];
      if (!touch) return;
      const dy = touch.y - touchStartY.value;
      if (dy > 18) state.activate();
      else if (dy < -12) state.fail();
    })
    .onUpdate(event => {
      const next = Math.min(Math.max(event.translationY, 0), MAX_DRAG);
      drag.value = next;
      if (next >= OPEN_AT && crossed.value === 0) {
        crossed.value = 1;
        scheduleOnRN(pulse);
      } else if (next < OPEN_AT) {
        crossed.value = 0;
      }
    })
    .onEnd(() => {
      if (drag.value < OPEN_AT) return;
      keepOffset.value = 1;
      scheduleOnRN(open);
    })
    .onFinalize(() => {
      crossed.value = 0;
      if (keepOffset.value === 1) return;
      drag.value = withSpring(0, { damping: 22, stiffness: 240 });
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.value }],
  }));

  const revealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drag.value, [0, 36, OPEN_AT], [0, 0.45, 1], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <View className='flex-1 bg-spaces-surface'>
        <Animated.View
          pointerEvents='none'
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56 },
            revealStyle,
          ]}
        >
          <View
            className='flex-1 flex-row items-end justify-center gap-2 pb-3'
            style={{ paddingTop: insets.top }}
          >
            <Search size={18} color={foreground} strokeWidth={1.8} />
            <Text className='text-base font-medium text-spaces-foreground'>Search</Text>
          </View>
        </Animated.View>
        <Animated.View className='flex-1 bg-spaces-background' style={contentStyle}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
