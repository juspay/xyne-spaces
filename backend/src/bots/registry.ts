/**
 * Unified Bot Registry
 *
 * Single source for registering ALL bots (both internal and external).
 * This file consolidates bot registration that was previously split across
 * decorator imports and bots.config.ts.
 *
 * Usage:
 * - Internal bots: Import the class (decorator auto-registers with catalog)
 * - External bots: Define inline and register with catalog
 */

import { botCatalog, type ExternalBotDefinition } from '@/bots/unified/index.js';

// =============================================================================
// INTERNAL BOTS - Import to trigger @Bot decorator registration
// =============================================================================

// Ticket Bot - creates tickets with workflow automation
import '@/bots/implementations/ticket-bot/ticket-bot.js';


// Xyne Automatic Bot - system bot for posting automated messages like call summaries
import '@/bots/implementations/xyne-automatic/xyne-automatic.js';

// Xyne Mail Bot - system bot for posting inbound channel email messages
import '@/bots/implementations/xyne-mail/xyne-mail.js';

// Automations Bot - system bot for messages posted by the SEND_MESSAGE step in the automations builder
import '@/bots/implementations/automations-bot/automations-bot.js';

// Xyne Release Bot - system bot for posting release notes canvases to threads
import '@/bots/implementations/xyne-release-bot/xyne-release-bot.js';

import { logger } from '@/utils/logger';

// Bitbucket Bot - system bot for Bitbucket webhook events
import '@/bots/implementations/bitbucket-bot/bitbucket-bot.js';

import '@/bots/implementations/qa-alert-bot/qa-alert-bot.js';

// Support Bot - system bot for IT support responses
import '@/bots/implementations/support-bot/support-bot.js';

// Add more internal bot imports here...
// import '@/bots/implementations/my-bot/my-bot.js';

// =============================================================================
// EXTERNAL BOTS - Define and register config-based bots
// =============================================================================

/**
 * All external bot configurations.
 * External bots call external APIs and don't have TypeScript implementations.
 */
const externalBots: ExternalBotDefinition[] = [
  // Add more external bots here...
  // {
  //   id: 'another-bot',
  //   name: 'Another Bot',
  //   ...
  // },
];

// =============================================================================
// REGISTRATION FUNCTIONS
// =============================================================================

/**
 * Register all external bots with the unified catalog.
 * Internal bots are auto-registered via their @Bot decorator imports above.
 */
function registerExternalBots(): void {
  logger.info(`[BotRegistry] Registering ${externalBots.length} external bot(s)...`);

  for (const definition of externalBots) {
    try {
      botCatalog.registerExternal(definition);
    } catch (error) {
      logger.error(`[BotRegistry] Failed to register external bot "${definition.name}":`, error);
    }
  }
}

/**
 * Initialize the bot registry.
 * This function:
 * 1. Internal bots are already registered via imports at the top of this file
 * 2. Registers all external bots
 *
 * Should be called during app initialization.
 */
export function initializeBotRegistry(): void {
  logger.info('[BotRegistry] Initializing bot registry...');

  // Register external bots (internal bots already registered via imports)
  registerExternalBots();

  logger.info(`[BotRegistry] Bot registry initialized with ${botCatalog.count} bot(s)`);
}
