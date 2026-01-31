import { ToolDefinition } from '../../../core/index.js';
import type { Message, ToolCall, Attachment } from '../../../core/types/messages.js';

/**
 * Tiktoken interfaces for token counting
 */
export interface TiktokenEncoder {
  encode: (text: string) => number[];
}

export interface TiktokenModule {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  encoding_for_model: (model: string) => TiktokenEncoder;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  get_encoding: (encoding: string) => TiktokenEncoder;
}

/**
 * Abstract base class for token counting implementations
 * Provides common utilities and interface for model-specific counters
 */
export abstract class BaseTokenCounter {
  protected readonly model: string;
  protected readonly config: unknown;
  protected tiktoken: TiktokenModule | null = null;
  protected encoding: TiktokenEncoder | null = null;

  constructor(model: string, config: unknown) {
    this.model = model;
    this.config = config;
  }

  /**
   * Core interface - must be implemented by each model-specific counter
   * @param messages - Array of messages to count tokens for
   * @param tools - Array of tool definitions to include in count
   * @param maxTokens - Maximum output tokens that will be generated (counts toward context window)
   */
  abstract countTokens(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number): Promise<number>;
  abstract getContextWindow(): number;
  abstract supportsTokenCounting(): boolean;

  /**
   * Common utilities available to all implementations
   */
  protected estimateMessageOverhead(message: Message): number {
    const baseOverhead = {
      system: 10,    // Role + formatting
      user: 8,       // Role + formatting
      assistant: 8,  // Role + formatting
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tool_call: 12, // Role + tool metadata
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tool_result: 15 // Role + success/error metadata
    };
    return baseOverhead[message.type] || 10;
  }

  protected estimateToolCallTokens(toolCalls: readonly ToolCall[]): number {
    return toolCalls.reduce((total, call) => {
      return total + 
        Math.ceil(call.name.length / 4) + // Tool name
        Math.ceil(JSON.stringify(call.arguments).length / 4) + // Arguments
        15; // Tool call overhead
    }, 0);
  }

  protected estimateAttachmentTokens(attachments: readonly Attachment[]): number {
    return attachments.reduce((total, attachment) => {
      switch (attachment.type) {
        case 'image':
          return total + 85; // Standard image token cost
        case 'file':
          return total + (attachment.size ? Math.ceil(attachment.size / 4) : 50);
        default:
          return total + 25; // Default attachment overhead
      }
    }, 0);
  }

  /**
   * Initialize tiktoken for accurate token counting
   * Falls back gracefully if tiktoken is not available
   */
  protected initializeTiktoken(): void {
    try {
      // Dynamic import to handle optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.tiktoken = require('tiktoken') as TiktokenModule;
      
      // Use cl100k_base (GPT-4 encoding) as it has highest token-per-word ratio
      // This provides the most conservative token counting for context window management
      this.encoding = this.tiktoken.get_encoding('cl100k_base');
    } catch {
      // Tiktoken not available - will fall back to estimation
      this.tiktoken = null;
      this.encoding = null;
    }
  }

  /**
   * Enhanced token counting using tiktoken when available, fallback to 4-character estimation
   */
  protected estimateTokensFromText(text: string): number {
    if (this.encoding) {
      try {
        return this.encoding.encode(text).length;
      } catch {
        // Fallback if tiktoken encoding fails
      }
    }
    return Math.ceil(text.length / 4);
  }

  /**
   * Convert messages to OpenAI format for accurate tiktoken counting
   */
  protected convertToOpenAIFormat(messages: readonly Message[], tools: ToolDefinition[], model: string = 'gpt-4'): string {
    const openaiMessages = messages.map(message => {
      let content = message.content;

      // Add thinking content if present
      if (message.type === 'assistant' && 'thinking' in message && message.thinking) {
        content += `\n\n[Internal thinking: ${message.thinking}]`;
      }

      const openaiMessage: Record<string, unknown> = {
        role: this.mapRoleToOpenAI(message.type),
        content
      };

      // Add tool calls if present
      if (message.type === 'assistant' && 'toolCalls' in message && message.toolCalls) {
        openaiMessage['tool_calls'] = message.toolCalls.map(toolCall => ({
          id: toolCall.id || `call_${Math.random().toString(36).substring(2, 9)}`,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments)
          }
        }));
      }

      // Handle tool results
      if (message.type === 'tool_result') {
        openaiMessage['tool_call_id'] = message.toolCallId;
      }

      return openaiMessage;
    });

    // Create the full conversation structure including tools
    const conversation = {
      model: model, // Use provided model or default to gpt-4
      messages: openaiMessages,
      ...(tools.length > 0 && {
        tools: tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || {}
          }
        }))
      })
    };

    return JSON.stringify(conversation);
  }

  /**
   * Map message type to OpenAI role
   */
  protected mapRoleToOpenAI(messageType: Message['type']): string {
    switch (messageType) {
      case 'system':
        return 'system';
      case 'user':
        return 'user';
      case 'assistant':
      case 'tool_call':
        return 'assistant';
      case 'tool_result':
        return 'tool';
      default:
        return 'user';
    }
  }

  /**
   * Accurate token counting using tiktoken on OpenAI-formatted messages
   */
  protected countTokensWithTiktoken(messages: readonly Message[], tools: ToolDefinition[]): number {
    if (!this.encoding) {
      return this.estimateTokensForMessages(messages);
    }

    try {
      // Convert to OpenAI format and count tokens
      const openaiFormatText = this.convertToOpenAIFormat(messages, tools, this.model);
      return this.encoding.encode(openaiFormatText).length;
    } catch {
      // Fallback to estimation if tiktoken fails
      return this.estimateTokensForMessages(messages);
    }
  }

  /**
   * Calculate total estimated tokens for a message array (fallback method)
   */
  protected estimateTokensForMessages(messages: readonly Message[]): number {
    let totalTokens = 0;
    
    for (const message of messages) {
      // Basic estimation: 4 characters ≈ 1 token
      totalTokens += this.estimateTokensFromText(message.content);
      
      // Add message overhead
      totalTokens += this.estimateMessageOverhead(message);
      
      // Handle message-specific content
      if (message.type === 'assistant' && 'thinking' in message && message.thinking) {
        totalTokens += this.estimateTokensFromText(message.thinking);
      }
      
      if (message.type === 'assistant' && 'toolCalls' in message && message.toolCalls) {
        totalTokens += this.estimateToolCallTokens(message.toolCalls);
      }
      
      if (message.type === 'user' && 'attachments' in message && message.attachments) {
        totalTokens += this.estimateAttachmentTokens(message.attachments);
      }
    }
    
    return totalTokens;
  }
}