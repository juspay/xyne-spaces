import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';

const email = z.string().trim().email().max(254);

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

/** `/apps/guests`: an app's guest users and their SDK tokens. Key order is the mount order. */
export const guests = route('/guests', {
  /** Create a guest in channels the app is in. */
  create: {
    method: 'POST',
    path: '/create',
    body: z.object({ email, displayName, channelIds }).strict(),
    response: guestView,
  },
  /** List the app's guests. */
  get: {
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
  },
  /** Rename a guest, change its channels, or deactivate it. */
  update: {
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
  },
  /** A Spaces SDK token for one of the app's guests. */
  token: {
    method: 'POST',
    path: '/token',
    body: z.object({ email }).strict(),
    response: z.object({ accessToken: z.string(), expiresAt: z.string(), userId: z.string() }),
  },
});
