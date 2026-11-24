/**
 * apiRequest with transit encryption: responses are decrypted only with a keyring, request
 * bodies are encrypted by the route's manifest rule, and a stale manifest is retried once.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

class MockMtlsRequestError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string,
  ) {
    super(message);
  }
}

const mockRequestJson = jest.fn<(path: string, options?: unknown) => Promise<unknown>>();
const mockRefetchManifest = jest.fn<(version?: number, env?: string) => Promise<boolean>>();
let mockKeyring: object | null = null;
let mockManifest: object | null = null;

const RULE = { type: 'REQUEST', value: 'POST /notes', fields: { text: { client: true } } };

jest.mock('@/src/services/MtlsApiService', () => ({
  MtlsRequestError: MockMtlsRequestError,
  isMtlsRequestError: (error: unknown) => error instanceof MockMtlsRequestError,
  mtlsRequestJson: (path: string, options?: unknown) => mockRequestJson(path, options),
  mtlsRequestText: jest.fn(),
}));

jest.mock('@/src/services/encryption/activeKeyring', () => ({
  getActiveKeyring: () => mockKeyring,
}));

jest.mock('@xyne/shared', () => ({
  CLIENT_MANIFEST_STALE_CODE: 'ENC_MANIFEST_STALE',
  decryptTransitFields: async (data: Record<string, unknown>) => ({ ...data, decrypted: true }),
  encryptField: async (value: string) => `ENC(${value})`,
  getClientManifest: () => mockManifest,
  refetchClientManifest: (version?: number, env?: string) => mockRefetchManifest(version, env),
  findRequestRule: (_manifest: unknown, method: string, path: string) =>
    method === 'POST' && path === '/notes' ? RULE : undefined,
  encryptBodyWithRule: async (
    body: Record<string, unknown>,
    rule: typeof RULE,
    encrypt: (value: string, field: string) => Promise<string>,
  ) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      const fieldRule = rule.fields[key as keyof typeof rule.fields];
      result[key] =
        fieldRule?.client && typeof value === 'string' ? await encrypt(value, key) : value;
    }
    return { body: result, unknownKeys: [] };
  },
}));

const { apiGet, apiPost } =
  require('@/src/services/apiClient') as typeof import('@/src/services/apiClient');

const sentBody = (call: number): unknown =>
  (mockRequestJson.mock.calls[call]?.[1] as { body?: unknown }).body;

beforeEach(() => {
  mockRequestJson.mockReset();
  mockRefetchManifest.mockReset();
  mockKeyring = null;
  mockManifest = null;
});

describe('apiRequest response decryption', () => {
  it('decrypts transit fields when there is a keyring', async () => {
    mockKeyring = {};
    mockRequestJson.mockResolvedValue({ title: 'x' });

    await expect(apiGet('/notes')).resolves.toEqual({ title: 'x', decrypted: true });
  });

  it('returns the response as is without a keyring', async () => {
    mockRequestJson.mockResolvedValue({ title: 'x' });

    await expect(apiGet('/notes')).resolves.toEqual({ title: 'x' });
  });
});

describe('apiRequest body encryption', () => {
  it('encrypts only the fields the manifest rule marks client: true', async () => {
    mockKeyring = {};
    mockManifest = {};
    mockRequestJson.mockResolvedValue({});

    await apiPost('/notes', { text: 'secret', tag: 'plain' });

    expect(sentBody(0)).toEqual({ text: 'ENC(secret)', tag: 'plain' });
  });

  it('sends the body unchanged when the route has no rule or there is no manifest', async () => {
    mockKeyring = {};
    mockRequestJson.mockResolvedValue({});

    await apiPost('/notes', { text: 'secret' });
    mockManifest = {};
    await apiPost('/other', { text: 'secret' });

    expect(sentBody(0)).toEqual({ text: 'secret' });
    expect(sentBody(1)).toEqual({ text: 'secret' });
  });

  it('refreshes a stale manifest and re-sends once, encrypted from the original body', async () => {
    mockKeyring = {};
    mockManifest = {};
    const stale = JSON.stringify({
      code: 'ENC_MANIFEST_STALE',
      latestVersion: 3,
      environment: 'sandbox',
    });
    mockRequestJson
      .mockRejectedValueOnce(new MockMtlsRequestError('Conflict', 409, stale))
      .mockResolvedValueOnce({ ok: true });
    mockRefetchManifest.mockResolvedValue(true);

    await expect(apiPost('/notes', { text: 'secret' })).resolves.toEqual({
      ok: true,
      decrypted: true,
    });

    expect(mockRefetchManifest).toHaveBeenCalledWith(3, 'sandbox');
    expect(mockRequestJson).toHaveBeenCalledTimes(2);
    expect(sentBody(1)).toEqual({ text: 'ENC(secret)' });
  });

  it('does not retry other errors', async () => {
    mockRequestJson.mockRejectedValue(
      new MockMtlsRequestError('Conflict', 409, '{"code":"OTHER"}'),
    );

    await expect(apiPost('/notes', { text: 'secret' })).rejects.toThrow('Conflict');

    expect(mockRefetchManifest).not.toHaveBeenCalled();
    expect(mockRequestJson).toHaveBeenCalledTimes(1);
  });
});
