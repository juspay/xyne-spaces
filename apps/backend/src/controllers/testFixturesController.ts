import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

/**
 * Test-only fixture endpoints, mounted under /api/test/* only when
 * config.isTestEnv. @security NEVER expose in production.
 */
export class TestFixturesController {
  private channelParticipantRepository: ChannelParticipantRepository;

  constructor() {
    this.channelParticipantRepository = new ChannelParticipantRepository();
  }

  /**
   * Add participants to a channel without going through the UI. Delegates to
   * ChannelParticipantRepository.addParticipant -- the same call createChannel
   * uses -- so participant, channelUserStatus and channelStats.participantCount
   * all land the way the product writes them.
   */
  addChannelParticipants = async (req: Request, res: Response): Promise<void> => {
    const requestId = `TEST_FIXTURE_PARTICIPANTS_${Date.now()}`;

    try {
      if (!config.isTestEnv) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Test fixture endpoints are only available when NODE_ENV=test',
        });
        return;
      }

      const { channelId, emails } = req.body as { channelId?: unknown; emails?: unknown };

      if (typeof channelId !== 'string' || !channelId) {
        res.status(400).json({ error: 'Invalid request', message: 'channelId is required' });
        return;
      }

      if (!Array.isArray(emails) || emails.length === 0) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'emails must be a non-empty array',
        });
        return;
      }

      const db = DatabaseClient.getInstance();

      const channel = await db.channel.findUnique({ where: { id: channelId } });
      if (!channel) {
        res.status(404).json({
          error: 'Channel not found',
          message: `No channel with id ${channelId}`,
        });
        return;
      }

      // Email is not unique on User (one row per workspace), so scope the
      // lookup to the channel's workspace and resolve everyone up front.
      const users = await db.user.findMany({
        where: { email: { in: emails as string[] }, workspaceId: channel.workspaceId },
        select: { id: true, email: true },
      });

      const found = new Set(users.map((u) => u.email));
      const missing = (emails as string[]).filter((email) => !found.has(email));
      if (missing.length > 0) {
        res.status(400).json({
          error: 'Unknown user email(s)',
          message: `Not found in workspace ${channel.workspaceId}: ${missing.join(', ')}`,
        });
        return;
      }

      for (const user of users) {
        await this.channelParticipantRepository.addParticipant(channelId, user.id, 'MEMBER');
      }

      logger.info(
        `[${requestId}] Added ${users.length} participant(s) to channel ${channelId}: ${users
          .map((u) => u.email)
          .join(', ')}`
      );

      res.status(200).json({
        success: true,
        message: 'Participants added',
        channelId,
        added: users.map((u) => ({ userId: u.id, email: u.email })),
      });
    } catch (error) {
      logger.error(`[${requestId}] Failed to add channel participants:`, error);

      res.status(500).json({
        error: 'Failed to add channel participants',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
