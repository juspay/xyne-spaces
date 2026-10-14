import { Dimensions, ViewStyle } from 'react-native';
import { Easing, interpolate } from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Inset of the resting bar from the screen edges, and the gap between the pill
 * and the search button. These two are what make the pill read as compact.
 */
export const TAB_BAR_HORIZONTAL_PADDING = 26;
export const TAB_BAR_GAP = 18;

/**
 * The same two measurements once the field is out.
 *
 * Tighter on purpose: the search input wants every point of width it can get,
 * and the bar is no longer a floating pill at that moment — it spans the
 * screen, so a wide inset reads as wasted space rather than as breathing room.
 * Kept separate from the resting pair so widening the field cannot loosen the
 * pill, which is what happened when one constant served both.
 */
export const TAB_BAR_SEARCH_HORIZONTAL_PADDING = 12;
export const TAB_BAR_SEARCH_GAP = 10;

export const PILL_HEIGHT = 56;
export const SEARCH_ACTIVE_HEIGHT = 46;
export const PILL_BORDER_RADIUS = PILL_HEIGHT / 2;
export const SEARCH_ACTIVE_RADIUS = SEARCH_ACTIVE_HEIGHT / 2;

export const ICON_SIZE = 26;

/** Unread badge, pinned to the icon's top-right corner. */
export const BADGE_HEIGHT = 16;
export const BADGE_FONT_SIZE = 10;
export const BADGE_PADDING_HORIZONTAL = 4;
/**
 * How far the badge hangs past the icon box. The tab it sits in clips its
 * children, and on the narrowest phone the zone leaves only ~10pt either side
 * of the 26pt icon, so this has to stay under that.
 */
export const BADGE_OFFSET_RIGHT = -6;
export const BADGE_OFFSET_TOP = -4;
/**
 * Fixed in both themes rather than following `useBubbleAccent`: the bar carries
 * its own palette, and the accent tracks the chosen chat bubble — green by
 * default — which reads as a different signal from the bar's design.
 */
export const BADGE_BACKGROUND = '#3B82F6';
export const BADGE_TEXT = '#FFFFFF';
export const ICON_SPACING = 52;
/**
 * One weight for every destination icon, in the bar, the menu and the customize
 * list alike.
 *
 * 1.6 is what the icons that already looked right were drawing at — Channels,
 * Activity and the menu trigger. The rest were lighter and read as faded beside
 * them.
 */
export const NAV_ICON_STROKE_WIDTH = 1.6;
export const ICON_PADDING = 4;
/** Vertical inset of a tab's highlight inside the pill. */
export const INDICATOR_INSET = 4;

export const SEARCH_BUTTON_SIZE = 56;
export const SEARCH_BAR_RADIUS = PILL_BORDER_RADIUS;

export const TOTAL_WIDTH = SCREEN_WIDTH - 2 * TAB_BAR_HORIZONTAL_PADDING;
export const PILL_WIDTH = TOTAL_WIDTH - TAB_BAR_GAP - SEARCH_BUTTON_SIZE;
export const CLOSE_BUTTON_SIZE = SEARCH_BUTTON_SIZE;
export const SEARCH_BAR_WIDTH = TOTAL_WIDTH - TAB_BAR_GAP - CLOSE_BUTTON_SIZE;

export const TAB_BAR_BOTTOM_PADDING = 8;
/** Extra space between the pill and the bottom edge, above the safe-area padding. */
export const TAB_BAR_LIFT = 12;
/** Clear band above the pill where the bottom progressive blur fades out. */
export const TAB_BAR_BLUR_FADE = 44;
/** Peak opacity of the blur under the mask. The blur itself runs at full strength. */
export const TAB_BAR_BLUR_ALPHA = 0.55;
/** Peak opacity of the colour scrim at the very bottom edge. */
export const TAB_BAR_SCRIM_ALPHA = { light: 0.72, dark: 0.78 } as const;

export const MENU_WIDTH = TOTAL_WIDTH;
export const MENU_BORDER_RADIUS = 38;
export const MENU_ITEM_HEIGHT = 48;
export const MENU_PADDING_TOP = 12;
export const MENU_PADDING_HORIZONTAL = 12;
/** Row above the destinations that holds the customize button. */
export const MENU_HEADER_HEIGHT = 40;

/**
 * The panel is as tall as whatever the user left visible, so its height is a
 * function rather than a constant — the pill interpolates to it, and the touch
 * mapping below divides it back up.
 */
export function menuHeightForCount(count: number): number {
  'worklet';
  return MENU_PADDING_TOP * 2 + MENU_HEADER_HEIGHT + count * MENU_ITEM_HEIGHT;
}

/** Horizontal slack either side of the panel before the finger counts as "off". */
const MENU_HIT_SLOP_X = 32;

/** Last pill icon. It opens the menu and does not switch screens. */
export const MENU_TAB_INDEX = 3;
/** Highest pill index that changes the active screen. */
export const MAX_SWITCHABLE_TAB = 2;
export const PILL_TAB_COUNT = MENU_TAB_INDEX + 1;

export const TABS_START = ICON_PADDING;
export const TABS_END = PILL_WIDTH - ICON_PADDING;
export const TAB_ZONE_WIDTH = (TABS_END - TABS_START) / PILL_TAB_COUNT;
export const MENU_DRAG_THRESHOLD = -50;

export const TAB_CENTER_XS = [
  TABS_START + TAB_ZONE_WIDTH * 0.5,
  TABS_START + TAB_ZONE_WIDTH * 1.5,
  TABS_START + TAB_ZONE_WIDTH * 2.5,
  TABS_START + TAB_ZONE_WIDTH * 3.5,
] as const;

/**
 * Menu row under a touch, or -1.
 *
 * `MenuPanel` is an `absoluteFill` inside the pill's clip and the pill's own
 * gesture target sits at the same origin, so one coordinate space serves both
 * a fresh touch on the open panel and a drag that opened it.
 */
export function menuItemAtY(x: number, y: number, count: number): number {
  'worklet';
  if (x < -MENU_HIT_SLOP_X || x > PILL_WIDTH + MENU_HIT_SLOP_X) return -1;
  const top = MENU_PADDING_TOP + MENU_HEADER_HEIGHT;
  const index = Math.floor((y - top) / MENU_ITEM_HEIGHT);
  if (index < 0 || index >= count) return -1;
  return index;
}

export function tabCenterX(index: number): number {
  'worklet';
  return TAB_CENTER_XS[index] ?? TABS_START + TAB_ZONE_WIDTH * 0.5;
}

/** Two Figma drop shadows: 0 6 18 #12141C 10%, then 0 1 3 #12141C 7%. */
export const TAB_BAR_SHADOW =
  '0px 6px 18px 0px rgba(18, 20, 28, 0.10), 0px 1px 3px 0px rgba(18, 20, 28, 0.07)';

export const ACTIVE_TAB_INDICATOR = '#0000000D';

export type TabBarPalette = {
  background: string;
  icon: string;
  iconActive: string;
  activeIndicator: string;
  /**
   * Hairline around the bar's surfaces. The drop shadow separates them from a
   * light page on its own, but against a dark one it disappears and the panel
   * runs into the screen behind it.
   */
  surfaceBorder: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  menuHighlight: string;
};

export function useTabBarPalette(): TabBarPalette {
  const { theme } = useUniwind();
  if (theme === 'dark') {
    return {
      background: '#181818',
      icon: '#8A8B8D',
      iconActive: '#F4F4F5',
      activeIndicator: '#FFFFFF14',
      surfaceBorder: 'rgba(255, 255, 255, 0.10)',
      textPrimary: 'rgba(255, 255, 255, 0.92)',
      textSecondary: 'rgba(255, 255, 255, 0.45)',
      divider: 'rgba(255, 255, 255, 0.12)',
      menuHighlight: '#FFFFFF14',
    };
  }

  return {
    background: '#FFFFFF',
    icon: '#A2A3A4',
    iconActive: '#17181C',
    activeIndicator: ACTIVE_TAB_INDICATOR,
    surfaceBorder: 'rgba(18, 20, 28, 0.06)',
    textPrimary: '#111111',
    textSecondary: '#8E8E93',
    divider: 'rgba(18, 20, 28, 0.08)',
    menuHighlight: ACTIVE_TAB_INDICATOR,
  };
}

export const COLORS = {
  background: '#0A0A0A',
  surface: 'rgba(255, 255, 255, 0.06)',
  surfaceHover: 'rgba(255, 255, 255, 0.12)',
  textPrimary: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.4)',
  border: 'rgba(255, 255, 255, 0.12)',
  glassGradientTop: 'rgba(255, 255, 255, 0.11)',
  glassGradientBottom: 'rgba(255, 255, 255, 0.05)',
  accentBlue: '#3B82F6',
  iconDefault: 'rgba(255, 255, 255, 0.9)',
  iconActive: 'rgba(255, 255, 255, 0.9)',
  borderGradientBright: 'rgba(255, 255, 255, 0.15)',
  borderGradientDim: 'rgba(255, 255, 255, 0.01)',
  borderGradientMedium: 'rgba(255, 255, 255, 0.06)',
} as const;

/** Cross-fade when the active highlight moves from one tab to another. */
export const INDICATOR_FADE = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
/** Press feedback lands faster than the active highlight settles. */
export const HOVER_FADE = { duration: 90, easing: Easing.out(Easing.quad) } as const;

export const SPRING = { damping: 24, stiffness: 170, mass: 1 } as const;
export const SPRING_BOUNCY = { damping: 22, stiffness: 250, mass: 0.6 } as const;
export const SPRING_MENU_OPEN = { damping: 14, stiffness: 170, mass: 0.7 } as const;
export const SPRING_MENU_CLOSE = { damping: 22, stiffness: 120, mass: 0.9 } as const;

/** Highlight travel between rows. Quick enough to keep up with a fast drag. */
export const SPRING_MENU_HOVER = { damping: 20, stiffness: 340, mass: 0.6 } as const;

const MAX_PULL = 60;
const MAX_STRETCH = 0.1;
const MAX_COMPRESS = 0.12;

type GlassTransform = NonNullable<ViewStyle['transform']>;

export function liquidGlassTransform(
  pressed: number,
  overflowX: number,
  overflowY: number,
  halfW: number,
  halfH: number,
): { transform: GlassTransform } {
  'worklet';

  const pressScale = interpolate(pressed, [0, 1], [1, 1.02]);
  const signX = overflowX < 0 ? -1 : 1;
  const dampedX = signX * MAX_PULL * (1 - 1 / (Math.abs(overflowX) / MAX_PULL + 1));
  const signY = overflowY < 0 ? -1 : 1;
  const dampedY = signY * MAX_PULL * (1 - 1 / (Math.abs(overflowY) / MAX_PULL + 1));

  const absDX = Math.abs(dampedX);
  const absDY = Math.abs(dampedY);

  const stretchX = interpolate(absDX, [0, MAX_PULL], [0, MAX_STRETCH], 'clamp');
  const stretchY = interpolate(absDY, [0, MAX_PULL], [0, MAX_STRETCH], 'clamp');
  const compressX = interpolate(absDY, [0, MAX_PULL], [0, MAX_COMPRESS], 'clamp');
  const compressY = interpolate(absDX, [0, MAX_PULL], [0, MAX_COMPRESS], 'clamp');

  const transform: GlassTransform = [
    { translateX: signX * halfW * stretchX },
    { translateY: signY * halfH * stretchY },
    { scaleX: pressScale * (1 + stretchX) * (1 - compressX) },
    { scaleY: pressScale * (1 + stretchY) * (1 - compressY) },
  ];

  return { transform };
}
