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
import type { Counter, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { safeRecordMetric } from './index';

const DAILY_BRIEF_VERSION = '1.0.0';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME, DAILY_BRIEF_VERSION);
}

let _dailyBriefSwitchedTotal: Counter | null = null;

/** Counter: Switches to another brief from the history menu. */
const dailyBriefSwitchedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_dailyBriefSwitchedTotal) {
      _dailyBriefSwitchedTotal = getMeter().createCounter('daily_brief_switched_total', {
        description: 'Total number of switches between briefs from the Daily Brief history menu',
        unit: '1',
      });
    }
    return _dailyBriefSwitchedTotal[prop as keyof Counter];
  },
});

/** Track a switch to another brief from the history menu. */
export function trackDailyBriefSwitched(): void {
  safeRecordMetric(() => {
    dailyBriefSwitchedTotal.add(1);
  });
}
