/**
 * Ticket Bot
 *
 * A system bot that acts as the sender for automated ticket messages (release
 * dev-ticket notices, ETA activity). It no longer accepts commands.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type TicketBotInput = { message: string };
type TicketBotOutput = { response: string };

const TicketBotInputSchema = z.object({
  message: z.string(),
});

const TicketBotOutputSchema: z.ZodType<TicketBotOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'ticket-bot',
  name: 'Ticket Bot',
  email: 'ticket-bot@bot.xyne.ai',
  description: 'System bot for posting automated ticket messages',
  inputSchema: TicketBotInputSchema,
  outputSchema: TicketBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class TicketBot extends UnifiedBaseBot<TicketBotInput, TicketBotOutput> {
  protected readonly definition: InternalBotDefinition<TicketBotInput, TicketBotOutput> = {
    id: 'ticket-bot',
    name: 'Ticket Bot',
    email: 'ticket-bot@bot.xyne.ai',
    description: 'System bot for posting automated ticket messages',
    runtimeType: 'internal',
    inputSchema: TicketBotInputSchema,
    outputSchema: TicketBotOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: TicketBotInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally as the sender of automated ticket messages.',
      { channelId: _context.channelId }
    );
  }
}
