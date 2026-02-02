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

import { config } from '@/config/env';
import { botCatalog, type ExternalBotDefinition } from '@/bots/unified/index.js';

// =============================================================================
// INTERNAL BOTS - Import to trigger @Bot decorator registration
// =============================================================================

// LLM Bot - dummy bot for testing
import '@/bots/implementations/llm-bot/llm-bot.js';

// Ticket Bot - creates tickets with workflow automation
import '@/bots/implementations/ticket-bot/ticket-bot.js';

// Docs Publisher Bot - system bot for docs publishing notifications
import '@/bots/implementations/docs-publisher/docs-publisher.js';

// Xyne Automatic Bot - system bot for posting automated messages like call summaries
import '@/bots/implementations/xyne-automatic/xyne-automatic.js';

import {logger} from '@/utils/logger';

// Bitbucket Bot - system bot for Bitbucket webhook events
import '@/bots/implementations/bitbucket-bot/bitbucket-bot.js';

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
  {
    id: 'genius',
    name: 'Genius AI',
    email: 'genius@bot.xyne.ai',
    picture: '/assets/bots/genius-avatar.png',
    description: 'AI-powered analytics assistant for business insights',
    runtimeType: 'external',
    scope: 'all',
    interactionMode: 'dm',
    externalApi: {
      endpoint: config.genius.apiUrl + '/api/v3/query_routing/',
      method: 'POST',
      authType: 'api_key',
      authEnvVar: 'QUERY_ROUTING_KEY',
      authHeader: 'Authorization',
      responseType: 'streaming',
      headers: {
        Accept: 'text/event-stream',
      },
      requestBodyTemplate: {
        query: '{{message}}',
        agent: 'analytics',
        source: 'xyne_spaces',
        email: '{{userEmail}}',
      },
      contextConfig: {
        includeHistory: false,
        maxHistoryMessages: 0,
      },
      sseParser: 'genius',
      toolOutputTransformer: 'genius',
    },
  },
  {
    id: 'genius_deep_rca',
    name: 'Genius Deep RCA',
    email: 'genius-deep-rca@bot.xyne.ai',
    picture: '/assets/bots/genius-avatar.png',
    description: 'AI-powered deep investigation assistant for root cause analysis of complex incidents',
    runtimeType: 'external',
    scope: 'all',
    interactionMode: 'dm',
    externalApi: {
      endpoint: config.genius.apiUrl + '/api/v3/query_routing/',
      method: 'POST',
      authType: 'api_key',
      authEnvVar: 'QUERY_ROUTING_KEY',
      authHeader: 'Authorization',
      responseType: 'streaming',
      headers: {
        Accept: 'text/event-stream',
      },
      requestBodyTemplate: {
        query: '{{message}}',
        agent: 'investigation',
        source: 'xyne_spaces',
        email: '{{userEmail}}',
      },
      contextConfig: {
        includeHistory: false,
        maxHistoryMessages: 0,
      },
      sseParser: 'genius',
      toolOutputTransformer: 'genius',
    },
  },
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

/**
 * Get all external bot definitions (for inspection/debugging)
 */
export function getExternalBotDefinitions(): ExternalBotDefinition[] {
  return [...externalBots];
}

/**
 * Check if a bot ID is an external bot
 */
export function isExternalBotId(botId: string): boolean {
  return externalBots.some((bot) => bot.id === botId);
}
