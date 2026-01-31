import { botRegistry } from './bot-registry';

/**
 * Get bot information by bot name
 */
export function getBotInfo(botName: string): { id: string; name: string; email: string; picture: string | undefined } | null {
  const botEntry = botRegistry.getBot(botName);
  if (!botEntry) {
    return null;
  }

  // Create bot instance to get info
  const botInstance = new botEntry.botClass();
  return botInstance.getBotInfo();
}

/**
 * Check if a given ID is a registered bot
 */
export function isRegisteredBot(id: string): boolean {
  return botRegistry.getBot(id) !== null;
}