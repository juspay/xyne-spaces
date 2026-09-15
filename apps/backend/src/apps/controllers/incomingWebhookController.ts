import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { runAsServiceActor } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { encrypt, decrypt } from '@/services/encryptionService';
import { findOrCreateConversation } from '../core/conversationUtils';
import { createTicketWithConversation } from '../core/ticketutils';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { resolveSlackMessageParts } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUtils';
import { MessageType, AppIncomingWebhookAction, AppIncomingWebhookType } from '@xyne/shared';
import { config } from '@/config/env';
import { assertWebhookUrlSafe, safeWebhookFetch, SsrfBlockedError } from '@/utils/ssrfGuard';
import {
  buildSentinelRawFallbackMessage,
  buildSentinelRawFallbackTicketDescription,
  buildSentinelRawFallbackTicketText,
  createEmptySentinelNormalizedPayload,
  formatSentinelOneMessage,
  formatSentinelOneTicketDescription,
  formatSentinelOneTicketText,
  parseExactSentinelPayload,
} from './sentinelWebhookParser';
import {
  buildAmazonSnsFlow,
  buildSubscriptionConfirmationFlow,
  buildUnsubscribeConfirmationFlow,
  parseSnsEnvelope,
  parseSnsMessage,
} from './amazonSnsWebhookParser';
import { buildPingdomFlow, normalizePingdom, parsePingdomPayload } from './pingdomWebhookParser';
import { buildGcpFlow, normalizeGcp, parseGcpPayload } from './gcpWebhookParser';
import { validateFlowDefinition } from '@xyne/shared';
import type { FlowDefinition } from '@xyne/shared';

const WEBHOOK_NAME_MAX_LENGTH = 84;
type IncomingWebhookType = AppIncomingWebhookType;
type IncomingWebhookAction = AppIncomingWebhookAction;
type StoredIncomingWebhook = Prisma.AppIncomingWebhookGetPayload<{}>;

const IncomingWebhookParamsSchema = z.object({
  workspaceId: z.string().min(1).trim(),
  appId: z.string().min(1).trim(),
  secret: z.string().min(1).trim(),
});

const IncomingWebhookBodySchema = z.object({
  text: z.string().optional(),
  blocks: z.array(z.any()).optional(),
  attachments: z.array(z.any()).optional(),
  conversationId: z.string().optional(),
}).refine(
  (data) =>
    !!data.text ||
    (data.blocks && data.blocks.length > 0) ||
    (data.attachments && data.attachments.length > 0),
  {
    message: 'text, blocks, or attachments is required',
    path: ['text'],
  },
);

const CreateWebhookBodySchema = z.object({
  installedAppId: z.string().min(1),
  channelId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
  type: z.nativeEnum(AppIncomingWebhookType).default(AppIncomingWebhookType.SLACK),
  action: z.nativeEnum(AppIncomingWebhookAction).default(AppIncomingWebhookAction.MESSAGE),
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

  buildIncomingWebhookUrl = (
    workspaceId: string | undefined,
    installedAppId: string,
    secret: string,
    type: IncomingWebhookType = AppIncomingWebhookType.SLACK,
  ): string => {
    const safeWorkspaceId = workspaceId ?? '';
    if (type === AppIncomingWebhookType.SENTINELONE) {
      return `/api/apps/webhooks/sentinel/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.AMAZON_SNS) {
      return `/api/apps/webhooks/sns/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.PINGDOM) {
      return `/api/apps/webhooks/pingdom/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.GCP) {
      return `/api/apps/webhooks/gcp/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }

    return `/api/apps/webhooks/${safeWorkspaceId}/${installedAppId}/${secret}`;
  };

  private async parseBody(
    req: Request,
    workspaceId: string,
    appId: string,
  ): Promise<unknown | null> {
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8'));
      } catch (error) {
        logger.warn('[Incoming-Webhook] Failed to parse buffered webhook body', {
          workspaceId,
          appId,
          error,
        });
        return null;
      }
    }

    // Amazon SNS posts JSON under `Content-Type: text/plain`, so its route parses
    // the body with express.text() and hands us a raw string.
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch (error) {
        logger.warn('[Incoming-Webhook] Failed to parse text webhook body', {
          workspaceId,
          appId,
          error,
        });
        return null;
      }
    }

    return req.body;
  }

  private async resolveWebhookContext(
    req: Request,
    expectedType: IncomingWebhookType,
  ): Promise<{
    workspaceId: string;
    appId: string;
    installedApp: NonNullable<Awaited<ReturnType<typeof repositories.installedApps.findFirst>>>;
    channelId: string;
    webhook: StoredIncomingWebhook;
    body: unknown;
  } | null> {
    const paramsResult = IncomingWebhookParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      logger.warn('[Incoming-Webhook] Invalid incoming webhook params', {
        params: req.params,
        issues: paramsResult.error.issues,
        expectedType,
      });
      return null;
    }

    const { workspaceId, appId, secret } = paramsResult.data;
    const body = await this.parseBody(req, workspaceId, appId);
    if (body === null) {
      return null;
    }

    const installedApp = await repositories.installedApps.findFirst({
      where: { id: appId },
    });
    if (!installedApp) {
      return null;
    }

    const botUser = await repositories.users.findById(installedApp.userId);
    if (!botUser || botUser.workspaceId !== workspaceId) {
      return null;
    }

    const activeWebhooks = await repositories.incomingWebhooks.findActiveByInstalledAppId(installedApp.id);

    let matchedWebhook: typeof activeWebhooks[number] | null = null;
    const secretBuffer = Buffer.from(secret, 'utf8');

    for (const webhook of activeWebhooks) {
      try {
        const decryptedSecret = decrypt(webhook.secret);
        const storedBuffer = Buffer.from(decryptedSecret, 'utf8');
        if (
          storedBuffer.length === secretBuffer.length &&
          crypto.timingSafeEqual(storedBuffer, secretBuffer)
        ) {
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
      return null;
    }

    const webhookType =
      (matchedWebhook.type as IncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK;
    if (webhookType !== expectedType) {
      logger.warn('[Incoming-Webhook] Webhook type mismatch', {
        webhookId: matchedWebhook.id,
        installedAppId: installedApp.id,
        expectedType,
        actualType: webhookType,
      });
      return null;
    }

    const { channelId } = matchedWebhook;
    const isParticipant = await repositories.channelParticipants.isParticipant(
      channelId,
      installedApp.userId,
    );
    if (!isParticipant) {
      return null;
    }

    return {
      workspaceId,
      appId,
      installedApp,
      channelId,
      webhook: matchedWebhook,
      body,
    };
  }

  handleIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.SLACK);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }
      logger.info('[INCOMING-WEBHOOK] BODY', {
        body: context.body,
      });

      // Unauthenticated webhook: no req.user, so open an explicit tenant scope from the
      // validated :workspaceId URL param so the workspaceId stamper fills downstream writes.
      await runAsServiceActor('incoming-webhook', context.workspaceId,
        async () => {
          const bodyResult = IncomingWebhookBodySchema.safeParse(context.body);
          if (!bodyResult.success) {
            logger.warn('[Incoming-Webhook] Invalid incoming webhook body', {
              workspaceId: context.workspaceId,
              appId: context.appId,
              issues: bodyResult.error.issues,
            });
            res.status(400).send('no_text');
            return;
          }

          const { text, blocks, attachments, conversationId } = bodyResult.data;

          const resolvedMessageParts = await resolveSlackMessageParts({
            text,
            blocks,
            attachments,
          }, config.slackBotToken, context.workspaceId);

          const content = this.blockKitParser.parse({
            text: resolvedMessageParts.text,
            blocks: resolvedMessageParts.blocks,
            attachments: resolvedMessageParts.attachments,
          });

          // Post the message to the channel
          await findOrCreateConversation(
            context.channelId,
            context.installedApp.userId,
            content,
            false,
            conversationId,
            undefined,
            MessageType.BOT,
            {},
          );

          res.status(200).send('ok');
        },
      );
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling incoming webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('rollup_error');
    }
  };

  handleSentinelIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.SENTINELONE);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      // Unauthenticated webhook: no req.user, so open an explicit tenant scope from the
      // validated :workspaceId URL param so the workspaceId stamper fills downstream writes.
      await runAsServiceActor('incoming-webhook', context.workspaceId,
        async () => {
          const payload = parseExactSentinelPayload(context.body);
          const webhookAction =
            (context.webhook.action as IncomingWebhookAction | undefined) ??
            AppIncomingWebhookAction.MESSAGE;

          if (webhookAction === AppIncomingWebhookAction.TICKET) {
            if (!context.webhook.boardId) {
              logger.warn('[Incoming-Webhook] Ticket webhook missing boardId', {
                webhookId: context.webhook.id,
                installedAppId: context.installedApp.id,
              });
              res.status(400).send('invalid_payload');
              return;
            }

            const board = await repositories.boards.findById(context.webhook.boardId);
            if (!board) {
              logger.warn('[Incoming-Webhook] Invalid board configuration for ticket webhook', {
                webhookId: context.webhook.id,
                boardId: context.webhook.boardId,
                channelId: context.channelId,
              });
              res.status(400).send('invalid_payload');
              return;
            }

            const normalizedPayload = payload ?? createEmptySentinelNormalizedPayload();
            const result = await createTicketWithConversation({
              title: payload ? payload.threatName || 'Unknown threat' : 'SentinelOne webhook received',
              description: payload
                ? formatSentinelOneTicketDescription(payload)
                : buildSentinelRawFallbackTicketDescription(context.body),
              projectId: board.projectId,
              boardId: board.id,
              channelId: context.channelId,
              userId: context.installedApp.userId,
              text: payload
                ? formatSentinelOneTicketText(normalizedPayload)
                : buildSentinelRawFallbackTicketText(),
            });

            res.status(201).json(result);
            return;
          }

          const content = payload
            ? formatSentinelOneMessage(payload)
            : buildSentinelRawFallbackMessage(
                context.body,
                createEmptySentinelNormalizedPayload(),
              );

          await findOrCreateConversation(
            context.channelId,
            context.installedApp.userId,
            content,
            false,
            undefined,
            undefined,
            MessageType.BOT,
            {},
          );

          res.status(200).send('ok');
        },
      );
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling SentinelOne webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('rollup_error');
    }
  };

  /**
   * Serialize a flow into the message-content form the dashboard renders.
   * Mirrors the encoding used by chatController for app-authored flow messages.
   */
  private encodeFlowContent(flow: FlowDefinition): string | null {
    const result = validateFlowDefinition(flow);
    if (!result.success) {
      logger.warn('[Incoming-Webhook] Built an invalid flow definition', {
        issues: result.error.issues,
      });
      return null;
    }

    const escapedJSON = JSON.stringify(result.data).replace(/"/g, '&quot;');
    return `<div data-flow-json="${escapedJSON}">Flow JSON</div>`;
  }

  handleAmazonSnsIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.AMAZON_SNS);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const envelope = parseSnsEnvelope(context.body);
      if (!envelope) {
        logger.warn('[Incoming-Webhook] Body is not an Amazon SNS envelope', {
          workspaceId: context.workspaceId,
          appId: context.appId,
        });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, as it is for the Slack and SentinelOne webhook types.

      // Unauthenticated webhook: no req.user, so open an explicit tenant scope from the
      // validated :workspaceId URL param so the workspaceId stamper fills downstream writes.
      await runAsServiceActor('incoming-webhook', context.workspaceId,
        async () => {
          let flow: FlowDefinition;
          switch (envelope.Type) {
            case 'SubscriptionConfirmation':
              // SNS delivers nothing until SubscribeURL is visited. Post the link
              // and let an admin click it rather than fetching it server-side.
              logger.info('[Incoming-Webhook] SNS subscription confirmation received', {
                workspaceId: context.workspaceId,
                topicArn: envelope.TopicArn,
              });
              flow = buildSubscriptionConfirmationFlow(envelope);
              break;
            case 'UnsubscribeConfirmation':
              logger.info('[Incoming-Webhook] SNS unsubscribe confirmation received', {
                workspaceId: context.workspaceId,
                topicArn: envelope.TopicArn,
              });
              flow = buildUnsubscribeConfirmationFlow(envelope);
              break;
            default:
              flow = buildAmazonSnsFlow(parseSnsMessage(envelope));
              break;
          }

          const content = this.encodeFlowContent(flow);
          if (!content) {
            res.status(400).send('invalid_payload');
            return;
          }

          await findOrCreateConversation(
            context.channelId,
            context.installedApp.userId,
            content,
            false,
            undefined,
            undefined,
            MessageType.BOT,
            {},
          );

          res.status(200).send('ok');
        },
      );
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling Amazon SNS webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('rollup_error');
    }
  };

  handlePingdomIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.PINGDOM);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const payload = parsePingdomPayload(context.body);
      if (!payload) {
        logger.warn('[Incoming-Webhook] Body is not a Pingdom check notification', {
          workspaceId: context.workspaceId,
          appId: context.appId,
        });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, as it is for the Slack and Amazon SNS webhook types.

      // Unauthenticated webhook: no req.user, so open an explicit tenant scope from the
      // validated :workspaceId URL param so the workspaceId stamper fills downstream writes.
      await runAsServiceActor('incoming-webhook', context.workspaceId, async () => {
        const content = this.encodeFlowContent(buildPingdomFlow(normalizePingdom(payload)));
        if (!content) {
          res.status(400).send('invalid_payload');
          return;
        }

        await findOrCreateConversation(
          context.channelId,
          context.installedApp.userId,
          content,
          false,
          undefined,
          undefined,
          MessageType.BOT,
          {},
        );

        res.status(200).send('ok');
      });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling Pingdom webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('rollup_error');
    }
  };

  handleGcpIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.GCP);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const payload = parseGcpPayload(context.body);
      if (!payload) {
        logger.warn('[Incoming-Webhook] Body is not a GCP Monitoring incident', {
          workspaceId: context.workspaceId,
          appId: context.appId,
        });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, replacing the HTTP Basic auth infra-switch uses on its
      // shared /alertProxy/gcp endpoint.

      // Unauthenticated webhook: no req.user, so open an explicit tenant scope from the
      // validated :workspaceId URL param so the workspaceId stamper fills downstream writes.
      await runAsServiceActor('incoming-webhook', context.workspaceId, async () => {
        const content = this.encodeFlowContent(buildGcpFlow(normalizeGcp(payload)));
        if (!content) {
          res.status(400).send('invalid_payload');
          return;
        }

        await findOrCreateConversation(
          context.channelId,
          context.installedApp.userId,
          content,
          false,
          undefined,
          undefined,
          MessageType.BOT,
          {},
        );

        res.status(200).send('ok');
      });
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling GCP Monitoring webhook', {
        params: req.params,
        error,
      });
      res.status(500).send('rollup_error');
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

      const { installedAppId, channelId, boardId, name, type, action } = bodyResult.data;
      const userId = req.user?.id;
      if (!userId) {
        logger.warn('[Incoming-Webhook] Missing authenticated user for create webhook', {
          body: req.body,
        });
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Scope to the caller's workspace (via the bot user) so you can't create a webhook against
      // another workspace's install. Guard workspaceId — an undefined filter would un-scope the query.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const installedApp = await repositories.installedApps.findFirst({
        where: { id: installedAppId, user: { workspaceId } },
      });
      if (!installedApp) {
        res.status(404).json({ error: 'Installed app not found in this workspace' });
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

      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      // Only SentinelOne supports ticket creation today; the other sources always
      // post a message.
      const messageOnlyTypes: IncomingWebhookType[] = [
        AppIncomingWebhookType.SLACK,
        AppIncomingWebhookType.AMAZON_SNS,
        AppIncomingWebhookType.PINGDOM,
        AppIncomingWebhookType.GCP,
      ];
      const normalizedAction: IncomingWebhookAction = messageOnlyTypes.includes(type)
        ? AppIncomingWebhookAction.MESSAGE
        : action;
      const effectiveBoardId =
        normalizedAction === AppIncomingWebhookAction.TICKET ? boardId : undefined;

      let boardName: string | null = null;
      if (normalizedAction === AppIncomingWebhookAction.TICKET && !effectiveBoardId) {
        res.status(400).json({ error: 'Board is required for ticket webhooks' });
        return;
      }

      if (effectiveBoardId) {
        const board = await repositories.boards.findById(effectiveBoardId);
        if (!board) {
          res.status(404).json({ error: 'Board not found' });
          return;
        }

        boardName = board.name;
      }

      const rawSecret = crypto.randomBytes(32).toString('hex');
      const encryptedSecret = encrypt(rawSecret);

      const webhook = await repositories.incomingWebhooks.create({
        installedAppId,
        channelId,
        workspaceId,
        ...(effectiveBoardId ? { boardId: effectiveBoardId } : {}),
        name,
        type,
        action: normalizedAction,
        secret: encryptedSecret,
        createdBy: userId,
      });

      const botUser = await repositories.users.findById(installedApp.userId) as
        (Awaited<ReturnType<typeof repositories.users.findById>> & { workspaceId?: string }) | null;

      const webhookUrl = this.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret, type);

      res.status(201).json({
        id: webhook.id,
        name: webhook.name,
        channelId: webhook.channelId,
        channelName: channel?.name ?? '',
        channelVisibility: channel?.visibility ?? 'public',
        boardId: webhook.boardId ?? null,
        boardName,
        type,
        action: normalizedAction,
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

      // Scope to the caller's workspace — don't list another workspace's install's webhooks.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const installedApp = await repositories.installedApps.findFirst({
        where: { id: installedAppId, user: { workspaceId } },
      });
      if (!installedApp) {
        res.status(404).json({ error: 'Installed app not found in this workspace' });
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
            const webhookType =
              (webhook.type as IncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK;
            webhookUrl = this.buildIncomingWebhookUrl(
              botUser?.workspaceId,
              installedAppId,
              rawSecret,
              webhookType,
            );
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
          boardId: webhook.boardId ?? null,
          boardName: webhook.board?.name ?? null,
          type: (webhook.type as IncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK,
          action:
            (webhook.action as IncomingWebhookAction | undefined) ??
            AppIncomingWebhookAction.MESSAGE,
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

      // Scope to the caller's workspace — only act on webhooks of your own install.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const ownInstall = await repositories.installedApps.findFirst({
        where: { id: webhook.installedAppId, user: { workspaceId } },
      });
      if (!ownInstall) {
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
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
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

      // Scope to the caller's workspace — only revoke webhooks of your own install.
      const ownInstall = await repositories.installedApps.findFirst({
        where: { id: webhook.installedAppId, user: { workspaceId } },
      });
      if (!ownInstall) {
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

  /**
   * Complete the SNS handshake for the "Do Confirmation" button.
   *
   * The submit lands on /api/apps/flow/action, which flowController routes here
   * rather than proxying — an incoming webhook has no outbound webhookUrl to
   * proxy to. The card is left as-is; the renderer toasts on success.
   *
   * Always returns `ack`, so a failure never raises an error toast. Only a 200
   * carries a `message`, and only a message produces a toast — the reason for a
   * failure is logged rather than shown.
   */
  confirmSnsSubscription = async (
    values: Record<string, unknown>,
  ): Promise<{ type: 'ack'; message?: string }> => {
    const subscribeUrl = values['subscribeUrl'];

    if (typeof subscribeUrl !== 'string' || !subscribeUrl) {
      logger.warn('[Incoming-Webhook] SNS confirm called without a SubscribeURL');
      return { type: 'ack' };
    }

    // SSRF guard: this endpoint is authenticated but SubscribeURL is fully
    // attacker-controlled body input. A genuine SNS confirmation URL is always
    // https on sns.<region>.amazonaws.com, so pin the host to that AND run the
    // shared private-range/DNS guard to defeat DNS rebinding. Failures fall
    // through to the standard `ack` (no error toast, reason logged).
    let parsedSubscribeUrl: URL;
    try {
      parsedSubscribeUrl = new URL(subscribeUrl);
    } catch {
      logger.warn('[Incoming-Webhook] SNS confirm rejected: invalid SubscribeURL');
      return { type: 'ack' };
    }
    const isAmazonSnsHost =
      parsedSubscribeUrl.protocol === 'https:' &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(parsedSubscribeUrl.hostname);
    if (!isAmazonSnsHost) {
      logger.warn('[Incoming-Webhook] SNS confirm rejected: SubscribeURL is not an Amazon SNS https host', {
        host: parsedSubscribeUrl.hostname,
      });
      return { type: 'ack' };
    }
    try {
      await assertWebhookUrlSafe(subscribeUrl);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        logger.warn('[Incoming-Webhook] SNS confirm blocked by SSRF guard', { error: error.message });
        return { type: 'ack' };
      }
      throw error;
    }

    try {
      // Pin the connection to the address just validated (rebinding-safe).
      const response = await safeWebhookFetch(subscribeUrl, {
        method: 'GET',
        // A redirect would take this somewhere we never intended, so treat one
        // as a failure rather than following it.
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });

      if (response.status === 200) {
        logger.info('[Incoming-Webhook] SNS subscription confirmed');
        return { type: 'ack', message: 'Confirmation done' };
      }

      // 400 usually means the token expired (they last 3 days) or the
      // subscription was already confirmed.
      logger.warn('[Incoming-Webhook] SNS confirmation rejected', { status: response.status });
    } catch (error) {
      logger.error('[Incoming-Webhook] SNS confirmation request failed', { error });
    }

    return { type: 'ack' };
  };
}

export const incomingWebhookController = new IncomingWebhookController();
