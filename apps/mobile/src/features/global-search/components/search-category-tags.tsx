import { type ReactElement } from 'react';
import { View } from 'react-native';

import ChatFilterTabs, { type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import {
  SEARCH_CATEGORY_ROW_GAP,
  SEARCH_CATEGORY_ROW_HEIGHT,
  SEARCH_CATEGORY_ROW_TOP_GAP,
  SEARCH_SIDE_MARGIN,
} from '../constants';
import { SEARCH_TABS, type GlobalSearchTab } from '../utils/search-tabs';
import { SearchFiltersButton } from './search-filters-button';

const CATEGORY_TABS: ChatFilterTabOption<GlobalSearchTab>[] = SEARCH_TABS.map(tab => ({
  value: tab.id,
  label: tab.label,
}));

const CONTENT_CONTAINER_STYLE = {
  alignItems: 'center' as const,
  gap: SEARCH_CATEGORY_ROW_GAP,
  paddingHorizontal: SEARCH_SIDE_MARGIN,
  paddingVertical: 0,
  paddingBottom: 0,
};

const CONTENT_CONTAINER_STYLE_WITH_FILTER = {
  alignItems: 'center' as const,
  gap: SEARCH_CATEGORY_ROW_GAP,
  paddingLeft: SEARCH_SIDE_MARGIN,
  paddingRight: SEARCH_CATEGORY_ROW_GAP,
  paddingVertical: 0,
  paddingBottom: 0,
};

/** ScrollView `style` only — child layout props like alignItems belong in contentContainerStyle. */
const TABS_STYLE = {
  height: SEARCH_CATEGORY_ROW_HEIGHT,
  marginTop: SEARCH_CATEGORY_ROW_TOP_GAP,
  // ScrollView's own base style sets flexShrink: 1, so inside the toolbar's
  // shrinking column this row would compress along with it instead of the
  // filter row below being clipped away. Only that row is meant to collapse.
  flexShrink: 0,
};

const TABS_STYLE_WITH_FILTER = {
  flex: 1,
  height: SEARCH_CATEGORY_ROW_HEIGHT,
  flexShrink: 0,
};

const ROW_STYLE = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  height: SEARCH_CATEGORY_ROW_HEIGHT,
  marginTop: SEARCH_CATEGORY_ROW_TOP_GAP,
  flexShrink: 0,
};

const FILTER_BUTTON_WRAP = {
  marginRight: SEARCH_SIDE_MARGIN,
};

type SearchCategoryTagsProps = {
  tab: GlobalSearchTab;
  onTabChange: (tab: GlobalSearchTab) => void;
  /** Opens the Filters sheet — shown on the right when the search field is hosted elsewhere. */
  onFilterPress?: (() => void) | undefined;
  filterBadgeCount?: number;
};

/**
 * The category strip under the search pill. Paddings are passed in because the
 * ChatFilterTabs defaults are tuned for a list header, while this row floats over the
 * results at a height the toolbar has already reserved.
 */
export function SearchCategoryTags({
  tab,
  onTabChange,
  onFilterPress,
  filterBadgeCount = 0,
}: SearchCategoryTagsProps): ReactElement {
  const tabs = (
    <ChatFilterTabs
      scrollable
      tabs={CATEGORY_TABS}
      activeTab={tab}
      // No haptic here — ChatFilterTabs fires a selection one on change.
      onTabChange={onTabChange}
      keyboardShouldPersistTaps='always'
      style={onFilterPress ? TABS_STYLE_WITH_FILTER : TABS_STYLE}
      contentContainerStyle={
        onFilterPress ? CONTENT_CONTAINER_STYLE_WITH_FILTER : CONTENT_CONTAINER_STYLE
      }
    />
  );

  if (!onFilterPress) {
    return tabs;
  }

  return (
    <View style={ROW_STYLE}>
      {tabs}
      <View style={FILTER_BUTTON_WRAP}>
        <SearchFiltersButton
          onPress={onFilterPress}
          badgeCount={filterBadgeCount}
          size={SEARCH_CATEGORY_ROW_HEIGHT}
        />
      </View>
    </View>
  );
}
