import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAuthRetryDelay,
  getMsUntilProactiveRefresh,
  getProactiveRearmDelay,
  INITIAL_AUTH_RETRY_STATE,
  isDeadSessionFailure,
  isRefreshableAuthFailure,
  isSessionEndedAuthFailure,
  isSessionEndedRefusal,
  MAX_DEAD_SESSION_ATTEMPTS,
  nextAuthRetry,
  TOKEN_REFRESH_LEAD_SECONDS,
  type AuthRetryState,
  type RefreshFailureKind,
} from '@/src/services/sessionTokenPolicy';

function makeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `header.${payload}.sig`;
}

function tokenExpiringIn(seconds: number): string {
  return makeJwt({ exp: Math.floor(Date.now() / 1000) + seconds });
}

/** Replays consecutive failures of one kind and returns every decision. */
function replayFailures(kind: RefreshFailureKind, count: number) {
  let state: AuthRetryState = INITIAL_AUTH_RETRY_STATE;
  return Array.from({ length: count }, () => {
    const decision = nextAuthRetry(kind, state);
    if (decision.action === 'retry') {
      state = decision.state;
    }
    return decision;
  });
}

describe('getMsUntilProactiveRefresh', () => {
  it('schedules refresh 5 minutes before exp, not after it', () => {
    const delayMs = getMsUntilProactiveRefresh(tokenExpiringIn(3600));
    assert.ok(delayMs !== null);
    assert.ok(delayMs > 0);
    assert.ok(delayMs <= (3600 - TOKEN_REFRESH_LEAD_SECONDS) * 1000);
  });

  it('is due immediately when the JWT is expired or inside the 5 minute window', () => {
    assert.equal(getMsUntilProactiveRefresh(tokenExpiringIn(-30)), 0);
    assert.equal(getMsUntilProactiveRefresh(tokenExpiringIn(30)), 0);
    assert.equal(getMsUntilProactiveRefresh(tokenExpiringIn(TOKEN_REFRESH_LEAD_SECONDS)), 0);
  });

  it('cannot schedule when exp is missing or the token is not a JWT', () => {
    assert.equal(getMsUntilProactiveRefresh(makeJwt({ sub: 'user' })), null);
    assert.equal(getMsUntilProactiveRefresh('not-a-jwt'), null);
  });
});

describe('getProactiveRearmDelay', () => {
  it('re-arms at the next exp when the refresh handed back a fresh token', () => {
    const rearm = getProactiveRearmDelay(tokenExpiringIn(3600), 0);
    assert.equal(rearm.stillDue, false);
    assert.ok(rearm.delayMs > 0);
  });

  it('backs off instead of spinning when the refreshed token is still due', () => {
    // Cookie was not rotated, or the new exp is already inside the lead window.
    assert.deepEqual(getProactiveRearmDelay(tokenExpiringIn(60), 0), {
      delayMs: 500,
      stillDue: true,
    });
    assert.deepEqual(getProactiveRearmDelay(makeJwt({ sub: 'user' }), 2), {
      delayMs: 3_000,
      stillDue: true,
    });
  });
});

describe('nextAuthRetry', () => {
  it('never signs out on transient failures, however many there are', () => {
    const decisions = replayFailures('transient', 20);
    assert.ok(decisions.every(decision => decision.action === 'retry'));
    assert.equal(isDeadSessionFailure('transient'), false);
  });

  it('backs off on repeated transient failures instead of hammering at 500ms', () => {
    const delays = replayFailures('transient', 5).map(decision =>
      decision.action === 'retry' ? decision.delayMs : -1,
    );
    assert.deepEqual(delays, [500, 1_500, 3_000, 10_000, 30_000]);
    // The ladder caps rather than growing without bound.
    assert.equal(getAuthRetryDelay(99), 30_000);
  });

  it('treats a body/cookie failure as retryable, not as a dead session', () => {
    for (const kind of ['invalid_body', 'missing_jwt_cookie'] as const) {
      const decisions = replayFailures(kind, MAX_DEAD_SESSION_ATTEMPTS + 3);
      assert.ok(decisions.every(decision => decision.action === 'retry'));
      assert.equal(isDeadSessionFailure(kind), false);
    }
  });

  it('signs out once the backend has ended the session', () => {
    for (const kind of ['unauthorized'] as const) {
      const decisions = replayFailures(kind, MAX_DEAD_SESSION_ATTEMPTS);
      const actions = decisions.map(decision => decision.action);
      assert.deepEqual(actions, [
        ...Array<string>(MAX_DEAD_SESSION_ATTEMPTS - 1).fill('retry'),
        'sign-out',
      ]);
      assert.equal(isDeadSessionFailure(kind), true);
    }
  });

  it('signs out on the first session-ended refusal, even after transient blips', () => {
    let state: AuthRetryState = INITIAL_AUTH_RETRY_STATE;
    for (let i = 0; i < 3; i += 1) {
      const decision = nextAuthRetry('transient', state);
      assert.equal(decision.action, 'retry');
      if (decision.action === 'retry') {
        state = decision.state;
      }
    }
    assert.equal(nextAuthRetry('unauthorized', state).action, 'sign-out');
  });
});

describe('isSessionEndedRefusal', () => {
  it('ends the session on the backend refresh codes', () => {
    assert.equal(isSessionEndedRefusal(401, { code: 'REFRESH_INVALID' }), true);
    assert.equal(isSessionEndedRefusal(403, { code: 'WORKSPACE_ACCESS_DENIED' }), true);
    assert.equal(isSessionEndedRefusal(401, { error: 'email_domain_not_allowed' }), true);
  });

  it('ignores a 401/403 from a gateway, WAF or ingress that carries no such code', () => {
    assert.equal(isSessionEndedRefusal(401, null), false);
    assert.equal(isSessionEndedRefusal(403, null), false);
    assert.equal(isSessionEndedRefusal(403, '<html>403 Forbidden</html>'), false);
    assert.equal(isSessionEndedRefusal(401, { message: 'Unauthorized' }), false);
  });

  it('needs the code to match its status', () => {
    assert.equal(isSessionEndedRefusal(403, { code: 'REFRESH_INVALID' }), false);
    assert.equal(isSessionEndedRefusal(401, { code: 'WORKSPACE_ACCESS_DENIED' }), false);
    assert.equal(isSessionEndedRefusal(503, { code: 'REFRESH_INVALID' }), false);
  });
});

describe('isRefreshableAuthFailure', () => {
  it('refreshes on a missing or expired JWT', () => {
    for (const code of ['TOKEN_MISSING', 'TOKEN_EXPIRED']) {
      assert.equal(isRefreshableAuthFailure(401, { code }), true);
    }
  });

  it('does not refresh on the final auth middleware codes', () => {
    for (const code of [
      'TOKEN_INVALID',
      'SESSION_REVOKED',
      'USER_REMOVED',
      'EMAIL_DOMAIN_NOT_ALLOWED',
    ]) {
      assert.equal(isRefreshableAuthFailure(401, { code }), false);
    }
  });

  it('reads a JSON string body, as file downloads report it', () => {
    assert.equal(isRefreshableAuthFailure(401, '{"code":"TOKEN_EXPIRED"}'), true);
  });

  it('leaves other 401s alone, including the refresh endpoint refusing', () => {
    assert.equal(isRefreshableAuthFailure(401, { code: 'REFRESH_INVALID' }), false);
    assert.equal(isRefreshableAuthFailure(401, { message: 'Unauthorized' }), false);
    assert.equal(isRefreshableAuthFailure(401, '<html>401</html>'), false);
    assert.equal(isRefreshableAuthFailure(401, null), false);
  });

  it('only applies to 401', () => {
    assert.equal(isRefreshableAuthFailure(403, { code: 'TOKEN_EXPIRED' }), false);
  });
});

describe('isSessionEndedAuthFailure', () => {
  it('ends the session on an invalid token, a revoked session, a removed user or a blocked domain', () => {
    for (const code of [
      'TOKEN_INVALID',
      'SESSION_REVOKED',
      'USER_REMOVED',
      'EMAIL_DOMAIN_NOT_ALLOWED',
    ]) {
      assert.equal(isSessionEndedAuthFailure(401, { code }), true);
    }
    assert.equal(isSessionEndedAuthFailure(401, '{"code":"SESSION_REVOKED"}'), true);
  });

  it('keeps the session for a missing or expired token', () => {
    for (const code of ['TOKEN_MISSING', 'TOKEN_EXPIRED']) {
      assert.equal(isSessionEndedAuthFailure(401, { code }), false);
    }
  });

  it('keeps the session for 401s without a code and for other statuses', () => {
    assert.equal(isSessionEndedAuthFailure(401, { error: 'User removed from workspace' }), false);
    assert.equal(isSessionEndedAuthFailure(401, '<html>401</html>'), false);
    assert.equal(isSessionEndedAuthFailure(401, null), false);
    assert.equal(isSessionEndedAuthFailure(403, { code: 'USER_REMOVED' }), false);
  });
});
