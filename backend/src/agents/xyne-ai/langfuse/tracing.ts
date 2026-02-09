/**
 * Langfuse Tracing Setup for Xyne AI Agent
 */

import {
  createCompositeTraceCollector,
  type TraceCollector,
  type TraceEvent,
} from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { getLangfuseConfig } from './config.js';

// ============================================================================
// TRACING TOGGLE - Set to false to disable tracing
// ============================================================================
const TRACING_ENABLED = false;

let traceCollector: TraceCollector | null = null;
let isInitialized = false;

function getTraceCollector(): TraceCollector {
  if (!traceCollector) {

    traceCollector = createCompositeTraceCollector();
  }
  
  return traceCollector;
}

// ============================================================================
// Initialization
// ============================================================================

export function initializeLangfuseTracing(): void {
  if (!TRACING_ENABLED) {
    logger.info('[Langfuse] Tracing is disabled via TRACING_ENABLED flag.');
    return;
  }
  
  if (isInitialized) {
    logger.debug('[Langfuse] Already initialized');
    return;
  }
  
  const config = getLangfuseConfig();
  if (!config.enabled) {
    logger.warn('[Langfuse] Tracing not configured. Set LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, and LANGFUSE_BASE_URL to enable. Using fallback prompts.');
    return;
  }
  
  try {
    getTraceCollector();
    isInitialized = true;
    logger.info('[Langfuse] Tracing initialized successfully');
  } catch (error) {
    logger.error('[Langfuse] Failed to initialize tracing:', error);
  }
}

export function createOnEventHandler(): (event: TraceEvent) => void {
  if (!TRACING_ENABLED) {
    return () => {};
  }
  
  const config = getLangfuseConfig();
  
  if (!config.enabled) {
    return () => {};
  }
  
  const collector = getTraceCollector();
  
  return (event: TraceEvent) => {
    try {
      handleEventWithEnrichment(event, collector);
    } catch (error) {
      logger.error('[Langfuse] Error handling event:', error);
    }
  };
}


const SKIP_EVENTS = new Set([
  'agent_processing',
  'before_tool_execution', 
  'assistant_message',
  'turn_start',
  'turn_end',
]);

/**
 * Handle event with session/user enrichment
 */
function handleEventWithEnrichment(event: TraceEvent, collector: TraceCollector): void {
  if (SKIP_EVENTS.has(event.type)) {
    return;
  }

  switch (event.type) {
    case 'run_start': {
      const { runId, traceId, context } = event.data;
      
      // Extract session and user info from context
      const sessionId = context?.sessionId || context?.session_id;
      const userInfo = context?.userInfo;
      const userId = userInfo?.userId || context?.userId || context?.user_id;
      const userEmail = userInfo?.userEmail;
      const userName = userInfo?.userName;
      
      const enrichedEvent = {
        type: 'run_start' as const,
        data: {
          ...event.data,
          sessionId: sessionId,
          userId: userEmail || userId,
          agentName: 'ask-ai-agent',
          context: {
            ...context,
            agentName: 'ask-ai-agent',
            sessionId,
            userId: userEmail || userId,
            userInfo: {
              userId: userId,
              userName: userName,
              userEmail: userEmail,
            },
          },
        },
      };
      
      collector.collect(enrichedEvent);
      
      logger.info(`[Langfuse] [${sessionId || 'no-session'}] Started trace. runId: ${runId}, langfuseTraceId: ${traceId}`);
      break;
    }
    
    case 'run_end': {
      const { runId } = event.data;
      
      collector.collect(event);
      
      const outcome = event.data.outcome;
      logger.info(`[Langfuse] Ended trace. runId: ${runId}, status: ${outcome.status}`);
      break;
    }
    
    default:
      collector.collect(event);
      break;
  }
}
