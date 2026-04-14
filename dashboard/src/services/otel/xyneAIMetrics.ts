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
let _askAICitationsGeneratedTotal: Counter | null = null;
let _askAICitationClickedTotal: Counter | null = null;
let _askAIDeepResearchEnabledTotal: Counter | null = null;
let _askAICanvasModeEnabledTotal: Counter | null = null;
let _askAIAttachmentsAddedTotal: Counter | null = null;

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

/**
 * Counter: Total number of Ask AI responses that contained citations
 * Labels: agent_type (genius | summarizer | default)
 */
export const askAICitationsGeneratedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAICitationsGeneratedTotal) {
      _askAICitationsGeneratedTotal = getMeter().createCounter('ask_ai_citations_generated_total', {
        description: 'Total number of Ask AI responses that contained citations',
        unit: '1',
      });
    }
    return _askAICitationsGeneratedTotal[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of citation clicks in Ask AI responses
 * Labels: citation_type (genius | summarizer_internal | summarizer_external)
 */
export const askAICitationClickedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAICitationClickedTotal) {
      _askAICitationClickedTotal = getMeter().createCounter('ask_ai_citation_clicked_total', {
        description: 'Total number of citation clicks in Ask AI responses',
        unit: '1',
      });
    }
    return _askAICitationClickedTotal[prop as keyof Counter];
  },
});

/**
 * Track when an Ask AI response with citations is generated
 * @param agentType - The agent that generated the response ('genius' | 'summarizer' | 'default')
 * @param citationCount - Number of citations in the response
 */
export function trackCitationsGenerated(agentType: string, citationCount: number): void {
  safeRecordMetric(() => {
    askAICitationsGeneratedTotal.add(citationCount, { agent_type: agentType });
  });
}

/**
 * Track when a citation is clicked in an Ask AI response
 * @param citationType - 'genius' | 'summarizer_internal' | 'summarizer_external'
 */
export function trackCitationClicked(citationType: string): void {
  safeRecordMetric(() => {
    askAICitationClickedTotal.add(1, { citation_type: citationType });
  });
}

/**
 * Counter: Total number of Ask AI queries submitted with deep research enabled
 */
export const askAIDeepResearchEnabledTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIDeepResearchEnabledTotal) {
      _askAIDeepResearchEnabledTotal = getMeter().createCounter(
        'ask_ai_deep_research_enabled_total',
        {
          description: 'Total number of Ask AI queries submitted with deep research enabled',
          unit: '1',
        },
      );
    }
    return _askAIDeepResearchEnabledTotal[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of Ask AI queries submitted with canvas mode enabled
 */
export const askAICanvasModeEnabledTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAICanvasModeEnabledTotal) {
      _askAICanvasModeEnabledTotal = getMeter().createCounter('ask_ai_canvas_mode_enabled_total', {
        description: 'Total number of Ask AI queries submitted with canvas mode enabled',
        unit: '1',
      });
    }
    return _askAICanvasModeEnabledTotal[prop as keyof Counter];
  },
});

/**
 * Counter: Total number of attachments added to Ask AI queries
 */
export const askAIAttachmentsAddedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIAttachmentsAddedTotal) {
      _askAIAttachmentsAddedTotal = getMeter().createCounter('ask_ai_attachments_added_total', {
        description: 'Total number of attachments added to Ask AI queries',
        unit: '1',
      });
    }
    return _askAIAttachmentsAddedTotal[prop as keyof Counter];
  },
});

/**
 * Track when an Ask AI query is submitted with deep research enabled
 */
export function trackDeepResearchQuery(): void {
  safeRecordMetric(() => {
    askAIDeepResearchEnabledTotal.add(1);
  });
}

/**
 * Track when an Ask AI query is submitted with canvas mode enabled
 */
export function trackCanvasModeQuery(): void {
  safeRecordMetric(() => {
    askAICanvasModeEnabledTotal.add(1);
  });
}

/**
 * Track attachments added to an Ask AI query
 * @param count - Number of attachments added
 */
export function trackAttachmentsAdded(count: number): void {
  safeRecordMetric(() => {
    askAIAttachmentsAddedTotal.add(count);
  });
}
