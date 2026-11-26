import { z } from 'zod';
import { CommandAccessibility, CommandType } from '../../zero/types.js';

// ─── Xyne Apps, dashboard side (/apps/...): dashboard login + XYNE-APPS access ──
// App setup, installs, permissions, commands, resources, fetch config and incoming-webhook
// management. Ids, names and settings only: nothing encrypted. Rules are the controllers' own
// (AppController, PermissionController, CommandController, AppResourceController,
// FetchConfigController, IncomingWebhookController), moved here. Responses the controllers
// build from repository rows are not pinned yet (z.unknown()).

export const dateish = z.union([z.date(), z.string()]);
export const appCommand = z.object({
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
export const permissionStatus = z.object({ scope: z.string(), status: z.string() });
export const ok = z.object({ ok: z.literal(true) });

export const appId = z.object({ appId: z.string().min(1, 'App ID is required').trim() });
export const installedAppId = z.object({ installedAppId: z.string().min(1).trim() });

export const commandTypeQuery = z.object({ commandType: z.nativeEnum(CommandType) });