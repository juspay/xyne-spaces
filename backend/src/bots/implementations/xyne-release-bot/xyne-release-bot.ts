/**
 * Xyne Release Bot
 *
 * A system bot for posting release notes canvases to threads.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type XyneReleaseInput = { message: string };
type XyneReleaseOutput = { response: string };

const XyneReleaseInputSchema = z.object({
  message: z.string(),
});

const XyneReleaseOutputSchema: z.ZodType<XyneReleaseOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'xyne-release-bot',
  name: 'Xyne Release',
  email: 'xyne-release-bot@bot.xyne.ai',
  description: 'System bot for posting release notes canvases to threads',
  inputSchema: XyneReleaseInputSchema,
  outputSchema: XyneReleaseOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class XyneReleaseBot extends UnifiedBaseBot<XyneReleaseInput, XyneReleaseOutput> {
  protected readonly definition: InternalBotDefinition<XyneReleaseInput, XyneReleaseOutput> = {
    id: 'xyne-release-bot',
    name: 'Xyne Release',
    email: 'xyne-release-bot@bot.xyne.ai',
    description: 'System bot for posting release notes canvases to threads',
    runtimeType: 'internal',
    inputSchema: XyneReleaseInputSchema,
    outputSchema: XyneReleaseOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    _input: XyneReleaseInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    // This bot doesn't execute commands - it's used only as a sender for release notes canvases
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally for posting release notes canvases to threads.',
      { channelId: _context.channelId }
    );
  }
}
