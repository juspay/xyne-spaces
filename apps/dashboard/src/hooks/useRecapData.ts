import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RawPoint,
  RecapCard,
  RecapData,
  RecapRangeMode,
} from '../components/RecapPanel/RecapPanel.types';
import { clusterPointsIntoTopics } from '../components/RecapPanel/RecapPanel.merge';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useAllChannels, useUserChannelStatuses } from './useChannels';
import { useAuth } from './useAuth';
import { ChannelUserStatus, Recap } from '@xyne/shared';

// Type definitions for recap summary data structure
// New format: per-point citation data embedded directly (like ask AI)
interface SummaryPoint {
  text: string;
  messageId?: string;
  conversationId?: string;
  citationIndex?: number;
  // Only in rows generated after title emission ships; falls back to thread previews
  topicTitle?: string;
  // Legacy fields kept for backwards compat with old DB records
  citations?: string[];
  conversationIds?: string[];
}

// conversationId -> heading, written by the recap generator
type ThreadTitles = Record<string, string>;

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

const DAY_MS = 24 * 60 * 60 * 1000;
// Fetched once for every mode; matches backend RECAP_RETENTION_DAYS
const RECAP_WINDOW_DAYS = 30;
// Channels fetched per page; the rest load as the list is scrolled
const RECAP_CHANNEL_PAGE_SIZE = 10;

// Yesterday's date in IST, as the midnight-UTC timestamp recap rows are keyed by
// IMPORTANT: Zero syncs PostgreSQL DateTime as milliseconds, not seconds
// IMPORTANT: Must match backend's persistRecap logic exactly
const getYesterdayIST = (): number => {
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

  const y = yesterdayDate.getFullYear();
  const m = String(yesterdayDate.getMonth() + 1).padStart(2, '0');
  const d = String(yesterdayDate.getDate()).padStart(2, '0');

  return new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
};

// Timestamp (ms, midnight UTC) -> UTC date string (YYYY-MM-DD)
const toUtcDateStr = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

// "2026-09-04" -> "Sep 4". Formatted in UTC; recap dates are stored at midnight UTC.
const formatShortDate = (utcDateStr: string): string =>
  new Date(`${utcDateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

interface Channel {
  id: string;
  name: string;
}

export interface UseRecapDataOptions {
  // Defaults to 'yesterday' so no-argument callers keep the single-day card.
  mode?: RecapRangeMode;
  // Custom range (YYYY-MM-DD recap dates, inclusive) — only used when mode === 'custom'
  customStart?: string | null;
  customEnd?: string | null;
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

// A recap point parsed from a summary blob, in row order
interface ParsedPoint {
  text: string;
  topicTitle?: string;
  conversationId?: string;
  messageId?: string;
  citationIndex?: number;
}

// Parse a single recap summary blob into ordered points + drilldown
const parseSummaryData = (
  summaryData: SummaryData,
): {
  points: ParsedPoint[];
  drilldownInfo: { conversationId: string | null; messageId: string | null };
  recapWords: number;
} => {
  let points: ParsedPoint[] = [];
  let drilldownInfo: { conversationId: string | null; messageId: string | null } = {
    conversationId: null,
    messageId: null,
  };

  if (isNewFormatSummary(summaryData)) {
    points = summaryData.points.map((p): ParsedPoint => {
      const messageId = p.messageId ?? p.citations?.[0];
      const conversationId = p.conversationId ?? p.conversationIds?.[0];
      return {
        text: p.text || '',
        ...(p.topicTitle && { topicTitle: p.topicTitle }),
        ...(conversationId && { conversationId }),
        ...(messageId && { messageId }),
        ...(p.citationIndex !== undefined && { citationIndex: p.citationIndex }),
      };
    });
  } else if (isOldFormatSummary(summaryData)) {
    const texts = summaryData.response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\d+\./))
      .map(line => line.replace(/^\d+\.\s*/, '').trim());
    const oldCitations = summaryData.citations || {};
    const oldMessageIds = summaryData.messageIds || {};
    points = texts.map((text, idx) => {
      const key = `${idx + 1}`;
      const messageId = oldCitations[key]?.[0] ?? oldMessageIds[key];
      return { text, ...(messageId && { messageId }) };
    });
  } else if (isLegacyFormatSummary(summaryData)) {
    points = (summaryData.bullets || []).map(text => ({ text }));
    drilldownInfo = {
      conversationId: null,
      messageId: summaryData.firstMessageId || null,
    };
  }

  const recapWords = points
    .map(p => p.text)
    .join(' ')
    .split(/\s+/)
    .filter(word => word.length > 0).length;

  return { points, drilldownInfo, recapWords };
};

interface MergedSummary {
  points: string[];
  // Pre-clustering points (day + citation hints per point) — feeds thread clustering
  rawPoints: RawPoint[];
  pointCitations: Record<string, { conversationId?: string; messageId?: string }>;
  citationIndices: Record<string, number>;
  drilldown: { conversationId: string | null; messageId: string | null };
  messageCount: number;
  recapWords: number;
  // Merged across the rows; the newest day that titled a thread wins
  threadTitles: ThreadTitles;
}

// One recap row, parsed exactly once — this hook recomputes on every Zero sync.
interface ParsedRecapRow {
  entityId: string;
  userId: string | null;
  recapDate: number;
  points: ParsedPoint[];
  messageCount: number;
  recapWords: number;
  drilldown: { conversationId: string | null; messageId: string | null };
  threadTitles: ThreadTitles;
}

const parseRecapRow = (row: Recap): ParsedRecapRow | null => {
  let summaryData: SummaryData;
  try {
    summaryData = JSON.parse(row.summary) as SummaryData;
  } catch {
    return null;
  }
  const parsed = parseSummaryData(summaryData);
  return {
    entityId: row.entityId,
    userId: row.userId ?? null,
    recapDate: row.recapDate,
    points: parsed.points,
    messageCount: summaryData.messageCount || 0,
    recapWords: parsed.recapWords,
    drilldown: parsed.drilldownInfo,
    threadTitles: (summaryData as { threadTitles?: ThreadTitles }).threadTitles ?? {},
  };
};

// Merge one channel's rows into a single summary. Points keep their day and citation
// hints for clustering; the flat views are derived for other consumers.
const mergeRecapRows = (rows: ParsedRecapRow[]): MergedSummary => {
  const sorted = [...rows].sort((a, b) => b.recapDate - a.recapDate);
  const rawPoints: RawPoint[] = [];
  let drilldown: { conversationId: string | null; messageId: string | null } = {
    conversationId: null,
    messageId: null,
  };
  let messageCount = 0;
  let recapWords = 0;
  // Rows are newest-first, so the first title seen for a thread is the freshest
  const threadTitles: ThreadTitles = {};

  for (const row of sorted) {
    messageCount += row.messageCount;
    recapWords += row.recapWords;
    for (const [conversationId, title] of Object.entries(row.threadTitles)) {
      if (!(conversationId in threadTitles)) threadTitles[conversationId] = title;
    }

    row.points.forEach((point, idx) => {
      rawPoints.push({
        text: point.text,
        recapDate: row.recapDate,
        order: point.citationIndex ?? idx + 1,
        ...(point.topicTitle && { topicTitle: point.topicTitle }),
        ...(point.conversationId && { conversationId: point.conversationId }),
        ...(point.messageId && { messageId: point.messageId }),
      });
    });

    // Prefer the newest row's drilldown (rows are newest-first)
    if (
      !drilldown.conversationId &&
      !drilldown.messageId &&
      (row.drilldown.conversationId || row.drilldown.messageId)
    ) {
      drilldown = row.drilldown;
    }
  }

  // Derive backwards-compatible flat views from the raw points
  const points = rawPoints.map(p => p.text);
  const pointCitations: Record<string, { conversationId?: string; messageId?: string }> = {};
  const citationIndices: Record<string, number> = {};
  rawPoints.forEach((p, idx) => {
    const key = `${idx + 1}`;
    if (p.conversationId || p.messageId) {
      pointCitations[key] = {
        ...(p.conversationId && { conversationId: p.conversationId }),
        ...(p.messageId && { messageId: p.messageId }),
      };
    }
    citationIndices[key] = p.order;
  });

  return {
    points,
    rawPoints,
    pointCitations,
    citationIndices,
    drilldown,
    messageCount,
    recapWords,
    threadTitles,
  };
};

// contextFloor is lastSeenRecapDate — context never reaches back past it.
interface ChannelWindow {
  windowStart: number;
  windowEnd: number;
  contextFloor: number | null;
}

// One merged card per channel. Rows cover the full fetch range; the window applies here.
const processRecapCards = (
  recaps: ParsedRecapRow[],
  channelMap: Map<string, string>,
  currentUserId: string,
  windowForChannel: (channelId: string) => ChannelWindow,
  channelOrder: Map<string, number>,
): { cards: RecapCard[]; totalMessages: number; totalRecapWords: number } => {
  const baseByChannel = new Map<string, ParsedRecapRow[]>();
  const customByChannel = new Map<string, ParsedRecapRow[]>();
  for (const recap of recaps) {
    const isBase = recap.userId === null;
    const target = isBase ? baseByChannel : recap.userId === currentUserId ? customByChannel : null;
    if (!target) continue;
    const arr = target.get(recap.entityId) ?? [];
    arr.push(recap);
    target.set(recap.entityId, arr);
  }

  let totalMessages = 0;
  let totalRecapWords = 0;
  const cards: RecapCard[] = [];

  for (const [channelId, rows] of baseByChannel) {
    const { windowStart, windowEnd, contextFloor } = windowForChannel(channelId);

    const windowRows = rows.filter(r => r.recapDate >= windowStart && r.recapDate <= windowEnd);
    if (windowRows.length === 0) continue;

    // Older rows feed the clusterer as prior context only
    const contextRows = rows.filter(r => r.recapDate <= windowEnd);

    const windowMerged = mergeRecapRows(windowRows);
    const contextMerged = mergeRecapRows(contextRows);

    const { topics, ungroupedPoints } = clusterPointsIntoTopics(
      contextMerged.rawPoints,
      contextMerged.threadTitles,
      { windowStart, windowEnd, contextFloor },
    );
    if (topics.length === 0 && ungroupedPoints.length === 0) continue;

    // Span and count describe what actually renders, not every day in the window
    const renderedDates = new Set<number>();
    for (const topic of topics) {
      for (const point of topic.points) {
        if (!point.isContext) renderedDates.add(point.recapDate);
      }
    }
    for (const point of ungroupedPoints) renderedDates.add(point.recapDate);
    if (renderedDates.size === 0) continue;

    const renderedRows = windowRows.filter(r => renderedDates.has(r.recapDate));
    const messageCount = renderedRows.reduce((sum, r) => sum + r.messageCount, 0);
    const recapWords = renderedRows.reduce((sum, r) => sum + r.recapWords, 0);

    totalMessages += messageCount;
    totalRecapWords += recapWords;

    const minTs = Math.min(...renderedDates);
    const maxTs = Math.max(...renderedDates);

    const card: RecapCard = {
      channelId,
      channelName: channelMap.get(channelId) || 'Unknown Channel',
      summary: windowMerged.points,
      messageCount,
      drilldown: windowMerged.drilldown,
      ...(Object.keys(windowMerged.pointCitations).length > 0 && {
        pointCitations: windowMerged.pointCitations,
      }),
      ...(Object.keys(windowMerged.citationIndices).length > 0 && {
        citationIndices: windowMerged.citationIndices,
      }),
      topics,
      ungroupedPoints,
      spanStart: formatShortDate(toUtcDateStr(minTs)),
      spanEnd: formatShortDate(toUtcDateStr(maxTs)),
      maxRecapDate: maxTs,
    };

    // Merge the user's custom recap over the same window when present
    const customRows = (customByChannel.get(channelId) ?? []).filter(r => r.recapDate <= windowEnd);
    if (customRows.length > 0) {
      const customWindowRows = customRows.filter(r => r.recapDate >= windowStart);
      const customMerged = mergeRecapRows(customWindowRows);
      const customContext = mergeRecapRows(customRows);
      const customClustered = clusterPointsIntoTopics(
        customContext.rawPoints,
        customContext.threadTitles,
        { windowStart, windowEnd, contextFloor },
      );
      if (customMerged.points.length > 0) {
        card.hasCustomRecap = true;
        card.customSummary = customMerged.points;
        card.customMessageCount = customMerged.messageCount;
        card.customDrilldown = customMerged.drilldown;
        card.customTopics = customClustered.topics;
        card.customUngroupedPoints = customClustered.ungroupedPoints;
        if (Object.keys(customMerged.pointCitations).length > 0) {
          card.customPointCitations = customMerged.pointCitations;
        }
        if (Object.keys(customMerged.citationIndices).length > 0) {
          card.customCitationIndices = customMerged.citationIndices;
        }
      }
    }

    cards.push(card);
  }

  // Follow the order the channels were paged in — sorting by recap recency here would
  // let a later page insert a card above ones already on screen.
  cards.sort(
    (a, b) =>
      (channelOrder.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) -
      (channelOrder.get(b.channelId) ?? Number.MAX_SAFE_INTEGER),
  );

  return { cards, totalMessages, totalRecapWords };
};

/**
 * Recap data via Zero. Daily rows are merged client-side into one card per channel,
 * over the window the selected pill describes.
 */
export const useRecapData = (options?: UseRecapDataOptions) => {
  const mode: RecapRangeMode = options?.mode ?? 'yesterday';
  const customStart = options?.customStart ?? null;
  const customEnd = options?.customEnd ?? null;

  const yesterdayTs = useMemo(() => getYesterdayIST(), []);

  // Fixed at the retention window for every mode; pills narrow client-side, so switching
  // never refetches and context points are always in memory.
  const fetchStartTs = yesterdayTs - (RECAP_WINDOW_DAYS - 1) * DAY_MS;

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

  // Fetch channel details for recap channel names using existing hook
  const channelsData = useAllChannels();

  // Order the subscriptions before any recap is fetched, by channel activity — known from
  // `channels`, so paging can start without knowing a single recapDate, and the order does
  // not shift as later pages arrive (sorting by recap recency would do that).
  //
  // Deliberately NOT ordered unread-first: read state changes while the panel is open, so
  // marking a card read would re-sort its channel past the page boundary and the card
  // would vanish instead of moving to the Read section. The UI still groups unread/read.
  const orderedChannelIds = useMemo(() => {
    const activityByChannel = new Map<string, number>(
      ((channelsData ?? []) as Channel[]).map(c => [c.id, c.lastActivityAt ?? 0]),
    );
    return subscriptionsData
      .map((sub: ChannelUserStatus) => sub.channelId)
      .sort(
        (a, b) =>
          (activityByChannel.get(b) ?? 0) - (activityByChannel.get(a) ?? 0) ||
          a.localeCompare(b),
      );
  }, [subscriptionsData, channelsData]);

  // Only the channels paged in so far are queried. The reset is keyed on the SET of
  // subscriptions, not their order — ordering shifts whenever a channel's lastActivityAt
  // syncs, and keying on that would reset the page out from under an active scroll.
  const [pageCount, setPageCount] = useState(1);
  const subscriptionKey = useMemo(
    () => [...orderedChannelIds].sort().join(','),
    [orderedChannelIds],
  );
  useEffect(() => {
    setPageCount(1);
  }, [subscriptionKey]);

  const channelIds = useMemo(
    () => orderedChannelIds.slice(0, pageCount * RECAP_CHANNEL_PAGE_SIZE),
    [orderedChannelIds, pageCount],
  );
  const hasMoreChannels = channelIds.length < orderedChannelIds.length;
  const loadMoreChannels = useCallback(() => {
    setPageCount(current => current + 1);
  }, []);

  // Track if we have valid subscriptions loaded
  const hasSubscriptions = channelIds.length > 0;

  // Stable query args: one fixed 30-day fetch, narrowed client-side by the pills
  const recapQueryArgs = useMemo(
    () => ({
      channelIds: hasSubscriptions ? channelIds : [],
      startDate: fetchStartTs,
      endDate: yesterdayTs,
    }),
    [channelIds, fetchStartTs, yesterdayTs, hasSubscriptions],
  );

  // Fetch recaps for the resolved range via Zero (cached)
  const [recapsData] = useCachedQuery(queries.channelRecapsRange(recapQueryArgs), {
    enabled: hasSubscriptions,
  });

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

  // Parse every fetched recap row exactly once; everything downstream reads this.
  const parsedRows = useMemo((): ParsedRecapRow[] => {
    if (!recapsData || recapsData.length === 0) return [];
    return (recapsData as Recap[])
      .map(parseRecapRow)
      .filter((r): r is ParsedRecapRow => r !== null);
  }, [recapsData]);

  // "Yesterday" means the newest recap that actually exists, not the calendar date.
  // Generation runs early each morning and skips days with nothing to summarise, so
  // pinning to yesterday leaves the pane empty whenever it has not run yet. Every mode
  // anchors here, keeping the ranges nested: yesterday ⊆ last 7 ⊆ last 14.
  // Base rows only — a channel renders a card only if it has one.
  const latestRecapTs = useMemo(() => {
    let latest = 0;
    for (const row of parsedRows) {
      if (row.userId !== null) continue;
      if (row.recapDate > latest) latest = row.recapDate;
    }
    return latest || yesterdayTs;
  }, [parsedRows, yesterdayTs]);

  // Display date for the default pane, in the midnight-UTC convention the pills use.
  const latestRecapDateStr = useMemo(() => toUtcDateStr(latestRecapTs), [latestRecapTs]);

  const { windowStartTs, windowEndTs } = useMemo((): {
    windowStartTs: number;
    windowEndTs: number;
  } => {
    switch (mode) {
      case 'last7':
        return { windowStartTs: latestRecapTs - 6 * DAY_MS, windowEndTs: latestRecapTs };
      case 'last14':
        return { windowStartTs: latestRecapTs - 13 * DAY_MS, windowEndTs: latestRecapTs };
      case 'custom': {
        if (customStart && customEnd) {
          const rawStart = new Date(`${customStart}T00:00:00Z`).getTime();
          const rawEnd = new Date(`${customEnd}T00:00:00Z`).getTime();
          // Clamp to what retention serves, then keep start <= end so a range outside
          // the servable window cannot produce a backwards label.
          const end = Math.min(rawEnd, latestRecapTs);
          return {
            windowStartTs: Math.min(Math.max(rawStart, fetchStartTs), end),
            windowEndTs: end,
          };
        }
        // No range picked yet — behave like the full retention window
        return { windowStartTs: fetchStartTs, windowEndTs: latestRecapTs };
      }
      case 'yesterday':
      default:
        return { windowStartTs: latestRecapTs, windowEndTs: latestRecapTs };
    }
  }, [mode, customStart, customEnd, latestRecapTs, fetchStartTs]);

  // The window is global; only contextFloor varies per channel.
  const windowForChannel = useMemo(() => {
    const lastSeenByChannel = new Map(
      (subscriptionsData || []).map(s => [s.channelId, s.lastSeenRecapDate ?? null] as const),
    );
    return (channelId: string): ChannelWindow => ({
      windowStart: windowStartTs,
      windowEnd: windowEndTs,
      contextFloor: lastSeenByChannel.get(channelId) ?? null,
    });
  }, [subscriptionsData, windowStartTs, windowEndTs]);

  // Process recap rows into merged, thread-clustered per-channel cards
  const processedData = useMemo(() => {
    if (parsedRows.length === 0) {
      return { cards: [], totalMessages: 0, totalRecapWords: 0 };
    }
    const channelOrder = new Map(orderedChannelIds.map((id, index) => [id, index]));
    return processRecapCards(
      parsedRows,
      channelMap,
      currentUserId,
      windowForChannel,
      channelOrder,
    );
  }, [parsedRows, channelMap, currentUserId, windowForChannel, orderedChannelIds]);

  // Calculate time saved
  const estimatedTimeSavedMinutes = useMemo(() => {
    const avgWordsPerMessage = 18;
    const sourceWords = processedData.totalMessages * avgWordsPerMessage;
    const sourceMinutes = sourceWords / 200;
    const recapMinutes = processedData.totalRecapWords / 200;
    return Math.max(0, Math.ceil(sourceMinutes - recapMinutes));
  }, [processedData.totalMessages, processedData.totalRecapWords]);

  // Drives the sidebar badge, so it must match what opening Recap actually shows:
  // channels unread for the latest recap day, not anywhere in the retention window.
  // Counting the whole window would badge channels whose newest recap predates the
  // default pane, promising cards that are not there.
  const unreadCount = useMemo(() => {
    if (!subscriptionsData || subscriptionsData.length === 0) return 0;
    if (parsedRows.length === 0) return 0;

    const lastSeenByChannel = new Map(
      subscriptionsData.map(s => [s.channelId, s.lastSeenRecapDate ?? null] as const),
    );

    const unreadChannels = new Set<string>();
    for (const recap of parsedRows) {
      if (recap.userId !== null) continue; // base rows only
      if (recap.recapDate !== latestRecapTs) continue;
      const lastSeen = lastSeenByChannel.get(recap.entityId);
      if (lastSeen === undefined) continue; // not a subscription
      if (lastSeen === null || lastSeen < latestRecapTs) {
        unreadChannels.add(recap.entityId);
      }
    }
    return unreadChannels.size;
  }, [subscriptionsData, parsedRows, latestRecapTs]);

  const hasUnreadRecap = unreadCount > 0;

  // Display label for browse modes, e.g. "Sep 1 – Sep 7"
  const rangeLabel = useMemo(() => {
    if (mode === 'yesterday') return undefined;
    return `${formatShortDate(toUtcDateStr(windowStartTs))} – ${formatShortDate(toUtcDateStr(windowEndTs))}`;
  }, [mode, windowStartTs, windowEndTs]);

  // Build final RecapData object
  const recapData: RecapData | null = useMemo(() => {
    const subscriptions = subscriptionsData;
    const configured = (subscriptions?.length ?? 0) > 0;

    if (!configured) {
      return {
        date: latestRecapDateStr,
        configured: false,
        hasUnreadRecap: false,
        cards: [],
        meta: {
          totalMessages: 0,
          estimatedTimeSavedMinutes: 0,
          date: latestRecapDateStr,
        },
      };
    }

    return {
      date: latestRecapDateStr,
      configured: true,
      hasUnreadRecap,
      cards: processedData.cards,
      meta: {
        totalMessages: processedData.totalMessages,
        estimatedTimeSavedMinutes,
        date: latestRecapDateStr,
        ...(rangeLabel && { rangeLabel }),
      },
    };
  }, [
    subscriptionsData,
    latestRecapDateStr,
    hasUnreadRecap,
    processedData,
    estimatedTimeSavedMinutes,
    rangeLabel,
  ]);

  // Loading states - cached queries return null initially, hook returns empty array initially
  const isLoadingSubscriptions = !allUserStatuses;
  const isLoadingRecaps = !recapsData && hasSubscriptions;
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
    // Channel paging
    hasMoreChannels,
    loadMoreChannels,
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
