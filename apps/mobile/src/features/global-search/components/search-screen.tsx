import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
  type ReactElement,
  type RefObject,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { GlobalSearchFilterBar } from '../components/filters/global-search-filter-bar';
import { SearchCategoryTags } from './search-category-tags';
import { useSearchState, type SearchDispatch } from '../hooks/use-search-state';
import {
  initialTabForSurface,
  SEARCH_TABS,
  tabHrefForSurface,
  type GlobalSearchTab,
  type SearchSourceSurface,
} from '../utils/search-tabs';
import type { SearchFilterChip, SearchScope } from '../types';
import {
  SEARCH_BAR_HEIGHT,
  SEARCH_CATEGORY_ROW_HEIGHT,
  SEARCH_CATEGORY_ROW_TOP_GAP,
  SEARCH_FILTER_ROW_COLLAPSE_DISTANCE,
  SEARCH_FILTER_ROW_HEIGHT,
  SEARCH_FILTER_ROW_TOP_GAP,
} from '../constants';
import { SearchInput, type SearchInputHandle } from './search-input';
import { hostSearchField, searchField$ } from '../search-field-bridge';
import { placeholderForTab } from '../utils/search-tabs';
import { SearchResults } from './search-results';

const TOOLBAR_TOP_PADDING = 10;
const TOOLBAR_BOTTOM_GAP = 8;
const TOOLBAR_EXTRA_LIST_GAP = 16;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  results: { flex: 1, overflow: 'hidden' },
  toolbarInner: { flex: 1, overflow: 'hidden', zIndex: 1 },
});

type RouteParams = {
  initialTab?: string | string[];
  sourceSurface?: string | string[];
  /** Set when opened from a conversation's info screen — locks search to it. */
  scopeChannelId?: string | string[];
  scopeLabel?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isSearchTab(value: string | undefined): value is GlobalSearchTab {
  return SEARCH_TABS.some(tab => tab.id === value);
}

function parseSourceSurface(value: string | undefined): SearchSourceSurface {
  return value === 'channels' || value === 'calls' || value === 'dms' ? value : 'dms';
}

function parseInitialTab(params: RouteParams): GlobalSearchTab {
  const routeTab = firstParam(params.initialTab);
  return isSearchTab(routeTab)
    ? routeTab
    : initialTabForSurface(parseSourceSurface(firstParam(params.sourceSurface)));
}

export type GlobalSearchScreenProps = {
  /**
   * Hands the field to whatever is hosting one — the bottom bar, in the Spaces
   * shell. The toolbar then shows only the category tags and filters, so there
   * is one input on screen rather than two.
   */
  fieldHostedElsewhere?: boolean;
};

export function GlobalSearchScreen({
  fieldHostedElsewhere = false,
}: GlobalSearchScreenProps = {}): ReactElement {
  const params = useLocalSearchParams<RouteParams>();
  const insets = useSafeAreaInsets();

  const [state, dispatch] = useSearchState(parseInitialTab(params));
  const inputRef = useRef<SearchInputHandle>(null);

  /**
   * Publishes this screen's query setter while the field lives elsewhere, and
   * takes it back on unmount so a stale setter can never outlive the screen.
   */
  useEffect(() => {
    if (!fieldHostedElsewhere) return;
    hostSearchField({
      setQuery: (query: string) => dispatch({ type: 'queryCommitted', query }),
    });
    return (): void => hostSearchField(null);
  }, [dispatch, fieldHostedElsewhere]);

  useEffect(() => {
    if (fieldHostedElsewhere) searchField$.placeholder.set(placeholderForTab(state.tab));
  }, [fieldHostedElsewhere, state.tab]);

  /** The locked conversation comes from the route and is never part of the state. */
  const scope = useMemo((): SearchScope | null => {
    const channelId = firstParam(params.scopeChannelId);
    const label = firstParam(params.scopeLabel);
    return channelId && label ? { channelId, label } : null;
  }, [params.scopeChannelId, params.scopeLabel]);

  /** Results scroll offset, written on the UI thread by whichever list is mounted. */
  const scrollOffset = useSharedValue(0);

  /** The block the filter row occupies — the only part of the toolbar that collapses. */
  const filterRowBlock = scope ? 0 : SEARCH_FILTER_ROW_TOP_GAP + SEARCH_FILTER_ROW_HEIGHT;

  const toolbarHeight =
    insets.top +
    TOOLBAR_TOP_PADDING +
    // Zero when the bar hosts the field: the toolbar no longer draws that row,
    // and leaving its height in would open a dead gap above the results.
    (fieldHostedElsewhere ? 0 : SEARCH_BAR_HEIGHT) +
    // Must track the toolbar hiding the tags and filter row when scoped, or the list
    // gets a dead gap above it — listContentTop derives from this.
    (scope ? 0 : SEARCH_CATEGORY_ROW_TOP_GAP + SEARCH_CATEGORY_ROW_HEIGHT) +
    filterRowBlock +
    TOOLBAR_BOTTOM_GAP;

  // Deliberately the *expanded* height: the toolbar collapsing must not reflow the
  // list under it, or content would jump up as the user scrolls down.
  const listContentTop = toolbarHeight + TOOLBAR_EXTRA_LIST_GAP;
  const bottomContentInset = insets.bottom + TOOLBAR_EXTRA_LIST_GAP;

  /** Picking a suggestion adds its chip and eats the `from:` / `in:` that led to it. */
  const pickFilter = useCallback(
    (chip: SearchFilterChip) => {
      dispatch({ type: 'chipAdded', chip });
      inputRef.current?.resolveTrigger();
    },
    [dispatch],
  );

  // Dismissing the keyboard alone leaves the field as first responder on iOS, which
  // can re-present the keyboard over the screen that was just pushed.
  const blurInput = useCallback(() => inputRef.current?.blur(), []);

  return (
    <View className='flex-1 bg-tabs-screen' style={styles.screen}>
      <View style={styles.results}>
        <SearchResults
          state={state}
          scope={scope}
          onPickFilter={pickFilter}
          onLeave={blurInput}
          listContentTop={listContentTop}
          bottomContentInset={bottomContentInset}
          scrollOffset={scrollOffset}
        />
      </View>
      <SearchToolbar
        tab={state.tab}
        chips={state.chips}
        onlyMyChannels={state.onlyMyChannels}
        dispatch={dispatch}
        inputRef={inputRef}
        topInset={insets.top}
        toolbarHeight={toolbarHeight}
        filterRowBlock={filterRowBlock}
        scrollOffset={scrollOffset}
        scope={scope}
        fieldHostedElsewhere={fieldHostedElsewhere}
      />
    </View>
  );
}

/**
 * Takes the slices it shows rather than the whole state, so a committed query or a
 * suggestion being typed does not re-render it.
 */
const SearchToolbar = memo(function SearchToolbar({
  tab,
  chips,
  onlyMyChannels,
  dispatch,
  inputRef,
  topInset,
  toolbarHeight,
  filterRowBlock,
  scrollOffset,
  scope,
  fieldHostedElsewhere,
}: {
  tab: GlobalSearchTab;
  chips: readonly SearchFilterChip[];
  onlyMyChannels: boolean;
  fieldHostedElsewhere: boolean;
  dispatch: SearchDispatch;
  inputRef: RefObject<SearchInputHandle | null>;
  topInset: number;
  toolbarHeight: number;
  /** Height the filter row costs — 0 when scoped, where there is no row to collapse. */
  filterRowBlock: number;
  scrollOffset: SharedValue<number>;
  scope: SearchScope | null;
}): ReactElement {
  const router = useRouter();

  // The screen's own background, so results scrolling under the toolbar are hidden
  // rather than showing through, and the band has no visible edge against the page.
  const backgroundColor = useCSSVariable('--color-tabs-screen') as string;

  const didCloseRef = useRef(false);
  const onRequestClose = useCallback(() => {
    if (didCloseRef.current) return;
    didCloseRef.current = true;

    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(tabHrefForSurface('dms') as Href);
  }, [router]);

  const onTabChange = useCallback(
    (next: GlobalSearchTab) => dispatch({ type: 'tabChanged', tab: next }),
    [dispatch],
  );

  /**
   * The whole toolbar shrinks by exactly the filter row's block, which both clips the
   * row away (the inner column is `overflow: hidden`) and pulls the background band
   * up with it. The pill and the category tags sit above the cut and never move.
   */
  const toolbarStyle = useAnimatedStyle(() => {
    if (filterRowBlock === 0) return { height: toolbarHeight };
    return {
      height: interpolate(
        scrollOffset.value,
        [0, SEARCH_FILTER_ROW_COLLAPSE_DISTANCE],
        [toolbarHeight, toolbarHeight - filterRowBlock],
        Extrapolation.CLAMP,
      ),
    };
  });

  /**
   * Faded out well before the clip reaches it — chips sliced in half by the container
   * edge read as a rendering bug rather than as a collapse.
   */
  const filterRowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollOffset.value,
      [0, SEARCH_FILTER_ROW_COLLAPSE_DISTANCE / 2],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity, pointerEvents: opacity < 0.5 ? 'none' : 'auto' };
  });

  const containerStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: 0,
      right: 0,
      top: 0,
      zIndex: 30,
      backgroundColor,
    }),
    [backgroundColor],
  );

  const innerStyle = useMemo(
    () => [
      styles.toolbarInner,
      { paddingTop: topInset + TOOLBAR_TOP_PADDING, paddingBottom: TOOLBAR_BOTTOM_GAP },
    ],
    [topInset],
  );

  return (
    <Animated.View pointerEvents='box-none' style={[containerStyle, toolbarStyle]}>
      <View pointerEvents='box-none' style={innerStyle}>
        {fieldHostedElsewhere ? null : (
          <SearchInput
            ref={inputRef}
            tab={tab}
            chips={chips}
            scope={scope}
            dispatch={dispatch}
            onRequestClose={onRequestClose}
          />
        )}
        {scope ? null : (
          <>
            <SearchCategoryTags tab={tab} onTabChange={onTabChange} />
            <Animated.View style={filterRowStyle}>
              <GlobalSearchFilterBar
                tab={tab}
                chips={chips}
                onlyMyChannels={onlyMyChannels}
                dispatch={dispatch}
              />
            </Animated.View>
          </>
        )}
      </View>
    </Animated.View>
  );
});
