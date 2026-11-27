import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';
import { CommandAccessibility, CommandType } from '../../zero/types.js';
import { chat } from './chat/index.js';
import { files } from './files/index.js';
import { channel } from './channel/index.js';
import { user } from './user/index.js';
import { usergroups } from './usergroups/index.js';
import { guests } from './guests/index.js';
import { installed } from './installed/index.js';
import { incomingWebhooks } from './incoming-webhooks/index.js';
import { permissions } from './permissions/index.js';
import { calls } from './calls/index.js';
import { ticket } from './ticket/index.js';
import { slack } from './slack/index.js';

const dateish = z.union([z.date(), z.string()]);
const appId = z.object({ appId: z.string().min(1, 'App ID is required').trim() });
const commandTypeQuery = z.object({ commandType: z.nativeEnum(CommandType) });
/** An app's slash command. Also answered by /apps/commands and /apps/channel/commands: keep the copies alike. */
const appCommand = z.object({
  id: z.string(),
  appId: z.string(),
  commandName: z.string(),
  description: z.string(),
  commandType: z.nativeEnum(CommandType),
  commandAccessibility: z.nativeEnum(CommandAccessibility),
  isForThread: z.boolean().nullable().optional(),
  isForChat: z.boolean().nullable().optional(),
  createdAt: dateish,
  updatedAt: dateish,
});

/** An app, as stored (its signing secret is returned to its creator on create; see `signing-secret`). */
const appRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: dateish,
  updatedAt: dateish,
  createdBy: z.string(),
  workspaceId: z.string(),
  webhookUrl: z.string().nullable(),
  signingSecret: z.string(),
  version: z.number(),
  orgId: z.string(),
  scope: z.string(),
});

// ── App setup ───────────────────────────────────────────────────────────────

// ── Lookups ─────────────────────────────────────────────────────────────────
const commandAppId = z.object({ appId: z.string().min(1).trim() });
const upsertCommandBody = z.object({
  commandName: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/, 'Command name must be lowercase letters, numbers, underscores, or hyphens only')
    .trim(),
  description: z.string().min(1).max(200).trim(),
  commandType: z.nativeEnum(CommandType),
  commandAccessibility: z.nativeEnum(CommandAccessibility),
});

/** `/apps`: Xyne Apps. The bot API (chat, channel, slack...) and the dashboard side (app setup, installs, permissions, commands). `/:appId/commands` last: it must not capture a literal path above. Key order is the mount order. */
export const apps = route('/apps', {
  chat,
  files,
  channel,
  user,
  usergroups,
  guests,
  create: {
    method: 'POST',
    path: '/create',
    body: z.object({
      name: z.string().min(1, 'App name cannot be empty').trim(),
      description: z.string().trim().optional(),
    }),
    response: appRow,
  },
  install: { method: 'POST', path: '/install/:appId', params: appId, response: z.object({ jwtToken: z.string() }) },
  promote: { method: 'POST', path: '/promote/:appId', params: appId, response: appRow },
  configureWebhook: {
    method: 'POST',
    path: '/configureWebhook/:appId',
    params: appId,
    body: z.object({ webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim() }),
    response: z.object({ message: z.string(), webhookUrl: z.string().nullable() }),
  },
  regenerateJwt: { method: 'POST', path: '/regenerate-jwt/:appId', params: appId, response: z.object({ jwtToken: z.string() }) },
  signingSecret: { method: 'POST', path: '/signing-secret/:appId', params: appId, response: z.object({ signingSecret: z.string() }) },
  botChannels: {
    method: 'GET',
    path: '/bot-channels/:appId',
    params: appId,
    response: z.object({ channels: z.array(z.object({ id: z.string(), name: z.string(), visibility: z.string(), projectId: z.string() })) }),
  },
  projectBoards: {
    method: 'GET',
    path: '/project-boards/:projectId',
    params: z.object({ projectId: z.string().min(1, 'Project ID is required').trim() }),
    response: z.object({ boards: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string() })) }),
  },
  /** Org ids → org names, for app attribution (the client only syncs its own org). */
  orgNames: {
    method: 'POST',
    path: '/org-names',
    body: z.object({ orgIds: z.array(z.string()) }),
    response: z.object({ orgNames: z.record(z.string(), z.string()) }),
  },
  installed,
  incomingWebhooks,
  permissions,
  calls,
  ticket,
  slack,
  commands: {
    method: 'GET',
    path: '/:appId/commands',
    params: commandAppId,
    query: commandTypeQuery,
    response: z.array(appCommand),
  },
  commandsCreate: {
    method: 'POST',
    path: '/:appId/commands',
    params: commandAppId,
    body: upsertCommandBody,
    response: appCommand,
  },
  commandsUpdate: {
    method: 'PUT',
    path: '/:appId/commands',
    params: commandAppId,
    body: upsertCommandBody,
    response: appCommand,
  },
  commandsDelete: {
    method: 'DELETE',
    path: '/:appId/commands/:commandName',
    params: z.object({ appId: z.string().min(1).trim(), commandName: z.string().min(1).trim() }),
    query: commandTypeQuery,
    response: z.object({ message: z.literal('Deleted') }),
  },
});
