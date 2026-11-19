/**
 * refreshAuthSession's single flight (joinOrStartRefresh) with a stubbed transport: one
 * request per burst, no overlap across auth scopes, and each outcome announced once.
 * Each test loads fresh modules, so no refresh or listener leaks between tests.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AuthServices = typeof import('@/src/services/AuthServices');
type Lifecycle = typeof import('@/src/services/authSessionLifecycle');
type ActiveWorkspace = typeof import('@/src/utils/activeWorkspace');

interface Response {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

const mockMtlsFetch = jest.fn<(url: string, options?: unknown) => Promise<Response>>();
const mockJar = new Map<string, string>();

jest.mock('@/src/utils/mtlsHttpClient', () => ({
  mtlsFetch: (...args: [string, unknown?]) => mockMtlsFetch(...args),
  getResponseJson: (response: { body: unknown }) => response.body,
}));

jest.mock('@/src/utils/cookie-injection', () => ({
  injectCookiesFromResponse: jest.fn(async () => undefined),
  pointLastWorkspaceAt: jest.fn(async () => undefined),
}));

jest.mock('@/src/utils/apiCookieHeader', () => ({
  ...jest.requireActual<object>('@/src/utils/apiCookieHeader'),
  getCookieValueFromJar: jest.fn(async (_origin: string, name: string) => mockJar.get(name)),
}));

jest.mock('@/src/services/apiClient', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  isMtlsRequestError: jest.fn(() => false),
}));

const REFRESHED_A: Response = {
  statusCode: 200,
  headers: {},
  body: { success: true, workspaceId: 'ws-a' },
};

let auth: AuthServices;
let lifecycle: Lifecycle;
let activeWorkspace: ActiveWorkspace;

/** A response the test releases when it chooses. */
function deferred(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.resetModules();
  mockMtlsFetch.mockReset();
  mockJar.clear();
  mockJar.set('xyne_ws_ws-a_token', 'jwt-a');
  auth = require('@/src/services/AuthServices');
  lifecycle = require('@/src/services/authSessionLifecycle');
  activeWorkspace = require('@/src/utils/activeWorkspace');
  activeWorkspace.setActiveWorkspaceId('ws-a');
});

describe('refreshAuthSession', () => {
  it('shares one request between concurrent callers, whatever workspace they ask for', async () => {
    const response = deferred();
    mockMtlsFetch.mockReturnValue(response.promise);

    const results = [
      auth.refreshAuthSession(),
      auth.refreshAuthSession('ws-a'),
      auth.refreshAuthSession('ws-a'),
    ];
    await flush();
    expect(mockMtlsFetch).toHaveBeenCalledTimes(1);

    response.resolve(REFRESHED_A);
    for (const result of await Promise.all(results)) {
      expect(result).toEqual({ ok: true, token: 'jwt-a', workspaceId: 'ws-a' });
    }
  });

  it('never hands out another workspace token as the one asked for', async () => {
    mockMtlsFetch.mockResolvedValue(REFRESHED_A);

    expect(await auth.refreshAuthSession('ws-b')).toEqual({
      ok: false,
      kind: 'workspace_mismatch',
    });
  });

  it('announces a new token once per refresh', async () => {
    mockMtlsFetch.mockResolvedValue(REFRESHED_A);
    const refreshed = jest.fn();
    auth.subscribeToSessionRefreshed(refreshed);

    await Promise.all([auth.refreshAuthSession(), auth.refreshAuthSession('ws-a')]);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(refreshed).toHaveBeenCalledWith(
      'jwt-a',
      lifecycle.getAuthSessionGeneration(),
      lifecycle.getAuthOperation(),
    );
  });

  it('starts a new request once the previous one settled', async () => {
    mockMtlsFetch.mockResolvedValue(REFRESHED_A);

    await auth.refreshAuthSession();
    await auth.refreshAuthSession();
    expect(mockMtlsFetch).toHaveBeenCalledTimes(2);
  });

  it('waits for a refresh from an older auth scope instead of overlapping it', async () => {
    const first = deferred();
    mockMtlsFetch.mockReturnValueOnce(first.promise).mockResolvedValue(REFRESHED_A);

    const older = auth.refreshAuthSession();
    await flush();
    lifecycle.beginAuthOperation();
    const newer = auth.refreshAuthSession();
    await flush();
    expect(mockMtlsFetch).toHaveBeenCalledTimes(1);

    first.resolve(REFRESHED_A);
    // The older scope's answer is not applied: its operation was superseded.
    expect(await older).toEqual({ ok: false, kind: 'transient' });
    expect(await newer).toEqual({ ok: true, token: 'jwt-a', workspaceId: 'ws-a' });
    expect(mockMtlsFetch).toHaveBeenCalledTimes(2);
  });

  it('ends the session once on REFRESH_INVALID, however many callers wait', async () => {
    mockMtlsFetch.mockResolvedValue({
      statusCode: 401,
      headers: {},
      body: { code: 'REFRESH_INVALID' },
    });
    const ended = jest.fn();
    auth.subscribeToSessionEnded(ended);

    const results = await Promise.all([
      auth.refreshAuthSession(),
      auth.refreshAuthSession('ws-a'),
      auth.refreshAuthSession('ws-a'),
    ]);
    for (const result of results) {
      expect(result).toEqual({ ok: false, kind: 'unauthorized' });
    }
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('ends the session on 403 WORKSPACE_ACCESS_DENIED', async () => {
    mockMtlsFetch.mockResolvedValue({
      statusCode: 403,
      headers: {},
      body: { code: 'WORKSPACE_ACCESS_DENIED' },
    });
    const ended = jest.fn();
    auth.subscribeToSessionEnded(ended);

    expect(await auth.refreshAuthSession()).toEqual({ ok: false, kind: 'unauthorized' });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('keeps the session on a 401/403 without a session-ended code, a 5xx or a network error', async () => {
    const ended = jest.fn();
    auth.subscribeToSessionEnded(ended);

    for (const response of [
      { statusCode: 401, headers: {}, body: { message: 'Unauthorized' } },
      { statusCode: 403, headers: {}, body: '<html>403 Forbidden</html>' },
      { statusCode: 503, headers: {}, body: { code: 'SESSION_REFRESH_UNAVAILABLE' } },
    ]) {
      mockMtlsFetch.mockResolvedValueOnce(response);
      expect(await auth.refreshAuthSession()).toEqual({ ok: false, kind: 'transient' });
    }
    mockMtlsFetch.mockRejectedValueOnce(new Error('Network request failed'));
    expect(await auth.refreshAuthSession()).toEqual({ ok: false, kind: 'transient' });
    expect(ended).not.toHaveBeenCalled();
  });

  it('applies nothing when the session changes while the request is out', async () => {
    const response = deferred();
    mockMtlsFetch.mockReturnValue(response.promise);
    const refreshed = jest.fn();
    const ended = jest.fn();
    auth.subscribeToSessionRefreshed(refreshed);
    auth.subscribeToSessionEnded(ended);

    const result = auth.refreshAuthSession();
    await flush();
    lifecycle.beginAuthSession();
    response.resolve({ statusCode: 401, headers: {}, body: { code: 'REFRESH_INVALID' } });

    expect(await result).toEqual({ ok: false, kind: 'transient' });
    expect(refreshed).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });

  it('does not write over a workspace switch that happened during the refresh', async () => {
    const response = deferred();
    mockMtlsFetch.mockReturnValue(response.promise);

    const result = auth.refreshAuthSession();
    await flush();
    activeWorkspace.setActiveWorkspaceId('ws-b');
    response.resolve(REFRESHED_A);

    expect(await result).toEqual({ ok: false, kind: 'transient' });
  });
});
