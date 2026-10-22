import { useEffect, type ReactElement } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

const Bone = ({
  width,
  height = 12,
  radius = 6,
}: {
  width: number | `${number}%`;
  height?: number;
  radius?: number;
}): ReactElement => (
  <View className='bg-foreground/10' style={{ width, height, borderRadius: radius }} />
);

const SubagentRow = (): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 10,
    }}
  >
    <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Bone width='42%' height={14} />
        <Bone width={64} height={16} radius={999} />
      </View>
      <Bone width='78%' height={12} />
    </View>
    <Bone width={12} height={12} radius={3} />
  </View>
);

const McpCard = (): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 12,
      gap: 10,
    }}
  >
    <View className='rounded-lg bg-foreground/10' style={{ width: 36, height: 36 }} />
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
      <Bone width='70%' height={13} />
      <Bone width='92%' height={11} />
    </View>
    <Bone width={12} height={12} radius={3} />
  </View>
);

const McpSection = ({ cards }: { cards: number }): ReactElement => (
  <View style={{ gap: 8 }}>
    <View className='px-1'>
      <Bone width={88} height={14} />
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
      {Array.from({ length: cards }, (_, index) => (
        <View key={index} style={{ width: '50%', paddingHorizontal: 4 }}>
          <McpCard />
        </View>
      ))}
    </View>
  </View>
);

const usePulseStyle = (): AnimatedStyle<ViewStyle> => {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.5, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  return useAnimatedStyle(() => ({ opacity: pulse.value }));
};

export const SubagentBrowseSkeleton = (): ReactElement => {
  const animatedStyle = usePulseStyle();
  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading subagents'>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
        {Array.from({ length: 8 }, (_, index) => (
          <View key={index} style={{ width: '50%', paddingHorizontal: 4, paddingVertical: 4 }}>
            <SubagentRow />
          </View>
        ))}
      </View>
    </Animated.View>
  );
};

export const McpBrowseSkeleton = (): ReactElement => {
  const animatedStyle = usePulseStyle();
  return (
    <Animated.View style={[animatedStyle, { gap: 24 }]} accessibilityLabel='Loading MCPs'>
      <McpSection cards={4} />
      <McpSection cards={4} />
    </Animated.View>
  );
};

export const BuiltinBrowseSkeleton = (): ReactElement => {
  const animatedStyle = usePulseStyle();
  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading built-in tools'>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Bone width={92} height={26} radius={999} />
        <Bone width={108} height={26} radius={999} />
        <Bone width={80} height={26} radius={999} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
        {Array.from({ length: 8 }, (_, index) => (
          <View key={index} style={{ width: '50%', paddingHorizontal: 4, paddingVertical: 6 }}>
            <View style={{ gap: 8, paddingHorizontal: 8, paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Bone width='58%' height={13} />
                <Bone width={54} height={16} radius={999} />
              </View>
              <Bone width='72%' height={11} />
            </View>
          </View>
        ))}
      </View>
    </Animated.View>
  );
};
