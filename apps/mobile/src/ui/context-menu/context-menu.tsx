import {
  Children,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useIsDark } from '@/src/design-system';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';

import { useCloseOnScreenBlur } from '@/src/hooks/useCloseOnScreenBlur';
import { haptics } from '@/src/utils/haptics';

import {
  MENU_ICON_GAP,
  MENU_ICON_SIZE,
  MENU_ITEM_FADE_MS,
  MENU_ITEM_HEIGHT,
  MENU_ITEM_PADDING_X,
  MENU_ITEM_SLIDE,
  MENU_ITEM_STAGGER_MS,
  MENU_ITEM_TEXT_SIZE,
} from './constants';
import { ContextMenuCard } from './context-menu-card';
import { ContextMenuProvider, useContextMenuState } from './context';
import type { MenuAnchor } from './placement';

/**
 * Owns whether this menu is open, and nothing else.
 *
 * One `Root` per trigger, which is affordable because a closed menu is a
 * `useState` and a context object — the card, its backdrop and every
 * animated node mount only once something is long-pressed.
 */
function Root({ children }: { children: ReactNode }): ReactElement {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const open = useCallback((next: MenuAnchor) => setAnchor(next), []);
  const close = useCallback(() => setAnchor(null), []);

  /*
   * Tab screens are detached, not unmounted, when another tab is selected, so
   * an open menu's state outlives its screen. Its card lives in the shell's
   * overlay host, which is not part of the screen and would keep covering —
   * and catching touches over — whichever tab comes next.
   */
  useCloseOnScreenBlur(close);

  const value = useMemo(
    () => ({ isOpen: anchor !== null, anchor, open, close }),
    [anchor, close, open],
  );

  return <ContextMenuProvider value={value}>{children}</ContextMenuProvider>;
}

const RIPPLE_LIGHT = 'rgba(18, 20, 28, 0.08)';
const RIPPLE_DARK = 'rgba(255, 255, 255, 0.10)';

export type ContextMenuTriggerProps = {
  onPress?: (() => void) | undefined;
  /** Held this long before the menu opens. Telegram's own default is 250ms. */
  longPressDelay?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * The pressable the menu belongs to.
 *
 * It is the row's only pressable, not an extra one wrapped around it — a
 * nested pair would mean two touch targets competing for the same gesture.
 *
 * Measuring happens on the long press, never before, so a list pays nothing
 * for triggers the user never holds.
 */
function Trigger({
  onPress,
  longPressDelay = 250,
  disabled = false,
  style,
  children,
}: ContextMenuTriggerProps): ReactElement {
  const { open, isOpen } = useContextMenuState('ContextMenu.Trigger');
  const ref = useRef<View>(null);

  const isDark = useIsDark();
  const highlight = useCSSVariable('--color-spaces-surface') as string;
  const ripple = isDark ? RIPPLE_DARK : RIPPLE_LIGHT;

  const handleLongPress = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      void haptics.buttonTap();
      open({ x, y, width, height });
    });
  }, [open]);

  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      /*
       * Android draws a ripple; iOS has none, so it gets the same wash as a
       * flat press. Either way the row stays filled for as long as its menu
       * is open, so it is obvious which one the menu belongs to.
       */
      android_ripple={{ color: ripple }}
      style={({ pressed }) => [
        style,
        isOpen ? { backgroundColor: highlight } : null,
        Platform.OS !== 'android' && pressed ? { backgroundColor: ripple } : null,
      ]}
      delayLongPress={longPressDelay}
      {...(onPress ? { onPress } : {})}
      onLongPress={handleLongPress}
    >
      {children}
    </Pressable>
  );
}

export type ContextMenuContentProps = {
  /** The small row above the items. */
  label?: string;
  children: ReactNode;
};

/** Renders nothing until the menu is open. */
function Content({ label, children }: ContextMenuContentProps): ReactElement | null {
  const { isOpen } = useContextMenuState('ContextMenu.Content');
  if (!isOpen) return null;

  const items = Children.toArray(children);

  return (
    <ContextMenuCard itemCount={items.length} {...(label !== undefined ? { label } : {})}>
      {items.map((child, index) => (
        <Animated.View
          // Position is identity here: the list is static for the life of
          // one open, so an index key cannot reorder anything.
          key={index}
          entering={FadeInUp.duration(MENU_ITEM_FADE_MS)
            .delay(index * MENU_ITEM_STAGGER_MS)
            .easing(Easing.out(Easing.quad))
            .withInitialValues({ transform: [{ translateY: -MENU_ITEM_SLIDE }] })}
        >
          {child}
        </Animated.View>
      ))}
    </ContextMenuCard>
  );
}

export type ContextMenuItemProps = {
  label: string;
  icon?: ReactNode;
  onSelect?: (() => void) | undefined;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Closes before it acts.
 *
 * The action may navigate or open a sheet, and a menu still on screen when
 * that lands is a menu the user has to dismiss out of somewhere new.
 */
function Item({
  label,
  icon,
  onSelect,
  destructive = false,
  disabled = false,
}: ContextMenuItemProps): ReactElement {
  const { close } = useContextMenuState('ContextMenu.Item');
  const isDark = useIsDark();
  const ripple = isDark ? RIPPLE_DARK : RIPPLE_LIGHT;

  return (
    <Pressable
      accessibilityRole='menuitem'
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void haptics.buttonTap();
        close();
        onSelect?.();
      }}
      android_ripple={{ color: ripple }}
      style={({ pressed }) => [
        styles.item,
        Platform.OS !== 'android' && pressed ? { backgroundColor: ripple } : null,
      ]}
    >
      {icon !== undefined ? <View style={styles.icon}>{icon}</View> : null}
      <Text
        numberOfLines={1}
        style={[styles.itemLabel, disabled ? styles.disabled : null]}
        className={destructive ? 'text-spaces-accent' : 'text-spaces-foreground'}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Separator(): ReactElement {
  return <View style={styles.separator} className='bg-spaces-surface' />;
}

export const ContextMenu = Object.assign(Root, {
  Root,
  Trigger,
  Content,
  Item,
  Separator,
});

const styles = StyleSheet.create({
  item: {
    height: MENU_ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MENU_ITEM_PADDING_X,
  },
  icon: {
    width: MENU_ICON_SIZE,
    height: MENU_ICON_SIZE,
    marginRight: MENU_ICON_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: MENU_ITEM_TEXT_SIZE,
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
