/**
 * OpenTelemetry Xyne AI Metrics
 *
 * Defines all Xyne AI (Ask AI) related metrics using OpenTelemetry SDK.
 * These metrics track user interactions with the Ask AI feature.
 *
 * Note: Metrics are lazy-initialized to ensure OTel provider is ready.
 * The first time a metric is used, it will be created.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Meter } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { safeRecordMetric } from './index';

const XYNE_AI_VERSION = '1.0.0';

/**
 * Lazy getter for meter - only accessed when metrics are first used
 * By this time, OTel should be initialized
 */
function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME, XYNE_AI_VERSION);
}

/**
 * Lazy-initialize counters
 */
let _askAIOpenedTotal: Counter | null = null;

/**
 * Counter: Total number of times Ask AI was opened
 * Labels: scope_type (DM, GROUP_DM, CHANNEL, etc.)
 */
export const askAIOpenedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIOpenedTotal) {
      _askAIOpenedTotal = getMeter().createCounter('ask_ai_opened_total', {
        description: 'Total number of times Ask AI was opened',
        unit: '1',
      });
    }
    return _askAIOpenedTotal[prop as keyof Counter];
  },
});

/**
 * Track when Ask AI is opened
 * @param scopeType - The channel type (DM, GROUP_DM, CHANNEL, etc.)
 */
export function trackAskAIOpened(scopeType?: string): void {
  safeRecordMetric(() => {
    askAIOpenedTotal.add(1, { scope_type: scopeType || 'unknown' });
  });
}
