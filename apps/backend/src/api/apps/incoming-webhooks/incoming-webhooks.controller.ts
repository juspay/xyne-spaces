import { xyneApps } from '@/api/apps/xyne-apps.access';
import crypto from 'node:crypto';
import { AccessType, AppIncomingWebhookAction, AppIncomingWebhookType, api } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { ContractError, controller } from '@/framework/api';
import { decrypt, encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { incomingWebhookController } from '../../../apps/controllers/incomingWebhookController';

// ─── Incoming-webhook management ────────────────────────────────────────────

type BotUser = (Awaited<ReturnType<typeof repositories.users.findById>> & { workspaceId?: string }) | null;

/** POST /apps/incoming-webhooks */
export const createIncomingWebhook = controller(api.apps.incomingWebhooks.create, { checks: xyneApps(AccessType.WRITE) }, async (input, reply) => {
  reply.status(201);
  try {
    const { installedAppId, channelId, boardId, name, type, action } = input.body;
    const user = input.user;
    if (!user?.id) {
      logger.warn('[Incoming-Webhook] Missing authenticated user for create webhook', { body: input.body });
      throw new ContractError(401, { error: 'Unauthorized' });
    }
    // Scope to the caller's workspace (via the bot user) so you can't create a webhook against
    // another workspace's install.
    const workspaceId = user.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const installedApp = await repositories.installedApps.findFirst({ where: { id: installedAppId, user: { workspaceId } } });
    if (!installedApp) throw new ContractError(404, { error: 'Installed app not found in this workspace' });

    if (!(await repositories.channelParticipants.isParticipant(channelId, installedApp.userId))) {
      throw new ContractError(400, { error: 'Bot is not a member of this channel' });
    }
    if (!(await repositories.channelParticipants.isParticipant(channelId, user.id))) {
      throw new ContractError(400, { error: 'User is not a member of this channel' });
    }
    const channel = await repositories.channels.findById(channelId);
    if (!channel) throw new ContractError(404, { error: 'Channel not found' });

    // Only SentinelOne supports ticket creation today; the other sources always post a message.
    const messageOnlyTypes: AppIncomingWebhookType[] = [
      AppIncomingWebhookType.SLACK,
      AppIncomingWebhookType.AMAZON_SNS,
      AppIncomingWebhookType.PINGDOM,
      AppIncomingWebhookType.GCP,
    ];
    const normalizedAction: AppIncomingWebhookAction = messageOnlyTypes.includes(type) ? AppIncomingWebhookAction.MESSAGE : action;
    const effectiveBoardId = normalizedAction === AppIncomingWebhookAction.TICKET ? boardId : undefined;
    let boardName: string | null = null;
    if (normalizedAction === AppIncomingWebhookAction.TICKET && !effectiveBoardId) {
      throw new ContractError(400, { error: 'Board is required for ticket webhooks' });
    }
    if (effectiveBoardId) {
      const board = await repositories.boards.findById(effectiveBoardId);
      if (!board) throw new ContractError(404, { error: 'Board not found' });
      boardName = board.name;
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const webhook = await repositories.incomingWebhooks.create({
      installedAppId,
      channelId,
      workspaceId,
      ...(effectiveBoardId ? { boardId: effectiveBoardId } : {}),
      name,
      type,
      action: normalizedAction,
      secret: encrypt(rawSecret),
      createdBy: user.id,
    });
    const botUser = (await repositories.users.findById(installedApp.userId)) as BotUser;
    const webhookUrl = incomingWebhookController.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret, type);
    return {
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
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error creating webhook', { userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** GET /apps/incoming-webhooks/:installedAppId */
export const listIncomingWebhooks = controller(api.apps.incomingWebhooks.list, { checks: xyneApps(AccessType.READ) }, async (input) => {
  const { installedAppId } = input.params;
  try {
    const { limit, offset, includeInactive } = input.query;
    const activeOnly = !includeInactive;
    // Scope to the caller's workspace: another workspace's install's webhooks are not listed.
    const workspaceId = input.user?.workspaceId;
    if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
    const installedApp = await repositories.installedApps.findFirst({ where: { id: installedAppId, user: { workspaceId } } });
    if (!installedApp) throw new ContractError(404, { error: 'Installed app not found in this workspace' });

    const [webhooks, total] = await Promise.all([
      repositories.incomingWebhooks.findByInstalledAppId(installedAppId, { skip: offset, take: limit, activeOnly }),
      repositories.incomingWebhooks.countByInstalledAppId(installedAppId, activeOnly),
    ]);
    const botUser = (await repositories.users.findById(installedApp.userId)) as BotUser;
    const result = webhooks.map((webhook) => {
      let webhookUrl = '';
      if (webhook.isActive) {
        try {
          const rawSecret = decrypt(webhook.secret);
          const webhookType = (webhook.type as AppIncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK;
          webhookUrl = incomingWebhookController.buildIncomingWebhookUrl(botUser?.workspaceId, installedAppId, rawSecret, webhookType);
        } catch (error) {
          logger.warn('[Incoming-Webhook] Failed to decrypt webhook secret while listing webhooks', { webhookId: webhook.id, installedAppId, error });
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
        type: (webhook.type as AppIncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK,
        action: (webhook.action as AppIncomingWebhookAction | undefined) ?? AppIncomingWebhookAction.MESSAGE,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        webhookUrl,
      };
    });
    return { webhooks: result, total, limit, offset };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error listing webhooks', { installedAppId, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** The webhook, if it belongs to an install of the caller's workspace (any other is "not found"). */
async function ownWebhook(webhookId: string, workspaceId: string | undefined) {
  const webhook = await repositories.incomingWebhooks.findById(webhookId);
  if (!webhook) throw new ContractError(404, { error: 'Webhook not found' });
  if (!workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
  const ownInstall = await repositories.installedApps.findFirst({ where: { id: webhook.installedAppId, user: { workspaceId } } });
  if (!ownInstall) throw new ContractError(404, { error: 'Webhook not found' });
  return webhook;
}

/** PATCH /apps/incoming-webhooks/:webhookId: rename (not a revoked one). */
export const updateIncomingWebhook = controller(api.apps.incomingWebhooks.update, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  const { webhookId } = input.params;
  try {
    const webhook = await ownWebhook(webhookId, input.user?.workspaceId);
    if (!webhook.isActive) throw new ContractError(400, { error: 'Cannot update a revoked webhook' });
    await repositories.incomingWebhooks.update(webhookId, { name: input.body.name });
    return { success: true as const };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error updating webhook', { webhookId, userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
});

/** POST /apps/incoming-webhooks/:webhookId/revoke */
export const revokeIncomingWebhook = controller(api.apps.incomingWebhooks.revoke, { checks: xyneApps(AccessType.WRITE) }, async (input) => {
  const { webhookId } = input.params;
  try {
    const userId = input.user?.id;
    const workspaceId = input.user?.workspaceId;
    if (!userId || !workspaceId) {
      logger.warn('[Incoming-Webhook] Missing authenticated user for revoke webhook', { webhookId });
      throw new ContractError(401, { error: 'Unauthorized' });
    }
    const webhook = await ownWebhook(webhookId, workspaceId);
    if (!webhook.isActive) throw new ContractError(400, { error: 'Webhook is already revoked' });
    await repositories.incomingWebhooks.revoke(webhookId, userId);
    return { success: true as const };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[Incoming-Webhook] Error revoking webhook', { webhookId, userId: input.user?.id, error });
    throw new ContractError(500, { error: 'Internal server error' });
  }
});