const mockGetBooleanValue = jest.fn();
const mockGetStringValue = jest.fn();

jest.mock('@/services/superpositionClient', () => ({
  superpositionClient: {
    getBooleanValue: (...args: unknown[]) => mockGetBooleanValue(...args),
    getStringValue: (...args: unknown[]) => mockGetStringValue(...args),
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import { resolveCallSttRouting, resolveNeuroLinkBaseUrl } from './callSttRouting';

function setFlags(flags: Record<string, boolean>): void {
  mockGetBooleanValue.mockImplementation(async (key: string, fallback: boolean) => flags[key] ?? fallback);
}

describe('resolveCallSttRouting', () => {
  beforeEach(() => jest.resetAllMocks());

  it('keeps the existing provider and no captions when both flags are off', async () => {
    setFlags({});
    await expect(resolveCallSttRouting({ workspaceId: 'ws1' })).resolves.toEqual({
      sttModel: 'google',
      liveCaptions: false,
    });
  });

  it('keeps a provider the caller picked', async () => {
    setFlags({});
    await expect(resolveCallSttRouting({ requestedModel: 'deepgram' })).resolves.toEqual({
      sttModel: 'deepgram',
      liveCaptions: false,
    });
  });

  it('ignores a NeuroLink request from the client while the flag is off', async () => {
    setFlags({});
    await expect(resolveCallSttRouting({ requestedModel: 'neurolink' })).resolves.toEqual({
      sttModel: 'google',
      liveCaptions: false,
    });
  });

  it('runs NeuroLink in parallel, unseen, when only eval is on', async () => {
    setFlags({ call_stt_eval_enabled: true });
    await expect(resolveCallSttRouting({})).resolves.toEqual({
      sttModel: 'google',
      sttShadowModel: 'neurolink',
      liveCaptions: false,
    });
  });

  it('shows NeuroLink with live captions when its flag is on', async () => {
    setFlags({ call_stt_neurolink_enabled: true });
    await expect(resolveCallSttRouting({})).resolves.toEqual({
      sttModel: 'neurolink',
      liveCaptions: true,
    });
  });

  it('runs the existing provider in parallel when both flags are on', async () => {
    setFlags({ call_stt_neurolink_enabled: true, call_stt_eval_enabled: true });
    await expect(resolveCallSttRouting({ requestedModel: 'azure' })).resolves.toEqual({
      sttModel: 'neurolink',
      sttShadowModel: 'azure',
      liveCaptions: true,
    });
  });

  it('replaces an unknown provider from the client with the default', async () => {
    setFlags({ call_stt_eval_enabled: true });
    await expect(resolveCallSttRouting({ requestedModel: 'something-else' })).resolves.toEqual({
      sttModel: 'google',
      sttShadowModel: 'neurolink',
      liveCaptions: false,
    });
  });

  it('uses the defaults when the flag service is slow', async () => {
    jest.useFakeTimers();
    try {
      mockGetBooleanValue.mockReturnValue(new Promise(() => undefined));
      const routing = resolveCallSttRouting({ workspaceId: 'ws1' });
      await jest.advanceTimersByTimeAsync(1500);
      await expect(routing).resolves.toEqual({ sttModel: 'google', liveCaptions: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the existing behaviour when the flag service fails', async () => {
    mockGetBooleanValue.mockRejectedValue(new Error('unavailable'));
    await expect(resolveCallSttRouting({ workspaceId: 'ws1' })).resolves.toEqual({
      sttModel: 'google',
      liveCaptions: false,
    });
  });

  it('evaluates the flags with the workspace and user', async () => {
    setFlags({});
    await resolveCallSttRouting({ workspaceId: 'ws1', email: 'a@example.com' });
    expect(mockGetBooleanValue).toHaveBeenCalledWith('call_stt_neurolink_enabled', false, {
      workspaceId: 'ws1',
      email: 'a@example.com',
    });
  });
});

describe('resolveNeuroLinkBaseUrl', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns null when the flag is unset', async () => {
    mockGetStringValue.mockResolvedValue('');
    await expect(resolveNeuroLinkBaseUrl({ workspaceId: 'ws1' })).resolves.toBeNull();
    expect(mockGetStringValue).toHaveBeenCalledWith('call_stt_neurolink_url', '', { workspaceId: 'ws1' });
  });

  it('returns the URL without trailing slashes', async () => {
    mockGetStringValue.mockResolvedValue(' https://stt.example.test/ ');
    await expect(resolveNeuroLinkBaseUrl({})).resolves.toBe('https://stt.example.test');
  });

  it('accepts websocket URLs', async () => {
    mockGetStringValue.mockResolvedValue('wss://stt.example.test');
    await expect(resolveNeuroLinkBaseUrl({})).resolves.toBe('wss://stt.example.test');
  });

  it('rejects values that are not http(s) or ws(s) URLs', async () => {
    for (const value of ['file:///etc/passwd', 'not a url', 'ftp://stt.example.test']) {
      mockGetStringValue.mockResolvedValue(value);
      await expect(resolveNeuroLinkBaseUrl({})).resolves.toBeNull();
    }
  });

  it('returns null when the flag service fails', async () => {
    mockGetStringValue.mockRejectedValue(new Error('unavailable'));
    await expect(resolveNeuroLinkBaseUrl({})).resolves.toBeNull();
  });
});
