import { LLMClient } from '../../client/llm-client.js';
import type { LLMClientConfig } from '../../core/types/config.js';
import type { Message } from '../../core/types/messages.js';
import type { LLMRequest } from '../../core/types/requests.js';
import { TokenCounterFactory } from './token-counting/index.js';
import type { BaseTokenCounter } from './token-counting/base-token-counter.js';
import { ToolDefinition } from '../../core/index.js';

/**
 * ConversationCompactor class for managing conversation context
 * Provides intelligent conversation compacting and token counting
 */
export class ConversationCompactor {
  private readonly llmClient: LLMClient;
  private readonly model: string;
  private readonly tokenCounter: BaseTokenCounter;
  private readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig, model: string) {
    this.config = config;
    this.llmClient = new LLMClient(config);
    this.model = model;
    
    // Create appropriate token counter
    const provider = config.provider.type;
    this.tokenCounter = TokenCounterFactory.create(provider, model, config.provider.config);
  }

  /**
   * Get exact token count for message array
   */

  /**
   * Calculate what percentage of context window is used
   */
  public async getTokenUsagePercentage(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number): Promise<[number, number]> {
    const tokenCount = await this.tokenCounter.countTokens(messages, tools, maxTokens);
    const contextWindow = this.tokenCounter.getContextWindow();
    return [(tokenCount / contextWindow) * 100, tokenCount]
  }

  /**
   * Compact conversation into a single summary message
   */
  public async compact(messages: readonly Message[], systemPrompt: string): Promise<Message[]> {
    const request: LLMRequest = {
      model: this.model,
      provider: this.config.provider.type,
      messages: [
        ...messages,
        {
          type: 'user',
          content: systemPrompt,
          id: 'compact-request',
          timestamp: new Date().toISOString()
        }
      ],
      parameters: {
        temperature: 0.1, // Low temperature for consistent compacting
        maxTokens: Math.min(4096, Math.floor(this.tokenCounter.getContextWindow() * 0.3)) // Max 30% of context for summary
      },
      features: {
        streaming: false
      }
    };

    const response = await this.llmClient.generate({
      messages: request.messages,
      model: request.model,
      parameters: {
        temperature: 0.1,
        maxTokens: Math.min(4096, Math.floor(this.tokenCounter.getContextWindow() * 0.3))
      },
      features: {
        thinkingMode: false
      }
    });

    
    if (!response.content) {
      throw new Error('Failed to generate conversation summary');
    }

    // Create summary message with isSummary flag as user message
    const summaryMessage: Message = {
      type: 'user',
      content: response.content,
      id: `compacted-${Date.now()}`,
      timestamp: new Date().toISOString(),
      isSummary: true,
      metadata: {
        compacted: true,
        originalMessageCount: messages.length,
        compactedAt: new Date().toISOString()
      }
    };

    // Return original messages array with summary appended
    return [...messages, summaryMessage];
  }

  /**
   * Get token counting capabilities
   */
  public getTokenCountingInfo(): {
    supportsNativeCounting: boolean;
    contextWindow: number;
    provider: string;
    model: string;
  } {
    return {
      supportsNativeCounting: this.tokenCounter.supportsTokenCounting(),
      contextWindow: this.tokenCounter.getContextWindow(),
      provider: this.config.provider.type,
      model: this.model
    };
  }



  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.llmClient.dispose();
  }
}
