import { v4 as uuidv4 } from 'uuid';
import type {
  LLMProvider,
  ProviderModel,
  ProviderConfig,
  ProviderExecutionContext
} from '../types/providers.js';
import type {
  LLMRequest,
  LLMResponse,
  ModelCapabilities
} from '../types/requests.js';
import type { StreamChunk } from '../types/streaming.js';
import type { ModelHealthStatus, PingResult } from '../types/health.js';
import { logger } from '../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderExecutionError,
  createProviderValidationError,
  isLLMErrorClass
} from '../errors/index.js';
import { ToolDefinition } from '../types/tools.js';

/**
 * Abstract base class for all LLM providers
 * Follows the same pattern as BaseTool
 */
export abstract class BaseProvider implements LLMProvider {
  protected abstract readonly providerName: string;
  protected abstract readonly supportedModelIds: readonly string[];
  protected abstract readonly providerConfig: ProviderConfig;
  
  public get name(): string {
    return this.providerName;
  }
  
  public get supportedModels(): readonly string[] {
    return this.supportedModelIds;
  }

  /**
   * Generate LLM response with comprehensive error handling and validation
   */
  public async generate(request: LLMRequest, abortSignal?: AbortSignal): Promise<LLMResponse> {
    const executionId = uuidv4();
    const startTime = new Date();
    
    const context: ProviderExecutionContext = {
      requestId: executionId,
      provider: this.providerName,
      model: request.model,
      startTime
    };

    logger.debug('Provider execution started', {
      provider: this.providerName,
      model: request.model,
      executionId
    });

    try {
      // Validate request
      this.validateRequest(request);
      
      // Ensure authentication
      await this.ensureAuthenticated();
      
      // Execute the generation
      const result = await this.generateInternal(request, context, abortSignal);
      
      const endTime = new Date();
      const latency = endTime.getTime() - startTime.getTime();
      
      logger.debug('Provider execution completed successfully', {
        provider: this.providerName,
        model: request.model,
        executionId,
        latency
      });

      return {
        ...result,
        latency
      };

    } catch (error) {
      const endTime = new Date();
      const latency = endTime.getTime() - startTime.getTime();
      
      logger.error('Provider execution failed', error as Error, {
        provider: this.providerName,
        model: request.model,
        executionId,
        latency
      });

      if (isLLMErrorClass(error)) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.providerName,
        error instanceof Error ? error.message : 'Unknown error occurred',
        true,
        {
          model: request.model,
          executionId,
          context: { latency }
        }
      ));
    }
  }

  /**
   * Generate streaming LLM response with error handling
   */
  public async *generateStream(request: LLMRequest, abortSignal?: AbortSignal): AsyncIterable<StreamChunk> {
    const executionId = uuidv4();
    const startTime = new Date();
    
    const context: ProviderExecutionContext = {
      requestId: executionId,
      provider: this.providerName,
      model: request.model,
      startTime
    };

    logger.debug('Provider streaming started', {
      provider: this.providerName,
      model: request.model,
      executionId
    });

    try {
      // Validate request
      this.validateRequest(request);
      
      // Ensure authentication
      await this.ensureAuthenticated();
      
      // Stream generation
      yield* this.generateStreamInternal(request, context, abortSignal);
      
      logger.debug('Provider streaming completed', {
        provider: this.providerName,
        model: request.model,
        executionId
      });

    } catch (error) {
      logger.error('Provider streaming failed', error as Error, {
        provider: this.providerName,
        model: request.model,
        executionId
      });

      if (isLLMErrorClass(error)) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.providerName,
        error instanceof Error ? error.message : 'Unknown streaming error occurred',
        true,
        {
          model: request.model,
          executionId
        }
      ));
    }
  }

  /**
   * Abstract methods to be implemented by concrete providers
   */
  protected abstract generateInternal(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): Promise<LLMResponse>;

  protected abstract generateStreamInternal(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): AsyncIterable<StreamChunk>;

  public abstract authenticate(): Promise<void>;
  public abstract isAuthenticated(): boolean;
  public abstract listModels(): Promise<readonly ProviderModel[]>;
  public abstract ping(model: string): Promise<PingResult>;
  public abstract getHealth(model: string): Promise<ModelHealthStatus>;
  public abstract supportsToolCalling(): boolean;
  public abstract supportsStreaming(): boolean;
  public abstract supportsThinking(): boolean;
  public abstract getModelCapabilities(model: string): ModelCapabilities | undefined;
  public abstract validateConfig(config: unknown): boolean;
  public abstract updateConfig(config: unknown): void;

  /**
   * Get current provider configuration
   */
  public getConfig(): ProviderConfig {
    return { ...this.providerConfig };
  }

  /**
   * Validate LLM request
   */
  protected validateRequest(request: LLMRequest): void {
    const errors: string[] = [];

    // Basic validation
    if (!request.messages || request.messages.length === 0) {
      errors.push('Messages array cannot be empty');
    }

    if (!request.model || request.model.trim() === '') {
      errors.push('Model name is required');
    }

    if (request.provider !== this.providerName) {
      errors.push(`Provider mismatch: expected ${this.providerName}, got ${request.provider}`);
    }

    // Check if model is supported
    if (!this.supportedModelIds.includes(request.model)) {
      errors.push(`Model ${request.model} is not supported by provider ${this.providerName}`);
    }

    // Parameter validation
    if (request.parameters?.temperature !== undefined) {
      if (request.parameters.temperature < 0 || request.parameters.temperature > 2) {
        errors.push('Temperature must be between 0 and 2');
      }
    }

    if (request.parameters?.maxTokens !== undefined) {
      if (request.parameters.maxTokens < 1) {
        errors.push('maxTokens must be positive');
      }
    }

    if (request.parameters?.topP !== undefined) {
      if (request.parameters.topP < 0 || request.parameters.topP > 1) {
        errors.push('topP must be between 0 and 1');
      }
    }

    // Custom provider validation
    const customErrors = this.validateRequestCustom(request);
    errors.push(...customErrors);

    if (errors.length > 0) {
      throw new LLMErrorClass(createProviderValidationError(
        this.providerName,
        errors
      ));
    }
  }

  /**
   * Custom validation to be overridden by concrete providers
   */
  protected validateRequestCustom(_request: LLMRequest): string[] {
    return [];
  }

  /**
   * Ensure provider is authenticated
   */
  protected async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated()) {
      logger.debug('Provider not authenticated, attempting authentication', {
        provider: this.providerName
      });
      await this.authenticate();
    }
  }

  /**
   * Check if model is supported
   */
  protected isModelSupported(model: string): boolean {
    return this.supportedModelIds.includes(model);
  }

  /**
   * Get execution metadata for responses
   */
  protected createExecutionMetadata(
    context: ProviderExecutionContext,
    additionalData?: Record<string, unknown>
  ): Record<string, unknown> {
    const endTime = new Date();
    const processingTime = endTime.getTime() - context.startTime.getTime();

    return {
      requestId: context.requestId,
      provider: this.providerName,
      model: context.model,
      timestamp: endTime,
      processingTime,
      ...additionalData
    };
  }

  /**
   * Utility method for error handling in concrete providers
   */
  protected handleProviderError(
    error: unknown,
    context: ProviderExecutionContext,
    operation: string = 'operation'
  ): never {
    if (isLLMErrorClass(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : `Unknown error during ${operation}`;
    
    throw new LLMErrorClass(createProviderExecutionError(
      this.providerName,
      message,
      true,
      {
        model: context.model,
        executionId: context.requestId,
        context: { operation }
      }
    ));
  }

  /**
   * Safe execution wrapper for provider operations
   */
  protected async safeExecute<T>(
    operation: () => Promise<T>,
    context: ProviderExecutionContext,
    operationName: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handleProviderError(error, context, operationName);
    }
  }

  /**
   * Abstract token counting methods - must be implemented by concrete providers
   */
  public abstract countTokens(messages: readonly import('../types/messages.js').Message[], model: string, tools: ToolDefinition[], maxTokens: number): Promise<number>;
  public abstract getContextWindow(model: string): number;
  public abstract supportsTokenCounting(model: string): boolean;
}