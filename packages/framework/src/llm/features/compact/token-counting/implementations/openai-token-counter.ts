import { BaseTokenCounter, type TiktokenModule } from '../base-token-counter.js';
import type { Message } from '../../../../core/types/messages.js';
import type { LiteLLMConfig } from '../../../../core/types/config.js';
import { ToolDefinition } from '../../../../core/index.js';


/**
 * OpenAI token counter using tiktoken library for accurate counting
 * Now leverages enhanced base class functionality
 */
export class OpenAITokenCounter extends BaseTokenCounter {
  constructor(model: string, config: LiteLLMConfig) {
    super(model, config);
    // Initialize tiktoken with model-specific encoding
    this.initializeTiktoken();
  }

  /**
   * Override to use model-specific encoding for OpenAI models
   */
  protected override initializeTiktoken(): void {
    try {
      // Dynamic import to handle optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.tiktoken = require('tiktoken') as TiktokenModule;
      
      // Try to get model-specific encoding first
      try {
        this.encoding = this.tiktoken.encoding_for_model(this.model);
      } catch {
        // If model-specific encoding fails, use cl100k_base (GPT-4 encoding)
        this.encoding = this.tiktoken.get_encoding('cl100k_base');
      }
    } catch {
      // Tiktoken not available - will fall back to estimation
      this.tiktoken = null;
      this.encoding = null;
    }
  }

  override countTokens(messages: readonly Message[], tools: ToolDefinition[], _maxTokens: number): Promise<number> {
    let inputTokens: number;
    
    if (this.encoding) {
      // Use enhanced base class tiktoken counting
      inputTokens = this.countTokensWithTiktoken(messages, tools);
    } else {
      // Fall back to estimation using base class
      inputTokens = this.estimateTokensForMessages(messages);
    }
    
    // OpenAI doesn't count output tokens toward context window for input
    return Promise.resolve(inputTokens);
  }

  override getContextWindow(): number {
    const contextWindows: Record<string, number> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4': 8192,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4-turbo': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4o': 128000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-3.5-turbo': 16385
    };

    // Find the closest match for the model
    for (const [modelPattern, contextWindow] of Object.entries(contextWindows)) {
      if (this.model.toLowerCase().includes(modelPattern.toLowerCase().replace('-', ''))) {
        return contextWindow;
      }
    }

    return 8192; // Conservative default
  }

  override supportsTokenCounting(): boolean {
    return this.encoding !== null; // True if tiktoken is available
  }

}