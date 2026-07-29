/**
 * Unified Bot Framework - Event Stream Types
 *
 * All bots emit the same event types regardless of internal/external execution.
 * This provides a consistent interface for consumers of bot responses.
 */

import type { ToolOutput, FlowJson } from './unified-bot.js';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event type discriminator
 */
export type BotEventType =
  | 'content'
  | 'tool_input'
  | 'tool_output'
  | 'message_created'
  | 'done'
  | 'error';

// ============================================================================
// Individual Event Interfaces
// ============================================================================

/**
 * Base event interface
 */
export interface BotEventBase {
  readonly type: BotEventType;
  readonly timestamp?: Date;
}

/**
 * Content event - streamed text content
 */
export interface ContentEvent extends BotEventBase {
  readonly type: 'content';
  /** Incremental content chunk */
  readonly content: string;
  /** Full content accumulated so far (optional) */
  readonly fullContent?: string;
  /** Message ID (may be null during streaming before message is created) */
  readonly messageId?: string | null;
  /** Channel ID */
  readonly channelId?: string;
}

/**
 * Tool input event - tool is being called with input
 */
export interface ToolInputEvent extends BotEventBase {
  readonly type: 'tool_input';
  /** Name of the tool being called */
  readonly toolName: string;
  /** Input being passed to the tool */
  readonly toolInput: string;
  /** Message ID */
  readonly messageId?: string | null;
  /** Channel ID */
  readonly channelId?: string;
}

/**
 * Tool output event - tool has returned output
 */
export interface ToolOutputEvent extends BotEventBase {
  readonly type: 'tool_output';
  /** Name of the tool that returned output */
  readonly toolName?: string;
  /** Structured tool output (charts, tables, etc.) */
  readonly toolOutput: ToolOutput;
  /** Message ID */
  readonly messageId?: string | null;
  /** Channel ID */
  readonly channelId?: string;
}

/**
 * Message created event - a message was persisted
 */
export interface MessageCreatedEvent extends BotEventBase {
  readonly type: 'message_created';
  /** Created message ID */
  readonly messageId: string;
  /** Channel ID */
  readonly channelId: string;
  /** Conversation ID */
  readonly conversationId: string;
  /** Sender ID (bot user ID) */
  readonly senderId: string;
  /** Initial content */
  readonly content?: string;
}

/**
 * Done event - bot execution completed
 */
export interface DoneEvent extends BotEventBase {
  readonly type: 'done';
  /** Final accumulated content */
  readonly fullContent?: string;
  /** Final message ID */
  readonly messageId?: string | null;
  /** Channel ID */
  readonly channelId?: string;
  /** All tool outputs collected */
  readonly toolOutputs?: readonly ToolOutput[];
  /** FlowJson UI components */
  readonly flowJson?: FlowJson;
  /** Session ID for context continuity */
  readonly sessionId?: string;
}

/**
 * Error event - an error occurred
 */
export interface ErrorEvent extends BotEventBase {
  readonly type: 'error';
  /** Error message */
  readonly error: string;
  /** Error code (optional) */
  readonly errorCode?: string;
  /** Message ID (if message was created before error) */
  readonly messageId?: string | null;
  /** Channel ID */
  readonly channelId?: string;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all bot event types
 */
export type BotEvent =
  | ContentEvent
  | ToolInputEvent
  | ToolOutputEvent
  | MessageCreatedEvent
  | DoneEvent
  | ErrorEvent;

// ============================================================================
// Event Factories
// ============================================================================

/**
 * Create a content event
 * @param content - The content chunk
 * @param fullContentOrOptions - Either the full accumulated content (string) or options object
 */
export function createContentEvent(
  content: string,
  fullContentOrOptions?: string | Partial<Omit<ContentEvent, 'type' | 'content'>>
): ContentEvent {
  const options = typeof fullContentOrOptions === 'string'
    ? { fullContent: fullContentOrOptions }
    : fullContentOrOptions;

  return {
    type: 'content',
    content,
    timestamp: new Date(),
    ...options,
  };
}

/**
 * Create a tool input event
 */
export function createToolInputEvent(
  toolName: string,
  toolInput: string,
  options?: Partial<Omit<ToolInputEvent, 'type' | 'toolName' | 'toolInput'>>
): ToolInputEvent {
  return {
    type: 'tool_input',
    toolName,
    toolInput,
    timestamp: new Date(),
    ...options,
  };
}

/**
 * Create a tool output event
 * @param toolOutput - The tool output
 * @param toolNameOrOptions - Either the tool name (string) or options object
 */
export function createToolOutputEvent(
  toolOutput: ToolOutput,
  toolNameOrOptions?: string | Partial<Omit<ToolOutputEvent, 'type' | 'toolOutput'>>
): ToolOutputEvent {
  const options = typeof toolNameOrOptions === 'string'
    ? { toolName: toolNameOrOptions }
    : toolNameOrOptions;

  return {
    type: 'tool_output',
    toolOutput,
    timestamp: new Date(),
    ...options,
  };
}

/**
 * Create a message created event
 */
export function createMessageCreatedEvent(
  messageId: string,
  channelId: string,
  conversationId: string,
  senderId: string,
  content?: string
): MessageCreatedEvent {
  return {
    type: 'message_created',
    messageId,
    channelId,
    conversationId,
    senderId,
    content,
    timestamp: new Date(),
  };
}

/**
 * Create a done event
 * @param fullContentOrOptions - Either the full content (string) or options object
 * @param messageId - Optional message ID (only if first arg is string)
 * @param toolOutputs - Optional tool outputs (only if first arg is string)
 * @param sessionId - Optional session ID (only if first arg is string)
 */
export function createDoneEvent(
  fullContentOrOptions?: string | Partial<Omit<DoneEvent, 'type'>>,
  messageId?: string | null,
  toolOutputs?: readonly ToolOutput[],
  sessionId?: string
): DoneEvent {
  let options: Partial<Omit<DoneEvent, 'type'>>;

  if (typeof fullContentOrOptions === 'string' || fullContentOrOptions === undefined) {
    options = {
      fullContent: fullContentOrOptions,
      messageId,
      toolOutputs,
      sessionId,
    };
  } else {
    options = fullContentOrOptions;
  }

  return {
    type: 'done',
    timestamp: new Date(),
    ...options,
  };
}

/**
 * Create an error event
 * @param error - The error message
 * @param messageIdOrOptions - Either the message ID (string) or options object
 */
export function createErrorEvent(
  error: string,
  messageIdOrOptions?: string | Partial<Omit<ErrorEvent, 'type' | 'error'>>
): ErrorEvent {
  const options = typeof messageIdOrOptions === 'string'
    ? { messageId: messageIdOrOptions }
    : messageIdOrOptions;

  return {
    type: 'error',
    error,
    timestamp: new Date(),
    ...options,
  };
}
