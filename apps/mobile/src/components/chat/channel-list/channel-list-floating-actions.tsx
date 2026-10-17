import { Hash, Layers, Lock, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { CreateChannelDrawer } from '@/src/components/chat/create-channel-drawer';
import { CreateSectionSheet } from './create-section-sheet';
import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import {
  FabQuickJumpOverlay,
  QUICK_JUMP_TOKEN_SIZE,
  type QuickJumpItem,
} from '@/src/components/ui/fab-quick-jump-overlay';
import { useStarredChannels } from '@/src/hooks/useStarredChannels';
import { useCloseOnScreenBlur } from '@/src/hooks/useCloseOnScreenBlur';
import { useOverlayPresence } from '@/src/hooks/useOverlayPresence';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { ChannelVisibility } from '@xyne/shared';
import {
  FAB_LONG_PRESS_DELAY,
  FAB_RADIUS,
  FAB_RIGHT,
  FAB_SHADOW,
  FAB_SIZE,
  useFabScreenBottomOffset,
} from './channel-list-layout';

/**
 * The FAB and the create menu are the same view: opening the menu morphs the
 * accent square into the menu card anchored on its bottom-right corner, so the
 * button is never visible alongside the surface it opened.
 */
const CARD_RADIUS = 20;
const CARD_MAX_WIDTH = 320;
/** Height used until the menu content reports its own — two rows at rest. */
const CARD_ESTIMATED_HEIGHT = 168;
/** Above TabsScreenHeader's z-index of 1000 so the scrim dims it like the DM list. */
const ROOT_Z_INDEX = 1100;
const PORTAL_NAME = 'channel-list-floating-actions';

/** Fill behind a channel's glyph in the quick jump, over the dark backdrop. */
const TOKEN_BG = 'rgba(255, 255, 255, 0.18)';

const OPEN_DURATION = 260;
const CLOSE_DURATION = 190;

const QUICK_JUMP_OPEN_DURATION = 280;
const QUICK_JUMP_CLOSE_DURATION = 180;

export const ChannelListFloatingActions = (): ReactElement => {
  const router = useRouter();
  const isFocused = useTabPageIsFocused();
  const { width: windowWidth } = useWindowDimensions();
  const { accentBg, accentFg } = useBubbleAccent();
  const { starredChannels, starredUnreadCounts } = useStarredChannels();

  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isCreateSectionOpen, setIsCreateSectionOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isStarredOpen, setIsStarredOpen] = useState(false);
  // Held through the close animation so the quick jump collapses on-screen,
  // the same way the DMs tab's fan does.
  const isStarredMounted = useOverlayPresence(isStarredOpen, QUICK_JUMP_CLOSE_DURATION);

  const bottomOffset = useFabScreenBottomOffset();
  const cardWidth = Math.min(CARD_MAX_WIDTH, windowWidth - FAB_RIGHT * 2);

  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const borderColor = (useCSSVariable('--color-border') as string) || accentBg;
  const cardBg = (useCSSVariable('--color-bottomsheet-container-bg') as string) || accentBg;

  const menuProgress = useSharedValue(0);
  const starredProgress = useSharedValue(0);
  const cardHeight = useSharedValue(CARD_ESTIMATED_HEIGHT);

  useCloseOnScreenBlur(() => {
    setIsMenuOpen(false);
    setIsStarredOpen(false);
    setIsCreateChannelOpen(false);
    setIsCreateSectionOpen(false);
  });

  useEffect(() => {
    menuProgress.value = withTiming(isMenuOpen ? 1 : 0, {
      duration: isMenuOpen ? OPEN_DURATION : CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [isMenuOpen, menuProgress]);

  useEffect(() => {
    starredProgress.value = withTiming(isStarredOpen ? 1 : 0, {
      duration: isStarredOpen ? QUICK_JUMP_OPEN_DURATION : QUICK_JUMP_CLOSE_DURATION,
      easing: isStarredOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [isStarredOpen, starredProgress]);

  // Android's back gesture closes the create menu rather than leaving the tab.
  // The quick jump handles its own back press inside the shared overlay.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isMenuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setIsMenuOpen(false);
      return true;
    });
    return (): void => subscription.remove();
  }, [isMenuOpen]);

  const handleFabPress = useCallback(() => {
    void haptics.buttonTap();
    if (isStarredOpen) {
      setIsStarredOpen(false);
      return;
    }
    setIsMenuOpen(true);
  }, [isStarredOpen]);

  const handleFabLongPress = useCallback(() => {
    if (starredChannels.length === 0) {
      handleFabPress();
      return;
    }
    void haptics.longPress();
    setIsMenuOpen(false);
    setIsStarredOpen(true);
  }, [handleFabPress, starredChannels.length]);

  const handleDismissBackdrop = useCallback(() => {
    setIsMenuOpen(false);
    setIsStarredOpen(false);
  }, []);

  /**
   * The sheets open in the same tick as the dismissal, so the tap costs
   * nothing. The menu's morph back into the FAB and the quick jump's collapse
   * play out underneath the rising sheet rather than ahead of it — the sheet
   * is fullscreen and covers that corner almost at once. Both entry points
   * close here: the create menu and the quick jump's "New channel" pill reach
   * the same drawer.
   */
  const handleCreateChannel = useCallback(() => {
    setIsMenuOpen(false);
    setIsStarredOpen(false);
    setIsCreateChannelOpen(true);
  }, []);

  const handleCreateSection = useCallback(() => {
    setIsMenuOpen(false);
    setIsStarredOpen(false);
    setIsCreateSectionOpen(true);
  }, []);

  const handleStarredChannelPress = useCallback(
    (channelId: string) => {
      setIsStarredOpen(false);
      openBaseChatRoute(router, channelId, { surface: 'channels' });
    },
    [router],
  );

  const starredItems = useMemo<QuickJumpItem[]>(
    () =>
      starredChannels.map(channel => {
        const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
        const Glyph = isPrivate ? Lock : Hash;
        return {
          id: channel.id,
          label: channel.name ?? 'Unnamed channel',
          hasUnread: (starredUnreadCounts.get(channel.id) ?? 0) > 0,
          token: (
            <View
              className='items-center justify-center'
              style={{
                width: QUICK_JUMP_TOKEN_SIZE,
                height: QUICK_JUMP_TOKEN_SIZE,
                backgroundColor: TOKEN_BG,
              }}
            >
              <Glyph size={20} color='#ffffff' strokeWidth={2.2} />
            </View>
          ),
        };
      }),
    [starredChannels, starredUnreadCounts],
  );

  const handleContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      if (height > 0) {
        cardHeight.value = height;
      }
    },
    [cardHeight],
  );

  const morphStyle = useAnimatedStyle(() => {
    const progress = menuProgress.value;
    return {
      width: interpolate(progress, [0, 1], [FAB_SIZE, cardWidth], Extrapolation.CLAMP),
      height: interpolate(progress, [0, 1], [FAB_SIZE, cardHeight.value], Extrapolation.CLAMP),
      borderRadius: interpolate(progress, [0, 1], [FAB_RADIUS, CARD_RADIUS], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(progress, [0, 0.45], [accentBg, cardBg]),
      borderColor: interpolateColor(progress, [0, 0.45], [accentBg, borderColor]),
    };
  });

  const clipStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(
      menuProgress.value,
      [0, 1],
      [FAB_RADIUS, CARD_RADIUS],
      Extrapolation.CLAMP,
    ),
  }));

  const plusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
    transform: [{ rotate: `${(menuProgress.value + starredProgress.value) * 45}deg` }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0.3, 0.75], [0, 1], Extrapolation.CLAMP),
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
  }));

  const menuActions = [
    {
      icon: <Hash size={19} color={mutedColor} strokeWidth={2} />,
      title: 'Channel',
      description: 'Organise teams and work around a topic',
      onPress: handleCreateChannel,
    },
    {
      icon: <Layers size={19} color={mutedColor} strokeWidth={2} />,
      title: 'Section',
      description: 'Group channels into your own folders',
      onPress: handleCreateSection,
    },
  ];

  const floatingActions = (
    <View pointerEvents='box-none' style={[StyleSheet.absoluteFill, { zIndex: ROOT_Z_INDEX }]}>
      {/* One always-mounted layer holds both overlays, so the root's child list
          never changes shape. See the note on `styles`. */}
      <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
        {isMenuOpen && (
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityLabel='Dismiss create menu'
              onPress={handleDismissBackdrop}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}

        {isStarredMounted && starredChannels.length > 0 && (
          <FabQuickJumpOverlay
            items={starredItems}
            progress={starredProgress}
            bottomOffset={bottomOffset}
            pillLabel='New channel'
            pillBackgroundColor={cardBg}
            onPillPress={handleCreateChannel}
            onItemPress={handleStarredChannelPress}
            onDismiss={handleDismissBackdrop}
            dismissAccessibilityLabel='Dismiss starred channels'
          />
        )}
      </View>

      {/* FAB ⇄ create menu — one view, two shapes */}
      <Animated.View
        pointerEvents='box-none'
        style={[styles.morph, { bottom: bottomOffset, right: FAB_RIGHT }, morphStyle]}
      >
        <Animated.View
          pointerEvents='box-none'
          style={[StyleSheet.absoluteFill, styles.clip, clipStyle]}
        >
          <Animated.View
            pointerEvents='none'
            style={[StyleSheet.absoluteFill, styles.center, plusStyle]}
          >
            <Plus size={24} color={accentFg} strokeWidth={2.2} />
          </Animated.View>

          <Animated.View
            onLayout={handleContentLayout}
            pointerEvents={isMenuOpen ? 'auto' : 'none'}
            style={[styles.content, { width: cardWidth }, contentStyle]}
          >
            {menuActions.map((action, index) => (
              <MenuItem
                key={action.title}
                icon={action.icon}
                title={action.title}
                description={action.description}
                onPress={action.onPress}
                index={index}
                progress={menuProgress}
                borderColor={borderColor}
              />
            ))}
          </Animated.View>
        </Animated.View>

        {!isMenuOpen && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={
              isStarredOpen ? 'Close starred channels' : 'Create channel or section'
            }
            delayLongPress={FAB_LONG_PRESS_DELAY}
            onPress={handleFabPress}
            onLongPress={handleFabLongPress}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Animated.View>
    </View>
  );

  return (
    <>
      {isFocused ? (
        <Portal name={PORTAL_NAME} hostName={TAB_OVERLAY_PORTAL_HOST}>
          {floatingActions}
        </Portal>
      ) : null}

      <CreateChannelDrawer
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
      />
      <CreateSectionSheet
        isOpen={isCreateSectionOpen}
        onClose={() => setIsCreateSectionOpen(false)}
      />
    </>
  );
};

type MenuItemProps = {
  icon: ReactElement;
  title: string;
  description: string;
  onPress: () => void;
  index: number;
  progress: SharedValue<number>;
  borderColor: string;
};

function MenuItem({
  icon,
  title,
  description,
  onPress,
  index,
  progress,
  borderColor,
}: MenuItemProps): ReactElement {
  /** Rows cascade in behind the morph so the card fills rather than pops. */
  const animatedStyle = useAnimatedStyle(() => {
    const start = 0.35 + index * 0.08;
    const itemProgress = interpolate(
      progress.value,
      [start, start + 0.35],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: itemProgress,
      transform: [{ translateY: interpolate(itemProgress, [0, 1], [10, 0], Extrapolation.CLAMP) }],
    };
  });

  const handlePress = useCallback(() => {
    void haptics.buttonTap();
    onPress();
  }, [onPress]);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole='button'
        onPress={handlePress}
        className='flex-row items-center px-4 py-3.5 active:opacity-60'
        style={
          index > 0
            ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }
            : null
        }
      >
        <View className='size-9 rounded-[10px] items-center justify-center bg-slate-400/15'>
          {icon}
        </View>
        <View className='flex-1 min-w-0 ml-3.5'>
          <Text className='text-[15px] font-semibold text-foreground'>{title}</Text>
          <Text className='text-[12.5px] text-secondary-foreground mt-0.5' numberOfLines={1}>
            {description}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Paint order here is document order, not `zIndex`.
 *
 * The overlays used to be `zIndex`-ranked siblings of the button that mounted
 * and unmounted with them. iOS reorders a view's subviews to honour `zIndex`,
 * so a sibling set that changes shape mid-animation is the shakiest possible
 * arrangement. Now the root has two permanent children, the overlay layer and
 * the button, and the button is last, so it paints on top for free.
 */
const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  morph: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    ...FAB_SHADOW,
  },
  clip: {
    overflow: 'hidden',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
});
