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
} from '@xynehq/jaf';

// Import config for environment variables
import { config } from '../../config/env.js';

// ============================================================================
// Configuration - Loaded from environment variables
// ============================================================================

// LiteLLM proxy URL from environment
const LITELLM_BASE_URL = config.litellm.baseUrl;

// LiteLLM API key from environment
const LITELLM_API_KEY = config.litellm.apiKey;

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
  readonly summarizationType?: 'thread' | 'channel' | 'searchMessage';
  readonly searchQuery?: string; // Added for search message context
}

/**
 * Input for summarizing a thread
 */
export interface ThreadSummaryInput {
  readonly messages: readonly ThreadMessage[];
  readonly maxLength?: number;
  readonly messageIdMapping?: Map<number, string>;  // 1-based index to messageId mapping for citations
  readonly conversationIdMapping?: Map<number, string>;  // 1-based index to conversationId mapping (for channel summary)
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
 */
export interface Citation {
  readonly messageIndex: number;  // 1-based index from the input messages
  readonly messageId: string;     // The actual message ID for linking
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

/**
 * Unified Summarizer Agent
 * 
 * This agent takes a series of messages and produces a structured summary
 * including key points and citations. Works for both thread and channel summarization.
 * Uses dynamic instructions based on summarizationType in context.
 */
export const summarizerAgent: Agent<SummarizerContext, AgentRawOutput> = {
  name: 'Summarizer',
  
  instructions: (state: Readonly<RunState<SummarizerContext>>) => {
    const summarizationType = state.context.summarizationType || 'thread';
    const searchQuery = state.context.searchQuery;
    
    let contextType: string;
    
    if (summarizationType === 'searchMessage') {
      contextType = 'search result';
    } else if (summarizationType === 'channel') {
      contextType = 'channel';
    } else {
      contextType = 'thread';
    }
    
    return `
You summarize conversations. BE EXTREMELY CONCISE.

${summarizationType === 'searchMessage' ? `
The user searched for: "${searchQuery}"
Your summary MUST be relevant to this search query. Focus on information that directly relates to what the user was looking for.
` : ''}

CRITICAL RULES:
- Summary: Start with "This ${contextType}..." - Length depends on content (more messages/topics = more sentences, but stay concise). ALWAYS mention user names. Focus on WHO said/did WHAT.${summarizationType === 'searchMessage' ? ' Make sure the summary addresses the search query: "' + searchQuery + '".' : ''}
- Key points: Format as "• **Topic** - Content" where Topic is bold. Number of points depends on topics covered.${summarizationType === 'searchMessage' ? ' Prioritize information relevant to the search query.' : ''}
- Citations: EVERY keypoint MUST have a citation in the citations object. No exceptions.

Output JSON only:
{
  "summary": "This ${contextType}...",
  "keypoints": "• **Topic** - User did/said something\\n• **Another Topic** - Another user did this",
  "citations": {1: 5, 2: 12, 3: 8}
}

STRICT RULES:
- summary: MUST start with "This ${contextType}..." then mention user names and what they discussed/did. Include relevant dates when the conversation spans multiple days or when timing is important.
- citations: MANDATORY for EACH keypoint. Map keypoint number (1,2,3...) to message number [N] it references. If you have 3 keypoints, citations MUST have keys 1, 2, and 3.
- dates: When appropriate, mention dates in the summary or keypoints (e.g., "on Dec 15", "yesterday", "last week") to provide temporal context.
- Be terse, no fluff. Always attribute actions/statements to specific users.

GUARDRAILS:
- keypoints: Format each as "• **Topic** - Content". Mention names when relevant. 
  ABSOLUTELY NEVER include ANY citation references, message numbers, or brackets like [1], [2], [N], (1), (2), etc. in the keypoints field.
  The keypoints field must contain ONLY the plain text description with NO numbers or references whatsoever.
  ALL citation mappings go EXCLUSIVELY in the "citations" object - NEVER in keypoints text.
- NEVER use escape characters like "///", or excessive backslashes in your output. Keep the JSON clean and simple.
`;
  },

  modelConfig: {
    temperature: 0.3,
  },
};

/**
 * Parse simplified agent output (summary, keypoints, citations)
 * Converts to structured format with deterministic counts
 */
function parseAgentOutput(
  content: string, 
  messageIdMapping?: Map<number, string>,
  messageCount: number = 0,
  participantCount: number = 0
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
    
    // Parse keypoints from newline-separated string
    let keyPoints: KeyPointWithCitation[] = [];
    if (parsed.keypoints && typeof parsed.keypoints === 'string') {
      const points = parsed.keypoints
        .split('\n')
        .map(p => p.replace(/^[•\-*]\s*/, '').trim())
        .filter(p => p.length > 0);
      
      const citations = parsed.citations || {};
      
      keyPoints = points.map((point, index) => {
        const pointNum = index + 1;
        const rawCitation = citations[pointNum];
        const citationMsgIndex = typeof rawCitation === 'number' ? rawCitation : (typeof rawCitation === 'string' ? parseInt(rawCitation, 10) : 1);
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
      participantCount, // Deterministic from input
      messageCount,     // Deterministic from input
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
 * Agent registry containing all available agents
 */
export const agentRegistry = new Map<string, Agent<SummarizerContext, any>>([
  ['Summarizer', summarizerAgent],
]);

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

  const idMapping = input.messageIdMapping;
  
  // Calculate deterministic counts from input messages
  const { messageCount, participantCount } = calculateCounts(input.messages);

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
    modelOverride: 'minimaxai/minimax-m2',
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
        case 'llm_call_end':
          // LLM has completed - extract content
          if (event.data.choice?.message?.content) {
            const content = event.data.choice.message.content;
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
              const parsedOutput = parseAgentOutput(accumulatedContent || content, idMapping, messageCount, participantCount);
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
            let finalOutput: SummaryOutput;
            if (typeof rawOutput === 'string') {
              if (!accumulatedContent && rawOutput) {
                yield {
                  type: 'delta',
                  content: rawOutput,
                };
              }
              finalOutput = parseAgentOutput(rawOutput, idMapping, messageCount, participantCount);
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

  // Format messages for the agent
  const formattedMessages = formatMessagesForAgent(input.messages);

  // Create the run configuration
  const config: RunConfig<SummarizerContext> = {
    agentRegistry,
    modelProvider: modelProvider as RunConfig<SummarizerContext>['modelProvider'],
    maxTurns: 3,
    modelOverride: 'minimaxai/minimax-m2',
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
    if (typeof rawOutput === 'string') {
      return parseAgentOutput(rawOutput);
    }
    return rawOutput as SummaryOutput;
  } else if (result.outcome.status === 'error') {
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
  summarizationType: 'thread' | 'channel' | 'searchMessage' = 'thread',
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
  } else if (summarizationType === 'channel') {
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
