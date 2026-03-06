import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Ask AI Queries Total Counter
let _askAIQueriesTotal: Counter | null = null;
export const askAIQueriesTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIQueriesTotal) {
      _askAIQueriesTotal = getMeter().createCounter('ask_ai_queries_total', {
        description: 'Total number of Ask AI queries',
        unit: '1',
      });
    }
    return _askAIQueriesTotal[prop as keyof Counter];
  },
});

// Ask AI Query Duration Histogram
let _askAIQueryDuration: Histogram | null = null;
export const askAIQueryDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_askAIQueryDuration) {
      _askAIQueryDuration = getMeter().createHistogram('ask_ai_query_duration', {
        description: 'Duration of Ask AI queries in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [100, 500, 1000, 2500, 5000, 10000, 25000, 60000],
        },
      });
    }
    return _askAIQueryDuration[prop as keyof Histogram];
  },
});

// Ask AI Context Channels Count Histogram
let _askAIContextChannels: Histogram | null = null;
export const askAIContextChannels: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_askAIContextChannels) {
      _askAIContextChannels = getMeter().createHistogram('ask_ai_context_channels_count', {
        description: 'Number of channels used as context in Ask AI queries',
        unit: '1',
        advice: {
          explicitBucketBoundaries: [0, 1, 2, 3, 4, 5],
        },
      });
    }
    return _askAIContextChannels[prop as keyof Histogram];
  },
});

// Ask AI Feedback Total Counter
let _askAIFeedbackTotal: Counter | null = null;
export const askAIFeedbackTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIFeedbackTotal) {
      _askAIFeedbackTotal = getMeter().createCounter('ask_ai_feedback_total', {
        description: 'Total number of Ask AI feedback submissions',
        unit: '1',
      });
    }
    return _askAIFeedbackTotal[prop as keyof Counter];
  },
});

// Web Search Enabled Total Counter
let _webSearchEnabledTotal: Counter | null = null;
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

// Web Search Tool Used Total Counter
let _webSearchToolUsedTotal: Counter | null = null;
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

// Ask AI Attachment Used Total Counter
let _askAIAttachmentUsedTotal: Counter | null = null;
export const askAIAttachmentUsedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIAttachmentUsedTotal) {
      _askAIAttachmentUsedTotal = getMeter().createCounter('ask_ai_attachment_used_total', {
        description: 'Total number of times attachments were used in Ask AI queries',
        unit: '1',
      });
    }
    return _askAIAttachmentUsedTotal[prop as keyof Counter];
  },
});

// Ask AI Genius Used Total Counter
let _askAIGeniusUsedTotal: Counter | null = null;
export const askAIGeniusUsedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIGeniusUsedTotal) {
      _askAIGeniusUsedTotal = getMeter().createCounter('ask_ai_genius_used_total', {
        description: 'Total number of times Genius tool was used in Ask AI',
        unit: '1',
      });
    }
    return _askAIGeniusUsedTotal[prop as keyof Counter];
  },
});

// Ask AI Research Agent Used Total Counter
let _askAIResearchAgentUsedTotal: Counter | null = null;
export const askAIResearchAgentUsedTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_askAIResearchAgentUsedTotal) {
      _askAIResearchAgentUsedTotal = getMeter().createCounter('ask_ai_research_agent_used_total', {
        description: 'Total number of times Research Agent was used in Ask AI',
        unit: '1',
      });
    }
    return _askAIResearchAgentUsedTotal[prop as keyof Counter];
  },
});
