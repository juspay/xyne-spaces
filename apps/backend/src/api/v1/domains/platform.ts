/**
 * Platform endpoints: identity and service metadata.
 *
 * `/v1/me` deliberately goes through the query engine rather than returning the
 * token payload. It is the Phase 0 proof that the whole path works end to end —
 * OAuth token → verified principal → catalog query → ZQL compiled to SQL →
 * Postgres, with no Zero sync process anywhere in the picture.
 */

import { readScope, meSchema } from '@xyne/spaces-contract';
import { callQuery } from '../engine/queries';
import type { RouteDefinition } from '../manifest/types';

interface UserProfileRow {
  readonly userId: string;
  readonly [key: string]: unknown;
}

export const platformRoutes: readonly RouteDefinition[] = [
  {
    method: 'get',
    path: '/me',
    operationId: 'getMe',
    summary: 'The user this access token acts as, with their profile.',
    scope: readScope('users'),
    idempotency: 'none',
    queries: ['getUserProfile'],
    response: meSchema,
    async handler({ auth }) {
      const { authData, ctx } = auth;

      // Absent for users who have never customised their profile — not an error.
      const profile = await callQuery<UserProfileRow | undefined>(
        'getUserProfile',
        { userId: authData.sub },
        ctx,
      );

      return {
        status: 200,
        body: {
          id: authData.sub,
          email: authData.email,
          name: authData.name,
          displayName: authData.displayName ?? null,
          workspaceId: authData.workspaceId,
          memberId: authData.memberId,
          role: authData.role,
          orgRole: authData.orgRole,
          scopes: auth.scopes,
          profile: profile ?? null,
        },
      };
    },
  },
];
