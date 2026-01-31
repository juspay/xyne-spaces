/**
 * Langfuse Tracing Setup for Xyne AI Agent
 */

import {
  startObservation,
  type LangfuseSpan,
  type LangfuseGeneration,
  type LangfuseTool,
} from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { logger } from '../../../utils/logger.js';
import type { TraceEvent } from '@xynehq/jaf';

export interface LangfuseConfig {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
  enabled: boolean;
}

export function getLangfuseConfig(): LangfuseConfig {
  const secretKey = process.env.LANGFUSE_SECRET_KEY || '';
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || '';
  const baseUrl = process.env.LANGFUSE_BASE_URL || '';
  
  // All three credentials must be present for Langfuse to be enabled
  const enabled = Boolean(secretKey && publicKey && baseUrl);
  
  return {
    secretKey,
    publicKey,
    baseUrl,
    enabled,
  };
}

export function isLangfuseEnabled(): boolean {
  return getLangfuseConfig().enabled;
}

let nodeSDK: NodeSDK | null = null;
let isInitialized = false;

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
    nodeSDK = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
      serviceName: 'xyne-ai-agent',
    });
    
    nodeSDK.start();
    isInitialized = true;
    
    logger.info('[Langfuse] Tracing initialized successfully');
    logger.info(`[Langfuse] Base URL: ${config.baseUrl}`);
  } catch (error) {
    logger.error('[Langfuse] Failed to initialize tracing:', error);
  }
}

export async function shutdownLangfuseTracing(): Promise<void> {
  if (nodeSDK) {
    try {
      await nodeSDK.shutdown();
      logger.info('[Langfuse] Tracing shut down successfully');
    } catch (error) {
      logger.error('[Langfuse] Error shutting down:', error);
    }
    nodeSDK = null;
    isInitialized = false;
  }
}

const activeObservations = new Map<string, {
  runSpan: LangfuseSpan;
  generations: Map<string, LangfuseGeneration>;
  tools: Map<string, LangfuseTool>;
  langfuseTraceId?: string; // Store the actual Langfuse trace ID
}>();

export function getLangfuseTraceId(runId: string): string | undefined {
  return activeObservations.get(runId)?.langfuseTraceId;
}

export function createOnEventHandler(): (event: TraceEvent) => void {
  const config = getLangfuseConfig();
  
  if (!config.enabled) {
    return () => {};
  }
  
  return (event: TraceEvent) => {
    try {
      handleLangfuseEvent(event);
    } catch (error) {
      logger.error('[Langfuse] Error handling event:', error);
    }
  };
}

function handleLangfuseEvent(event: TraceEvent): void {
  switch (event.type) {
    case 'run_start': {
      const { runId, traceId, context, messages } = event.data;
      const sessionId = context?.sessionId || 'unknown';
      
      const runSpan = startObservation('xyne-ai-run', {
        input: messages ? JSON.stringify(messages) : undefined,
        metadata: {
          runId,
          traceId,
          sessionId,
          channelId: context?.channelId,
          conversationId: context?.conversationId,
          userId: context?.userId,
          source: context?.source,
          userInfo: context?.userInfo ? {
            userId: context.userInfo.userId,
            userName: context.userInfo.userName,
            userEmail: context.userInfo.userEmail,
          } : undefined,
        },
      });
      
      // Capture the actual Langfuse trace ID from the span
      const langfuseTraceId = (runSpan as any).traceId;
      
      activeObservations.set(runId, {
        runSpan,
        generations: new Map(),
        tools: new Map(),
        langfuseTraceId,
      });
      
      logger.info(`[Langfuse] [${sessionId}] Started trace. runId: ${runId}, langfuseTraceId: ${langfuseTraceId}`);
      break;
    }
    
    case 'llm_call_start': {
      const { runId, agentName, model, messages } = event.data;
      const state = activeObservations.get(runId);
      
      if (state?.runSpan) {
        const generation = state.runSpan.startObservation(`${agentName}-generation`, {
          input: messages ? JSON.stringify(messages) : undefined,
          metadata: { model },
        }, { asType: 'generation' });
        
        const genId = `gen-${Date.now()}`;
        state.generations.set(genId, generation);
      }
      break;
    }
    
    case 'llm_call_end': {
      const { runId, choice, usage } = event.data;
      const state = activeObservations.get(runId);
      
      if (state) {
        const genEntries = Array.from(state.generations.entries());
        const lastEntry = genEntries.find(([key]) => key.startsWith('gen-'));
        
        if (lastEntry) {
          const [genId, observation] = lastEntry;
          const generation = observation as LangfuseGeneration;
          
          const usageDetails: Record<string, number> = {};
          if (usage?.prompt_tokens) usageDetails.input = usage.prompt_tokens;
          if (usage?.completion_tokens) usageDetails.output = usage.completion_tokens;
          if (usage?.total_tokens) usageDetails.total = usage.total_tokens;
          
          generation.update({
            output: choice?.message?.content,
            usageDetails: Object.keys(usageDetails).length > 0 ? usageDetails : undefined,
          });
          
          generation.end();
          state.generations.delete(genId);
        }
      }
      break;
    }
    
    case 'tool_call_start': {
      const { runId, toolName, args } = event.data;
      const state = activeObservations.get(runId);
      
      if (state?.runSpan) {
        const toolObs = state.runSpan.startObservation(`tool-${toolName}`, {
          input: JSON.stringify(args),
          metadata: { toolName },
        }, { asType: 'tool' });
        
        state.tools.set(`tool-${toolName}-${Date.now()}`, toolObs);
      }
      break;
    }
    
    case 'tool_call_end': {
      const { runId, toolName, result, executionTime } = event.data;
      const state = activeObservations.get(runId);
      
      if (state) {
        for (const [key, tool] of state.tools.entries()) {
          if (key.startsWith(`tool-${toolName}`)) {
            tool.update({
              output: result,
              metadata: { executionTime },
            });
            tool.end();
            state.tools.delete(key);
            break;
          }
        }
      }
      break;
    }
    
    case 'run_end': {
      const { runId, outcome } = event.data;
      const state = activeObservations.get(runId);
      
      if (state?.runSpan) {
        state.runSpan.update({
          output: outcome.status === 'completed' 
            ? JSON.stringify(outcome.output)
            : outcome.status === 'error'
              ? JSON.stringify({ error: outcome.error })
              : undefined,
          metadata: { status: outcome.status },
        });
        
        state.runSpan.end();
        activeObservations.delete(runId);
        
        logger.info(`[Langfuse] Ended trace. runId: ${runId}, status: ${outcome.status}`);
      }
      break;
    }
    
    default:
      break;
  }
}
