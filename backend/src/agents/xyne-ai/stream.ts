/**
 * Xyne AI Streaming Execution
 */

import type { Message } from '@xynehq/jaf';
import { Streaming } from '@xynehq/jaf';

import { logger } from '../../utils/logger.js';

import {
  sessionStore,
  getOrCreateSession,
  formatHistoryForJAF,
  type SessionContext,
} from './storage/index.js';

import { getAndClearSessionMappings, type MessageMappings, type StreamProvider, type StreamEventCallback } from './tools/index.js';
import { createOnEventHandler } from './langfuse/index.js';
import { createAgentRunner } from './agent.js';

import type {
  XyneAIRequest,
  XyneAIOutput,
  XyneAIStreamChunk,
  AgentRawOutput,
} from './types.js';

type InMemoryStreamProvider = ReturnType<typeof Streaming.createInMemoryStreamProvider>;

let globalStreamProvider: InMemoryStreamProvider | undefined = undefined;

export async function initializeStreamProvider(): Promise<InMemoryStreamProvider> {
  if (globalStreamProvider) {
    return globalStreamProvider;
  }
  
  globalStreamProvider = Streaming.createInMemoryStreamProvider({
    maxEventsPerSession: 1000,
  });
  
  return globalStreamProvider;
}

export function getStreamProvider(): InMemoryStreamProvider | undefined {
  return globalStreamProvider;
}

export async function shutdownStreamProvider(): Promise<void> {
  if (globalStreamProvider) {
    await globalStreamProvider.close();
    globalStreamProvider = undefined;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ============================================================================
// Output Parsing
// ============================================================================

/**
 * Convert raw output to XyneAIOutput
 */
function convertRawToOutput(
  raw: AgentRawOutput,
  mappings?: MessageMappings,
  defaultChannelId?: string
): XyneAIOutput {
  const keypointsData = raw.keypoints;
  let points: string[] = [];
  
  if (typeof keypointsData === 'string') {
    points = keypointsData
      .split('\n')
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 0);
  } else if (Array.isArray(keypointsData)) {
    points = (keypointsData as string[]).map((p: string) => 
      p.trim()
    ).filter((p: string) => p.length > 0);
  }
  
  const citations = raw.citations || {};
  
  const keyPoints = points.map((point, index) => {
    const pointNum = index + 1;
    const citationRef = citations[pointNum] || '';
    const channelId = (mappings?.channelIdMapping as Record<string, string>)?.[citationRef] || defaultChannelId || '';
    const url = (mappings?.urlMapping as Record<string, string>)?.[citationRef];
    
    return {
      point,
      citation: {
        messageIndex: pointNum,
        messageId: (mappings?.messageIdMapping as Record<string, string>)?.[citationRef] || '',
        conversationId: (mappings?.conversationIdMapping as Record<string, string>)?.[citationRef] || '',
        channelId,
        prefixedRef: citationRef,
        isTicket: (mappings?.isTicketMapping as Record<string, boolean>)?.[citationRef] || false,
        url,
      },
    };
  });
  
  return {
    summary: raw.summary || '',
    keyPoints,
  };
}

/**
 * Parse LLM string output to XyneAIOutput
 */
function parseStringOutput(
  content: string,
  mappings?: MessageMappings,
  channelId?: string
): XyneAIOutput {
  let jsonContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonContent = jsonMatch[0];
  }
  
  jsonContent = jsonContent.replace(/(\{|,)\s*(\d+)\s*:/g, '$1"$2":');
  
  try {
    const parsed = JSON.parse(jsonContent) as AgentRawOutput;
    return convertRawToOutput(parsed, mappings, channelId);
  } catch (e) {
    throw new Error(`Failed to parse output: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

// ============================================================================
// Streaming Execution
// ============================================================================

export interface XyneAIStreamRequest extends XyneAIRequest {
  onStreamEvent?: StreamEventCallback;
}

export async function* xyneAIStream(
  request: XyneAIStreamRequest
): AsyncGenerator<XyneAIStreamChunk, void, unknown> {
  const { query, sessionId, channelIds, conversationId, userId, currentTimestamp, onStreamEvent, researchContext } = request;
  
  const timestamp = currentTimestamp || getCurrentTimestamp();
  const source: 'thread' | 'channel' = conversationId ? 'thread' : 'channel';
  
  const sessionContext: SessionContext = {channelIds, userId };
  const { session, isNewSession } = await getOrCreateSession(sessionId, sessionContext);
  
  logger.info(`[XyneAI] [${session.sessionId}] Starting query. isNew: ${isNewSession}, source: ${source}`);
  
  // Store user message
  const updatedSessionAfterUser = await sessionStore.addUserMessage(session.sessionId, query, timestamp);
  if (!updatedSessionAfterUser) {
    logger.error(`[XyneAI] [${session.sessionId}] Failed to add user message - session not found`);
    yield { type: 'error', error: 'Session not found' };
    yield { type: 'end' };
    return;
  }
  
  // Get history BEFORE the current user message (exclude the one we just added)
  const historyMessages = formatHistoryForJAF(updatedSessionAfterUser.history.slice(0, -1));
  
  // Convert history messages to JAF Message format (content must be string)
  const messages: Message[] = [
    ...historyMessages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    })),
    { role: 'user' as const, content: query },
  ];
  
  const streamProvider = getStreamProvider();
  
  const agentContext = {
    channelIds,
    conversationId,
    userId,
    sessionId: session.sessionId,
    source,
    timestamp,
    streamProvider: streamProvider as StreamProvider | undefined,
    onStreamEvent,
    userInfo: request.userInfo,
    webSearchEnabled: request.webSearchEnabled,
    researchContext,
    requestMappings: {
      channelNameToId: new Map<string, string>(),
      userNameToId: new Map<string, string>(),
    },
  };
  
  const onEventHandler = createOnEventHandler();
  const runStream = await createAgentRunner(source, agentContext, messages, onEventHandler);
  
  let accumulatedContent = '';
  let currentTraceId: string | undefined;
  
  try {
    for await (const event of runStream) {
      switch (event.type) {
        case 'run_start':
          currentTraceId = event.data.traceId;
          yield { type: 'start', sessionId: session.sessionId, isNewSession, traceId: currentTraceId };
          break;
        
        case 'before_tool_execution':
          // Store tool input in DB
          await sessionStore.addToolInput(
            session.sessionId,
            event.data.toolName,
            event.data.args,
            currentTraceId
          );
          
          yield {
            type: 'tool_input',
            toolName: event.data.toolName,
            input: event.data.args,
          };
          break;
        
        case 'tool_call_end':
          // Handle stream provider events
          if (streamProvider) {
            const toolEvents = streamProvider.getEvents(session.sessionId);
            for (const toolEvent of toolEvents) {
              const rawEventData = toolEvent.data as Record<string, unknown>;
              yield {
                type: toolEvent.eventType,
                ...rawEventData,
              } as XyneAIStreamChunk;
            }
          }
          
          // Store tool output in DB
          await sessionStore.addToolOutput(
            session.sessionId,
            event.data.toolName,
            event.data.result,
            currentTraceId
          );
          
          yield {
            type: 'tool_output',
            toolName: event.data.toolName,
            content: event.data.result,
          };
          break;
        
        case 'llm_call_end':
          if (event.data.choice?.message?.content) {
            const content = event.data.choice.message.content;
            if (!accumulatedContent) {
              accumulatedContent = content;
              yield { type: 'delta', content };
            }
          }
          break;
        
        case 'assistant_message':
          if (event.data.message?.content) {
            const fullContent = typeof event.data.message.content === 'string'
              ? event.data.message.content
              : JSON.stringify(event.data.message.content);
            
            if (fullContent.length > accumulatedContent.length && fullContent.startsWith(accumulatedContent)) {
              const newContent = fullContent.slice(accumulatedContent.length);
              accumulatedContent = fullContent;
              yield { type: 'delta', content: newContent };
            } else if (fullContent !== accumulatedContent && !accumulatedContent.startsWith(fullContent)) {
              accumulatedContent = fullContent;
              yield { type: 'delta', content: fullContent };
            }
          }
          break;
        
        case 'run_end':
          if (event.data.outcome.status === 'completed') {
            const rawOutput = event.data.outcome.output;
            const mappings = await getAndClearSessionMappings(session.sessionId);
            
            // Parse the final LLM output
            const responseText = typeof rawOutput === 'string' ? rawOutput : accumulatedContent;
            
            let parsedOutput: XyneAIOutput;
            
            try {
              parsedOutput = parseStringOutput(responseText, mappings, channelIds[0]);
            } catch (parseError) {
              logger.warn(`[XyneAI] [${session.sessionId}] Failed to parse output, using fallback`);
              parsedOutput = {
                summary: responseText,
                keyPoints: [],
              };
            }
            
            // Store clean assistant message in DB
            const result = await sessionStore.addAssistantMessage(session.sessionId, parsedOutput, currentTraceId);
            if (!result) {
              logger.error(`[XyneAI] [${session.sessionId}] Failed to save assistant message`);
            }
            
            yield { 
              type: 'complete',
              sessionId: session.sessionId,
              messageId: result?.messageId,
              output: parsedOutput,
            };
          } else if (event.data.outcome.status === 'error') {
            // On error, save what we have as fallback
            if (accumulatedContent) {
              const fallbackOutput: XyneAIOutput = {
                summary: accumulatedContent,
                keyPoints: [],
              };
              await sessionStore.addAssistantMessage(session.sessionId, fallbackOutput, currentTraceId);
            }
            yield { type: 'error', error: event.data.outcome.error._tag };
          }
          break;
      }
    }
  } catch (error) {
    logger.error(`[XyneAI] [${session.sessionId}] Stream error:`, error);
    
    // Save whatever we have as fallback even on exception
    if (accumulatedContent) {
      const fallbackOutput: XyneAIOutput = {
        summary: accumulatedContent,
        keyPoints: [],
      };
      await sessionStore.addAssistantMessage(session.sessionId, fallbackOutput, currentTraceId);
    }
    
    yield { type: 'error', error: 'Unexpected error occurred' };
  }
  
  yield { type: 'end' };
}
