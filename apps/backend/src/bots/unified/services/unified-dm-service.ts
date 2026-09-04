/**
 * Unified Bot Framework - DM Service
 *
 * Manages DM (Direct Message) channels between users and bots.
 * Works with any bot from the unified catalog.
 */

import { Channel } from '@prisma/client';
import { ChannelScopeType, ChannelVisibility, ChannelRole } from '@xyne/shared';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ChannelUserStatusRepository } from '@/database/repositories/channelUserStatusRepository';
import { botCatalog } from '../index.js';
import { unifiedBotUserService } from './unified-bot-user-service.js';
import {logger} from '@/utils/logger';

const channelRepository = new ChannelRepository();
const channelParticipantRepository = new ChannelParticipantRepository();
const channelUserStatusRepository = new ChannelUserStatusRepository();

/**
 * Unified DM Service
 *
 * Handles DM channel operations for bots.
 */
class UnifiedDMService {
  /**
   * Get or create a DM channel between a user and a bot.
   * If a DM already exists, returns it. Otherwise, creates a new one.
   *
   * @param userId - The human user's ID
   * @param botUserId - The bot user's database ID
   */
  async getOrCreateBotDM(userId: string, botUserId: string, workspaceId: string): Promise<Channel> {
    // Check for existing DM
    const existingDM = await channelRepository.getDMChannel(userId, botUserId);
    if (existingDM) {
      // Ensure participants exist (fix for channels created without participants)
      const participants = await channelParticipantRepository.getChannelParticipants(existingDM.id);
      const participantIds = new Set(participants.map((p) => p.userId));

      // Add missing participants
      if (!participantIds.has(userId)) {
        await channelParticipantRepository.addParticipant(existingDM.id, userId, ChannelRole.ADMIN, false);
        logger.info(`[UnifiedDMService] Added missing participant ${userId} to DM ${existingDM.id}`);
      }
      if (!participantIds.has(botUserId)) {
        await channelParticipantRepository.addParticipant(existingDM.id, botUserId, ChannelRole.MEMBER, false);
        logger.info(`[UnifiedDMService] Added missing participant ${botUserId} to DM ${existingDM.id}`);
      }

      // Reopen the DM if it was closed
      await channelUserStatusRepository.reopenForAllParticipants(existingDM.id);
      return existingDM;
    }

    // Create new DM channel with bot
    const channelName = [userId, botUserId].sort().join(',');
    // Concurrency-safe: partial unique index guards against duplicate bot DMs.
    const { channel } = await channelRepository.getOrCreateDmChannel({
      scopeType: ChannelScopeType.DM,
      name: channelName,
      visibility: ChannelVisibility.PRIVATE,
      createdBy: userId,
      projectId: 'default',
      workspaceId,
    });

    // Add participants
    await channelParticipantRepository.addParticipant(channel.id, userId, ChannelRole.ADMIN, false);
    await channelParticipantRepository.addParticipant(channel.id, botUserId, ChannelRole.MEMBER, false);

    logger.info(`[UnifiedDMService] Created DM channel: ${channel.id} between user ${userId} and bot ${botUserId}`);

    return channel;
  }

  /**
   * Get or create a DM channel using bot ID (catalog ID)
   *
   * @param userId - The human user's ID
   * @param botId - The bot ID from the catalog
   */
  async getOrCreateBotDMByBotId(userId: string, botId: string, workspaceId: string): Promise<Channel | null> {
    // Get bot user from catalog
    const entry = botCatalog.getById(botId);
    if (!entry) {
      logger.error(`[UnifiedDMService] Bot not found in catalog: ${botId}`);
      return null;
    }

    // Get the bot's database user ID
    let botUserId = entry.dbUserId;
    if (!botUserId) {
      // Try to resolve from user service
      const botUser = await unifiedBotUserService.getBotByBotId(botId, workspaceId);
      if (!botUser) {
        logger.error(`[UnifiedDMService] Bot user not found for: ${botId}`);
        return null;
      }
      botUserId = botUser.id;
    }

    return this.getOrCreateBotDM(userId, botUserId, workspaceId);
  }

  /**
   * Get the bot user ID in a DM channel
   * Returns null if the channel is not a bot DM
   */
  async getBotInDM(channelId: string): Promise<string | null> {
    const participants = await channelParticipantRepository.getChannelParticipants(channelId);

    for (const participant of participants) {
      const isBot = await unifiedBotUserService.isBot(participant.userId);
      if (isBot) return participant.userId;
    }

    return null;
  }

  /**
   * Get the bot ID (catalog ID) for a bot in a DM channel
   * Returns null if the channel is not a bot DM
   */
  async getBotIdInDM(channelId: string): Promise<string | null> {
    const botUserId = await this.getBotInDM(channelId);
    if (!botUserId) return null;

    const definition = await unifiedBotUserService.getBotDefinition(botUserId);
    return definition?.id ?? null;
  }

  async getOrCreateDirectMessage(userAId: string, userBId: string, workspaceId: string): Promise<string> {
    const channel = await this.getOrCreateBotDM(userAId, userBId, workspaceId);
    return channel.id;
  }
}

// Export singleton instance
export const unifiedDMService = new UnifiedDMService();
