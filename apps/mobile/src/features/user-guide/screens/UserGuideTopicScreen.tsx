import { useCallback, useEffect, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { useCanReadTicket } from '@xyne/shared/hooks';

import { recordScreenView } from '@/src/services/metrics';

import { GUIDE_CATEGORY_BY_ID } from '../categories';
import { filterGuidesForAccess, getGuidesInCategory, isGuideCategoryId } from '../catalog-utils';
import { GuideScreenHeader } from '../components/guide-screen-header';
import { UserGuideTopicView } from '../components/user-guide-topic-view';
import { USER_GUIDES } from '../guides';
import type { MobileGuide } from '../types';

/**
 * Container for one topic: resolves the category from the route, filters its
 * guides by access, records the screen view and routes taps. Rendering is
 * the pure `UserGuideTopicView`.
 */
export default function UserGuideTopicScreen(): ReactElement {
  const router = useRouter();
  const { categoryId: categoryIdParam } = useLocalSearchParams<{
    categoryId?: string | string[];
  }>();
  const categoryId = Array.isArray(categoryIdParam) ? categoryIdParam[0] : categoryIdParam;
  const canReadTickets = useCanReadTicket();
  const screenBg = useCSSVariable('--color-settings-bg') as string;

  const category = isGuideCategoryId(categoryId) ? GUIDE_CATEGORY_BY_ID[categoryId] : null;
  const guides = useMemo(() => {
    if (!category) return [];
    return getGuidesInCategory(filterGuidesForAccess(USER_GUIDES, { canReadTickets }), category.id);
  }, [canReadTickets, category]);

  useEffect(() => {
    if (category) recordScreenView(`user-guide/topic/${category.id}`);
  }, [category]);

  const openGuide = useCallback(
    (guide: MobileGuide): void => {
      router.push({
        pathname: '/(protected)/guide/[guideId]',
        params: { guideId: guide.id },
      } as Href);
    },
    [router],
  );

  return (
    <View className='flex-1' style={{ backgroundColor: screenBg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <GuideScreenHeader />
        <UserGuideTopicView category={category} guides={guides} onOpenGuide={openGuide} />
      </SafeAreaView>
    </View>
  );
}
