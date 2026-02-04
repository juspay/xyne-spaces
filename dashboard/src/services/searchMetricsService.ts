/**
 * Search Metrics Service
 *
 * Handles tracking search analytics events using OpenTelemetry metrics.
 * Events are now sent directly to OTel metrics instead of batching to backend.
 */

import type {
  SearchSessionStartEvent,
  SearchImpressionEvent,
  SearchClickEvent,
  SearchSessionEndEvent,
  SearchTabClickEvent,
} from '../types/searchEvents';
import * as otelMetrics from './otel/searchMetrics';
import { SEARCH_VERSION } from '../config';
import { logger, Event } from '../utils/logger';
import { detectPlatform } from '../hooks/usePlatform';
import { TabType } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';

/**
 * Helper function to count words in a text string
 * @param text - The text to count words in
 * @returns The number of words
 */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0).length;
}

class SearchMetricsService {
  /**
   * Track when a new search session starts
   */
  trackSessionStart(searchSessionId: string, userId: string, tab: TabType): void {
    // Log structured event
    const event: SearchSessionStartEvent = {
      event_name: 'vespa_search_session_start',
      search_session_id: searchSessionId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
      tab,
    };
    logger.info(Event.VESPA_SEARCH_SESSION_START, { event });

    // Record metrics
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionsStarted.add(1, {
        version: SEARCH_VERSION,
        user_id: userId,
        platform: platform,
        tab: tab,
      });
    });
  }

  /**
   * Track when search results are displayed
   */
  trackImpression(params: {
    searchSessionId: string;
    userId: string;
    queryText: string;
    totalHits: number;
    latencyMs: number;
    facetCounts: Record<string, number>;
    searchTrigger: 'keyboard_shortcut' | 'click' | 'auto_focus';
    searchLocation?: 'global' | 'channel' | 'dm';
    tab: TabType;
  }): void {
    const words = countWords(params.queryText);
    // Log structured event
    const event: SearchImpressionEvent = {
      event_name: 'vespa_search_impression',
      search_session_id: params.searchSessionId,
      user_id: params.userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
      query_text: params.queryText,
      total_hits: params.totalHits,
      latency_ms: params.latencyMs,
      facet_counts: params.facetCounts,
      is_zero_result: params.totalHits === 0,
      search_trigger: params.searchTrigger,
      query_text_length: words,
      tab: params.tab,
      ...(params.searchLocation && { search_location: params.searchLocation }),
    };
    logger.info(Event.VESPA_SEARCH_IMPRESSION, { event });
    // Record metrics - increment impressions counter for each doc_type in facet_counts
    const platform = detectPlatform();
    Object.entries(params.facetCounts).forEach(([docType, count]) => {
      const resultStatus = count > 0 ? 'success' : 'zero';

      otelMetrics.safeRecordMetric(() => {
        otelMetrics.searchImpressions.add(count, {
          doc_type: docType,
          result_status: resultStatus,
          version: SEARCH_VERSION,
          user_id: params.userId,
          platform: platform,
          query_text_length: words,
          tab: params.tab,
        });
      });
    });
  }

  /**
   * Track when a user clicks on a search result
   */
  trackClick(params: {
    searchSessionId: string;
    userId: string;
    queryText: string;
    clickedDocId: string;
    clickedDocType: string;
    rankPosition: number;
    channel?: string;
    scrollDepth?: number;
    resultUrl?: string;
    tab: TabType;
  }): void {
    const words = countWords(params.queryText);
    // Log structured event
    const event: SearchClickEvent = {
      event_name: 'vespa_search_click',
      search_session_id: params.searchSessionId,
      user_id: params.userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
      query_text: params.queryText,
      clicked_doc_id: params.clickedDocId,
      clicked_doc_type: params.clickedDocType,
      rank_position: params.rankPosition,
      exact_query_text_length: words,
      tab: params.tab,
      ...(params.channel && { channel: params.channel }),
      ...(params.scrollDepth !== undefined && { scroll_depth: params.scrollDepth }),
      ...(params.resultUrl && { result_url: params.resultUrl }),
    };
    logger.info(Event.VESPA_SEARCH_CLICK, { event });
    // Record metrics - increment click counter
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchClicks.add(1, {
        doc_type: params.clickedDocType,
        rank: String(params.rankPosition),
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
        exact_query_text_length: words,
        tab: params.tab,
      });
    });

    // Calculate and increment MRR (Mean Reciprocal Rank) score
    // MRR = 1 / rank_position
    // Example: Click at rank 3 = 1/3 = 0.333...
    const mrrScore = 1 / params.rankPosition;
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchRankScore.add(mrrScore, {
        doc_type: params.clickedDocType,
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
      });
    });
  }

  /**
   * Track when a search session ends
   */
  trackSessionEnd(params: {
    searchSessionId: string;
    userId: string;
    queryText: string;
    totalImpressions: number;
    dwellTimeMs: number;
    endReason: 'click' | 'abandon' | 'clear' | 'blur';
    totalSessionDurationMs: number;
    tab: TabType;
  }): void {
    const words = countWords(params.queryText);
    // Log structured event
    const event: SearchSessionEndEvent = {
      event_name: 'vespa_search_session_end',
      search_session_id: params.searchSessionId,
      user_id: params.userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
      query_text: params.queryText,
      total_impressions: params.totalImpressions,
      dwell_time_ms: params.dwellTimeMs,
      end_reason: params.endReason,
      total_session_duration_ms: params.totalSessionDurationMs,
      query_text_length: words,
      tab: params.tab,
    };
    logger.info(Event.VESPA_SEARCH_SESSION_END, { event });

    // Record metrics - increment session end counter
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionsEnded.add(1, {
        end_reason: params.endReason,
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
        query_text_length: words,
        tab: params.tab,
      });
    });

    // Record dwell time (time spent viewing results before action)
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchDwellTime.record(params.dwellTimeMs, {
        end_reason: params.endReason,
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
      });
    });

    // Record total session duration
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionDuration.record(params.totalSessionDurationMs, {
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
      });
    });
  }

  /**
   * Track when a user clicks on a search tab (People, Messages, Channels, Tickets, Files)
   */
  trackTabClick(params: { searchSessionId: string; userId: string; tab: TabType }): void {
    // Log structured event
    const event: SearchTabClickEvent = {
      event_name: 'search_tab_click',
      search_session_id: params.searchSessionId,
      user_id: params.userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
      tab: params.tab,
    };
    logger.info(Event.VESPA_SEARCH_TAB_CLICK, { event });

    // Record metrics - increment tab click counter with tab labels for individual counts
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchTabClicks.add(1, {
        version: SEARCH_VERSION,
        user_id: params.userId,
        platform: platform,
        tab: params.tab,
      });
    });
  }
}

// Singleton instance
export const searchMetricsService = new SearchMetricsService();
