import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { email } from '../people.schemas.js';

const guestView = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  channelIds: z.array(z.string()),
  status: z.enum(['ACTIVE', 'DEACTIVATED']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const displayName = z.string().trim().min(1).max(80);
const channelIds = z.array(z.string().min(1).max(64)).min(1).max(10);

/** Create a guest in channels the app is in. */
export const appsGuestsCreate = defineRoute({
  method: 'POST',
  path: '/create',
  body: z.object({ email, displayName, channelIds }).strict(),
  response: guestView,
});

/** List the app's guests. */
export const appsGuestsGet = defineRoute({
  method: 'POST',
  path: '/get',
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
  path: '/update',
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
  path: '/token',
  body: z.object({ email }).strict(),
  response: z.object({ accessToken: z.string(), expiresAt: z.string(), userId: z.string() }),
});