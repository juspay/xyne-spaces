import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';
import { CommandAccessibility, CommandType } from '../../zero/types.js';
import { appCommand, appId, commandTypeQuery } from './dashboard.schemas.js';

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
  path: '/:appId/commands',
  params: commandAppId,
  query: commandTypeQuery,
  response: z.array(appCommand),
});
export const appsCommandsCreate = defineRoute({
  method: 'POST',
  path: '/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: appCommand,
});
export const appsCommandsUpdate = defineRoute({
  method: 'PUT',
  path: '/:appId/commands',
  params: commandAppId,
  body: upsertCommandBody,
  response: appCommand,
});
export const appsCommandsDelete = defineRoute({
  method: 'DELETE',
  path: '/:appId/commands/:commandName',
  params: z.object({ appId: z.string().min(1).trim(), commandName: z.string().min(1).trim() }),
  query: commandTypeQuery,
  response: z.object({ message: z.literal('Deleted') }),
});