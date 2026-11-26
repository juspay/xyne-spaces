import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Xyne Apps users, user groups and guests (/apps/user, /apps/usergroups, /apps/guests) ──
// Bot token. Profile data and ids only: nothing encrypted. Body and query rules are the
// controllers' own (UserController, UserGroupController, GuestController), moved here.
// Responses are the shared helpers' results (getUserData, getAllUserGroups, guestUtils).

const dateish = z.union([z.date(), z.string()]);
const userResponse = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  picture: z.string().nullable(),
  userType: z.string(),
  status: z.string(),
  joined: dateish,
  statusEmoji: z.string().nullable(),
  statusContent: z.string().nullable(),
  statusExpiryAt: dateish.nullable(),
  activityStatus: z.string().nullable(),
});
const userGroupResponse = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  memberCount: z.number(),
  createdAt: dateish,
  updatedAt: dateish,
});
const guestView = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  channelIds: z.array(z.string()),
  status: z.enum(['ACTIVE', 'DEACTIVATED']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const appsUserInfo = defineRoute({
  method: 'GET',
  path: '/apps/user/info',
  query: z.object({ userId: z.string().min(1, 'User ID is required').trim() }),
  response: userResponse,
});

export const appsUserGroupsList = defineRoute({
  method: 'GET',
  path: '/apps/usergroups/list',
  response: z.array(userGroupResponse),
});

const email = z.string().trim().email().max(254);
const displayName = z.string().trim().min(1).max(80);
const channelIds = z.array(z.string().min(1).max(64)).min(1).max(10);

/** Create a guest in channels the app is in. */
export const appsGuestsCreate = defineRoute({
  method: 'POST',
  path: '/apps/guests/create',
  body: z.object({ email, displayName, channelIds }).strict(),
  response: guestView,
});

/** List the app's guests. */
export const appsGuestsGet = defineRoute({
  method: 'POST',
  path: '/apps/guests/get',
  body: z
    .object({
      emails: z.array(email).min(1).max(100).optional(),
      channelId: z.string().min(1).max(64).optional(),
      status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
      limit: z.number().int().min(1).max(100).default(100),
      cursor: z.string().min(1).max(200).optional(),
    })
    .strict(),
  response: z.object({ users: z.array(guestView), notFound: z.array(z.string()).optional(), nextCursor: z.string().nullable() }),
});

/** Rename a guest, change its channels, or deactivate it. */
export const appsGuestsUpdate = defineRoute({
  method: 'POST',
  path: '/apps/guests/update',
  body: z
    .object({
      email,
      displayName: displayName.optional(),
      addChannelIds: channelIds.optional(),
      removeChannelIds: channelIds.optional(),
      status: z.literal('DEACTIVATED').optional(),
    })
    .strict()
    .refine(
      (body) => body.displayName !== undefined || body.addChannelIds !== undefined || body.removeChannelIds !== undefined || body.status !== undefined,
      { message: 'Send at least one field to change besides email.' },
    ),
  response: guestView,
});

/** A Spaces SDK token for one of the app's guests. */
export const appsGuestsToken = defineRoute({
  method: 'POST',
  path: '/apps/guests/token',
  body: z.object({ email }).strict(),
  response: z.object({ accessToken: z.string(), expiresAt: z.string(), userId: z.string() }),
});
