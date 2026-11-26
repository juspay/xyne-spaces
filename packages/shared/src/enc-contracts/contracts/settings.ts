import { z } from 'zod';
import { defineRoute } from '../api-route.js';
import { TagsConfigShapeSchema } from '../../tags/index.js';

// ─── Dashboard settings and admin APIs: activity aliases, client events, custom emojis, ──
// ─── a channel's tag-generation config, and a file's metadata (bot token) ───────────────
// Ids, names and settings only: nothing encrypted. Rules are the controllers' own, moved here.

const timestamp = z.union([z.date(), z.string()]);

// ── Activity aliases (/activity-aliases) ────────────────────────────────────

const aliasId = z.object({ id: z.string().min(1) });

export const activityAliasesList = defineRoute({
  method: 'GET',
  path: '/activity-aliases',
  response: z.object({ aliases: z.array(z.record(z.string(), z.unknown())) }),
});

export const activityAliasesCreate = defineRoute({
  method: 'POST',
  path: '/activity-aliases',
  body: z
    .object({
      eventName: z.string().min(1),
      eventCategory: z.string().min(1),
      aliasEventName: z.string().optional(),
      aliasEventCategory: z.string().optional(),
      isBlacklisted: z.boolean().default(false),
    })
    .refine((data) => data.isBlacklisted || (!!data.aliasEventName && !!data.aliasEventCategory), {
      message: 'aliasEventName and aliasEventCategory are required when not blacklisted',
      path: ['aliasEventName'],
    }),
  response: z.object({ alias: z.record(z.string(), z.unknown()) }),
});

export const activityAliasesUpdate = defineRoute({
  method: 'PUT',
  path: '/activity-aliases/:id',
  params: aliasId,
  body: z.object({
    aliasEventName: z.string().optional(),
    aliasEventCategory: z.string().optional(),
    isBlacklisted: z.boolean().optional(),
  }),
  response: z.object({ alias: z.record(z.string(), z.unknown()) }),
});

export const activityAliasesDelete = defineRoute({
  method: 'DELETE',
  path: '/activity-aliases/:id',
  params: aliasId,
  response: z.null(),
});

// ── Client events (/client-events): push a command to users' browsers, header overrides ──

const CLIENT_EVENTS = ['header_update', 'reload'] as const;
const switchOptions = {
  force: z.unknown().optional(),
  loadingSeconds: z.number().optional(),
};
const userIds = z.array(z.string()).min(1, 'userIds must be a non-empty array of strings');

/** The caller's own header overrides (only the allowed routing header). */
export const clientEventsMine = defineRoute({
  method: 'GET',
  path: '/client-events/me',
  response: z.record(z.string(), z.string()),
});

/** Every override of users in the caller's workspace, by user id. */
export const clientEventsList = defineRoute({
  method: 'GET',
  path: '/client-events',
  response: z.record(z.string(), z.unknown()),
});

export const clientEventsPost = defineRoute({
  method: 'POST',
  path: '/client-events',
  body: z.object({
    userIds,
    event: z.enum(CLIENT_EVENTS),
    payload: z.unknown().optional(),
    ...switchOptions,
  }),
  response: z.object({ success: z.literal(true), event: z.string(), results: z.array(z.record(z.string(), z.unknown())) }),
});

export const clientEventsRemove = defineRoute({
  method: 'DELETE',
  path: '/client-events',
  body: z.object({
    userIds,
    headerNames: z.array(z.string().min(1)).optional(),
    ...switchOptions,
  }),
  response: z.object({ success: z.literal(true), results: z.array(z.record(z.string(), z.unknown())) }),
});

// ── Custom emojis (/emojis): reads and delete (upload and image streaming not moved) ──

const emoji = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  creator: z.object({ id: z.string(), name: z.string(), email: z.string(), picture: z.string().nullable() }).nullable(),
});

export const emojisList = defineRoute({
  method: 'GET',
  path: '/emojis',
  response: z.object({ success: z.literal(true), emojis: z.array(emoji) }),
});

export const emojisGet = defineRoute({
  method: 'GET',
  path: '/emojis/:emojiId',
  params: z.object({ emojiId: z.string().min(1) }),
  response: z.object({ success: z.literal(true), emoji }),
});

export const emojisDelete = defineRoute({
  method: 'DELETE',
  path: '/emojis/:emojiId',
  params: z.object({ emojiId: z.string().min(1) }),
  response: z.object({ success: z.literal(true), message: z.string() }),
});

// ── A channel's desk tag-generation config (/channels/:channelId/tags-config) ──

const channelId = z.object({ channelId: z.string().min(1) });

export const channelTagsConfigGet = defineRoute({
  method: 'GET',
  path: '/channels/:channelId/tags-config',
  params: channelId,
  response: z.object({ categories: z.record(z.string(), z.unknown()), isDefault: z.boolean() }),
});

/** Replaces the categories. Desk owner, channel admin or channel creator only. */
export const channelTagsConfigUpdate = defineRoute({
  method: 'PATCH',
  path: '/channels/:channelId/tags-config',
  params: channelId,
  body: TagsConfigShapeSchema,
  response: z.object({ categories: z.record(z.string(), z.unknown()) }),
});

// ── A file's metadata, for a Xyne App (/apps/files/info/:attachmentId), bot token ──

export const appsFilesInfo = defineRoute({
  method: 'GET',
  path: '/apps/files/info/:attachmentId',
  params: z.object({ attachmentId: z.string().min(1) }),
  response: z.object({
    id: z.string(),
    originalFilename: z.string(),
    mimetype: z.string(),
    size: z.number(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    thumbnailUrl: z.string().nullable(),
    createdAt: timestamp,
    conversationId: z.string().nullable(),
  }),
});
