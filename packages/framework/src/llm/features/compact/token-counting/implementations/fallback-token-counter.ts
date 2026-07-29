import { BaseTokenCounter } from '../base-token-counter.js';
import type { Message } from '../../../../core/types/messages.js';
import { ToolDefinition } from '../../../../core/index.js';

/**
 * Enhanced fallback token counter using tiktoken when available
 * Falls back to 4-character estimation when tiktoken is not available
 */
export class FallbackTokenCounter extends BaseTokenCounter {
  constructor(model: string, config: unknown) {
    super(model, config);
    // Initialize tiktoken for accurate counting
    this.initializeTiktoken();
  }

  countTokens(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number): Promise<number> {
    let inputTokens: number;
    
    if (this.encoding) {
      // Use tiktoken for accurate counting
      inputTokens = this.countTokensWithTiktoken(messages, tools);
    } else {
      // Fall back to estimation
      inputTokens = this.estimateTokensForMessages(messages);
    }
    
    return Promise.resolve(inputTokens + maxTokens); // Include max output tokens for total context window usage
  }

  getContextWindow(): number {
    // Supported model context windows
    const contextWindows: Record<string, number> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gpt-4': 8192,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4@20250514': 200000,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 1048576
    };

    // Try to match model name to known context windows
    for (const [modelPattern, contextWindow] of Object.entries(contextWindows)) {
      if (this.model.toLowerCase().includes(modelPattern.toLowerCase())) {
        return contextWindow;
      }
    }

    // Conservative default for unknown models
    return 4096;
  }

  supportsTokenCounting(): boolean {
    return this.encoding !== null; // True if tiktoken is available, false for estimation
  }
}