/**
 * Docs Publisher Bot
 *
 * A system bot for sending docs publishing notifications.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';

type DocsPublisherInput = { message: string };
type DocsPublisherOutput = { response: string };

const DocsPublisherInputSchema = z.object({
    message: z.string(),
});

const DocsPublisherOutputSchema: z.ZodType<DocsPublisherOutput> = z.object({
    response: z.string(),
});

@Bot({
    id: 'docs-publisher',
    name: 'Docs Publisher',
    email: 'docs-publisher@bot.xyne.ai',
    picture: '/svgs/icons/knowledgebase.svg',
    description: 'System bot for docs publishing notifications',
    inputSchema: DocsPublisherInputSchema,
    outputSchema: DocsPublisherOutputSchema,
    scope: 'all',
    interactionMode: 'execute',
})
export class DocsPublisherBot extends UnifiedBaseBot<DocsPublisherInput, DocsPublisherOutput> {
    protected readonly definition: InternalBotDefinition<DocsPublisherInput, DocsPublisherOutput> = {
        id: 'docs-publisher',
        name: 'Docs Publisher',
        email: 'docs-publisher@bot.xyne.ai',
        picture: '/svgs/icons/knowledgebase.svg',
        description: 'System bot for docs publishing notifications',
        runtimeType: 'internal',
        inputSchema: DocsPublisherInputSchema,
        outputSchema: DocsPublisherOutputSchema,
        scope: 'all',
    };

    protected async *executeInternal(
        _input: DocsPublisherInput,
        _context: BotExecutionContext
    ): AsyncGenerator<BotEvent> {
        // This bot doesn't execute commands - it's used only as a sender for docs publishing notifications
        yield this.createErrorEvent(
            'This bot does not accept commands. It is used internally for sending docs publishing notifications.',
            { channelId: _context.channelId }
        );
    }
}
