import { Request, Response } from 'express';
import { z } from 'zod';
import { ChannelRole, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { callController } from '@/api/sdk/direct';
import { SdkApiError } from '@/api/sdk/errors';
import { ChannelController } from '@/controllers/channelController';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { GuestError } from '../core/guestUtils';
import { findMembers, findProject } from '../utils/channelUtils';

const email = z.string().trim().toLowerCase().email().max(254);

const CreateChannelBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(250).optional(),
    adminEmails: z.array(email).max(100).default([]),
    memberEmails: z.array(email).max(100).default([]),
    projectName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const channelController = new ChannelController();

export class AppChannelController {
  /**
   * Create a private channel as the app's bot, with the given admins and members
   * POST /api/apps/channel/create
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = CreateChannelBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    const input = bodyResult.data;
    const app = {
      installedAppId: (req as any).auth.installedAppId,
      botUserId: req.user!.id,
      workspaceId: req.user!.workspaceId!,
    };

    try {
      const adminEmails = [...new Set(input.adminEmails)];
      const memberEmails = [...new Set(input.memberEmails)].filter((e) => !adminEmails.includes(e));
      const adminIds = await findMembers(app, adminEmails);
      const memberIds = await findMembers(app, memberEmails);
      const projectId = input.projectName ? await findProject(app, input.projectName) : undefined;

      // The bot creates it, so it is the channel's admin and may give it to guests.
      const { body } = await callController(
        {
          method: 'post',
          path: '/channel/create',
          controller: channelController.createChannel,
          mapBody: () => ({
            scopeType: ChannelScopeType.DEFAULT,
            name: input.name,
            description: input.description,
            visibility: ChannelVisibility.PRIVATE,
            participants: [...adminIds, ...memberIds],
            ...(projectId && { projectId }),
          }),
        },
        req,
      );
      const channel = body as { id: string; name: string };
      // As the channel's creator the bot is its admin, so it may promote others.
      for (const userId of adminIds) {
        await repositories.channelParticipants.updateParticipantRole(channel.id, userId, ChannelRole.ADMIN);
      }
      res.status(201).json({ channelId: channel.id, name: channel.name });
    } catch (error) {
      if (error instanceof GuestError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof SdkApiError && error.status < 500) {
        res.status(error.status).json({ error: error.message, code: error.code.toUpperCase() });
        return;
      }
      logger.error('[APP-CHANNEL] Channel create failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
