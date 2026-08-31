/**
 * OpenTelemetry Daily Brief Metrics
 *
 * Switching between briefs is pure client state — the server never sees it, so
 * this is the only place it can be counted. The metric carries the per-device
 * `service.instance.id` resource attribute (see telemetry.ts), which arrives as
 * the Prometheus label `instance`, so `count(count by (instance) (...))` counts
 * devices rather than accounts.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { safeRecordMetric } from './index';

const DAILY_BRIEF_VERSION = '1.0.0';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME, DAILY_BRIEF_VERSION);
}

let _dailyBriefSwitchedTotal: Counter | null = null;

/** Which control the switch came from. Bounded to two values — never widen without checking cardinality. */
export type BriefSwitchSource = 'history_menu' | 'date_picker';

/** Counter: Switches to another brief, split by the control used. */
const dailyBriefSwitchedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_dailyBriefSwitchedTotal) {
      _dailyBriefSwitchedTotal = getMeter().createCounter('daily_brief_switched_total', {
        description: 'Total number of switches between briefs, by the control used',
        unit: '1',
      });
    }
    return _dailyBriefSwitchedTotal[prop as keyof Counter];
  },
});

/** Track a switch to another brief. Device-scoped: `instance` counts devices, not
 *  users — the distinct-user figure comes from the server-side beacon instead. */
export function trackDailyBriefSwitched(source: BriefSwitchSource): void {
  safeRecordMetric(() => {
    dailyBriefSwitchedTotal.add(1, { source });
  });
}

/** How long people are willing to wait before walking away from a regeneration. */
const ABANDON_BUCKETS_SECONDS = [15, 30, 60, 120, 180, 300, 600];

let _dailyBriefRegenerateAbandoned: Histogram | null = null;

/**
 * Histogram: seconds spent waiting before leaving the screen mid-regeneration.
 * Its `_count` is the plain abandonment tally; the buckets say when we lose people.
 */
const dailyBriefRegenerateAbandoned: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_dailyBriefRegenerateAbandoned) {
      _dailyBriefRegenerateAbandoned = getMeter().createHistogram(
        'daily_brief_regenerate_abandoned',
        {
          description: 'Seconds waited before leaving the Daily Brief mid-regeneration',
          unit: 's',
          advice: { explicitBucketBoundaries: ABANDON_BUCKETS_SECONDS },
        },
      );
    }
    return _dailyBriefRegenerateAbandoned[prop as keyof Histogram];
  },
});

/** Track leaving the screen while a regeneration was still running. */
export function trackDailyBriefRegenerateAbandoned(waitedSeconds: number): void {
  safeRecordMetric(() => {
    dailyBriefRegenerateAbandoned.record(waitedSeconds);
  });
}
