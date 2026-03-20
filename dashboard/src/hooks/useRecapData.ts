import { useMemo } from 'react';
import { CitationMetadata, RecapCard, RecapData } from '../components/RecapPanel/RecapPanel.types';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useAllChannels, useUserChannelStatuses } from './useChannels';
import { ChannelUserStatus, ChannelDailyRecap } from '@xyne/shared';

// Type definitions for recap summary data structure
interface SummaryPoint {
  text: string;
  citations?: string[];
}

interface LegacySummaryData {
  messageCount?: number;
  points?: SummaryPoint[];
  response?: string;
  citations?: Record<string, string[]>;
  messageIds?: Record<string, string>;
  bullets?: string[];
  firstMessageId?: string;
  citationMetadata?: CitationMetadata;
}

interface NewFormatSummaryData {
  messageCount?: number;
  points?: SummaryPoint[];
  citationMetadata?: CitationMetadata;
}

interface OldFormatSummaryData {
  messageCount?: number;
  response?: string;
  citations?: Record<string, string[]>;
  messageIds?: Record<string, string>;
}

interface LegacyFormatSummaryData {
  messageCount?: number;
  bullets?: string[];
  firstMessageId?: string;
}

type SummaryData =
  | LegacySummaryData
  | NewFormatSummaryData
  | OldFormatSummaryData
  | LegacyFormatSummaryData;

// Get yesterday's date info in IST (optimized single calculation)
// IMPORTANT: Zero syncs PostgreSQL DateTime as milliseconds, not seconds
// IMPORTANT: Must match backend's persistRecap logic exactly
const getYesterdayIST = (): { timestamp: number; dateStr: string } => {
  const now = new Date();

  // Get today's date string in IST
  const todayStr = now.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse and subtract 1 day to get yesterday
  const [year, month, day] = todayStr.split('-');
  const yesterdayDate = new Date(`${year}-${month}-${day}`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  // Format as YYYY-MM-DD
  const y = yesterdayDate.getFullYear();
  const m = String(yesterdayDate.getMonth() + 1).padStart(2, '0');
  const d = String(yesterdayDate.getDate()).padStart(2, '0');
  const dateStr = y + '-' + m + '-' + d;

  // Create midnight UTC timestamp (same as backend)
  const timestamp = new Date(dateStr + 'T00:00:00Z').getTime();

  return { timestamp, dateStr };
};

interface Channel {
  id: string;
  name: string;
}

// Type guard to check if summary has new format (points array)
function isNewFormatSummary(
  data: SummaryData,
): data is NewFormatSummaryData & { points: SummaryPoint[] } {
  return 'points' in data && Array.isArray(data.points) && data.points !== undefined;
}

// Type guard to check if summary has old format (response + citations)
function isOldFormatSummary(
  data: SummaryData,
): data is OldFormatSummaryData & { response: string; citations: Record<string, string[]> } {
  return 'response' in data && typeof data.response === 'string' && 'citations' in data;
}

// Type guard to check if summary has legacy format (bullets)
function isLegacyFormatSummary(
  data: SummaryData,
): data is LegacyFormatSummaryData & { bullets: string[] } {
  return 'bullets' in data && Array.isArray(data.bullets);
}

// Process raw recap data into cards
const processRecapCards = (
  recaps: ChannelDailyRecap[],
  channelMap: Map<string, string>,
): { cards: RecapCard[]; totalMessages: number; totalRecapWords: number } => {
  let totalMessages = 0;
  let totalRecapWords = 0;

  const cards = recaps
    .map((recap): RecapCard | null => {
      try {
        const summaryData: SummaryData = JSON.parse(recap.summary) as SummaryData;
        totalMessages += summaryData.messageCount || 0;

        let summaryPoints: string[] = [];
        let citations: Record<string, string[]> = {};
        let messageIds: Record<string, string> = {};
        let drilldownInfo: { conversationId: string | null; messageId: string | null } = {
          conversationId: null,
          messageId: null,
        };
        let citationMetadata: CitationMetadata | undefined = undefined;

        if (isNewFormatSummary(summaryData)) {
          // New format: points array with text and citations
          summaryPoints = summaryData.points.map(p => p.text || '');

          // Count words in points
          const recapWords = summaryPoints
            .join(' ')
            .split(/\s+/)
            .filter(word => word.length > 0).length;
          totalRecapWords += recapWords;

          // Build citations map from points
          summaryData.points.forEach((p, idx: number) => {
            if (p.citations && Array.isArray(p.citations)) {
              citations[`${idx + 1}`] = p.citations;
            }
          });

          // Include citationMetadata if available
          if (summaryData.citationMetadata) {
            citationMetadata = summaryData.citationMetadata;
          }
        } else if (isOldFormatSummary(summaryData)) {
          // Old format: response string with citations
          summaryPoints = summaryData.response
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.match(/^\d+\./))
            .map(line => line.replace(/^\d+\.\s*/, '').trim());

          // Count words in response
          const recapWords = summaryData.response
            .split(/\s+/)
            .filter(word => word.length > 0).length;
          totalRecapWords += recapWords;

          citations = summaryData.citations || {};
          messageIds = summaryData.messageIds || {};
        } else if (isLegacyFormatSummary(summaryData)) {
          // Legacy format
          summaryPoints = summaryData.bullets || [];

          // Count words in recap bullets
          const recapWords = summaryPoints
            .join(' ')
            .split(/\s+/)
            .filter(word => word.length > 0).length;
          totalRecapWords += recapWords;

          drilldownInfo = {
            conversationId: null,
            messageId: summaryData.firstMessageId || null,
          };
        }

        const card: RecapCard = {
          channelId: recap.channelId,
          channelName: channelMap.get(recap.channelId) || 'Unknown Channel',
          summary: summaryPoints,
          messageCount: summaryData.messageCount || 0,
          drilldown: drilldownInfo,
          citations,
          messageIds,
        };
        if (citationMetadata) {
          card.citationMetadata = citationMetadata;
        }
        return card;
      } catch {
        return null;
      }
    })
    .filter((card): card is RecapCard => card !== null);

  return { cards, totalMessages, totalRecapWords };
};

/**
 * Hook to manage all recap-related data using Zero for real-time sync
 * - Subscriptions and recaps are fetched via Zero
 * - Data is cached until midnight IST (when new recaps are generated)
 */
export const useRecapData = () => {
  // Get yesterday's date info - stable for the day
  const { timestamp: yesterdayTimestamp, dateStr: yesterdayDateStr } = useMemo(
    () => getYesterdayIST(),
    [],
  );

  // Use existing hook for all channel user statuses - filter client-side for recap subscriptions
  const allUserStatuses = useUserChannelStatuses();

  // Filter to only recap subscriptions - sort for stable reference
  const subscriptionsData = useMemo(
    () =>
      (allUserStatuses || []).filter(
        (status: ChannelUserStatus) => status.isRecapSubscribed === true,
      ),
    [allUserStatuses],
  );

  // Extract channel IDs from subscriptions - sort for stable reference
  const channelIds = useMemo(
    () => subscriptionsData.map((sub: ChannelUserStatus) => sub.channelId).sort(),
    [subscriptionsData],
  );

  // Track if we have valid subscriptions loaded
  const hasSubscriptions = channelIds.length > 0;

  // Create stable query args object (no pagination - Virtuoso handles virtualization)
  const recapQueryArgs = useMemo(
    () => ({
      channelIds: hasSubscriptions ? channelIds : [],
      recapDate: yesterdayTimestamp,
    }),
    [channelIds, yesterdayTimestamp, hasSubscriptions],
  );

  // Fetch daily recaps for subscribed channels via Zero (cached)
  const [dailyRecapsData] = useCachedQuery(queries.channelDailyRecaps(recapQueryArgs), {
    enabled: hasSubscriptions,
  });

  // Fetch channel details for recap channel names using existing hook
  const channelsData = useAllChannels();

  // Build channel map for name lookup
  const channelMap = useMemo(() => {
    const map = new Map<string, string>();
    if (channelsData) {
      for (const channel of channelsData as Channel[]) {
        map.set(channel.id, channel.name);
      }
    }
    return map;
  }, [channelsData]);

  // Process recap data into cards
  const processedData = useMemo(() => {
    if (!dailyRecapsData || dailyRecapsData.length === 0) {
      return { cards: [], totalMessages: 0, totalRecapWords: 0 };
    }
    return processRecapCards(dailyRecapsData as ChannelDailyRecap[], channelMap);
  }, [dailyRecapsData, channelMap]);

  // Calculate time saved
  const estimatedTimeSavedMinutes = useMemo(() => {
    const avgWordsPerMessage = 18;
    const sourceWords = processedData.totalMessages * avgWordsPerMessage;
    const sourceMinutes = sourceWords / 200;
    const recapMinutes = processedData.totalRecapWords / 200;
    return Math.max(0, Math.ceil(sourceMinutes - recapMinutes));
  }, [processedData.totalMessages, processedData.totalRecapWords]);

  // Determine hasUnreadRecap
  const hasUnreadRecap = useMemo(() => {
    if (!subscriptionsData || subscriptionsData.length === 0) return false;
    return subscriptionsData.some(sub => {
      if (!sub.lastSeenRecapDate) return true;
      return sub.lastSeenRecapDate < yesterdayTimestamp;
    });
  }, [subscriptionsData, yesterdayTimestamp]);

  // Calculate unread count - count of channels with recaps that haven't been seen
  const unreadCount = useMemo(() => {
    if (!subscriptionsData || subscriptionsData.length === 0) return 0;
    if (!dailyRecapsData || dailyRecapsData.length === 0) return 0;

    // Get channel IDs that have recaps for yesterday
    const recapChannelIds = new Set(
      (dailyRecapsData as ChannelDailyRecap[]).map(recap => recap.channelId),
    );

    // Count subscriptions where:
    // 1. Channel has a recap for yesterday
    // 2. User hasn't seen it (lastSeenRecapDate is null or less than yesterday's timestamp)
    return subscriptionsData.filter(sub => {
      if (!recapChannelIds.has(sub.channelId)) return false;
      if (!sub.lastSeenRecapDate) return true;
      return sub.lastSeenRecapDate < yesterdayTimestamp;
    }).length;
  }, [subscriptionsData, dailyRecapsData, yesterdayTimestamp]);

  // Build final RecapData object
  const recapData: RecapData | null = useMemo(() => {
    const subscriptions = subscriptionsData;
    const configured = (subscriptions?.length ?? 0) > 0;

    if (!configured) {
      return {
        date: yesterdayDateStr,
        configured: false,
        hasUnreadRecap: false,
        cards: [],
        meta: {
          totalMessages: 0,
          estimatedTimeSavedMinutes: 0,
          date: yesterdayDateStr,
        },
      };
    }

    return {
      date: yesterdayDateStr,
      configured: true,
      hasUnreadRecap,
      cards: processedData.cards,
      meta: {
        totalMessages: processedData.totalMessages,
        estimatedTimeSavedMinutes,
        date: yesterdayDateStr,
      },
    };
  }, [
    subscriptionsData,
    yesterdayDateStr,
    hasUnreadRecap,
    processedData,
    estimatedTimeSavedMinutes,
  ]);

  // Loading states - cached queries return null initially, hook returns empty array initially
  const isLoadingSubscriptions = !allUserStatuses;
  const isLoadingRecaps = !dailyRecapsData && hasSubscriptions;
  const isLoading = isLoadingSubscriptions || isLoadingRecaps;

  // First-time check: user has no subscriptions
  const hasNoSubscriptions = !subscriptionsData || subscriptionsData.length === 0;
  const isFirstTime = !isLoadingSubscriptions && hasNoSubscriptions;

  return {
    // Recap data
    recapData,
    isLoading,
    // Subscriptions
    subscriptions: subscriptionsData || [],
    isLoadingSubscriptions,
    isFirstTime,
    // Unread count
    unreadCount,
  };
};

/**
 * Hook to prefetch recap data (useful for hover states)
 * Zero handles sync automatically - this is kept for backward compatibility
 */
export const usePrefetchRecap = () => {
  return () => {};
};

/**
 * Hook to get only unread count (for sidebar badge)
 * Lightweight alternative when you only need the badge count
 */
export const useRecapUnreadCount = () => {
  const { unreadCount } = useRecapData();
  return { unreadCount };
};
