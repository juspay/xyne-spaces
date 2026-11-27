import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';

const dateish = z.union([z.date(), z.string()]);

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

/** `/apps/usergroups`: user groups, for bots. Key order is the mount order. */
export const usergroups = route('/usergroups', {
  list: {
    method: 'GET',
    path: '/list',
    response: z.array(userGroupResponse),
  },
});
