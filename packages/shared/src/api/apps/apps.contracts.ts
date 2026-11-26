import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';
import { appId, dateish } from './dashboard.schemas.js';

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

export const appsCreate = defineRoute({
  method: 'POST',
  path: '/create',
  body: z.object({
    name: z.string().min(1, 'App name cannot be empty').trim(),
    description: z.string().trim().optional(),
  }),
  response: appRow,
});

export const appsInstall = defineRoute({ method: 'POST', path: '/install/:appId', params: appId, response: z.object({ jwtToken: z.string() })});
export const appsPromote = defineRoute({ method: 'POST', path: '/promote/:appId', params: appId, response: appRow});

export const appsConfigureWebhook = defineRoute({
  method: 'POST',
  path: '/configureWebhook/:appId',
  params: appId,
  body: z.object({ webhookUrl: z.string().url('Invalid webhook URL format').min(1, 'Webhook URL is required').trim() }),
  response: z.object({ message: z.string(), webhookUrl: z.string().nullable() }),
});

export const appsRegenerateJwt = defineRoute({ method: 'POST', path: '/regenerate-jwt/:appId', params: appId, response: z.object({ jwtToken: z.string() })});
export const appsSigningSecret = defineRoute({ method: 'POST', path: '/signing-secret/:appId', params: appId, response: z.object({ signingSecret: z.string() })});

// ── Lookups ─────────────────────────────────────────────────────────────────

export const appsBotChannels = defineRoute({
  method: 'GET',
  path: '/bot-channels/:appId',
  params: appId,
  response: z.object({ channels: z.array(z.object({ id: z.string(), name: z.string(), visibility: z.string(), projectId: z.string() })) }),
});

export const appsProjectBoards = defineRoute({
  method: 'GET',
  path: '/project-boards/:projectId',
  params: z.object({ projectId: z.string().min(1, 'Project ID is required').trim() }),
  response: z.object({ boards: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string() })) }),
});

/** Org ids → org names, for app attribution (the client only syncs its own org). */
export const appsOrgNames = defineRoute({
  method: 'POST',
  path: '/org-names',
  body: z.object({ orgIds: z.array(z.string()) }),
  response: z.object({ orgNames: z.record(z.string(), z.string()) }),
});