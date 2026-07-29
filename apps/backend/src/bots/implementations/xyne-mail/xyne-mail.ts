/**
 * Xyne Mail Bot
 *
 * A system bot for posting inbound channel email messages.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type {
  BotExecutionContext,
  InternalBotDefinition,
  BotEvent,
} from '@/bots/unified/types/index.js';

type XyneMailInput = { message: string };
type XyneMailOutput = { response: string };

const XyneMailInputSchema = z.object({
  message: z.string(),
});

const XyneMailOutputSchema: z.ZodType<XyneMailOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'xyne-mail',
  name: 'Xyne Mail',
  email: 'xyne-mail@bot.xyne.ai',
  description: 'System bot for posting inbound channel email messages',
  inputSchema: XyneMailInputSchema,
  outputSchema: XyneMailOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class XyneMailBot extends UnifiedBaseBot<XyneMailInput, XyneMailOutput> {
  protected readonly definition: InternalBotDefinition<XyneMailInput, XyneMailOutput> = {
    id: 'xyne-mail',
    name: 'Xyne Mail',
    email: 'xyne-mail@bot.xyne.ai',
    description: 'System bot for posting inbound channel email messages',
    runtimeType: 'internal',
    inputSchema: XyneMailInputSchema,
    outputSchema: XyneMailOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: XyneMailInput,
    _context: BotExecutionContext,
  ): AsyncGenerator<BotEvent> {
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally for posting inbound mail.',
      { channelId: _context.channelId },
    );
  }
}
