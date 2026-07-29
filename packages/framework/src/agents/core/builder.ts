/**
 * Agent Builder - Fluent API for Agent Configuration
 * 
 * Provides a convenient builder pattern for creating agents
 * with a fluent, discoverable API.
 */

import type { AgentConfig, LogLevel } from './config.js';
import { createDefaultAgentConfig, validateAndThrow } from './config.js';
import { Agent } from './agent.js';

// ============================================================================
// Agent Builder Class
// ============================================================================

/**
 * Fluent builder for agent configuration
 * 
 * Example usage:
 * ```typescript
 * const agent = new AgentBuilder()
 *   .model('vertex', 'gemini-2.5-pro')
 *   .temperature(0.7)
 *   .tools(['calculator', 'web_search'])
 *   .maxTurns(10)
 *   .build();
 * ```
 */
export class AgentBuilder {
  private config: AgentConfig;

  constructor(baseConfig?: Partial<AgentConfig>) {
    this.config = baseConfig ? { ...createDefaultAgentConfig(), ...baseConfig } : createDefaultAgentConfig();
  }

  // ============================================================================
  // Model Configuration
  // ============================================================================

  /**
   * Set Vertex provider with model and ADC authentication
   */
  public vertexModel(modelName: string, projectId: string, region: string = 'us-central1'): this {
    this.config = {
      ...this.config,
      model: {
        provider: {
          type: 'vertex',
          config: {
            auth: {
              type: 'adc',
              projectId,
              region,
            },
            apiVersion: 'v1',
            timeout: 30000,
            retries: 3,
            rateLimiting: true,
            enableLogging: true,
          }
        },
        defaultModel: modelName,
        features: {
          healthMonitoring: true,
          autoTemperature: true,
          enableLogging: true,
        }
      }
    };
    return this;
  }

  /**
   * Set LiteLLM provider with model and API key authentication
   */
  public litellmModel(modelName: string, apiKey: string, baseUrl?: string): this {
    this.config = {
      ...this.config,
      model: {
        provider: {
          type: 'litellm',
          config: {
            apiKey,
            ...(baseUrl && { baseUrl }),
            timeout: 30000,
            retries: 3,
            rateLimiting: true,
            enableLogging: false,
          }
        },
        defaultModel: modelName,
        features: {
          healthMonitoring: true,
          autoTemperature: false,
          enableLogging: true,
        }
      }
    };
    return this;
  }

  // region(), timeout(), retries() methods removed - these are now part of provider-specific config
  // Set these values in the withADC() or withApiKey() methods

  // ============================================================================
  // Tool Configuration
  // ============================================================================

  /**
   * Set enabled tools
   */
  public tools(toolNames: string[]): this {
    this.config = {
      ...this.config,
      tools: {
        ...this.config.tools,
        enabled: toolNames,
      }
    };
    return this;
  }

  /**
   * Add a single tool
   */
  public addTool(toolName: string, config?: Record<string, unknown>): this {
    const currentEnabled = this.config.tools.enabled;
    const newEnabled = currentEnabled.includes(toolName) 
      ? currentEnabled 
      : [...currentEnabled, toolName];
    
    this.config = {
      ...this.config,
      tools: {
        ...this.config.tools,
        enabled: newEnabled,
        config: config ? { ...this.config.tools.config, [toolName]: config } : this.config.tools.config,
      }
    };
    return this;
  }

  /**
   * Configure tool-specific settings
   */
  public toolConfig(toolName: string, config: Record<string, unknown>): this {
    this.config = {
      ...this.config,
      tools: {
        ...this.config.tools,
        config: { ...this.config.tools.config, [toolName]: config },
      }
    };
    return this;
  }

  // parallel() method removed - not implemented in orchestrator

  /**
   * Set tool execution timeout
   */
  public toolTimeout(milliseconds: number): this {
    this.config = {
      ...this.config,
      tools: {
        ...this.config.tools,
        execution: {
          ...this.config.tools.execution,
          timeout: milliseconds,
        }
      }
    };
    return this;
  }

  // toolRetries() method removed - not supported by ToolExecutor

  // ============================================================================
  // Execution Configuration
  // ============================================================================

  /**
   * Set maximum conversation turns
   */
  public maxTurns(count: number): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        maxTurns: count,
      }
    };
    return this;
  }

  /**
   * Set execution mode
   */
  public mode(mode: 'single' | 'continuous' | 'interactive'): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        mode: mode,
      }
    };
    return this;
  }

  /**
   * Set turn timeout
   */
  public turnTimeout(milliseconds: number): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        timeouts: {
          ...this.config.execution.timeouts,
          turn: milliseconds,
        }
      }
    };
    return this;
  }

  /**
   * Set LLM timeout
   */
  public llmTimeout(milliseconds: number): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        timeouts: {
          ...this.config.execution.timeouts,
          llm: milliseconds,
        }
      }
    };
    return this;
  }

  /**
   * Set execution limits
   */
  public limits(options: {
    toolsPerTurn?: number;
    requestsPerTurn?: number;
    messageLength?: number;
  }): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        limits: {
          ...this.config.execution.limits,
          ...(options.toolsPerTurn !== undefined && { toolsPerTurn: options.toolsPerTurn }),
          ...(options.requestsPerTurn !== undefined && { requestsPerTurn: options.requestsPerTurn }),
          ...(options.messageLength !== undefined && { messageLength: options.messageLength }),
        }
      }
    };
    return this;
  }

  /**
   * Configure error handling
   */
  public errorHandling(options: {
    continueOnToolError?: boolean;
    maxRetries?: number;
    retryDelay?: number;
  }): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        errorHandling: {
          ...this.config.execution.errorHandling,
          ...(options.continueOnToolError !== undefined && { continueOnToolError: options.continueOnToolError }),
          ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
          ...(options.retryDelay !== undefined && { retryDelay: options.retryDelay }),
        }
      }
    };
    return this;
  }

  // ============================================================================
  // Compacting Configuration
  // ============================================================================

  /**
   * Enable automatic conversation compacting
   */
  public enableCompacting(threshold: number = 95, systemPrompt?: string): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        compacting: {
          enabled: true,
          threshold,
          systemPrompt: systemPrompt || 'Summarize this conversation while preserving key context, decisions, and tool execution results. Focus on maintaining continuity for ongoing tasks.',
          contextMonitoring: {
            enabled: true,
            minThreshold: 70,
          },
        },
      }
    };
    return this;
  }

  /**
   * Disable automatic conversation compacting
   */
  public disableCompacting(): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        compacting: {
          enabled: false,
          threshold: this.config.execution.compacting?.threshold ?? 95,
          systemPrompt: this.config.execution.compacting?.systemPrompt ?? 'Summarize this conversation while preserving key context, decisions, and tool execution results. Focus on maintaining continuity for ongoing tasks.',
          contextMonitoring: this.config.execution.compacting?.contextMonitoring ?? {
            enabled: true,
            minThreshold: 70,
          },
        },
      }
    };
    return this;
  }

  /**
   * Configure compacting settings
   */
  public compacting(options: {
    enabled?: boolean;
    threshold?: number;
    systemPrompt?: string;
    contextMonitoring?: {
      enabled?: boolean;
      minThreshold?: number;
    };
  }): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        compacting: {
          enabled: options.enabled ?? true,
          threshold: options.threshold ?? 95,
          systemPrompt: options.systemPrompt ?? 'Summarize this conversation while preserving key context, decisions, and tool execution results. Focus on maintaining continuity for ongoing tasks.',
          contextMonitoring: {
            enabled: options.contextMonitoring?.enabled ?? true,
            minThreshold: options.contextMonitoring?.minThreshold ?? 70,
          },
        },
      }
    };
    return this;
  }

  /**
   * Enable context monitoring with custom threshold
   */
  public contextMonitoring(enabled: boolean = true, minThreshold: number = 70): this {
    this.config = {
      ...this.config,
      execution: {
        ...this.config.execution,
        compacting: {
          enabled: this.config.execution.compacting?.enabled ?? false,
          threshold: this.config.execution.compacting?.threshold ?? 95,
          systemPrompt: this.config.execution.compacting?.systemPrompt ?? 'Summarize this conversation while preserving key context, decisions, and tool execution results. Focus on maintaining continuity for ongoing tasks.',
          contextMonitoring: {
            enabled,
            minThreshold,
          },
        },
      }
    };
    return this;
  }

  // ============================================================================
  // Event Configuration
  // ============================================================================

  /**
   * Set logging level
   */
  public logging(level: LogLevel): this {
    this.config = {
      ...this.config,
      events: {
        ...this.config.events,
        logging: level,
      }
    };
    return this;
  }

  // ============================================================================
  // Metadata Configuration
  // ============================================================================

  /**
   * Set agent metadata
   */
  public metadata(metadata: {
    name?: string;
    version?: string;
    description?: string;
    tags?: string[];
  }): this {
    this.config = {
      ...this.config,
      metadata: {
        ...this.config.metadata,
        ...metadata,
      }
    };
    return this;
  }

  /**
   * Set agent name
   */
  public name(name: string): this {
    this.config = {
      ...this.config,
      metadata: {
        ...this.config.metadata,
        name,
      }
    };
    return this;
  }

  /**
   * Set agent description
   */
  public description(description: string): this {
    this.config = {
      ...this.config,
      metadata: {
        ...this.config.metadata,
        description,
      }
    };
    return this;
  }

  /**
   * Add tags
   */
  public tags(tags: string[]): this {
    this.config = {
      ...this.config,
      metadata: {
        ...this.config.metadata,
        tags,
      }
    };
    return this;
  }

  // ============================================================================
  // Build Methods
  // ============================================================================

  /**
   * Get the current configuration (without validation)
   */
  public getConfig(): AgentConfig {
    return this.config;
  }

  /**
   * Validate and get the configuration
   */
  public validateConfig(): AgentConfig {
    return validateAndThrow(this.config);
  }

  /**
   * Build and create the agent
   */
  public build(): Agent {
    return Agent.create(this.config);
  }

  /**
   * Clone the builder with current configuration
   */
  public clone(): AgentBuilder {
    return new AgentBuilder(structuredClone(this.config));
  }

  /**
   * Reset to default configuration
   */
  public reset(): this {
    this.config = createDefaultAgentConfig();
    return this;
  }
}

// ============================================================================
// Builder Factory Functions
// ============================================================================

/**
 * Create a new agent builder
 */
export function createAgentBuilder(baseConfig?: Partial<AgentConfig>): AgentBuilder {
  return new AgentBuilder(baseConfig);
}

/**
 * Create a builder with vertex provider preset
 */
export function createVertexAgentBuilder(projectId: string, region: string = 'us-east5'): AgentBuilder {
  return new AgentBuilder()
    .vertexModel('gemini-2.5-pro', projectId, region);
}

/**
 * Create a builder with LiteLLM provider preset
 */
export function createLiteLLMAgentBuilder(apiKey: string): AgentBuilder {
  return new AgentBuilder()
    .litellmModel('gpt-4', apiKey);
}

/**
 * Create a LiteLLM agent with OpenAI GPT-4
 */
export function createOpenAIAgent(apiKey: string): Agent {
  return new AgentBuilder()
    .litellmModel('gpt-4', apiKey)
    .tools(['calculator'])
    .maxTurns(10)
    .mode('continuous')
    .logging('info')
    .build();
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Create a basic conversational agent
 */
export function createBasicAgent(projectId: string): Agent {
  return new AgentBuilder()
    .vertexModel('gemini-2.5-pro', projectId)
    .maxTurns(10)
    .mode('continuous')
    .logging('info')
    .build();
}

/**
 * Create an agent with calculator and web search tools
 */
export function createToolAgent(projectId: string): Agent {
  return new AgentBuilder()
    .vertexModel('gemini-2.5-pro', projectId)
    .tools(['calculator', 'web_search'])
    .maxTurns(15)
    .mode('continuous')
    .logging('info')
    .build();
}

/**
 * Create a high-performance agent with optimized settings
 */
export function createPerformanceAgent(projectId: string): Agent {
  return new AgentBuilder()
    .vertexModel('gemini-2.5-flash', projectId)
    .tools(['calculator'])
    .maxTurns(20)
    .toolTimeout(5000)
    .mode('continuous')
    .logging('warn')
    .build();
}