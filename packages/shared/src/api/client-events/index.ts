import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ── Client events (/client-events): push a command to users' browsers, header overrides ──

const CLIENT_EVENTS = ['header_update', 'reload'] as const;
const switchOptions = {
  force: z.unknown().optional(),
  loadingSeconds: z.number().optional(),
};
const userIds = z.array(z.string()).min(1, 'userIds must be a non-empty array of strings');

/** `/client-events`: commands pushed to users' browsers, and header overrides. Key order is the mount order. */
export const clientEvents = route('/client-events', {
  /** The caller's own header overrides (only the allowed routing header). */
  mine: {
    method: 'GET',
    path: '/me',
    response: z.record(z.string(), z.string()),
  },
  /** Every override of users in the caller's workspace, by user id. */
  list: {
    method: 'GET',
    path: '',
    response: z.record(z.string(), z.record(z.string(), z.string())),
  },
  post: {
    method: 'POST',
    path: '',
    body: z.object({
      userIds,
      event: z.enum(CLIENT_EVENTS),
      payload: z.unknown().optional(),
      ...switchOptions,
    }),
    response: z.object({ success: z.literal(true), event: z.enum(CLIENT_EVENTS), results: z.array(z.object({ userId: z.string(), published: z.boolean() })) }),
  },
  remove: {
    method: 'DELETE',
    path: '',
    body: z.object({
      userIds,
      headerNames: z.array(z.string().min(1)).optional(),
      ...switchOptions,
    }),
    response: z.object({ success: z.literal(true), results: z.array(z.object({ userId: z.string(), headers: z.record(z.string(), z.string()), published: z.boolean() })) }),
  },
});
