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
import { AppError } from '@/middleware/errorHandler';
import {
  applyChannelParticipants,
  MAX_PARTICIPANTS_PER_CALL,
  planChannelParticipants,
  type AddedChannelParticipant,
  type ChannelParticipantsPlan,
} from '@/services/channelParticipantsService';
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
    /** People to add to the channel, as admins or as members. */
    adminEmails: z.array(email).max(MAX_PARTICIPANTS_PER_CALL).default([]),
    memberEmails: z.array(email).max(MAX_PARTICIPANTS_PER_CALL).default([]),
    /** Also set the role of people already in the channel (promote from adminEmails, demote from memberEmails). */
    updateRoles: z.boolean().default(false),
  })
  .strict()
  .refine(
    (body) =>
      body.fields !== undefined || body.desk !== undefined || body.adminEmails.length + body.memberEmails.length > 0,
    { message: 'Give fields, desk, adminEmails, memberEmails, or a combination' },
  )
  .refine((body) => body.adminEmails.length + body.memberEmails.length <= MAX_PARTICIPANTS_PER_CALL, {
    message: `At most ${MAX_PARTICIPANTS_PER_CALL} users in total can be added or updated per call (adminEmails and memberEmails together)`,
  })
  .refine((body) => !body.updateRoles || body.adminEmails.length + body.memberEmails.length > 0, {
    message: 'updateRoles needs adminEmails or memberEmails',
  })
  .superRefine((body, ctx) => {
    const both = body.adminEmails.filter((email) => body.memberEmails.includes(email));
    if (both.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A user can have a single role, but ${[...new Set(both)].join(', ')} is in both adminEmails and memberEmails`,
      });
    }
  });

const ListParticipantsQuerySchema = z
  .object({
    channelId: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const PARTICIPANTS_ERROR_CODES: Record<number, string> = {
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
   * List the active participants of a channel the app's bot is in
   * GET /api/apps/channel/participants?channelId=&limit=&cursor=
   */
  listParticipants = async (req: Request, res: Response): Promise<void> => {
    const queryResult = ListParticipantsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: queryResult.error.errors });
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

  /** One "changed the roles of ..." channel message for the whole call, not one per person. */
  private async announceRoleChanges(
    req: Request,
    channelId: string,
    changes: Array<{ userId: string; userName: string; oldRole: string; role: string }>,
  ): Promise<void> {
    const bot = req.user!;
    try {
      await channelController.sendRoleUpdatedSystemMessage(
        channelId,
        { id: bot.id, name: bot.name },
        changes.map(({ userId, userName, oldRole, role }) => ({ userId, userName, oldRole, newRole: role })),
      );
    } catch (error) {
      logger.error('[APP-CHANNEL] Failed to post role-change system message', {
        error: (error instanceof Error ? error.message : String(error)).replace(/\n|\r/g, ' '),
      });
    }
  }

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
    // Once for the whole call: the canvas and recording refresh is channel-wide, so per-person calls would repeat it.
    await handler.onBatchInsert(channelId, added.map(({ userId }) => userId));

    // Re-index the channel so Vespa's chat_container participants and search permissions include the new members.
    // The in-app path gets this from the channel_stats update; these writes bypass that, so queue it here, once.
    // Never throws: a failed enqueue leaves a retryable vespaInsertionLogs row.
    await repositories.channels.queueVespaFeed(channelId, bot.workspaceId);
  }

  /**
   * Set the fields of a channel the app's bot is in, put it on the app's Channels desk or take it off, and add
   * people to it (with updateRoles, also set the role of those already in it)
   * POST /api/apps/channel/update
   */
  update = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = UpdateChannelBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    const { channelId, fields, desk, updateRoles } = bodyResult.data;
    const adminEmails = [...new Set(bodyResult.data.adminEmails)];
    const memberEmails = [...new Set(bodyResult.data.memberEmails)];
    const app = {
      installedAppId: (req as any).auth.installedAppId,
      botUserId: req.user!.id,
      workspaceId: req.user!.workspaceId!,
    };
    try {
      const inChannel = await db.channelParticipant.findFirst({
        where: { channelId, userId: req.user!.id, workspaceId: app.workspaceId },
        select: { channelId: true },
      });
      if (!inChannel) {
        res.status(403).json({ error: `${channelId} is not a channel this app is in.`, code: 'CHANNEL_NOT_ALLOWED' });
        return;
      }
      // Fields and people are checked before anything is written, so a refused call changes nothing.
      const prepared = fields ? await prepareChannelFields(app.workspaceId, fields) : null;
      let participantsPlan: ChannelParticipantsPlan | null = null;
      if (adminEmails.length + memberEmails.length > 0) {
        // Same-workspace, active, non-guest members only; anything else fails the whole call before any change.
        const adminIds = await findMembers(app, adminEmails);
        const memberIds = await findMembers(app, memberEmails);
        // New people get the role of the list they are in. People already in the channel keep their role,
        // unless updateRoles is set, so re-sending a member list can never take admin rights away.
        participantsPlan = await planChannelParticipants({
          channelId,
          actorId: app.botUserId,
          actorWorkspaceRole: req.user!.role,
          workspaceId: app.workspaceId,
          updateRoles,
          targets: [
            ...adminIds.map((userId) => ({ userId, role: ChannelRole.ADMIN })),
            ...memberIds.map((userId) => ({ userId, role: ChannelRole.MEMBER })),
          ],
        });
      }
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

      let participants: { added: string[]; updated: Array<{ userId: string; role: string }>; alreadyMembers: string[] } | undefined;
      if (participantsPlan) {
        const { added, updated, alreadyMembers } = await applyChannelParticipants(participantsPlan);
        // Announcements run after the writes; a failure in them is logged and never turns the call into an error.
        if (added.length > 0) await this.announceAdded(req, channelId, added);
        if (updated.length > 0) await this.announceRoleChanges(req, channelId, updated);
        participants = {
          added: added.map(({ userId }) => userId),
          updated: updated.map(({ userId, role }) => ({ userId, role })),
          alreadyMembers,
        };
      }
      res.status(200).json({ channelId, ...(desk !== undefined && { desk }), ...(participants && { participants }) });
    } catch (error) {
      if (error instanceof ChannelFieldError) {
        res.status(400).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof GuestError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof AppError && error.statusCode < 500) {
        res.status(error.statusCode).json({ error: error.message, code: PARTICIPANTS_ERROR_CODES[error.statusCode] ?? 'BAD_REQUEST' });
        return;
      }
      logger.error('[APP-CHANNEL] Channel update failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
