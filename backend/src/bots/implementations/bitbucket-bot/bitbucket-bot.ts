/**
 * Bitbucket Bot
 *
 * A system bot for handling Bitbucket webhook events.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type BitbucketBotInput = { message: string };
type BitbucketBotOutput = { response: string };

const BitbucketBotInputSchema = z.object({
  message: z.string(),
});

const BitbucketBotOutputSchema: z.ZodType<BitbucketBotOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'bitbucket',
  name: 'Bitbucket Bot',
  email: 'bitbucket-bot@bot.xyne.ai',
  description: 'System bot for Bitbucket webhook events',
  inputSchema: BitbucketBotInputSchema,
  outputSchema: BitbucketBotOutputSchema,
  scope: 'all',
  interactionMode: "execute",
})
export class BitbucketBot extends UnifiedBaseBot<BitbucketBotInput, BitbucketBotOutput> {
  protected readonly definition: InternalBotDefinition<BitbucketBotInput, BitbucketBotOutput> = {
    id: 'bitbucket',
    name: 'Bitbucket Bot',
    email: 'bitbucket-bot@bot.xyne.ai',
    description: 'System bot for Bitbucket webhook events',
    runtimeType: 'internal',
    inputSchema: BitbucketBotInputSchema,
    outputSchema: BitbucketBotOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: BitbucketBotInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    // This bot doesn't execute commands - it's used only as a sender for Bitbucket webhook messages
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally for posting Bitbucket webhook events.',
    );
  }
}