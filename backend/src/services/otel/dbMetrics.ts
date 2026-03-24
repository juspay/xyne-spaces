import { metrics } from '@opentelemetry/api';
import type { Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Database Query Duration Histogram
let _dbQueryDuration: Histogram | null = null;
export function getDbQueryDuration(): Histogram {
  if (!_dbQueryDuration) {
    _dbQueryDuration = getMeter().createHistogram('db_query_duration_ms', {
      description: 'Duration of database queries in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      },
    });
  }
  return _dbQueryDuration;
}
