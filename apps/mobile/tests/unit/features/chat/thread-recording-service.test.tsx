import { jest, it, expect, beforeEach } from '@jest/globals';
import { recordingService } from '@/src/services/recordingService';
import { apiPost } from '@/src/services/apiClient';

jest.mock('@/src/services/apiClient', () => ({
  apiPost: jest.fn(),
  apiGet: jest.fn(),
  apiRequest: jest.fn(),
}));
jest.mock('@/src/contexts/AuthContext', () => ({ getAuthToken: async () => 'token' }));
jest.mock('@/src/services/authToken', () => ({ buildAuthenticatedHeaders: jest.fn() }));
jest.mock('@/src/utils/mtlsHttpClient', () => ({ mtlsDownloadToFile: jest.fn() }));
jest.mock('@/src/config', () => ({ API_BASE_URL: 'https://example.test' }));

beforeEach(() => {
  jest.mocked(apiPost).mockResolvedValue({
    externalId: 'recording',
    token: 'livekit-token',
    livekitUrl: 'wss://example.test',
    channelId: null,
  });
});

it('anchors a thread recording using both identifiers in the headless call request', async () => {
  await recordingService.startRecording({ channelId: 'channel', conversationId: 'thread' });
  expect(apiPost).toHaveBeenCalledWith(
    '/calls/initiate',
    {
      isHeadless: true,
      callType: 'AUDIO',
      sttModel: 'google',
      channelId: 'channel',
      conversationId: 'thread',
    },
    { token: 'token' },
  );
});

it('keeps standalone recordings unlinked', async () => {
  await recordingService.startRecording();
  expect(apiPost).toHaveBeenCalledWith(
    '/calls/initiate',
    { isHeadless: true, callType: 'AUDIO', sttModel: 'google' },
    { token: 'token' },
  );
});

it('propagates backend rejection rather than reporting a started recording', async () => {
  jest.mocked(apiPost).mockRejectedValue(new Error('Not a member'));
  await expect(
    recordingService.startRecording({ channelId: 'channel', conversationId: 'thread' }),
  ).rejects.toThrow('Not a member');
});
