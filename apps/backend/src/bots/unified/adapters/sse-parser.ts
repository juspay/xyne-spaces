/**
 * Unified Bot Framework - SSE Parser Adapter
 *
 * Base interface and implementation for parsing Server-Sent Events (SSE).
 * External bot providers can have different SSE formats, so this provides
 * a pluggable way to handle different formats.
 */

import type { BotEvent, ToolOutput } from '../types/index.js';
import {
  createContentEvent,
  createDoneEvent,
  createErrorEvent,
} from '../types/index.js';

/**
 * Parsed SSE line
 */
export interface SseLine {
  /** Event type (from "event:" line) */
  eventType?: string;
  /** Data content (from "data:" line) */
  data?: string;
  /** Parsed JSON data (if data is valid JSON) */
  parsedData?: Record<string, unknown>;
}

/**
 * SSE Parser interface - implement this for custom SSE formats
 */
export interface ISseParser {
  /**
   * Parse a single SSE message (may span multiple lines)
   * @param lines - The SSE message lines
   * @returns Iterator of BotEvents
   */
  parseMessage(lines: string[]): Generator<BotEvent>;

  /**
   * Parse streaming response
   * @param reader - The ReadableStreamDefaultReader from fetch
   * @returns AsyncGenerator of BotEvents
   */
  parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<BotEvent>;
}

/**
 * Accumulated state during SSE parsing
 */
export interface SseParserState {
  fullContent: string;
  toolOutputs: ToolOutput[];
  sessionId?: string;
  messageId?: string;
}

/**
 * Base SSE Parser - handles standard SSE format
 *
 * Standard SSE format:
 * ```
 * event: eventType
 * data: {"key": "value"}
 *
 * data: {"content": "text"}
 *
 * data: [DONE]
 * ```
 */
export class BaseSseParser implements ISseParser {
  protected state: SseParserState = {
    fullContent: '',
    toolOutputs: [],
  };

  /**
   * Reset parser state
   */
  reset(): void {
    this.state = {
      fullContent: '',
      toolOutputs: [],
    };
  }

  /**
   * Parse streaming response
   */
  async *parseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncGenerator<BotEvent> {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        const messageLines: string[] = [];

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Empty line signals end of SSE message
          if (!trimmedLine) {
            if (messageLines.length > 0) {
              yield* this.parseMessage(messageLines);
              messageLines.length = 0;
            }
            continue;
          }

          // Collect lines for current message
          if (trimmedLine.startsWith('event:') || trimmedLine.startsWith('data:')) {
            messageLines.push(trimmedLine);
          }
        }

        // Process any remaining message lines
        if (messageLines.length > 0) {
          yield* this.parseMessage(messageLines);
        }
      }

      // Emit done event
      yield createDoneEvent(
        this.state.fullContent,
        this.state.messageId,
        this.state.toolOutputs.length > 0 ? this.state.toolOutputs : undefined,
        this.state.sessionId
      );
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single SSE message
   */
  *parseMessage(lines: string[]): Generator<BotEvent> {
    const parsed = this.parseLines(lines);

    // Handle [DONE] signal
    if (parsed.data === '[DONE]') {
      return;
    }

    // Handle parsed JSON data
    if (parsed.parsedData) {
      yield* this.handleParsedData(parsed.eventType, parsed.parsedData);
    }
    // Handle raw text data
    else if (parsed.data) {
      this.state.fullContent += parsed.data;
      yield createContentEvent(parsed.data, this.state.fullContent);
    }
  }

  /**
   * Parse SSE lines into structured data
   */
  protected parseLines(lines: string[]): SseLine {
    const result: SseLine = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('event:')) {
        result.eventType = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        result.data = dataStr;

        // Try to parse as JSON
        if (dataStr && dataStr !== '[DONE]') {
          try {
            result.parsedData = JSON.parse(dataStr);
          } catch {
            // Not JSON, keep as raw string
          }
        }
      }
    }

    return result;
  }

  /**
   * Handle parsed JSON data - override in subclasses for custom formats
   */
  protected *handleParsedData(
    _eventType: string | undefined,
    data: Record<string, unknown>
  ): Generator<BotEvent> {
    // Default handling - look for common content fields
    if (data.content && typeof data.content === 'string') {
      this.state.fullContent += data.content;
      yield createContentEvent(data.content, this.state.fullContent);
    }

    // Handle error
    if (data.error && typeof data.error === 'string') {
      yield createErrorEvent(data.error);
    }
  }
}

/**
 * SSE Parser registry for pluggable parsers
 */
class SseParserRegistry {
  private parsers = new Map<string, new () => ISseParser>();

  constructor() {
    // Register default parser
    this.register('default', BaseSseParser);
  }

  /**
   * Register a parser for a specific format
   */
  register(format: string, parserClass: new () => ISseParser): void {
    this.parsers.set(format, parserClass);
  }

  /**
   * Get a parser instance for a format
   */
  get(format: string): ISseParser {
    const ParserClass = this.parsers.get(format) || this.parsers.get('default')!;
    return new ParserClass();
  }

  /**
   * Check if a format is registered
   */
  has(format: string): boolean {
    return this.parsers.has(format);
  }
}

// Export singleton registry
export const sseParserRegistry = new SseParserRegistry();
