import { Fragment, memo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { Badge } from '@/src/components/ui/badge';
import { SearchBar } from '@/src/components/ui/search-bar';
import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import type { GuideSection } from '../catalog-utils';
import type { GuideCategory, MobileGuide } from '../types';
import { GuideIconTile, GuideRows } from './guide-list-rows';

const CONTENT_HORIZONTAL_PADDING = 16;

export type UserGuideHubViewProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** True once the normalised query is non-empty; the view then shows `results`. */
  isSearching: boolean;
  results: readonly MobileGuide[];
  /** Offered when a search finds nothing. */
  suggestions: readonly string[];
  startHere: readonly MobileGuide[];
  topics: readonly GuideSection[];
  onOpenGuide: (guide: MobileGuide) => void;
  onOpenTopic: (category: GuideCategory) => void;
};

/**
 * The hub's content, given everything it needs as props. No routing, data or
 * permission hooks live here, so it renders the same for a given input and
 * can be tested with fixtures.
 */
export const UserGuideHubView = memo(function UserGuideHubView({
  query,
  onQueryChange,
  isSearching,
  results,
  suggestions,
  startHere,
  topics,
  onOpenGuide,
  onOpenTopic,
}: UserGuideHubViewProps): ReactElement {
  const { accentText } = useBubbleAccent();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  return (
    <ScrollView
      className='flex-1'
      keyboardShouldPersistTaps='handled'
      keyboardDismissMode='on-drag'
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: CONTENT_HORIZONTAL_PADDING, paddingBottom: 40 }}
    >
      <SearchBar
        value={query}
        onChangeText={onQueryChange}
        placeholder='What do you want to do?'
        containerClassName='mt-2'
        inputClassName='text-[16px] font-medium'
      />

      {isSearching ? (
        <View className='mt-6'>
          {results.length > 0 ? (
            <>
              <SectionLabel>
                {`${results.length} ${results.length === 1 ? 'guide' : 'guides'}`}
              </SectionLabel>
              <GuideRows guides={results} onOpen={onOpenGuide} />
            </>
          ) : (
            <View className='items-center px-4 pt-6'>
              <Text className='text-center text-[17px] font-semibold' style={{ color: labelColor }}>
                No guides match “{query.trim()}”
              </Text>
              <Text className='mt-1.5 text-center text-[14px]' style={{ color: descriptionColor }}>
                Try one of these instead:
              </Text>
              <View className='mt-4 flex-row flex-wrap justify-center' style={{ gap: 8 }}>
                {suggestions.map(suggestion => (
                  <Badge
                    key={suggestion}
                    label={suggestion}
                    accessibilityRole='button'
                    accessibilityLabel={`Search for ${suggestion}`}
                    onPress={() => {
                      void haptics.selection();
                      onQueryChange(suggestion);
                    }}
                  />
                ))}
              </View>
              <Pressable
                onPress={() => onQueryChange('')}
                accessibilityRole='button'
                accessibilityLabel='Clear search'
                hitSlop={8}
                className='mt-5 rounded-md px-2 py-1 active:opacity-60'
              >
                <Text className='text-[15px] font-semibold' style={{ color: accentText }}>
                  Clear search
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <>
          {startHere.length > 0 ? (
            <View className='mt-6'>
              <SectionLabel>New to Xyne Spaces? Start here</SectionLabel>
              <GuideRows guides={startHere} onOpen={onOpenGuide} showTagline={false} />
            </View>
          ) : null}

          {topics.length > 0 ? (
            <View className='mt-7'>
              <SectionLabel>Browse by topic</SectionLabel>
              <SectionCard>
                {topics.map(({ category, guides }, index) => (
                  <Fragment key={category.id}>
                    <ListRow
                      leading={<GuideIconTile icon={category.icon} color={labelColor} />}
                      label={category.title}
                      value={`${guides.length}`}
                      showChevron
                      onPress={() => onOpenTopic(category)}
                    />
                    {index < topics.length - 1 ? <ListRowDivider /> : null}
                  </Fragment>
                ))}
              </SectionCard>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
});
