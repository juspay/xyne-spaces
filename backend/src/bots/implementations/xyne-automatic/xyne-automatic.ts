/**
 * Xyne Automatic Bot
 *
 * A system bot for posting automated messages.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type XyneAutomaticInput = { message: string };
type XyneAutomaticOutput = { response: string };

const XyneAutomaticInputSchema = z.object({
  message: z.string(),
});

const XyneAutomaticOutputSchema: z.ZodType<XyneAutomaticOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'xyne-automatic',
  name: 'Xyne Automatic',
  email: 'xyne-automatic@bot.xyne.ai',
  description: 'System bot for posting automated messages',
  inputSchema: XyneAutomaticInputSchema,
  outputSchema: XyneAutomaticOutputSchema,
  scope: 'all',
  interactionMode: "execute",
})
export class XyneAutomaticBot extends UnifiedBaseBot<XyneAutomaticInput, XyneAutomaticOutput> {
  protected readonly definition: InternalBotDefinition<XyneAutomaticInput, XyneAutomaticOutput> = {
    id: 'xyne-automatic',
    name: 'Xyne Automatic',
    email: 'xyne-automatic@bot.xyne.ai',
    description: 'System bot for posting automated messages',
    runtimeType: 'internal',
    inputSchema: XyneAutomaticInputSchema,
    outputSchema: XyneAutomaticOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: XyneAutomaticInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    // This bot doesn't execute commands - it's used only as a sender for automated messages
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally for posting automated system messages.',
      { channelId: _context.channelId }
    );
  }
}