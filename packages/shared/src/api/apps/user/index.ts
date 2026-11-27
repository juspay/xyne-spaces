import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';
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

/** `/apps/user`: a user, for bots. Key order is the mount order. */
export const user = route('/user', {
  info: {
    method: 'GET',
    path: '/info',
    query: z.object({ userId: z.string().min(1, 'User ID is required').trim() }),
    response: userResponse,
  },
});
