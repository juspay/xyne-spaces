import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCSSVariable } from 'uniwind';
import { useCanReadTicket } from '@xyne/shared/hooks';

import { recordScreenView } from '@/src/services/metrics';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';

import {
  filterGuidesForAccess,
  findGuideById,
  getPositionInCategory,
  getRelatedGuides,
} from '../catalog-utils';
import { GuideScreenHeader } from '../components/guide-screen-header';
import { UserGuideDetailView } from '../components/user-guide-detail-view';
import { readGuideFeedback, writeGuideFeedback, type GuideFeedback } from '../guide-feedback';
import { armGuideReturn } from '../guide-return-store';
import { USER_GUIDES } from '../guides';
import type { MobileGuide } from '../types';

/**
 * Container for one guide: resolves it from the route, gathers position and
 * related guides, owns feedback storage, the return-bar hand-off, metrics and
 * navigation. Rendering is the pure `UserGuideDetailView`.
 */
export default function UserGuideDetailScreen(): ReactElement {
  const router = useRouter();
  const { guideId: guideIdParam } = useLocalSearchParams<{ guideId?: string | string[] }>();
  const guideId = Array.isArray(guideIdParam) ? guideIdParam[0] : guideIdParam;
  const canReadTickets = useCanReadTicket();
  const screenBg = useCSSVariable('--color-settings-bg') as string;

  const accessibleGuides = useMemo(
    () => filterGuidesForAccess(USER_GUIDES, { canReadTickets }),
    [canReadTickets],
  );
  const guide = useMemo(
    () => findGuideById(accessibleGuides, guideId),
    [accessibleGuides, guideId],
  );
  const related = useMemo(
    () => (guide ? getRelatedGuides(accessibleGuides, guide) : []),
    [accessibleGuides, guide],
  );
  const position = useMemo(
    () => (guide ? getPositionInCategory(accessibleGuides, guide) : null),
    [accessibleGuides, guide],
  );

  const [feedback, setFeedback] = useState<GuideFeedback | null>(() =>
    guideId ? readGuideFeedback(guideId) : null,
  );

  useEffect(() => {
    if (guide) recordScreenView(`user-guide/${guide.id}`);
  }, [guide]);

  const goToHub = useCallback((): void => {
    router.replace('/(protected)/guide' as Href);
  }, [router]);

  const openGuide = useCallback(
    (target: MobileGuide): void => {
      router.push({
        pathname: '/(protected)/guide/[guideId]',
        params: { guideId: target.id },
      } as Href);
    },
    [router],
  );

  const handleTryIt = useCallback((): void => {
    if (!guide?.tryIt) return;
    // The floating "Back to guide" bar on the target screen reads this.
    armGuideReturn({ guideId: guide.id, title: guide.title });
    router.push(guide.tryIt.href as Href);
  }, [guide, router]);

  const handleWatchVideo = useCallback((): void => {
    if (!guide?.videoUrl) return;
    void WebBrowser.openBrowserAsync(guide.videoUrl).catch(() => {
      showMessageToast('Could not open the video', 'error');
    });
  }, [guide]);

  const handleFeedback = useCallback(
    (answer: GuideFeedback): void => {
      if (!guide) return;
      void (answer === 'yes' ? haptics.success() : haptics.selection());
      writeGuideFeedback(guide.id, answer);
      setFeedback(answer);
    },
    [guide],
  );

  const openReportIssue = useCallback((): void => {
    router.push('/report-issue' as Href);
  }, [router]);

  return (
    <View className='flex-1' style={{ backgroundColor: screenBg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <GuideScreenHeader />
        <UserGuideDetailView
          guide={guide}
          position={position}
          related={related}
          feedback={feedback}
          onTryIt={handleTryIt}
          onWatchVideo={handleWatchVideo}
          onOpenGuide={openGuide}
          onFeedback={handleFeedback}
          onReportIssue={openReportIssue}
          onBrowseAll={goToHub}
        />
      </SafeAreaView>
    </View>
  );
}
