import { jest, it, expect } from '@jest/globals';
import { router } from 'expo-router';
import { startAudioCall } from '@/src/utils/startAudioCall';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

it('passes conversation context when opening a thread call', async () => {
  await startAudioCall('channel', 'thread');
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(protected)/native-call',
    params: { channelId: 'channel', conversationId: 'thread', initiateCall: 'true' },
  });
});
it('preserves channel call navigation without a conversation', async () => {
  await startAudioCall('channel');
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(protected)/native-call',
    params: { channelId: 'channel', initiateCall: 'true' },
  });
});
