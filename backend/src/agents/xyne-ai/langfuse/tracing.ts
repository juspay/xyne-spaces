/**
 * Langfuse Tracing Setup for Xyne AI Agent
 */

import {
  OpenTelemetryTraceCollector,
  type TraceCollector,
  type TraceEvent,
  type Message,
} from '@juspay-jaf/jaf';
import { logger } from '../../../utils/logger.js';
import { getLangfuseConfig } from './config.js';
import type { AgentsConfig } from '../../config.js';

// ============================================================================
// CONTENT MASKING PLACEHOLDERS
// ============================================================================
const MASKED_OUTPUT_PLACEHOLDER = '[MASKED - Agent Output]';
const MASKED_TOOL_OUTPUT_PLACEHOLDER = '[MASKED - Tool Output]';

let otelCollector: OpenTelemetryTraceCollector | null = null;
let traceCollector: TraceCollector | null = null;
let isInitialized = false;

// Holds extra span attributes keyed by JAF traceId, pending until OTEL creates the span
const pendingSpanAttributes = new Map<string, Record<string, unknown>>();

// Holds masked run_end events until citation URLs are computed, then finalizes the span
const pendingRunEnd = new Map<string, TraceEvent>();

function getTraceIdFromEvent(event: TraceEvent): string | null {
  const data = (event as unknown as { data?: Record<string, unknown> }).data;
  return (data?.traceId || data?.runId || data?.trace_id || data?.run_id) as string | null;
}

function getTraceCollector(): TraceCollector {
  if (!traceCollector) {
    otelCollector = new OpenTelemetryTraceCollector();

    // Wrap the OTEL collector so that after it processes run_start (creating the
    // root span), we immediately set our enriched request-context attributes on it.
    const otel = otelCollector;
    traceCollector = {
      collect(event: TraceEvent) {
        otel.collect(event);

        if (event.type === 'run_start') {
          const traceId = getTraceIdFromEvent(event);
          if (traceId) {
            const attrs = pendingSpanAttributes.get(String(traceId));
            if (attrs) {
              // traceSpans is private in TS but exists at runtime
              const span = (otel as unknown as { traceSpans: Map<string, { setAttributes(a: Record<string, unknown>): void }> })
                .traceSpans.get(String(traceId));
              if (span?.setAttributes) {
                span.setAttributes(attrs);
              }
              pendingSpanAttributes.delete(String(traceId));
            }
          }
        }
      },
      getTrace: (id) => otel.getTrace(id),
      getAllTraces: () => otel.getAllTraces(),
      clear: (id) => otel.clear(id),
    };
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
 * @param agentsConfig - CAC config with tracingEnabled and maskingEnabled flags
 */
export function createOnEventHandler(agentsConfig: AgentsConfig): (event: TraceEvent) => void {
  // Check if tracing is enabled via CAC config
  if (!agentsConfig.xyneAiTracingEnabled) {
    return () => {};
  }
  
  const langfuseConfig = getLangfuseConfig();
  
  if (!langfuseConfig.enabled) {
    return () => {};
  }
  
  const collector = getTraceCollector();
  
  // Create masking functions based on CAC config
  const maskMessage = createMaskMessage(agentsConfig.xyneAiMaskingEnabled);
  const maskMessages = createMaskMessages(agentsConfig.xyneAiMaskingEnabled);
  const maskToolOutput = createMaskToolOutput(agentsConfig.xyneAiMaskingEnabled);
  const maskOutcomeOutput = createMaskOutcomeOutput(agentsConfig.xyneAiMaskingEnabled);
  
  return (event: TraceEvent) => {
    try {
      handleEventWithEnrichment(event, collector, agentsConfig.xyneAiMaskingEnabled, maskMessage, maskMessages, maskToolOutput, maskOutcomeOutput);
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
  maskingEnabled: boolean,
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
      
      const agentName = context?.agentName ?? 'ask-ai';

      // Extract rich request context metadata
      const agentRequestContext = context?.agentRequestContext || {};

      const attachments = (agentRequestContext.attachments || []) as Array<{ mime_type?: string; filename?: string; data?: string }>;
      const canvasSummaries = (agentRequestContext.canvasSummaries || []) as Array<{ id: string; title: string }>;
      const ticketSummaries = (agentRequestContext.ticketSummaries || []) as Array<{ id: string; xyneId: string; title: string }>;
      const callSummaries = (agentRequestContext.callSummaries || []) as Array<{ id: string; title: string }>;

      const enrichedMetadata = {
        // Channel and Thread Context — channel names instead of raw IDs
        channelNames: (agentRequestContext.channelNames || []) as string[],
        channelCount: ((agentRequestContext.channelNames || []) as string[]).length,
        conversationId: agentRequestContext.conversationId || null,
        isThreadContext: !!agentRequestContext.conversationId,

        // Source Info
        source: agentRequestContext.source || null,

        // Feature Flags
        webSearchEnabled: agentRequestContext.webSearchEnabled || false,
        deepResearchEnabled: agentRequestContext.deepResearchEnabled || false,
        createCanvasEnabled: agentRequestContext.createCanvasEnabled || false,

        // Research Context
        researchContext: agentRequestContext.researchContext || null,

        // Canvas Context
        canvasViewAccessId: agentRequestContext.canvasViewAccessId || null,
        selectionContextsCount: ((agentRequestContext.selectionContexts || []) as unknown[]).length,

        // Attachments — mime types and base64 data (masked when masking is enabled)
        attachmentsCount: attachments.length,
        attachmentTypes: attachments.map(att => att.mime_type || 'unknown'),
        attachmentData: JSON.stringify(maskingEnabled
          ? attachments.map(att => ({ mime_type: att.mime_type, filename: att.filename, data: '[MASKED - Attachment Data]' }))
          : attachments.map(att => ({ mime_type: att.mime_type, filename: att.filename, data: att.data || '' }))),
        messageAttachmentIdsCount: ((agentRequestContext.messageAttachmentIds || []) as unknown[]).length,

        // Provided Contexts — readable titles instead of raw IDs
        canvasContext: canvasSummaries.map(c => c.title),
        ticketContext: ticketSummaries.map(t => `${t.xyneId}: ${t.title}`),
        callContext: callSummaries.map(c => c.title),
        providedContextSummary: {
          canvases: canvasSummaries.length,
          tickets: ticketSummaries.length,
          calls: callSummaries.length,
        },

        // Message/Branching Info
        parentMessageId: agentRequestContext.parentMessageId || null,
        isRegenerate: agentRequestContext.isRegenerate || false,

        // Model and Prompt Info
        modelName: agentRequestContext.modelName || null,
        agentPromptName: agentRequestContext.agentPromptName || null,
      };

      const maskedContext = {
        ...context,
        agentName,
        sessionId,
        userId: userEmail || userId,
        userInfo: {
          userId: userId,
          userName: userName,
          userEmail: userEmail,
        },
        requestMetadata: enrichedMetadata,
      };

      // Mask the input messages
      const maskedMessages = messages ? maskMessages(messages) : undefined;
      const eventDataAny = event.data as Record<string, unknown>;

      // Flatten metadata into top-level event attributes for Langfuse
      const flattenedMetadata: Record<string, unknown> = {};
      Object.entries(enrichedMetadata).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          flattenedMetadata[`request.${key}`] = value.join(',');
        } else if (value !== null && typeof value === 'object') {
          flattenedMetadata[`request.${key}`] = JSON.stringify(value);
        } else {
          flattenedMetadata[`request.${key}`] = value;
        }
      });

      const enrichedEvent = {
        type: 'run_start' as const,
        data: {
          ...event.data,
          sessionId: sessionId,
          userId: userEmail || userId,
          agentName,
          messages: maskedMessages,
          ...(eventDataAny.user_query ? { user_query: eventDataAny.user_query } : {}),
          context: maskedContext,
        },
      };

      // Queue the extra attributes so the wrapper sets them on the span right
      // after OpenTelemetryTraceCollector.collect() creates it for run_start.
      const pendingKey = traceId || runId;
      if (pendingKey) {
        pendingSpanAttributes.set(String(pendingKey), flattenedMetadata);
      }

      collector.collect(enrichedEvent);
      
      logger.info(`[Langfuse] [${sessionId || 'no-session'}] Started trace. runId: ${runId}, langfuseTraceId: ${traceId}`, enrichedMetadata);
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

      // Delay ending the span until finalizeTrace() is called with citation URLs.
      // stream.ts parses citations AFTER this event fires, so we hold the event here.
      const pendingTraceId = (event.data as unknown as Record<string, unknown>).traceId
        || (event.data as unknown as Record<string, unknown>).runId;
      if (pendingTraceId) {
        pendingRunEnd.set(String(pendingTraceId), maskedEvent as unknown as TraceEvent);
      } else {
        // No trace ID available — collect immediately as fallback
        collector.collect(maskedEvent);
      }

      logger.info(`[Langfuse] Queued run_end for trace finalization. runId: ${runId}, status: ${outcome.status}`);
      break;
    }
    
    default:
      collector.collect(event);
      break;
  }
}

/**
 * Finalize a trace by setting citation URLs as span attributes, then ending the span.
 * Must be called from stream.ts after the agent output has been parsed and citations resolved.
 * If tracing is not configured this is a no-op.
 *
 * @param jafTraceId - JAF trace ID (same as currentTraceId in stream.ts)
 * @param citationUrls - map of citation ref (e.g. "A1") → resolved URL
 */
export function finalizeTrace(jafTraceId: string, citationUrls: Record<string, string>): void {
  const pendingEvent = pendingRunEnd.get(jafTraceId);
  if (!pendingEvent) {
    // Tracing disabled or already finalized
    return;
  }
  pendingRunEnd.delete(jafTraceId);

  // Set citation URLs on the span before JAF ends it
  if (otelCollector && Object.keys(citationUrls).length > 0) {
    const span = (otelCollector as unknown as { traceSpans: Map<string, { setAttributes(a: Record<string, unknown>): void }> })
      .traceSpans.get(jafTraceId);
    if (span?.setAttributes) {
      span.setAttributes({ 'request.citationUrls': JSON.stringify(citationUrls) });
    }
  }

  // End the span via the OTEL collector directly (bypasses our wrapper to avoid re-queuing)
  if (otelCollector) {
    otelCollector.collect(pendingEvent);
  }
}
