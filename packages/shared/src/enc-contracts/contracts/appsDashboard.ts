import { z } from 'zod';
import { defineRoute } from '../api-route.js';
import { AppIncomingWebhookAction, AppIncomingWebhookType, CommandAccessibility, CommandType } from '../../zero/types.js';

// ─── Xyne Apps, dashboard side (/apps/...): dashboard login + XYNE-APPS access ──
// App setup, installs, permissions, commands, resources, fetch config and incoming-webhook
// management. Ids, names and settings only: nothing encrypted. Rules are the controllers' own
// (AppController, PermissionController, CommandController, AppResourceController,
// FetchConfigController, IncomingWebhookController), moved here. Responses the controllers
// build from repository rows are not pinned yet (z.unknown()).

const dateish = z.union([z.date(), z.string()]);
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
const installedCommand = z.object({
  id: z.string(),
  installedAppId: z.string(),
  sourceCommandId: z.string(),
  workspaceId: z.string(),
  commandName: z.string(),
  description: z.string(),
  commandType: z.string(),
  commandAccessibility: z.string(),
  createdAt: dateish,
  updatedAt: dateish,
});
const permissionStatus = z.object({ scope: z.string(), status: z.string() });
/** The app's history-fetch config as stored, secret header values redacted (appFetchConfig.ts owns the schema). */
const fetchConfig = z.object({
  url: z.string(),
  method: z.enum(['GET', 'POST']),
  encoding: z.enum(['JSON', 'FORM', 'RAW']),
  timeoutMs: z.number(),
  pagination: z.enum(['cursor', 'offset']),
  pageSize: z.number(),
  headers: z.record(z.string(), z.string()).optional(),
  secretHeaders: z.array(z.string()).optional(),
  body: z.string().optional(),
  response: z.object({ messagesPath: z.string(), nextCursorPath: z.string(), fields: z.record(z.string(), z.string()) }),
});
const ok = z.object({ ok: z.literal(true) });

const appId = z.object({ appId: z.string().min(1, 'App ID is required').trim() });
const installedAppId = z.object({ installedAppId: z.string().min(1).trim() });

// ── App setup ───────────────────────────────────────────────────────────────

export const appsCreate = defineRoute({
  method: 'POST',
  path: '/apps/create',
  body: z.object({
    name: z.string().min(1, 'App name cannot be empty').trim(),
    description: z.string().trim().optional(),
  }),
  response: appRow,
});

export const appsInstall = defineRoute({ method: 'POST', path: '/apps/install/:appId', params: appId, response: z.object({ jwtToken: z.string() })});
export const appsPromote = defineRoute({ method: 'POST', path: '/apps/promote/:appId', params: appId, response: appRow});

export const appsConfigureWebhook = defineRoute({
  method: 'POST',
  path: '/apps/configureWebhook/:appId',
  params: appId,
  body: z.object({ webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim() }),
  response: z.object({ message: z.string(), webhookUrl: z.string().nullable() }),
});

export const appsRegenerateJwt = defineRoute({ method: 'POST', path: '/apps/regenerate-jwt/:appId', params: appId, response: z.object({ jwtToken: z.string() })});
export const appsSigningSecret = defineRoute({ method: 'POST', path: '/apps/signing-secret/:appId', params: appId, response: z.object({ signingSecret: z.string() })});

// ── Lookups ─────────────────────────────────────────────────────────────────

export const appsBotChannels = defineRoute({
  method: 'GET',
  path: '/apps/bot-channels/:appId',
  params: appId,
  response: z.object({ channels: z.array(z.object({ id: z.string(), name: z.string(), visibility: z.string(), projectId: z.string() })) }),
});

export const appsProjectBoards = defineRoute({
  method: 'GET',
  path: '/apps/project-boards/:projectId',
  params: z.object({ projectId: z.string().min(1, 'Project ID is required').trim() }),
  response: z.object({ boards: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string() })) }),
});

/** Org ids → org names, for app attribution (the client only syncs its own org). */
export const appsOrgNames = defineRoute({
  method: 'POST',
  path: '/apps/org-names',
  body: z.object({ orgIds: z.array(z.string()) }),
  response: z.object({ orgNames: z.record(z.string(), z.string()) }),
});

// ── Installed apps ──────────────────────────────────────────────────────────

/** Edit the caller's INSTALL (not the template): the outbound webhook URL. */
export const appsInstalledUpdate = defineRoute({
  method: 'PATCH',
  path: '/apps/installed/:installedAppId',
  params: installedAppId,
  body: z.object({ webhookUrl: z.string().optional() }),
  response: z.object({ webhookUrl: z.string().nullable() }),
});

export const appsInstalledPermissions = defineRoute({
  method: 'GET',
  path: '/apps/installed/:installedAppId/permissions',
  params: installedAppId,
  response: z.object({ permissions: z.array(z.string()), permissionsPending: z.boolean(), statuses: z.array(permissionStatus) }),
});

export const appsInstalledPermissionsSet = defineRoute({
  method: 'POST',
  path: '/apps/installed/:installedAppId/permissions',
  params: installedAppId,
  body: z.object({ permissions: z.array(z.string()) }),
  response: ok,
});

export const appsInstalledPermissionsActivate = defineRoute({
  method: 'POST',
  path: '/apps/installed/:installedAppId/permissions/activate',
  params: installedAppId,
  response: ok,
});

const commandTypeQuery = z.object({ commandType: z.nativeEnum(CommandType) });

export const appsInstalledCommands = defineRoute({
  method: 'GET',
  path: '/apps/installed/:installedAppId/commands',
  params: installedAppId,
  query: commandTypeQuery,
  response: z.array(installedCommand),
});

const resourceParams = z.object({ installedAppId: z.string().min(1).trim(), resourceType: z.string().min(1) });
const attachedResponse = z.object({ resourceType: z.string(), items: z.array(z.object({ id: z.string(), name: z.string() })) });

export const appsInstalledResources = defineRoute({
  method: 'GET',
  path: '/apps/installed/:installedAppId/resources/:resourceType',
  params: resourceParams,
  response: attachedResponse,
});

/** A delta (added / removed ids), not the whole set; takes effect at once. */
export const appsInstalledResourcesSet = defineRoute({
  method: 'PATCH',
  path: '/apps/installed/:installedAppId/resources/:resourceType',
  params: resourceParams,
  body: z.object({
    added: z.array(z.string().min(1)).optional(),
    removed: z.array(z.string().min(1)).optional(),
  }),
  response: attachedResponse,
});

export const appsInstalledFetchConfig = defineRoute({
  method: 'GET',
  path: '/apps/installed/:installedAppId/fetch-config',
  params: installedAppId,
  response: z.union([z.object({ configured: z.boolean(), config: fetchConfig.nullable() }), z.object({ configured: z.literal(true), config: z.null(), invalid: z.literal(true), error: z.string() })]),
});

export const appsInstalledFetchConfigDelete = defineRoute({
  method: 'DELETE',
  path: '/apps/installed/:installedAppId/fetch-config',
  params: installedAppId,
  response: z.object({ configured: z.literal(false) }),
});

// ── Incoming-webhook management ─────────────────────────────────────────────

const WEBHOOK_NAME_MAX_LENGTH = 84;
const webhookId = z.object({ webhookId: z.string().min(1).trim() });

export const appsIncomingWebhooksCreate = defineRoute({
  method: 'POST',
  path: '/apps/incoming-webhooks',
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
  path: '/apps/incoming-webhooks/:installedAppId',
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
  path: '/apps/incoming-webhooks/:webhookId',
  params: webhookId,
  body: z.object({ name: z.string().min(1).max(WEBHOOK_NAME_MAX_LENGTH) }),
  response: z.object({ success: z.literal(true) }),
});

export const appsIncomingWebhooksRevoke = defineRoute({
  method: 'POST',
  path: '/apps/incoming-webhooks/:webhookId/revoke',
  params: webhookId,
  response: z.object({ success: z.literal(true) }),
});

// ── Permissions (the app template's) ────────────────────────────────────────

export const appsPermissions = defineRoute({
  method: 'GET',
  path: '/apps/permissions',
  response: z.object({ permissions: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), type: z.string(), createdAt: dateish })) }),
});

export const appsPermissionsGet = defineRoute({
  method: 'GET',
  path: '/apps/permissions/:appId',
  params: z.object({ appId: z.string() }),
  response: z.object({ permissions: z.array(z.string()), permissionsPending: z.literal(false), statuses: z.array(permissionStatus) }),
});

export const appsPermissionsSet = defineRoute({
  method: 'POST',
  path: '/apps/permissions/:appId',
  params: z.object({ appId: z.string() }),
  body: z.object({ permissions: z.array(z.string()) }),
  response: ok,
});

// ── Commands and shortcuts ──────────────────────────────────────────────────

/** Commands or shortcuts available in a channel. An unknown `commandAccessibility` is ignored, as before. */
export const appsChannelCommands = defineRoute({
  method: 'GET',
  path: '/apps/channel/:channelId/commands',
  params: z.object({ channelId: z.string().min(1).trim() }),
  query: z.object({ commandType: z.nativeEnum(CommandType), commandAccessibility: z.string().optional() }),
  response: z.array(appCommand.extend({ appName: z.string().optional() })),
});

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

export const appsCommands = defineRoute({
  method: 'GET',
  path: '/apps/:appId/commands',
  params: commandAppId,
  query: commandTypeQuery,
  response: z.array(appCommand),
});
export const appsCommandsCreate = defineRoute({
  method: 'POST',
  path: '/apps/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: appCommand,
});
export const appsCommandsUpdate = defineRoute({
  method: 'PUT',
  path: '/apps/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: appCommand,
});
export const appsCommandsDelete = defineRoute({
  method: 'DELETE',
  path: '/apps/:appId/commands/:commandName',
  params: z.object({ appId: z.string().min(1).trim(), commandName: z.string().min(1).trim() }),
  query: commandTypeQuery,
  response: z.object({ message: z.literal('Deleted') }),
});
