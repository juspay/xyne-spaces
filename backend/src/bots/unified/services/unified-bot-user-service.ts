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
  private botUserCache = new Map<string, User>();

  /**
   * Sync all bots from the catalog to the database.
   * Should be called on app startup.
   */
  async syncAllBotUsers(workspaceId: string): Promise<void> {
    const allBots = botCatalog.getAll();
    logger.info(`[UnifiedBotUserService] Starting sync of ${allBots.length} bot(s) for workspace ${workspaceId}`);

    let synced = 0;
    let failed = 0;

    for (const entry of allBots) {
      const definition = entry.definition;
      try {
        const user = await this.ensureBotUserExists(definition, workspaceId);
        this.botUserCache.set(definition.id, user);
        botCatalog.setDbUserId(definition.id, user.id);
        logger.info(`[UnifiedBotUserService] [${workspaceId}] Synced bot "${definition.name}" (userId: ${user.id})`);
        synced++;
      } catch (error) {
        logger.error(`[UnifiedBotUserService] [${workspaceId}] Failed to sync bot "${definition.name}":`, error);
        failed++;
      }
    }

    logger.info(`[UnifiedBotUserService] Sync complete for workspace ${workspaceId}: ${synced} synced, ${failed} failed`);
  }

  /**
   * Ensure a bot user exists in the database.
   * Creates if not exists, updates if it does.
   * Also ensures bot is added to the workspace's org as a member.
   */
  async ensureBotUserExists(definition: BotDefinition, workspaceId: string): Promise<User> {
    // First, ensure bot is in org_member table
    await this.ensureBotInOrgMember(definition.email, workspaceId);

    // Fetch the orgMember for the bot
    const orgMember = await db.orgMember.findUnique({
      where: { email: definition.email },
      select: { memberId: true }
    });

    if (!orgMember) {
      throw new Error(`orgMember not found for bot email ${definition.email} after ensuring membership`);
    }

    const user = await db.user.upsert({
      where: { email_workspaceId: { email: definition.email, workspaceId } },
      create: {
        name: definition.name,
        email: definition.email,
        workspaceId: workspaceId,
        authProvider: AuthProvider.API_KEY,
        providerUserId: `bot_${definition.id}`,
        status: UserStatus.ACTIVE,
        userType: UserType.BOT,
        picture: definition.picture || null,
        orgMemberId: orgMember.memberId,
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

    return user;
  }

  /**
   * Ensure a bot user is in the org_member table for ACL access
   */
  private async ensureBotInOrgMember(botEmail: string, workspaceId: string): Promise<void> {
    try {
      // Get the workspace to find its orgId
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { orgId: true }
      });

      if (!workspace?.orgId) {
        logger.warn(`[UnifiedBotUserService] No orgId found for workspace ${workspaceId}, skipping org_member creation`);
        return;
      }

      const orgId = workspace.orgId;

      // Check if bot is already in org_member (globally unique email constraint)
      const existingMember = await db.orgMember.findUnique({
        where: { email: botEmail }
      });

      if (!existingMember) {
        await db.orgMember.create({
          data: {
            email: botEmail,
            orgId: orgId,
            role: 'MEMBER',
          }
        });
        logger.info(`[UnifiedBotUserService] Added bot '${botEmail}' to org_member for org ${orgId}`);
      } else if (existingMember.orgId !== orgId) {
        // Bot email exists but in a different org - this shouldn't happen with our design
        logger.warn(`[UnifiedBotUserService] Bot '${botEmail}' already exists in org ${existingMember.orgId}, cannot add to ${orgId}`);
      } else {
        // Bot already in this org - nothing to do
        logger.debug(`[UnifiedBotUserService] Bot '${botEmail}' already in org_member for org ${orgId}`);
      }
    } catch (error) {
      logger.error(`[UnifiedBotUserService] Failed to add bot to org_member:`, error);
      // Don't throw - this is not critical for bot functionality
    }
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
