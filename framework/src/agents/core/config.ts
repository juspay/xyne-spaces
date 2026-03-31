/**
 * Unified Agent Configuration System
 * 
 * Single source of truth for all agent behavior and settings.
 * Replaces all separate component configurations.
 */

import { z } from 'zod';
import type { ProviderConfiguration } from '../../llm/core/types/config.js';
import { VertexConfigSchema } from '../../llm/providers/vertex/schemas.js';
import { LiteLLMConfigSchema } from '../../llm/providers/litellm/schemas.js';
import type { ToolAuthorizationHook } from '../orchestrator/types.js';
import { COMPACTING_SYSTEM_PROMPT } from '../../utils/constants.js';

// ============================================================================
// Core Configuration Types
// ============================================================================

/**
 * Model configuration - aligned with LLM module's LLMClientConfig
 */
export interface ModelConfig {
  /** Provider configuration with type safety (vertex/litellm) */
  readonly provider: ProviderConfiguration;
  /** Default model name */
  readonly defaultModel: string;
  /** LLM client features */
  readonly features?: {
    readonly healthMonitoring?: boolean;
    readonly autoTemperature?: boolean;
    readonly enableLogging?: boolean;
    readonly thinkingMode?: boolean;
  };
  /** Manual temperature override (disables auto-temperature if set) */
  readonly temperature?: number;
  /** Maximum tokens for response generation */
  readonly maxTokens?: number;
  /** Token budget for thinking mode */
  readonly thinkingBudget?: number;
}

/**
 * Tool configuration - aligned with ToolExecutor capabilities
 */
export interface ToolConfig {
  /** Enabled tools by name */
  readonly enabled: readonly string[];
  /** Tool-specific configuration */
  readonly config: Record<string, unknown>;
  /** Tool execution settings - aligned with ToolExecutionOptions */
  readonly execution: {
    readonly timeout?: number;
    readonly metadata?: Record<string, unknown>;
  };
  /** MCP (Model Context Protocol) integration settings */
  readonly mcp?: {
    readonly localPath?: string;
    readonly globalPath?: string;
    readonly connectionTimeout?: number;
  };
}

/**
 * Execution configuration - replaces Orchestrator config
 */
export interface ExecutionConfig {
  /** Maximum conversation turns */
  readonly maxTurns: number;
  /** Execution mode */
  readonly mode: 'single' | 'continuous' | 'interactive';
  /** Timeout settings */
  readonly timeouts: {
    readonly turn?: number;
    readonly tool?: number;
    readonly llm?: number;
  };
  /** Execution limits */
  readonly limits: {
    readonly toolsPerTurn?: number;
    readonly requestsPerTurn?: number;
    readonly messageLength?: number;
  };
  /** Error handling */
  readonly errorHandling: {
    readonly continueOnToolError?: boolean;
    readonly maxRetries?: number;
    readonly retryDelay?: number;
    readonly maxDelay?: number;
  };
  /** Automatic conversation compacting settings */
  readonly compacting?: {
    readonly enabled: boolean;
    readonly threshold: number; // percentage (0-100) of context window to trigger compacting
    readonly systemPrompt: string;
    readonly contextMonitoring?: {
      readonly enabled: boolean;
      readonly minThreshold: number; // percentage to start monitoring context usage
    };
  };
  /** Tool authorization hook for approving/denying tool executions */
  readonly toolAuthorization?: ToolAuthorizationHook;
}

/**
 * Event configuration - only includes implemented features
 */
export interface EventConfig {
  /** Logging level - controls event emission */
  readonly logging: LogLevel;
}

/**
 * Logging levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

// ============================================================================
// Main Agent Configuration
// ============================================================================

/**
 * Complete agent configuration - SINGLE SOURCE OF TRUTH
 * 
 * This replaces:
 * - LLMClientConfig
 * - OrchestratorConfig  
 * - Tool configurations
 * - All separate component configs
 */
export interface AgentConfig {
  /** Model and provider settings */
  readonly model: ModelConfig;
  /** Tool selection and configuration */
  readonly tools: ToolConfig;
  /** Execution flow control */
  readonly execution: ExecutionConfig;
  /** Event and logging configuration */
  readonly events: EventConfig;
  /** Working directory for tool operations */
  readonly cwd?: string;
  /** Agent metadata */
  readonly metadata?: {
    readonly name?: string;
    readonly version?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
  };
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================


/**
 * Provider configuration schema - reuses existing LLM schemas
 */
const ProviderConfigurationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vertex'),
    config: VertexConfigSchema,
  }),
  z.object({
    type: z.literal('litellm'),
    config: LiteLLMConfigSchema,
  }),
]);

/**
 * Model configuration schema - aligned with LLMClientConfig
 */
export const ModelConfigSchema = z.object({
  provider: ProviderConfigurationSchema,
  defaultModel: z.string().min(1, 'Model name is required'),
  features: z.object({
    healthMonitoring: z.boolean().optional(),
    autoTemperature: z.boolean().optional(),
    enableLogging: z.boolean().optional(),
    thinkingMode: z.boolean().optional(),
  }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(200000).optional(),
  thinkingBudget: z.number().min(1).max(200000).optional(),
});

/**
 * Tool configuration schema - aligned with ToolExecutor capabilities
 */
export const ToolConfigSchema = z.object({
  enabled: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
  execution: z.object({
    timeout: z.number().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional().default({}),
  mcp: z.object({
    localPath: z.string().optional(),
    globalPath: z.string().optional(),
    connectionTimeout: z.number().positive().optional(),
  }).optional(),
});

/**
 * Execution configuration schema
 */
export const ExecutionConfigSchema = z.object({
  maxTurns: z.number().int().positive().max(10000),
  mode: z.enum(['single', 'continuous', 'interactive']).default('continuous'),
  timeouts: z.object({
    turn: z.number().positive().optional(),
    tool: z.number().positive().optional(),
    llm: z.number().positive().optional(),
  }).optional().default({}),
  limits: z.object({
    toolsPerTurn: z.number().int().positive().max(1000).optional(),
    requestsPerTurn: z.number().int().positive().max(10).optional(),
    messageLength: z.number().int().positive().optional(),
  }).optional().default({}),
  errorHandling: z.object({
    continueOnToolError: z.boolean().optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    retryDelay: z.number().positive().optional(),
    maxDelay: z.number().positive().optional(),
  }).optional().default({}),
  compacting: z.object({
    enabled: z.boolean().default(false),
    threshold: z.number().min(50).max(99).default(95),
    systemPrompt: z.string().min(1).default('Summarize this conversation while preserving key context, decisions, and tool execution results. Focus on maintaining continuity for ongoing tasks.'),
    contextMonitoring: z.object({
      enabled: z.boolean().default(true),
      minThreshold: z.number().min(0).max(90).default(0),
    }).optional().default({
      enabled: true,
      minThreshold: 70
    })
  }).optional(),
  toolAuthorization: z.function().optional()
});

/**
 * Event configuration schema - only implemented features
 */
export const EventConfigSchema = z.object({
  logging: z.enum(['debug', 'info', 'warn', 'error', 'off']).default('info'),
});

/**
 * Complete agent configuration schema
 */
export const AgentConfigSchema = z.object({
  model: ModelConfigSchema,
  tools: ToolConfigSchema,
  execution: ExecutionConfigSchema,
  events: EventConfigSchema,
  cwd: z.string().optional(),
  metadata: z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly config?: AgentConfig;
}

/**
 * Validate agent configuration with detailed error reporting
 */
export function validateAgentConfig(config: unknown): ConfigValidationResult {
  try {
    const result = AgentConfigSchema.safeParse(config);
    
    if (result.success) {
      const warnings: string[] = [];
      
      // Add configuration warnings
      if (result.data.tools.enabled.length === 0) {
        warnings.push('No tools enabled - agent will not be able to perform actions');
      }
      
      if (result.data.execution.maxTurns > 100) {
        warnings.push('High maxTurns value may lead to long execution times');
      }
      
      return {
        isValid: true,
        errors: [],
        warnings,
        config: result.data as AgentConfig,
      };
    }
    
    return {
      isValid: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
      warnings: [],
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [`Configuration validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      warnings: [],
    };
  }
}

// ============================================================================
// Configuration Derivation Helpers
// ============================================================================

// deriveModelClientConfig removed - no longer needed since ModelConfig directly matches LLMClientConfig

/**
 * Extract tool manager configuration from agent config
 */
export function deriveToolManagerConfig(agentConfig: AgentConfig): {
  enabledTools: readonly string[];
  toolConfig: Record<string, unknown>;
  executionConfig: {
    timeout?: number;
    metadata?: Record<string, unknown>;
  };
} {
  const { tools } = agentConfig;
  
  return {
    enabledTools: tools.enabled,
    toolConfig: tools.config,
    executionConfig: tools.execution,
  };
}

/**
 * Extract orchestrator execution configuration from agent config
 */
export function deriveExecutionConfig(agentConfig: AgentConfig): ExecutionConfig {
  const { execution } = agentConfig;
  
  return {
    maxTurns: execution.maxTurns,
    mode: execution.mode,
    timeouts: {
      turn: execution.timeouts.turn ?? 30000,
      tool: execution.timeouts.tool ?? 10000,
      llm: execution.timeouts.llm ?? 20000,
    },
    limits: {
      toolsPerTurn: execution.limits.toolsPerTurn ?? 5,
      requestsPerTurn: execution.limits.requestsPerTurn ?? 3,
      messageLength: execution.limits.messageLength ?? 10000,
    },
    errorHandling: {
      continueOnToolError: execution.errorHandling.continueOnToolError ?? true,
      maxRetries: execution.errorHandling.maxRetries ?? 3,
      retryDelay: execution.errorHandling.retryDelay ?? 1000,
    },
    // Include compacting configuration
    ...(execution.compacting && { compacting: execution.compacting }),
    // Include tool authorization hook
    ...(execution.toolAuthorization && { toolAuthorization: execution.toolAuthorization }),
  };
}

// ============================================================================
// Configuration Builders and Helpers
// ============================================================================

/**
 * Create a default agent configuration
 */
export function createDefaultAgentConfig(projectId?: string): AgentConfig {
  return {
    model: {
      provider: {
        type: 'vertex',
        config: {
          auth: {
            type: 'adc',
            projectId: projectId || process.env['GOOGLE_CLOUD_PROJECT'] || 'your-project-id',
            region: 'us-central1',
          },
          apiVersion: 'v1',
          timeout: 120000,
          retries: 5,
          rateLimiting: true,
          enableLogging: true,
        }
      },
      defaultModel: 'glm-46-fp8',
      maxTokens: 12000,
      features: {
        healthMonitoring: false, 
        autoTemperature: false,
        enableLogging: true,
        thinkingMode: true 
      },
      thinkingBudget: 4000 // Token budget for thinking mode
    },
    tools: {
      enabled: [],
      config: {},
      execution: {
        timeout: 600000,
        metadata: {},
      },
    },
    execution: {
      maxTurns: 10000,
      mode: 'continuous',
      timeouts: {
        turn: 3000000,
        tool: 3000000,
        llm: 300000,
      },
      limits: {
        toolsPerTurn: 1000, 
        requestsPerTurn: 5,
      },
      errorHandling: {
        continueOnToolError: true,
         maxRetries: 10,
        retryDelay: 5000
      },
      compacting: {
        enabled: true,
        threshold: 90, // Compact when conversation uses 90% of context window
        systemPrompt: COMPACTING_SYSTEM_PROMPT,
        contextMonitoring: {
          enabled: true,
          minThreshold: 0 // Start monitoring from 0% usage
        }
      },
    },
    events: {
      logging: 'info',
    },
  };
}

/**
 * Configuration error class
 */
export class AgentConfigError extends Error {
  constructor(
    message: string,
    public readonly errors: readonly string[],
    public readonly warnings: readonly string[] = []
  ) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

/**
 * Validate and throw on invalid configuration
 */
export function validateAndThrow(config: unknown): AgentConfig {
  const validation = validateAgentConfig(config);
  
  if (!validation.isValid) {
    throw new AgentConfigError(
      `Invalid agent configuration: ${validation.errors.join(', ')}`,
      validation.errors,
      validation.warnings
    );
  }
  
  return validation.config!;
}