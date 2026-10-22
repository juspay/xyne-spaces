import { Ionicons } from '@expo/vector-icons';
import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type View as ViewType,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useCloseOnScreenBlur } from '@/src/hooks/useCloseOnScreenBlur';
import { useOverlayPresence } from '@/src/hooks/useOverlayPresence';
import { withAlpha } from '@/src/utils/color';
import { haptics } from '@/src/utils/haptics';

import { subscribeDmListContextMenus } from './dm-list-context-menu-events';
import {
  getDmListContextMenuActions,
  type DmListContextMenuAction,
  type DmListItemContextMenuProps,
} from './dm-list-item-context-menu.types';

export type { DmListItemContextMenuProps } from './dm-list-item-context-menu.types';

const LONG_PRESS_DELAY_MS = 400;
const CLOSE_DURATION = 160;
const MENU_GAP = 2;
const SCREEN_GUTTER = 12;
const MENU_WIDTH = 220;
const CARET_SIZE = 18;
const ROW_RADIUS = 16;

type AnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const IONICONS_BY_ACTION: Record<
  DmListContextMenuAction['systemImage'],
  keyof typeof Ionicons.glyphMap
> = {
  'envelope.open': 'mail-open-outline',
  star: 'star-outline',
  'star.fill': 'star',
  archivebox: 'archive-outline',
};

export function DmListItemContextMenu({
  item,
  children,
  onToggleStar,
  onMarkAsRead,
  onArchive,
}: DmListItemContextMenuProps): ReactElement {
  const rowRef = useRef<ViewType>(null);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const isOpen = anchorRect !== null;
  const isMounted = useOverlayPresence(isOpen, CLOSE_DURATION);
  const progress = useSharedValue(0);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const menuBg = useCSSVariable('--color-bottomsheet-container-bg') as string;
  const surfaceColor = useCSSVariable('--color-tabs-screen') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const pressedBackgroundColor = withAlpha(foregroundColor, 0.08);

  const actions = useMemo(() => getDmListContextMenuActions(item), [item]);

  const closeMenu = useCallback(() => {
    setAnchorRect(null);
  }, []);

  useCloseOnScreenBlur(closeMenu);

  useEffect(() => subscribeDmListContextMenus(closeMenu), [closeMenu]);

  useEffect(() => {
    if (isOpen) {
      progress.value = withSpring(1, { damping: 18, stiffness: 280, mass: 0.7 });
      return;
    }

    progress.value = withTiming(0, {
      duration: CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
    });
  }, [isOpen, progress]);

  const handleLongPress = useCallback(() => {
    void haptics.longPress();
    rowRef.current?.measureInWindow((x, y, width, height) => {
      setAnchorRect({ x, y, width, height });
    });
  }, []);

  const handleAction = useCallback(
    (action: DmListContextMenuAction): void => {
      void haptics.selection();
      switch (action.id) {
        case 'read':
          onMarkAsRead(item.id);
          break;
        case 'star':
          onToggleStar(item.id);
          break;
        case 'archive':
          onArchive(item.id);
          break;
      }
      closeMenu();
    },
    [closeMenu, item.id, onArchive, onMarkAsRead, onToggleStar],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const clusterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0.9, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [8, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  const rowPreviewStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.02], Extrapolation.CLAMP) }],
  }));

  const layout = useMemo(() => {
    if (!anchorRect) {
      return {
        openBelow: true,
        left: SCREEN_GUTTER,
        top: insets.top + SCREEN_GUTTER,
      };
    }

    const left = Math.max(
      SCREEN_GUTTER,
      Math.min(
        anchorRect.x + anchorRect.width - MENU_WIDTH,
        screenWidth - MENU_WIDTH - SCREEN_GUTTER,
      ),
    );
    const estimatedMenuHeight = actions.length * 48 + 12;
    const clusterHeight = estimatedMenuHeight + CARET_SIZE;
    const spaceBelow =
      screenHeight - insets.bottom - (anchorRect.y + anchorRect.height + MENU_GAP + clusterHeight);
    const spaceAbove = anchorRect.y - insets.top - MENU_GAP - clusterHeight;
    const openBelow = spaceBelow >= spaceAbove;
    const top = openBelow
      ? anchorRect.y + anchorRect.height + MENU_GAP
      : Math.max(insets.top + 8, anchorRect.y - clusterHeight - MENU_GAP);

    return { openBelow, left, top };
  }, [actions.length, anchorRect, insets.bottom, insets.top, screenHeight, screenWidth]);

  return (
    <View ref={rowRef} collapsable={false}>
      {cloneElement(children, {
        delayLongPress: LONG_PRESS_DELAY_MS,
        onLongPress: handleLongPress,
      })}

      {isMounted && anchorRect ? (
        <Modal
          transparent
          visible={isMounted}
          animationType='none'
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={closeMenu}
        >
          <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Dismiss conversation actions'
                onPress={closeMenu}
                style={[StyleSheet.absoluteFill, styles.scrim]}
              />
            </Animated.View>

            <Animated.View
              pointerEvents='none'
              style={[
                styles.rowPreviewShadow,
                {
                  left: anchorRect.x,
                  top: anchorRect.y,
                  width: anchorRect.width,
                  height: anchorRect.height,
                },
                rowPreviewStyle,
              ]}
            >
              <View style={[styles.rowPreviewClip, { backgroundColor: surfaceColor }]}>
                {cloneElement(children, {
                  onPress: () => undefined,
                  onLongPress: () => undefined,
                })}
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.cluster,
                {
                  left: layout.left,
                  top: layout.top,
                },
                clusterStyle,
              ]}
            >
              {layout.openBelow ? (
                <Ionicons name='caret-up' size={CARET_SIZE} color={menuBg} style={styles.caret} />
              ) : null}

              <View style={[styles.menu, { backgroundColor: menuBg }]}>
                {actions.map(action => (
                  <Pressable
                    key={action.id}
                    accessibilityRole='menuitem'
                    onPress={() => handleAction(action)}
                    style={({ pressed }) => [
                      styles.item,
                      pressed && { backgroundColor: pressedBackgroundColor },
                    ]}
                  >
                    <Ionicons
                      name={IONICONS_BY_ACTION[action.systemImage]}
                      size={20}
                      color={foregroundColor}
                    />
                    <Text style={[styles.label, { color: foregroundColor }]}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>

              {layout.openBelow ? null : (
                <Ionicons name='caret-down' size={CARET_SIZE} color={menuBg} style={styles.caret} />
              )}
            </Animated.View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/** `elevation` is Android-only. This adds the iOS equivalent alongside it. */
const iosShadow = (opacity: number, radius: number, offsetY: number): ViewStyle =>
  Platform.OS === 'ios'
    ? {
        shadowColor: '#000',
        shadowOpacity: opacity,
        shadowRadius: radius,
        shadowOffset: { width: 0, height: offsetY },
      }
    : {};

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  rowPreviewShadow: {
    position: 'absolute',
    borderRadius: ROW_RADIUS,
    elevation: 12,
    ...iosShadow(0.3, 12, 6),
  },
  rowPreviewClip: {
    flex: 1,
    borderRadius: ROW_RADIUS,
    overflow: 'hidden',
  },
  cluster: {
    position: 'absolute',
    width: MENU_WIDTH,
    alignItems: 'flex-end',
    // styles.menu keeps its own elevation for Android. On iOS the shadow has to
    // live here, because that view sets overflow:'hidden' and would clip it.
    ...iosShadow(0.28, 16, 8),
  },
  caret: {
    marginRight: 18,
    marginVertical: -5,
    zIndex: 1,
    elevation: 17,
  },
  menu: {
    width: MENU_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 6,
    elevation: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
});
