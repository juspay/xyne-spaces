import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';
import { dateish } from '../people.schemas.js';

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

export const appsUserGroupsList = defineRoute({
  method: 'GET',
  path: '/list',
  response: z.array(userGroupResponse),
});