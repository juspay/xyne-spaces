import { Request, Response } from 'express';
import { z } from 'zod';
import { ChannelRole, ChannelScopeType, ChannelVisibility, UserStatus } from '@xyne/shared';
import { callController } from '@/api/sdk/direct';
import { SdkApiError } from '@/api/sdk/errors';
import { setAppChannelOnDesk } from '@/channelsDesk/admin';
import { channelsDeskOf } from '@/channelsDesk/desk';
import { ChannelController } from '@/controllers/channelController';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { ChannelFieldError, prepareChannelFields, writeChannelFields } from '@/services/channelFieldService';
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
    /** Channel fields by name, e.g. { "Merchant ID": "M123" }. */
    fields: z.record(z.string(), z.unknown()).optional(),
    /** Put it on the app's Channels desk, so its new threads become tickets there. */
    desk: z.boolean().optional(),
  })
  .strict();

const ListParticipantsQuerySchema = z
  .object({
    channelId: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const NO_DESK = { error: 'This app has no Channels desk yet; an admin links one in Desks.', code: 'NO_DESK' };

const channelController = new ChannelController();

export class AppChannelController {
  /**
   * Create a private channel as the app's bot, with the given admins and members
   * POST /api/apps/channel/create
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = CreateChannelBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.issues });
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
      // Checked before the channel exists, so a bad field or a missing desk never leaves a channel half set up.
      const fields = await prepareChannelFields(app.workspaceId, input.fields ?? {});
      if (input.desk && !(await channelsDeskOf(app.installedAppId))) {
        res.status(400).json(NO_DESK);
        return;
      }

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
      if (fields) await writeChannelFields(app.workspaceId, channel.id, fields);
      const onDesk = input.desk ? (await setAppChannelOnDesk(app, channel.id, true)) === 'done' : false;
      res.status(201).json({ channelId: channel.id, name: channel.name, desk: onDesk });
    } catch (error) {
      if (error instanceof ChannelFieldError) {
        res.status(400).json({ error: error.message, code: error.code });
        return;
      }
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

  /**
   * List the active participants of a channel the app's bot is in
   * GET /api/apps/channel/participants?channelId=&limit=&cursor=
   */
  listParticipants = async (req: Request, res: Response): Promise<void> => {
    const queryResult = ListParticipantsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: queryResult.error.issues });
      return;
    }
    const { channelId, limit, cursor } = queryResult.data;
    const workspaceId = req.user!.workspaceId!;

    try {
      // Same rule as update and add: the bot must be in the channel, so one app can't read another's channels.
      const inChannel = await db.channelParticipant.findFirst({
        where: { channelId, userId: req.user!.id, workspaceId },
        select: { channelId: true },
      });
      if (!inChannel) {
        res.status(403).json({ error: `${channelId} is not a channel this app is in.`, code: 'CHANNEL_NOT_ALLOWED' });
        return;
      }
      const rows = await db.channelParticipant.findMany({
        where: {
          channelId,
          workspaceId,
          user: { workspaceId, status: UserStatus.ACTIVE, leftAt: null },
          ...(cursor && { id: { gt: cursor } }),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        select: { id: true, userId: true, user: { select: { email: true } } },
      });
      const page = rows.slice(0, limit);
      res.status(200).json({
        channelId,
        participants: page.map((row) => ({ userId: row.userId, email: row.user.email })),
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      });
    } catch (error) {
      logger.error('[APP-CHANNEL] List participants failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
