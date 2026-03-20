import { useMemo } from 'react';
import { useQuery } from './useQuery';
import { queries } from '../zero/queries';
import { useUserChannelStatuses } from './useChannels';

/**
 * Get yesterday's date info in IST (matches useRecapData logic)
 */
const getYesterdayIST = (): { timestamp: number } => {
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

  return { timestamp };
};

/** Status of recap for a channel */
export type RecapStatus = 'available' | 'no_messages' | 'pending' | null;

interface RecapCheckResult {
  channelId: string;
  hasRecap: boolean;
  hasMessages: boolean;
  messageCount: number;
  status: RecapStatus;
}

interface UseCheckChannelRecapReturn {
  /** Whether the check is in progress */
  isChecking: boolean;
  /** Results for each channel that was checked */
  results: RecapCheckResult[];
  /** Map of channelId to RecapStatus for quick lookup */
  recapDetailedStatusMap: Map<string, RecapStatus>;
}

/**
 * Hook to check if recap exists for specific channel IDs.
 * Used when adding new channels to see if recaps already exist for them.
 *
 * @param channelIds - Array of channel IDs to check for existing recaps
 * @param enabled - Whether to enable the check (default: true)
 */
export const useCheckChannelRecap = (
  channelIds: string[],
  enabled: boolean = true,
): UseCheckChannelRecapReturn => {
  const { timestamp: yesterdayTimestamp } = useMemo(() => getYesterdayIST(), []);

  // Get user's channel statuses to check subscription info
  const allUserStatuses = useUserChannelStatuses();

  // Create query args - only query when we have channel IDs and enabled
  const queryArgs = useMemo(
    () => ({
      channelIds: enabled && channelIds.length > 0 ? channelIds : [],
      recapDate: yesterdayTimestamp,
    }),
    [channelIds, yesterdayTimestamp, enabled],
  );

  // Query for existing recaps for the provided channels
  const [recapsData] = useQuery(
    queries.channelDailyRecaps(queryArgs),
    enabled && channelIds.length > 0,
  );

  // Determine if check is in progress - data is undefined/null while loading
  const isChecking =
    enabled && channelIds.length > 0 && (recapsData === undefined || allUserStatuses === null);

  // Process results
  const results: RecapCheckResult[] = useMemo(() => {
    if (!recapsData || !enabled || !allUserStatuses) {
      return [];
    }

    // Create a map of channelId to recap data
    const recapMap = new Map<string, { messageCount: number }>();
    for (const recap of recapsData as { channelId: string; summary: string }[]) {
      try {
        const summaryData = JSON.parse(recap.summary) as { messageCount?: number };
        recapMap.set(recap.channelId, { messageCount: summaryData.messageCount || 0 });
      } catch {
        recapMap.set(recap.channelId, { messageCount: 0 });
      }
    }

    // Create a map of channelId to subscription status
    const subscriptionMap = new Map<
      string,
      { isRecapSubscribed: boolean; lastSeenRecapDate: number | null }
    >();
    for (const status of allUserStatuses) {
      if (channelIds.includes(status.channelId)) {
        subscriptionMap.set(status.channelId, {
          isRecapSubscribed: status.isRecapSubscribed ?? false,
          lastSeenRecapDate: status.lastSeenRecapDate ?? null,
        });
      }
    }

    // Return results for all checked channels
    return channelIds.map(channelId => {
      const recapData = recapMap.get(channelId);
      const hasRecap = !!recapData;
      const messageCount = recapData?.messageCount ?? 0;
      const hasMessages = messageCount > 0;

      // Get subscription info
      const subscriptionInfo = subscriptionMap.get(channelId);
      const isRecapSubscribed = subscriptionInfo?.isRecapSubscribed ?? false;
      const lastSeenRecapDate = subscriptionInfo?.lastSeenRecapDate;

      // Determine status:
      // - If recap exists with messages → 'available'
      // - If recap exists with 0 messages → 'no_messages' (recap was generated but no messages to summarize)
      // - If no recap exists:
      //   - If isRecapSubscribed=true AND lastSeenRecapDate is set → 'no_messages' (recap ran but found 0 messages)
      //   - Otherwise → 'pending' (waiting for next recap cycle)
      let status: RecapStatus;
      if (hasRecap) {
        if (hasMessages) {
          status = 'available';
        } else {
          status = 'no_messages';
        }
      } else {
        // No recap in DB - check if subscription exists with lastSeenRecapDate
        if (isRecapSubscribed && lastSeenRecapDate !== null && lastSeenRecapDate !== undefined) {
          // Subscribed and lastSeenRecapDate is set, but no recap → recap ran but found 0 messages
          status = 'no_messages';
        } else {
          // Not subscribed or no lastSeenRecapDate → waiting for recap
          status = 'pending';
        }
      }

      return {
        channelId,
        hasRecap,
        hasMessages,
        messageCount,
        status,
      };
    });
  }, [recapsData, channelIds, enabled, allUserStatuses]);

  // Create a detailed status map
  const recapDetailedStatusMap = useMemo(() => {
    const map = new Map<string, RecapStatus>();
    for (const result of results) {
      map.set(result.channelId, result.status);
    }
    return map;
  }, [results]);

  return {
    isChecking,
    results,
    recapDetailedStatusMap,
  };
};
