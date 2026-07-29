/**
 * Tool Resolver for Agent System
 * 
 * Bridges the gap between agent tool configurations and LLM tool definitions
 * by automatically resolving tools from the tool registry.
 */

import type { ToolDefinition } from '../../llm/core/types/tools.js';
import { ToolRegistry } from '../../tools/core/tool-registry.js';
import { createToolDefinition } from '../../llm/core/types/tools.js';
import type { AgentToolConfig } from '../core/types.js';
import type { ToolRegistryEntry } from '../../tools/core/types/tool.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool resolution options
 */
export interface ToolResolutionOptions {
  /** Only include enabled tools */
  readonly enabledOnly?: boolean;
  /** Validate tool availability in registry */
  readonly validateRegistry?: boolean;
  /** Custom registry instance (defaults to singleton) */
  readonly registry?: ToolRegistry;
}

/**
 * Tool resolution result
 */
export interface ToolResolutionResult {
  /** Successfully resolved tool definitions */
  readonly definitions: readonly ToolDefinition[];
  /** Tools that were skipped (disabled) */
  readonly skipped: readonly string[];
  /** Tools that failed to resolve */
  readonly failed: readonly ToolResolutionError[];
  /** Summary statistics */
  readonly stats: {
    readonly total: number;
    readonly resolved: number;
    readonly skipped: number;
    readonly failed: number;
  };
}

/**
 * Tool resolution error
 */
export interface ToolResolutionError {
  readonly toolName: string;
  readonly reason: string;
  readonly error?: Error;
}

/**
 * Agent tool resolver
 */
export class AgentToolResolver {
  private readonly registry: ToolRegistry;

  constructor(registry?: ToolRegistry) {
    this.registry = registry || ToolRegistry.getInstance();
  }

  /**
   * Resolve agent tool configurations to LLM tool definitions
   */
  public resolveTools(
    toolConfigs: readonly AgentToolConfig[],
    options: ToolResolutionOptions = {}
  ): ToolResolutionResult {
    const resolved: ToolDefinition[] = [];
    const skipped: string[] = [];
    const failed: ToolResolutionError[] = [];

    for (const toolConfig of toolConfigs) {
      try {
        // Check if tool is enabled
        const isEnabled = toolConfig.enabled !== false; // Default to true
        
        if (options.enabledOnly && !isEnabled) {
          skipped.push(toolConfig.name);
          continue;
        }

        // Skip disabled tools
        if (!isEnabled) {
          skipped.push(toolConfig.name);
          continue;
        }

        // Validate registry availability if requested
        if (options.validateRegistry && !this.registry.hasTool(toolConfig.name)) {
          failed.push({
            toolName: toolConfig.name,
            reason: `Tool '${toolConfig.name}' not found in registry. Available tools: ${this.registry.getToolNames().join(', ')}`
          });
          continue;
        }

        // Attempt to resolve tool
        const toolDefinition = this.resolveSingleTool(toolConfig);
        if (toolDefinition) {
          resolved.push(toolDefinition);
        } else {
          failed.push({
            toolName: toolConfig.name,
            reason: `Failed to resolve tool '${toolConfig.name}'`
          });
        }

      } catch (error) {
        failed.push({
          toolName: toolConfig.name,
          reason: `Error resolving tool '${toolConfig.name}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    return {
      definitions: resolved,
      skipped,
      failed,
      stats: {
        total: toolConfigs.length,
        resolved: resolved.length,
        skipped: skipped.length,
        failed: failed.length
      }
    };
  }

  /**
   * Resolve a single tool configuration
   */
  private resolveSingleTool(toolConfig: AgentToolConfig): ToolDefinition | null {
    try {
      // Get tool from registry
      const registryEntry = this.registry.getTool(toolConfig.name);
      
      // Convert registry entry to LLM tool definition
      const toolDefinition = this.convertRegistryEntryToDefinition(registryEntry, toolConfig);
      
      return toolDefinition;
    } catch {
      // Tool not found or conversion failed
      return null;
    }
  }

  /**
   * Convert tool registry entry to LLM tool definition
   */
  private convertRegistryEntryToDefinition(
    registryEntry: ToolRegistryEntry,
    toolConfig: AgentToolConfig
  ): ToolDefinition {
    // Extract metadata and schemas from registry entry
    const metadata = registryEntry.metadata;
    const schemas = registryEntry.schemas;

    // Create LLM tool definition
    const definition = createToolDefinition(
      metadata.name,
      metadata.description,
      schemas.input, // Zod schema for input validation
      {
        metadata: {
          ...(metadata.category && { category: metadata.category }),
          ...(metadata.tags && { tags: metadata.tags }),
          ...(metadata.version && { version: metadata.version }),
          // Add any additional metadata from tool config
          ...(toolConfig.config && { config: toolConfig.config })
        }
      }
    );

    return definition;
  }

  /**
   * Validate tool configurations against registry
   */
  public validateToolConfigs(toolConfigs: readonly AgentToolConfig[]): {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const toolConfig of toolConfigs) {
      // Check if tool exists in registry
      if (!this.registry.hasTool(toolConfig.name)) {
        errors.push(`Tool '${toolConfig.name}' not found in registry. Available tools: ${this.registry.getToolNames().join(', ')}`);
        continue;
      }

      // Check if tool is disabled
      if (toolConfig.enabled === false) {
        warnings.push(`Tool '${toolConfig.name}' is disabled`);
      }

      // Additional validations could be added here
      // e.g., timeout validation, retry validation, etc.
      if (toolConfig.timeout !== undefined && toolConfig.timeout <= 0) {
        errors.push(`Tool '${toolConfig.name}' has invalid timeout: ${toolConfig.timeout}`);
      }

      if (toolConfig.retries !== undefined && (toolConfig.retries < 0 || toolConfig.retries > 10)) {
        errors.push(`Tool '${toolConfig.name}' has invalid retry count: ${toolConfig.retries}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get available tools from registry (convenience method)
   */
  public getAvailableTools(): readonly string[] {
    return this.registry.getToolNames();
  }

  /**
   * Check if a tool is available
   */
  public hasToolAvailable(toolName: string): boolean {
    return this.registry.hasTool(toolName);
  }

  /**
   * Get tool metadata from registry
   */
  public getToolMetadata(toolName: string): ToolRegistryEntry['metadata'] | null {
    try {
      const entry = this.registry.getTool(toolName);
      return entry.metadata;
    } catch {
      return null;
    }
  }
}

/**
 * Create a default tool resolver instance
 */
export function createToolResolver(registry?: ToolRegistry): AgentToolResolver {
  return new AgentToolResolver(registry);
}

/**
 * Convenience function to resolve tools directly
 */
export function resolveAgentTools(
  toolConfigs: readonly AgentToolConfig[],
  options: ToolResolutionOptions = {}
): ToolResolutionResult {
  const resolver = createToolResolver(options.registry);
  return resolver.resolveTools(toolConfigs, options);
}

/**
 * Convenience function to get just the tool definitions
 */
export function resolveToolDefinitions(
  toolConfigs: readonly { name: string; enabled: boolean; config: Record<string, unknown>; timeout?: number; metadata?: Record<string, unknown> }[],
  options: ToolResolutionOptions = {}
): ToolDefinition[] {
  const result = resolveAgentTools(toolConfigs, { 
    ...options, 
    enabledOnly: true 
  });
  
  // Log any failures for debugging
  if (result.failed.length > 0) {
    logger.warn('Tool resolution failures detected', {
      failedTools: result.failed,
      totalAttempted: toolConfigs.length,
      successfullyResolved: result.definitions.length
    });
  }
  
  return Array.from(result.definitions);
}