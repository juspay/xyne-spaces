import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { dateish, email } from '../people.schemas.js';

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

export const appsUserInfo = defineRoute({
  method: 'GET',
  path: '/info',
  query: z.object({ userId: z.string().min(1, 'User ID is required').trim() }),
  response: userResponse,
});