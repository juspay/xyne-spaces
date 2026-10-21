import { type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useCSSVariable } from 'uniwind';

/**
 * A pill/circle button that renders as native liquid glass where iOS offers it
 * and as a flat filled control everywhere else. Callers lay out and size it;
 * this only decides which material it is made of.
 */

/** Resolved once: the API's availability cannot change within a session. */
export const NATIVE_GLASS = (() => {
  try {
    return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

export interface GlassButtonProps {
  /** Solid fill, overriding the glass tint. Used for brand CTAs. */
  fillColor?: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  height?: number;
  borderRadius?: number;
  isDark: boolean;
  className?: string;
  children: ReactNode;
}

export const GlassButton = ({
  onPress,
  disabled = false,
  size,
  height = 36,
  borderRadius = 12,
  isDark,
  className,
  fillColor,
  children,
}: GlassButtonProps): ReactElement => {
  const accentBg = useCSSVariable('--color-accent') as string;
  const borderCol = useCSSVariable('--color-border') as string;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        opacity: pressed ? 0.58 : disabled ? 0.35 : 1,
      })}
    >
      {NATIVE_GLASS ? (
        <GlassView
          isInteractive
          colorScheme={isDark ? 'dark' : 'light'}
          {...(fillColor ? { tintColor: fillColor } : {})}
          style={[glassStyles.glassBase, { width: size, height, borderRadius }]}
        >
          {/* A brand CTA tints the glass rather than painting an opaque fill
              over it — an opaque layer would hide the material entirely. */}
          {className && !fillColor && (
            <View className={className} style={[StyleSheet.absoluteFill, { borderRadius }]} />
          )}
          {children}
        </GlassView>
      ) : (
        <View
          className={className ?? ''}
          style={[
            glassStyles.fallbackBase,
            {
              width: size,
              height,
              borderRadius,
              ...(fillColor
                ? { backgroundColor: fillColor }
                : !className && {
                    backgroundColor: accentBg,
                    borderColor: borderCol,
                  }),
            },
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
};

const glassStyles = StyleSheet.create({
  glassBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBase: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
});
