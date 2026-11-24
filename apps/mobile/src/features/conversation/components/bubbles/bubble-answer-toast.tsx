import { memo, useEffect, type ReactElement } from 'react';
import { AccessibilityInfo, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  BUBBLE_SHADOW,
  BUBBLE_TOAST_ENTER_MS,
  BUBBLE_TOAST_ENTER_OFFSET,
  BUBBLE_TOAST_EXIT_MS,
  BUBBLE_TOAST_FACE_OVERLAP,
  BUBBLE_TOAST_FACE_SIZE,
  BUBBLE_TOAST_GAP,
  BUBBLE_TOAST_GLOW_CENTRES,
  BUBBLE_TOAST_GLOW_COLORS,
  BUBBLE_TOAST_GLOW_OPACITY,
  BUBBLE_TOAST_GLOW_RADIUS_SHARE,
  BUBBLE_TOAST_GLOW_SPREAD,
  BUBBLE_TOAST_HEIGHT,
  BUBBLE_TOAST_ICON_SIZE,
  BUBBLE_TOAST_INSET_X,
  BUBBLE_TOAST_LINGER_MS,
  BUBBLE_TOAST_OPEN_SIZE,
  BUBBLE_TOAST_PADDING_X,
} from '../../constants';
import { useSelfFace } from '../../hooks/use-self-face';
import type { BubbleToast } from '../../model/bubble-store';
import { fadeScaleTransition } from '../../model/fade-scale-transition';
import { colorOf } from '../../model/token-color';
import { IconButton } from '../icon-button';
import { OverlappingAvatars } from '../overlapping-avatars';

const TRANSITION = fadeScaleTransition({
  enterMs: BUBBLE_TOAST_ENTER_MS,
  exitMs: BUBBLE_TOAST_EXIT_MS,
  scale: 1,
  offsetY: BUBBLE_TOAST_ENTER_OFFSET,
});

/** Figma "Glow · agents only": blurred agent colour under the toast, never a stroke. */
const AgentGlow = memo(function AgentGlow({ width }: { width: number }): ReactElement {
  const glowWidth = width + BUBBLE_TOAST_GLOW_SPREAD * 2;
  const glowHeight = BUBBLE_TOAST_HEIGHT + BUBBLE_TOAST_GLOW_SPREAD * 2;
  return (
    <Svg
      pointerEvents='none'
      width={glowWidth}
      height={glowHeight}
      style={{
        position: 'absolute',
        left: -BUBBLE_TOAST_GLOW_SPREAD,
        top: BUBBLE_TOAST_GLOW_SPREAD / 2,
      }}
    >
      <Defs>
        {BUBBLE_TOAST_GLOW_COLORS.map((color, index) => (
          <RadialGradient key={color} id={`bubble-glow-${index}`}>
            <Stop offset='0' stopColor={color} stopOpacity={BUBBLE_TOAST_GLOW_OPACITY} />
            <Stop offset='1' stopColor={color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {BUBBLE_TOAST_GLOW_CENTRES.map((centre, index) => (
        <Ellipse
          key={centre}
          cx={glowWidth * centre}
          cy={glowHeight / 2}
          rx={glowWidth * BUBBLE_TOAST_GLOW_RADIUS_SHARE}
          ry={glowHeight / 2}
          fill={`url(#bubble-glow-${index})`}
        />
      ))}
    </Svg>
  );
});

type BubbleAnswerToastProps = {
  toast: BubbleToast;
  top: number;
  onOpen: (threadId: string) => void;
  onDismiss: (threadId: string) => void;
};

/**
 * Figma "Bubble / Answer toast": an agent answered a parked thread. It drops
 * under the status bar once, with the bubble's answered dot, faces the agent
 * then you, and lifts by itself after 6 s. Tapping it opens the thread.
 */
export const BubbleAnswerToast = memo(function BubbleAnswerToast({
  toast,
  top,
  onOpen,
  onDismiss,
}: BubbleAnswerToastProps): ReactElement {
  const { width: screenWidth } = useWindowDimensions();
  const self = useSelfFace();
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const width = screenWidth - BUBBLE_TOAST_INSET_X * 2;
  const who = `${toast.agentName ?? 'Agent'} answered`;
  const faceIds = self ? [...toast.agentIds, self.id] : toast.agentIds;
  const { threadId } = toast;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${who}: ${toast.title}`);
    const timer = setTimeout(() => onDismiss(threadId), BUBBLE_TOAST_LINGER_MS);
    return (): void => clearTimeout(timer);
  }, [onDismiss, threadId, toast.title, who]);

  return (
    <Animated.View
      entering={TRANSITION.entering}
      exiting={TRANSITION.exiting}
      style={{ position: 'absolute', top, left: BUBBLE_TOAST_INSET_X, width }}
    >
      <AgentGlow width={width} />
      <View
        className='flex-row items-center bg-spaces-surface-raised'
        style={{
          height: BUBBLE_TOAST_HEIGHT,
          borderRadius: BUBBLE_TOAST_HEIGHT / 2,
          paddingHorizontal: BUBBLE_TOAST_PADDING_X,
          columnGap: BUBBLE_TOAST_GAP,
          boxShadow: BUBBLE_SHADOW,
        }}
      >
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`${who}. ${toast.title}. Open thread`}
          onPress={() => onOpen(threadId)}
          className='min-w-0 flex-1 flex-row items-center active:opacity-60'
          style={{ columnGap: BUBBLE_TOAST_GAP, alignSelf: 'stretch' }}
        >
          <OverlappingAvatars
            userIds={faceIds}
            size={BUBBLE_TOAST_FACE_SIZE}
            overlap={BUBBLE_TOAST_FACE_OVERLAP}
            self={self}
          />
          <View className='min-w-0 flex-1'>
            <Text
              className='text-[14px] font-medium leading-[18px] tracking-[-0.14px] text-spaces-foreground'
              numberOfLines={1}
            >
              {who}
            </Text>
            <Text className='text-[12px] leading-4 text-spaces-muted' numberOfLines={1}>
              {toast.title}
            </Text>
          </View>
        </Pressable>
        <IconButton
          label='Open thread'
          size={BUBBLE_TOAST_OPEN_SIZE}
          onPress={() => onOpen(threadId)}
          className='bg-spaces-surface'
        >
          <ChevronRight size={BUBBLE_TOAST_ICON_SIZE} color={foreground} />
        </IconButton>
      </View>
    </Animated.View>
  );
});
