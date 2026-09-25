import type { Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { findOrCreateConversation } from '@/apps/core/conversationUtils';
import { createTicketWithConversation } from '@/apps/core/ticketutils';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { resolveSlackMessageParts } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUtils';
import { MessageType, AppIncomingWebhookAction, validateFlowDefinition } from '@xyne/shared';
import type { FlowDefinition } from '@xyne/shared';
import { config } from '@/config/env';
import {
  buildSentinelRawFallbackMessage,
  buildSentinelRawFallbackTicketDescription,
  buildSentinelRawFallbackTicketText,
  createEmptySentinelNormalizedPayload,
  formatSentinelOneMessage,
  formatSentinelOneTicketDescription,
  formatSentinelOneTicketText,
  parseExactSentinelPayload,
} from '@/apps/controllers/sentinelWebhookParser';
import {
  buildAmazonSnsFlow,
  buildSubscriptionConfirmationFlow,
  buildUnsubscribeConfirmationFlow,
  parseSnsMessage,
} from '@/apps/controllers/amazonSnsWebhookParser';
import type { SnsEnvelope } from '@/apps/controllers/amazonSnsWebhookParser';
import { buildPingdomFlow, normalizePingdom, parsePingdomPayload } from '@/apps/controllers/pingdomWebhookParser';
import { buildGcpFlow, normalizeGcp, parseGcpPayload } from '@/apps/controllers/gcpWebhookParser';
import type { WebhookContext } from '@/apps/controllers/incomingWebhookController';
import { db } from '@/database/client';
import { asSystem, asService, rawQuery } from './base';

/**
 * Relocated from apps/controllers/appController.ts's promoteApp. Promotion is authorised by org
 * ownership (checked by the caller before this runs), not by who created the app. The app row
 * carries its creating workspace's id, which for a sibling workspace in the same org is not the
 * caller's — so neither the creator predicate nor workspace scope would match it.
 */
export function promoteAppToGlobal(appId: string) {
  return asSystem(
    ['Apps'],
    'app row carries its creating workspace\'s id, not necessarily the caller\'s — org ownership is already checked by the caller',
    () => repositories.apps.update(appId, { scope: 'GLOBAL' }),
  );
}

const blockKitParser = new SlackBlockKitParser();

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

function encodeFlowContent(flow: FlowDefinition): string | null {
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

/**
 * Relocated from apps/core/appUtils' installApp. The write is atomic (COALESCE) so concurrent
 * first-installs cannot generate competing secrets: only the first writer sets it and every
 * caller reads back the persisted (winning) value. Statement unchanged.
 */
export async function claimAppSigningSecret(appId: string, fresh: string) {
  return rawQuery(
    ['Apps'],
    'app install: atomic COALESCE claim of the per-app signing secret so concurrent first-installs cannot generate competing secrets',
    () => db.$queryRaw<{ signingSecret: string | null }[]>`
        UPDATE apps SET "signingSecret" = COALESCE("signingSecret", ${fresh})
        WHERE id = ${appId} RETURNING "signingSecret"`,
  );
}

/**
 * Relocated from apps/controllers/incomingWebhookController.ts's handleSlackIncoming. Slack incoming webhook: posts the parsed Slack message into the webhook's channel.
 * Unauthenticated webhook — no req.user, so an explicit tenant scope is opened from the validated
 * :workspaceId URL param so the workspaceId stamper fills downstream writes.
 */
export function processSlackIncoming(context: WebhookContext, res: Response): Promise<void> {
  return asService(
    ['Conversation', 'Message', 'Ticket', 'Channel'],
    'unauthenticated incoming webhook: no req.user, scope opened from the validated :workspaceId URL param',
    'incoming-webhook',
    context.workspaceId,
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

      const content = blockKitParser.parse({
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
}

/**
 * Relocated from apps/controllers/incomingWebhookController.ts's handleSentinelIncoming. SentinelOne incoming webhook: creates a ticket or posts a message for the threat payload.
 * Unauthenticated webhook — no req.user, so an explicit tenant scope is opened from the validated
 * :workspaceId URL param so the workspaceId stamper fills downstream writes.
 */
export function processSentinelIncoming(context: WebhookContext, res: Response): Promise<void> {
  return asService(
    ['Conversation', 'Message', 'Ticket', 'Channel'],
    'unauthenticated incoming webhook: no req.user, scope opened from the validated :workspaceId URL param',
    'incoming-webhook',
    context.workspaceId,
    async () => {
      const payload = parseExactSentinelPayload(context.body);
      const webhookAction =
        (context.webhook.action as AppIncomingWebhookAction | undefined) ??
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
}

/**
 * Relocated from apps/controllers/incomingWebhookController.ts's handleAmazonSnsIncoming. Amazon SNS incoming webhook: posts the SNS notification/confirmation flow into the channel.
 * Unauthenticated webhook — no req.user, so an explicit tenant scope is opened from the validated
 * :workspaceId URL param so the workspaceId stamper fills downstream writes.
 */
export function processAmazonSnsIncoming(context: WebhookContext, res: Response, envelope: SnsEnvelope): Promise<void> {
  return asService(
    ['Conversation', 'Message', 'Ticket', 'Channel'],
    'unauthenticated incoming webhook: no req.user, scope opened from the validated :workspaceId URL param',
    'incoming-webhook',
    context.workspaceId,
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

      const content = encodeFlowContent(flow);
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
}

/**
 * Relocated from apps/controllers/incomingWebhookController.ts's handlePingdomIncoming. Pingdom incoming webhook: posts the Pingdom check flow into the channel.
 * Unauthenticated webhook — no req.user, so an explicit tenant scope is opened from the validated
 * :workspaceId URL param so the workspaceId stamper fills downstream writes.
 */
export function processPingdomIncoming(context: WebhookContext, res: Response, payload: NonNullable<ReturnType<typeof parsePingdomPayload>>): Promise<void> {
  return asService(
    ['Conversation', 'Message', 'Ticket', 'Channel'],
    'unauthenticated incoming webhook: no req.user, scope opened from the validated :workspaceId URL param',
    'incoming-webhook',
    context.workspaceId,
    async () => {
      const content = encodeFlowContent(buildPingdomFlow(normalizePingdom(payload)));
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
}

/**
 * Relocated from apps/controllers/incomingWebhookController.ts's handleGcpIncoming. GCP Monitoring incoming webhook: posts the incident flow into the channel.
 * Unauthenticated webhook — no req.user, so an explicit tenant scope is opened from the validated
 * :workspaceId URL param so the workspaceId stamper fills downstream writes.
 */
export function processGcpIncoming(context: WebhookContext, res: Response, payload: NonNullable<ReturnType<typeof parseGcpPayload>>): Promise<void> {
  return asService(
    ['Conversation', 'Message', 'Ticket', 'Channel'],
    'unauthenticated incoming webhook: no req.user, scope opened from the validated :workspaceId URL param',
    'incoming-webhook',
    context.workspaceId,
    async () => {
      const content = encodeFlowContent(buildGcpFlow(normalizeGcp(payload)));
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
}

