const fixture = JSON.parse(open(__ENV.PERF_USERS_FILE));

if (!Array.isArray(fixture.users) || fixture.users.length === 0) {
  throw new Error('PERF_USERS_FILE must contain at least one user');
}

export function userForVirtualUser(vuNumber) {
  return fixture.users[(vuNumber - 1) % fixture.users.length];
}

export function authenticatedHeaders(user) {
  return {
    Authorization: `Bearer ${user.token}`,
    'Content-Type': 'application/json',
    'x-workspace-id': user.workspaceId,
  };
}
