/**
 * External Source Registry
 * Registers external sources (Zoho, Slack, etc.) as "display-only bots"
 * so they appear with proper names in the UI
 */

import { botRegistry } from '@/bots/core/bot-registry';
import { BaseBot } from '@/bots/core/base-bot';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { logger } from '@/utils/logger';
import { z } from 'zod';
import type { BotExecutionContext } from '@/bots/core/types/bot';

// Store display info for external sources
const externalSourceDisplayInfo = new Map<string, { name: string; email: string }>();
const DISPLAY_BOT_EXCLUDED_SOURCE_TYPES = new Set([
  'google_calendar',
  'microsoft_calendar',
  'sdlc_vcs_credential',
]);

/**
 * Register a single external source as a bot for display purposes
 */
export function registerExternalSource(
  sourceName: string,
  displayName: string,
  description?: string
) {
  try {
    const botId = `system-${sourceName}`;

    // Store display info for getBotInfo
    externalSourceDisplayInfo.set(botId, {
      name: displayName,
      email: `${sourceName}@external.xyne.com`,
    });

    // Create a minimal bot class for display-only purposes
    class ExternalSourceBot extends BaseBot<{}, {}> {
      protected readonly inputSchema = z.object({});
      protected readonly outputSchema = z.object({});
      protected readonly botName = botId;

      protected async executeInternal(
        _input: {},
        _context: BotExecutionContext
      ): Promise<{}> {
        throw new Error('External source bots are display-only and cannot be executed');
      }

      protected createInputFlowJson(_input: {}): any {
        throw new Error('External source bots do not support input FlowJson');
      }

      public getBotName(): string {
        return displayName;
      }

      public getBotEmail(): string {
        return `${displayName}@external.xyne.com`;
      }

      public getBotImage(): string | undefined {
        return undefined;
      }
    }

    botRegistry.registerBot(
      {
        name: botId,
        description: description || `External integration: ${displayName}`,
        category: 'external',
        tags: ['external-source', sourceName.split('-')[0]],
        scope: 'all',
      },
      {
        input: z.object({}),  // Empty schema - not executable
        output: z.object({}), // Empty schema - not executable
      },
      ExternalSourceBot
    );
    logger.info(`Registered external source as bot: ${sourceName} (${displayName})`);
  } catch (error) {
    logger.error(`Failed to register external source ${sourceName}:`, error);
  }
}

/**
 * Register all active external sources from the database
 * Called during app startup after database connection
 */
export async function registerAllExternalSources() {
  try {
    const repo = new ExternalSourceRepository();
    const sources = (await repo.findAll({ isActive: true })).filter(
      source => !DISPLAY_BOT_EXCLUDED_SOURCE_TYPES.has(source.sourceType),
    );

    logger.info(`Registering ${sources.length} active external sources as bots...`);

    for (const source of sources) {
      registerExternalSource(
        source.name,
        source.displayName
      );
    }

    logger.info(`Successfully registered ${sources.length} external sources`);
  } catch (error) {
    logger.error('Failed to register external sources:', error);
    // Don't throw - app can still start without external sources
  }
}
