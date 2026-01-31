import { BaseTokenCounter } from '../base-token-counter.js';
import type { Message } from '../../../../core/types/messages.js';
import type { LiteLLMConfig } from '../../../../core/types/config.js';
import { logger } from '../../../../../utils/logger.js';
import { ToolDefinition } from '../../../../core/index.js';
import { convertMessages } from '../../../../providers/litellm/utils/message-converter.js';
import type { LiteLLMMessage, LiteLLMRequest } from '../../../../providers/litellm/schemas.js';

/**
 * LiteLLM token counting response interface
 * Based on actual API response structure
 */
interface LiteLLMTokenCountResponse {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  total_tokens: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  request_model: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  model_used: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tokenizer_type: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  original_response: unknown;
}


/**
 * HTTP-based token counter that uses LiteLLM's /utils/token_counter endpoint
 * This provides native, accurate token counting for any model supported by LiteLLM
 */
export class LiteLLMHttpTokenCounter extends BaseTokenCounter {
  private readonly modelId: string;
  protected override readonly config: LiteLLMConfig;
  private httpClient: typeof fetch;

  constructor(modelId: string, config: LiteLLMConfig) {
    super(modelId, config);
    this.modelId = modelId;
    this.config = config;
    this.httpClient = globalThis.fetch;
    
    // Initialize fetch client for Node.js if needed
    if (!this.httpClient && typeof window === 'undefined') {
      // Set a placeholder, will be initialized on first use
      this.httpClient = this.lazyInitFetch.bind(this);
    }

    logger.debug('LiteLLMHttpTokenCounter initialized', {
      modelId,
      baseUrl: this.config.baseUrl,
      supportsNativeCounting: true
    });
  }

  /**
   * Lazy initialization of fetch for Node.js environments
   */
  private async lazyInitFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      // Dynamic import to avoid bundling issues
      const { default: fetch } = await import('node-fetch');
      this.httpClient = fetch as unknown as typeof globalThis.fetch;
      return this.httpClient(input, init);
    } catch {
      throw new Error('node-fetch is required for Node.js environments');
    }
  }

  /**
   * Count tokens using LiteLLM's native token_counter endpoint
   */
  public override async countTokens(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number): Promise<number> {
    try {
      // Convert our message format to LiteLLM format using shared utility
      const litellmMessages = convertMessages(messages);

      const response = await this.callTokenCounterEndpoint(litellmMessages, tools);
      
      logger.debug('LiteLLM HTTP token counting completed', {
        modelId: this.modelId,
        messageCount: messages.length,
        toolsCount: tools.length,
        totalTokens: response.totalTokens
      });

      return response.totalTokens + maxTokens; // Include max output tokens for total context window usage
    } catch (error) {
      logger.warn('LiteLLM HTTP token counting failed, falling back to estimation', {
        modelId: this.modelId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to estimation if HTTP call fails
      return this.estimateTokensForMessages(messages) + maxTokens; // Include max output tokens for estimation
    }
  }

  /**
   * Get context window size for the model
   * This uses LiteLLM's model info or falls back to defaults
   */
  public override getContextWindow(): number {
    // Common context windows for LiteLLM supported models
     
    // Model names must match LiteLLM API specifications exactly
    const modelContextWindows: Record<string, number> = {
       
      // GLM models
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-4': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-45-fp8': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'glm-46-fp8': 200000,
      
      // Claude models
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-3-5-sonnet-20241022': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-3-5-sonnet-20240620': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-3-opus-20240229': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-3-sonnet-20240229': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-3-haiku-20240307': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4': 200000,
      
      // Gemini models
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-1.5-pro': 1000000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-1.5-flash': 1000000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.0-flash-exp': 1000000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 1000000,
      
      // OpenAI models
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4': 8192,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4-turbo': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4o': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-3.5-turbo': 16385,
    };

    // Try exact match first
    const exactMatch = modelContextWindows[this.modelId];
    if (exactMatch !== undefined) {
      return exactMatch;
    }

    // Try partial matches
    for (const [key, contextWindow] of Object.entries(modelContextWindows)) {
      if (this.modelId.includes(key) || key.includes(this.modelId)) {
        return contextWindow;
      }
    }

    // Default fallback
    logger.warn('Unknown model context window, using default', {
      modelId: this.modelId,
      defaultContextWindow: 128000
    });
    return 128000;
  }

  /**
   * Check if this model supports native token counting via HTTP
   */
  public override supportsTokenCounting(): boolean {
    return true; // LiteLLM HTTP endpoint supports all models
  }


  /**
   * Call LiteLLM's token counter endpoint
   */
  private async callTokenCounterEndpoint(messages: LiteLLMMessage[], tools?: ToolDefinition[]): Promise<{
    totalTokens: number;
  }> {
    const url = `${this.config.baseUrl}utils/token_counter`;
    
    const requestBody: Partial<LiteLLMRequest> = {
      model: this.modelId,
      messages: messages,
      ...(tools && tools.length > 0 && {
        tools: tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || {}
          }
        }))
      })
    };

    // HTTP headers must match standard naming conventions
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...(this.config.customHeaders || {})
      },
      body: JSON.stringify(requestBody)
    };

    logger.debug('Calling LiteLLM token counter endpoint', {
      url,
      modelId: this.modelId,
      messageCount: messages.length
    });

    const response = await this.httpClient(url, requestOptions);

    if (!response.ok) {
      throw new Error(`LiteLLM token counter failed: ${response.status} ${response.statusText} `);
    }

    const result = await response.json() as LiteLLMTokenCountResponse;
    
    return { 
      totalTokens: result.total_tokens
    };
  }

  /**
   * Get human-readable model information
   */
  public getTokenCountingInfo(): {
    provider: string;
    model: string;
    contextWindow: number;
    supportsNativeCounting: boolean;
    endpoint: string;
  } {
    return {
      provider: 'litellm-http',
      model: this.modelId,
      contextWindow: this.getContextWindow(),
      supportsNativeCounting: true,
      endpoint: `${this.config.baseUrl}/utils/token_counter`
    };
  }

  /**
   * Test connection to LiteLLM endpoint
   */
  public async testConnection(): Promise<boolean> {
    try {
      const testMessages: LiteLLMMessage[] = [{ role: 'user', content: 'test' }];
      await this.callTokenCounterEndpoint(testMessages);
      return true;
    } catch (error) {
      logger.error('LiteLLM token counter connection test failed', error as Error, {
        modelId: this.modelId,
        baseUrl: this.config.baseUrl
      });
      return false;
    }
  }
}