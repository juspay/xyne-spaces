import { Request, Response } from 'express';
import { z } from 'zod';
import { ChannelRole, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { callController } from '@/api/sdk/direct';
import { SdkApiError } from '@/api/sdk/errors';
import { setAppChannelOnDesk } from '@/channelsDesk/admin';
import { channelsDeskOf } from '@/channelsDesk/desk';
import { ChannelController } from '@/controllers/channelController';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AppError } from '@/middleware/errorHandler';
import { addChannelParticipants, type AddedChannelParticipant } from '@/services/channelParticipantsService';
import { ChannelFieldError, prepareChannelFields, writeChannelFields } from '@/services/channelFieldService';
import { ChannelParticipantsSideEffectHandler } from '@/zero/side-effects/tables/channel-participants-handler';
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
    fields: z.record(z.unknown()).optional(),
    /** Put it on the app's Channels desk, so its new threads become tickets there. */
    desk: z.boolean().optional(),
  })
  .strict();

const UpdateChannelBodySchema = z
  .object({
    channelId: z.string().trim().min(1),
    fields: z.record(z.unknown()).optional(),
    /** On (true) or off (false) the app's Channels desk. */
    desk: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.fields !== undefined || body.desk !== undefined, { message: 'Give fields, desk or both' });

const AddParticipantsBodySchema = z
  .object({
    channelId: z.string().trim().min(1),
    adminEmails: z.array(email).max(100).default([]),
    memberEmails: z.array(email).max(100).default([]),
  })
  .strict()
  .refine((body) => body.adminEmails.length + body.memberEmails.length > 0, {
    message: 'Give at least one email in adminEmails or memberEmails',
  });

const ADD_PARTICIPANTS_ERROR_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  403: 'FORBIDDEN',
  404: 'CHANNEL_NOT_FOUND',
};

const NO_DESK = { error: 'This app has no Channels desk yet; an admin links one in Desks.', code: 'NO_DESK' };
const ON_OTHER_DESK = { error: 'This channel is already on another desk.', code: 'CHANNEL_ON_OTHER_DESK' };
const NOT_ELIGIBLE = {
  error: 'Only regular channels can go on a desk (not DMs, archived channels or desks).',
  code: 'CHANNEL_NOT_ELIGIBLE',
};

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
   * Add workspace members to a channel the app's bot is in
   * POST /api/apps/channel/participants
   */
  addParticipants = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = AddParticipantsBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    const { channelId } = bodyResult.data;
    const app = {
      installedAppId: (req as any).auth.installedAppId,
      botUserId: req.user!.id,
      workspaceId: req.user!.workspaceId!,
    };

    try {
      // The bot must be in the channel, as for update; the service then applies the channel's add-user policy to it.
      const inChannel = await db.channelParticipant.findFirst({
        where: { channelId, userId: req.user!.id, workspaceId: app.workspaceId },
        select: { channelId: true },
      });
      if (!inChannel) {
        res.status(403).json({ error: `${channelId} is not a channel this app is in.`, code: 'CHANNEL_NOT_ALLOWED' });
        return;
      }
      const adminEmails = [...new Set(bodyResult.data.adminEmails)];
      const memberEmails = [...new Set(bodyResult.data.memberEmails)].filter((e) => !adminEmails.includes(e));
      // Same-workspace, active, non-guest members only; anything else fails the whole call before any add.
      const adminIds = await findMembers(app, adminEmails);
      const memberIds = await findMembers(app, memberEmails);

      const added: AddedChannelParticipant[] = [];
      const alreadyMembers: string[] = [];
      for (const [userIds, role] of [
        [adminIds, ChannelRole.ADMIN],
        [memberIds, ChannelRole.MEMBER],
      ] as const) {
        if (userIds.length === 0) continue;
        const result = await addChannelParticipants({
          channelId,
          actorId: app.botUserId,
          actorWorkspaceRole: req.user!.role,
          workspaceId: app.workspaceId,
          userIds,
          role,
        });
        added.push(...result.added);
        alreadyMembers.push(...result.alreadyMembers);
      }

      if (added.length > 0) {
        await this.announceAdded(req, channelId, added);
      }
      res.status(added.length > 0 ? 201 : 200).json({
        channelId,
        added: added.map(({ userId }) => userId),
        alreadyMembers,
      });
    } catch (error) {
      if (error instanceof GuestError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof AppError && error.statusCode < 500) {
        res.status(error.statusCode).json({ error: error.message, code: ADD_PARTICIPANTS_ERROR_CODES[error.statusCode] ?? 'BAD_REQUEST' });
        return;
      }
      logger.error('[APP-CHANNEL] Add participants failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /** The "X was added by Y" channel message, then the participants side effects (sync, notifications). */
  private async announceAdded(req: Request, channelId: string, added: AddedChannelParticipant[]): Promise<void> {
    const bot = req.user!;
    try {
      await channelController.sendAddAndRemoveParticipantsSystemMessage(
        channelId,
        added.map(({ userId, userName }) => ({ userId, userName })),
        { id: bot.id, name: bot.name },
        'participants_added',
      );
    } catch (error) {
      logger.error('[APP-CHANNEL] Failed to post add-people system message', {
        error: (error instanceof Error ? error.message : String(error)).replace(/\n|\r/g, ' '),
      });
    }
    const handler = new ChannelParticipantsSideEffectHandler({
      userID: bot.id,
      workspaceId: bot.workspaceId,
      role: bot.role,
      orgRole: bot.orgRole,
      memberId: bot.memberId,
    });
    await Promise.all(
      added.map((participant) =>
        handler
          .onInsert({ entityId: participant.participantId, entityType: 'channel_participants', operation: 'insert' })
          .catch((err) => logger.error('Side-effect handler error: channel_participants onInsert', err)),
      ),
    );
  }

  /**
   * Set the fields of a channel the app's bot is in, and put it on the app's Channels desk or take it off
   * POST /api/apps/channel/update
   */
  update = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = UpdateChannelBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    const { channelId, fields, desk } = bodyResult.data;
    const app = { installedAppId: (req as any).auth.installedAppId, workspaceId: req.user!.workspaceId! };
    try {
      const inChannel = await db.channelParticipant.findFirst({
        where: { channelId, userId: req.user!.id, workspaceId: app.workspaceId },
        select: { channelId: true },
      });
      if (!inChannel) {
        res.status(403).json({ error: `${channelId} is not a channel this app is in.`, code: 'CHANNEL_NOT_ALLOWED' });
        return;
      }
      // Fields are checked before anything is written, so a refused call changes nothing.
      const prepared = fields ? await prepareChannelFields(app.workspaceId, fields) : null;
      if (desk !== undefined) {
        const result = await setAppChannelOnDesk(app, channelId, desk);
        if (result === 'no-desk') {
          res.status(400).json(NO_DESK);
          return;
        }
        if (result === 'not-eligible') {
          res.status(400).json(NOT_ELIGIBLE);
          return;
        }
        if (result === 'other-desk') {
          res.status(409).json(ON_OTHER_DESK);
          return;
        }
      }
      if (prepared) await writeChannelFields(app.workspaceId, channelId, prepared);
      res.status(200).json({ channelId, ...(desk !== undefined && { desk }) });
    } catch (error) {
      if (error instanceof ChannelFieldError) {
        res.status(400).json({ error: error.message, code: error.code });
        return;
      }
      logger.error('[APP-CHANNEL] Channel update failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
