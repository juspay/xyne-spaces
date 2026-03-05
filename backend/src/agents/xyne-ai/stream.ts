/**
 * Xyne AI Streaming Execution
 */

import type { Message, Attachment } from '@xynehq/jaf';
import { Streaming } from '@xynehq/jaf';

import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { db } from '../../database/client.js';

import {
  sessionStore,
  getOrCreateSession,
  formatHistoryForJAF,
  type SessionContext,
} from './storage/index.js';

import { getAndClearSessionMappings, type EnhancedCitationMappings, type StreamProvider, type StreamEventCallback } from './tools/index.js';
import { createOnEventHandler } from './langfuse/index.js';
import { createAgentRunner } from './agent.js';
import { XyneAIConfig } from './config.js';
import { convertAttachmentsToJAF } from './utils/attachmentConverter.js';
import { metrics } from '../../services/otel/pull/metrics.js';

import type {
  XyneAIRequest,
  XyneAIOutput,
  XyneAIStreamChunk,
  AgentRawOutput,
  AttachmentData,
  UserTag,
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
 * Fetch user IDs by names in a single DB query
 * If user not found, returns empty userId (name still displayed)
 */
async function enrichUserTags(
  userTags: Record<string, string> | undefined
): Promise<Record<string, UserTag> | undefined> {
  if (!userTags || Object.keys(userTags).length === 0) return undefined;

  const uniqueNames = [...new Set(Object.values(userTags))];

  const users = await db.user.findMany({
    where: { name: { in: uniqueNames } },
    select: { id: true, name: true },
  });

  const userMap = new Map(users.map(u => [u.name, u.id]));

  return Object.fromEntries(
    Object.entries(userTags).map(([tag, name]) => [
      tag,
      { name, userId: userMap.get(name) || '' } as UserTag,
    ])
  );
}

/**
 * Convert raw output to XyneAIOutput
 */
async function convertRawToOutput(
  raw: AgentRawOutput,
  mappings?: EnhancedCitationMappings,
  defaultChannelId?: string
): Promise<XyneAIOutput> {
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

    // Extract enhanced entity metadata from mappings
    const channelId = (mappings?.channelIdMapping as Record<string, string>)?.[citationRef] || defaultChannelId || '';
    const entityType = (mappings?.entityTypeMapping as Record<string, string>)?.[citationRef];
    const entityId = (mappings?.entityIdMapping as Record<string, string>)?.[citationRef];
    const messageId = (mappings?.messageIdMapping as Record<string, string | undefined>)?.[citationRef];
    const conversationId = (mappings?.conversationIdMapping as Record<string, string | undefined>)?.[citationRef];
    const canvasId = (mappings?.canvasIdMapping as Record<string, string | undefined>)?.[citationRef];
    const externalUrl = (mappings?.externalUrlMapping as Record<string, string | undefined>)?.[citationRef];
    const isExternal = (mappings?.isExternalMapping as Record<string, boolean>)?.[citationRef] || false;

    return {
      point,
      citation: {
        messageIndex: pointNum,
        messageId: messageId || '',
        conversationId: conversationId || '',
        channelId,
        prefixedRef: citationRef,
        // Legacy field for backwards compatibility
        isTicket: entityType === 'ticket',
        // NEW: Enhanced entity metadata
        entityType,
        entityId,
        canvasId,
        externalUrl,
        isExternal,
      },
    };
  });
  const userTagsToEnrich = raw.userTags;
  logger.info('[XyneAI] [convertRawToOutput] userTags from raw output:', JSON.stringify(userTagsToEnrich));
  
  const enrichedUserTags = await enrichUserTags(userTagsToEnrich);
  logger.info('[XyneAI] [convertRawToOutput] enriched userTags:', JSON.stringify(enrichedUserTags));
  return {
    summary: raw.summary || '',
    keyPoints,
    userTags: enrichedUserTags,
  };
}

/**
 * Parse LLM string output to XyneAIOutput with enhanced mappings
 */
async function parseStringOutput(
  content: string,
  mappings?: EnhancedCitationMappings,
  channelId?: string
): Promise<XyneAIOutput> {
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
  xyneAIConfig?: XyneAIConfig;  // CAC config fetched in controller
}

export async function* xyneAIStream(
  request: XyneAIStreamRequest
): AsyncGenerator<XyneAIStreamChunk, void, unknown> {
  const { query, sessionId, channelIds, conversationId, canvasViewAccessId, selectionContexts, createCanvasEnabled, userId, currentTimestamp, attachments, onStreamEvent, researchContext, messageAttachmentIds, xyneAIConfig } = request;

  // Use provided config or fetch defaults
  const cacConfig = xyneAIConfig ?? XyneAIConfig.defaults();

  const timestamp = currentTimestamp || getCurrentTimestamp();
  const source: 'thread' | 'channel' = conversationId ? 'thread' : 'channel';

  const sessionContext: SessionContext = {channelIds, userId };
  const { session, isNewSession } = await getOrCreateSession(sessionId, sessionContext);

  logger.info(`[XyneAI] [${session.sessionId}] Starting query. isNew: ${isNewSession}, source: ${source}, attachments: ${attachments?.length || 0}, messageAttachmentIds: ${messageAttachmentIds?.length || 0}`);

  yield { type: 'start', sessionId: session.sessionId, isNewSession };

  // Fetch attachments from GCS by IDs if provided
  let fetchedAttachments: AttachmentData[] = [];
  if (messageAttachmentIds && messageAttachmentIds.length > 0) {
    try {
      const { aiContextService } = await import('../../services/aiContextService.js');
      
      // Fetch all attachments by IDs in parallel
      const attachmentResults = await Promise.all(
        messageAttachmentIds.map(async (attachmentId) => {
          const result = await aiContextService.getAttachmentById(attachmentId);
          if (result.attachment && result.base64) {
            return {
              data: result.base64.base64Content || '',
              mime_type: result.attachment.mimetype,
              filename: result.attachment.originalFilename,
            } as AttachmentData;
          }
          return null;
        })
      );

      fetchedAttachments = attachmentResults.filter((a): a is AttachmentData => a !== null);
      logger.info(`[XyneAI] [${session.sessionId}] Fetched ${fetchedAttachments.length} attachments from GCS by IDs`);
    } catch (error) {
      logger.error(`[XyneAI] [${session.sessionId}] Failed to fetch attachments by IDs:`, error);
      // Continue without fetched attachments - don't fail the whole request
    }
  }

  // Merge user-provided attachments with fetched attachments
  const allAttachments: AttachmentData[] = [
    ...(attachments || []),
    ...fetchedAttachments,
  ];

  // Store user message with attachments
  const updatedSessionAfterUser = await sessionStore.addUserMessage(session.sessionId, query, timestamp, allAttachments.length > 0 ? allAttachments : undefined);
  if (!updatedSessionAfterUser) {
    logger.error(`[XyneAI] [${session.sessionId}] Failed to add user message - session not found`);
    yield { type: 'error', error: 'Session not found' };
    yield { type: 'end' };
    return;
  }

  // Get history BEFORE the current user message (exclude the one we just added)
  const historyMessages = formatHistoryForJAF(updatedSessionAfterUser.history.slice(0, -1));

  // Convert attachments to JAF format (use merged attachments)
  let jafAttachments: Attachment[] = [];

  try {
    jafAttachments = convertAttachmentsToJAF(allAttachments.length > 0 ? allAttachments : undefined);
    
    // Track attachment usage if any attachments were successfully converted
    if (jafAttachments.length > 0) {
      try {
        metrics.askAIAttachmentUsedTotal.inc();
      } catch (metricsError) {
        logger.error('[XyneAI] Error recording attachment metrics:', metricsError);
      }
    }
  } catch (error) {
    logger.error(`[XyneAI] [${session.sessionId}] Failed to convert attachments:`, error);
    yield {
      type: 'error',
      error: `Failed to process attachments: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
    yield { type: 'end' };
    return;
  }

  // Convert history messages to JAF Message format (content must be string)
  const messages: Message[] = [
    ...historyMessages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      ...(msg.role === 'user' && msg.attachments ? { attachments: msg.attachments } : {}),
    })),
    {
      role: 'user' as const,
      content: query,
      ...(jafAttachments.length > 0 && { attachments: jafAttachments }),
    },
  ];
  
  const streamProvider = getStreamProvider();

  // Fetch custom instruction from database
  let customInstruction: string | undefined;
  try {
    const { db } = await import('../../database/client.js');
    const userPreference = await db.userPreference.findUnique({
      where: { userId },
      select: { askai_custom_instruction: true },
    });
    
    if (userPreference?.askai_custom_instruction) {
      customInstruction = userPreference.askai_custom_instruction;
    }
  } catch (error) {
    logger.error(`[XyneAI] [${session.sessionId}] Failed to fetch custom instruction:`, error);
  }

  const agentContext = {
    channelIds,
    conversationId,
    canvasViewAccessId,
    selectionContexts,
    createCanvasEnabled,
    userId,
    sessionId: session.sessionId,
    source,
    timestamp,
    streamProvider: streamProvider as StreamProvider | undefined,
    onStreamEvent,
    userInfo: request.userInfo,
    webSearchEnabled: request.webSearchEnabled,
    researchContext,
    customInstruction,
    requestMappings: {
      channelNameToId: new Map<string, string>(),
      userNameToId: new Map<string, string>(),
    },
  };

  const LITELLM_API_KEY = config.litellm.apiKey;

  // Determine which model to use based on attachments
  // Only use vision model for images; documents/files are converted to text by JAF
  const hasImageAttachment = allAttachments.some(att => att.mime_type?.startsWith('image/'));

  // Use model names from CAC config
  const modelName = hasImageAttachment ? cacConfig.visionModelName : cacConfig.modelName;
  const apiKey = LITELLM_API_KEY;

  logger.info(`[XyneAI] [${session.sessionId}] Using model: ${modelName} (hasImageAttachment: ${hasImageAttachment}, tracingEnabled: ${cacConfig.tracingEnabled}, maskingEnabled: ${cacConfig.maskingEnabled})`);

  const onEventHandler = createOnEventHandler(cacConfig);
  const runStream = await createAgentRunner(source, agentContext, messages, modelName, apiKey, onEventHandler);
  
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
              parsedOutput = await parseStringOutput(responseText, mappings, channelIds[0]);
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
              userTags: parsedOutput.userTags,
            };
          } else if (event.data.outcome.status === 'error') {
            const errTag = event.data.outcome.error._tag;
            const errDetail = (event.data.outcome.error as any).detail || (event.data.outcome.error as any).reason || '';
            logger.error(`[XyneAI] [${session.sessionId}] Agent run failed:`, event.data.outcome.error);

            // On error, save what we have as fallback
            if (accumulatedContent) {
              const fallbackOutput: XyneAIOutput = {
                summary: accumulatedContent,
                keyPoints: [],
              };
              await sessionStore.addAssistantMessage(session.sessionId, fallbackOutput, currentTraceId);
            }
            yield { type: 'error', error: errDetail ? `${errTag}: ${errDetail}` : errTag };
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
