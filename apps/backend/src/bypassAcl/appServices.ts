import type { Response } from 'express';
import { z } from 'zod';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { findOrCreateConversation } from '@/apps/core/conversationUtils';
import { createTicketWithConversation } from '@/apps/core/ticketutils';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { resolveSlackMessageParts } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUtils';
import { MessageType, AppIncomingWebhookAction, validateFlowDefinition, ChannelRole } from '@xyne/shared';
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
import { AppError } from '@/middleware/errorHandler';
import { SYSTEM_USER_ID } from '@/database/tenant/context';
import { ensureUserInGeneralChannel } from '@/utils/workspaceGeneralChannel';
import { vespaQueue } from '@/queues/vespaQueue';
import { appSchema } from '@/vespa/src/types';
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

// ─── Internal S2S org-app provisioning (routes/appsInternal.ts; claw-auth spaces-sync) ────
// Apps are ORG-level but tenant-keyed to their creator's workspace: org-spanning reads run
// asSystem with explicit filters; writes run asService under the workspace that owns the rows.

/** Relocated from appsInternal POST / + /:appId/install (org↔workspace checks). */
export function findWorkspaceOrgId(workspaceId: string): Promise<string | null> {
  return asSystem(
    ['Workspace'],
    'S2S org-app sync validates the caller-named workspace; it is not the caller\'s own',
    async () =>
      (await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } }))
        ?.orgId ?? null,
  );
}

/**
 * Org-wide same-name lookup (names aren't unique in an org — the route picks the owned one).
 * Must span the org's workspaces; app tenant key is the creator's workspace.
 */
export function findOrgAppsByName(orgId: string, name: string) {
  return asSystem(
    ['Apps'],
    'org-app idempotency lookup spans the org\'s workspaces (app tenant key = creator\'s workspace)',
    () =>
      db.apps.findMany({
        where: { orgId, name: { equals: name.trim(), mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
      }),
  );
}

/**
 * Org app template by id, regardless of the stamping workspace. Relocated from appUtils'
 * installApp: sibling-workspace installs 404 on a workspace-scoped findById. Callers make
 * their own org-eligibility check before acting on the row.
 */
export function findOrgAppTemplate(appId: string) {
  return asSystem(
    ['Apps'],
    'install/sync reads the org-owned template from a sibling workspace of the same org',
    () => db.apps.findUnique({ where: { id: appId } }),
  );
}

/**
 * Relocated from AppPermissionRepository.copyFromApp: installs copy template permissions into
 * the target workspace while the rows are stamped with the creator's.
 */
export function listAppTemplatePermissionRefs(appId: string): Promise<{ permissionId: string }[]> {
  return asSystem(
    ['AppPermission'],
    'install copies template permissions across workspaces of the same org (rows are creator-workspace stamped)',
    () => db.appPermission.findMany({ where: { appId }, select: { permissionId: true } }),
  );
}

interface OrgAppConfig {
  webhookUrl?: string;
  /** Template permission scopes (e.g. ["chat:write"]); intersected with the registry. */
  permissions?: string[];
}

/**
 * Relocated from appsInternal POST / ensure path. Runs under the APP'S OWN tenant key (creator's
 * workspace): service-actor writes are gated by the enforced workspace, and permission rows
 * must be stamped with it.
 */
export function ensureOrgAppConfig(appId: string, appWorkspaceId: string, config: OrgAppConfig): Promise<void> {
  return asService(
    ['Apps', 'AppPermission', 'AvailableAppPermission'],
    'S2S sync converges the org app on its desired config; writes target the app\'s own tenant key',
    SYSTEM_USER_ID,
    appWorkspaceId,
    async () => {
      if (config.webhookUrl) {
        const current = await db.apps.findUnique({ where: { id: appId }, select: { webhookUrl: true } });
        if (current && current.webhookUrl !== config.webhookUrl) {
          await db.apps.update({ where: { id: appId }, data: { webhookUrl: config.webhookUrl } });
        }
      }
      if (config.permissions?.length) {
        // Grant only scopes the registry knows — it may be partially seeded per environment.
        const registry = await repositories.appPermissions.findAll();
        const available = new Set(registry.map((p) => `${p.name}:${String(p.type).toLowerCase()}`));
        const grantable = config.permissions.filter((s) => available.has(s));
        if (grantable.length > 0) {
          await repositories.appPermissions.setAppPermissions(appId, grantable);
        }
      }
    },
  );
}

interface ProvisionOrgAppInput {
  orgId: string;
  name: string;
  description?: string;
  /** Tenant scope the app is created under (creator snapshot + permission rows). */
  workspaceId: string;
  /** Preferred owner — must be a user of `workspaceId`; falls back to that workspace's oldest active user. */
  preferredCreatedByUserId?: string;
}

/**
 * Relocated from appsInternal POST / create path. Owner = preferred user when valid in this
 * workspace, else its oldest active user. Mirrors AppController.createApp's Vespa feed.
 */
export function provisionOrgApp(input: ProvisionOrgAppInput) {
  return asService(
    ['Apps', 'User'],
    'S2S provisioning creates the org app under the caller-named workspace',
    SYSTEM_USER_ID,
    input.workspaceId,
    async () => {
      const creator =
        (input.preferredCreatedByUserId
          ? await db.user.findFirst({
              where: { id: input.preferredCreatedByUserId, workspaceId: input.workspaceId, status: 'ACTIVE' },
              select: { id: true },
            })
          : null) ??
        (await db.user.findFirst({
          where: { workspaceId: input.workspaceId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        }));
      if (!creator) {
        throw new AppError('No active user available to own the app in this workspace', 409);
      }

      const app = await repositories.apps.createApp({
        name: input.name,
        description: input.description,
        createdBy: creator.id,
        orgId: input.orgId,
      });

      vespaQueue
        .addJob({ schema: appSchema, jobType: 'feed', docId: app.id })
        .catch((err) => logger.error(`Failed to queue Vespa feed for app ${app.id}:`, err));

      return app;
    },
  );
}

/** Relocated from appsInternal GET /:appId/installations/:workspaceId. */
export function isAppInstalledInWorkspace(appId: string, workspaceId: string): Promise<boolean> {
  return asService(
    ['InstalledApps'],
    'S2S install-presence check for the caller-named workspace',
    SYSTEM_USER_ID,
    workspaceId,
    async () =>
      Boolean(
        await repositories.installedApps.findFirst({
          where: { appId, user: { workspaceId } },
        }),
      ),
  );
}

/** Relocated from appsInternal's post-install #general join (caller treats it as best-effort). */
export function joinAppBotToGeneralChannel(appId: string, workspaceId: string): Promise<string | null> {
  return asService(
    ['InstalledApps', 'Channel', 'ChannelParticipant'],
    'S2S post-install join of the app\'s bot user to the workspace general channel',
    SYSTEM_USER_ID,
    workspaceId,
    async () => {
      const installed = await repositories.installedApps.findFirst({
        where: { appId, user: { workspaceId } },
      });
      if (!installed) return null;
      return ensureUserInGeneralChannel(db, workspaceId, installed.userId, ChannelRole.MEMBER);
    },
  );
}

/**
 * Relocated from apps/middelware/channelValidation.ts's resolveBotDmChannelId. Opening a bot's
 * DM is work done on behalf of the workspace, not by a member on their own behalf: under the
 * request's own `user` actor ChannelsACL rejects the create, and ChannelParticipantsACL then
 * refuses to let the bot add the human to a brand-new private channel it isn't yet a member of.
 * The caller's channel and user lookups stay under the request's own actor, so workspace scoping
 * still decides what this app may address.
 */
export async function openBotDmForUser(botUserId: string, workspaceId: string, targetUserId: string) {
  const { unifiedDMService } = await import('@/bots/unified/services/unified-dm-service');
  return asService(
    ['Channel', 'ChannelParticipant'],
    'bot DM open: the per-table ACLs refuse a member-actor create of a new private channel the bot is not yet in',
    botUserId,
    workspaceId,
    () => unifiedDMService.getOrCreateBotDM(targetUserId, botUserId, workspaceId),
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

