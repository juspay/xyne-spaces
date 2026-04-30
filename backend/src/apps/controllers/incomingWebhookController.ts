import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { encrypt, decrypt } from '@/services/encryptionService';
import { findOrCreateConversation } from '../core/conversationUtils';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { MessageType } from '@xyne/shared';

const WEBHOOK_NAME_MAX_LENGTH = 84;

const IncomingWebhookParamsSchema = z.object({
  workspaceId: z.string().min(1).trim(),
  appId: z.string().min(1).trim(),
  secret: z.string().min(1).trim(),
});

const IncomingWebhookBodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  blocks: z.array(z.any()).optional(),
  attachments: z.array(z.any()).optional(),
  conversationId: z.string().optional(),
});

const CreateWebhookBodySchema = z.object({
  installedAppId: z.string().min(1),
  channelId: z.string().min(1),
  name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
});

const UpdateWebhookBodySchema = z.object({
  name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
});

const InstalledAppParamsSchema = z.object({
  installedAppId: z.string().min(1).trim(),
});

const WebhookParamsSchema = z.object({
  webhookId: z.string().min(1).trim(),
});

const BooleanQueryParamSchema = z.preprocess((value) => {
  if (value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }
  return value;
}, z.boolean());

const ListWebhooksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(3),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: BooleanQueryParamSchema,
});

class IncomingWebhookController {
  private blockKitParser: SlackBlockKitParser;

  constructor() {
    this.blockKitParser = new SlackBlockKitParser();
  }

  buildIncomingWebhookUrl = (workspaceId: string | undefined, installedAppId: string, secret: string): string =>
    `/api/apps/webhooks/${workspaceId}/${installedAppId}/${secret}`;

  handleIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = IncomingWebhookParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        logger.warn('[Incoming-Webhook] Invalid incoming webhook params', {
          params: req.params,
          issues: paramsResult.error.issues,
        });
        res.status(400).send('invalid_payload');
        return;
      }

      const { workspaceId, appId, secret } = paramsResult.data;

      let body: unknown;
      if (Buffer.isBuffer(req.body)) {
        try {
          body = JSON.parse(req.body.toString('utf8'));
        } catch (error) {
          logger.warn('[Incoming-Webhook] Failed to parse buffered webhook body', {
            workspaceId,
            appId,
            error,
          });
          res.status(400).send('invalid_payload');
          return;
        }
      } else {
        body = req.body;
      }

      const bodyResult = IncomingWebhookBodySchema.safeParse(body);
      if (!bodyResult.success) {
        logger.warn('[Incoming-Webhook] Invalid incoming webhook body', {
          workspaceId,
          appId,
          issues: bodyResult.error.issues,
        });
        res.status(400).send('no_text');
        return;
      }

      const { text, blocks, attachments, conversationId } = bodyResult.data;

      const installedApp = await repositories.installedApps.findFirst({
        where: { id: appId },
      });
      if (!installedApp) {
        res.status(400).send('invalid_payload');
        return;
      }

      const botUser = await repositories.users.findById(installedApp.userId);
      if (!botUser || botUser.workspaceId !== workspaceId) {
        res.status(400).send('invalid_payload');
        return;
      }

      const activeWebhooks = await repositories.incomingWebhooks.findActiveByInstalledAppId(installedApp.id);

      let matchedWebhook: typeof activeWebhooks[number] | null = null;
      const secretBuffer = Buffer.from(secret, 'utf8');

      for (const webhook of activeWebhooks) {
        try {
          const decryptedSecret = decrypt(webhook.secret);
          const storedBuffer = Buffer.from(decryptedSecret, 'utf8');
          if (storedBuffer.length === secretBuffer.length &&
            crypto.timingSafeEqual(storedBuffer, secretBuffer)) {
            matchedWebhook = webhook;
            break;
          }
        } catch (error) {
          logger.warn('[Incoming-Webhook] Failed to decrypt webhook secret during incoming validation', {
            webhookId: webhook.id,
            installedAppId: installedApp.id,
            error,
          });
        }
      }

      if (!matchedWebhook) {
        res.status(400).send('invalid_payload');
        return;
      }

      const { channelId } = matchedWebhook;

      const isParticipant = await repositories.channelParticipants.isParticipant(
        channelId,
        installedApp.userId,
      );
      if (!isParticipant) {
        res.status(400).send('invalid_payload');
        return;
      }

      const content = this.blockKitParser.parse({ text, blocks, attachments });

      await findOrCreateConversation(
        channelId,
        installedApp.userId,
        content,
        false,
        conversationId,
        undefined,
        MessageType.BOT,
        {},
      );

      res.status(200).send('ok');
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling incoming webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('server_error');
    }
  };

  createWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = CreateWebhookBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        logger.warn('[Incoming-Webhook] Invalid create webhook payload', {
          userId: req.user?.id,
          issues: bodyResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: bodyResult.error.issues });
        return;
      }

      const { installedAppId, channelId, name } = bodyResult.data;
      const userId = req.user?.id;
      if (!userId) {
        logger.warn('[Incoming-Webhook] Missing authenticated user for create webhook', {
          body: req.body,
        });
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const installedApp = await repositories.installedApps.findById(installedAppId);
      if (!installedApp) {
        res.status(404).json({ error: 'Installed app not found' });
        return;
      }

      const isParticipant = await repositories.channelParticipants.isParticipant(
        channelId,
        installedApp.userId,
      );
      if (!isParticipant) {
        res.status(400).json({ error: 'Bot is not a member of this channel' });
        return;
      }

      const isRequesterParticipant = await repositories.channelParticipants.isParticipant(
        channelId,
        userId,
      );
      if (!isRequesterParticipant) {
        res.status(400).json({ error: 'User is not a member of this channel' });
        return;
      }

      const rawSecret = crypto.randomBytes(32).toString('hex');
      const encryptedSecret = encrypt(rawSecret);

      const webhook = await repositories.incomingWebhooks.create({
        installedAppId,
        channelId,
        name,
        secret: encryptedSecret,
        createdBy: userId,
      });

      const botUser = await repositories.users.findById(installedApp.userId) as
        (Awaited<ReturnType<typeof repositories.users.findById>> & { workspaceId?: string }) | null;

      const webhookUrl = this.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret);

      const channel = await repositories.channels.findById(channelId);

      res.status(201).json({
        id: webhook.id,
        name: webhook.name,
        channelId: webhook.channelId,
        channelName: channel?.name ?? '',
        channelVisibility: channel?.visibility ?? 'public',
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        webhookUrl,
      });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error creating webhook', {
        userId: req.user?.id,
        body: req.body,
        error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  listWebhooks = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = InstalledAppParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        logger.warn('[Incoming-Webhook] Invalid list webhooks params', {
          params: req.params,
          issues: paramsResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: paramsResult.error.issues });
        return;
      }
      const { installedAppId } = paramsResult.data;

      const queryResult = ListWebhooksQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        logger.warn('[Incoming-Webhook] Invalid list webhooks query', {
          installedAppId,
          query: req.query,
          issues: queryResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: queryResult.error.issues });
        return;
      }

      const { limit, offset, includeInactive } = queryResult.data;
      const activeOnly = !includeInactive;

      const installedApp = await repositories.installedApps.findById(installedAppId);
      if (!installedApp) {
        res.status(404).json({ error: 'Installed app not found' });
        return;
      }

      const [webhooks, total] = await Promise.all([
        repositories.incomingWebhooks.findByInstalledAppId(installedAppId, { skip: offset, take: limit, activeOnly }),
        repositories.incomingWebhooks.countByInstalledAppId(installedAppId, activeOnly),
      ]);

      const botUser = await repositories.users.findById(installedApp.userId) as
        (Awaited<ReturnType<typeof repositories.users.findById>> & { workspaceId?: string }) | null;

      const result = webhooks.map(webhook => {
        let webhookUrl = '';
        if (webhook.isActive) {
          try {
            const rawSecret = decrypt(webhook.secret);
            webhookUrl = this.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret);
          } catch (error) {
            logger.warn('[Incoming-Webhook] Failed to decrypt webhook secret while listing webhooks', {
              webhookId: webhook.id,
              installedAppId,
              error,
            });
            webhookUrl = '';
          }
        }

        return {
          id: webhook.id,
          name: webhook.name,
          channelId: webhook.channelId,
          channelName: webhook.channel.name,
          channelVisibility: webhook.channel.visibility,
          isActive: webhook.isActive,
          createdAt: webhook.createdAt,
          webhookUrl,
        };
      });

      res.status(200).json({ webhooks: result, total, limit, offset });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error listing webhooks', {
        installedAppId: req.params.installedAppId,
        query: req.query,
        error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = WebhookParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        logger.warn('[Incoming-Webhook] Invalid update webhook params', {
          params: req.params,
          userId: req.user?.id,
          issues: paramsResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: paramsResult.error.issues });
        return;
      }
      const { webhookId } = paramsResult.data;

      const bodyResult = UpdateWebhookBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        logger.warn('[Incoming-Webhook] Invalid update webhook payload', {
          webhookId,
          userId: req.user?.id,
          issues: bodyResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: bodyResult.error.issues });
        return;
      }

      const webhook = await repositories.incomingWebhooks.findById(webhookId);
      if (!webhook) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }

      if (!webhook.isActive) {
        res.status(400).json({ error: 'Cannot update a revoked webhook' });
        return;
      }

      await repositories.incomingWebhooks.update(webhookId, { name: bodyResult.data.name });

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error updating webhook', {
        webhookId: req.params.webhookId,
        userId: req.user?.id,
        body: req.body,
        error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  revokeWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const paramsResult = WebhookParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        logger.warn('[Incoming-Webhook] Invalid revoke webhook params', {
          params: req.params,
          userId: req.user?.id,
          issues: paramsResult.error.issues,
        });
        res.status(400).json({ error: 'Validation error', details: paramsResult.error.issues });
        return;
      }
      const { webhookId } = paramsResult.data;

      const userId = req.user?.id;
      if (!userId) {
        logger.warn('[Incoming-Webhook] Missing authenticated user for revoke webhook', {
          webhookId,
        });
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const webhook = await repositories.incomingWebhooks.findById(webhookId);
      if (!webhook) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }

      if (!webhook.isActive) {
        res.status(400).json({ error: 'Webhook is already revoked' });
        return;
      }

      await repositories.incomingWebhooks.revoke(webhookId, userId);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error revoking webhook', {
        webhookId: req.params.webhookId,
        userId: req.user?.id,
        error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const incomingWebhookController = new IncomingWebhookController();
