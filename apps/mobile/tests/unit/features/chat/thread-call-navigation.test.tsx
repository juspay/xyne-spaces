import { jest, it, expect } from '@jest/globals';
import { router } from 'expo-router';
import { startAudioCall } from '@/src/utils/startAudioCall';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

it('passes conversation context when opening a thread call', async () => {
  await startAudioCall('channel', 'thread', ['self', 'subscriber', 'extra']);
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(protected)/native-call',
    params: {
      channelId: 'channel',
      conversationId: 'thread',
      initiateCall: 'true',
      targetUserIds: '["self","subscriber","extra"]',
    },
  });
});
it('preserves channel call navigation without a conversation', async () => {
  await startAudioCall('channel');
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(protected)/native-call',
    params: { channelId: 'channel', initiateCall: 'true' },
  });
});

it('does not navigate to a thread call without an explicit invitation list', async () => {
  jest.mocked(router.push).mockClear();
  await expect(startAudioCall('channel', 'thread')).rejects.toThrow('explicit invitation list');
  await expect(startAudioCall('channel', 'thread', [])).rejects.toThrow('explicit invitation list');
  expect(router.push).not.toHaveBeenCalled();
});
