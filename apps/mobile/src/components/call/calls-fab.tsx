import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { CalendarDays, Phone, Plus } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

import {
  FAB_RADIUS,
  FAB_SIZE,
  useFabScreenBottomOffset,
} from '@/src/components/chat/channel-list/channel-list-layout';
import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { GlassSurface } from '@/src/components/ui/glass-surface';
import { haptics } from '@/src/utils/haptics';

const AnimatedPlus = Animated.createAnimatedComponent(Plus);

const ACTION_GAP = 16;
const ACTION_SPRING = { damping: 16, stiffness: 220, mass: 0.7 };

interface CallsFabProps {
  onStartCall: () => void;
  onScheduleCall: () => void;
  isHidden?: boolean;
}

interface ActionProps {
  slot: number;
  label: string;
  icon: ReactElement;
  progress: SharedValue<number>;
  expanded: boolean;
  onPress: () => void;
}

const FabAction = ({
  slot,
  label,
  icon,
  progress,
  expanded,
  onPress,
}: ActionProps): ReactElement => {
  const { accentBg } = useBubbleAccent();
  const cardColor = useCSSVariable('--color-card') as string;
  const distance = slot * (FAB_SIZE + ACTION_GAP);
  const style = useAnimatedStyle(() => {
    // Nearest row leads on open, farthest leads on close.
    const lag = (slot - 1) * 0.2;
    const p = interpolate(progress.get(), [lag, lag + 0.8], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * distance }, { scale: 0.6 + 0.4 * p }],
    };
  });
  return (
    <Animated.View
      pointerEvents={expanded ? 'auto' : 'none'}
      className='absolute right-0 origin-right'
      style={[{ bottom: distance }, style]}
    >
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={label}
        onPress={onPress}
        className='flex-row items-center gap-3 active:opacity-80'
      >
        <View className='h-12 justify-center rounded-2xl bg-card px-5'>
          <Text className='text-base font-semibold text-foreground'>{label}</Text>
        </View>
        <View className='size-12 items-center justify-center overflow-hidden rounded-[14px]'>
          <GlassSurface
            interactive
            fallbackColor={cardColor}
            style={{
              position: 'absolute',
              width: FAB_SIZE,
              height: FAB_SIZE,
              borderRadius: FAB_RADIUS,
            }}
          />
          <View className='absolute inset-0 opacity-20' style={{ backgroundColor: accentBg }} />
          <View
            className='absolute inset-0 rounded-[14px] border-[1.5px] opacity-60'
            style={{ borderColor: accentBg }}
          />
          {icon}
        </View>
      </Pressable>
    </Animated.View>
  );
};

export const CallsFab = ({
  onStartCall,
  onScheduleCall,
  isHidden = false,
}: CallsFabProps): ReactElement | null => {
  const { mode } = useDisplayMode();
  const { accentBg, accentFg } = useBubbleAccent();
  const closeIconColor = useCSSVariable('--color-background') as string;
  const isFocused = useTabPageIsFocused();
  const fabBottomOffset = useFabScreenBottomOffset();
  const closeFill = useCSSVariable('--color-foreground') as string;

  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withSpring(expanded ? 1 : 0, ACTION_SPRING));
  }, [expanded, progress]);
  // Collapse when hidden or when the tab loses focus, so it never reopens expanded.
  useEffect(() => {
    if (isHidden || !isFocused) setExpanded(false);
  }, [isHidden, isFocused]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.85 }));
  // Morph: accent square -> neutral circle.
  const fabShellStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [accentBg, closeFill]),
    borderRadius: interpolate(progress.get(), [0, 1], [FAB_RADIUS, FAB_SIZE / 2]),
  }));
  // A "+" turned 45° is an "x": one icon, rotated, recoloured to stay visible on the circle.
  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.get() * 45}deg` }],
  }));
  const plusProps = useAnimatedProps(() => ({
    color: interpolateColor(progress.get(), [0, 1], [accentFg, closeIconColor]),
  }));

  const fabVisibility = useSharedValue(isHidden ? 0 : 1);
  useEffect(() => {
    fabVisibility.set(
      withSpring(isHidden ? 0 : 1, {
        damping: 12,
        stiffness: 220,
        mass: 0.6,
      }),
    );
  }, [isHidden, fabVisibility]);

  const fabVisibilityStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabVisibility.get() }],
    opacity: fabVisibility.get(),
  }));

  if (!isFocused) return null;

  const handlePress = (): void => {
    void haptics.buttonTap();
    setExpanded(e => !e);
  };

  const choose = (action: () => void) => (): void => {
    void haptics.selection();
    setExpanded(false);
    action();
  };

  return (
    <Portal name='calls-fab' hostName={TAB_OVERLAY_PORTAL_HOST}>
      <View pointerEvents='box-none' className='absolute inset-0 z-[1100]'>
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          className='absolute inset-0'
          style={scrimStyle}
        >
          <Pressable onPress={() => setExpanded(false)} className='absolute inset-0 bg-black' />
        </Animated.View>
        <View
          pointerEvents='box-none'
          className='absolute right-6 h-44 w-70'
          style={{ bottom: fabBottomOffset }}
        >
          <FabAction
            slot={2}
            label='Schedule a call'
            icon={<CalendarDays size={22} color={accentBg} />}
            progress={progress}
            expanded={expanded}
            onPress={choose(onScheduleCall)}
          />
          <FabAction
            slot={1}
            label='Start a call'
            icon={<Phone size={22} color={accentBg} />}
            progress={progress}
            expanded={expanded}
            onPress={choose(onStartCall)}
          />
        </View>
        <Animated.View
          pointerEvents={isHidden ? 'none' : 'auto'}
          className='absolute right-6 size-12 border-[0.5px] shadow-[0px_6px_14px_0px_rgba(0,0,0,0.22)]'
          style={[
            { bottom: fabBottomOffset, borderColor: accentBg },
            fabShellStyle,
            fabVisibilityStyle,
          ]}
        >
          <Animated.View
            pointerEvents='none'
            className='absolute inset-0 items-center justify-center'
            style={plusStyle}
          >
            <AnimatedPlus size={24} strokeWidth={2.2} animatedProps={plusProps} />
          </Animated.View>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={expanded ? 'Close call options' : 'Open call options'}
            onPress={handlePress}
            className='absolute inset-0'
          />
        </Animated.View>
      </View>
    </Portal>
  );
};
