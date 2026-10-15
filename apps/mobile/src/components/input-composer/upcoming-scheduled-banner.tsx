import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ChevronRight, Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import {
  formatUpcomingBanner,
  formatUpcomingBannerCount,
  listUpcomingDelayedMessages,
} from '@/src/features/drafts-sent/schedule-message-utils';
import { useQuery } from '@/src/hooks/useQuery';
import { haptics } from '@/src/utils/haptics';
import { queries } from '@/src/zero/queries';

type UpcomingScheduledBannerProps = {
  channelId: string;
  conversationId: string | null;
  /** Optimistic time until Zero catches up after scheduling from this composer. */
  recentScheduledFor: number | null;
  onRecentScheduledForExpire?: () => void;
};

type UpcomingScheduledBannerModel = {
  visible: boolean;
  upcomingCount: number;
  earliestScheduledFor: number | null;
};

/** True when the schedule info strip is actually painted above the composer. */
export const useUpcomingScheduledBannerVisible = (
  channelId: string,
  conversationId: string | null,
  recentScheduledFor: number | null,
): boolean =>
  useUpcomingScheduledBannerModel(channelId, conversationId, recentScheduledFor).visible;

const useUpcomingScheduledBannerModel = (
  channelId: string,
  conversationId: string | null,
  recentScheduledFor: number | null,
  onRecentScheduledForExpire?: () => void,
): UpcomingScheduledBannerModel => {
  const [now, setNow] = useState(() => Date.now());
  const [rawScheduled] = useQuery(queries.userDelayedMessages());

  const upcomingRows = useMemo(
    () => listUpcomingDelayedMessages(rawScheduled ?? [], channelId, conversationId, now),
    [channelId, conversationId, now, rawScheduled],
  );

  const recentStillValid =
    typeof recentScheduledFor === 'number' && recentScheduledFor > now ? recentScheduledFor : null;

  const recentAlreadyInZero =
    recentStillValid !== null &&
    upcomingRows.some(row => Math.abs(row.scheduledFor - recentStillValid) < 1000);

  const upcomingCount = upcomingRows.length + (recentStillValid && !recentAlreadyInZero ? 1 : 0);
  const earliestScheduledFor = upcomingRows[0]?.scheduledFor ?? recentStillValid ?? null;

  useEffect(() => {
    if (earliestScheduledFor === null) {
      if (recentScheduledFor !== null && recentScheduledFor <= now) {
        onRecentScheduledForExpire?.();
      }
      return;
    }
    const delay = Math.max(50, earliestScheduledFor - Date.now() + 50);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return (): void => clearTimeout(timer);
  }, [earliestScheduledFor, now, onRecentScheduledForExpire, recentScheduledFor]);

  useEffect(() => {
    if (upcomingRows.length > 0 && recentScheduledFor !== null && recentAlreadyInZero) {
      onRecentScheduledForExpire?.();
    }
  }, [onRecentScheduledForExpire, recentAlreadyInZero, recentScheduledFor, upcomingRows.length]);

  return {
    visible: upcomingCount > 0 && earliestScheduledFor !== null,
    upcomingCount,
    earliestScheduledFor,
  };
};

/**
 * Schedule info strip that shares chrome with the composer input bubble.
 * Tapping opens Drafts & Sent → Scheduled.
 */
export const UpcomingScheduledBanner = ({
  channelId,
  conversationId,
  recentScheduledFor,
  onRecentScheduledForExpire,
}: UpcomingScheduledBannerProps): ReactElement | null => {
  const router = useRouter();
  const foreground = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const primary = useCSSVariable('--color-primary') as string;
  const border = useCSSVariable('--color-border') as string;
  const { visible, upcomingCount, earliestScheduledFor } = useUpcomingScheduledBannerModel(
    channelId,
    conversationId,
    recentScheduledFor,
    onRecentScheduledForExpire,
  );

  if (!visible || earliestScheduledFor === null) return null;

  const openScheduledTab = (): void => {
    void haptics.selection();
    router.push({
      pathname: '/(protected)/(shortcuts)/drafts-sent',
      params: { tab: 'scheduled' },
    });
  };

  const bannerCopy =
    upcomingCount > 1
      ? formatUpcomingBannerCount(upcomingCount)
      : formatUpcomingBanner(earliestScheduledFor);

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
      <Pressable
        onPress={openScheduledTab}
        accessibilityRole='button'
        accessibilityLabel='See all scheduled messages'
        className='flex-row items-center gap-2 rounded-t-[20px] bg-conversation-input-pill-bg px-3 py-2 active:opacity-80'
        style={{
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: border,
        }}
      >
        <Clock size={13} color={foreground} />
        <Text
          className='flex-1 text-[12px] leading-4'
          numberOfLines={1}
          style={{ color: foreground }}
        >
          {bannerCopy}
          <Text style={{ color: mutedForeground }}>{' · '}</Text>
          <Text style={{ color: primary, fontWeight: '600' }}>See all</Text>
        </Text>
        <ChevronRight size={14} color={foreground} />
      </Pressable>
    </Animated.View>
  );
};
