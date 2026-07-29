/**
 * Tool integration types for bridging MCP tools to framework tools
 */

import type { z } from 'zod';
import type { MCPTool } from '../../core/types/framework.js';
import type { ToolInstance } from '../../../tools/core/types/tool.js';

/**
 * MCP tool discovery options
 */
export interface ToolDiscoveryOptions {
  readonly includeDisabled?: boolean;
  readonly serverFilter?: readonly string[];
  readonly categoryFilter?: readonly string[];
  readonly timeout?: number;
}

/**
 * MCP tool catalog entry
 */
export interface MCPToolCatalogEntry {
  readonly tool: MCPTool;
  readonly serverName: string;
  readonly discoveredAt: Date;
  readonly isAvailable: boolean;
  readonly frameworkName: string; // Name when registered in framework
}

/**
 * MCP tool catalog
 */
export interface MCPToolCatalog {
  readonly entries: readonly MCPToolCatalogEntry[];
  readonly totalCount: number;
  readonly serverCounts: Readonly<Record<string, number>>;
  readonly lastUpdated: Date;
}

/**
 * MCP tool execution options
 */
export interface MCPToolExecutionOptions {
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly retryDelay?: number;
  readonly serverName?: string; // Override server selection
}

/**
 * MCP tool execution result
 */
export interface MCPToolExecutionResult<TOutput = unknown> {
  readonly success: boolean;
  readonly data?: TOutput;
  readonly error?: MCPToolExecutionError;
  readonly serverName: string;
  readonly toolName: string;
  readonly executionTime: number;
  readonly executedAt: Date;
}

/**
 * MCP tool execution error
 */
export interface MCPToolExecutionError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly isRetryable: boolean;
}

/**
 * MCP tool parameter mapping result
 */
export interface ParameterMappingResult {
  readonly success: boolean;
  readonly mappedParameters: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * MCP tool schema adaptation result
 */
export interface SchemaAdaptationResult<TInput = unknown, TOutput = unknown> {
  readonly success: boolean;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly outputSchema: z.ZodSchema<TOutput>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * MCP tool integration options
 */
export interface ToolIntegrationOptions {
  readonly namePrefix?: string; // Prefix for framework tool names
  readonly categoryMapping?: Readonly<Record<string, string>>; // Map MCP categories to framework categories
  readonly enableParameterValidation?: boolean;
  readonly enableOutputValidation?: boolean;
  readonly autoRegister?: boolean; // Automatically register in framework registry
}

/**
 * MCP tool query for filtering
 */
export interface MCPToolQuery {
  readonly serverName?: string;
  readonly toolName?: string;
  readonly namePattern?: string;
  readonly category?: string;
  readonly isAvailable?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * MCP tool router entry
 */
export interface MCPToolRouterEntry {
  readonly frameworkName: string;
  readonly mcpToolName: string;
  readonly serverName: string;
  readonly catalogEntry: MCPToolCatalogEntry;
}

/**
 * MCP tool integration statistics
 */
export interface ToolIntegrationStats {
  readonly totalMCPTools: number;
  readonly registeredTools: number;
  readonly serverCount: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly lastDiscoveryTime?: Date;
  readonly lastIntegrationTime?: Date;
}

/**
 * Framework tool adapter interface for MCP tools
 */
export interface MCPFrameworkToolAdapter<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> 
  extends ToolInstance<TInput, TOutput, TLLMOutput> {
  readonly mcpToolName: string;
  readonly serverName: string;
  readonly catalogEntry: MCPToolCatalogEntry;
}

/**
 * Tool integration manager options
 */
export interface ToolIntegrationManagerOptions {
  readonly discovery?: ToolDiscoveryOptions;
  readonly integration?: ToolIntegrationOptions;
  readonly execution?: MCPToolExecutionOptions;
  readonly autoRefresh?: boolean;
  readonly refreshInterval?: number; // milliseconds
}

// Re-export relevant types from framework
export type {
  ToolMetadata,
  ToolSchemas,
  ToolInstance
} from '../../../tools/core/types/tool.js';

// Re-export relevant MCP types
export type {
  MCPTool
} from '../../core/types/framework.js';