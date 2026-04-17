import { useMemo } from 'react';
import { RecapCard, RecapData } from '../components/RecapPanel/RecapPanel.types';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useAllChannels, useUserChannelStatuses } from './useChannels';
import { useAuth } from './useAuth';
import { ChannelUserStatus, ChannelDailyRecap } from '@xyne/shared';

// Type definitions for recap summary data structure
// New format: per-point citation data embedded directly (like ask AI)
interface SummaryPoint {
  text: string;
  messageId?: string;
  conversationId?: string;
  citationIndex?: number;
  // Legacy fields kept for backwards compat with old DB records
  citations?: string[];
  conversationIds?: string[];
}

interface NewFormatSummaryData {
  messageCount?: number;
  points?: SummaryPoint[];
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

type SummaryData = NewFormatSummaryData | OldFormatSummaryData | LegacyFormatSummaryData;

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

// Parse a single recap summary into display fields
const parseSummaryData = (
  summaryData: SummaryData,
): {
  summaryPoints: string[];
  pointCitations: Record<string, { conversationId?: string; messageId?: string }>;
  citationIndices: Record<string, number>;
  drilldownInfo: { conversationId: string | null; messageId: string | null };
  recapWords: number;
} => {
  let summaryPoints: string[] = [];
  const pointCitations: Record<string, { conversationId?: string; messageId?: string }> = {};
  const citationIndices: Record<string, number> = {};
  let drilldownInfo: { conversationId: string | null; messageId: string | null } = {
    conversationId: null,
    messageId: null,
  };
  let recapWords = 0;

  if (isNewFormatSummary(summaryData)) {
    summaryPoints = summaryData.points.map(p => p.text || '');
    recapWords = summaryPoints
      .join(' ')
      .split(/\s+/)
      .filter(word => word.length > 0).length;
    summaryData.points.forEach((p, idx: number) => {
      const key = `${idx + 1}`;
      const messageId = p.messageId ?? p.citations?.[0];
      const conversationId = p.conversationId ?? p.conversationIds?.[0];
      if (messageId || conversationId) {
        pointCitations[key] = {
          ...(messageId && { messageId }),
          ...(conversationId && { conversationId }),
        };
      }
      if (p.citationIndex !== undefined) {
        citationIndices[key] = p.citationIndex;
      }
    });
  } else if (isOldFormatSummary(summaryData)) {
    summaryPoints = summaryData.response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\d+\./))
      .map(line => line.replace(/^\d+\.\s*/, '').trim());
    recapWords = summaryData.response.split(/\s+/).filter(word => word.length > 0).length;
    const oldCitations = summaryData.citations || {};
    const oldMessageIds = summaryData.messageIds || {};
    summaryPoints.forEach((_p, idx) => {
      const key = `${idx + 1}`;
      const messageId = oldCitations[key]?.[0] ?? oldMessageIds[key];
      if (messageId) {
        pointCitations[key] = { messageId };
      }
    });
  } else if (isLegacyFormatSummary(summaryData)) {
    summaryPoints = summaryData.bullets || [];
    recapWords = summaryPoints
      .join(' ')
      .split(/\s+/)
      .filter(word => word.length > 0).length;
    drilldownInfo = {
      conversationId: null,
      messageId: summaryData.firstMessageId || null,
    };
  }

  return { summaryPoints, pointCitations, citationIndices, drilldownInfo, recapWords };
};

// Process raw recap data into cards, merging base and custom recaps per channel
const processRecapCards = (
  recaps: ChannelDailyRecap[],
  channelMap: Map<string, string>,
  currentUserId: string,
): { cards: RecapCard[]; totalMessages: number; totalRecapWords: number } => {
  let totalMessages = 0;
  let totalRecapWords = 0;

  // Separate base recaps (userId IS NULL) from custom recaps (userId = currentUserId)
  const baseRecaps = recaps.filter(r => r.userId === null || r.userId === undefined);
  const customRecapMap = new Map<string, ChannelDailyRecap>(
    recaps.filter(r => r.userId === currentUserId).map(r => [r.channelId, r]),
  );

  const cards = baseRecaps
    .map((recap): RecapCard | null => {
      try {
        const summaryData: SummaryData = JSON.parse(recap.summary) as SummaryData;
        totalMessages += summaryData.messageCount || 0;

        const { summaryPoints, pointCitations, citationIndices, drilldownInfo, recapWords } =
          parseSummaryData(summaryData);
        totalRecapWords += recapWords;

        const card: RecapCard = {
          channelId: recap.channelId,
          channelName: channelMap.get(recap.channelId) || 'Unknown Channel',
          summary: summaryPoints,
          messageCount: summaryData.messageCount || 0,
          drilldown: drilldownInfo,
          ...(Object.keys(pointCitations).length > 0 && { pointCitations }),
          ...(Object.keys(citationIndices).length > 0 && { citationIndices }),
        };

        // Merge custom recap if available for this channel
        const customRecap = customRecapMap.get(recap.channelId);
        if (customRecap) {
          try {
            const customData: SummaryData = JSON.parse(customRecap.summary) as SummaryData;
            const {
              summaryPoints: customPoints,
              pointCitations: customCitations,
              citationIndices: customIndices,
              drilldownInfo: customDrilldown,
            } = parseSummaryData(customData);

            card.hasCustomRecap = true;
            card.customSummary = customPoints;
            card.customMessageCount = customData.messageCount || 0;
            card.customDrilldown = customDrilldown;
            if (Object.keys(customCitations).length > 0) {
              card.customPointCitations = customCitations;
            }
            if (Object.keys(customIndices).length > 0) {
              card.customCitationIndices = customIndices;
            }
          } catch {
            // Custom recap parse failed, just skip it
          }
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

  // Get current user ID for custom recap separation
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? '';

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
    return processRecapCards(dailyRecapsData as ChannelDailyRecap[], channelMap, currentUserId);
  }, [dailyRecapsData, channelMap, currentUserId]);

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
