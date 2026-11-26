import { z } from 'zod';
import { defineRoute } from '../api-route.js';
import { AppIncomingWebhookAction, AppIncomingWebhookType, CommandAccessibility, CommandType } from '../../zero/types.js';

// ─── Xyne Apps, dashboard side (/apps/...): dashboard login + XYNE-APPS access ──
// App setup, installs, permissions, commands, resources, fetch config and incoming-webhook
// management. Ids, names and settings only: nothing encrypted. Rules are the controllers' own
// (AppController, PermissionController, CommandController, AppResourceController,
// FetchConfigController, IncomingWebhookController), moved here. Responses the controllers
// build from repository rows are not pinned yet (z.unknown()).

const anyResponse = z.unknown();
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
  response: anyResponse,
});

export const appsInstall = defineRoute({ method: 'POST', path: '/apps/install/:appId', params: appId, response: anyResponse });
export const appsPromote = defineRoute({ method: 'POST', path: '/apps/promote/:appId', params: appId, response: anyResponse });

export const appsConfigureWebhook = defineRoute({
  method: 'POST',
  path: '/apps/configureWebhook/:appId',
  params: appId,
  body: z.object({ webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim() }),
  response: anyResponse,
});

export const appsRegenerateJwt = defineRoute({ method: 'POST', path: '/apps/regenerate-jwt/:appId', params: appId, response: anyResponse });
export const appsSigningSecret = defineRoute({ method: 'POST', path: '/apps/signing-secret/:appId', params: appId, response: anyResponse });

// ── Lookups ─────────────────────────────────────────────────────────────────

export const appsBotChannels = defineRoute({
  method: 'GET',
  path: '/apps/bot-channels/:appId',
  params: appId,
  response: z.object({ channels: z.array(z.record(z.string(), z.unknown())) }),
});

export const appsProjectBoards = defineRoute({
  method: 'GET',
  path: '/apps/project-boards/:projectId',
  params: z.object({ projectId: z.string().min(1, 'Project ID is required').trim() }),
  response: z.object({ boards: z.array(z.record(z.string(), z.unknown())) }),
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
  response: anyResponse,
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
  response: anyResponse,
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
  response: anyResponse,
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
  response: anyResponse,
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
  response: anyResponse,
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
  response: z.object({ permissions: z.array(z.unknown()) }),
});

export const appsPermissionsGet = defineRoute({
  method: 'GET',
  path: '/apps/permissions/:appId',
  params: z.object({ appId: z.string() }),
  response: anyResponse,
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
  response: anyResponse,
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
  response: anyResponse,
});
export const appsCommandsCreate = defineRoute({
  method: 'POST',
  path: '/apps/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: anyResponse,
});
export const appsCommandsUpdate = defineRoute({
  method: 'PUT',
  path: '/apps/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: anyResponse,
});
export const appsCommandsDelete = defineRoute({
  method: 'DELETE',
  path: '/apps/:appId/commands/:commandName',
  params: z.object({ appId: z.string().min(1).trim(), commandName: z.string().min(1).trim() }),
  query: commandTypeQuery,
  response: z.object({ message: z.literal('Deleted') }),
});
