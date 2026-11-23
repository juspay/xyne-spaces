jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the one import used.
jest.mock('@xyne/shared', () => ({ EncryptedFieldQueryError: class EncryptedFieldQueryError extends Error {} }));
jest.mock('../zero/server.js', () => ({
  handleMutate: jest.fn().mockResolvedValue({}),
  handleQueries: jest.fn().mockResolvedValue({}),
  handleQueriesFallback: jest.fn().mockResolvedValue({}),
  handleMutateFallback: jest.fn().mockResolvedValue({}),
  handleQueriesZqlToSql: jest.fn().mockResolvedValue({}),
}), { virtual: true });
jest.mock('../services/redisService.js', () => ({
  redisService: { getZeroFallbackConfig: async () => ({ fallbackEnabled: true, allowMutations: true }) },
}), { virtual: true });
jest.mock('../services/websocketService.js', () => ({ websocketService: {} }), { virtual: true });
jest.mock('@/services/encryption', () => ({ manifestEnvironmentForRequest: () => 'default' }));
jest.mock('@/middleware/decryptionMiddleware', () => ({ transitCaller: () => ({}) }));

import type { Request, Response } from 'express';
import { handlePush, handleGetQueries, handlePushFallback, handleGetQueriesFallback } from './zeroController';
import { handleMutate, handleQueries, handleMutateFallback, handleQueriesFallback } from '../zero/server.js';

/**
 * authMiddleware verified `verified-token` (from x-workspace-id). The request also carries a
 * different workspace's token in `xyne_last_workspace`'s cookie and a client Authorization header;
 * neither may reach Zero.
 */
const request = (authToken?: string) =>
  ({
    protocol: 'http',
    originalUrl: '/api/zero/push',
    get: () => 'localhost',
    body: {},
    authToken,
    headers: { 'x-workspace-id': 'ws-a', authorization: 'Bearer client-supplied-token' },
    cookies: { xyne_last_workspace: 'ws-b', 'xyne_ws_ws-b_token': 'unchecked-token' },
  }) as unknown as Request;
const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() }) as unknown as Response;
const authorizationSentTo = (fn: unknown) => ((fn as jest.Mock).mock.calls[0][0] as globalThis.Request).headers.get('authorization');

beforeEach(() => jest.clearAllMocks());

describe('zeroController forwards only the token authMiddleware verified', () => {
  it.each([
    ['push', handlePush, handleMutate],
    ['query', handleGetQueries, handleQueries],
    ['push-fallback', handlePushFallback, handleMutateFallback],
    ['query-fallback', handleGetQueriesFallback, handleQueriesFallback],
  ])('%s', async (_name, handler, zeroFn) => {
    await handler(request('verified-token'), response());
    expect(authorizationSentTo(zeroFn)).toBe('Bearer verified-token');
  });

  it('sends no Authorization at all when there is no verified token', async () => {
    await handlePush(request(undefined), response());
    expect(authorizationSentTo(handleMutate)).toBeNull();
  });
});
