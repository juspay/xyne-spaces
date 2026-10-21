import { useEffect, useMemo, useRef, type ReactElement, type RefObject } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { GestureDetector, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { SearchIcon as RawSearchIcon, CloseIcon as RawCloseIcon } from '../icons';

import { GlassMaterial } from './glass-material';

import {
  CLOSE_BUTTON_SIZE,
  COLORS,
  ICON_SIZE,
  PILL_HEIGHT,
  SEARCH_ACTIVE_HEIGHT,
  SEARCH_ACTIVE_RADIUS,
  SEARCH_BAR_RADIUS,
  SEARCH_BUTTON_SIZE,
  TAB_BAR_SEARCH_GAP,
  liquidGlassTransform,
  useTabBarPalette,
} from '../constants';
import { navIcon } from './nav-icon';

/**
 * What the embedded field is bound to.
 *
 * Passed in rather than read from the search feature directly, so the bar does
 * not depend on global-search internals. Part 1 leaves it undefined and the
 * button is just a button; Part 1b binds it to `globalSearchStore` once the
 * search chrome is split.
 */
export type SearchFieldBinding = {
  value: string;
  placeholder: string;
  onChangeText: (next: string) => void;
  onKeyPress?: (event: Parameters<NonNullable<TextInputProps['onKeyPress']>>[0]) => void;
};

export type GlowOverlayProps = {
  size: number;
  id: string;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
};

export function GlowOverlay({
  size,
  id,
  touchX,
  touchY,
  glowProgress,
}: GlowOverlayProps): ReactElement {
  const half = size / 2;

  const glowStyle = useAnimatedStyle(() => {
    const progress = glowProgress.get();
    const opacity =
      progress <= 1 ? progress * 0.2 : interpolate(progress, [1, 2], [0.2, 0], 'clamp');
    const scale = progress <= 1 ? 1 : interpolate(progress, [1, 2], [1, 4], 'clamp');

    return {
      opacity,
      transform: [
        { translateX: touchX.get() - half },
        { translateY: touchY.get() - half },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.glow, { width: size, height: size }, glowStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx='50%' cy='50%' r='50%'>
            <Stop offset='0%' stopColor='#fff' stopOpacity={1} />
            <Stop offset='100%' stopColor='#fff' stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** Focuses the field as it finishes opening, and blurs it on the way out. */
function useSearchAutofocus(ref: RefObject<TextInput | null>, active: boolean): void {
  useEffect(() => {
    if (!active) {
      ref.current?.blur();
      return;
    }
    // One frame after the morph starts, so focus does not fight the layout.
    const handle = requestAnimationFrame(() => ref.current?.focus());
    return (): void => cancelAnimationFrame(handle);
  }, [active, ref]);
}

const SEARCH_HALF_W = SEARCH_BUTTON_SIZE / 2;
const SEARCH_HALF_H = PILL_HEIGHT / 2;

export type SearchButtonProps = {
  searchProgress: SharedValue<number>;
  isSearchActive: boolean;
  /** Absent in Part 1: the button opens the search tab instead of hosting a field. */
  binding?: SearchFieldBinding | undefined;
  pressed: SharedValue<number>;
  overflowX: SharedValue<number>;
  overflowY: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
  composedGesture: ComposedGesture;
};

export function SearchButton({
  searchProgress,
  isSearchActive,
  binding,
  pressed,
  overflowX,
  overflowY,
  touchX,
  touchY,
  glowProgress,
  composedGesture,
}: SearchButtonProps): ReactElement {
  const palette = useTabBarPalette();
  const inputRef = useRef<TextInput>(null);

  const SearchIcon = useMemo(() => navIcon(RawSearchIcon), []);

  /**
   * The field is the same control as the one on the pushed search page, just
   * presented in the bar: both write `globalSearchStore` and share their
   * platform handling, and the results screen reads the store. Neither side
   * knows about the other.
   *
   * Closing is the bar's own job here — the close button beside this field owns
   * it — so the clear/close branch is never reached from this call.
   */
  useSearchAutofocus(inputRef, isSearchActive && binding !== undefined);

  const searchHeight = useDerivedValue(() => {
    return interpolate(searchProgress.get(), [0, 1], [PILL_HEIGHT, SEARCH_ACTIVE_HEIGHT], 'clamp');
  });

  const searchRadius = useDerivedValue(() => {
    return interpolate(
      searchProgress.get(),
      [0, 1],
      [SEARCH_BAR_RADIUS, SEARCH_ACTIVE_RADIUS],
      'clamp',
    );
  });

  const glassStyle = useAnimatedStyle(() => {
    return liquidGlassTransform(
      pressed.get(),
      overflowX.get(),
      overflowY.get(),
      SEARCH_HALF_W,
      SEARCH_HALF_H,
    );
  });

  const heightStyle = useAnimatedStyle(() => {
    return {
      height: searchHeight.get(),
      borderRadius: searchRadius.get(),
    };
  });

  const inputOpacity = useAnimatedStyle(() => {
    return {
      opacity: interpolate(searchProgress.get(), [0.4, 0.8], [0, 1], 'clamp'),
    };
  });

  const iconStyle = useAnimatedStyle(() => {
    return {
      top: (searchHeight.get() - ICON_SIZE) / 2,
      left: interpolate(
        searchProgress.get(),
        [0, 1],
        [(SEARCH_BUTTON_SIZE - ICON_SIZE) / 2, 16],
        'clamp',
      ),
    };
  });

  return (
    <Animated.View style={styles.searchWrapper}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={glassStyle}>
          <Animated.View style={heightStyle}>
            <GlassMaterial
              borderRadius={searchRadius}
              style={[styles.searchContainer, heightStyle]}
            >
              <Animated.View style={[styles.searchIcon, iconStyle]}>
                <SearchIcon color={palette.iconActive} />
              </Animated.View>
              <Animated.View style={[styles.inputContainer, inputOpacity]}>
                <TextInput
                  ref={inputRef}
                  editable={binding !== undefined}
                  value={binding?.value ?? ''}
                  onChangeText={binding?.onChangeText}
                  onKeyPress={binding?.onKeyPress}
                  style={[styles.input, { color: palette.textPrimary }]}
                  placeholder={binding?.placeholder ?? 'Search'}
                  placeholderTextColor={palette.textSecondary}
                  selectionColor={COLORS.accentBlue}
                  returnKeyType='search'
                  autoCorrect={false}
                  autoCapitalize='none'
                  pointerEvents={isSearchActive ? 'auto' : 'none'}
                />
              </Animated.View>
              <GlowOverlay
                size={120}
                id='searchGlow'
                touchX={touchX}
                touchY={touchY}
                glowProgress={glowProgress}
              />
            </GlassMaterial>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const CLOSE_HALF_W = CLOSE_BUTTON_SIZE / 2;
const CLOSE_HALF_H = PILL_HEIGHT / 2;

export type CloseSearchButtonProps = {
  searchProgress: SharedValue<number>;
  pressed: SharedValue<number>;
  overflowX: SharedValue<number>;
  overflowY: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
  composedGesture: ComposedGesture;
};

export function CloseSearchButton({
  searchProgress,
  pressed,
  overflowX,
  overflowY,
  touchX,
  touchY,
  glowProgress,
  composedGesture,
}: CloseSearchButtonProps): ReactElement {
  const CloseIcon = useMemo(() => navIcon(RawCloseIcon), []);

  const palette = useTabBarPalette();
  const closeHeight = useDerivedValue(() => {
    return interpolate(searchProgress.get(), [0, 1], [PILL_HEIGHT, SEARCH_ACTIVE_HEIGHT], 'clamp');
  });

  const glassStyle = useAnimatedStyle(() =>
    liquidGlassTransform(
      pressed.get(),
      overflowX.get(),
      overflowY.get(),
      CLOSE_HALF_W,
      CLOSE_HALF_H,
    ),
  );

  const visibilityStyle = useAnimatedStyle(() => {
    const progress = searchProgress.get();
    return {
      opacity: interpolate(progress, [0.3, 0.6], [0, 1], 'clamp'),
      width: interpolate(progress, [0, 0.5], [0, SEARCH_ACTIVE_HEIGHT], 'clamp'),
      marginLeft: interpolate(progress, [0, 0.5], [0, TAB_BAR_SEARCH_GAP], 'clamp'),
      transform: [
        { translateX: interpolate(progress, [0.3, 0.8], [20, 0], 'clamp') },
        { scale: interpolate(progress, [0.3, 0.8], [0.8, 1], 'clamp') },
      ],
    };
  });

  const heightStyle = useAnimatedStyle(() => {
    const height = closeHeight.get();
    return { height, width: height, borderRadius: height / 2 };
  });

  return (
    <Animated.View style={visibilityStyle}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={glassStyle}>
          <Animated.View style={heightStyle}>
            <GlassMaterial borderRadius={closeHeight} style={[styles.closeContainer, heightStyle]}>
              <View style={styles.iconCenter}>
                <CloseIcon color={palette.iconActive} />
              </View>
              <GlowOverlay
                size={120}
                id='closeGlow'
                touchX={touchX}
                touchY={touchY}
                glowProgress={glowProgress}
              />
            </GlassMaterial>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  searchWrapper: {
    flex: 1,
  },
  searchContainer: {
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    marginLeft: 44,
    marginRight: 16,
    flex: 1,
  },
  input: {
    fontSize: 16,
    height: '100%',
  },
  closeContainer: {
    flex: 1,
  },
  iconCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
