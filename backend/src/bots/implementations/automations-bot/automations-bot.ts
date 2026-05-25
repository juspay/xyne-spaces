import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type {
  BotExecutionContext,
  InternalBotDefinition,
  BotEvent,
} from '@/bots/unified/types/index.js';

type AutomationsBotInput = { message: string };
type AutomationsBotOutput = { response: string };

const AutomationsBotInputSchema = z.object({
  message: z.string(),
});

const AutomationsBotOutputSchema: z.ZodType<AutomationsBotOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'automations',
  name: 'Automations',
  email: 'automations@bot.xyne.ai',
  description: 'System bot that posts messages on behalf of the automations builder',
  inputSchema: AutomationsBotInputSchema,
  outputSchema: AutomationsBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class AutomationsBot extends UnifiedBaseBot<AutomationsBotInput, AutomationsBotOutput> {
  protected readonly definition: InternalBotDefinition<
    AutomationsBotInput,
    AutomationsBotOutput
  > = {
    id: 'automations',
    name: 'Automations',
    email: 'automations@bot.xyne.ai',
    description: 'System bot that posts messages on behalf of the automations builder',
    runtimeType: 'internal',
    inputSchema: AutomationsBotInputSchema,
    outputSchema: AutomationsBotOutputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    input: AutomationsBotInput,
    context: BotExecutionContext,
  ): AsyncGenerator<BotEvent> {
    void input;
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally as the sender for automation-posted messages.',
      { channelId: context.channelId },
    );
  }
}
