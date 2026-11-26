import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { AppIncomingWebhookAction, AppIncomingWebhookType } from '../../../zero/types.js';
import { dateish, installedAppId } from '../dashboard.schemas.js';

const incomingWebhook = z.object({
  id: z.string(),
  name: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  channelVisibility: z.string(),
  boardId: z.string().nullable(),
  boardName: z.string().nullable(),
  type: z.nativeEnum(AppIncomingWebhookType),
  action: z.nativeEnum(AppIncomingWebhookAction),
  isActive: z.boolean(),
  createdAt: dateish,
  webhookUrl: z.string(),
});

// ── Incoming-webhook management ─────────────────────────────────────────────

const WEBHOOK_NAME_MAX_LENGTH = 84;
const webhookId = z.object({ webhookId: z.string().min(1).trim() });

export const appsIncomingWebhooksCreate = defineRoute({
  method: 'POST',
  path: '',
  body: z.object({
    installedAppId: z.string().min(1),
    channelId: z.string().min(1),
    boardId: z.string().min(1).optional(),
    name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
    type: z.nativeEnum(AppIncomingWebhookType).default(AppIncomingWebhookType.SLACK),
    action: z.nativeEnum(AppIncomingWebhookAction).default(AppIncomingWebhookAction.MESSAGE),
  }),
  response: incomingWebhook,
});

export const appsIncomingWebhooksList = defineRoute({
  method: 'GET',
  path: '/:installedAppId',
  params: installedAppId,
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(3),
    offset: z.coerce.number().int().min(0).default(0),
    includeInactive: z.preprocess((value) => {
      if (value === undefined) return false;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean()),
  }),
  response: z.object({ webhooks: z.array(incomingWebhook), total: z.number(), limit: z.number(), offset: z.number() }),
});

export const appsIncomingWebhooksUpdate = defineRoute({
  method: 'PATCH',
  path: '/:webhookId',
  params: webhookId,
  body: z.object({ name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH) }),
  response: z.object({ success: z.literal(true) }),
});

export const appsIncomingWebhooksRevoke = defineRoute({
  method: 'POST',
  path: '/:webhookId/revoke',
  params: webhookId,
  response: z.object({ success: z.literal(true) }),
});