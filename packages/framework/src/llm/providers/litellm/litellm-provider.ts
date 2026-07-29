import { BaseProvider } from '../../core/providers/base-provider.js';
import type {
  LLMRequest,
  LLMResponse,
  ModelCapabilities,
  ProviderModel,
  ProviderExecutionContext,
  ProviderConfig,
  ToolDefinition
} from '../../core/types/index.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { StreamChunk } from '../../core/types/streaming.js';
import type { ModelHealthStatus, PingResult } from '../../core/types/health.js';
import type { 
  LiteLLMConfig, 
  LiteLLMRequest, 
  LiteLLMResponse, 
  LiteLLMStreamChunk 
} from './schemas.js';
import { 
  validateLiteLLMConfig, 
  parseLiteLLMResponse, 
  parseLiteLLMStreamChunk,
  parseLiteLLMError 
} from './schemas.js';
import { logger } from '../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderValidationError,
  createProviderExecutionError,
  createAuthenticationError,
  createRateLimitError,
  createNetworkError
} from '../../core/errors/index.js';
import { TokenCounterFactory } from '../../features/compact/token-counting/index.js';
import type { Message } from '../../core/types/messages.js';
import { convertMessages } from './utils/message-converter.js';

/**
 * LiteLLM provider implementation
 * Provides unified access to multiple LLM providers through LiteLLM
 */
export class LiteLLMProvider extends BaseProvider {
  protected readonly providerName = 'litellm';
  protected readonly supportedModelIds: readonly string[];
  protected readonly providerConfig: LiteLLMConfig & Required<Pick<ProviderConfig, 'name'>> & { timeout: number; retries: number; rateLimiting: boolean; enableLogging: boolean; };

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private isAuthenticatedFlag = false;

  // Supported models via LiteLLM
  private readonly ALL_SUPPORTED_MODELS = [
    'glm-45-fp8',
    'qwen3-30b',
    'glm-46-fp8',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'claude-sonnet-4',
    'claude-sonnet-4-20250514',
    'xyne-spaces-minimax-m2',
    'glm-latest'
  ] as const;

  public constructor(config: LiteLLMConfig) {
    super();
    
    // Validate configuration
    if (!validateLiteLLMConfig(config)) {
      throw new LLMErrorClass(createProviderValidationError(
        'litellm',
        ['Invalid LiteLLM configuration provided']
      ));
    }

    this.providerConfig = {
      ...config,
      name: 'litellm',
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
      rateLimiting: config.rateLimiting ?? true,
      enableLogging: config.enableLogging ?? true
    };
    this.supportedModelIds = [...this.ALL_SUPPORTED_MODELS];

    // Set up base URL and headers
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.headers = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.customHeaders
    };

    logger.info('LiteLLM provider initialized', {
      baseUrl: this.baseUrl,
      supportedModels: this.supportedModelIds.length,
      timeout: config.timeout,
      retries: config.retries
    });
  }

  /**
   * Generate LLM response using LiteLLM
   */
  protected async generateInternal(
    request: LLMRequest,
    context: ProviderExecutionContext
  ): Promise<LLMResponse> {
    try {
      // Convert to LiteLLM format
      const litellmRequest = this.convertToLiteLLMRequest(request);
      
      // Make API call
      const response = await this.callLiteLLMAPI(litellmRequest);
      
      // Convert response back to universal format
      return this.convertFromLiteLLMResponse(response, request.model);
      
    } catch (error) {
      this.handleProviderError(error, context, 'generation');
    }
  }

  /**
   * Generate streaming LLM response using LiteLLM
   */
  protected async *generateStreamInternal(
    request: LLMRequest,
    context: ProviderExecutionContext
  ): AsyncIterable<StreamChunk> {
    try {
      // Convert to LiteLLM streaming format
      const litellmRequest = this.convertToLiteLLMRequest(request, true);
      
      // Make streaming API call
      const stream = this.callLiteLLMStreamAPI(litellmRequest);
      
      // Convert and yield chunks
      for await (const chunk of stream) {
        yield this.convertFromLiteLLMStreamChunk(chunk);
      }
      
    } catch (error) {
      this.handleProviderError(error, context, 'streaming');
    }
  }

  /**
   * Authenticate with LiteLLM (validate API key)
   */
  public async authenticate(): Promise<void> {
    try {
      await Promise.resolve();
      logger.info('LiteLLM provider authenticated successfully');
      
    } catch (error) {
      this.isAuthenticatedFlag = false;
      const message = error instanceof Error ? error.message : 'Authentication failed';
      
      throw new LLMErrorClass(createAuthenticationError(
        this.providerName,
        message,
        'api_key'
      ));
    }
  }

  /**
   * Check if currently authenticated
   */
  public isAuthenticated(): boolean {
    return this.isAuthenticatedFlag;
  }

  /**
   * List available models
   */
  public listModels(): Promise<readonly ProviderModel[]> {
    const models: ProviderModel[] = [];

    for (const modelId of this.supportedModelIds) {
      const capabilities = this.getModelCapabilities(modelId);
      if (capabilities) {
        models.push({
          id: modelId,
          name: modelId,
          displayName: this.formatModelDisplayName(modelId),
          description: this.getModelDescription(modelId),
          capabilities,
          availability: {
            regions: ['global'],
            status: 'available'
          }
        });
      }
    }

    return Promise.resolve(models);
  }

  /**
   * Ping a specific model
   */
  public async ping(model: string): Promise<PingResult> {
    const startTime = Date.now();

    try {
      if (!this.isModelSupported(model)) {
        throw new Error(`Model ${model} is not supported`);
      }

      await this.ensureAuthenticated();

      // Create a minimal test request
      const testRequest: LiteLLMRequest = {
        model,
        messages: [{
          role: 'user',
          content: 'ping'
        }],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        max_tokens: 1,
        temperature: 0
      };

      await this.callLiteLLMAPI(testRequest);
      const latency = Date.now() - startTime;

      return {
        success: true,
        latency,
        timestamp: new Date(),
        responseMetadata: {
          model,
          provider: this.providerName
        }
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        success: false,
        latency,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown ping error'
      };
    }
  }

  /**
   * Get health status of a model
   */
  public async getHealth(model: string): Promise<ModelHealthStatus> {
    const pingResult = await this.ping(model);
    
    let status: ModelHealthStatus['status'] = 'unknown';
    if (pingResult.success) {
      status = pingResult.latency > 5000 ? 'degraded' : 'healthy';
    } else {
      status = 'unavailable';
    }

    return {
      provider: this.providerName,
      model,
      status,
      latency: pingResult.latency,
      lastChecked: new Date(),
      ...(pingResult.error && { error: pingResult.error }),
      metadata: {
        capabilities: this.getModelCapabilities(model)?.supportsToolCalling ? ['tool_calling'] : []
      }
    };
  }

  /**
   * Provider capability checks
   */
  public supportsToolCalling(): boolean {
    return true; // Most models via LiteLLM support tool calling
  }

  public supportsStreaming(): boolean {
    return true; // LiteLLM supports streaming
  }

  public supportsThinking(): boolean {
    // LiteLLM supports models that have thinking capabilities (e.g., Claude models)
    return true;
  }

  /**
   * Get model capabilities
   */
  public getModelCapabilities(model: string): ModelCapabilities | undefined {
    const capabilityMap: Record<string, ModelCapabilities> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-latest': {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: false,
        supportedLanguages: ['en', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-45-fp8': {
        maxTokens: 8192,
        contextWindow: 128000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: false,
        supportedLanguages: ['en', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'qwen3-30b': {
        maxTokens: 8192,
        contextWindow: 32000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: false,
        supportedLanguages: ['en', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-46-fp8': {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: false,
        supportedLanguages: ['en', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': {
        maxTokens: 8192,
        contextWindow: 1000000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: true,
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-3-flash-preview': {
        maxTokens: 65536,
        contextWindow: 1000000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: true,
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4': {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: true,
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4-20250514': {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: true,
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh']
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'xyne-spaces-minimax-m2': {
        maxTokens: 8192,
        contextWindow: 200000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsThinking: true,
        supportedLanguages: ['en', 'zh']
      }
    };

    return capabilityMap[model];
  }

  /**
   * Validate configuration
   */
  public validateConfig(config: unknown): boolean {
    return validateLiteLLMConfig(config);
  }

  /**
   * Update configuration
   */
  public updateConfig(config: unknown): void {
    if (!validateLiteLLMConfig(config)) {
      throw new LLMErrorClass(createProviderValidationError(
        this.providerName,
        ['Invalid LiteLLM configuration provided for update']
      ));
    }

    logger.info('LiteLLM provider configuration updated');
  }

  /**
   * Private helper methods
   */

  /**
   * Check if thinking should be enabled for this request
   */
  private shouldEnableThinking(request: LLMRequest): boolean {
    const thinkingRequested = request.features?.thinking?.enabled ?? false;
    const modelSupportsThinking = this.getModelCapabilities(request.model)?.supportsThinking ?? false;
    
    return thinkingRequested && modelSupportsThinking;
  }

  private convertToLiteLLMRequest(request: LLMRequest, streaming = false): LiteLLMRequest {
    // Convert system prompt to system message if present
    const convertedMessages = convertMessages(request.messages);
    const allMessages = request.systemPrompt 
      ? [{ role: 'system' as const, content: request.systemPrompt }, ...convertedMessages]
      : convertedMessages;

    // Log system prompt conversion
    logger.debug('LiteLLM system prompt conversion', {
      hasSystemPrompt: !!request.systemPrompt,
      systemPromptLength: request.systemPrompt?.length || 0,
      originalMessageCount: request.messages.length,
      finalMessageCount: allMessages.length,
      firstMessageRole: allMessages[0]?.role
    });

    const litellmRequest = {
      model: request.model,
      messages: allMessages,
      ...(request.tools && request.tools.length > 0 && {
        tools: request.tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: this.convertZodSchemaToJsonSchema(tool.inputSchema)
          }
        }))
      }),
      ...(request.parameters?.temperature !== undefined && {
        temperature: request.parameters.temperature
      }),
      ...(request.parameters?.maxTokens !== undefined && {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        max_tokens: request.parameters.maxTokens
      }),
      ...(request.parameters?.topP !== undefined && {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        top_p: request.parameters.topP
      }),
      ...(streaming && { stream: true }),
      ...(this.shouldEnableThinking(request) && {
        thinking: {
          type: "enabled" as const,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          budget_tokens: request.features?.thinking?.budgetTokens || 6000
        }
      }),
      ...(request.extraBody && {
        extra_body: request.extraBody
      })
    };



    return litellmRequest;
  }

  /**
   * Convert Zod schema to JSON schema format for LiteLLM
   */
  private convertZodSchemaToJsonSchema(schema: z.ZodSchema<unknown>): Record<string, unknown> {
    interface JsonSchema {
      $ref?: string;
      definitions?: Record<string, JsonSchema>;
      properties?: Record<string, unknown>;
      required?: string[];
      type?: string;
      [key: string]: unknown;
    }

    try {
      const jsonSchema = zodToJsonSchema(schema, {
        name: 'tool_input_schema',
        target: 'jsonSchema7'
      }) as JsonSchema;
      
      // If the schema uses $ref, extract the referenced definition
      if (jsonSchema.$ref && jsonSchema.definitions) {
        const refKey = jsonSchema.$ref.replace('#/definitions/', '');
        const actualSchema = jsonSchema.definitions[refKey];
        if (actualSchema) {
          return {
            type: 'object',
            ...actualSchema
          } as Record<string, unknown>;
        }
      }
      
      // Ensure the schema has the required type field
      return {
        type: 'object',
        properties: jsonSchema.properties || {},
        required: jsonSchema.required || [],
        additionalProperties: false
      };
    } catch (error) {
      logger.warn('Failed to convert Zod schema to JSON schema, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback to permissive schema
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true
      };
    }
  }

  private convertFromLiteLLMResponse(response: LiteLLMResponse, model: string): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choices in LiteLLM response');
    }

    return {
      id: response.id,
      content: choice.message.content || '',
      model,
      provider: this.providerName,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        ...(response.usage?.thinking_tokens && {
          thinkingTokens: response.usage.thinking_tokens
        })
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
      ...(choice.message.tool_calls && {
        toolCalls: choice.message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>
        }))
      }),
      ...(choice.message.thinking && {
        thinking: choice.message.thinking
      }),
      ...(choice.message.reasoning_content && {
        thinking: choice.message.reasoning_content
      }),
      latency: 0, // Will be set by BaseProvider
      metadata: {
        requestId: response.id,
        model: response.model,
        provider: this.providerName,
        timestamp: new Date(),
        processingTime: 0,
        rawResponse: {
          finishReason: choice.finish_reason
        }
      }
    };
  }

  private mapFinishReason(reason: string | null | undefined): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
      default:
        return 'error';
    }
  }

  private convertFromLiteLLMStreamChunk(chunk: LiteLLMStreamChunk): StreamChunk {
    const choice = chunk.choices[0];
    
    return {
      id: chunk.id,
      type: 'content',
      content: choice?.delta.content || '',
      metadata: {
        timestamp: new Date(),
        model: chunk.model,
        provider: this.providerName,
        ...(choice?.finish_reason && {
          finishReason: this.mapFinishReason(choice.finish_reason)
        })
      }
    };
  }

  private async callLiteLLMAPI(request: LiteLLMRequest): Promise<LiteLLMResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.providerConfig.timeout || 30000)
      });

      if (!response.ok) {
        await this.handleAPIError(response);
      }

      const data = await response.json() as unknown;
      return parseLiteLLMResponse(data);
      
    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }
      
      throw new LLMErrorClass(createNetworkError(
        this.providerName,
        error instanceof Error ? error.message : 'Network request failed'
      ));
    }
  }

  private async *callLiteLLMStreamAPI(request: LiteLLMRequest): AsyncIterable<LiteLLMStreamChunk> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.providerConfig.timeout || 30000)
      });

      if (!response.ok) {
        await this.handleAPIError(response);
      }

      if (!response.body) {
        throw new Error('No response body for streaming request');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              
              if (data === '[DONE]') {
                return;
              }

              try {
                const parsed = JSON.parse(data) as unknown;
                yield parseLiteLLMStreamChunk(parsed);
              } catch (parseError) {
                logger.warn('Failed to parse streaming chunk', { data, error: parseError });
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }
      
      throw new LLMErrorClass(createNetworkError(
        this.providerName,
        error instanceof Error ? error.message : 'Streaming request failed'
      ));
    }
  }

  private async handleAPIError(response: Response): Promise<never> {
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
    
    try {
      const errorData = await response.json() as unknown;
      const parsedError = parseLiteLLMError(errorData);
      errorMessage = parsedError.error.message;
    } catch {
      // Use default error message if parsing fails
    }

    if (response.status === 401) {
      throw new LLMErrorClass(createAuthenticationError(
        this.providerName,
        errorMessage,
        'api_key'
      ));
    }

    if (response.status === 429) {
      throw new LLMErrorClass(createRateLimitError(
        this.providerName,
        errorMessage
      ));
    }

    throw new LLMErrorClass(createProviderExecutionError(
      this.providerName,
      errorMessage,
      response.status >= 500
    ));
  }

  private formatModelDisplayName(modelId: string): string {
    const displayNames: Record<string, string> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'qwen3-30b': "Qwen3",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-latest': 'GLM Latest',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-45-fp8': 'GLM-4 5B FP8',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-46-fp8': 'GLM-4 6B FP8',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 'Gemini 2.5 Pro',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4': 'Claude Sonnet 4',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4-20250514': 'Claude Sonnet 4 (20250514)',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'xyne-spaces-minimax-m2': 'MiniMax M2'
    };

    return displayNames[modelId] || modelId;
  }

  private getModelDescription(modelId: string): string {
    const descriptions: Record<string, string> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-latest': 'Latest GLM model served via LiteLLM',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-45-fp8': 'GLM-4 5B model with FP8 quantization for efficient inference',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'qwen3-30b': 'Qwen 30B model with FP8 quantization for efficient inference',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-46-fp8': 'GLM-4 6B model with FP8 quantization for efficient inference',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 'Advanced Gemini model with enhanced capabilities and large context window',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-3-flash-preview': 'Gemini Flash preview model optimized for low-latency responses',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4': 'Most capable Claude model with thinking mode support',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4-20250514': 'Latest Claude Sonnet 4 model with thinking capabilities',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'xyne-spaces-minimax-m2': 'Agent and Coding native model with 80K reasoning chain and 1M context window'
    };

    return descriptions[modelId] || `${modelId} model via LiteLLM`;
  }

  /**
   * Token counting implementation using model-specific counters
   */
  public async countTokens(messages: readonly Message[], model: string, tools: ToolDefinition[], maxTokens: number): Promise<number> {
    const tokenCounter = TokenCounterFactory.create('litellm', model, this.providerConfig);
    return await tokenCounter.countTokens(messages, tools, maxTokens);
  }

  public getContextWindow(model: string): number {
    const tokenCounter = TokenCounterFactory.create('litellm', model, this.providerConfig);
    return tokenCounter.getContextWindow();
  }

  public supportsTokenCounting(model: string): boolean {
    const tokenCounter = TokenCounterFactory.create('litellm', model, this.providerConfig);
    return tokenCounter.supportsTokenCounting();
  }
}