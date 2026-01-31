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
import type { StreamChunk } from '../../core/types/streaming.js';
import type { ModelHealthStatus, PingResult } from '../../core/types/health.js';
import type { VertexConfig } from './schemas.js';
import { validateVertexConfig } from './schemas.js';
import { VertexAuth } from './auth/vertex-auth.js';
import { GeminiProvider } from './models/gemini-provider.js';
import { ClaudeVertexProvider } from './models/claude-vertex-provider.js';
import { logger } from '../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderValidationError,
  createModelUnavailableError
} from '../../core/errors/index.js';
import { TokenCounterFactory } from '../../features/compact/token-counting/index.js';
import type { Message } from '../../core/types/messages.js';

/**
 * Main Vertex AI provider that orchestrates Gemini and Claude models
 * Provides unified interface for all Vertex AI models
 */
export class VertexProvider extends BaseProvider {
  protected readonly providerName = 'vertex';
  protected readonly supportedModelIds: readonly string[];
  protected readonly providerConfig: Omit<VertexConfig, 'customEndpoint'> & Required<Pick<ProviderConfig, 'name'>> & { customEndpoint?: string };

  private readonly auth: VertexAuth;
  private readonly geminiProvider: GeminiProvider;
  private readonly claudeProvider: ClaudeVertexProvider;

  // All supported models across Gemini and Claude
  private readonly ALL_SUPPORTED_MODELS = [
    // Gemini models
    'gemini-2.5-pro',
    // Claude models
    'claude-sonnet-4@20250514'
  ] as const;

  constructor(config: VertexConfig) {
    super();
    
    // Validate configuration
    if (!validateVertexConfig(config)) {
      throw new LLMErrorClass(createProviderValidationError(
        'vertex',
        ['Invalid Vertex configuration provided']
      ));
    }

    const { customEndpoint, ...configWithoutCustomEndpoint } = config;
    this.providerConfig = { 
      ...configWithoutCustomEndpoint, 
      name: 'vertex',
      ...(customEndpoint && { customEndpoint })
    };
    this.supportedModelIds = [...this.ALL_SUPPORTED_MODELS];

    // Initialize authentication
    this.auth = new VertexAuth(config.auth);

    // Initialize model providers
    this.geminiProvider = new GeminiProvider(this.auth, config.auth);
    this.claudeProvider = new ClaudeVertexProvider(this.auth, config.auth);

    logger.info('Vertex provider initialized', {
      projectId: config.auth.projectId,
      region: config.auth.region,
      supportedModels: this.supportedModelIds.length,
      apiVersion: config.apiVersion
    });
  }

  /**
   * Generate LLM response using appropriate model provider
   */
  protected async generateInternal(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): Promise<LLMResponse> {
    const modelProvider = this.getModelProvider(request.model);
    return await modelProvider.generate(request, context, abortSignal);
  }

  /**
   * Generate streaming LLM response using appropriate model provider
   */
  protected async *generateStreamInternal(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const modelProvider = this.getModelProvider(request.model);
    yield* modelProvider.generateStream(request, context, abortSignal);
  }

  /**
   * Authenticate with Vertex AI
   */
  public async authenticate(): Promise<void> {
    try {
      await this.auth.authenticate();
      logger.info('Vertex provider authenticated successfully', {
        projectId: this.auth.getProjectId(),
        region: this.auth.getRegion()
      });
    } catch (error) {
      logger.error('Vertex provider authentication failed', error as Error);
      throw error;
    }
  }

  /**
   * Check if currently authenticated
   */
  public isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  /**
   * List available models
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async listModels(): Promise<readonly ProviderModel[]> {
    const models: ProviderModel[] = [];

    // Add Gemini models
    for (const modelId of ['gemini-2.5-pro']) {
      const capabilities = this.geminiProvider.getModelCapabilities(modelId);
      if (capabilities) {
        models.push({
          id: modelId,
          name: modelId,
          displayName: this.formatModelDisplayName(modelId),
          description: this.getModelDescription(modelId),
          capabilities,
          availability: {
            regions: [this.auth.getRegion()],
            status: 'available'
          }
        });
      }
    }

    // Add Claude models
    for (const modelId of ['claude-sonnet-4@20250514']) {
      const capabilities = this.claudeProvider.getModelCapabilities(modelId);
      if (capabilities) {
        models.push({
          id: modelId,
          name: modelId,
          displayName: this.formatModelDisplayName(modelId),
          description: this.getModelDescription(modelId),
          capabilities,
          availability: {
            regions: [this.auth.getRegion()],
            status: 'available'
          }
        });
      }
    }

    return models;
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
      const testRequest: LLMRequest = {
        messages: [{
          id: 'ping-test',
          type: 'user',
          content: 'ping',
          timestamp: new Date().toDateString()
        }],
        model,
        provider: this.providerName,
        parameters: {
          maxTokens: 1,
          temperature: 0
        }
      };

      const context: ProviderExecutionContext = {
        requestId: `ping-${Date.now()}`,
        provider: this.providerName,
        model,
        startTime: new Date()
      };

      // Try to generate a minimal response
      await this.generateInternal(testRequest, context);

      const latency = Date.now() - startTime;

      return {
        success: true,
        latency,
        timestamp: new Date(),
        responseMetadata: {
          model,
          provider: this.providerName,
          region: this.auth.getRegion()
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
        region: this.auth.getRegion(),
        capabilities: this.getModelCapabilities(model)?.supportsToolCalling ? ['tool_calling'] : []
      }
    };
  }

  /**
   * Provider capability checks
   */
  public supportsToolCalling(): boolean {
    return true; // Both Gemini and Claude support tool calling
  }

  public supportsStreaming(): boolean {
    return true; // Both providers support streaming
  }

  public supportsThinking(): boolean {
    return true; // Claude supports thinking, method indicates any thinking support
  }

  /**
   * Get model capabilities
   */
  public getModelCapabilities(model: string): ModelCapabilities | undefined {
    const modelProvider = this.getModelProviderSafe(model);
    return modelProvider?.getModelCapabilities(model);
  }

  /**
   * Validate configuration
   */
  public validateConfig(config: unknown): boolean {
    return validateVertexConfig(config);
  }

  /**
   * Update configuration
   */
  public updateConfig(config: unknown): void {
    if (!validateVertexConfig(config)) {
      throw new LLMErrorClass(createProviderValidationError(
        this.providerName,
        ['Invalid Vertex configuration provided for update']
      ));
    }

    // Note: In a real implementation, you might want to reinitialize
    // certain components when config changes
    logger.info('Vertex provider configuration updated');
  }

  /**
   * Custom request validation for Vertex-specific requirements
   */
  protected override validateRequestCustom(request: LLMRequest): string[] {
    const errors: string[] = [];

    // Validate model-specific constraints
    const capabilities = this.getModelCapabilities(request.model);
    if (capabilities) {
      // Check max tokens
      if (request.parameters?.maxTokens && request.parameters.maxTokens > capabilities.maxTokens) {
        errors.push(`maxTokens ${request.parameters.maxTokens} exceeds model limit ${capabilities.maxTokens}`);
      }

      // Check tool calling support
      if (request.tools && request.tools.length > 0 && !capabilities.supportsToolCalling) {
        errors.push(`Model ${request.model} does not support tool calling`);
      }

      // Check streaming support
      if (request.features?.streaming && !capabilities.supportsStreaming) {
        errors.push(`Model ${request.model} does not support streaming`);
      }

      // Check thinking support
      if (request.features?.thinking?.enabled && !capabilities.supportsThinking) {
        errors.push(`Model ${request.model} does not support thinking mode`);
      }

      // Check interleaved thinking support (Claude 4 only)
      if (request.features?.thinking?.interleavedThinking && 
          !request.model.includes('claude-sonnet-4')) {
        errors.push(`Interleaved thinking is only supported for Claude Sonnet 4 models`);
      }
    }

    return errors;
  }

  /**
   * Get the appropriate model provider for a given model
   */
  private getModelProvider(model: string): GeminiProvider | ClaudeVertexProvider {
    if (model.startsWith('gemini')) {
      return this.geminiProvider;
    }
    
    if (model.startsWith('claude')) {
      return this.claudeProvider;
    }

    throw new LLMErrorClass(createModelUnavailableError(
      this.providerName,
      model,
      `No provider available for model: ${model}`
    ));
  }

  /**
   * Get model provider safely (returns undefined if not found)
   */
  private getModelProviderSafe(model: string): GeminiProvider | ClaudeVertexProvider | undefined {
    try {
      return this.getModelProvider(model);
    } catch {
      return undefined;
    }
  }

  /**
   * Format model display name for UI
   */
  private formatModelDisplayName(modelId: string): string {
    const displayNames: Record<string, string> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 'Gemini 2.5 Pro',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4@20250514': 'Claude Sonnet 4'
    };

    return displayNames[modelId] || modelId;
  }

  /**
   * Get model description
   */
  private getModelDescription(modelId: string): string {
    const descriptions: Record<string, string> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 'Most capable Gemini model with enhanced thinking and multimodal reasoning',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4@20250514': 'Latest Claude model with advanced thinking and interleaved reasoning'
    };

    return descriptions[modelId] || `${modelId} model on Vertex AI`;
  }

  /**
   * Token counting implementation using model-specific counters
   */
  public async countTokens(messages: readonly Message[], model: string, tools: ToolDefinition[], maxTokens: number): Promise<number> {
    const tokenCounter = TokenCounterFactory.create('vertex', model, this.providerConfig);
    return await tokenCounter.countTokens(messages, tools, maxTokens);
  }

  public getContextWindow(model: string): number {
    const tokenCounter = TokenCounterFactory.create('vertex', model, this.providerConfig);
    return tokenCounter.getContextWindow();
  }

  public supportsTokenCounting(model: string): boolean {
    const tokenCounter = TokenCounterFactory.create('vertex', model, this.providerConfig);
    return tokenCounter.supportsTokenCounting();
  }
}