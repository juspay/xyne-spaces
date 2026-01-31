/**
 * Component Factory Functions
 * 
 * Creates LLM, Tool, and Orchestrator components from unified AgentConfig.
 * Eliminates manual component creation and configuration duplication.
 */

import type { AgentConfig } from './config.js';
import { deriveExecutionConfig } from './config.js';
import { LLMClient } from '../../llm/client/llm-client.js';
import { ToolExecutor } from '../../tools/core/tool-executor.js';
import { resolveToolDefinitions } from '../tools/resolver.js';
import type { LLMClientConfig } from '../../llm/core/types/config.js';
import type { ToolDefinition } from '../../llm/core/types/tools.js';

// ============================================================================
// Component Factory Functions
// ============================================================================

/**
 * Create LLM client from agent configuration
 */
export function createModelClient(agentConfig: AgentConfig): LLMClient {
  // Agent ModelConfig now directly matches LLMClientConfig structure
  const llmConfig: LLMClientConfig = {
    provider: agentConfig.model.provider,
    defaultModel: agentConfig.model.defaultModel,
    ...(agentConfig.model.features && { features: agentConfig.model.features }),
    ...(agentConfig.model.temperature !== undefined && { temperature: agentConfig.model.temperature }),
    ...(agentConfig.model.maxTokens !== undefined && { maxTokens: agentConfig.model.maxTokens }),
    ...(agentConfig.model.thinkingBudget !== undefined && { thinkingBudget: agentConfig.model.thinkingBudget }),
    retry: {
      maxAttempts: agentConfig.execution.errorHandling.maxRetries,
      baseDelay: agentConfig.execution.errorHandling.retryDelay,
      maxDelay: 30000, // 30 seconds max delay
      exponentialBackoff: true
    }
  };
  
  return new LLMClient(llmConfig);
}

/**
 * Create tool manager from agent configuration  
 */
export function createToolManager(agentConfig: AgentConfig): ToolExecutor {
  // Create tool executor (uses existing tool registry)
  const toolExecutor = new ToolExecutor();
  
  // Configure working directory if specified in agent config
  if (agentConfig.cwd) {
    toolExecutor.setCwd(agentConfig.cwd);
  }
  
  // Tool configuration is handled via tool resolution
  // when tools are actually needed
  
  return toolExecutor;
}

/**
 * Resolve tool definitions from agent configuration
 */
export function resolveTools(agentConfig: AgentConfig): ToolDefinition[] {
  // Convert agent tool config to tool registry format
  const toolConfigs = agentConfig.tools.enabled.map(toolName => ({
    name: toolName,
    enabled: true,
    config: agentConfig.tools.config, // Shared config for all tools
    ...(agentConfig.tools.execution.timeout !== undefined && { 
      timeout: agentConfig.tools.execution.timeout 
    }),
    ...(agentConfig.tools.execution.metadata && { 
      metadata: agentConfig.tools.execution.metadata 
    }),
  }));
  
  // Use existing tool resolver
  return resolveToolDefinitions(toolConfigs);
}

/**
 * Create execution configuration from agent config
 */
export function createExecutionConfig(agentConfig: AgentConfig): ReturnType<typeof deriveExecutionConfig> {
  return deriveExecutionConfig(agentConfig);
}

// ============================================================================
// Factory Utilities
// ============================================================================

/**
 * Factory error class
 */
export class FactoryError extends Error {
  public readonly component: string;
  public readonly cause?: Error;
  
  constructor(
    message: string,
    component: string,
    cause?: Error
  ) {
    super(message);
    this.name = 'FactoryError';
    this.component = component;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Safe factory wrapper with error handling
 */
export function safeFactory<T>(
  factoryFn: () => T,
  componentName: string
): T {
  try {
    return factoryFn();
  } catch (error) {
    throw new FactoryError(
      `Failed to create ${componentName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      componentName,
      error instanceof Error ? error : undefined
    );
  }
}