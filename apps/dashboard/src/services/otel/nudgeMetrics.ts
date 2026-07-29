import { metrics } from '@opentelemetry/api';
import type { Counter, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { safeRecordMetric } from './index';

const NUDGE_METRICS_VERSION = '1.0.0';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME, NUDGE_METRICS_VERSION);
}

let _nudgeActedTotal: Counter | null = null;
let _nudgeDismissedTotal: Counter | null = null;

/**
 * Counter: Total number of nudges acted on by users
 * Labels: nudge_kind (CREATE_TICKET_FROM_MESSAGE | FIND_RELATED_TICKET_FROM_MESSAGE | FIND_RELATED_MESSAGE_FROM_MESSAGE)
 */
export const nudgeActedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_nudgeActedTotal) {
      _nudgeActedTotal = getMeter().createCounter('nudge_acted_total', {
        description: 'Total number of proactive nudges acted on by users',
        unit: '1',
      });
    }
    return _nudgeActedTotal[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of nudges dismissed by users
 * Labels: nudge_kind
 */
export const nudgeDismissedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_nudgeDismissedTotal) {
      _nudgeDismissedTotal = getMeter().createCounter('nudge_dismissed_total', {
        description: 'Total number of proactive nudges dismissed by users',
        unit: '1',
      });
    }
    return _nudgeDismissedTotal[prop as keyof Counter];
  },
});

/**
 * Track when a nudge is acted on
 * @param nudgeKind - The kind of nudge that was acted on
 */
export function trackNudgeActed(nudgeKind: string): void {
  safeRecordMetric(() => {
    nudgeActedTotal.add(1, { nudge_kind: nudgeKind });
  });
}

/**
 * Track when a nudge is dismissed
 * @param nudgeKind - The kind of nudge that was dismissed
 */
export function trackNudgeDismissed(nudgeKind: string): void {
  safeRecordMetric(() => {
    nudgeDismissedTotal.add(1, { nudge_kind: nudgeKind });
  });
}
