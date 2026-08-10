import express, { type Request, type Response } from 'express';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { InteractionReplyValidationError } from '../core/baseInteractionReplySender';
import { SOCIAL_MEDIA_SOURCE_TYPES } from '../social-media/constants';
import { socialMediaService } from '../social-media/socialMediaService';
import {
  authorizeSocialMediaManager,
  canAccessSocialMediaChannel,
} from './social-media/access';
import googlePlayRoutes from './social-media/google-play';

const TAG = '[SocialMediaRoutes]';
const router = express.Router();

router.use(express.json());
router.use(googlePlayRoutes);

router.post(
  '/:conversationId/reply',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const conversation = await db.conversation.findFirst({
        where: { conversationId: req.params.conversationId, workspaceId },
        select: { channelId: true },
      });
      if (
        !conversation ||
        !(await canAccessSocialMediaChannel(
          conversation.channelId,
          req.user!.id,
          workspaceId
        ))
      ) {
        res.status(404).json({ error: 'Review conversation not found' });
        return;
      }

      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const interaction = await socialMediaService.reply({
        conversationId: req.params.conversationId,
        workspaceId,
        userId: req.user!.id,
        body,
      });
      res.json({ interaction });
    } catch (error) {
      if (error instanceof InteractionReplyValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error(`${TAG} Failed to send review reply`, {
        conversationId: req.params.conversationId,
        error,
      });
      res.status(500).json({ error: 'Failed to send review reply' });
    }
  }
);

router.post(
  '/:channelId/sync',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(
          req.params.channelId,
          req.user!.id,
          workspaceId,
          res
        ))
      ) {
        return;
      }

      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: { in: Object.values(SOCIAL_MEDIA_SOURCE_TYPES) },
          isActive: true,
        },
        select: { id: true },
      });
      if (sources.length === 0) {
        res.status(404).json({ error: 'Active social media source not found' });
        return;
      }

      let synced = 0;
      for (const source of sources) {
        const result = await socialMediaService.syncSource(source.id, {
          ignoreSyncCursor: true,
        });
        synced += result.synced;
      }
      res.json({ synced, sourceCount: sources.length });
    } catch (error) {
      logger.error(`${TAG} Manual source sync failed`, { error });
      res.status(500).json({ error: 'Failed to synchronize review source' });
    }
  }
);

router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(
          req.params.channelId,
          req.user!.id,
          workspaceId,
          res
        ))
      ) {
        return;
      }

      const result = await db.externalSource.updateMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: { in: Object.values(SOCIAL_MEDIA_SOURCE_TYPES) },
        },
        data: { isActive: false },
      });
      if (result.count === 0) {
        res.status(404).json({ error: 'Social media source not found' });
        return;
      }

      res.json({
        message: 'Social media desk disconnected',
        sourceCount: result.count,
      });
    } catch (error) {
      logger.error(`${TAG} Failed to disconnect source`, { error });
      res.status(500).json({ error: 'Failed to disconnect social media source' });
    }
  }
);

export default router;
