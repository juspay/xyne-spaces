import express, { type Request, type Response } from 'express';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';
import { emailFetchQueue } from '@/queues/emailFetchQueue';
import { InteractionReplyValidationError } from '../core/baseInteractionReplySender';
import { ExternalSourcePlatform } from '../core/types';
import { SOCIAL_MEDIA_PLATFORMS } from '../social-media/constants';
import { socialMediaService } from '../social-media/socialMediaService';
import {
  authorizeSocialMediaManager,
  canAccessSocialMediaChannel,
} from './social-media/access';
import googlePlayRoutes from './social-media/google-play';
import appStoreRoutes from './social-media/app-store';

const TAG = '[SocialMediaRoutes]';
const router = express.Router();

router.use(express.json());
router.use(googlePlayRoutes);
router.use(appStoreRoutes);

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
        !(await canAccessSocialMediaChannel(
          req.params.channelId,
          req.user!.id,
          workspaceId
        ))
      ) {
        res.status(404).json({ error: 'Social media desk not found' });
        return;
      }

      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: { in: [...SOCIAL_MEDIA_PLATFORMS] },
          isActive: true,
        },
        select: { id: true },
      });
      if (sources.length === 0) {
        res.status(404).json({ error: 'Active social media source not found' });
        return;
      }

      if (appConfig.enableEmailFetchWorker) {
        if (!emailFetchQueue.isReady) await emailFetchQueue.initialize();
        const job = await emailFetchQueue.getQueue().add('social-media-refetch', {
          sourceIds: sources.map((source) => source.id),
          channelId: req.params.channelId,
          requesterUserId: req.user!.id,
          workspaceId,
        });
        res.status(202).json({
          success: true,
          queued: true,
          jobId: String(job.id),
        });
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
          sourceType: { in: [...SOCIAL_MEDIA_PLATFORMS] },
        },
        data: { isActive: false },
      });
      if (result.count === 0) {
        res.status(404).json({ error: 'Social media source not found' });
        return;
      }

      // An App Store .p8 is a team-wide key with no programmatic revocation, so disconnecting a
      // desk must actually destroy our copy. Play's refresh token is scoped and user-revocable,
      // and its reconnect path re-consents, so it is left alone here.
      await db.externalSource.updateMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.APP_STORE,
        },
        data: { credentials: '' },
      });

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
