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
} from '../types/searchEvents';
import * as otelMetrics from './otel/searchMetrics';
import { SEARCH_VERSION } from '../config';
import { logger, Event } from '../utils/logger';
import { detectPlatform } from '../hooks/usePlatform';

class SearchMetricsService {
  /**
   * Track when a new search session starts
   */
  trackSessionStart(searchSessionId: string, userId: string, userEmail: string): void {
    // Log structured event
    const event: SearchSessionStartEvent = {
      event_name: 'vespa_search_session_start',
      search_session_id: searchSessionId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      version: SEARCH_VERSION,
    };
    logger.info(Event.VESPA_SEARCH_SESSION_START, { event });

    // Record metrics
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionsStarted.add(1, {
        version: SEARCH_VERSION,
        user_email: userEmail,
        platform: platform,
      });
    });
  }

  /**
   * Track when search results are displayed
   */
  trackImpression(params: {
    searchSessionId: string;
    userId: string;
    userEmail: string;
    queryText: string;
    totalHits: number;
    latencyMs: number;
    facetCounts: Record<string, number>;
    searchTrigger: 'keyboard_shortcut' | 'click' | 'auto_focus';
    searchLocation?: 'global' | 'channel' | 'dm';
  }): void {
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
          user_email: params.userEmail,
          platform: platform,
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
    userEmail: string;
    queryText: string;
    clickedDocId: string;
    clickedDocType: string;
    rankPosition: number;
    channel?: string;
    scrollDepth?: number;
    resultUrl?: string;
  }): void {
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
        user_email: params.userEmail,
        platform: platform,
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
        user_email: params.userEmail,
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
    userEmail: string;
    queryText: string;
    totalImpressions: number;
    dwellTimeMs: number;
    endReason: 'click' | 'abandon' | 'clear' | 'blur';
    totalSessionDurationMs: number;
  }): void {
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
    };
    logger.info(Event.VESPA_SEARCH_SESSION_END, { event });

    // Record metrics - increment session end counter
    const platform = detectPlatform();
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionsEnded.add(1, {
        end_reason: params.endReason,
        version: SEARCH_VERSION,
        user_email: params.userEmail,
        platform: platform,
      });
    });

    // Record dwell time (time spent viewing results before action)
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchDwellTime.record(params.dwellTimeMs, {
        end_reason: params.endReason,
        version: SEARCH_VERSION,
        user_email: params.userEmail,
        platform: platform,
      });
    });

    // Record total session duration
    otelMetrics.safeRecordMetric(() => {
      otelMetrics.searchSessionDuration.record(params.totalSessionDurationMs, {
        version: SEARCH_VERSION,
        user_email: params.userEmail,
        platform: platform,
      });
    });
  }
}

// Singleton instance
export const searchMetricsService = new SearchMetricsService();
