/**
 * Unified Bot Framework - Bot User Service
 *
 * Manages bot users in the database. Syncs bots from the catalog
 * to the User table with authProvider: 'API_KEY' and userType: 'BOT'.
 */

import { User, AuthProvider, UserStatus, UserType } from '@prisma/client';
import { db } from '@/database/client';
import { botCatalog, type BotDefinition } from '../index.js';
import {logger} from '@/utils/logger';

/**
 * Bot user info for API responses
 */
export interface UnifiedBotInfo {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  description: string;
  botId: string;
}

/**
 * Unified Bot User Service
 *
 * Syncs all bots from the unified catalog to the database.
 * Each bot gets a User record with authProvider: 'API_KEY' and userType: 'BOT'.
 */
class UnifiedBotUserService {
  private initialized = false;
  private botUserCache = new Map<string, User>();

  /**
   * Sync all bots from the catalog to the database.
   * Should be called on app startup.
   */
  async syncAllBotUsers(): Promise<void> {
    if (this.initialized) {
      logger.info('[UnifiedBotUserService] Already initialized, skipping...');
      return;
    }

    const allBots = botCatalog.getAll();
    logger.info(`[UnifiedBotUserService] Syncing ${allBots.length} bot user(s)...`);

    for (const entry of allBots) {
      const definition = entry.definition;
      try {
        const user = await this.ensureBotUserExists(definition);
        this.botUserCache.set(definition.id, user);

        // Update catalog with db user ID
        botCatalog.setDbUserId(definition.id, user.id);

        logger.info(`[UnifiedBotUserService] Bot "${definition.name}" synced (userId: ${user.id})`);
      } catch (error) {
        logger.error(`[UnifiedBotUserService] Failed to sync bot "${definition.name}":`, error);
      }
    }

    this.initialized = true;
    logger.info('[UnifiedBotUserService] Bot sync complete');
  }

  /**
   * Ensure a bot user exists in the database.
   * Creates if not exists, updates if it does.
   */
  async ensureBotUserExists(definition: BotDefinition): Promise<User> {
    return await db.user.upsert({
      where: { email: definition.email },
      create: {
        name: definition.name,
        email: definition.email,
        authProvider: AuthProvider.API_KEY,
        providerUserId: `bot_${definition.id}`,
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
        picture: definition.picture || null,
        metadata: {
          botId: definition.id,
          description: definition.description,
        },
      },
      update: {
        name: definition.name,
        picture: definition.picture || null,
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
        metadata: {
          botId: definition.id,
          description: definition.description,
        },
      },
    });
  }

  /**
   * Get a bot user by their database ID
   */
  async getBotById(id: string): Promise<User | null> {
    return await db.user.findFirst({
      where: {
        id,
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
      },
    });
  }

  /**
   * Get a bot user by their email
   */
  async getBotByEmail(email: string): Promise<User | null> {
    return await db.user.findFirst({
      where: {
        email,
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
      },
    });
  }

  /**
   * Get a bot user by their bot ID (catalog ID)
   */
  async getBotByBotId(botId: string): Promise<User | null> {
    // Check cache first
    const cached = this.botUserCache.get(botId);
    if (cached) return cached;

    // Get from catalog
    const entry = botCatalog.getById(botId);
    if (!entry) return null;

    // Query by email
    const user = await this.getBotByEmail(entry.definition.email);
    if (user) {
      this.botUserCache.set(botId, user);
    }

    return user;
  }

  /**
   * Get all active bot users
   */
  async getAllBots(): Promise<User[]> {
    return await db.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get all bots with their info
   */
  async getAllBotsWithInfo(): Promise<UnifiedBotInfo[]> {
    const bots = await this.getAllBots();

    return bots.map((bot) => {
      const metadata = bot.metadata as Record<string, unknown> | null;
      const botId = (metadata?.botId as string) || '';
      const entry = botCatalog.getById(botId);

      return {
        id: bot.id,
        name: bot.name,
        email: bot.email,
        picture: bot.picture,
        description: (metadata?.description as string) || entry?.definition.description || '',
        botId,
      };
    });
  }

  /**
   * Search bots by name or description
   */
  async searchBots(query: string): Promise<UnifiedBotInfo[]> {
    const allBots = await this.getAllBotsWithInfo();
    const lowerQuery = query.toLowerCase();

    return allBots.filter(
      (bot) =>
        bot.name.toLowerCase().includes(lowerQuery) ||
        bot.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Check if a user is a bot
   */
  async isBot(userId: string): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { userType: true },
    });

    return user?.userType === UserType.BOT;
  }

  /**
   * Get bot definition for a user ID
   */
  async getBotDefinition(userId: string): Promise<BotDefinition | undefined> {
    const user = await this.getBotById(userId);
    if (!user) return undefined;

    const metadata = user.metadata as Record<string, unknown> | null;
    const botId = metadata?.botId as string;
    if (!botId) return undefined;

    return botCatalog.getById(botId)?.definition;
  }
}

// Export singleton instance
export const unifiedBotUserService = new UnifiedBotUserService();
