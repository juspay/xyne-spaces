import { logger, Event as LogEvent } from '../../utils/logger';
/**
 * OpenTelemetry Search Metrics
 *
 * Defines all search-related metrics using OpenTelemetry SDK.
 * These metrics track user search behavior and performance.
 *
 * Note: Metrics are lazy-initialized to ensure OTel provider is ready.
 * The first time a metric is used, it will be created.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { ENABLE_OTEL_METRICS, SEARCH_VERSION, OTEL_SERVICE_NAME } from '../../config';

/**
 * Lazy getter for meter - only accessed when metrics are first used
 * By this time, OTel should be initialized
 */
function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME, SEARCH_VERSION);
}

/**
 * Lazy-initialize counters and histograms
 */
let _searchSessionsStarted: Counter | null = null;
let _searchClicks: Counter | null = null;
let _searchImpressions: Counter | null = null;
let _searchRankScore: Counter | null = null;
let _searchSessionsEnded: Counter | null = null;
let _searchDwellTime: Histogram | null = null;
let _searchSessionDuration: Histogram | null = null;
let _searchTabClicks: Counter | null = null;

/**
 * Counter: Total number of search sessions initiated
 * Labels: version
 */
export const searchSessionsStarted: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchSessionsStarted) {
      _searchSessionsStarted = getMeter().createCounter('search_sessions_started_total', {
        description: 'Total number of search sessions initiated',
        unit: '1',
      });
    }
    return _searchSessionsStarted[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of search result clicks
 * Labels: doc_type, rank, version
 */
export const searchClicks: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchClicks) {
      _searchClicks = getMeter().createCounter('search_clicks_total', {
        description: 'Total number of search result clicks',
        unit: '1',
      });
    }
    return _searchClicks[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of search results shown
 * Labels: doc_type, result_status, version
 */
export const searchImpressions: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchImpressions) {
      _searchImpressions = getMeter().createCounter('search_impressions_count', {
        description: 'Total number of search results shown',
        unit: '1',
      });
    }
    return _searchImpressions[prop as keyof Counter];
  },
});

/**
 * Counter: Cumulative reciprocal rank scores for MRR calculation
 * Labels: doc_type, version
 */
export const searchRankScore: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchRankScore) {
      _searchRankScore = getMeter().createCounter('search_rank_score_total', {
        description: 'Cumulative reciprocal rank scores for MRR calculation',
        unit: '1',
      });
    }
    return _searchRankScore[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of search sessions that ended
 * Labels: end_reason, version
 */
export const searchSessionsEnded: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchSessionsEnded) {
      _searchSessionsEnded = getMeter().createCounter('search_sessions_ended_total', {
        description: 'Total number of search sessions that ended',
        unit: '1',
      });
    }
    return _searchSessionsEnded[prop as keyof Counter];
  },
});

/**
 * Histogram: Time spent viewing search results before taking action (in milliseconds)
 * Labels: end_reason, version
 * Buckets: 200, 400, 600, 800, 1000, 2000, 5000, 10000, 30000, 60000
 */
export const searchDwellTime: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_searchDwellTime) {
      _searchDwellTime = getMeter().createHistogram('search_dwell_time_ms', {
        description: 'Time spent viewing search results before taking action (in milliseconds)',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [200, 400, 600, 800, 1000, 2000, 5000, 10000, 30000, 60000],
        },
      });
    }
    return _searchDwellTime[prop as keyof Histogram];
  },
});

/**
 * Histogram: Total duration of search sessions from start to end (in milliseconds)
 * Labels: version
 * Buckets: 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000
 */
export const searchSessionDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_searchSessionDuration) {
      _searchSessionDuration = getMeter().createHistogram('search_session_duration_ms', {
        description: 'Total duration of search sessions from start to end (in milliseconds)',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000],
        },
      });
    }
    return _searchSessionDuration[prop as keyof Histogram];
  },
});

/**
 * Counter: Total number of search tab clicks
 * Labels: tab_id, tab_name, version
 */
export const searchTabClicks: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_searchTabClicks) {
      _searchTabClicks = getMeter().createCounter('search_tab_clicks_total', {
        description:
          'Total number of search tab clicks (People, Messages, Channels, Tickets, Files)',
        unit: '1',
      });
    }
    return _searchTabClicks[prop as keyof Counter];
  },
});

/**
 * Helper function to safely record metrics
 * Wraps metric operations in try-catch to prevent app crashes
 */
export function safeRecordMetric(fn: () => void): void {
  if (!ENABLE_OTEL_METRICS) {
    return;
  }

  try {
    fn();
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[OTel] Error recording metric:'),
      error: error,
    });
  }
}
