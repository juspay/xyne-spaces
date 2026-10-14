import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useFabBottomOffset } from '@/src/components/ui/fab-layout';
import { GlassSurface } from '@/src/components/ui/glass-surface';
import { haptics } from '@/src/utils/haptics';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { useBubbleAccentForSurface } from '@/src/theme/BubbleAccentProvider';

/** Shared by the resting pill and both active segments so they never jump on toggle. */
const PILL_HEIGHT = 38;
const ACTIVE_SEGMENT_GAP = 6;

const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 4,
} as const;

const styles = StyleSheet.create({
  /** Carries the resting pill's shape and padding, previously on the Pressable. */
  restingPill: {
    height: PILL_HEIGHT,
    borderRadius: 999,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  activeRow: {
    gap: ACTIVE_SEGMENT_GAP,
  },
  segmentShadow: shadow,
  activeLabel: {
    height: PILL_HEIGHT,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** Square so the X reads as a circle matching the label's height. */
  activeClose: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

type ActivityUnreadsFloatingButtonProps = {
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  count?: number;
};

const FAB_RIGHT_OFFSET = 16;
/** Matches `channel-list-floating-actions`, so FABs layer alike over a list. */
const FAB_Z_INDEX = 1100;

export const ActivityUnreadsFloatingButton = ({
  isActive,
  onActivate,
  onDeactivate,
  count,
}: ActivityUnreadsFloatingButtonProps): ReactElement | null => {
  const isFocused = useTabPageIsFocused();
  const { accentBg, accentFg } = useBubbleAccent();
  // The resting pill draws its text and hairline border on --color-card, not on
  // the screen, so its accent is measured against that surface. The active pill
  // is a filled shape sitting on the screen, so it keeps the context accent.
  const { accentText: restingAccent } = useBubbleAccentForSurface('--color-card');
  const insets = useSafeAreaInsets();
  const bottom = useFabBottomOffset();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedForegroundColor = useCSSVariable('--color-secondary-foreground') as string;
  const cardColor = useCSSVariable('--color-card') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const { theme } = useUniwind();

  if (!isFocused) {
    return null;
  }

  const right = insets.right + FAB_RIGHT_OFFSET;
  const hasUnreads = typeof count === 'number' && count > 0;

  const handleActivate = (): void => {
    void haptics.toggleOn();
    onActivate();
  };

  const handleDeactivate = (): void => {
    void haptics.toggleOff();
    onDeactivate();
  };

  return (
    // Sits in the tab's own tree rather than a Portal: a portal renders past
    // the navigation tree, so this floated above the workspace drawer instead
    // of sliding aside with the screen it belongs to.
    <View pointerEvents='box-none' style={[StyleSheet.absoluteFill, { zIndex: FAB_Z_INDEX }]}>
      <View
        pointerEvents='box-none'
        style={{
          position: 'absolute',
          right,
          bottom,
          maxWidth: '100%',
        }}
      >
        {isActive ? (
          /* Two independent glass segments rather than one surface behind two
               buttons: each half now lenses only when you press that half. */
          <View className='flex-row items-center' style={styles.activeRow}>
            <Pressable
              onPress={handleActivate}
              className='active:opacity-90'
              style={styles.segmentShadow}
              accessibilityRole='button'
              accessibilityState={{ selected: true }}
              accessibilityLabel='Unreads filter active'
            >
              <GlassSurface
                interactive
                fallbackColor={accentBg}
                tintColor={accentBg}
                colorScheme={theme === 'dark' ? 'dark' : 'light'}
                style={styles.activeLabel}
              >
                <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
                  Unreads
                </Text>
              </GlassSurface>
            </Pressable>

            <Pressable
              onPress={handleDeactivate}
              className='active:opacity-90'
              style={styles.segmentShadow}
              hitSlop={8}
              accessibilityRole='button'
              accessibilityLabel='Clear unreads filter'
            >
              <GlassSurface
                interactive
                fallbackColor={accentBg}
                tintColor={accentBg}
                colorScheme={theme === 'dark' ? 'dark' : 'light'}
                style={styles.activeClose}
              >
                <X size={18} color={accentFg} strokeWidth={2.25} />
              </GlassSurface>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handleActivate}
            className='active:opacity-90'
            // Shadow stays on the Pressable; the glass child does the
            // clipping, so overflow:hidden never touches this node.
            style={styles.segmentShadow}
            accessibilityRole='button'
            accessibilityState={{ selected: false }}
            accessibilityLabel={`Show unreads only${hasUnreads ? `, ${count} unread` : ''}`}
          >
            {/* Glass wraps the label rather than sitting behind it, so the
                  press lenses the pill itself. */}
            <GlassSurface
              interactive
              fallbackColor={cardColor}
              colorScheme={theme === 'dark' ? 'dark' : 'light'}
              style={[
                styles.restingPill,
                { borderColor: hasUnreads ? restingAccent : borderColor },
              ]}
            >
              <Text
                className='text-[15px] font-semibold'
                style={{
                  color: hasUnreads ? restingAccent : mutedForegroundColor || foregroundColor,
                }}
              >
                Unreads
              </Text>
            </GlassSurface>
          </Pressable>
        )}
      </View>
    </View>
  );
};
