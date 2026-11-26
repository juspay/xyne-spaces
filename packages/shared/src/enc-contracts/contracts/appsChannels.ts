import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Xyne Apps channel API (/apps/channel/...), bot token ─────────────────────
// Ids, names and settings only: nothing encrypted. Body and query rules are the controllers'
// own (ChannelController, AppChannelController, the openDm route), moved here.

const DEFAULT_CHANNEL_LIST_LIMIT = 100;
const MAX_CHANNEL_LIST_LIMIT = 200;
const MAX_CHANNEL_NAME_LENGTH = 255;
/** Users added or updated per channel/update call (channelParticipantsService MAX_PARTICIPANTS_PER_CALL). */
const MAX_PARTICIPANTS_PER_CALL = 10;

const channelRef = z
  .object({
    channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
    channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  })
  .refine((data) => !!data.channelId || !!data.channelName, { message: 'Either channelId or channelName is required' });

const timestamp = z.union([z.date(), z.string()]);

const channelSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scopeType: z.string(),
  visibility: z.string().optional(),
  projectId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: timestamp,
});

/** The bot's DM with a user of its own workspace (the workspace comes from the token, never the body). */
export const appsChannelOpenDm = defineRoute({
  method: 'POST',
  path: '/apps/channel/openDm',
  body: z.object({ targetUserId: z.string().min(1).trim() }),
  response: z.object({ channelId: z.string() }),
});

export const appsChannelInfo = defineRoute({
  method: 'POST',
  path: '/apps/channel/info',
  body: channelRef,
  response: channelSummary.extend({ type: z.string(), visibility: z.string(), participantCount: z.number() }),
});

export const appsChannelDeskConfig = defineRoute({
  method: 'POST',
  path: '/apps/channel/deskChannelConfig',
  body: channelRef,
  response: z.object({ config: z.unknown() }),
});

export const appsChannelList = defineRoute({
  method: 'GET',
  path: '/apps/channel/list',
  query: z.object({
    limit: z
      .string()
      .optional()
      .transform((val) => {
        const parsed = val ? parseInt(val, 10) : NaN;
        if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_CHANNEL_LIST_LIMIT;
        return Math.min(parsed, MAX_CHANNEL_LIST_LIMIT);
      }),
    cursor: z.string().optional(),
    /** Only channels the app's bot is a member of. */
    joined: z.enum(['true', 'false']).optional(),
    projectId: z.string().optional(),
    scopeType: z.string().optional(),
    /** Exact channel-name match. */
    name: z
      .string()
      .trim()
      .min(1, 'name must not be empty')
      .max(MAX_CHANNEL_NAME_LENGTH, `name must be at most ${MAX_CHANNEL_NAME_LENGTH} characters`)
      .optional(),
  }),
  response: z.object({ items: z.array(channelSummary), hasMore: z.boolean(), nextCursor: z.string().optional() }),
});

const email = z.string().trim().toLowerCase().email().max(254);

export const appsChannelUpdate = defineRoute({
  method: 'POST',
  path: '/apps/channel/update',
  body: z
    .object({
      channelId: z.string().trim().min(1),
      fields: z.record(z.string(), z.unknown()).optional(),
      /** On (true) or off (false) the app's Channels desk. */
      desk: z.boolean().optional(),
      /** People to add to the channel, as admins or as members. */
      adminEmails: z.array(email).max(MAX_PARTICIPANTS_PER_CALL).default([]),
      memberEmails: z.array(email).max(MAX_PARTICIPANTS_PER_CALL).default([]),
      /** Also set the role of people already in the channel. */
      updateRoles: z.boolean().default(false),
    })
    .strict()
    .refine(
      (body) => body.fields !== undefined || body.desk !== undefined || body.adminEmails.length + body.memberEmails.length > 0,
      { message: 'Give fields, desk, adminEmails, memberEmails, or a combination' },
    )
    .refine((body) => body.adminEmails.length + body.memberEmails.length <= MAX_PARTICIPANTS_PER_CALL, {
      message: `At most ${MAX_PARTICIPANTS_PER_CALL} users in total can be added or updated per call (adminEmails and memberEmails together)`,
    })
    .refine((body) => !body.updateRoles || body.adminEmails.length + body.memberEmails.length > 0, {
      message: 'updateRoles needs adminEmails or memberEmails',
    })
    .superRefine((body, ctx) => {
      const both = body.adminEmails.filter((e) => body.memberEmails.includes(e));
      if (both.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `A user can have a single role, but ${[...new Set(both)].join(', ')} is in both adminEmails and memberEmails`,
        });
      }
    }),
  response: z.object({
    channelId: z.string(),
    desk: z.boolean().optional(),
    participants: z
      .object({
        added: z.array(z.string()),
        updated: z.array(z.object({ userId: z.string(), role: z.string() })),
        alreadyMembers: z.array(z.string()),
      })
      .optional(),
  }),
});
