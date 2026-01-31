/**
 * Unified Bot Framework - Genius SSE Parser
 *
 * Specialized SSE parser for the Genius AI API format.
 * Handles Genius-specific event types like tool_output, final_output, session_id, etc.
 */

import type { BotEvent } from '../types/index.js';
import {
  createContentEvent,
  createToolInputEvent,
  createToolOutputEvent,
} from '../types/index.js';
import { BaseSseParser, sseParserRegistry } from './sse-parser.js';
import { toolOutputTransformerRegistry } from './tool-output-transformer.js';
import {logger} from '@/utils/logger';

/**
 * Genius API final_output structure
 */
interface GeniusFinalOutput {
  message: string;
  template_response?: {
    text: string;
    replacements: Record<string, string>;
  };
  status: string;
  responses?: Array<{
    input: string | null;
    output: string;
    payload_type: string;
  }>;
  status_code: number;
  session_id: string;
  feedback_id: string;
  message_id: string;
}

/**
 * Genius SSE Parser
 *
 * Handles Genius API SSE format:
 * - event: tool_input
 * - event: tool_output
 * - event: final_output
 * - event: session_id
 * - event: agent_update
 * - event: agent_thinking
 */
export class GeniusSseParser extends BaseSseParser {
  private transformer = toolOutputTransformerRegistry.get('genius');

  /**
   * Handle Genius-specific event types
   */
  protected override *handleParsedData(
    eventType: string | undefined,
    data: Record<string, unknown>
  ): Generator<BotEvent> {
    
    const isFinalOutput = 
      eventType === 'final_output' ||
      (eventType === undefined && 
       'message' in data && 
       'responses' in data && 
       'session_id' in data);
    
    switch (eventType) {
      case 'tool_input':
        yield* this.handleToolInput(data);
        break;

      case 'tool_output':
        yield* this.handleToolOutput(data);
        break;

      case 'final_output':
        yield* this.handleFinalOutput(data as unknown as GeniusFinalOutput);
        break;

      case 'session_id':
        this.handleSessionId(data);
        break;

      case 'agent_update':
      case 'agent_thinking':
        // Informational events - skip
        break;

      default:
        // Check if this is a final_output without explicit event type
        if (isFinalOutput) {
          logger.info('[GeniusSseParser] Detected final_output without event type');
          yield* this.handleFinalOutput(data as unknown as GeniusFinalOutput);
          break;
        }
        
        // Unknown event or no event type - check for content
        if (data.content && typeof data.content === 'string') {
          this.state.fullContent += data.content;
          yield createContentEvent(data.content, this.state.fullContent);
        }
    }
  }

  /**
   * Handle tool_input event
   */
  private *handleToolInput(data: Record<string, unknown>): Generator<BotEvent> {
    const toolName = data.tool_name as string | undefined;
    const input = data.input;
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input);

    if (toolName) {
      yield createToolInputEvent(toolName, inputStr);
    }
  }

  /**
   * Handle tool_output event
   */
  private *handleToolOutput(data: Record<string, unknown>): Generator<BotEvent> {
    const toolName = (data.tool_name as string | undefined)?.toLowerCase() || '';
    const output = data.output as string | undefined;
    const input = data.input as string | undefined;

    // Only process q_api outputs (they contain chart/table data)
    if (toolName === 'q_api' || toolName.startsWith('q_api')) {
      if (output) {
        try {
          const parsedOutput = JSON.parse(output);
          const toolOutput = this.transformer.transform(parsedOutput, input, data.tool_name as string);

          if (toolOutput) {
            this.state.toolOutputs.push(toolOutput);
            yield createToolOutputEvent(toolOutput, data.tool_name as string);
          }
        } catch (e) {
          logger.error('[GeniusSseParser] Failed to parse tool output:', e);
        }
      }
    }
  }

  /**
   * Handle final_output event
   */
  private *handleFinalOutput(data: GeniusFinalOutput): Generator<BotEvent> {
    // Extract message content
    if (data.message) {
      this.state.fullContent = data.message;
      yield createContentEvent(data.message, data.message);
    }

    // Capture session_id
    if (data.session_id) {
      this.state.sessionId = data.session_id;
      logger.info('[GeniusSseParser] Captured session_id from final_output:', data.session_id);
    }

    // Extract tool outputs from responses array (only if none streamed yet)
    if (data.responses && Array.isArray(data.responses) && this.state.toolOutputs.length === 0) {
      for (const response of data.responses) {
        // Skip output_text and info payloads
        if (response.payload_type === 'output_text' || response.payload_type === 'info') {
          continue;
        }

        // Process q_api responses
        if (response.payload_type === 'q_api' && response.output) {
          try {
            const parsedOutput = JSON.parse(response.output);
            const toolOutput = this.transformer.transform(
              parsedOutput,
              response.input || undefined,
              'q_api'
            );

            if (toolOutput) {
              this.state.toolOutputs.push(toolOutput);
              yield createToolOutputEvent(toolOutput, 'q_api');
            }
          } catch (e) {
            logger.error('[GeniusSseParser] Failed to parse final_output q_api:', e);
          }
        }
      }
    }
  }

  /**
   * Handle session_id event
   */
  private handleSessionId(data: Record<string, unknown>): void {
    if (data.session_id && typeof data.session_id === 'string') {
      this.state.sessionId = data.session_id;
      logger.info('[GeniusSseParser] Captured session_id from event:', data.session_id);
    }
  }
}

// Register Genius parser
sseParserRegistry.register('genius', GeniusSseParser);
