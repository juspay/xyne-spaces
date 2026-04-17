/**
 * Thread Summarizer Agent using JAF (Juspay Agent Framework)
 * 
 * This agent summarizes thread messages in Xyne Spaces conversations.
 * Supports both regular and streaming execution modes.
 */

import { z } from 'zod';

// Import JAF modules
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  runStream,
  type Agent,
  type RunState,
  type RunConfig,
  type Message,
  type TraceEvent,
} from '@juspay-jaf/jaf';

// Import config for environment variables
import { config as envConfig } from '../../config/env.js';

// Import langfuse for prompt management
import { getPromptFromLangfuse, PROMPT_NAMES } from '../xyne-ai/langfuse/index.js';

import { logger } from '../../utils/logger.js';

// Import and re-export shared types from helpers
import type { EnhancedEntityMetadata } from '../xyne-ai/tools/helpers.js';
export type { EnhancedEntityMetadata };

// ============================================================================
// Configuration - Loaded from environment variables
// ============================================================================

// LiteLLM proxy URL from environment
const LITELLM_BASE_URL = envConfig.litellm.baseUrl;

// LiteLLM API key from environment
const LITELLM_API_KEY = envConfig.litellm.apiKey;

// ============================================================================
// Types
// ============================================================================

/**
 * Context for the summarizer agent
 */
export interface SummarizerContext {
  readonly userId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly summarizationType?: 'thread' | 'channel' | 'searchMessage' | 'recap';
  readonly searchQuery?: string; // Added for search message context
  readonly modelName?: string; // CAC-resolved model override
  readonly customPrompt?: string; // Optional user-defined focus area appended to the base prompt
}

/**
 * Input for summarizing a thread
 */
export interface ThreadSummaryInput {
  readonly messages: readonly ThreadMessage[];
  readonly maxLength?: number;
  readonly messageIdMapping?: Map<number, string>;  // 1-based index to messageId mapping for citations (legacy)
  readonly conversationIdMapping?: Map<number, string>;  // 1-based index to conversationId mapping (for channel summary, legacy)
  readonly entityMapping?: Map<number, EnhancedEntityMetadata>;  // NEW: Enhanced entity mapping for multi-entity support
}

/**
 * Thread message structure
 */
export interface ThreadMessage {
  readonly id: string;
  readonly content: string;
  readonly authorName: string;
  readonly createdAt: Date;
  readonly hasAttachment?: boolean;
}

/**
 * Citation reference linking a key point to a source message
 * Enhanced to support multiple entity types (recap-specific)
 */
export interface Citation {
  readonly messageIndex: number;  // 1-based index from the input messages
  readonly messageId: string;     // The actual message ID for linking (legacy)
  readonly conversationId?: string;  // Conversation ID for navigation
  readonly channelId?: string;    // Channel ID for navigation

  // NEW: Multi-entity support
  readonly entityType?: 'message' | 'attachment' | 'call' | 'recording' | 'canvas' | 'ticket' | 'web_search';
  readonly entityId?: string;
  readonly canvasId?: string;
  readonly callId?: string;
  readonly ticketId?: string;
  readonly isTicket?: boolean;
  readonly externalUrl?: string;
  readonly isExternal?: boolean;
}

/**
 * Key point with citation
 */
export interface KeyPointWithCitation {
  readonly point: string;
  readonly citation: Citation;
}

/**
 * Simplified agent output (same for both thread and channel)
 */
export interface AgentRawOutput {
  readonly summary: string;
  readonly keypoints: string;  // Newline-separated bullet points
  readonly citations: Record<number, number>;  // {pointNumber: messageNumber} - maps keypoint index to source message [N]
}

/**
 * Unified structured output for summarization - includes deterministic counts
 * Same format for both thread and channel summaries
 */
export interface SummaryOutput {
  readonly summary: string;
  readonly keyPoints: KeyPointWithCitation[];
  readonly participantCount: number;  // Calculated deterministically
  readonly messageCount: number;      // Calculated deterministically
}

/**
 * Streaming chunk for real-time updates
 */
export interface StreamChunk {
  type: 'delta' | 'complete' | 'error' | 'tool_start' | 'tool_end';
  content?: string;
  output?: SummaryOutput;
  error?: string;
  toolName?: string;
  toolResult?: string;
}

// ============================================================================
// Output Schema
// ============================================================================

/**
 * Zod schema for structured output validation
 */
const ThreadSummaryOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the thread conversation'),
  keyPoints: z.array(z.string()).describe('Key discussion points from the thread'),
  participantCount: z.number().describe('Number of unique participants in the thread'),
  messageCount: z.number().describe('Total number of messages in the thread'),
  topicsTouched: z.array(z.string()).describe('Main topics discussed in the thread'),
});

// ============================================================================
// Agent Definition
// ============================================================================

const LANGFUSE_PROMPT_LABEL = 'production';

/**
 * Mapping of summarization types to their corresponding Langfuse prompt names
 * Add new types here to extend support
 */
const SUMMARIZATION_TYPE_TO_PROMPT: Record<string, string> = {
  channel: PROMPT_NAMES.FETCH_CHANNEL_MESSAGES,
  thread: PROMPT_NAMES.FETCH_THREAD_MESSAGES,
  recap: PROMPT_NAMES.FETCH_CHANNEL_MESSAGES_RECAP,
  searchMessage: PROMPT_NAMES.SUMMARIZE_SEARCH_MESSAGES,
};

/**
 * Resolve the summarizer prompt from Langfuse based on summarization type.
 * If a customPrompt is provided, it is appended to the base prompt to guide
 * the AI towards the user's specific interests.
 */
async function resolveSummarizerPrompt(
  summarizationType: SummarizerContext['summarizationType'],
  customPrompt?: string
): Promise<string> {
  const promptName = summarizationType && SUMMARIZATION_TYPE_TO_PROMPT[summarizationType]
    ? SUMMARIZATION_TYPE_TO_PROMPT[summarizationType]
    : PROMPT_NAMES.FETCH_THREAD_MESSAGES;

  const prompt = await getPromptFromLangfuse(promptName, {
    label: LANGFUSE_PROMPT_LABEL,
  });

  if (!prompt) {
    throw new Error(`Failed to get prompt from Langfuse: ${promptName}`);
  }

  if (customPrompt && customPrompt.trim()) {
    return `${prompt}\n\nAdditional focus area requested by the user: ${customPrompt.trim()}`;
  }

  return prompt;
}

/**
 * Create a summarizer agent with the given instructions
 */
function createSummarizerAgent(instructions: string): Agent<SummarizerContext, AgentRawOutput> {
  return {
    name: 'Summarizer',
    instructions: () => instructions,
    modelConfig: {
      temperature: 0.3,
    },
  };
}

/**
 * Parse simplified agent output (summary, keypoints, citations)
 * Converts to structured format with deterministic counts
 */
function parseAgentOutput(
  content: string,
  messageIdMapping?: Map<number, string>,
  messageCount: number = 0,
  participantCount: number = 0,
  entityMapping?: Map<number, EnhancedEntityMetadata>  // NEW: Enhanced entity mapping
): SummaryOutput {
  // Remove <think>...</think> blocks (used by some reasoning models)
  let jsonContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  // Try to find JSON object in the content
  const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonContent = jsonMatch[0];
  }
  
  try {
    const parsed = JSON.parse(jsonContent) as AgentRawOutput;

    let keyPoints: KeyPointWithCitation[] = [];

    // Support both formats:
    //  - "points": [...] array  (recap prompt format)
    //  - "keypoints": "..."     newline-separated string (legacy format)
    const rawPointsArray: string[] = (() => {
      const anyParsed = parsed as any;
      if (Array.isArray(anyParsed.points) && anyParsed.points.length > 0) {
        return anyParsed.points as string[];
      }
      if (anyParsed.keypoints && typeof anyParsed.keypoints === 'string') {
        return anyParsed.keypoints
          .split('\n')
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);
      }
      return [];
    })();

    if (rawPointsArray.length > 0) {
      const citations = (parsed as any).citations || {};

      keyPoints = rawPointsArray.map((rawPoint: string, index: number) => {
        // Strip leading bullet characters (•, -, *)
        const point = rawPoint.replace(/^[•\-*]\s*/, '').trim();

        const pointNum = index + 1;
        const rawCitation = citations[pointNum] ?? citations[String(pointNum)];
        const citationMsgIndex = typeof rawCitation === 'number' ? rawCitation : (typeof rawCitation === 'string' ? parseInt(rawCitation, 10) : 1);

        if (entityMapping && entityMapping.has(citationMsgIndex)) {
          const entity = entityMapping.get(citationMsgIndex)!;
          return {
            point,
            citation: {
              messageIndex: citationMsgIndex,
              messageId: entity.messageId || '',
              conversationId: entity.conversationId,
              channelId: entity.channelId,
              entityType: entity.entityType,
              entityId: entity.entityId,
              canvasId: entity.canvasId,
              callId: entity.callId,
              ticketId: entity.ticketId,
              isTicket: entity.entityType === 'ticket',
            },
          };
        }

        return {
          point,
          citation: {
            messageIndex: citationMsgIndex,
            messageId: messageIdMapping?.get(citationMsgIndex) || '',
          },
        };
      });
    }

    return {
      summary: parsed.summary || '',
      keyPoints,
      participantCount,
      messageCount,
    };
  } catch (error) {
    throw new Error(`Failed to parse agent output: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// Model Provider
// ============================================================================

/**
 * Create the model provider instance
 * Uses LiteLLM for model access
 */
export function createModelProvider() {
  return makeLiteLLMProvider(
    LITELLM_BASE_URL,
    LITELLM_API_KEY
  );
}

// ============================================================================
// Agent Registry
// ============================================================================

/**
 * Create agent registry with the given agent
 */
function createAgentRegistry(agent: Agent<SummarizerContext, AgentRawOutput>): Map<string, Agent<SummarizerContext, any>> {
  return new Map([['Summarizer', agent]]);
}

/**
 * Calculate deterministic counts from messages
 */
function calculateCounts(messages: readonly ThreadMessage[]): { messageCount: number; participantCount: number } {
  const uniqueAuthors = new Set(messages.map(m => m.authorName));
  return {
    messageCount: messages.length,
    participantCount: uniqueAuthors.size,
  };
}

// ============================================================================
// Unified Streaming Execution Function
// ============================================================================

/**
 * Unified summarize stream - yields events as they happen
 * Works for both thread and channel summarization
 * 
 * @param input - The messages and options
 * @param context - The execution context (must include summarizationType)
 * @yields StreamChunk - Streaming chunks for real-time updates
 */
export async function* summarizeStream(
  input: ThreadSummaryInput,
  context: SummarizerContext
): AsyncGenerator<StreamChunk, void, unknown> {
  const modelProvider = createModelProvider();
  logger.info(`[Summariser] Calling "${context.modelName}" with "LITELLM_API_KEY"`);

  const isSearchMessage = context.summarizationType === 'searchMessage';
  const idMapping = isSearchMessage ? undefined : input.messageIdMapping;
  const entityMapping = isSearchMessage ? undefined : input.entityMapping;

  // Calculate deterministic counts from input messages
  const { messageCount, participantCount } = calculateCounts(input.messages);

  // Fetch prompt from langfuse and create agent
  const systemPrompt = await resolveSummarizerPrompt(context.summarizationType, context.customPrompt);
  const agent = createSummarizerAgent(systemPrompt);
  const agentRegistry = createAgentRegistry(agent);

  // Format messages for the agent
  const formattedMessages = formatMessagesForAgent(
    input.messages, 
    context.summarizationType || 'thread',
    context.searchQuery
  );

  // Create the run configuration
  const config: RunConfig<SummarizerContext> = {
    agentRegistry,
    modelProvider: modelProvider as RunConfig<SummarizerContext>['modelProvider'],
    maxTurns: 3,
    modelOverride: context.modelName,
  };

  // Create initial state - uses unified Summarizer agent
  const initialState: RunState<SummarizerContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: formattedMessages,
      },
    ],
    currentAgentName: 'Summarizer',
    context,
    turnCount: 0,
  };

  // Accumulate content for final parsing
  let accumulatedContent = '';

  try {
    // Use runStream for streaming execution
    for await (const event of runStream(initialState, config)) {
      // Handle different event types
      switch (event.type) {
        case 'llm_call_start': {
          const callModel = (event.data as { model?: string }).model ?? context.modelName;
          logger.info(`[Summariser] Calling "${callModel}" with "LITELLM_API_KEY"`);
          break;
        }

        case 'llm_call_end':
          // LLM has completed - extract content
          if (event.data.choice?.message?.content) {
            const content = event.data.choice.message.content;
            const truncated = content.length > 1000 ? `${content.slice(0, 1000)}… [truncated]` : content;
            logger.info(`[Summariser] Success: ${truncated}`);
            // Only send delta if we haven't already streamed this content
            if (!accumulatedContent) {
              accumulatedContent = content;
              yield {
                type: 'delta',
                content: content,
              };
            }
            // Parse the accumulated content and yield complete event
            try {
              const parsedOutput = parseAgentOutput(accumulatedContent || content, idMapping, messageCount, participantCount, entityMapping);
              yield {
                type: 'complete',
                output: parsedOutput,
              };
            } catch {
              // If parsing fails, the complete event will come from run_end
            }
          }
          break;

        case 'assistant_message':
          // Extract content from event.data.message.content
          if (event.data.message?.content) {
            const fullContent = typeof event.data.message.content === 'string' 
              ? event.data.message.content 
              : JSON.stringify(event.data.message.content);
            
            // Only send the NEW part (delta) that wasn't already accumulated
            if (fullContent.length > accumulatedContent.length && fullContent.startsWith(accumulatedContent)) {
              const newContent = fullContent.slice(accumulatedContent.length);
              accumulatedContent = fullContent;
              yield {
                type: 'delta',
                content: newContent,
              };
            } else if (fullContent !== accumulatedContent && !accumulatedContent.startsWith(fullContent)) {
              accumulatedContent = fullContent;
              yield {
                type: 'delta',
                content: fullContent,
              };
            }
          }
          break;

        case 'tool_call_start':
          yield {
            type: 'tool_start',
            toolName: event.data.toolName,
          };
          break;

        case 'tool_call_end':
          yield {
            type: 'tool_end',
            toolName: event.data.toolName,
            toolResult: event.data.result,
          };
          break;

        case 'final_output':
          yield {
            type: 'complete',
            output: event.data.output as SummaryOutput,
          };
          break;

        case 'run_end':
          // Run has ended - check outcome
          if (event.data.outcome.status === 'completed') {
            const rawOutput = event.data.outcome.output;
            const rawStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
            const truncated = rawStr.length > 1000 ? `${rawStr.slice(0, 1000)}… [truncated]` : rawStr;
            logger.info(`[Summariser] Success: ${truncated}`);
            let finalOutput: SummaryOutput;
            if (typeof rawOutput === 'string') {
              if (!accumulatedContent && rawOutput) {
                yield {
                  type: 'delta',
                  content: rawOutput,
                };
              }
              finalOutput = parseAgentOutput(rawOutput, idMapping, messageCount, participantCount, entityMapping);
            } else {
              const structuredOutput = rawOutput as SummaryOutput;
              if (!accumulatedContent && structuredOutput.summary) {
                yield {
                  type: 'delta',
                  content: structuredOutput.summary,
                };
              }
              finalOutput = {
                ...structuredOutput,
                messageCount,
                participantCount,
              };
            }
            yield {
              type: 'complete',
              output: finalOutput,
            };
          } else if (event.data.outcome.status === 'error') {
            const err = event.data.outcome.error as Record<string, unknown>;
            const errTag = String(err._tag ?? 'UnknownError');
            const errCode = err.statusCode ?? err.status ?? err.code ?? '';
            const errDetail = err.message ?? err.detail ?? '';
            const errParts = [errCode ? String(errCode) : null, errTag, errDetail ? String(errDetail) : null]
              .filter(Boolean)
              .join(': ');
            logger.error(`[Summariser] Error: ${errParts}`);
            yield {
              type: 'error',
              error: event.data.outcome.error._tag,
            };
          }
          break;

        default:
          break;
      }
    }
  } catch (error) {
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// ============================================================================
// Non-Streaming Execution Function
// ============================================================================

/**
 * Summarize a thread of messages (non-streaming)
 * 
 * @param input - The thread messages and options
 * @param context - The execution context
 * @param onEvent - Optional event handler for tracing
 * @returns The thread summary
 */
export async function summarizeThread(
  input: ThreadSummaryInput,
  context: SummarizerContext,
  onEvent?: (event: TraceEvent) => void
): Promise<SummaryOutput> {
  const modelProvider = createModelProvider();
  logger.info(`[Summariser] Calling "${context.modelName}" with "LITELLM_API_KEY"`);

  const idMapping = input.messageIdMapping;
  const entityMapping = input.entityMapping;  // NEW: Extract entity mapping

  // Calculate deterministic counts
  const { messageCount, participantCount } = calculateCounts(input.messages);

  // Fetch prompt from langfuse and create agent
  const systemPrompt = await resolveSummarizerPrompt(context.summarizationType, context.customPrompt);
  const agent = createSummarizerAgent(systemPrompt);
  const agentRegistry = createAgentRegistry(agent);

  // Format messages for the agent
  const formattedMessages = formatMessagesForAgent(input.messages);

  // Create the run configuration
  const config: RunConfig<SummarizerContext> = {
    agentRegistry,
    modelProvider: modelProvider as RunConfig<SummarizerContext>['modelProvider'],
    maxTurns: 3,
    modelOverride: context.modelName,
    onEvent,
  };

  // Create initial state - uses unified Summarizer agent
  const initialState: RunState<SummarizerContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: formattedMessages,
      },
    ],
    currentAgentName: 'Summarizer',
    context: { ...context, summarizationType: 'thread' },
    turnCount: 0,
  };

  // Execute the agent
  const result = await run(initialState, config);

  // Handle the result
  if (result.outcome.status === 'completed') {
    // Parse the output to strip <think> tags and extract JSON
    const rawOutput = result.outcome.output;
    const rawStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
    const truncated = rawStr.length > 1000 ? `${rawStr.slice(0, 1000)}… [truncated]` : rawStr;
    logger.info(`[Summariser] Success: ${truncated}`);
    if (typeof rawOutput === 'string') {
      return parseAgentOutput(rawOutput, idMapping, messageCount, participantCount, entityMapping);
    }
    return rawOutput as SummaryOutput;
  } else if (result.outcome.status === 'error') {
    const err = result.outcome.error as Record<string, unknown>;
    const errTag = String(err._tag ?? 'UnknownError');
    const errCode = err.statusCode ?? err.status ?? err.code ?? '';
    const errDetail = err.message ?? err.detail ?? '';
    const errParts = [errCode ? String(errCode) : null, errTag, errDetail ? String(errDetail) : null]
      .filter(Boolean)
      .join(': ');
    logger.error(`[Summariser] Error: ${errParts}`);
    throw new Error(`Thread summarization failed: ${result.outcome.error._tag}`);
  } else {
    throw new Error('Thread summarization was interrupted');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert UTC timestamp to IST (India Standard Time, UTC+5:30)
 */
function toIST(date: Date): string {
  // Add 5 hours 30 minutes to UTC
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.toISOString().replace('Z', '+05:30');
}

/**
 * Strip HTML tags from content and clean up whitespace
 */
function stripHtml(content: string): string {
  // Remove HTML tags
  let cleaned = content.replace(/<[^>]*>/g, '');
  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Format messages for the agent to process
 * Works for both thread and channel summarization
 */
function formatMessagesForAgent(
  messages: readonly ThreadMessage[],
  summarizationType: 'thread' | 'channel' | 'searchMessage' | 'recap' = 'thread',
  searchQuery?: string
): string {
  const formattedMessages = messages.map((msg, index) => {
    const timestamp = toIST(msg.createdAt);
    const cleanContent = stripHtml(msg.content);
    const attachmentNote = msg.hasAttachment ? ' [has attachment]' : '';
    
    // Skip empty messages (attachment-only messages with no text)
    if (!cleanContent && msg.hasAttachment) {
      return `[${index + 1}] ${msg.authorName} (${timestamp})${attachmentNote}`;
    }
    
    return `[${index + 1}] ${msg.authorName} (${timestamp})${attachmentNote}:\n${cleanContent}`;
  }).join('\n\n');

  let contextLabel: string;
  let endLabel: string;
  let introText: string;
  
  if (summarizationType === 'searchMessage') {
    contextLabel = 'SEARCH RESULTS';
    endLabel = 'END OF SEARCH RESULTS';
    introText = `Please summarize the following search results for the query: "${searchQuery}"

Focus on information that is relevant to what the user was searching for.
Provide a detailed summary including context and nuances.`;
  } else if (summarizationType === 'channel' || summarizationType === 'recap') {
    contextLabel = 'CHANNEL MESSAGES';
    endLabel = 'END OF CHANNEL MESSAGES';
    introText = `Please summarize the following channel conversation:

Provide a detailed summary including context and nuances.`;
  } else {
    contextLabel = 'THREAD MESSAGES';
    endLabel = 'END OF THREAD';
    introText = `Please summarize the following thread conversation:

Provide a detailed summary including context and nuances.`;
  }

  return `
${introText}

---
${contextLabel} (${messages.length} total):
---

${formattedMessages}

---
${endLabel}
---

Provide a structured summary as specified.
`;
}

/**
 * Convert database messages to ThreadMessage format
 * Use this helper when integrating with the database layer
 */
export function convertToThreadMessages(
  dbMessages: Array<{
    messageId: string;
    content: string;
    createdAt: number;
    hasAttachment: boolean;
    sender?: {
      name?: string | null;
      email?: string | null;
    } | null;
  }>
): ThreadMessage[] {
  return dbMessages.map((msg) => ({
    id: msg.messageId,
    content: msg.content,
    authorName: msg.sender?.name || msg.sender?.email || 'Unknown User',
    createdAt: new Date(msg.createdAt),
    hasAttachment: msg.hasAttachment,
  }));
}

// ============================================================================
// Exports
// ============================================================================

export {
  ThreadSummaryOutputSchema,
  calculateCounts,
  type Message,
  type TraceEvent,
};