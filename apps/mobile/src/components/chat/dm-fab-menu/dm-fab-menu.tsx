import { useEffect, useState, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';

import { GlassSurface } from '@/src/components/ui/glass-surface';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

import Avatar from '@/src/components/ui/avatar';
import { Portal } from '@/src/components/primitives/portal/portal';
import { FAB_GAP_ABOVE_TAB_BAR } from '@/src/components/ui/fab-layout';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

export type DmFabMenuItem = {
  id: string;
  name: string;
  avatarUserId?: string;
  avatarUrl?: string;
};

interface DmFabMenuProps {
  recentDms: DmFabMenuItem[];
  onCreateDm: () => void;
  onSelectDm: (id: string) => void;
  isHidden?: boolean;
}

const FAB_SIZE = 48;
const FAB_RIGHT_OFFSET = 28;

const styles = StyleSheet.create({
  /** Matches the previous `rounded-xl` on the Pressable. */
  fabSurface: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
const PILL_GAP_FROM_FAB = 12;
const ROW_GAP = 14;
const ROW_BOTTOM_PADDING = 20;
const FAB_ROTATION_DURATION = 220;

export const DmFabMenu = ({
  recentDms,
  onCreateDm,
  onSelectDm,
  isHidden = false,
}: DmFabMenuProps): ReactElement | null => {
  const { accentBg, accentFg } = useBubbleAccent();
  const { tabBarHeight, tabBarPaddingBottom } = useTabBarHeight();
  const isFocused = useTabPageIsFocused();

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isFocused && isExpanded) {
      setIsExpanded(false);
    }
  }, [isFocused, isExpanded]);

  useEffect(() => {
    if (isHidden && isExpanded) {
      setIsExpanded(false);
    }
  }, [isHidden, isExpanded]);

  const fabBottom = tabBarHeight + FAB_GAP_ABOVE_TAB_BAR;
  const rowsBottom = fabBottom + FAB_SIZE + ROW_BOTTOM_PADDING;

  const FAB_HEIGHT = Platform.OS === 'ios' ? tabBarPaddingBottom : 112;

  const fabRotation = useSharedValue(0);
  useEffect(() => {
    fabRotation.set(
      withTiming(isExpanded ? 45 : 0, {
        duration: FAB_ROTATION_DURATION,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [isExpanded, fabRotation]);
  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabRotation.get()}deg` }],
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

  const expand = (): void => {
    if (recentDms.length === 0) {
      onCreateDm();
      return;
    }
    void haptics.gestureStart();
    setIsExpanded(true);
  };

  const collapse = (): void => {
    setIsExpanded(false);
  };

  const handleFabPress = (): void => {
    if (isExpanded) {
      void haptics.gestureEnd();
      collapse();
      return;
    }
    onCreateDm();
  };

  const handleSelectRow = (id: string): void => {
    void haptics.selection();
    setIsExpanded(false);
    onSelectDm(id);
  };

  const handleCreateNewPress = (): void => {
    void haptics.buttonTap();
    setIsExpanded(false);
    onCreateDm();
  };

  if (!isFocused) return null;

  return (
    <Portal name='dm-fab-menu'>
      <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
        {/* 1. Scrim — rendered first so it sits behind everything else in this component */}
        {isExpanded && (
          <Animated.View
            entering={FadeIn.duration(160).easing(Easing.out(Easing.cubic))}
            exiting={FadeOut.duration(140).easing(Easing.in(Easing.cubic))}
            style={StyleSheet.absoluteFill}
          >
            <Pressable onPress={collapse} style={StyleSheet.absoluteFill} className='bg-black/90' />
          </Animated.View>
        )}

        {/* 2. Recent-DM rows — stacked above the FAB, right-aligned */}
        {isExpanded && (
          <View
            pointerEvents='box-none'
            style={{
              position: 'absolute',
              right: FAB_RIGHT_OFFSET,
              bottom: rowsBottom,
              alignItems: 'flex-end',
            }}
          >
            {recentDms.map((item, i) => (
              <Animated.View
                key={item.id}
                entering={SlideInRight.duration(260)
                  .easing(Easing.out(Easing.cubic))
                  .delay((recentDms.length - 1 - i) * 35)}
                exiting={SlideOutRight.duration(150).easing(Easing.in(Easing.cubic))}
                style={{ marginBottom: i === recentDms.length - 1 ? 0 : ROW_GAP }}
                pointerEvents='box-none'
              >
                <Pressable
                  onPress={() => handleSelectRow(item.id)}
                  className='flex-row items-center'
                  style={{ gap: 10 }}
                >
                  <Text className='text-white text-[15px] font-semibold'>{item.name}</Text>
                  <Avatar
                    userIds={item.avatarUserId ? [item.avatarUserId] : []}
                    size={40}
                    rounded={false}
                  />
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}

        {/* 3. "New DM" pill — sits on the same row as the FAB, immediately to its left */}
        {isExpanded && (
          <Animated.View
            entering={FadeIn.duration(180).delay(40)}
            exiting={FadeOut.duration(120)}
            style={{
              position: 'absolute',
              right: FAB_RIGHT_OFFSET + FAB_SIZE + PILL_GAP_FROM_FAB,
              bottom: fabBottom,
            }}
          >
            <Pressable
              onPress={handleCreateNewPress}
              style={{
                backgroundColor: '#dbeafe',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.25)',
                paddingHorizontal: 24,
                height: FAB_SIZE,
                borderRadius: FAB_SIZE / 2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#1e40af' }} className='text-[15px] font-semibold'>
                New DM
              </Text>
            </Pressable>
          </Animated.View>
        )}

        {/* 4. The FAB itself — rendered LAST so it paints on top of the scrim. Always mounted. */}
        <Animated.View
          pointerEvents={isHidden ? 'none' : 'auto'}
          style={[
            {
              position: 'absolute',
              bottom: FAB_HEIGHT,
              right: FAB_RIGHT_OFFSET,
              width: FAB_SIZE,
              height: FAB_SIZE,
            },
            fabVisibilityStyle,
          ]}
        >
          <Pressable
            onPress={handleFabPress}
            onLongPress={expand}
            className='size-full active:opacity-90'
          >
            <GlassSurface
              interactive
              fallbackColor={accentBg}
              tintColor={accentBg}
              style={styles.fabSurface}
            >
              <Animated.View style={fabIconStyle}>
                <Plus size={24} color={accentFg} />
              </Animated.View>
            </GlassSurface>
          </Pressable>
        </Animated.View>
      </View>
    </Portal>
  );
};

export default DmFabMenu;
