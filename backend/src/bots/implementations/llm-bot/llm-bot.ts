import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';
import { logger } from '@/utils/logger';

// Define types first to avoid circular reference
type LLMBotInput = {
  query: string;
  systemPrompt: string;
  temperature?: string;
};

type LLMBotOutput = {
  response: string;
  tokens?: number;
  model?: string;
};

// Input/Output schemas
const LLMBotInputSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  systemPrompt: z.string().min(1, 'System prompt is required'),
  temperature: z.string().optional().default('0.7'),
});

const LLMBotOutputSchema: z.ZodType<LLMBotOutput> = z.object({
  response: z.string(),
  tokens: z.number().optional(),
  model: z.string().optional(),
});

@Bot({
  id: 'llm-bot',
  name: 'LLM Bot',
  email: 'llm-bot@bot.xyne.ai',
  description: 'A dummy LLM bot for testing async execution with query and system prompt',
  inputSchema: LLMBotInputSchema,
  outputSchema: LLMBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class LLMBot extends UnifiedBaseBot<LLMBotInput, LLMBotOutput> {
  protected readonly definition: InternalBotDefinition<LLMBotInput, LLMBotOutput> = {
    id: 'llm-bot',
    name: 'LLM Bot',
    email: 'llm-bot@bot.xyne.ai',
    description: 'A dummy LLM bot for testing async execution with query and system prompt',
    runtimeType: 'internal',
    inputSchema: LLMBotInputSchema,
    outputSchema: LLMBotOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    input: LLMBotInput,
    context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    try {
      logger.info(`LLM Bot execution started for channel: ${context.channelId}`);

      // Simulate processing time
      await this.simulateProcessing();

      // Generate dummy response based on input
      const response = this.generateResponse(input);

      // Yield content event
      yield this.createContentEvent(response.response, {
        channelId: context.channelId,
      });

      // Simulate multiple messages if requested
      if (input.query.toLowerCase().includes('multiple')) {
        await this.simulateProcessing(1000);

        yield this.createContentEvent('\n\nProcessing additional information...', {
          channelId: context.channelId,
        });

        await this.simulateProcessing(500);

        yield this.createContentEvent("\n\nHere's some additional information...", {
          channelId: context.channelId,
        });

        await this.simulateProcessing(500);

        yield this.createContentEvent('\n\nAnd that concludes my response!', {
          channelId: context.channelId,
        });
      }

      // Yield done event
      yield this.createDoneEvent({
        fullContent: response.response,
        channelId: context.channelId,
      });
    } catch (error) {
      logger.error(`LLM Bot execution failed for channel: ${context.channelId}`, error);
      yield this.createErrorEvent(
        error instanceof Error ? error.message : 'Unknown error',
        { channelId: context.channelId }
      );
    }
  }

  private async simulateProcessing(delay: number = 2000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private generateResponse(input: LLMBotInput): LLMBotOutput {
    // Generate a dummy response based on the system prompt and query
    const responses = [
      `Based on your query "${input.query}" and system prompt "${input.systemPrompt}", here's my response: This is a simulated LLM response.`,
      `I understand you want me to "${input.systemPrompt}" regarding "${input.query}". Here's what I think: This is a test response from the LLM bot.`,
      `Following the instruction to "${input.systemPrompt}", I'll address your query "${input.query}": This is a dummy response for testing purposes.`,
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    return {
      response: randomResponse ?? responses[0]!,
      tokens: Math.floor(Math.random() * 100) + 20,
      model: 'dummy-llm-v1',
    };
  }
}
