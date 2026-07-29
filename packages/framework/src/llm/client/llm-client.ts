import type {
  LLMRequest,
  LLMResponse,
  LLMStreamResult,
  ModelCapabilities,
  ProviderModel,
  Message,
  ToolDefinition,
  LLMProvider
} from '../core/types/index.js';
import type { ModelHealthStatus } from '../core/types/health.js';
import type { LLMClientConfig } from '../core/types/config.js';
import { createProvider } from '../core/factory/provider-factory.js';
import { createStreamWithAccumulation } from '../features/streaming/stream-accumulator.js';
import { validateLLMRequest, createLLMRequest } from '../core/types/requests.js';
import { createTemperatureManager } from '../features/thinking/temperature-manager.js';
import type { TemperatureManager, TemperatureConfig, TaskDetectionResult } from '../features/thinking/temperature-manager.js';
import { createHealthMonitor } from '../features/health/health-monitor.js';
import type { HealthMonitor, ModelAvailability, HealthEventListener } from '../features/health/health-monitor.js';
import { logger } from '../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderValidationError,
  createProviderExecutionError,
  isRetryableError,
  getRetryAfter
} from '../core/errors/index.js';

// Export the config type from core types
export type { LLMClientConfig } from '../core/types/config.js';

/**
 * High-level LLM client interface
 * Provides simplified API for LLM interactions with provider abstraction
 */
export class LLMClient {
  private readonly currentProvider: LLMProvider;
  private readonly config: LLMClientConfig;
  private readonly enabledFeatures: Required<NonNullable<LLMClientConfig['features']>>;
  private readonly temperatureManager: TemperatureManager;
  private readonly healthMonitor: HealthMonitor;

  public constructor(config: LLMClientConfig) {
    this.config = config;
    this.enabledFeatures = {
      healthMonitoring: false, // Force disabled to prevent continuous API calls
      autoTemperature: config.features?.autoTemperature ?? true,
      enableLogging: config.features?.enableLogging ?? true,
      thinkingMode: config.features?.thinkingMode ?? false
    };

    // Initialize provider using factory
    this.currentProvider = createProvider(config.provider);

    // Initialize temperature manager
    this.temperatureManager = createTemperatureManager();

    // Initialize health monitor
    this.healthMonitor = createHealthMonitor({
      enableBackgroundChecks: this.enabledFeatures.healthMonitoring
    });

    // Register current provider with health monitor
    if (this.enabledFeatures.healthMonitoring) {
      this.healthMonitor.registerProvider(this.currentProvider);
      this.healthMonitor.startBackgroundMonitoring();
    }

    logger.info('LLM client initialized', {
      provider: config.provider.type,
      defaultModel: config.defaultModel,
      features: this.enabledFeatures
    });
  }

  /**
   * Generate LLM response
   */
  public async generate(options: {
    readonly messages: readonly Message[];
    readonly systemPrompt?: string;
    readonly model?: string;
    readonly tools?: readonly ToolDefinition[];
    readonly parameters?: {
      readonly temperature?: number;
      readonly maxTokens?: number;
      readonly topP?: number;
      readonly topK?: number;
    };
    readonly features?: {
      readonly thinkingMode?: boolean;
      readonly autoTemperature?: boolean;
    };
    readonly extraBody?: Record<string, unknown>;
    readonly abortSignal?: AbortSignal;
  }): Promise<LLMResponse> {
    try {
      // Check for abort signal early
      if (options.abortSignal?.aborted) {
        throw new LLMErrorClass(createProviderExecutionError(
          this.config.provider.type,
          'Request was aborted before LLM generation could begin',
          false
        ));
      }

      // Build request
      const request = this.buildRequest(options);

      // Validate request
      const validationErrors = validateLLMRequest(request);
      if (validationErrors.length > 0) {
        throw new LLMErrorClass(createProviderValidationError(
          this.config.provider.type,
          validationErrors
        ));
      }

      // Check abort signal again after validation
      if (options.abortSignal?.aborted) {
        throw new LLMErrorClass(createProviderExecutionError(
          this.config.provider.type,
          'Request was aborted during validation',
          false
        ));
      }

      // Log request if enabled
      if (this.enabledFeatures.enableLogging) {
        logger.debug('LLM generation request', {
          model: request.model,
          provider: request.provider,
          messageCount: request.messages.length,
          hasSystemPrompt: !!request.systemPrompt,
          systemPromptLength: request.systemPrompt?.length || 0,
          systemPromptPreview: request.systemPrompt ? request.systemPrompt.substring(0, 100) + '...' : 'none',
          hasTools: !!(request.tools && request.tools.length > 0),
          features: request.features
        });
      }

      // Generate response with retry logic
      const response = await this.executeWithRetry(
        () => this.currentProvider.generate(request, options.abortSignal),
        'LLM generation',
        options.abortSignal
      );

      // Log response if enabled
      if (this.enabledFeatures.enableLogging) {
        logger.debug('LLM generation completed', {
          model: response.model,
          contentLength: response.content.length,
          thinkingLength: response.thinking?.length || 0,
          toolCallsCount: response.toolCalls?.length || 0,
          usage: response.usage,
          latency: response.latency
        });
      }

      return response;

    } catch (error) {
      logger.error('LLM generation failed', error as Error, {
        model: options.model || this.config.defaultModel,
        messageCount: options.messages.length
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.config.provider.type,
        error instanceof Error ? error.message : 'Unknown error during generation',
        true
      ));
    }
  }

  /**
   * Generate streaming LLM response with accumulation
   */

  public async generateStream(options: {
    readonly messages: readonly Message[];
    readonly systemPrompt?: string;
    readonly model?: string;
    readonly tools?: readonly ToolDefinition[];
    readonly parameters?: {
      readonly temperature?: number;
      readonly maxTokens?: number;
      readonly topP?: number;
      readonly topK?: number;
    };
    readonly features?: {
      readonly thinkingMode?: boolean;
      readonly includeThinking?: boolean;
      readonly autoTemperature?: boolean;
    };
    readonly extraBody?: Record<string, unknown>;
    readonly abortSignal?: AbortSignal;
  }): Promise<LLMStreamResult> {
    try {
      // Check for abort signal early
      if (options.abortSignal?.aborted) {
        throw new LLMErrorClass(createProviderExecutionError(
          this.config.provider.type,
          'Streaming request was aborted before generation could begin',
          false
        ));
      }

      // Build request with streaming enabled
      const request = this.buildRequest({
        ...options,
        features: {
          ...options.features,
          streaming: true
        }
      });

      // Validate request
      const validationErrors = validateLLMRequest(request);
      if (validationErrors.length > 0) {
        throw new LLMErrorClass(createProviderValidationError(
          this.config.provider.type,
          validationErrors
        ));
      }

      // Log streaming request if enabled
      if (this.enabledFeatures.enableLogging) {
        logger.debug('LLM streaming request', {
          model: request.model,
          messageCount: request.messages.length,
          includeThinking: request.features?.thinking?.includeThoughts
        });
      }

      // Generate streaming response with retry logic
      const providerStream = await this.executeWithRetry(
        () => Promise.resolve(this.currentProvider.generateStream(request, options.abortSignal)),
        'LLM streaming',
        options.abortSignal
      );

      // Create stream with accumulation
      const streamResult = createStreamWithAccumulation(providerStream);

      return {
        stream: streamResult.stream,
        finalMessage: streamResult.finalMessage,
        metadata: {
          requestId: `stream-${Date.now()}`,
          provider: this.config.provider.type,
          model: request.model,
          startTime: new Date()
        }
      };

    } catch (error) {
      logger.error('LLM streaming failed', error as Error, {
        model: options.model || this.config.defaultModel,
        messageCount: options.messages.length
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.config.provider.type,
        error instanceof Error ? error.message : 'Unknown error during streaming',
        true
      ));
    }
  }

  /**
   * Check health of a specific model
   */
  public async checkHealth(model?: string): Promise<ModelHealthStatus> {
    const targetModel = model || this.config.defaultModel;
    
    if (!this.enabledFeatures.healthMonitoring) {
      logger.warn('Health monitoring is disabled, returning unknown status');
      return {
        provider: this.config.provider.type,
        model: targetModel,
        status: 'unknown',
        latency: 0,
        lastChecked: new Date()
      };
    }

    // Use health monitor for comprehensive health checking
    const result = await this.healthMonitor.checkModelHealth(this.config.provider.type, targetModel);
    return {
      provider: result.provider,
      model: result.model,
      status: result.status,
      latency: result.latency,
      lastChecked: result.lastChecked,
      ...(result.error && { error: result.error }),
      metadata: {
        ...result.metadata,
        ...(result.checkId && { checkId: result.checkId }),
        attempts: result.attempts
      }
    };
  }

  /**
   * Get availability status for all monitored models
   */
  public getModelAvailability(): readonly ModelAvailability[] {
    if (!this.enabledFeatures.healthMonitoring) {
      return [];
    }
    return this.healthMonitor.getAvailabilityStatus();
  }

  /**
   * Get health metrics for a specific model
   */
  public getHealthMetrics(model?: string): ReturnType<HealthMonitor['getHealthMetrics']> {
    const targetModel = model || this.config.defaultModel;
    
    if (!this.enabledFeatures.healthMonitoring) {
      return undefined;
    }
    
    return this.healthMonitor.getHealthMetrics(this.config.provider.type, targetModel);
  }

  /**
   * List available models
   */
  public async listModels(): Promise<readonly ProviderModel[]> {
    return await this.currentProvider.listModels();
  }

  /**
   * Get model capabilities
   */
  public getModelCapabilities(model?: string): ModelCapabilities | undefined {
    const targetModel = model || this.config.defaultModel;
    return this.currentProvider.getModelCapabilities(targetModel);
  }

  /**
   * Check if provider supports a feature
   */
  public supportsFeature(feature: 'toolCalling' | 'streaming' | 'thinking'): boolean {
    switch (feature) {
      case 'toolCalling':
        return this.currentProvider.supportsToolCalling();
      case 'streaming':
        return this.currentProvider.supportsStreaming();
      case 'thinking':
        return this.currentProvider.supportsThinking();
      default:
        return false;
    }
  }

  /**
   * Switch to a different model (if supported)
   */
  public switchModel(model: string): void {
    const capabilities = this.currentProvider.getModelCapabilities(model);
    if (!capabilities) {
      throw new LLMErrorClass(createProviderValidationError(
        this.config.provider.type,
        [`Model ${model} is not supported by provider ${this.config.provider.type}`]
      ));
    }

    // Update default model in config
    (this.config as { defaultModel: string }).defaultModel = model;

    logger.info('Switched to model', { 
      provider: this.config.provider.type,
      model 
    });
  }

  /**
   * Get current configuration
   */
  public getConfig(): Readonly<LLMClientConfig> {
    return { ...this.config };
  }

  /**
   * Analyze task type and get temperature recommendations
   */
  public analyzeTask(
    messages: readonly Message[],
    tools?: readonly ToolDefinition[],
    features?: { readonly thinkingMode?: boolean }
  ): {
    readonly taskDetection: TaskDetectionResult;
    readonly scenarioRecommendations: Record<string, { temperature: number; reasoning: string }>;
    readonly currentConfig: TemperatureConfig;
  } {
    const detection = this.temperatureManager.detectTaskAndTemperature(messages, tools, features);
    const scenarios = this.temperatureManager.getScenarioRecommendations();
    
    return {
      taskDetection: detection,
      scenarioRecommendations: scenarios,
      currentConfig: this.temperatureManager.getConfig()
    };
  }

  /**
   * Update temperature configuration
   */
  public updateTemperatureConfig(updates: Partial<TemperatureConfig>): void {
    this.temperatureManager.updateConfig(updates);
    logger.info('Temperature configuration updated', { updates });
  }

  /**
   * Add health event listener
   */
  public addHealthEventListener(listener: HealthEventListener): void {
    if (this.enabledFeatures.healthMonitoring) {
      this.healthMonitor.addEventListener(listener);
    }
  }

  /**
   * Remove health event listener
   */
  public removeHealthEventListener(listener: HealthEventListener): void {
    if (this.enabledFeatures.healthMonitoring) {
      this.healthMonitor.removeEventListener(listener);
    }
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    if (this.enabledFeatures.healthMonitoring) {
      this.healthMonitor.dispose();
    }
    logger.info('LLM client disposed');
  }

  /**
   * Authenticate with the current provider
   */
  public async authenticate(): Promise<void> {
    await this.currentProvider.authenticate();
  }

  /**
   * Check if currently authenticated
   */
  public isAuthenticated(): boolean {
    return this.currentProvider.isAuthenticated();
  }

  /**
   * Count tokens in message array using provider-specific counter
   */
  public async countTokens(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number, model?: string): Promise<number> {
    const targetModel = model || this.config.defaultModel;
    return await this.currentProvider.countTokens(messages, targetModel, tools, maxTokens);
  }

  /**
   * Get context window size for a model
   */
  public getContextWindow(model?: string): number {
    const targetModel = model || this.config.defaultModel;
    return this.currentProvider.getContextWindow(targetModel);
  }

  /**
   * Check if native token counting is supported for a model
   */
  public supportsTokenCounting(model?: string): boolean {
    const targetModel = model || this.config.defaultModel;
    return this.currentProvider.supportsTokenCounting(targetModel);
  }

  /**
   * Calculate what percentage of context window is used by messages
   */
  public async getTokenUsagePercentage(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number, model?: string): Promise<number> {
    const targetModel = model || this.config.defaultModel;
    const tokenCount = await this.countTokens(messages, tools, maxTokens, targetModel);
    const contextWindow = this.getContextWindow(targetModel);
    return (tokenCount / contextWindow) * 100;
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'LLM operation',
    abortSignal?: AbortSignal
  ): Promise<T> {
    const retryConfig = {
      maxAttempts: this.config.retry?.maxAttempts ?? 3,
      baseDelay: this.config.retry?.baseDelay ?? 5000,
      maxDelay: this.config.retry?.maxDelay ?? 30000,
      exponentialBackoff: this.config.retry?.exponentialBackoff ?? true
    };
    
    let lastError: LLMErrorClass | undefined;
    
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        // Check if aborted before attempt
        if (abortSignal?.aborted) {
          throw new LLMErrorClass(createProviderExecutionError(
            this.config.provider.type,
            'Request was aborted before retry attempt',
            false
          ));
        }

        return await operation();
        
      } catch (error) {
        lastError = error instanceof LLMErrorClass ? error : 
          new LLMErrorClass(createProviderExecutionError(
            this.config.provider.type,
            error instanceof Error ? error.message : 'Unknown error',
            true
          ));

        // Don't retry on last attempt or non-retryable errors
        if (attempt === retryConfig.maxAttempts || !isRetryableError(lastError.llmError)) {
          if (this.enabledFeatures.enableLogging) {
            logger.debug(`${operationName} failed - no retry`, {
              attempt,
              maxAttempts: retryConfig.maxAttempts,
              retryable: isRetryableError(lastError.llmError),
              error: lastError.message
            });
          }
          break;
        }

        // Calculate delay
        const retryAfter = getRetryAfter(lastError.llmError);
        let delay: number;
        
        if (retryAfter) {
          // Use server-provided retry-after header (convert to ms and cap)
          delay = Math.min(retryAfter * 1000, retryConfig.maxDelay);
        } else if (retryConfig.exponentialBackoff) {
          // Exponential backoff: 5, 10, 20s
          delay = Math.min(retryConfig.baseDelay * Math.pow(2, attempt - 1), retryConfig.maxDelay);
        } else {
          // Fixed delay
          delay = retryConfig.baseDelay;
        }

        if (this.enabledFeatures.enableLogging) {
          logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
            attempt,
            maxAttempts: retryConfig.maxAttempts,
            provider: this.config.provider.type,
            error: lastError.message,
            delay,
            retryAfter
          });
        }

        // Wait before retry (respect abort signal)
        await this.delayWithAbort(delay, abortSignal);
      }
    }

    // This should never happen since we always set lastError in catch block
    throw lastError || new LLMErrorClass(createProviderExecutionError(
      this.config.provider.type,
      'Unknown error during retry execution',
      false
    ));
  }

  /**
   * Delay with abort signal support
   */
  private async delayWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      
      if (abortSignal) {
        const abortHandler = (): void => {
          clearTimeout(timeout);
          reject(new LLMErrorClass(createProviderExecutionError(
            this.config.provider.type,
            'Request was aborted during retry delay',
            false
          )));
        };

        if (abortSignal.aborted) {
          clearTimeout(timeout);
          abortHandler();
          return;
        }

        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

  /**
   * Private helper methods
   */
  private buildRequest(options: {
    readonly messages: readonly Message[];
    readonly systemPrompt?: string;
    readonly model?: string;
    readonly tools?: readonly ToolDefinition[];
    readonly parameters?: {
      readonly temperature?: number;
      readonly maxTokens?: number;
      readonly topP?: number;
      readonly topK?: number;
    };
    readonly features?: {
      readonly streaming?: boolean;
      readonly thinkingMode?: boolean;
      readonly includeThinking?: boolean;
      readonly autoTemperature?: boolean;
    };
    readonly extraBody?: Record<string, unknown>;
  }): LLMRequest {
    const model = options.model || this.config.defaultModel;
    
    // Log system prompt handling
    if (this.enabledFeatures.enableLogging) {
      logger.debug('Building LLM request - system prompt check', {
        hasSystemPromptInOptions: !!options.systemPrompt,
        systemPromptLength: options.systemPrompt?.length || 0,
        systemPromptPreview: options.systemPrompt ? options.systemPrompt.substring(0, 50) + '...' : 'none'
      });
    }
    
    // Determine thinking mode: config override < request parameter
    const thinkingModeRequested = options.features?.thinkingMode ?? this.config.features?.thinkingMode;
    const modelSupportsThinking = this.currentProvider.supportsThinking() && 
                                   this.currentProvider.getModelCapabilities(model)?.supportsThinking;
    const thinkingMode = thinkingModeRequested && modelSupportsThinking;

    // Debug logging for thinking mode decisions
    if (thinkingModeRequested && !modelSupportsThinking) {
      logger.warn('Thinking mode requested but model does not support it', {
        model,
        providerSupportsThinking: this.currentProvider.supportsThinking(),
        modelSupportsThinking: this.currentProvider.getModelCapabilities(model)?.supportsThinking,
        thinkingModeRequested,
        finalThinkingMode: thinkingMode
      });
    }

    // Determine temperature: if thinking mode is enabled, temperature should be undefined
    let temperature: number | undefined;
    if (thinkingMode) {
      // When thinking mode is enabled, temperature should be undefined
      temperature = undefined;
    } else if (this.config.temperature !== undefined) {
      // Use client config temperature (manual override)
      temperature = this.config.temperature;
    } else if (options.parameters?.temperature !== undefined) {
      // Use request-specific temperature
      temperature = options.parameters.temperature;
    } else if (this.enabledFeatures.autoTemperature && options.features?.autoTemperature !== false) {
      // Use auto-calculated temperature
      temperature = this.calculateAutoTemperature(options);
    }

    return createLLMRequest(
      options.messages,
      model,
      this.config.provider.type,
      {
        ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
        ...(options.tools && { tools: options.tools }),
        parameters: {
          ...options.parameters,
          ...(temperature !== undefined && { temperature }),
          ...(this.config.maxTokens !== undefined && { maxTokens: this.config.maxTokens })
        },
        features: {
          streaming: options.features?.streaming || false,
          ...(thinkingMode && { 
            thinking: {
              enabled: true,
              budgetTokens: this.config.thinkingBudget ?? 20000, // Use configured budget or default
              includeThoughts: options.features?.includeThinking ?? true
            }
          }),
          autoTemperature: this.enabledFeatures.autoTemperature && this.config.temperature === undefined
        },
        ...(options.extraBody && { extraBody: options.extraBody })
      }
    );
  }

  private calculateAutoTemperature(options: {
    readonly messages: readonly Message[];
    readonly tools?: readonly ToolDefinition[];
    readonly features?: {
      readonly thinkingMode?: boolean;
    };
  }): number {
    // Use advanced temperature manager for sophisticated task detection
    const detection = this.temperatureManager.detectTaskAndTemperature(
      options.messages,
      options.tools,
      options.features
    );

    if (this.enabledFeatures.enableLogging) {
      logger.debug('Auto-temperature calculation', {
        taskType: detection.taskType,
        confidence: detection.confidence,
        suggestedTemperature: detection.suggestedTemperature,
        enableThinking: detection.enableThinking,
        reasoning: detection.reasoning
      });
    }

    return detection.suggestedTemperature;
  }

}