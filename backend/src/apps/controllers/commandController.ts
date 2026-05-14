import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { repositories } from '@/database/repositories';
import { AppCommandRepository } from '@/database/repositories/appCommandRepository';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Insert a SYSTEM message visible only to `userId` explaining that a command failed.
 * The sender is the app's bot user (appUserId).
 *
 * - Thread context (conversationId provided): inserts directly into that thread.
 * - Channel context (no conversationId): creates a brand-new conversation so the
 *   notice appears in the channel feed — same pattern as "user_not_in_channel" notices.
 */
async function sendCommandErrorNotice(opts: {
  channelId: string;
  conversationId: string | null | undefined;
  userId: string;       // viewer — who the message is visible to
  appUserId: string;    // sender — the app's bot user
  commandName: string;
  reason: string;
}): Promise<void> {
  const { channelId, commandName, userId, appUserId, reason } = opts;
  const { conversationId } = opts;
  const now = Date.now();
  const content = `<p>⚠️ Command <strong>/${commandName}</strong> failed: ${reason}. Only you can see this message.</p>`;

  try {
    if (conversationId) {
      // Thread reply — insert directly into the existing conversation
      await db.message.create({
        data: {
          conversationId,
          senderId: appUserId,
          content,
          msgType: 'SYSTEM',
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          isSent: true,
          visibleTo: userId,
          metadata: { messageSubtype: 'command_error', commandName },
        },
      });
    } else {
      // Channel-level — create a new conversation so it appears in the channel feed
      const newConversationId = uuidv4();
      const messageId = uuidv4();

      await db.conversation.create({
        data: {
          conversationId: newConversationId,
          channelId,
          createdBy: appUserId,
          initialMessageId: messageId,
          lastActivityAt: new Date(now),
          replyCount: 0,
          pinned: false,
          createdAt: new Date(now),
        },
      });

      await db.message.create({
        data: {
          messageId,
          conversationId: newConversationId,
          senderId: appUserId,
          content,
          msgType: 'SYSTEM',
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          isSent: true,
          createdAt: new Date(now),
          visibleTo: userId,
          metadata: { messageSubtype: 'command_error', commandName },
        },
      });

      // Add the requesting user as conversation participant so they see the notice
      await db.conversationParticipant.create({
        data: {
          id: uuidv4(),
          conversationId: newConversationId,
          userId,
          participationType: 'AUTHOR',
          isSubscribed: true,
          joinedAt: new Date(now),
        },
      });
    }
  } catch (err) {
    logger.error('[COMMAND-DISPATCH] Failed to send error notice', err);
  }
}

const appCommandRepository = new AppCommandRepository();

const AppIdParamsSchema = z.object({
  appId: z.string().min(1).trim(),
});

const CommandNameParamsSchema = z.object({
  appId: z.string().min(1).trim(),
  commandName: z.string().min(1).trim(),
});

const ChannelIdParamsSchema = z.object({
  channelId: z.string().min(1).trim(),
});

const UpsertCommandBodySchema = z.object({
  commandName: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/, 'Command name must be lowercase letters, numbers, or hyphens only')
    .trim(),
  description: z.string().min(1).max(200).trim(),
  isForThread: z.boolean().optional(),
  isForChat: z.boolean().optional(),
});

const DispatchCommandBodySchema = z.object({
  commandName: z.string().min(1).trim(),
  conversationId: z.string().nullable().optional(),
  text: z.string().optional(),
});

export class CommandController {
  /**
   * GET /api/apps/:appId/commands
   * List all commands for an app (used by the AppsScreen UI)
   */
  getCommands = async (req: Request, res: Response): Promise<void> => {
    const params = AppIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.errors });
      return;
    }
    try {
      const commands = await appCommandRepository.findByAppId(params.data.appId);
      res.status(200).json(commands);
    } catch (error) {
      logger.error('[COMMANDS] getCommands error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * PUT /api/apps/:appId/commands
   * Create or update a command for an app
   */
  upsertCommand = async (req: Request, res: Response): Promise<void> => {
    const params = AppIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.errors });
      return;
    }
    const body = UpsertCommandBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Validation error', details: body.error.errors });
      return;
    }
    try {
      // Verify the app exists
      const app = await repositories.apps.findById(params.data.appId);
      if (!app) {
        res.status(404).json({ error: 'App not found', code: 'APP_NOT_FOUND' });
        return;
      }
      const command = await appCommandRepository.upsert(params.data.appId, body.data);
      res.status(200).json(command);
    } catch (error) {
      logger.error('[COMMANDS] upsertCommand error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/apps/:appId/commands/:commandName
   * Delete a specific command
   */
  deleteCommand = async (req: Request, res: Response): Promise<void> => {
    const params = CommandNameParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.errors });
      return;
    }
    try {
      await appCommandRepository.deleteByAppIdAndName(params.data.appId, params.data.commandName);
      res.status(200).json({ message: 'Command deleted' });
    } catch (error) {
      logger.error('[COMMANDS] deleteCommand error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/apps/channel/:channelId/commands
   * Fetch all commands available in a channel (called when user types / in chat)
   */
  getChannelCommands = async (req: Request, res: Response): Promise<void> => {
    const params = ChannelIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.errors });
      return;
    }
    const { isForThread, isForChat } = req.query;
    try {
      const commands = await appCommandRepository.findByChannelId(params.data.channelId, {
        ...(isForThread !== undefined && { isForThread: isForThread === 'true' }),
        ...(isForChat !== undefined && { isForChat: isForChat === 'true' }),
      });
      res.status(200).json(commands);
    } catch (error) {
      logger.error('[COMMANDS] getChannelCommands error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /api/apps/channel/:channelId/command
   * Dispatch a command — called when a user selects a / command and presses Enter
   * Forwards to the app's webhook with type: 'command'
   */
  dispatchCommand = async (req: Request, res: Response): Promise<void> => {
    const params = ChannelIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.errors });
      return;
    }
    const body = DispatchCommandBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Validation error', details: body.error.errors });
      return;
    }

    const { channelId } = params.data;
    const { commandName, conversationId, text } = body.data;
    const userId = req.user?.id ?? null;

    try {
      const match = await appCommandRepository.findCommandWithInstalledApp(channelId, commandName);
      if (!match) {
        if (userId) {
          await sendCommandErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: userId,
            commandName,
            reason: 'command not found in this channel',
          });
        }
        res.status(404).json({
          error: `Command "/${commandName}" not found in this channel`,
          code: 'COMMAND_NOT_FOUND',
        });
        return;
      }

      if (!match.webhookUrl) {
        if (userId) {
          await sendCommandErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: match.appUserId,
            commandName,
            reason: 'app is not configured (no webhook URL set)',
          });
        }
        res.status(400).json({
          error: `App for command "/${commandName}" has no webhook URL configured`,
          code: 'APP_NOT_CONFIGURED',
        });
        return;
      }

      const payload = {
        actionId: commandName,
        type: 'command',
        values: { text: text ?? '' },
        context: {
          channelId,
          conversationId: conversationId ?? null,
          userId,
          flowJSON: null,
        },
      };

      logger.info('[COMMAND-DISPATCH] Calling app webhook', { appId: match.appId, commandName, channelId, hasText: !!text });

      const appResponse = await fetch(match.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Xyne-Event': 'command',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (!appResponse.ok) {
        const errorBody = await appResponse.text().catch(() => 'unknown error');
        logger.error('[COMMAND-DISPATCH] App webhook returned error', {
          status: appResponse.status,
          body: errorBody.slice(0, 300),
        });
        if (userId) {
          await sendCommandErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: match.appUserId,
            commandName,
            reason: `the app returned an error (HTTP ${appResponse.status})`,
          });
        }
        res.status(502).json({ error: `App backend error ${appResponse.status}` });
        return;
      }

      res.status(200).json({ message: 'Command dispatched' });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        if (userId) {
          await sendCommandErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: userId, // match may not be available on timeout path
            commandName,
            reason: 'the app took too long to respond',
          });
        }
        res.status(504).json({ error: 'App backend timed out' });
        return;
      }
      logger.error('[COMMAND-DISPATCH] Unexpected error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
