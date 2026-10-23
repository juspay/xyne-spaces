const fixture = JSON.parse(open(__ENV.PERF_USERS_FILE));

if (!Array.isArray(fixture.users) || fixture.users.length === 0) {
  throw new Error('PERF_USERS_FILE must contain at least one user');
}

export function userForVirtualUser(vuNumber) {
  return fixture.users[(vuNumber - 1) % fixture.users.length];
}

/**
 * Headers for an authenticated request.
 *
 * `extra` carries the environment routing header; pre-production is the production host
 * plus `x-route-env`, so omitting it would exercise production instead.
 */
export function authenticatedHeaders(user, extra = {}) {
  return {
    Authorization: `Bearer ${user.token}`,
    'Content-Type': 'application/json',
    'x-workspace-id': user.workspaceId,
    ...extra,
  };
}
