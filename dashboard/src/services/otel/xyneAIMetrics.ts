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
let _webSearchToolUsedTotal: Counter | null = null;
let _webSearchEnabledTotal: Counter | null = null;

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
 * Counter: Total number of times web search tool was used in Ask AI
 */
export const webSearchToolUsedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_webSearchToolUsedTotal) {
      _webSearchToolUsedTotal = getMeter().createCounter('web_search_tool_used_total', {
        description: 'Total number of times web search tool was used in Ask AI',
        unit: '1',
      });
    }
    return _webSearchToolUsedTotal[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of Ask AI queries submitted with web search enabled
 */
export const webSearchEnabledTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_webSearchEnabledTotal) {
      _webSearchEnabledTotal = getMeter().createCounter('web_search_enabled_total', {
        description: 'Total number of Ask AI queries submitted with web search enabled',
        unit: '1',
      });
    }
    return _webSearchEnabledTotal[prop as keyof Counter];
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

/**
 * Track when web search tool is used in Ask AI
 */
export function trackWebSearchToolUsed(): void {
  safeRecordMetric(() => {
    webSearchToolUsedTotal.add(1);
  });
}

/**
 * Track when Ask AI query is submitted with web search enabled
 */
export function trackWebSearchQuery(): void {
  safeRecordMetric(() => {
    webSearchEnabledTotal.add(1);
  });
}
