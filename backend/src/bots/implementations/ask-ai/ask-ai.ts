/**
 * Ask AI Bot
 *
 * A system bot for AI-generated content like canvases.
 * Used as the creator for AI-generated canvases and other automated content.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type AskAIInput = { message: string };
type AskAIOutput = { response: string };

const AskAIInputSchema = z.object({
  message: z.string(),
});

const AskAIOutputSchema: z.ZodType<AskAIOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'ask-ai',
  name: 'Ask AI',
  email: 'ask-ai@bot.xyne.ai',
  description: 'System bot for AI-generated content and canvases',
  inputSchema: AskAIInputSchema,
  outputSchema: AskAIOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class AskAIBot extends UnifiedBaseBot<AskAIInput, AskAIOutput> {
  protected readonly definition: InternalBotDefinition<AskAIInput, AskAIOutput> = {
    id: 'ask-ai',
    name: 'Ask AI',
    email: 'ask-ai@bot.xyne.ai',
    description: 'System bot for AI-generated content and canvases',
    runtimeType: 'internal',
    inputSchema: AskAIInputSchema,
    outputSchema: AskAIOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: AskAIInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    // This bot doesn't execute commands - it's used only as a creator for AI-generated content
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally as the creator for AI-generated canvases and content.',
      { channelId: _context.channelId }
    );
  }
}