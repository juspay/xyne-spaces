import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';

const AUTOMATIONS_BOT_ID = 'automations';
const cachedBotUserIdByWorkspace = new Map<string, string>();

/**
 * Resolves the user id of the workspace's automations system bot — the sender
 * used when an action step posts without an explicit `senderId`.
 */
export async function getAutomationsBotUserId(workspaceId: string): Promise<string> {
  const cached = cachedBotUserIdByWorkspace.get(workspaceId);
  if (cached) return cached;
  const bot = await unifiedBotUserService.getBotByBotId(AUTOMATIONS_BOT_ID, workspaceId);
  if (!bot) {
    throw new Error(
      `[automations] System bot "${AUTOMATIONS_BOT_ID}" not found in workspace ${workspaceId}. Make sure '@/bots/implementations/automations-bot/automations-bot.js' is imported in the bot registry.`,
    );
  }
  cachedBotUserIdByWorkspace.set(workspaceId, bot.id);
  return bot.id;
}
