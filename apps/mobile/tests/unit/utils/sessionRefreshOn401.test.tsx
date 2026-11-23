/**
 * withSessionRefreshOn401 with a stubbed refresher: the one retry, the scope checks before
 * and after the refresh, the cooldown and the stand-in 503. Each test loads fresh modules,
 * so the cooldown and the registered refresher never leak between tests.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Lifecycle = typeof import('@/src/services/authSessionLifecycle');
type ActiveWorkspace = typeof import('@/src/utils/activeWorkspace');
type RefreshOn401 = typeof import('@/src/utils/sessionRefreshOn401');
type Outcome = import('@/src/utils/sessionRefreshOn401').SessionRefreshOutcome;

interface Result {
  statusCode: number;
  body: unknown;
}

const OK: Result = { statusCode: 200, body: { ok: true } };
const EXPIRED: Result = { statusCode: 401, body: { code: 'TOKEN_EXPIRED' } };
const REVOKED: Result = { statusCode: 401, body: { code: 'SESSION_REVOKED' } };
const UNAVAILABLE: Result = { statusCode: 503, body: { code: 'SESSION_REFRESH_UNAVAILABLE' } };

let lifecycle: Lifecycle;
let activeWorkspace: ActiveWorkspace;
let refreshOn401: RefreshOn401;
let now: number;

beforeEach(() => {
  jest.resetModules();
  lifecycle = require('@/src/services/authSessionLifecycle');
  activeWorkspace = require('@/src/utils/activeWorkspace');
  refreshOn401 = require('@/src/utils/sessionRefreshOn401');
  activeWorkspace.setActiveWorkspaceId('ws-a');
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** `send` answering with `results` in order (the last one repeats). */
function sender(...results: Result[]): jest.Mock<() => Promise<Result>> {
  let call = 0;
  return jest.fn(async () => results[Math.min(call++, results.length - 1)]!);
}

function run(send: () => Promise<Result>): Promise<Result> {
  return refreshOn401.withSessionRefreshOn401<Result>({
    send,
    readFailure: result => result,
    unavailable: () => UNAVAILABLE,
  });
}

function stubRefresher(
  outcome: Outcome | (() => Promise<Outcome>),
): jest.Mock<() => Promise<Outcome>> {
  const refresher = jest.fn<() => Promise<Outcome>>(
    typeof outcome === 'function' ? outcome : async () => outcome,
  );
  refreshOn401.setSessionRefresher(refresher);
  return refresher;
}

function stubSessionEnded(): jest.Mock<() => void> {
  const handler = jest.fn<() => void>();
  refreshOn401.setSessionEndedHandler(handler);
  return handler;
}

describe('withSessionRefreshOn401', () => {
  it('returns a success without refreshing', async () => {
    const refresher = stubRefresher('refreshed');
    const send = sender(OK);

    expect(await run(send)).toBe(OK);
    expect(send).toHaveBeenCalledTimes(1);
    expect(refresher).not.toHaveBeenCalled();
  });

  it('refreshes once on a refreshable 401 and retries once', async () => {
    const refresher = stubRefresher('refreshed');
    const send = sender(EXPIRED, OK);

    expect(await run(send)).toBe(OK);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(refresher).toHaveBeenCalledWith(
      lifecycle.getAuthSessionGeneration(),
      lifecycle.getAuthOperation(),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('leaves a 401 without a refreshable code alone', async () => {
    const refresher = stubRefresher('refreshed');
    for (const body of [
      { code: 'TOKEN_INVALID' },
      { message: 'Unauthorized' },
      '<html>401</html>',
    ]) {
      const result = { statusCode: 401, body };
      expect(await run(sender(result))).toBe(result);
    }
    expect(refresher).not.toHaveBeenCalled();
  });

  it('returns the 401 when no refresher is registered', async () => {
    const send = sender(EXPIRED, OK);

    expect(await run(send)).toBe(EXPIRED);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('signs out on a session-ended 401 without refreshing', async () => {
    const refresher = stubRefresher('refreshed');
    const sessionEnded = stubSessionEnded();

    expect(await run(sender(REVOKED))).toBe(REVOKED);
    expect(sessionEnded).toHaveBeenCalledTimes(1);
    expect(refresher).not.toHaveBeenCalled();
  });

  it('does not sign out for a request sent before a sign-in or switch', async () => {
    const sessionEnded = stubSessionEnded();

    await run(async () => {
      lifecycle.beginAuthOperation();
      return REVOKED;
    });
    await run(async () => {
      activeWorkspace.setActiveWorkspaceId('ws-b');
      return REVOKED;
    });
    await run(async () => {
      lifecycle.beginAuthSession();
      return REVOKED;
    });
    expect(sessionEnded).not.toHaveBeenCalled();
  });

  it('signs out when the retry says the session is over', async () => {
    stubRefresher('refreshed');
    const sessionEnded = stubSessionEnded();

    expect(await run(sender(EXPIRED, REVOKED))).toBe(REVOKED);
    expect(sessionEnded).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the scope changed while the request was out', async () => {
    const refresher = stubRefresher('refreshed');

    const result = await run(async () => {
      activeWorkspace.setActiveWorkspaceId('ws-b');
      return EXPIRED;
    });
    expect(result).toBe(EXPIRED);
    expect(refresher).not.toHaveBeenCalled();
  });

  it('does not retry when the scope changed during the refresh', async () => {
    for (const change of [
      () => activeWorkspace.setActiveWorkspaceId('ws-b'),
      () => lifecycle.beginAuthOperation(),
      () => lifecycle.beginAuthSession(),
    ]) {
      activeWorkspace.setActiveWorkspaceId('ws-a');
      stubRefresher(async () => {
        change();
        return 'refreshed';
      });
      const send = sender(EXPIRED, OK);

      expect(await run(send)).toBe(EXPIRED);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry when the refresh ended the session', async () => {
    stubRefresher('session-ended');
    const send = sender(EXPIRED, OK);

    expect(await run(send)).toBe(EXPIRED);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers the stand-in 503 when the refresh is unavailable, then cools down', async () => {
    const refresher = stubRefresher('unavailable');

    expect(await run(sender(EXPIRED))).toBe(UNAVAILABLE);
    expect(refresher).toHaveBeenCalledTimes(1);

    // Within the cooldown: no refresh, still the stand-in 503.
    now += 14_999;
    expect(await run(sender(EXPIRED))).toBe(UNAVAILABLE);
    expect(refresher).toHaveBeenCalledTimes(1);

    // After it: refreshes again.
    now += 1;
    refresher.mockImplementation(async (): Promise<Outcome> => 'refreshed');
    expect(await run(sender(EXPIRED, OK))).toBe(OK);
    expect(refresher).toHaveBeenCalledTimes(2);
  });

  it('cools down when the retry is still refused after a refresh', async () => {
    const refresher = stubRefresher('refreshed');

    expect(await run(sender(EXPIRED, EXPIRED))).toBe(EXPIRED);
    expect(refresher).toHaveBeenCalledTimes(1);

    now += 5_000;
    expect(await run(sender(EXPIRED))).toBe(UNAVAILABLE);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('clears the cooldown after a retry that worked', async () => {
    const refresher = stubRefresher('refreshed');

    await run(sender(EXPIRED, OK));
    expect(await run(sender(EXPIRED, OK))).toBe(OK);
    expect(refresher).toHaveBeenCalledTimes(2);
  });
});
