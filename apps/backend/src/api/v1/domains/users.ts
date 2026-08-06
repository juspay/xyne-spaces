/**
 * User directory, profiles, and groups — the read half of the `users` family.
 *
 * Two shapes worth noting, both inherited from the catalog rather than chosen:
 *
 *  - The directory listing has no paginated variant in the catalog, so
 *    `GET /v1/users` returns the whole workspace directory. `updatedSince` maps
 *    onto the query's own delta argument, which is the intended way to poll it
 *    cheaply. A paginated variant is the right long-term fix.
 *  - There is no single-user query, so there is deliberately no
 *    `GET /v1/users/:id`. Adding one means adding a query to the catalog, not
 *    filtering the directory in the API layer.
 */

import { z } from 'zod';
import { readScope, userSchema, userProfileSchema } from '@xyne/spaces-contract';
import { callQuery, callQueryOne } from '../engine/queries';
import { parseIds, parseUpdatedSince } from '../http';
import { ApiError } from '../errors';
import type { RouteDefinition } from '../manifest/types';

const idsQuery = z.object({ ids: z.string().optional() });

export const userRoutes: readonly RouteDefinition[] = [
  {
    method: 'get',
    path: '/users',
    operationId: 'listUsers',
    summary: 'Every user in the workspace. Poll incrementally with updatedSince.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUsersV2'],
    request: { query: z.object({ updatedSince: z.string().optional() }) },
    response: z.object({ data: z.array(userSchema) }),
    async handler({ auth, query }) {
      const updatedSince = parseUpdatedSince(query['updatedSince']);
      const rows = await callQuery<unknown[]>(
        'getUsersV2',
        updatedSince !== undefined ? { updatedAt: updatedSince } : {},
        auth.ctx,
      );
      return { status: 200, body: { data: rows ?? [] } };
    },
  },

  {
    method: 'get',
    path: '/users/:userId/profile',
    operationId: 'getUserProfile',
    summary: "A user's profile card.",
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserProfile'],
    request: { params: z.object({ userId: z.string().min(1) }) },
    response: userProfileSchema,
    async handler({ auth, params }) {
      const profile = await callQueryOne(
        'getUserProfile',
        { userId: params['userId'] },
        auth.ctx,
        'User profile',
      );
      return { status: 200, body: profile };
    },
  },

  {
    method: 'get',
    path: '/user-profiles',
    operationId: 'listUserProfiles',
    summary: 'Profiles for a batch of users.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserProfilesByIds'],
    request: { query: idsQuery },
    response: z.object({ data: z.array(userProfileSchema) }),
    async handler({ auth, query }) {
      const ids = parseIds(query['ids']);
      if (!ids) throw new ApiError('invalid_request', 'ids is required (comma-separated user ids).');
      const rows = await callQuery<unknown[]>('getUserProfilesByIds', { userIds: ids }, auth.ctx);
      return { status: 200, body: { data: rows ?? [] } };
    },
  },

  {
    method: 'get',
    path: '/user-groups',
    operationId: 'listUserGroups',
    summary: 'User groups (teams). Filter with ids, or search with q.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getAllUserGroups', 'getUserGroupsByIds', 'searchUserGroups'],
    request: {
      query: z.object({
        ids: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    async handler({ auth, query }) {
      const ids = parseIds(query['ids']);
      if (ids) {
        const rows = await callQuery<unknown[]>('getUserGroupsByIds', { groupIds: ids }, auth.ctx);
        return { status: 200, body: { data: rows ?? [] } };
      }

      const search = typeof query['q'] === 'string' ? query['q'].trim() : '';
      if (search) {
        // The catalog query requires `limit` explicitly and accepts null for
        // "no cap"; it is not optional.
        const rows = await callQuery<unknown[]>(
          'searchUserGroups',
          { query: search, limit: (query['limit'] as number | undefined) ?? null },
          auth.ctx,
        );
        return { status: 200, body: { data: rows ?? [] } };
      }

      const rows = await callQuery<unknown[]>('getAllUserGroups', {}, auth.ctx);
      return { status: 200, body: { data: rows ?? [] } };
    },
  },

  {
    method: 'get',
    path: '/user-groups/:userGroupId',
    operationId: 'getUserGroup',
    summary: 'One user group.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserGroupById'],
    request: { params: z.object({ userGroupId: z.string().min(1) }) },
    async handler({ auth, params }) {
      const group = await callQueryOne(
        'getUserGroupById',
        { userGroupId: params['userGroupId'] },
        auth.ctx,
        'User group',
      );
      return { status: 200, body: group };
    },
  },

  {
    method: 'get',
    path: '/user-groups/:userGroupId/members',
    operationId: 'listUserGroupMembers',
    summary: 'Members of a user group.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserGroupMembers'],
    request: { params: z.object({ userGroupId: z.string().min(1) }) },
    async handler({ auth, params }) {
      const rows = await callQuery<unknown[]>(
        'getUserGroupMembers',
        { userGroupId: params['userGroupId'] },
        auth.ctx,
      );
      return { status: 200, body: { data: rows ?? [] } };
    },
  },

  {
    method: 'get',
    path: '/me/user-groups',
    operationId: 'listMyUserGroups',
    summary: 'Group memberships of the authenticated user.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserGroupMappingsByUserId'],
    async handler({ auth }) {
      // Scoped to the caller by the query itself, from ctx — there is no user id
      // parameter to spoof.
      const rows = await callQuery<unknown[]>('getUserGroupMappingsByUserId', {}, auth.ctx);
      return { status: 200, body: { data: rows ?? [] } };
    },
  },
];
