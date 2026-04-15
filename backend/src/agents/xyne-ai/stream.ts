/**
 * Xyne AI Streaming Execution
 */

import type { Message, Attachment } from '@juspay-jaf/jaf';
import { Streaming } from '@juspay-jaf/jaf';

import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { db } from '../../database/client.js';

import {
  sessionStore,
  getOrCreateSession,
  formatHistoryForJAF,
  type SessionContext,
} from './storage/index.js';

import { getAndClearSessionMappings, appendEnhancedSessionMappings, type EnhancedCitationMappings, type StreamProvider, type StreamEventCallback } from './tools/index.js';
import { createOnEventHandler, buildProvidedContextCitationRefs, finalizeTrace } from './langfuse/index.js';
import { createAgentRunner } from './agent.js';
import { AgentsConfig } from '../config.js';
import { convertAttachmentsToJAF } from './utils/attachmentConverter.js';
import { getAskAIToolUsedTotal } from '@/services/otel';

import type {
  XyneAIRequest,
  XyneAIOutput,
  XyneAIStreamChunk,
  AgentRawOutput,
  AttachmentData,
  UserTag,
  Citation,
} from './types.js';
import { fetchProvidedContexts, type ProvidedContexts } from './utils/contextFetcher.js';
import { getChannelInfo } from './utils/channelResolver.js';
import { buildCitationUrl } from '@xyne/shared';

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
  // Convert to IST (UTC+5:30) by adding 330 minutes
  const istTime = new Date(now.getTime() + (330 * 60 * 1000));
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${istTime.getUTCFullYear()}-${pad(istTime.getUTCMonth() + 1)}-${pad(istTime.getUTCDate())} ${pad(istTime.getUTCHours())}:${pad(istTime.getUTCMinutes())}:${pad(istTime.getUTCSeconds())}`;
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
    const entityType = (mappings?.entityTypeMapping as Record<string, Citation['entityType']>)?.[citationRef];
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
// Citation URL Builder (mirrors frontend citationUrlBuilder.ts)
// ============================================================================

function buildCitationUrlsForTrace(keyPoints: XyneAIOutput['keyPoints']): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const kp of keyPoints) {
    const { citation } = kp;
    if (!citation?.prefixedRef) continue;
    const url = buildCitationUrl(citation);
    if (url) urls[citation.prefixedRef] = url;
  }
  return urls;
}

// ============================================================================
// Streaming Execution
// ============================================================================

export interface XyneAIStreamRequest extends XyneAIRequest {
  onStreamEvent?: StreamEventCallback;
  agentsConfig?: AgentsConfig;  // CAC config fetched in controller
  memoryEnabled?: boolean;  // Whether memory tools are available; default true. Pass false for bot contexts.
}

export async function* xyneAIStream(
  request: XyneAIStreamRequest
): AsyncGenerator<XyneAIStreamChunk, void, unknown> {
const {
  query,
  sessionId,
  channelIds,
  conversationId,
  canvasViewAccessId,
  selectionContexts,
  createCanvasEnabled,
  userId,
  currentTimestamp,
  attachments,
  onStreamEvent,
  researchContext,
  messageAttachmentIds,
  agentsConfig,
  parentMessageId,
  isRegenerate, deepResearchEnabled,
  canvasIds,
  ticketIds,
  callIds,
} = request;

  // Use provided config or fetch defaults
  const cacConfig = agentsConfig ?? AgentsConfig.defaults();

  const timestamp = currentTimestamp || getCurrentTimestamp();
  const source: 'thread' | 'channel' = conversationId ? 'thread' : 'channel';

  const agentName = request.agentName;
  const sessionContext: SessionContext = { channelIds, userId, agentName };
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

  // Fetch provided contexts (canvas, ticket, call) if IDs are provided
  let providedContexts: ProvidedContexts | undefined;
  const PROVIDED_CONTEXT_PREFIX = 'P'; // Prefix for provided context citations

  if (canvasIds?.length || ticketIds?.length || callIds?.length) {
    try {
      logger.info(`[XyneAI] [${session.sessionId}] Fetching provided contexts - Canvases: ${canvasIds?.length || 0}, Tickets: ${ticketIds?.length || 0}, Calls: ${callIds?.length || 0}`);
      providedContexts = await fetchProvidedContexts(userId, canvasIds, ticketIds, callIds);
      logger.info(`[XyneAI] [${session.sessionId}] Successfully fetched provided contexts`);

      // Store provided context citation mappings in Redis for later retrieval
      if (providedContexts && (providedContexts.canvases.length > 0 || providedContexts.tickets.length > 0 || providedContexts.calls.length > 0)) {
        try {
          const citationRefs = buildProvidedContextCitationRefs(providedContexts, PROVIDED_CONTEXT_PREFIX);

          if (citationRefs.length > 0) {
            // Convert citation refs to EnhancedCitationMappings format
            const mappings: EnhancedCitationMappings = {
              entityIdMapping: {},
              entityTypeMapping: {},
              conversationIdMapping: {},
              messageIdMapping: {},
              canvasIdMapping: {},
              channelIdMapping: {},
              externalUrlMapping: {},
              isExternalMapping: {},
            };

            for (const ref of citationRefs) {
              const idx = ref.entityIndex;
              mappings.entityIdMapping[idx] = ref.entityId;
              mappings.entityTypeMapping[idx] = ref.entityType;
              mappings.isExternalMapping[idx] = false;

              // Set entity-specific IDs for proper citation URL construction
              if (ref.entityType === 'canvas') {
                mappings.canvasIdMapping[idx] = ref.entityId;
              } else if (ref.entityType === 'ticket') {
                // Tickets need channelId and conversationId for citation URLs
                if (ref.channelId) {
                  mappings.channelIdMapping[idx] = ref.channelId;
                }
                if (ref.conversationId) {
                  mappings.conversationIdMapping[idx] = ref.conversationId;
                }
              } else if (ref.entityType === 'call') {
                // Calls need channelId and conversationId for citation URLs
                if (ref.channelId) {
                  mappings.channelIdMapping[idx] = ref.channelId;
                }
                if (ref.conversationId) {
                  mappings.conversationIdMapping[idx] = ref.conversationId;
                }
              }
            }

            await appendEnhancedSessionMappings(session.sessionId, mappings, PROVIDED_CONTEXT_PREFIX);
            logger.info(`[XyneAI] [${session.sessionId}] Stored ${citationRefs.length} provided context citation mappings in Redis with prefix '${PROVIDED_CONTEXT_PREFIX}'`);
          }
        } catch (mappingError) {
          logger.error(`[XyneAI] [${session.sessionId}] Failed to store provided context citation mappings:`, mappingError);
          // Continue - this shouldn't fail the whole request
        }
      }
    } catch (error) {
      logger.error(`[XyneAI] [${session.sessionId}] Failed to fetch provided contexts:`, error);
      // Continue without contexts - don't fail the whole request
    }
  }

  // For regenerate: skip user message creation — reuse the existing user message.
  // parentMessageId is the user message ID; bot response branches as its new child.
  // For edit/normal: create a new user message linked to parentMessageId.
  let userMessageId: string;
  let historyMessages;

  if (isRegenerate && parentMessageId) {
    // Regenerate: no new user message, parent is the existing user message
    userMessageId = parentMessageId;
    // Get history up to (but excluding) the user message — the current query
    // is appended separately below, so we walk from the user message's parent
    const pathHistory = await sessionStore.getHistoryForPath(session.sessionId, parentMessageId);
    // Remove the last entry (the user message itself) to avoid duplicating it
    historyMessages = formatHistoryForJAF(pathHistory.slice(0, -1));
  } else {
    // Normal / Edit: create user message
    const { session: updatedSessionAfterUser, messageId } = await sessionStore.addUserMessage(
      session.sessionId, request.displayQuery ?? query, timestamp,
      allAttachments.length > 0 ? allAttachments : undefined,
      undefined, // traceId - set later
      parentMessageId, // previousStepId for tree structure
    );
    if (!updatedSessionAfterUser) {
      logger.error(`[XyneAI] [${session.sessionId}] Failed to add user message - session not found`);
      yield { type: 'error', error: 'Session not found' };
      yield { type: 'end' };
      return;
    }
    userMessageId = messageId;

    if (parentMessageId) {
      const pathHistory = await sessionStore.getHistoryForPath(session.sessionId, parentMessageId);
      historyMessages = formatHistoryForJAF(pathHistory);
    } else {
      historyMessages = formatHistoryForJAF(updatedSessionAfterUser.history.slice(0, -1));
    }
  }

  // Track the last message ID for chaining tool calls and assistant response
  let lastStepId = userMessageId;

  // Convert attachments to JAF format (use merged attachments)
  let jafAttachments: Attachment[] = [];

  try {
    jafAttachments = convertAttachmentsToJAF(allAttachments.length > 0 ? allAttachments : undefined);
    
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

  // Resolve channel names for readable trace context
  let traceChannelNames: string[] = [];
  try {
    const { channelNames } = await getChannelInfo(channelIds);
    traceChannelNames = channelNames;
  } catch (e) {
    logger.warn(`[XyneAI] [${session.sessionId}] Failed to fetch channel names for trace:`, e);
  }

  // Build complete request context for tracing
  const agentRequestContext = {
    // Channel and Thread Context — readable names for traces
    channelNames: traceChannelNames,
    conversationId,
    source,

    // Feature Flags
    webSearchEnabled: request.webSearchEnabled,
    deepResearchEnabled,
    createCanvasEnabled,

    // Research Context
    researchContext,

    // Canvas Context
    canvasViewAccessId,
    selectionContexts,

    // Attachments — full data (base64 included) for traces
    attachments: allAttachments.map(att => ({
      mime_type: att.mime_type,
      filename: att.filename,
      data: att.data,
    })),
    messageAttachmentIds: messageAttachmentIds || [],

    // Provided Contexts — readable summaries extracted from already-fetched data
    canvasSummaries: (providedContexts?.canvases ?? []).map(c => ({
      id: c.id,
      title: c.title || c.id,
    })),
    ticketSummaries: (providedContexts?.tickets ?? []).map(t => ({
      id: t.id,
      xyneId: t.xyneId || t.id,
      title: t.title || t.id,
    })),
    callSummaries: (providedContexts?.calls ?? []).map(c => ({
      id: c.id,
      title: c.title || c.id,
    })),

    // Message/Branching Info
    parentMessageId,
    isRegenerate,

    // Model and Prompt Info
    modelName: cacConfig.xyneAiModelName,
    agentPromptName: request.agentName,
  };

  // Wrap onStreamEvent to persist sub-tool events (e.g. q_api inside genius)
  // These are streamed directly via callback and bypass JAF's tool lifecycle events,
  // so they must be stored here to appear in session history.
  // A queue serializes DB writes so rapid sub-tool events chain correctly via lastStepId.
  let subToolQueue: Promise<void> = Promise.resolve();
  const wrappedOnStreamEvent: StreamEventCallback | undefined = onStreamEvent
    ? (event: Record<string, unknown>) => {
        const eventType = event.type as string;
        if (eventType === 'tool_input' && event.tool_name) {
          const toolName = event.tool_name as string;
          const input = typeof event.input === 'string' ? event.input : JSON.stringify(event.input);
          subToolQueue = subToolQueue.then(async () => {
            try {
              lastStepId = await sessionStore.addToolInput(session.sessionId, toolName, input, undefined, lastStepId);
            } catch (err) {
              logger.error(`[XyneAI] [${session.sessionId}] Failed to store sub-tool input:`, err);
            }
          });
        } else if (eventType === 'tool_output' && event.tool_name) {
          const toolName = event.tool_name as string;
          subToolQueue = subToolQueue.then(async () => {
            try {
              lastStepId = await sessionStore.addToolOutput(session.sessionId, toolName, event.output, undefined, lastStepId);
            } catch (err) {
              logger.error(`[XyneAI] [${session.sessionId}] Failed to store sub-tool output:`, err);
            }
          });
        }
        onStreamEvent(event);
      }
    : undefined;

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
    onStreamEvent: wrappedOnStreamEvent,
    userInfo: request.userInfo,
    webSearchEnabled: request.webSearchEnabled,
    deepResearchEnabled,
    researchContext,
    customInstruction,
    memoryEnabled: request.memoryEnabled !== false,  // default true; false disables get_memories/update_memory
    modelName: cacConfig.xyneAiModelName,
    agentName: request.agentName,
    requestMappings: {
      channelNameToId: new Map<string, string>(),
      userNameToId: new Map<string, string>(),
    },
    agentRequestContext,
  };

  // Determine which model to use based on attachments
  // Only use vision model for images; documents/files are converted to text by JAF
  const hasImageAttachment = allAttachments.some(att => att.mime_type?.startsWith('image/'));

  // Use model names from CAC config
  const modelName = hasImageAttachment ? cacConfig.xyneAiVisionModelName : cacConfig.xyneAiModelName;
  const apiKey = config.litellm.askAiApiKey;

  logger.info(`[XyneAI] [${session.sessionId}] Using model: ${modelName} (hasImageAttachment: ${hasImageAttachment}, tracingEnabled: ${cacConfig.xyneAiTracingEnabled}, maskingEnabled: ${cacConfig.xyneAiMaskingEnabled})`);
  logger.info(`[AskAI] Calling "${modelName}" with "LITELLM_API_KEY"`);

  const langfuseHandler = createOnEventHandler(cacConfig);
  const onEventHandler = (event: Parameters<typeof langfuseHandler>[0]): unknown => {
    // Coerce double-encoded JSON string args to object before JAF's safeParse runs.
    // JAF replaces rawArgs with the return value of this callback when non-null/undefined.
    if (event.type === 'before_tool_execution') {
      const args = (event.data as { args: unknown }).args;
      langfuseHandler(event);
      if (typeof args === 'string') {
        try { return JSON.parse(args); } catch { /* unparseable — let validation fail normally */ }
      }
      return undefined;
    }
    return langfuseHandler(event);
  };
  const runStream = await createAgentRunner(source, agentContext, messages, modelName, apiKey, onEventHandler, providedContexts);
  
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
          // Store tool input in DB, chaining to previous step
          lastStepId = await sessionStore.addToolInput(
            session.sessionId,
            event.data.toolName,
            event.data.args,
            currentTraceId,
            lastStepId,
          );
          
          yield {
            type: 'tool_input',
            toolName: event.data.toolName,
            input: event.data.args,
          };
          break;
        
        case 'llm_call_start': {
          const callModel = (event.data as { model?: string }).model ?? modelName;
          logger.info(`[AskAI] Calling "${callModel}" with "LITELLM_API_KEY"`);
          break;
        }

        case 'tool_call_end':
          // Track tool usage metric
          try {
            getAskAIToolUsedTotal().add(1, { tool_name: event.data.toolName });
          } catch (_metricsError) {
            // non-blocking
          }

          // Wait for any queued sub-tool writes to finish so lastStepId is up-to-date
          await subToolQueue;

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
          
          // Store tool output in DB, chaining to previous step
          lastStepId = await sessionStore.addToolOutput(
            session.sessionId,
            event.data.toolName,
            event.data.result,
            currentTraceId,
            lastStepId,
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
            const truncated = content.length > 1000 ? `${content.slice(0, 1000)}… [truncated]` : content;
            logger.info(`[AskAI] Success: ${truncated}`);
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
            let citationUrls: Record<string, string> = {};

            try {
              parsedOutput = await parseStringOutput(responseText, mappings, channelIds[0]);
              citationUrls = buildCitationUrlsForTrace(parsedOutput.keyPoints);
            } catch (parseError) {
              logger.warn(`[XyneAI] [${session.sessionId}] Failed to parse output, using fallback`);
              parsedOutput = {
                summary: responseText,
                keyPoints: [],
              };
            } finally {
              // Finalize the OTEL span with citation URLs (no-op if tracing disabled)
              if (currentTraceId) finalizeTrace(currentTraceId, citationUrls);
            }

            // Store clean assistant message in DB, chaining to previous step
            const result = await sessionStore.addAssistantMessage(session.sessionId, parsedOutput, currentTraceId, lastStepId);
            if (!result) {
              logger.error(`[XyneAI] [${session.sessionId}] Failed to save assistant message`);
            }

            yield {
              type: 'complete',
              sessionId: session.sessionId,
              messageId: result?.messageId,
              userMessageId,
              output: parsedOutput,
              userTags: parsedOutput.userTags,
            };
          } else if (event.data.outcome.status === 'error') {
            const err = event.data.outcome.error as Record<string, unknown>;
            const errTag = String(err._tag ?? 'UnknownError');
            const errCode = err.statusCode ?? err.status ?? err.code ?? '';
            const errDetail = err.message ?? err.detail ?? err.reason ?? '';
            const errParts = [errCode ? String(errCode) : null, errTag, errDetail ? String(errDetail) : null]
              .filter(Boolean)
              .join(': ');
            logger.error(`[AskAI] Error: ${errParts}`);
            logger.error(`[XyneAI] [${session.sessionId}] Agent run failed:`, event.data.outcome.error);

            // Finalize span even on error
            if (currentTraceId) finalizeTrace(currentTraceId, {});

            // On error, save what we have as fallback
            if (accumulatedContent) {
              const fallbackOutput: XyneAIOutput = {
                summary: accumulatedContent,
                keyPoints: [],
              };
              await sessionStore.addAssistantMessage(session.sessionId, fallbackOutput, currentTraceId, lastStepId);
            }
            yield { type: 'error', error: errDetail ? `${errTag}: ${errDetail}` : errTag };
          }
          break;
      }
    }
  } catch (error) {
    logger.error(`[XyneAI] [${session.sessionId}] Stream error:`, error);

    // Ensure the OTEL span is finalized even if an exception cut the run short
    if (currentTraceId) finalizeTrace(currentTraceId, {});

    // Save whatever we have as fallback even on exception
    if (accumulatedContent) {
      const fallbackOutput: XyneAIOutput = {
        summary: accumulatedContent,
        keyPoints: [],
      };
      await sessionStore.addAssistantMessage(session.sessionId, fallbackOutput, currentTraceId, lastStepId);
    }

    yield { type: 'error', error: 'Unexpected error occurred' };
  }
  
  yield { type: 'end' };
}
