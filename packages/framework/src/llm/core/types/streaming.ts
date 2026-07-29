import type { ToolCall } from './messages.js';

/**
 * Streaming types for real-time LLM responses
 */

/**
 * Individual stream chunk
 */
export interface StreamChunk {
  readonly id: string;
  readonly type: 'content' | 'tool_call' | 'thinking' | 'metadata' | 'error' | 'done';
  readonly content?: string;
  readonly thinking?: string; // Thinking mode content
  readonly toolCall?: ToolCall;
  readonly metadata?: StreamChunkMetadata;
  readonly error?: string;
  readonly delta?: boolean; // Is this a delta or complete content
  readonly index?: number; // Chunk sequence number
}

/**
 * Stream chunk metadata
 */
export interface StreamChunkMetadata {
  readonly timestamp: Date;
  readonly model?: string;
  readonly provider?: string;
  readonly tokenCount?: number;
  readonly thinkingTokens?: number; // Thinking tokens for this chunk
  readonly finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
  readonly isThinkingSummary?: boolean; // Claude 4 thinking summaries
  readonly signature?: string; // Encrypted thinking content (Claude 4)
}

/**
 * Streaming configuration options
 */
export interface StreamingOptions {
  readonly includeThinking?: boolean;
  readonly chunkSize?: number;
  readonly bufferTimeout?: number;
  readonly onChunk?: (chunk: StreamChunk) => void;
  readonly onError?: (error: Error) => void;
  readonly onComplete?: () => void;
  readonly onThinking?: (thinking: string) => void;
  readonly onThinkingSummary?: (summary: string, signature?: string) => void; // Claude 4
  readonly onToolCall?: (toolCall: ToolCall) => void;
}

/**
 * Stream processor interface for provider-specific implementations
 */
export interface StreamProcessor {
  processStream(
    providerStream: AsyncIterable<unknown>,
    options?: StreamingOptions
  ): AsyncIterable<StreamChunk>;
}

/**
 * Stream accumulator for reconstructing final messages
 */
export interface StreamAccumulator {
  accumulate(chunk: StreamChunk): void;
  finalize(): import('./messages.js').AssistantMessage;
  reset(): void;
  getCurrentContent(): string;
  getCurrentThinking(): string;
  getToolCalls(): readonly ToolCall[];
}

/**
 * Stream buffer for managing chunk flow
 */
export interface StreamBuffer {
  add(chunk: StreamChunk): void;
  flush(): StreamChunk[];
  size(): number;
  clear(): void;
}

/**
 * Stream error types
 */
export interface StreamError {
  readonly type: 'connection' | 'timeout' | 'parse' | 'provider' | 'unknown';
  readonly message: string;
  readonly code?: string;
  readonly chunkIndex?: number;
  readonly timestamp: Date;
  readonly originalError?: Error;
}

/**
 * Stream statistics for monitoring
 */
export interface StreamStatistics {
  readonly totalChunks: number;
  readonly contentChunks: number;
  readonly thinkingChunks: number;
  readonly toolCallChunks: number;
  readonly errorChunks: number;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly duration?: number;
  readonly averageChunkSize: number;
  readonly totalBytes: number;
}

/**
 * Stream chunk type guards
 */
export function isContentChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'content' && chunk.content !== undefined;
}

export function isThinkingChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'thinking' && chunk.thinking !== undefined;
}

export function isToolCallChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'tool_call' && chunk.toolCall !== undefined;
}

export function isErrorChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'error' && chunk.error !== undefined;
}

export function isDoneChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'done';
}

export function isMetadataChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'metadata' && chunk.metadata !== undefined;
}

/**
 * Stream chunk creation utilities
 */
export function createContentChunk(
  content: string,
  options?: {
    id?: string;
    delta?: boolean;
    index?: number;
    metadata?: StreamChunkMetadata;
  }
): StreamChunk {
  return {
    id: options?.id || `chunk-${Date.now()}-${Math.random()}`,
    type: 'content',
    content,
    delta: options?.delta ?? true,
    ...(options?.index !== undefined && { index: options.index }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createThinkingChunk(
  thinking: string,
  options?: {
    id?: string;
    delta?: boolean;
    index?: number;
    metadata?: StreamChunkMetadata;
  }
): StreamChunk {
  return {
    id: options?.id || `thinking-${Date.now()}-${Math.random()}`,
    type: 'thinking',
    thinking,
    delta: options?.delta ?? true,
    ...(options?.index !== undefined && { index: options.index }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createToolCallChunk(
  toolCall: ToolCall,
  options?: {
    id?: string;
    index?: number;
    metadata?: StreamChunkMetadata;
  }
): StreamChunk {
  return {
    id: options?.id || `tool-${Date.now()}-${Math.random()}`,
    type: 'tool_call',
    toolCall,
    delta: false, // Tool calls are always complete
    ...(options?.index !== undefined && { index: options.index }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createErrorChunk(
  error: string,
  options?: {
    id?: string;
    index?: number;
    metadata?: StreamChunkMetadata;
  }
): StreamChunk {
  return {
    id: options?.id || `error-${Date.now()}-${Math.random()}`,
    type: 'error',
    error,
    delta: false,
    ...(options?.index !== undefined && { index: options.index }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createDoneChunk(options?: {
  id?: string;
  metadata?: StreamChunkMetadata;
}): StreamChunk {
  return {
    id: options?.id || `done-${Date.now()}`,
    type: 'done',
    delta: false,
    ...(options?.metadata && { metadata: options.metadata })
  };
}

/**
 * Stream result with accumulation support
 */
export interface LLMStreamResult {
  readonly stream: AsyncIterable<StreamChunk>;
  readonly finalMessage: Promise<import('./messages.js').AssistantMessage>;
  readonly metadata: StreamMetadata;
}

/**
 * Stream metadata
 */
export interface StreamMetadata {
  readonly requestId: string;
  readonly provider: string;
  readonly model: string;
  readonly startTime: Date;
  readonly totalChunks?: number;
  readonly usage?: import('./requests.js').TokenUsage;
  readonly finishReason?: import('./requests.js').LLMResponse['finishReason'];
}