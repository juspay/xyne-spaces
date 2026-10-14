import { useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabsHeaderChromeContext } from '@/src/components/tabs-screen-header/chrome-context';
import {
  SEARCH_BAR_HEIGHT,
  TABS_SEARCH_BAR_VERTICAL_GAP,
} from '@/src/features/global-search/constants';

type HeaderHeight = {
  topSafeHeight: number;
  headerHeight: number;
  searchBarHeight: number;
  /** Gap between title row ↔ search bar, and search bar ↔ list content. */
  searchBarGap: number;
};

/**
 * Header metrics for whichever shell is rendering.
 *
 * Lists size their own top padding from these, so zeroing the search-bar terms
 * where no search bar exists is what keeps content tucked under the title
 * instead of starting a field's height below it.
 */
export function useHeaderHeight(): HeaderHeight {
  const insets = useSafeAreaInsets();
  const { hasSearchBar } = useContext(TabsHeaderChromeContext);

  return {
    topSafeHeight: insets.top,
    headerHeight: 56,
    searchBarHeight: hasSearchBar ? SEARCH_BAR_HEIGHT : 0,
    // The gaps stay even with no field: lists add one above and one below the
    // search bar's slot, and keeping both is what leaves the title room to
    // breathe instead of content butting straight up against it.
    searchBarGap: TABS_SEARCH_BAR_VERTICAL_GAP,
  };
}
