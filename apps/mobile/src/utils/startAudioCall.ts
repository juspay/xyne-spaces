import { router } from 'expo-router';

export async function startAudioCall(channelId: string | null | undefined): Promise<void> {
  router.push({
    pathname: '/(protected)/native-call',
    params: {
      channelId: channelId as string,
      initiateCall: 'true',
    },
  });
}
