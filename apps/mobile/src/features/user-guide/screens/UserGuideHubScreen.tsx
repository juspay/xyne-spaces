import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter, type Href } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { useCanReadTicket } from '@xyne/shared/hooks';

import { recordScreenView } from '@/src/services/metrics';

import { filterGuidesForAccess, getBrowseSections, getStartHereGuides } from '../catalog-utils';
import { GuideScreenHeader } from '../components/guide-screen-header';
import { UserGuideHubView } from '../components/user-guide-hub-view';
import { USER_GUIDES } from '../guides';
import { GUIDE_SEARCH_SUGGESTIONS, normalizeGuideQuery, searchGuides } from '../search';
import type { GuideCategory, MobileGuide } from '../types';

const HUB_SCREEN_NAME = 'user-guide';

function guideHref(guide: MobileGuide): Href {
  return { pathname: '/(protected)/guide/[guideId]', params: { guideId: guide.id } } as Href;
}

function topicHref(category: GuideCategory): Href {
  return {
    pathname: '/(protected)/guide/topic/[categoryId]',
    params: { categoryId: category.id },
  } as Href;
}

/**
 * Container for the guide's front door: resolves what the user may see,
 * runs search, records the screen view and routes taps. Rendering is the
 * pure `UserGuideHubView`.
 */
export default function UserGuideHubScreen(): ReactElement {
  const router = useRouter();
  const canReadTickets = useCanReadTicket();
  const screenBg = useCSSVariable('--color-settings-bg') as string;
  const [query, setQuery] = useState('');

  useEffect(() => {
    recordScreenView(HUB_SCREEN_NAME);
  }, []);

  const accessibleGuides = useMemo(
    () => filterGuidesForAccess(USER_GUIDES, { canReadTickets }),
    [canReadTickets],
  );
  const normalizedQuery = normalizeGuideQuery(query);
  const isSearching = normalizedQuery.length > 0;
  const results = useMemo(
    () => (isSearching ? searchGuides(accessibleGuides, normalizedQuery) : []),
    [accessibleGuides, isSearching, normalizedQuery],
  );
  const startHere = useMemo(() => getStartHereGuides(accessibleGuides), [accessibleGuides]);
  const topics = useMemo(() => getBrowseSections(accessibleGuides), [accessibleGuides]);

  const openGuide = useCallback(
    (guide: MobileGuide): void => router.push(guideHref(guide)),
    [router],
  );
  const openTopic = useCallback(
    (category: GuideCategory): void => router.push(topicHref(category)),
    [router],
  );

  return (
    <View className='flex-1' style={{ backgroundColor: screenBg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <GuideScreenHeader title='User guide' showHome={false} />
        <UserGuideHubView
          query={query}
          onQueryChange={setQuery}
          isSearching={isSearching}
          results={results}
          suggestions={GUIDE_SEARCH_SUGGESTIONS}
          startHere={startHere}
          topics={topics}
          onOpenGuide={openGuide}
          onOpenTopic={openTopic}
        />
      </SafeAreaView>
    </View>
  );
}
