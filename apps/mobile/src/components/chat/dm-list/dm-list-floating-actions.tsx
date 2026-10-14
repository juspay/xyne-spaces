import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CreateDmDrawer } from '@/src/components/chat/create-dm-drawer';
import {
  FabQuickJumpOverlay,
  QUICK_JUMP_TOKEN_SIZE,
  type QuickJumpItem,
} from '@/src/components/ui/fab-quick-jump-overlay';
import Avatar from '@/src/components/ui/avatar';
import { getAvatarAccentColor } from '@/src/components/ui/avatar/avatar.utils';
import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useAuth } from '@/src/contexts/AuthContext';
import { useStarredDms } from '@/src/hooks/useStarredDms';
import { useCloseOnScreenBlur } from '@/src/hooks/useCloseOnScreenBlur';
import { useOverlayPresence, useSafeTimeout } from '@/src/hooks/useOverlayPresence';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { getDmAvatarUserIds } from '@/src/utils/channel-utils';
import {
  FAB_LONG_PRESS_DELAY,
  FAB_RADIUS,
  FAB_RIGHT,
  FAB_SHADOW,
  FAB_SIZE,
  useFabScreenBottomOffset,
} from '../channel-list/channel-list-layout';

/** Above TabsScreenHeader's z-index of 1000 so the scrim dims it like Slack. */
const ROOT_Z_INDEX = 1100;
const PORTAL_NAME = 'dm-list-floating-actions';

const OPEN_DURATION = 340;
const CLOSE_DURATION = 200;

/**
 * The DMs tab shares the channels tab's floating button: same accent square,
 * same chrome. A tap opens the compose sheet directly; a long press springs
 * the Slack-style fan of starred DMs — the screen dims, circular bubbles
 * cascade up out of the button (bottom row first, names trailing in), the
 * plus rotates 45° into a close ✕, and a "New chat" pill sits where Slack
 * keeps "Manage VIP". With no starred DMs the long press falls back to the
 * tap behaviour.
 */
export const DmListFloatingActions = (): ReactElement => {
  const router = useRouter();
  const isFocused = useTabPageIsFocused();
  const { accentBg, accentFg } = useBubbleAccent();
  const starredDms = useStarredDms();
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';

  const [isCreateDmOpen, setIsCreateDmOpen] = useState(false);
  const [isFanOpen, setIsFanOpen] = useState(false);
  // Held through the close animation so the fan collapses on-screen.
  const isFanMounted = useOverlayPresence(isFanOpen, CLOSE_DURATION);
  const scheduleTimeout = useSafeTimeout();

  const bottomOffset = useFabScreenBottomOffset();
  const cardBg = (useCSSVariable('--color-bottomsheet-container-bg') as string) || accentBg;

  const fanProgress = useSharedValue(0);

  useCloseOnScreenBlur(() => {
    setIsFanOpen(false);
    setIsCreateDmOpen(false);
  });

  useEffect(() => {
    fanProgress.value = withTiming(isFanOpen ? 1 : 0, {
      duration: isFanOpen ? OPEN_DURATION : CLOSE_DURATION,
      easing: isFanOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [isFanOpen, fanProgress]);

  const openFan = useCallback(() => {
    setIsFanOpen(true);
  }, []);

  const closeFan = useCallback(() => {
    setIsFanOpen(false);
  }, []);

  const handleFabPress = useCallback(() => {
    void haptics.buttonTap();
    if (isFanOpen) {
      closeFan();
      return;
    }
    setIsCreateDmOpen(true);
  }, [isFanOpen, closeFan]);

  const handleFabLongPress = useCallback(() => {
    if (starredDms.length === 0) {
      handleFabPress();
      return;
    }
    void haptics.longPress();
    setIsCreateDmOpen(false);
    openFan();
  }, [handleFabPress, starredDms.length, openFan]);

  const handleEntryPress = useCallback(
    (channelId: string) => {
      closeFan();
      openBaseChatRoute(router, channelId, { surface: 'dms' });
    },
    [router, closeFan],
  );

  const fanItems = useMemo<QuickJumpItem[]>(
    () =>
      starredDms.map(entry => {
        const label = entry.title || 'Unknown';
        const avatarUserIds = getDmAvatarUserIds(entry.channel, currentUserId);
        return {
          id: entry.channelId,
          label,
          token:
            avatarUserIds.length > 0 ? (
              <Avatar userIds={avatarUserIds} size={QUICK_JUMP_TOKEN_SIZE} />
            ) : (
              <View
                style={[
                  styles.fallbackAvatar,
                  { backgroundColor: getAvatarAccentColor(entry.channelId) },
                ]}
              >
                <Text className='text-[15px] font-bold text-white'>
                  {label.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            ),
        };
      }),
    [starredDms, currentUserId],
  );

  const handleCreateDm = useCallback(() => {
    void haptics.buttonTap();
    closeFan();
    // Let the fan collapse before the sheet presents over the same corner.
    scheduleTimeout(() => setIsCreateDmOpen(true), CLOSE_DURATION);
  }, [closeFan, scheduleTimeout]);

  // Same 45° the channels fab uses for its open state — a rotated plus is
  // the close ✕, so the two buttons never drift apart visually.
  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fanProgress.value * 45}deg` }],
  }));

  const floatingActions = (
    <View pointerEvents='box-none' style={[StyleSheet.absoluteFill, styles.root]}>
      {/* One always-mounted layer holds everything the long press brings up, so
          the root's child list never changes shape. See the note on `styles`. */}
      <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
        {isFanMounted && starredDms.length > 0 && (
          <FabQuickJumpOverlay
            items={fanItems}
            progress={fanProgress}
            bottomOffset={bottomOffset}
            pillLabel='New chat'
            pillBackgroundColor={cardBg}
            onPillPress={handleCreateDm}
            onItemPress={handleEntryPress}
            onDismiss={closeFan}
            dismissAccessibilityLabel='Dismiss quick contacts'
          />
        )}
      </View>

      {/* Same accent square the channels tab paints — one chrome, kept in
          sync through channel-list-layout. */}
      <View
        style={[
          styles.fab,
          {
            bottom: bottomOffset,
            right: FAB_RIGHT,
            backgroundColor: accentBg,
            borderColor: accentBg,
          },
        ]}
      >
        <Animated.View
          pointerEvents='none'
          style={[StyleSheet.absoluteFill, styles.center, plusStyle]}
        >
          <Plus size={24} color={accentFg} strokeWidth={2.2} />
        </Animated.View>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={
            isFanOpen ? 'Close quick contacts' : 'Start a new direct message or group'
          }
          delayLongPress={FAB_LONG_PRESS_DELAY}
          onPress={handleFabPress}
          onLongPress={handleFabLongPress}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );

  return (
    <>
      {isFocused ? (
        <Portal name={PORTAL_NAME} hostName={TAB_OVERLAY_PORTAL_HOST}>
          {floatingActions}
        </Portal>
      ) : null}

      <CreateDmDrawer isOpen={isCreateDmOpen} onClose={() => setIsCreateDmOpen(false)} />
    </>
  );
};

/**
 * Paint order here is document order, not `zIndex`.
 *
 * The overlay used to be a set of `zIndex`-ranked siblings that mounted and
 * unmounted with the fan. iOS reorders a view's subviews to honour `zIndex`,
 * so a sibling set that changes shape mid-animation is the shakiest possible
 * arrangement — and the fan tears down while its close animation is still
 * running. Now the root has two permanent children, the overlay layer and the
 * button, and the button is last, so it paints on top for free.
 */
const styles = StyleSheet.create({
  root: {
    zIndex: ROOT_Z_INDEX,
  },
  fallbackAvatar: {
    width: QUICK_JUMP_TOKEN_SIZE,
    height: QUICK_JUMP_TOKEN_SIZE,
    borderRadius: QUICK_JUMP_TOKEN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    ...FAB_SHADOW,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
