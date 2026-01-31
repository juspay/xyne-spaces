import type { z } from 'zod';
import type { ToolError } from '../../../types/errors.js';

/**
 * Tool execution result wrapper
 */
export interface ToolExecutionResult<TOutput = unknown> {
  readonly success: boolean;
  readonly data?: TOutput;
  readonly error?: ToolError;
  readonly metadata: ToolExecutionMetadata;
}

/**
 * Tool execution metadata for tracing and debugging
 */
export interface ToolExecutionMetadata {
  readonly toolName: string;
  readonly executionId: string;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly duration?: number;
  readonly inputSize?: number;
  readonly outputSize?: number;
}

/**
 * Tool metadata for registration and discovery
 */
export interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
}

/**
 * Tool schema definition using Zod
 */
export interface ToolSchemas<TInput = unknown, TOutput = unknown> {
  readonly input: z.ZodSchema<TInput>;
  readonly output: z.ZodSchema<TOutput>;
}

/**
 * Tool decorator configuration
 */
export interface ToolConfig<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly outputSchema: z.ZodSchema<TOutput>;
  readonly llmOutputSchema: z.ZodSchema<TLLMOutput>;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
}

/**
 * Tool registry entry
 */
export interface ToolRegistryEntry<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> {
  readonly metadata: ToolMetadata;
  readonly schemas: ToolSchemas<TInput, TOutput>;
  readonly toolClass: new () => ToolInstance<TInput, TOutput, TLLMOutput>;
  readonly registeredAt: Date;
}

/**
 * Tool instance interface
 */
export interface ToolInstance<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> {
  execute(input: TInput, abortSignal?: AbortSignal, cwd?: string): Promise<ToolExecutionResult<TOutput>>;
  getLLMOutput(result: ToolExecutionResult<TOutput>): TLLMOutput;
}

/**
 * Tool validation context
 */
export interface ToolValidationContext {
  readonly toolName: string;
  readonly phase: 'input' | 'output';
  readonly data: unknown;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  readonly executionId: string;
  readonly toolName: string;
  readonly startTime: Date;
  readonly metadata?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
  readonly cwd?: string;
}