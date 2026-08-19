import express, { type Request, type Response } from 'express';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';
import { emailFetchQueue } from '@/queues/emailFetchQueue';
import { InteractionReplyValidationError } from '../core/baseInteractionReplySender';
import { ExternalSourcePlatform } from '../core/types';
import { SOCIAL_MEDIA_SOURCE_TYPES } from '../social-media/constants';
import { socialMediaService } from '../social-media/socialMediaService';
import {
  authorizeSocialMediaManager,
  canAccessSocialMediaChannel,
} from './social-media/access';
import googlePlayRoutes from './social-media/google-play';
import instagramRoutes from './social-media/instagram';

const TAG = '[SocialMediaRoutes]';
const router = express.Router();

router.use(express.json());
router.use(googlePlayRoutes);
router.use(instagramRoutes);

// POST /:conversationId/reply
// Provider-agnostic — works for any SOCIAL_MEDIA source registered in adapterRegistry
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
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const access = await canAccessSocialMediaChannel(conversation.channelId, req.user!.id, workspaceId);
      if (!access) {
        res.status(404).json({ error: 'Conversation not found' });
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
      logger.error(`${TAG} Failed to send reply`, {
        conversationId: req.params.conversationId,
        error,
      });
      res.status(500).json({ error: 'Failed to send reply' });
    }
  },
);

// GET /:channelId/customer-history?conversationId=xxx
// Returns previous tickets from the same Instagram customer (IGSID) in this channel.
router.get(
  '/:channelId/customer-history',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const { channelId } = req.params;
      const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : '';

      if (!conversationId) {
        res.status(400).json({ error: 'conversationId is required' });
        return;
      }

      if (!(await canAccessSocialMediaChannel(channelId, req.user!.id, workspaceId))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const source = await db.externalSource.findFirst({
        where: {
          channelId,
          workspaceId,
          sourceType: { in: Object.values(SOCIAL_MEDIA_SOURCE_TYPES) },
          isActive: true,
        },
        select: { id: true },
      });
      if (!source) {
        res.json({ igsid: null, tickets: [] });
        return;
      }

      const emails = await db.email.findMany({
        where: { conversationId },
        select: { id: true },
      });
      const emailIds = emails.map(e => e.id);

      const extMsg = emailIds.length > 0
        ? await db.externalMessage.findFirst({
            where: {
              externalSourceId: source.id,
              entityType: 'EMAIL',
              direction: 'INCOMING',
              entityId: { in: emailIds },
            },
            select: { externalThreadId: true },
          })
        : null;

      if (!extMsg) {
        res.json({ igsid: null, tickets: [] });
        return;
      }

      const igsid = extMsg.externalThreadId.split(':')[0];
      if (!igsid) {
        res.json({ igsid: null, tickets: [] });
        return;
      }

      const relatedExtMsgs = await db.externalMessage.findMany({
        where: {
          externalSourceId: source.id,
          externalThreadId: { startsWith: `${igsid}:` },
          direction: 'INCOMING',
          entityType: 'EMAIL',
        },
        distinct: ['externalThreadId'],
        select: { entityId: true },
      });

      const relatedEmailIds = relatedExtMsgs
        .map(m => m.entityId)
        .filter((id): id is string => !!id && !emailIds.includes(id));

      const relatedEmails = relatedEmailIds.length > 0
        ? await db.email.findMany({
            where: { id: { in: relatedEmailIds } },
            select: { conversationId: true },
          })
        : [];

      const relatedConversationIds = [...new Set(
        relatedEmails
          .map(e => e.conversationId)
          .filter((id): id is string => !!id && id !== conversationId),
      )];

      if (relatedConversationIds.length === 0) {
        res.json({ igsid, tickets: [] });
        return;
      }

      const tickets = await db.ticket.findMany({
        where: {
          conversationId: { in: relatedConversationIds },
          channelId,
        },
        select: {
          id: true,
          xyneId: true,
          title: true,
          stageName: true,
          createdAt: true,
          conversationId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      res.json({ igsid, tickets });
    } catch (error) {
      logger.error(`${TAG} Failed to fetch customer history`, { error });
      res.status(500).json({ error: 'Failed to fetch customer history' });
    }
  },
);

// POST /:channelId/sync — manual sync trigger for polling sources (e.g. Google Play)
router.post(
  '/:channelId/sync',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res))
      ) {
        return;
      }

      const sources = await db.externalSource.findMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
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
  },
);

// POST /:channelId/disconnect — deactivate all sources on a channel
router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      if (
        !(await authorizeSocialMediaManager(req.params.channelId, req.user!.id, workspaceId, res))
      ) {
        return;
      }

      const result = await db.externalSource.updateMany({
        where: {
          channelId: req.params.channelId,
          workspaceId,
          sourceType: {
            in: [ExternalSourcePlatform.GOOGLE_PLAY, SOCIAL_MEDIA_SOURCE_TYPES.INSTAGRAM],
          },
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
  },
);

export default router;
