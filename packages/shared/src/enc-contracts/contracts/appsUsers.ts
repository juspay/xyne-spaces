import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Xyne Apps users, user groups and guests (/apps/user, /apps/usergroups, /apps/guests) ──
// Bot token. Profile data and ids only: nothing encrypted. Body and query rules are the
// controllers' own (UserController, UserGroupController, GuestController), moved here.
// Responses are the shared helpers' results (getUserData, getAllUserGroups, guestUtils); their
// shapes are not pinned here yet.

const anyResponse = z.unknown();

export const appsUserInfo = defineRoute({
  method: 'GET',
  path: '/apps/user/info',
  query: z.object({ userId: z.string().min(1, 'User ID is required').trim() }),
  response: anyResponse,
});

export const appsUserGroupsList = defineRoute({
  method: 'GET',
  path: '/apps/usergroups/list',
  response: anyResponse,
});

const email = z.string().trim().email().max(254);
const displayName = z.string().trim().min(1).max(80);
const channelIds = z.array(z.string().min(1).max(64)).min(1).max(10);

/** Create a guest in channels the app is in. */
export const appsGuestsCreate = defineRoute({
  method: 'POST',
  path: '/apps/guests/create',
  body: z.object({ email, displayName, channelIds }).strict(),
  response: anyResponse,
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
  response: anyResponse,
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
  response: anyResponse,
});

/** A Spaces SDK token for one of the app's guests. */
export const appsGuestsToken = defineRoute({
  method: 'POST',
  path: '/apps/guests/token',
  body: z.object({ email }).strict(),
  response: anyResponse,
});
