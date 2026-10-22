import { type ReactElement } from 'react';

import ChatFilterTabs, { type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import {
  SEARCH_CATEGORY_ROW_GAP,
  SEARCH_CATEGORY_ROW_HEIGHT,
  SEARCH_CATEGORY_ROW_TOP_GAP,
  SEARCH_SIDE_MARGIN,
} from '../constants';
import { SEARCH_TABS, type GlobalSearchTab } from '../utils/search-tabs';

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

const STYLE = {
  height: SEARCH_CATEGORY_ROW_HEIGHT,
  marginTop: SEARCH_CATEGORY_ROW_TOP_GAP,
  // ScrollView's own base style sets flexShrink: 1, so inside the toolbar's
  // shrinking column this row would compress along with it instead of the
  // filter row below being clipped away. Only that row is meant to collapse.
  flexShrink: 0,
};

type SearchCategoryTagsProps = {
  tab: GlobalSearchTab;
  onTabChange: (tab: GlobalSearchTab) => void;
};

/**
 * The category strip under the search pill. Paddings are passed in because the
 * ChatFilterTabs defaults are tuned for a list header, while this row floats over the
 * results at a height the toolbar has already reserved.
 */
export function SearchCategoryTags({ tab, onTabChange }: SearchCategoryTagsProps): ReactElement {
  return (
    <ChatFilterTabs
      scrollable
      tabs={CATEGORY_TABS}
      activeTab={tab}
      // No haptic here — ChatFilterTabs fires a selection one on change.
      onTabChange={onTabChange}
      keyboardShouldPersistTaps='always'
      style={STYLE}
      contentContainerStyle={CONTENT_CONTAINER_STYLE}
    />
  );
}
