import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Keyboard, ScrollView } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { Badge } from '@/src/components/ui/badge';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import type { SearchDispatch } from '../../hooks/use-search-state';
import {
  SEARCH_FILTER_ROW_GAP,
  SEARCH_FILTER_ROW_HEIGHT,
  SEARCH_FILTER_ROW_TOP_GAP,
  SEARCH_SIDE_MARGIN,
} from '../../constants';
import {
  fromFilterTitleForTab,
  IN_CHIP_EMPTY_LABEL,
  multiSelectChipLabel,
  ONLY_MY_CHANNELS_CHIP_LABEL,
  type GlobalSearchTab,
} from '../../utils/search-tabs';
import type { SearchFilterChip } from '../../types';
import { FromFilterSheet } from './from-filter-sheet';
import { InFilterSheet } from './in-filter-sheet';

type OpenSheet = 'from' | 'in' | null;

type GlobalSearchFilterBarProps = {
  tab: GlobalSearchTab;
  chips: readonly SearchFilterChip[];
  onlyMyChannels: boolean;
  dispatch: SearchDispatch;
};

const GLYPH_SIZE = 14;
const GLYPH_STROKE = 2.5;

/**
 * Dropdown filter row. The category lives in the tag strip above this row; what
 * is left is the two multi-select filters plus the toggle.
 *
 * Built from the same Badge as that tag strip, so the two rows are one visual
 * family in both themes and both states — a dropdown badge just carries a
 * trailing chevron. Badge owns the colours; nothing here paints its own.
 *
 * These sheets and the `from:` / `in:` operators typed into the search box write
 * the same chips, so a filter picked from either shows up in both places.
 */
export function GlobalSearchFilterBar({
  tab,
  chips,
  onlyMyChannels,
  dispatch,
}: GlobalSearchFilterBarProps): ReactElement {
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);

  /**
   * The two colours Badge paints its label in, resolved here because Badge
   * cannot hand them out — see the note on its `trailing` prop. Keeping the
   * same pair means a chevron never drifts from the label beside it.
   */
  const { accentText } = useBubbleAccent();
  const inactiveColor = useCSSVariable('--color-tab-inactive-text') as string;
  const glyphColor = useCallback(
    (isActive: boolean): string => (isActive ? accentText : inactiveColor),
    [accentText, inactiveColor],
  );

  const fromChips = useMemo(() => chips.filter(chip => chip.prefix === 'from:'), [chips]);
  const inChips = useMemo(() => chips.filter(chip => chip.prefix === 'in:'), [chips]);
  const fromTitle = fromFilterTitleForTab(tab);

  const applyFromChips = useCallback(
    (next: readonly SearchFilterChip[]) =>
      dispatch({ type: 'chipsReplaced', prefix: 'from:', chips: next }),
    [dispatch],
  );
  const applyInChips = useCallback(
    (next: readonly SearchFilterChip[]) =>
      dispatch({ type: 'chipsReplaced', prefix: 'in:', chips: next }),
    [dispatch],
  );

  const openFilterSheet = useCallback((which: Exclude<OpenSheet, null>) => {
    void haptics.buttonTap();
    // Dismiss and mount in the same tick. Awaiting dismissKeyboardForSheet()
    // first can hang: it calls Keyboard.dismiss(), then awaits
    // KeyboardController.dismiss() if the keyboard still reports visible — but
    // the hide is already in flight, so it can wait on a "did hide" that has
    // already fired, and the sheet never mounts. Every other sheet in the app
    // opens synchronously and lets `keyboardBehavior` handle the keyboard.
    Keyboard.dismiss();
    setOpenSheet(which);
  }, []);

  const openFromSheet = useCallback(() => openFilterSheet('from'), [openFilterSheet]);
  const openInSheet = useCallback(() => openFilterSheet('in'), [openFilterSheet]);

  const closeSheet = useCallback(() => {
    setOpenSheet(null);
  }, []);

  const toggleOnlyMyChannels = useCallback(() => {
    void (onlyMyChannels ? haptics.toggleOff() : haptics.toggleOn());
    dispatch({ type: 'onlyMyChannelsToggled' });
  }, [dispatch, onlyMyChannels]);

  return (
    <>
      <ScrollView
        horizontal
        alwaysBounceVertical={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps='always'
        // flexShrink: 0 for the reason spelled out in SearchCategoryTags — the
        // toolbar collapse must clip this row, not compress it.
        style={{
          height: SEARCH_FILTER_ROW_HEIGHT,
          marginTop: SEARCH_FILTER_ROW_TOP_GAP,
          flexShrink: 0,
        }}
        contentContainerStyle={{
          alignItems: 'center',
          gap: SEARCH_FILTER_ROW_GAP,
          paddingHorizontal: SEARCH_SIDE_MARGIN,
        }}
      >
        <Badge
          className='max-w-55'
          label={multiSelectChipLabel(fromChips, fromTitle)}
          variant={fromChips.length > 0 ? 'active' : 'default'}
          trailing={
            <ChevronDown
              size={GLYPH_SIZE}
              color={glyphColor(fromChips.length > 0)}
              strokeWidth={GLYPH_STROKE}
            />
          }
          accessibilityRole='button'
          accessibilityState={{ selected: fromChips.length > 0 }}
          accessibilityLabel={`${fromTitle} filter`}
          onPress={openFromSheet}
        />
        <Badge
          className='max-w-55'
          label={multiSelectChipLabel(inChips, IN_CHIP_EMPTY_LABEL)}
          variant={inChips.length > 0 ? 'active' : 'default'}
          trailing={
            <ChevronDown
              size={GLYPH_SIZE}
              color={glyphColor(inChips.length > 0)}
              strokeWidth={GLYPH_STROKE}
            />
          }
          accessibilityRole='button'
          accessibilityState={{ selected: inChips.length > 0 }}
          accessibilityLabel='In filter'
          onPress={openInSheet}
        />
        {/* A toggle, not a dropdown — it gets a check when set and no glyph otherwise. */}
        <Badge
          className='max-w-55'
          label={ONLY_MY_CHANNELS_CHIP_LABEL}
          variant={onlyMyChannels ? 'active' : 'default'}
          {...(onlyMyChannels
            ? {
                trailing: <Check size={GLYPH_SIZE} color={accentText} strokeWidth={GLYPH_STROKE} />,
              }
            : {})}
          accessibilityRole='button'
          accessibilityState={{ selected: onlyMyChannels }}
          accessibilityLabel={ONLY_MY_CHANNELS_CHIP_LABEL}
          onPress={toggleOnlyMyChannels}
        />
      </ScrollView>

      <FromFilterSheet
        isOpen={openSheet === 'from'}
        onClose={closeSheet}
        selected={fromChips}
        title={fromTitle}
        onApply={applyFromChips}
      />
      <InFilterSheet
        isOpen={openSheet === 'in'}
        onClose={closeSheet}
        selected={inChips}
        onApply={applyInChips}
      />
    </>
  );
}
