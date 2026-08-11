/**
 * On-device intent classifier metrics.
 *
 * Cardinality note: `service.instance.id` is a per-browser UUID set as a *resource*
 * attribute in telemetry.ts, so it lands on every series and multiplies against every
 * attribute here. This fires far more often than `data_load_duration`, so the
 * attribute sets below are deliberately tight — never add `messageId`, `channelId`,
 * `userId`, or a raw score. See docs/ON_DEVICE_INTENT.md §6.1.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _intentClassificationTotal: Counter | null = null;
let _intentScore: Histogram | null = null;
let _intentEmbedDuration: Histogram | null = null;
let _intentWorkerInitDuration: Histogram | null = null;
let _intentDroppedTotal: Counter | null = null;

export const intentClassificationTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_intentClassificationTotal) {
      _intentClassificationTotal = getMeter().createCounter('intent_classification_total', {
        description:
          'Total on-device intent classifications, by outcome (prefiltered, triggered, shadow)',
        unit: '1',
      });
    }
    return _intentClassificationTotal[prop as keyof Counter];
  },
});

export const intentScore: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_intentScore) {
      _intentScore = getMeter().createHistogram('intent_score', {
        description: 'Top intent cosine similarity per classified message',
        unit: '1',
        advice: {
          // Dense through the decision region so the threshold can be read straight
          // off a Grafana heatmap instead of guessed.
          explicitBucketBoundaries: [
            0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
          ],
        },
      });
    }
    return _intentScore[prop as keyof Histogram];
  },
});

export const intentEmbedDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_intentEmbedDuration) {
      _intentEmbedDuration = getMeter().createHistogram('intent_embed_duration', {
        description: 'On-device embedding latency per message in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [2, 5, 10, 20, 40, 80, 160, 320, 640, 1280],
        },
      });
    }
    return _intentEmbedDuration[prop as keyof Histogram];
  },
});

export const intentWorkerInitDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_intentWorkerInitDuration) {
      _intentWorkerInitDuration = getMeter().createHistogram('intent_worker_init_duration', {
        description: 'Time to load the on-device embedding model in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [100, 250, 500, 1000, 2500, 5000, 10000, 30000],
        },
      });
    }
    return _intentWorkerInitDuration[prop as keyof Histogram];
  },
});

export const intentDroppedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_intentDroppedTotal) {
      _intentDroppedTotal = getMeter().createCounter('intent_dropped_total', {
        description: 'Classifications dropped by the drop-oldest scheduler while busy',
        unit: '1',
      });
    }
    return _intentDroppedTotal[prop as keyof Counter];
  },
});
