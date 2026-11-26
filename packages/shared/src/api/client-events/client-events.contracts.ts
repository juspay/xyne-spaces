import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

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
  path: '/me',
  response: z.record(z.string(), z.string()),
});

/** Every override of users in the caller's workspace, by user id. */
export const clientEventsList = defineRoute({
  method: 'GET',
  path: '',
  response: z.record(z.string(), z.record(z.string(), z.string())),
});

export const clientEventsPost = defineRoute({
  method: 'POST',
  path: '',
  body: z.object({
    userIds,
    event: z.enum(CLIENT_EVENTS),
    payload: z.unknown().optional(),
    ...switchOptions,
  }),
  response: z.object({ success: z.literal(true), event: z.enum(CLIENT_EVENTS), results: z.array(z.object({ userId: z.string(), published: z.boolean() })) }),
});

export const clientEventsRemove = defineRoute({
  method: 'DELETE',
  path: '',
  body: z.object({
    userIds,
    headerNames: z.array(z.string().min(1)).optional(),
    ...switchOptions,
  }),
  response: z.object({ success: z.literal(true), results: z.array(z.object({ userId: z.string(), headers: z.record(z.string(), z.string()), published: z.boolean() })) }),
});