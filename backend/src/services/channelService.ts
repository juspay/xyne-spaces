import { ChannelRepository, CreateChannelInput } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { ChannelScopeType, ChannelVisibility } from '@prisma/client';
import { logger } from '../utils/logger';


export class ChannelService {
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private projectRepository: ProjectRepository;

  constructor() {
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.projectRepository = new ProjectRepository();
  }

  async ensureSelfDmExists(userId: string, workspaceId: string): Promise<string> {
    try {

      const existingSelfDm = await this.channelRepository.getDMChannel(userId, userId);

      if (existingSelfDm) {
        logger.debug(`[ChannelService] Self-DM already exists for user ${userId}: ${existingSelfDm.id}`);
        return existingSelfDm.id;
      }

      const dmProjectId = await this.projectRepository.getDMProjectId(workspaceId);
      if (!dmProjectId) {
        logger.error(`[ChannelService] DM project not found for workspace ${workspaceId}`);
        throw new Error('DM project not found for workspace');
      }

      const channelData: CreateChannelInput = {
        scopeType: ChannelScopeType.DM,
        name: userId,
        description: 'Saved messages',
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userId,
        projectId: dmProjectId,
        workspaceId,
      };

      const channel = await this.channelRepository.create(channelData);

      await this.channelParticipantRepository.addParticipant(channel.id, userId, 'ADMIN');

      logger.info(`[ChannelService] Created self-DM channel for user ${userId}: ${channel.id}`);

      return channel.id;
    } catch (error) {
      logger.error(`[ChannelService] Error ensuring self-DM for user ${userId}:`, error);
      throw error;
    }
  }

  async getSelfDmId(userId: string): Promise<string | null> {
    try {
      const selfDm = await this.channelRepository.getDMChannel(userId, userId);
      return selfDm?.id ?? null;
    } catch (error) {
      logger.error(`[ChannelService] Error getting self-DM for user ${userId}:`, error);
      return null;
    }
  }
}

export const channelService = new ChannelService();
