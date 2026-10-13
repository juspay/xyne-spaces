import { useCallback, type ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { Check } from 'lucide-react-native';

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
import { canOpenFiltersSheet } from '../../utils/filter-registry';
import {
  BOT_CHIP_A11Y_LABEL,
  BOT_CHIP_LABEL,
  EXACT_CHIP_A11Y_LABEL,
  EXACT_CHIP_LABEL,
  ONLY_MY_CHANNELS_CHIP_A11Y_LABEL,
  ONLY_MY_CHANNELS_CHIP_LABEL,
  type GlobalSearchTab,
} from '../../utils/search-tabs';

type GlobalSearchFilterBarProps = {
  tab: GlobalSearchTab;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
  dispatch: SearchDispatch;
};

const GLYPH_SIZE = 14;
const GLYPH_STROKE = 2.5;

/**
 * Mode-toggle row (dashboard SearchFilterBar pills).
 * `@Ch` / Exact on remote tabs; Bot on messages only. Sort / Rank stay in Filters.
 */
export function GlobalSearchFilterBar({
  tab,
  onlyMyChannels,
  includeBotMessages,
  exactMatch,
  dispatch,
}: GlobalSearchFilterBarProps): ReactElement {
  const { accentText } = useBubbleAccent();

  const showChannelModes = canOpenFiltersSheet(tab);
  // Dashboard: Bot for messages | all only.
  const showBotToggle = tab === 'messages';

  const toggleOnlyMyChannels = useCallback(() => {
    void (onlyMyChannels ? haptics.toggleOff() : haptics.toggleOn());
    dispatch({ type: 'onlyMyChannelsToggled' });
  }, [dispatch, onlyMyChannels]);

  const toggleIncludeBotMessages = useCallback(() => {
    void (includeBotMessages ? haptics.toggleOff() : haptics.toggleOn());
    dispatch({ type: 'includeBotMessagesToggled' });
  }, [dispatch, includeBotMessages]);

  const toggleExactMatch = useCallback(() => {
    void (exactMatch ? haptics.toggleOff() : haptics.toggleOn());
    dispatch({ type: 'exactMatchToggled' });
  }, [dispatch, exactMatch]);

  return (
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
      {showChannelModes ? (
        <Badge
          className='max-w-55'
          label={ONLY_MY_CHANNELS_CHIP_LABEL}
          variant={onlyMyChannels ? 'active' : 'default'}
          {...(onlyMyChannels
            ? {
                trailing: (
                  <Check size={GLYPH_SIZE} color={accentText} strokeWidth={GLYPH_STROKE} />
                ),
              }
            : {})}
          accessibilityRole='button'
          accessibilityState={{ selected: onlyMyChannels }}
          accessibilityLabel={ONLY_MY_CHANNELS_CHIP_A11Y_LABEL}
          onPress={toggleOnlyMyChannels}
        />
      ) : null}
      {showBotToggle ? (
        <Badge
          className='max-w-55'
          label={BOT_CHIP_LABEL}
          variant={includeBotMessages ? 'active' : 'default'}
          {...(includeBotMessages
            ? {
                trailing: (
                  <Check size={GLYPH_SIZE} color={accentText} strokeWidth={GLYPH_STROKE} />
                ),
              }
            : {})}
          accessibilityRole='button'
          accessibilityState={{ selected: includeBotMessages }}
          accessibilityLabel={BOT_CHIP_A11Y_LABEL}
          onPress={toggleIncludeBotMessages}
        />
      ) : null}
      {showChannelModes ? (
        <Badge
          className='max-w-55'
          label={EXACT_CHIP_LABEL}
          variant={exactMatch ? 'active' : 'default'}
          {...(exactMatch
            ? {
                trailing: <Check size={GLYPH_SIZE} color={accentText} strokeWidth={GLYPH_STROKE} />,
              }
            : {})}
          accessibilityRole='button'
          accessibilityState={{ selected: exactMatch }}
          accessibilityLabel={EXACT_CHIP_A11Y_LABEL}
          onPress={toggleExactMatch}
        />
      ) : null}
    </ScrollView>
  );
}
