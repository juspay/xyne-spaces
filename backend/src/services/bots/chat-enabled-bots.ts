/**
 * Chat-enabled bots: bots that respond to @mentions in channels and thread replies.
 * Add a bot ID here to allow it to respond to channel/thread @mentions.
 * Only bots with interactionMode: 'dm' in their definition are eligible.
 */
export const CHAT_ENABLED_BOT_IDS: ReadonlySet<string> = new Set([
  'ask-ai',
]);
