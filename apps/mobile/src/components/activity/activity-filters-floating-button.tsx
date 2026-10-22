import { useValue } from '@legendapp/state/react';
import { SlidersHorizontal } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useFabBottomOffset } from '@/src/components/ui/fab-layout';
import { GlassSurface } from '@/src/components/ui/glass-surface';
import { countActiveFilters } from '@/src/features/activity/model/preferences';
import { appliedActivityPreferences$ } from '@/src/features/activity/state/preferences-store';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

const PILL_HEIGHT = 38;
const FAB_RIGHT_OFFSET = 16;
/** Matches `channel-list-floating-actions`, so FABs layer alike over a list. */
const FAB_Z_INDEX = 1100;

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  pill: {
    height: PILL_HEIGHT,
    borderRadius: 999,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  glassFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: 999,
  },
  resting: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Opens the Activity filters. Sits where the Unreads pill sat — Unread is one
 * of the filters now.
 *
 * Filled with the accent while any filter narrows the feed, with how many;
 * a plain card-coloured pill otherwise.
 */
export const ActivityFiltersFloatingButton = ({
  onPress,
}: {
  onPress: () => void;
}): ReactElement | null => {
  const isFocused = useTabPageIsFocused();
  // What the feed is built from, not the draft the sheet is editing.
  const count = useValue(() => countActiveFilters(appliedActivityPreferences$.get()));
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const bottom = useFabBottomOffset();
  const mutedForeground = useCSSVariable('--color-secondary-foreground') as string;
  const cardColor = useCSSVariable('--color-card') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const { theme } = useUniwind();

  if (!isFocused) return null;

  const isActive = count > 0;
  const colorScheme = theme === 'dark' ? 'dark' : 'light';

  return (
    // In the tab's own tree rather than a Portal, so it slides aside with the
    // screen when the workspace drawer opens.
    <View pointerEvents='box-none' style={[StyleSheet.absoluteFill, { zIndex: FAB_Z_INDEX }]}>
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          onPress();
        }}
        className='active:opacity-90'
        // Shadow stays on the Pressable; the glass child does the clipping.
        style={[
          styles.shadow,
          { position: 'absolute', right: insets.right + FAB_RIGHT_OFFSET, bottom },
        ]}
        accessibilityRole='button'
        accessibilityLabel={
          isActive
            ? `Filter activity, ${count} filter${count === 1 ? '' : 's'} on`
            : 'Filter activity'
        }
      >
        {isActive ? (
          <View style={styles.pill}>
            {/*
              The glass sits behind the label, not around it. Inside a tinted
              glass, iOS adapts content for legibility, and in dark mode it
              blended the near-black label and count into the accent.
            */}
            <GlassSurface
              interactive
              fallbackColor={accentBg}
              tintColor={accentBg}
              colorScheme={colorScheme}
              style={styles.glassFill}
            />
            <SlidersHorizontal size={16} color={accentFg} strokeWidth={2.25} />
            <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
              Filters
            </Text>
            <View style={[styles.count, { backgroundColor: accentFg }]}>
              <Text className='text-[12px] font-bold' style={{ color: accentBg }}>
                {count}
              </Text>
            </View>
          </View>
        ) : (
          <GlassSurface
            interactive
            fallbackColor={cardColor}
            colorScheme={colorScheme}
            style={[styles.pill, styles.resting, { borderColor }]}
          >
            <SlidersHorizontal size={16} color={mutedForeground} strokeWidth={2.25} />
            <Text className='text-[15px] font-semibold' style={{ color: mutedForeground }}>
              Filters
            </Text>
          </GlassSurface>
        )}
      </Pressable>
    </View>
  );
};
