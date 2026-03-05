/**
 * Langfuse Tracing Setup for Xyne AI Agent
 */

import {
  createCompositeTraceCollector,
  type TraceCollector,
  type TraceEvent,
  type Message,
} from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { getLangfuseConfig } from './config.js';
import type { XyneAIConfig } from '../config.js';

// ============================================================================
// CONTENT MASKING PLACEHOLDERS
// ============================================================================
const MASKED_OUTPUT_PLACEHOLDER = '[MASKED - Agent Output]';
const MASKED_TOOL_OUTPUT_PLACEHOLDER = '[MASKED - Tool Output]';

let traceCollector: TraceCollector | null = null;
let isInitialized = false;

function getTraceCollector(): TraceCollector {
  if (!traceCollector) {
    traceCollector = createCompositeTraceCollector();
  }
  
  return traceCollector;
}

function createMaskMessage(maskingEnabled: boolean) {
  return function maskMessage(message: Message): { role: 'user' | 'assistant' | 'tool'; content: string } {
    const role = message.role || 'assistant';
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    
    if (!maskingEnabled) {
      return { role, content };
    }
    
    if (role === 'user') {
      return { role, content };
    }
    
    return {
      role,
      content: role === 'tool' ? MASKED_TOOL_OUTPUT_PLACEHOLDER : MASKED_OUTPUT_PLACEHOLDER,
    };
  };
}

function createMaskMessages(maskingEnabled: boolean) {
  const maskMessage = createMaskMessage(maskingEnabled);
  return function maskMessages(messages: readonly Message[]): readonly { role: 'user' | 'assistant' | 'tool'; content: string }[] {
    return messages.map(maskMessage);
  };
}

function createMaskToolOutput(maskingEnabled: boolean) {
  return function maskToolOutput(result: unknown): string {
    if (!maskingEnabled) {
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    return MASKED_TOOL_OUTPUT_PLACEHOLDER;
  };
}

function createMaskOutcomeOutput(maskingEnabled: boolean) {
  return function maskOutcomeOutput(outcome: unknown): unknown {
    if (!maskingEnabled) {
      return outcome;
    }
    
    const outcomeObj = outcome as { status?: string; output?: unknown; error?: unknown };
    
    if (outcomeObj.status === 'completed' && outcomeObj.output !== undefined) {
      return {
        ...outcomeObj,
        output: MASKED_OUTPUT_PLACEHOLDER,
      };
    }
    
    return outcomeObj;
  };
}

// ============================================================================
// Initialization
// ============================================================================

export function initializeLangfuseTracing(): void {
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

/**
 * Create an event handler for Langfuse tracing
 * @param xyneAIConfig - CAC config with tracingEnabled and maskingEnabled flags
 */
export function createOnEventHandler(xyneAIConfig: XyneAIConfig): (event: TraceEvent) => void {
  // Check if tracing is enabled via CAC config
  if (!xyneAIConfig.tracingEnabled) {
    return () => {};
  }
  
  const langfuseConfig = getLangfuseConfig();
  
  if (!langfuseConfig.enabled) {
    return () => {};
  }
  
  const collector = getTraceCollector();
  
  // Create masking functions based on CAC config
  const maskMessage = createMaskMessage(xyneAIConfig.maskingEnabled);
  const maskMessages = createMaskMessages(xyneAIConfig.maskingEnabled);
  const maskToolOutput = createMaskToolOutput(xyneAIConfig.maskingEnabled);
  const maskOutcomeOutput = createMaskOutcomeOutput(xyneAIConfig.maskingEnabled);
  
  return (event: TraceEvent) => {
    try {
      handleEventWithEnrichment(event, collector, maskMessage, maskMessages, maskToolOutput, maskOutcomeOutput);
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
 * Handle event with session/user enrichment and content masking
 */
function handleEventWithEnrichment(
  event: TraceEvent,
  collector: TraceCollector,
  maskMessage: (message: Message) => { role: 'user' | 'assistant' | 'tool'; content: string },
  maskMessages: (messages: readonly Message[]) => readonly { role: 'user' | 'assistant' | 'tool'; content: string }[],
  maskToolOutput: (result: unknown) => string,
  maskOutcomeOutput: (outcome: unknown) => unknown
): void {
  if (SKIP_EVENTS.has(event.type)) {
    return;
  }

  switch (event.type) {
    case 'run_start': {
      const { runId, traceId, context, messages } = event.data;
      
      // Extract session and user info from context
      const sessionId = context?.sessionId || context?.session_id;
      const userInfo = context?.userInfo;
      const userId = userInfo?.userId || context?.userId || context?.user_id;
      const userEmail = userInfo?.userEmail;
      const userName = userInfo?.userName;
      
      const maskedContext = {
        ...context,
        agentName: 'ask-ai-agent',
        sessionId,
        userId: userEmail || userId,
        userInfo: {
          userId: userId,
          userName: userName,
          userEmail: userEmail,
        },
      };
      
      // Mask the input messages
      const maskedMessages = messages ? maskMessages(messages) : undefined;
      const eventDataAny = event.data as Record<string, unknown>;
      
      const enrichedEvent = {
        type: 'run_start' as const,
        data: {
          ...event.data,
          sessionId: sessionId,
          userId: userEmail || userId,
          agentName: 'ask-ai-agent',
          messages: maskedMessages,
          ...(eventDataAny.user_query ? { user_query: eventDataAny.user_query } : {}),
          context: maskedContext,
        },
      };
      
      collector.collect(enrichedEvent);
      
      logger.info(`[Langfuse] [${sessionId || 'no-session'}] Started trace. runId: ${runId}, langfuseTraceId: ${traceId}`);
      break;
    }
    
    case 'llm_call_start': {
      const maskedEvent = {
        type: 'llm_call_start' as const,
        data: {
          ...event.data,
          messages: event.data.messages ? maskMessages(event.data.messages) : undefined,
          model: event.data.model,
        },
      };
      
      collector.collect(maskedEvent);
      break;
    }
    
    case 'llm_call_end': {
      const choice = event.data.choice;
      const maskedChoice = choice ? {
        ...choice,
        message: choice.message ? maskMessage(choice.message) : undefined,
      } : undefined;
      
      const maskedEvent = {
        type: 'llm_call_end' as const,
        data: {
          ...event.data,
          choice: maskedChoice,
          usage: event.data.usage,
          model: event.data.model,
        },
      };
      
      collector.collect(maskedEvent);
      break;
    }
    
    case 'tool_call_start': {
      collector.collect(event);
      break;
    }
    
    case 'tool_call_end': {
      const maskedEvent = {
        type: 'tool_call_end' as const,
        data: {
          ...event.data,
          toolName: event.data.toolName,
          result: maskToolOutput(event.data.result),
          executionTime: event.data.executionTime,
        },
      };
      
      collector.collect(maskedEvent);
      break;
    }
    
    case 'run_end': {
      const { runId } = event.data;
      const outcome = event.data.outcome;
      const maskedOutcome = maskOutcomeOutput(outcome) as typeof outcome;
      
      const maskedEvent = {
        type: 'run_end' as const,
        data: {
          ...event.data,
          outcome: maskedOutcome,
        },
      };
      
      collector.collect(maskedEvent);
      
      logger.info(`[Langfuse] Ended trace. runId: ${runId}, status: ${outcome.status}`);
      break;
    }
    
    default:
      collector.collect(event);
      break;
  }
}
