import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAuthRetryDelay,
  getMsUntilProactiveRefresh,
  getProactiveRearmDelay,
  INITIAL_AUTH_RETRY_STATE,
  isDeadSessionFailure,
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

  it('signs out only after the session cookie is refused repeatedly', () => {
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

  it('a transient blip between refusals resets the sign-out budget', () => {
    let state: AuthRetryState = INITIAL_AUTH_RETRY_STATE;
    const feed = (kind: RefreshFailureKind): void => {
      const decision = nextAuthRetry(kind, state);
      assert.equal(decision.action, 'retry');
      if (decision.action === 'retry') {
        state = decision.state;
      }
    };

    feed('unauthorized');
    feed('unauthorized');
    feed('transient');
    assert.equal(state.deadSessionAttempts, 0);
    // Backoff still remembers the total attempts.
    assert.equal(state.attempts, 3);
    feed('unauthorized');
    assert.equal(nextAuthRetry('unauthorized', state).action, 'retry');
  });
});
