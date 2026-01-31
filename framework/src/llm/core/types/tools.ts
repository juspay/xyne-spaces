import type { z } from 'zod';

/**
 * Tool definitions for LLM integration
 * These are schema-only definitions - no execution logic
 */

/**
 * Tool definition for LLM providers
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<unknown>;
  readonly parameters?: ToolParameterDefinition;
  readonly required?: readonly string[];
  readonly metadata?: ToolMetadata;
}

/**
 * Tool parameter definition (for providers that need explicit parameters)
 */
export interface ToolParameterDefinition {
  readonly type: 'object';
  readonly properties: Record<string, ToolPropertyDefinition>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Individual tool property definition
 */
export interface ToolPropertyDefinition {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: ToolPropertyDefinition;
  readonly properties?: Record<string, ToolPropertyDefinition>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: unknown;
}

/**
 * Tool metadata for enhanced LLM understanding
 */
export interface ToolMetadata {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly version?: string;
  readonly author?: string;
  readonly examples?: readonly ToolExample[];
  readonly limitations?: readonly string[];
  readonly dependencies?: readonly string[];
}

/**
 * Tool usage example
 */
export interface ToolExample {
  readonly description: string;
  readonly input: Record<string, unknown>;
  readonly expectedOutput?: string;
  readonly context?: string;
}

/**
 * Tool schema conversion result
 */
export interface ToolSchemaConversionResult {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterDefinition;
  readonly originalSchema: z.ZodSchema<unknown>;
  readonly metadata?: ToolMetadata;
}

/**
 * Tool call result (for when tools are executed externally)
 */
export interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly executionTime?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tool registry entry for LLM context
 */
export interface ToolRegistryEntry {
  readonly definition: ToolDefinition;
  readonly conversionResult: ToolSchemaConversionResult;
  readonly lastUpdated: Date;
  readonly usageCount?: number;
}

/**
 * Tool choice options for LLM requests
 */
export type ToolChoice = 
  | 'auto'     // Let model decide
  | 'none'     // Don't use tools
  | 'required' // Must use a tool
  | { name: string }; // Use specific tool

/**
 * Tool format types for different providers
 */
export type ToolFormat = 
  | 'anthropic'    // Anthropic's tool format
  | 'openai'       // OpenAI's function calling format
  | 'vertex'       // Google Vertex AI format
  | 'bedrock';     // AWS Bedrock format

/**
 * Tool schema converter interface
 */
export interface ToolSchemaConverter {
  convert(
    toolDefinition: ToolDefinition, 
    targetFormat: ToolFormat
  ): ToolSchemaConversionResult;
  
  convertMultiple(
    toolDefinitions: readonly ToolDefinition[], 
    targetFormat: ToolFormat
  ): readonly ToolSchemaConversionResult[];
}

/**
 * Zod to JSON Schema conversion utilities
 */
export interface ZodToJsonSchemaOptions {
  readonly strict?: boolean;
  readonly includeDescription?: boolean;
  readonly includeExamples?: boolean;
  readonly target?: ToolFormat;
}

/**
 * Tool validation helpers
 */
export function validateToolDefinition(tool: ToolDefinition): string[] {
  const errors: string[] = [];

  if (!tool.name || tool.name.trim() === '') {
    errors.push('Tool name is required');
  }

  if (!tool.description || tool.description.trim() === '') {
    errors.push('Tool description is required');
  }

  if (!tool.inputSchema) {
    errors.push('Tool input schema is required');
  }

  // Validate name format (alphanumeric + underscores only)
  if (tool.name && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tool.name)) {
    errors.push('Tool name must be alphanumeric with underscores (starting with letter)');
  }

  return errors;
}

/**
 * Create a tool definition from existing tool framework
 */
export function createToolDefinition(
  name: string,
  description: string,
  inputSchema: z.ZodSchema<unknown>,
  options?: {
    metadata?: ToolMetadata;
    required?: readonly string[];
  }
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    ...(options?.metadata && { metadata: options.metadata }),
    ...(options?.required && { required: options.required })
  };
}

/**
 * Tool definition type guards
 */
export function isValidToolDefinition(obj: unknown): obj is ToolDefinition {
  if (!obj || typeof obj !== 'object') return false;
  
  const tool = obj as Partial<ToolDefinition>;
  return !!(
    tool.name &&
    typeof tool.name === 'string' &&
    tool.description &&
    typeof tool.description === 'string' &&
    tool.inputSchema
  );
}

/**
 * Extract tool names from definitions
 */
export function extractToolNames(tools: readonly ToolDefinition[]): readonly string[] {
  return tools.map(tool => tool.name);
}

/**
 * Find tool definition by name
 */
export function findToolDefinition(
  tools: readonly ToolDefinition[], 
  name: string
): ToolDefinition | undefined {
  return tools.find(tool => tool.name === name);
}