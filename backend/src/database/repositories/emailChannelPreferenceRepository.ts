/**
 * Email Channel Preference Repository
 * Database operations for EmailChannelPreference model
 */

import { DatabaseClient } from '../client';
import { ChannelType } from '@prisma/client';

export class EmailChannelPreferenceRepository {
  private db = DatabaseClient.getInstance();

  /**
   * Validates that the channel is of type EMAIL
   * @throws Error if channel is not of type EMAIL or doesn't exist
   */
  private async validateEmailChannel(channelId: string): Promise<void> {
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
      select: { type: true, id: true },
    });

    if (!channel) {
      throw new Error(`Channel with id ${channelId} not found`);
    }

    if (channel.type !== ChannelType.EMAIL) {
      throw new Error(
        `Channel ${channelId} is not an EMAIL channel. EmailChannelPreference can only be created for EMAIL channels. Current type: ${channel.type}`
      );
    }
  }

  /**
   * Find preference by channel ID
   */
  async findByChannelId(channelId: string) {
    return await this.db.emailChannelPreference.findUnique({
      where: { channelId },
    });
  }

  /**
   * Create email channel preference
   * @throws Error if channel is not of type EMAIL
   */
  async create(data: {
    channelId: string;
    ownerUserId?: string;
    assigneeUserGroupId?: string;
    boardId?: string;
  }) {
    await this.validateEmailChannel(data.channelId);

    return await this.db.emailChannelPreference.create({
      data,
    });
  }

  /**
   * Update email channel preference
   * @throws Error if channel is not of type EMAIL
   */
  async update(
    channelId: string,
    data: {
      ownerUserId?: string;
      assigneeUserGroupId?: string;
      boardId?: string;
    }
  ) {
    await this.validateEmailChannel(channelId);

    return await this.db.emailChannelPreference.update({
      where: { channelId },
      data,
    });
  }

  /**
   * Upsert email channel preference (one entry per channel)
   * @throws Error if channel is not of type EMAIL
   */
  async upsert(data: {
    channelId: string;
    ownerUserId?: string;
    assigneeUserGroupId?: string;
    boardId?: string;
  }) {
    await this.validateEmailChannel(data.channelId);

    return await this.db.emailChannelPreference.upsert({
      where: { channelId: data.channelId },
      create: data,
      update: {
        ...(data.ownerUserId !== undefined && { ownerUserId: data.ownerUserId }),
        ...(data.assigneeUserGroupId !== undefined && { assigneeUserGroupId: data.assigneeUserGroupId }),
        ...(data.boardId !== undefined && { boardId: data.boardId }),
      },
    });
  }

  /**
   * Delete email channel preference
   */
  async delete(channelId: string) {
    return await this.db.emailChannelPreference.delete({
      where: { channelId },
    });
  }
}
