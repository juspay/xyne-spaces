// Removed unused import
import type { StreamChunk, StreamAccumulator } from '../../core/types/streaming.js';
import type { AssistantMessage, ToolCall } from '../../core/types/messages.js';
import { createAssistantMessage } from '../../core/types/messages.js';
import { logger } from '../../../utils/logger.js';

/**
 * Stream accumulator implementation for reconstructing AssistantMessage from chunks
 * Critical component for maintaining conversation continuity
 */
export class StreamAccumulatorImpl implements StreamAccumulator {
  private contentBuffer = '';
  private thinkingBuffer = '';
  private toolCallsMap = new Map<string, ToolCall>();
  private messageId: string;
  private startTime: Date;
  private chunkCount = 0;

  constructor(messageId?: string) {
    this.messageId = messageId || `assistant-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    this.startTime = new Date();
    
    logger.debug('Stream accumulator initialized', {
      messageId: this.messageId,
      startTime: this.startTime
    });
  }

  /**
   * Accumulate a stream chunk into the final message
   */
  public accumulate(chunk: StreamChunk): void {
    this.chunkCount++;
    
    logger.debug('Accumulating chunk', {
      messageId: this.messageId,
      chunkType: chunk.type,
      chunkId: chunk.id,
      chunkCount: this.chunkCount
    });

    switch (chunk.type) {
      case 'content':
        this.accumulateContent(chunk);
        break;
      case 'thinking':
        this.accumulateThinking(chunk);
        break;
      case 'tool_call':
        this.accumulateToolCall(chunk);
        break;
      case 'error':
        this.handleErrorChunk(chunk);
        break;
      case 'done':
        this.handleDoneChunk(chunk);
        break;
      case 'metadata':
        this.handleMetadataChunk(chunk);
        break;
      default:
        logger.warn('Unknown chunk type ignored', {
          messageId: this.messageId,
          chunkType: chunk.type,
          chunkId: chunk.id
        });
    }
  }

  /**
   * Finalize accumulation and create the complete AssistantMessage
   */
  public finalize(): AssistantMessage {
    const content = this.contentBuffer.trim();
    const thinking = this.thinkingBuffer.trim() || undefined;
    const toolCalls = this.getToolCallsArray();
    
    const finalMessage = createAssistantMessage(content, {
      id: this.messageId,
      ...(thinking && { thinking }),
      ...(toolCalls.length > 0 && { toolCalls })
    });

    logger.debug('Stream accumulation finalized', {
      messageId: this.messageId,
      contentLength: content.length,
      thinkingLength: thinking?.length || 0,
      toolCallsCount: toolCalls.length,
      totalChunks: this.chunkCount,
      duration: Date.now() - this.startTime.getTime()
    });

    return finalMessage;
  }

  /**
   * Reset accumulator for reuse
   */
  public reset(): void {
    this.contentBuffer = '';
    this.thinkingBuffer = '';
    this.toolCallsMap.clear();
    this.messageId = `assistant-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    this.startTime = new Date();
    this.chunkCount = 0;
    
    logger.debug('Stream accumulator reset', {
      messageId: this.messageId
    });
  }

  /**
   * Get current content (useful for real-time display)
   */
  public getCurrentContent(): string {
    return this.contentBuffer;
  }

  /**
   * Get current thinking content (useful for real-time display)
   */
  public getCurrentThinking(): string {
    return this.thinkingBuffer;
  }

  /**
   * Get current tool calls (useful for real-time display)
   */
  public getToolCalls(): readonly ToolCall[] {
    return this.getToolCallsArray();
  }

  /**
   * Get accumulation statistics
   */
  public getStatistics(): {
    messageId: string;
    chunkCount: number;
    contentLength: number;
    thinkingLength: number;
    toolCallsCount: number;
    duration: number;
    startTime: Date;
  } {
    return {
      messageId: this.messageId,
      chunkCount: this.chunkCount,
      contentLength: this.contentBuffer.length,
      thinkingLength: this.thinkingBuffer.length,
      toolCallsCount: this.toolCallsMap.size,
      duration: Date.now() - this.startTime.getTime(),
      startTime: this.startTime
    };
  }

  /**
   * Private methods for handling different chunk types
   */
  private accumulateContent(chunk: StreamChunk): void {
    if (chunk.content !== undefined) {
      if (chunk.delta === false) {
        // Replace entire content (non-delta)
        this.contentBuffer = chunk.content;
      } else {
        // Append content (delta mode - default)
        this.contentBuffer += chunk.content;
      }
    }
  }

  private accumulateThinking(chunk: StreamChunk): void {
    if (chunk.thinking !== undefined) {
      if (chunk.delta === false) {
        // Replace entire thinking content (non-delta)
        this.thinkingBuffer = chunk.thinking;
      } else {
        // Append thinking content (delta mode - default)
        this.thinkingBuffer += chunk.thinking;
      }
    }
  }

  private accumulateToolCall(chunk: StreamChunk): void {
    if (chunk.toolCall) {
      const toolCall = chunk.toolCall;
      
      // Tool calls are typically complete objects, but handle partial updates
      if (this.toolCallsMap.has(toolCall.id)) {
        // Update existing tool call (for progressive tool call building)
        const existing = this.toolCallsMap.get(toolCall.id)!;
        this.toolCallsMap.set(toolCall.id, {
          ...existing,
          ...toolCall,
          // Merge arguments if both exist
          arguments: {
            ...existing.arguments,
            ...toolCall.arguments
          }
        });
      } else {
        // New tool call
        this.toolCallsMap.set(toolCall.id, toolCall);
      }
    }
  }

  private handleErrorChunk(chunk: StreamChunk): void {
    if (chunk.error) {
      logger.error('Error chunk received during accumulation', new Error(chunk.error), {
        messageId: this.messageId,
        chunkId: chunk.id,
        error: chunk.error
      });
    }
  }

  private handleDoneChunk(chunk: StreamChunk): void {
    logger.debug('Done chunk received', {
      messageId: this.messageId,
      chunkId: chunk.id,
      finalStats: this.getStatistics()
    });
  }

  private handleMetadataChunk(chunk: StreamChunk): void {
    if (chunk.metadata) {
      logger.debug('Metadata chunk received', {
        messageId: this.messageId,
        chunkId: chunk.id,
        metadata: chunk.metadata
      });
    }
  }

  private getToolCallsArray(): ToolCall[] {
    return Array.from(this.toolCallsMap.values()).sort((a, b) => {
      // Sort tool calls by ID for consistent ordering
      return a.id.localeCompare(b.id);
    });
  }
}

/**
 * Export the implementation as StreamAccumulator for convenience
 */
export { StreamAccumulatorImpl as StreamAccumulator };

/**
 * Factory function for creating stream accumulators
 */
export function createStreamAccumulator(messageId?: string): StreamAccumulator {
  return new StreamAccumulatorImpl(messageId);
}

/**
 * Utility function to accumulate a complete stream into a final message
 */
export async function accumulateStreamToMessage(
  stream: AsyncIterable<StreamChunk>,
  messageId?: string
): Promise<AssistantMessage> {
  const accumulator = createStreamAccumulator(messageId);
  
  for await (const chunk of stream) {
    accumulator.accumulate(chunk);
  }
  
  return accumulator.finalize();
}

/**
 * Utility function to create a stream with both real-time chunks and final message
 */
export function createStreamWithAccumulation(
  stream: AsyncIterable<StreamChunk>,
  messageId?: string
): {
  stream: AsyncIterable<StreamChunk>;
  finalMessage: Promise<AssistantMessage>;
} {
  const accumulator = createStreamAccumulator(messageId);
  let finalMessageResolve: (message: AssistantMessage) => void;
  let finalMessageReject: (error: Error) => void;
  
  const finalMessage = new Promise<AssistantMessage>((resolve, reject) => {
    finalMessageResolve = resolve;
    finalMessageReject = reject;
  });

  const accumulatingStream = async function* (): AsyncIterable<StreamChunk> {
    try {
      for await (const chunk of stream) {
        accumulator.accumulate(chunk);
        yield chunk;
      }
      // Stream complete, finalize the message
      finalMessageResolve(accumulator.finalize());
    } catch (error) {
      finalMessageReject(error instanceof Error ? error : new Error('Stream accumulation failed'));
      throw error;
    }
  };

  return {
    stream: accumulatingStream(),
    finalMessage
  };
}