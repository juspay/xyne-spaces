import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';
import { commandTypeQuery, dateish, installedAppId, ok, permissionStatus } from '../dashboard.schemas.js';

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

// ── Installed apps ──────────────────────────────────────────────────────────

const resourceParams = z.object({ installedAppId: z.string().min(1).trim(), resourceType: z.string().min(1) });
const attachedResponse = z.object({ resourceType: z.string(), items: z.array(z.object({ id: z.string(), name: z.string() })) });

/** `/apps/installed`: an installed app (dashboard). Key order is the mount order. */
export const installed = route('/installed', {
  /** Edit the caller's INSTALL (not the template): the outbound webhook URL. */
  update: {
    method: 'PATCH',
    path: '/:installedAppId',
    params: installedAppId,
    body: z.object({ webhookUrl: z.string().optional() }),
    response: z.object({ webhookUrl: z.string().nullable() }),
  },
  permissions: {
    method: 'GET',
    path: '/:installedAppId/permissions',
    params: installedAppId,
    response: z.object({ permissions: z.array(z.string()), permissionsPending: z.boolean(), statuses: z.array(permissionStatus) }),
  },
  permissionsSet: {
    method: 'POST',
    path: '/:installedAppId/permissions',
    params: installedAppId,
    body: z.object({ permissions: z.array(z.string()) }),
    response: ok,
  },
  permissionsActivate: {
    method: 'POST',
    path: '/:installedAppId/permissions/activate',
    params: installedAppId,
    response: ok,
  },
  commands: {
    method: 'GET',
    path: '/:installedAppId/commands',
    params: installedAppId,
    query: commandTypeQuery,
    response: z.array(installedCommand),
  },
  resources: {
    method: 'GET',
    path: '/:installedAppId/resources/:resourceType',
    params: resourceParams,
    response: attachedResponse,
  },
  /** A delta (added / removed ids), not the whole set; takes effect at once. */
  resourcesSet: {
    method: 'PATCH',
    path: '/:installedAppId/resources/:resourceType',
    params: resourceParams,
    body: z.object({
      added: z.array(z.string().min(1)).optional(),
      removed: z.array(z.string().min(1)).optional(),
    }),
    response: attachedResponse,
  },
  fetchConfig: {
    method: 'GET',
    path: '/:installedAppId/fetch-config',
    params: installedAppId,
    response: z.union([z.object({ configured: z.boolean(), config: fetchConfig.nullable() }), z.object({ configured: z.literal(true), config: z.null(), invalid: z.literal(true), error: z.string() })]),
  },
  fetchConfigDelete: {
    method: 'DELETE',
    path: '/:installedAppId/fetch-config',
    params: installedAppId,
    response: z.object({ configured: z.literal(false) }),
  },
});
