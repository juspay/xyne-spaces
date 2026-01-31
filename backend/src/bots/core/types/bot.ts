import type { z } from 'zod';
import type { Message } from '@prisma/client';
import type { BotExecutionSession } from '@/services/bots';

/**
 * Bot execution result wrapper
 */
export interface BotExecutionResult<TOutput = unknown> {
  readonly success: boolean;
  readonly data?: TOutput;
  readonly error?: BotError;
  readonly metadata: BotExecutionMetadata;
}

/**
 * Bot execution metadata for tracing and debugging
 */
export interface BotExecutionMetadata {
  readonly botName: string;
  readonly executionId: string;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly duration?: number;
  readonly inputSize?: number;
  readonly outputSize?: number;
  readonly conversationId?: string;
  readonly userId?: string;
}

/**
 * Bot scope types - where the bot can be triggered
 */
export type BotScope = 'conversation' | 'thread' | 'all';

/**
 * Bot metadata for registration and discovery
 */
export interface BotMetadata {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly capabilities?: readonly string[];
  readonly scope?: BotScope;
}

/**
 * Bot schema definition using Zod
 */
export interface BotSchemas<TInput = unknown, TOutput = unknown> {
  readonly input: z.ZodSchema<TInput>;
  readonly output: z.ZodSchema<TOutput>;
}

/**
 * Bot decorator configuration
 */
export interface BotConfig<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly outputSchema: z.ZodSchema<TOutput>;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly capabilities?: readonly string[];
  readonly scope?: BotScope;
}

/**
 * Bot registry entry
 */
export interface BotRegistryEntry<TInput = unknown, TOutput = unknown> {
  readonly metadata: BotMetadata;
  readonly schemas: BotSchemas<TInput, TOutput>;
  readonly botClass: new () => BotInstance<TInput, TOutput>;
  readonly registeredAt: Date;
}

/**
 * Bot instance interface
 */
export interface BotInstance<TInput = unknown, TOutput = unknown> {
  execute(input: TInput, context: BotExecutionContext): Promise<BotExecutionResult<TOutput>>;
  getBotInfo(): { id: string; name: string; email: string; picture: string | undefined };
  validateInputSchema(input: Record<string, string>): { success: true; flowJson: string; validatedInput: TInput } | { success: false; flowJson: string };
}

/**
 * Bot validation context
 */
export interface BotValidationContext {
  readonly botName: string;
  readonly phase: 'input' | 'output';
  readonly data: unknown;
}

/**
 * Bot execution context
 */
export interface BotExecutionContext {
  readonly executionId: string;
  readonly botName: string;
  readonly startTime: Date;
  readonly conversationId: string;
  readonly userId: string;
  readonly triggerMessage: Message;
  readonly session: BotExecutionSession;
  readonly abortSignal?: AbortSignal;
  readonly services?: BotServices;
}

/**
 * Bot services available during execution
 */
export interface BotServices {
  readonly database?: unknown;
  readonly logger?: unknown;
  readonly cache?: unknown;
  readonly notifications?: unknown;
  readonly fileStorage?: unknown;
  readonly externalApis?: Record<string, unknown>;
}

/**
 * Bot error interface
 */
export interface BotError {
  readonly type: 'validation' | 'execution' | 'registration' | 'timeout' | 'abort';
  readonly message: string;
  readonly botName: string;
  readonly details?: Record<string, unknown>;
  readonly originalError?: Error;
}

/**
 * Bot conversation state
 */
export interface BotConversationState {
  readonly conversationId: string;
  readonly botName: string;
  readonly state: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
}

/**
 * Bot action types
 */
export type BotActionType = 
  | 'data_query'
  | 'data_mutation'
  | 'file_operation'
  | 'notification'
  | 'external_api_call'
  | 'workflow_trigger'
  | 'user_interaction'
  | 'system_command';

/**
 * Bot action definition
 */
export interface BotAction {
  readonly type: BotActionType;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresConfirmation?: boolean;
  readonly timeout?: number;
}

/**
 * Bot capability definition
 */
export interface BotCapability {
  readonly name: string;
  readonly description: string;
  readonly actions: readonly BotActionType[];
  readonly permissions?: readonly string[];
}