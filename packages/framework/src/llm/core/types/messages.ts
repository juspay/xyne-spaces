/**
 * Core message types for LLM communication
 * Supports thinking blocks, tool calls, and comprehensive metadata
 */

/**
 * Base interface for all message types
 */
export interface CommonMessage {
  readonly id: string;
  readonly type: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
  readonly content: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * System message with external prompt support
 */
export interface SystemMessage extends CommonMessage {
  readonly type: 'system';
  readonly content: string;
  readonly priority?: 'high' | 'medium' | 'low';
  readonly source?: 'external' | 'internal' | 'user';
}

/**
 * User message with optional attachments
 */
export interface UserMessage extends CommonMessage {
  readonly type: 'user';
  readonly content: string;
  readonly attachments?: readonly Attachment[];
  readonly isSummary?: boolean; // Flag indicating this message is a conversation summary
}

/**
 * Assistant message with thinking block and tool call support
 */
export interface AssistantMessage extends CommonMessage {
  readonly type: 'assistant';
  readonly content: string;
  readonly thinking?: string; // Claude's thinking block
  readonly thinkingSignature?: string; // Claude's thinking signature for conversation history
  readonly toolCalls?: readonly ToolCall[];
  readonly isSummary?: boolean; // Flag indicating this message is a conversation summary
}

/**
 * Tool call message for explicit tool invocation tracking
 */
export interface ToolCallMessage extends CommonMessage {
  readonly type: 'tool_call';
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
}

/**
 * Tool result message with execution metadata
 */
export interface ToolResultMessage extends CommonMessage {
  readonly type: 'tool_result';
  readonly content: string;
  readonly toolCallId: string;
  readonly success: boolean;
  readonly error?: string;
  readonly executionTime?: number;
}

/**
 * Tool call definition
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly type?: 'function' | 'tool';
}

/**
 * Attachment support for multimedia content
 */
export interface Attachment {
  readonly id: string;
  readonly type: 'image' | 'file' | 'audio' | 'video';
  readonly url?: string;
  readonly data?: string; // Base64 encoded data
  readonly mimeType: string;
  readonly size?: number;
  readonly name?: string;
}

/**
 * Union type for all message types
 */
export type Message = 
  | SystemMessage 
  | UserMessage 
  | AssistantMessage 
  | ToolCallMessage 
  | ToolResultMessage;

/**
 * Message validation helpers
 */
export function isSystemMessage(message: CommonMessage): message is SystemMessage {
  return message.type === 'system';
}

export function isUserMessage(message: CommonMessage): message is UserMessage {
  return message.type === 'user';
}

export function isAssistantMessage(message: CommonMessage): message is AssistantMessage {
  return message.type === 'assistant';
}

export function isToolCallMessage(message: CommonMessage): message is ToolCallMessage {
  return message.type === 'tool_call';
}

export function isToolResultMessage(message: CommonMessage): message is ToolResultMessage {
  return message.type === 'tool_result';
}

/**
 * Message creation utilities
 */
export function createSystemMessage(
  content: string,
  options?: {
    id?: string;
    priority?: SystemMessage['priority'];
    source?: SystemMessage['source'];
    metadata?: Record<string, unknown>;
  }
): SystemMessage {
  return {
    id: options?.id || `system-${Date.now()}`,
    type: 'system',
    content,
    timestamp: new Date().toDateString(),
    priority: options?.priority || 'medium',
    source: options?.source || 'external',
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createUserMessage(
  content: string,
  options?: {
    id?: string;
    attachments?: readonly Attachment[];
    metadata?: Record<string, unknown>;
  }
): UserMessage {
  return {
    id: options?.id || `user-${Date.now()}`,
    type: 'user',
    content,
    timestamp: new Date().toDateString(),
    ...(options?.attachments && { attachments: options.attachments }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createAssistantMessage(
  content: string,
  options?: {
    id?: string;
    thinking?: string;
    thinkingSignature?: string;
    toolCalls?: readonly ToolCall[];
    metadata?: Record<string, unknown>;
  }
): AssistantMessage {
  return {
    id: options?.id || `assistant-${Date.now()}`,
    type: 'assistant',
    content,
    timestamp: new Date().toDateString(),
    ...(options?.thinking && { thinking: options.thinking }),
    ...(options?.thinkingSignature && { thinkingSignature: options.thinkingSignature }),
    ...(options?.toolCalls && { toolCalls: options.toolCalls }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

export function createToolResultMessage(
  content: string,
  toolCallId: string,
  success: boolean,
  options?: {
    id?: string;
    error?: string;
    executionTime?: number;
    metadata?: Record<string, unknown>;
  }
): ToolResultMessage {
  return {
    id: options?.id || `tool_result-${Date.now()}`,
    type: 'tool_result',
    content,
    toolCallId,
    success,
    timestamp: new Date().toDateString(),
    ...(options?.error && { error: options.error }),
    ...(options?.executionTime !== undefined && { executionTime: options.executionTime }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

/**
 * Create tool call message
 */
export function createToolCallMessage(
  toolCalls: readonly ToolCall[],
  options?: {
    readonly content?: string;
    readonly metadata?: Record<string, unknown>;
  }
): ToolCallMessage {
  return {
    id: `tool_call_${Date.now()}_${Math.random().toString(36).substring(2)}`,
    type: 'tool_call',
    content: options?.content || '',
    toolCalls,
    timestamp: new Date().toDateString(),
    ...(options?.metadata && { metadata: options.metadata })
  };
}

/**
 * Create a tool call
 */
export function createToolCall(
  name: string,
  args: Record<string, unknown>,
  options?: {
    readonly id?: string;
  }
): ToolCall {
  return {
    id: options?.id || `call_${Date.now()}_${Math.random().toString(36).substring(2)}`,
    name,
    arguments: args
  };
}