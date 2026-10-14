import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { haptics } from '@/src/utils/haptics';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type TicketTab = 'overview' | 'thread';

const TICKET_TAB_COUNT = 2;
/** Prefer vertical list scroll; only take over after a clear horizontal swipe. */
const HORIZONTAL_ACTIVE_OFFSET = 40;
/** If vertical movement wins first, fail the pager pan so content can scroll. */
const VERTICAL_FAIL_OFFSET = 14;
const PAGE_SNAP_MS = 220;

export function getTicketTabIndex(tab: TicketTab): number {
  return tab === 'thread' ? 1 : 0;
}

export function getTicketTabByIndex(index: number): TicketTab {
  return index === 1 ? 'thread' : 'overview';
}

type TicketTabPagerProps = {
  activeTab: TicketTab;
  onTabChange: (tab: TicketTab) => void;
  overview: ReactNode;
  thread: ReactNode;
};

/**
 * Horizontal paging host for ticket Overview / Thread tabs.
 *
 * Mirrors SearchTabPager: pan with a high horizontal activation threshold so
 * nested vertical scroll (Overview ScrollView / Thread chat list) wins first.
 * Thread content is lazy-mounted on first visit and kept mounted after that.
 *
 * On Thread, iOS interactive-pop is disabled so swipe-right switches tabs
 * instead of popping the screen. On Overview, edge back-swipe is restored.
 */
export function TicketTabPager({
  activeTab,
  onTabChange,
  overview,
  thread,
}: TicketTabPagerProps): ReactElement {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [hasMountedThread, setHasMountedThread] = useState(activeTab === 'thread');
  const showThread = hasMountedThread || activeTab === 'thread';

  const pageIndex = useSharedValue(getTicketTabIndex(activeTab));
  const dragStartX = useSharedValue(0);
  const translateX = useSharedValue(-getTicketTabIndex(activeTab) * width);
  const threadMountRequested = useSharedValue(activeTab === 'thread' ? 1 : 0);

  const commitTab = useCallback(
    (index: number) => {
      const nextTab = getTicketTabByIndex(index);
      // Runs on every settle, including a swipe that snaps back to where it
      // started — only buzz when the tab actually changed.
      if (nextTab !== activeTab) void haptics.selection();
      onTabChange(nextTab);
    },
    [activeTab, onTabChange],
  );

  const ensureThreadMounted = useCallback(() => {
    setHasMountedThread(true);
  }, []);

  // Avoid iOS back-gesture stealing Thread → Overview swipes.
  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: activeTab === 'overview',
      fullScreenGestureEnabled: false,
    });
    return () => {
      navigation.setOptions({
        gestureEnabled: true,
      });
    };
  }, [activeTab, navigation]);

  // Persist thread mount after first visit (tap or swipe) so chat doesn't remount.
  useEffect(() => {
    if (activeTab === 'thread') {
      setHasMountedThread(true);
      threadMountRequested.value = 1;
    }
  }, [activeTab, threadMountRequested]);

  // Tab bar / prop-driven page changes (not from this pager's pan).
  useEffect(() => {
    const index = getTicketTabIndex(activeTab);
    pageIndex.value = index;
    translateX.value = withTiming(-index * width, { duration: PAGE_SNAP_MS });
  }, [activeTab, pageIndex, translateX, width]);

  // Keep translate in sync when rotating / width changes.
  useEffect(() => {
    translateX.value = -pageIndex.value * width;
  }, [pageIndex, translateX, width]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-HORIZONTAL_ACTIVE_OFFSET, HORIZONTAL_ACTIVE_OFFSET])
        .failOffsetY([-VERTICAL_FAIL_OFFSET, VERTICAL_FAIL_OFFSET])
        .onBegin(() => {
          'worklet';
          cancelAnimation(translateX);
          dragStartX.value = translateX.value;
        })
        .onUpdate(event => {
          'worklet';
          const minX = -(TICKET_TAB_COUNT - 1) * width;
          const nextX = dragStartX.value + event.translationX;
          translateX.value = Math.max(minX, Math.min(0, nextX));
          // Mount thread as soon as swipe starts revealing it (avoid blank page mid-drag).
          if (nextX < -width * 0.05 && threadMountRequested.value === 0) {
            threadMountRequested.value = 1;
            runOnJS(ensureThreadMounted)();
          }
        })
        .onEnd(event => {
          'worklet';
          const projected = translateX.value + event.velocityX * 0.18;
          const rawIndex = Math.round(-projected / Math.max(width, 1));
          const nextIndex = Math.max(0, Math.min(TICKET_TAB_COUNT - 1, rawIndex));

          pageIndex.value = nextIndex;
          translateX.value = withTiming(-nextIndex * width, { duration: PAGE_SNAP_MS });
          runOnJS(commitTab)(nextIndex);
        }),
    [
      commitTab,
      dragStartX,
      ensureThreadMounted,
      pageIndex,
      threadMountRequested,
      translateX,
      width,
    ],
  );

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              flex: 1,
              flexDirection: 'row',
              width: width * TICKET_TAB_COUNT,
            },
            pagerStyle,
          ]}
        >
          <View style={{ width, flex: 1 }}>{overview}</View>
          <View style={{ width, flex: 1 }}>{showThread ? thread : null}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
