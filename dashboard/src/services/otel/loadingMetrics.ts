import { metrics } from '@opentelemetry/api';
import type { Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _loadingAnimationDuration: Histogram | null = null;
let _dataLoadDuration: Histogram | null = null;

export const loadingAnimationDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_loadingAnimationDuration) {
      _loadingAnimationDuration = getMeter().createHistogram('loading_animation_duration', {
        description: 'Duration of loading animations in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000],
        },
      });
    }
    return _loadingAnimationDuration[prop as keyof Histogram];
  },
});

export const dataLoadDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_dataLoadDuration) {
      _dataLoadDuration = getMeter().createHistogram('data_load_duration', {
        description: 'Duration of data loading operations in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000],
        },
      });
    }
    return _dataLoadDuration[prop as keyof Histogram];
  },
});
